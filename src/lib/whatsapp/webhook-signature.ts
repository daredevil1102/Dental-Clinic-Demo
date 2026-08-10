import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   The `secret` is supplied by the caller, **not** read from the
 *   environment here. Each manual client owns their own Meta app and
 *   therefore their own App Secret, so the webhook route resolves the
 *   connection first and passes `decrypt(config.app_secret)` (falling
 *   back to `META_APP_SECRET` for grandfathered rows). The provider route
 *   (`claude-02`) passes the single deployment-wide provider secret. See
 *   `claude-01` §4.3.
 *
 *   The secret is **required**. If it's empty/absent we fail closed —
 *   the request is rejected. A previous version fell open with a warning
 *   log, which is unsafe for a public template: anyone who forgets the
 *   env var would be running a fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null | undefined,
): boolean {
  if (!secret) {
    console.error(
      '[webhook] no App Secret available for this connection — rejecting ' +
        'request (fail closed). Manual: set the client App Secret ' +
        '(Meta → App Settings → Basic → App Secret) or META_APP_SECRET.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
