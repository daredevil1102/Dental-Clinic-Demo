import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { resolveConnectionForChange } from '@/lib/whatsapp/resolve-connection'
import {
  processWebhook,
  type WhatsAppWebhookEntry,
} from '@/lib/whatsapp/process-webhook'

// The `after()` callback in POST runs within this route's max duration.
// Inbound processing can fan out to per-media Meta verification calls, so
// give it headroom beyond the platform default (Vercel clamps this to the
// plan's ceiling). Tune as needed.
export const maxDuration = 60

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch all whatsapp configs to check verify tokens
    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read the raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  // 1) Parse first — but treat the parsed body as UNTRUSTED input used only
  //    to identify the sender. This reorder (parse → resolve → verify) is
  //    deliberate: we need to know WHICH connection sent this to pick the
  //    right App Secret. It is safe because parsing has no side effect and
  //    resolution (step 2) is a read-only lookup. Do NOT "fix" this back to
  //    verify-first — there is no single secret to verify against anymore.
  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 2) Resolve the connection this delivery is FROM (phone_number_id first,
  //    waba_id fallback — §4.1.1), off the first change. The signature
  //    authenticates exactly one workspace (§4.1.2): we verify with that
  //    connection's secret, and processWebhook then processes ONLY changes
  //    that resolve back to it.
  const firstEntry = body.entry?.[0]
  const firstChange = firstEntry?.changes?.[0]
  if (!firstEntry || !firstChange) {
    console.warn('[webhook] delivery has no change to resolve a connection — rejecting')
    return NextResponse.json({ error: 'Unresolvable webhook' }, { status: 401 })
  }

  const resolution = await resolveConnectionForChange(
    firstEntry,
    firstChange,
    supabaseAdmin(),
  )
  if (!resolution.ok) {
    // Unknown or ambiguous sender → fail closed, no side effect (§4.1.1).
    // Never fall back to a second secret.
    console.warn(
      '[webhook] could not resolve a connection for this delivery — rejecting:',
      resolution.reason,
    )
    return NextResponse.json({ error: 'Unresolvable webhook' }, { status: 401 })
  }
  const expectedConfig = resolution.config

  // 3) Select the secret for THIS connection: its own decrypted app_secret
  //    when set, else the deployment-wide META_APP_SECRET (grandfathered
  //    manual rows). Neither available → 401.
  //
  //    `app_secret IS NULL` means one thing today: a manual connection
  //    without its own secret yet. claude-02 adds a second NULL population
  //    (embedded), at which point this must narrow to
  //    `connection_method === 'manual'` — see claude-02 §4.1.
  let secret: string | null
  if (expectedConfig.app_secret) {
    try {
      secret = decrypt(expectedConfig.app_secret)
    } catch (err) {
      console.error(
        '[webhook] failed to decrypt app_secret for connection',
        expectedConfig.id,
        err,
      )
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    secret = process.env.META_APP_SECRET ?? null
  }

  // 4) Verify the HMAC over the UNTOUCHED raw body string with that secret.
  //    401 (not 200) — we want Meta's delivery dashboard to show failures
  //    loudly if a misconfiguration causes signatures to stop matching,
  //    rather than silently eating events.
  if (!verifyMetaWebhookSignature(rawBody, signature, secret)) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 5) Process AFTER the response so we ack Meta within their ~20s timeout
  //    (a slow ack triggers Meta retries + duplicate inserts), while still
  //    guaranteeing the work runs to completion. `processWebhook` receives
  //    the verified connection as `expectedConfig` and skips any change that
  //    resolves elsewhere (§4.1.2).
  //
  //    This MUST use `after()` rather than a detached promise: on serverless
  //    platforms (we run on Vercel) the function can be frozen the moment the
  //    response is sent, so a floating promise's DB writes are not guaranteed
  //    to finish. That dropped a non-deterministic subset of inbound messages
  //    (issue #301). `after()` keeps the function alive until it resolves
  //    (within the route's maxDuration).
  after(async () => {
    try {
      await processWebhook(body, expectedConfig)
    } catch (error) {
      console.error('Error processing webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
