import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decrypt } from '@/lib/whatsapp/encryption'
import { MASKED_CREDENTIAL } from '@/lib/whatsapp/masked-credential'

// ---------------------------------------------------------------------------
// Tests for the manual connection save route (P1-10).
//
// Started life at §8.0b as characterization tests pinning the route's
// behaviour INCLUDING its two bugs, so the §5 rewrite could be verified as
// deliberate change rather than regression. Each has since been rewritten in
// the same commit as the behaviour it covers:
//
//   Bug 1 (§5.2) — fixed at 8.8. Was: a registration error wrote
//     'disconnected' + null timestamps even for a live connection. Now: a live
//     same-number connection is preserved and only the error is recorded.
//   Bug 2 (§5.3) — fixed at 8.9. Was: a failed WABA subscription was swallowed
//     and reported as a clean success. Now: surfaced on the response.
//   No role gate (§5.4) — added at 8.9a. Was: any member, including a viewer,
//     could overwrite or delete the connection. Now: requireRole('admin').
//
// Boundaries mocked at IO only:
//   - @/lib/supabase/server      → in-memory user-scoped client
//   - @supabase/supabase-js      → in-memory service-role client (claim check)
//   - @/lib/whatsapp/meta-api    → verify / register / subscribe spies
// Kept REAL: encryption — so "encrypted at rest" is asserted by round-tripping
// the stored ciphertext, not by trusting a mock.
// ---------------------------------------------------------------------------

interface ConfigState {
  user: { id: string } | null
  authError: unknown
  // requireRole('admin') reads account_id + account_role off the profile,
  // then loads the account row by id.
  profile: { account_id: string; account_role?: string } | null
  account: { id: string; name: string } | null
  profileError: unknown
  existing: Record<string, unknown> | null
  claimed: Record<string, unknown> | null
  claimedError: unknown
  insertError: unknown
  updateError: unknown
}

interface Recorded {
  inserts: Record<string, Array<Record<string, unknown>>>
  updates: Record<string, Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }>>
  deletes: Record<string, Array<{ filters: Record<string, unknown> }>>
}

const h = vi.hoisted(() => {
  const state = {} as ConfigState
  const calls = { inserts: {}, updates: {}, deletes: {} } as Recorded
  const reset = () => {
    state.user = { id: 'user-1' }
    state.authError = null
    state.profile = { account_id: 'acct-1', account_role: 'admin' }
    state.account = { id: 'acct-1', name: 'Test Workspace' }
    state.profileError = null
    state.existing = null
    state.claimed = null
    state.claimedError = null
    state.insertError = null
    state.updateError = null
    calls.inserts = {}
    calls.updates = {}
    calls.deletes = {}
  }
  return { state, calls, reset }
})

function record<T>(bucket: Record<string, T[]>, table: string, value: T) {
  ;(bucket[table] ??= []).push(value)
}

// User-scoped Supabase client (RLS session). Used by the route for auth,
// profile→account resolution, the existing-row lookup, and the insert/update.
function makeServerClient() {
  function from(table: string) {
    const ctx = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      filters: {} as Record<string, unknown>,
      payload: null as Record<string, unknown> | null,
    }
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = chain
    b.eq = (key: string, value: unknown) => {
      ctx.filters[key] = value
      return b
    }
    b.neq = chain
    b.insert = (payload: Record<string, unknown>) => {
      ctx.op = 'insert'
      ctx.payload = payload
      return b
    }
    b.update = (payload: Record<string, unknown>) => {
      ctx.op = 'update'
      ctx.payload = payload
      return b
    }
    b.delete = () => {
      ctx.op = 'delete'
      return b
    }
    const resolve = (): Record<string, unknown> => {
      if (ctx.op === 'insert') {
        record(h.calls.inserts, table, ctx.payload ?? {})
        return { data: null, error: h.state.insertError }
      }
      if (ctx.op === 'update') {
        record(h.calls.updates, table, { payload: ctx.payload ?? {}, filters: ctx.filters })
        return { data: null, error: h.state.updateError }
      }
      if (ctx.op === 'delete') {
        record(h.calls.deletes, table, { filters: ctx.filters })
        return { data: null, error: null }
      }
      switch (table) {
        case 'profiles':
          return { data: h.state.profile, error: h.state.profileError }
        case 'accounts':
          return { data: h.state.account, error: null }
        case 'whatsapp_config':
          return { data: h.state.existing, error: null }
        default:
          return { data: null, error: null }
      }
    }
    b.single = async () => resolve()
    b.maybeSingle = async () => resolve()
    b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(onFulfilled, onRejected)
    return b
  }
  return {
    auth: {
      getUser: async () => ({ data: { user: h.state.user }, error: h.state.authError }),
    },
    from,
  }
}

const serverClient = makeServerClient()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => serverClient,
}))

// Service-role client: only used to detect a phone_number_id claimed by a
// DIFFERENT account (invisible under the caller's RLS session).
function makeAdminClient() {
  function from(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = chain
    b.eq = chain
    b.neq = chain
    const resolve = (): Record<string, unknown> => {
      if (table === 'whatsapp_config') {
        return { data: h.state.claimed, error: h.state.claimedError }
      }
      return { data: null, error: null }
    }
    b.single = async () => resolve()
    b.maybeSingle = async () => resolve()
    b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(onFulfilled, onRejected)
    return b
  }
  return { from }
}

const adminClient = makeAdminClient()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => adminClient,
}))

const meta = vi.hoisted(() => ({
  verifyPhoneNumber: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
}))

vi.mock('@/lib/whatsapp/meta-api', () => meta)

import { DELETE, POST } from './route'

function postConfig(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/whatsapp/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  h.reset()
  meta.verifyPhoneNumber
    .mockReset()
    .mockResolvedValue({ verified_name: 'Test Co', display_phone_number: '+1 555 000 0000' })
  meta.registerPhoneNumber.mockReset().mockResolvedValue({})
  meta.subscribeWabaToApp.mockReset().mockResolvedValue({})
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/whatsapp/config — auth and validation', () => {
  it('returns 401 when there is no authenticated user', async () => {
    h.state.user = null
    const res = await postConfig({ phone_number_id: 'PNID-1', access_token: 'X', pin: '123456' })
    expect(res.status).toBe(401)
    expect(h.calls.inserts.whatsapp_config).toBeUndefined()
  })

  it('returns 403 when the profile is not linked to an account', async () => {
    h.state.profile = null
    const res = await postConfig({ phone_number_id: 'PNID-1', access_token: 'X', pin: '123456' })
    expect(res.status).toBe(403)
  })

  it('returns 400 when access_token or phone_number_id is missing', async () => {
    const res = await postConfig({ phone_number_id: 'PNID-1' })
    expect(res.status).toBe(400)
    expect(meta.verifyPhoneNumber).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed PIN', async () => {
    const res = await postConfig({ phone_number_id: 'PNID-1', access_token: 'X', pin: '12ab' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/whatsapp/config — happy path', () => {
  it('stores encrypted credentials as a connected config for an admin', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      waba_id: 'WABA-1',
      access_token: 'ACCESS-TOKEN',
      verify_token: 'VERIFY-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true, saved: true, registered: true })

    const inserts = h.calls.inserts.whatsapp_config ?? []
    expect(inserts).toHaveLength(1)
    const row = inserts[0]
    expect(row.account_id).toBe('acct-1')
    expect(row.status).toBe('connected')
    // Encrypted at rest: the stored value is ciphertext, but round-trips.
    expect(row.access_token).not.toBe('ACCESS-TOKEN')
    expect(decrypt(row.access_token as string)).toBe('ACCESS-TOKEN')
    expect(decrypt(row.verify_token as string)).toBe('VERIFY-TOKEN')
    expect(row.subscribed_apps_at).toBeTruthy()
  })

  it('never echoes a credential back in the response', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      verify_token: 'VERIFY-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toContain('APP-SECRET')
    expect(raw).not.toContain('ACCESS-TOKEN')
    expect(raw).not.toContain('VERIFY-TOKEN')
    // Not even the ciphertext.
    const stored = (h.calls.inserts.whatsapp_config ?? [])[0]
    expect(raw).not.toContain(stored.app_secret as string)
  })
})

// ---------------------------------------------------------------------------
// §5.1.1 — the App Secret is REQUIRED on create. This is the regression guard
// for §1: without it a new connection silently falls back to META_APP_SECRET
// (another client's secret) and every inbound message is dropped 401 while the
// UI says "Connected".
// ---------------------------------------------------------------------------
describe('POST /api/whatsapp/config — App Secret requirement (§5.1.1)', () => {
  it('rejects a NEW connection with no app_secret: 400, nothing written, no Meta call', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/app secret/i)
    // Names where to find it — the most likely onboarding mistake.
    expect(json.error).toMatch(/App Settings/i)
    expect(h.calls.inserts.whatsapp_config).toBeUndefined()
    expect(h.calls.updates.whatsapp_config).toBeUndefined()
    // Rejected before burning a Meta round trip.
    expect(meta.verifyPhoneNumber).not.toHaveBeenCalled()
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled()
  })

  it('rejects a NEW connection with a whitespace-only app_secret', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: '   ',
      pin: '123456',
    })
    expect(res.status).toBe(400)
    expect(h.calls.inserts.whatsapp_config).toBeUndefined()
  })

  it('stores a NEW connection\'s app_secret encrypted at rest', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const row = (h.calls.inserts.whatsapp_config ?? [])[0]
    expect(row.app_secret).not.toBe('APP-SECRET')
    expect(decrypt(row.app_secret as string)).toBe('APP-SECRET')
  })

  it('preserves the stored ciphertext when an EXISTING connection is re-saved with app_secret omitted', async () => {
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
    }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const update = (h.calls.updates.whatsapp_config ?? [])[0]
    // The key is absent entirely — not written as null — so whatever is
    // stored (ciphertext, or NULL for a grandfathered row) survives untouched.
    expect(update.payload).not.toHaveProperty('app_secret')
  })

  it('lets a grandfathered NULL row re-save without an app_secret (no 400)', async () => {
    // The one production connection that predates 037: app_secret IS NULL and
    // keeps verifying via META_APP_SECRET. A re-save must never demand one.
    h.state.existing = { id: 'cfg-legacy', phone_number_id: 'PNID-1', registered_at: null }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    expect(res.status).toBe(200)
    const update = (h.calls.updates.whatsapp_config ?? [])[0]
    expect(update.payload).not.toHaveProperty('app_secret')
  })

  it('preserves the stored verify_token when an EXISTING connection is re-saved without one', async () => {
    // The regression: the browser rendered this field blank for an existing
    // connection and submitted it as null, so any save — rotating the access
    // token, fixing a typo in the WABA id — erased a working verify token.
    // Nothing failed until Meta next re-verified the callback URL, long after.
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
    }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const update = (h.calls.updates.whatsapp_config ?? [])[0]
    expect(update.payload).not.toHaveProperty('verify_token')
  })

  it('does not let a blank verify_token erase the stored one', async () => {
    // Absent and blank must behave identically. Deleting a stored token needs
    // an explicit control; an empty box is not one.
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
    }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      verify_token: '   ',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const update = (h.calls.updates.whatsapp_config ?? [])[0]
    expect(update.payload).not.toHaveProperty('verify_token')
  })

  it('updates the stored verify_token when an existing connection submits a new one', async () => {
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
    }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      verify_token: '  ROTATED-VERIFY  ',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const update = (h.calls.updates.whatsapp_config ?? [])[0]
    expect(decrypt(update.payload.verify_token as string)).toBe('ROTATED-VERIFY')
  })

  it('updates the stored app_secret when an existing connection submits a new one', async () => {
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
    }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: 'ROTATED-SECRET',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const update = (h.calls.updates.whatsapp_config ?? [])[0]
    expect(decrypt(update.payload.app_secret as string)).toBe('ROTATED-SECRET')
  })

  it('rejects the literal mask string server-side, storing nothing', async () => {
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
    }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: MASKED_CREDENTIAL,
      pin: '123456',
    })

    expect(res.status).toBe(400)
    expect(h.calls.updates.whatsapp_config).toBeUndefined()
    expect(h.calls.inserts.whatsapp_config).toBeUndefined()
    expect(meta.verifyPhoneNumber).not.toHaveBeenCalled()
  })

  it('rejects a masked access_token server-side too', async () => {
    h.state.existing = { id: 'cfg-1', phone_number_id: 'PNID-1', registered_at: null }
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: MASKED_CREDENTIAL,
      pin: '123456',
    })
    expect(res.status).toBe(400)
    expect(h.calls.updates.whatsapp_config).toBeUndefined()
  })
})

describe('POST /api/whatsapp/config — cross-account conflict', () => {
  it('returns 409 and writes nothing when another account already claims the number', async () => {
    h.state.claimed = { account_id: 'other-account' }
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    expect(res.status).toBe(409)
    expect(h.calls.inserts.whatsapp_config).toBeUndefined()
    expect(h.calls.updates.whatsapp_config).toBeUndefined()
    // Conflict is caught before the Meta verification call.
    expect(meta.verifyPhoneNumber).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Bug 1 (§5.2) — FIXED at 8.8. These assertions previously documented the bug
// (a live connection downgraded to 'disconnected' on any registration error);
// they now assert the guard, changed in the same commit as the behaviour.
// ---------------------------------------------------------------------------
describe('POST /api/whatsapp/config — no-downgrade guard (§5.2)', () => {
  it('preserves a live connection on a registration error, recording only the error', async () => {
    // An existing, already-registered, CONNECTED row for the same number —
    // i.e. a live client re-saving with a fresh PIN while Meta has a moment.
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
      status: 'connected',
      connected_at: '2026-01-01T00:00:00.000Z',
    }
    meta.registerPhoneNumber.mockRejectedValueOnce(new Error('Meta 500: register failed'))

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: false, saved: true, registered: false })

    const updates = h.calls.updates.whatsapp_config ?? []
    expect(updates).toHaveLength(1)
    const payload = updates[0].payload
    // The connection-state columns are not written at all, so the live values
    // survive: the client stays online.
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('connected_at')
    expect(payload).not.toHaveProperty('registered_at')
    // The error is still recorded so the UI can surface it.
    expect(payload.last_registration_error).toContain('register failed')
  })

  it('still writes disconnected on a registration error for a brand-new connection', async () => {
    // Nothing live to protect — a failed first registration is genuinely
    // disconnected.
    meta.registerPhoneNumber.mockRejectedValueOnce(new Error('Meta 500: register failed'))

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const row = (h.calls.inserts.whatsapp_config ?? [])[0]
    expect(row.status).toBe('disconnected')
    expect(row.connected_at).toBeNull()
    expect(row.registered_at).toBeNull()
    expect(row.last_registration_error).toContain('register failed')
  })

  it('still writes disconnected when an existing connection moves to a DIFFERENT number', async () => {
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-OLD',
      registered_at: '2026-01-01T00:00:00.000Z',
      status: 'connected',
      connected_at: '2026-01-01T00:00:00.000Z',
    }
    meta.registerPhoneNumber.mockRejectedValueOnce(new Error('Meta 500: register failed'))

    const res = await postConfig({
      phone_number_id: 'PNID-NEW',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const payload = (h.calls.updates.whatsapp_config ?? [])[0].payload
    expect(payload.status).toBe('disconnected')
    expect(payload.connected_at).toBeNull()
    expect(payload.registered_at).toBeNull()
  })

  it('still writes disconnected when the existing row was already disconnected', async () => {
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: null,
      status: 'disconnected',
      connected_at: null,
    }
    meta.registerPhoneNumber.mockRejectedValueOnce(new Error('Meta 500: register failed'))

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const payload = (h.calls.updates.whatsapp_config ?? [])[0].payload
    expect(payload.status).toBe('disconnected')
  })

  it('writes connected normally when registration succeeds', async () => {
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: null,
      status: 'disconnected',
      connected_at: null,
    }

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    expect(res.status).toBe(200)

    const payload = (h.calls.updates.whatsapp_config ?? [])[0].payload
    expect(payload.status).toBe('connected')
    expect(payload.connected_at).toBeTruthy()
    expect(payload.registered_at).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Bug 2 (§5.3) — FIXED at 8.9. This previously asserted success:true on a
// failed subscription (onboarding "completes", inbox stays empty forever);
// it now asserts the failure is surfaced, changed with the behaviour.
// ---------------------------------------------------------------------------
describe('POST /api/whatsapp/config — surfaces subscription failure (§5.3)', () => {
  it('reports the failure instead of a clean success, and does not stamp subscribed_apps_at', async () => {
    meta.subscribeWabaToApp.mockRejectedValueOnce(new Error('subscribe failed'))

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      waba_id: 'WABA-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    const json = await res.json()

    // The row is still saved (the call stays non-fatal — a client may have
    // subscribed by hand), but the response must not claim a clean success.
    expect(res.status).toBe(200)
    expect(json.saved).toBe(true)
    expect(json.success).toBe(false)
    expect(json.subscribed).toBe(false)
    expect(json.subscription_error).toContain('subscribe failed')

    const inserts = h.calls.inserts.whatsapp_config ?? []
    expect(inserts).toHaveLength(1)
    expect(inserts[0].status).toBe('connected')
    // Recorded only on actual success.
    expect(inserts[0].subscribed_apps_at).toBeNull()
  })

  it('reports a clean success and stamps subscribed_apps_at when subscription succeeds', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      waba_id: 'WABA-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.subscribed).toBe(true)
    expect(json.subscription_error).toBeNull()
    expect((h.calls.inserts.whatsapp_config ?? [])[0].subscribed_apps_at).toBeTruthy()
  })

  it('reports subscribed:null when there is no waba_id to subscribe (legacy row)', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.subscribed).toBeNull()
    expect(meta.subscribeWabaToApp).not.toHaveBeenCalled()
  })

  it('carries the subscription error alongside a registration error', async () => {
    meta.registerPhoneNumber.mockRejectedValueOnce(new Error('register failed'))
    meta.subscribeWabaToApp.mockRejectedValueOnce(new Error('subscribe failed'))

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      waba_id: 'WABA-1',
      access_token: 'ACCESS-TOKEN',
      app_secret: 'APP-SECRET',
      pin: '123456',
    })
    const json = await res.json()

    expect(json.success).toBe(false)
    expect(json.registration_error).toContain('register failed')
    expect(json.subscription_error).toContain('subscribe failed')
  })
})

// ---------------------------------------------------------------------------
// §5.4 — the role gate. This asserts NEW behaviour: before 8.9a the route had
// no role check at all (the 8.0b baseline documented its absence), so any
// workspace member — including a viewer — could overwrite or delete the
// connection. P1-10 is what makes those stored credentials worth stealing.
// ---------------------------------------------------------------------------
describe('POST/DELETE /api/whatsapp/config — requireRole(admin) (§5.4)', () => {
  const adminPayload = {
    phone_number_id: 'PNID-1',
    access_token: 'ACCESS-TOKEN',
    app_secret: 'APP-SECRET',
    pin: '123456',
  }

  for (const role of ['viewer', 'agent'] as const) {
    it(`refuses a ${role}: POST → 403, nothing written, no Meta call`, async () => {
      h.state.profile = { account_id: 'acct-1', account_role: role }

      const res = await postConfig(adminPayload)

      expect(res.status).toBe(403)
      expect(h.calls.inserts.whatsapp_config).toBeUndefined()
      expect(h.calls.updates.whatsapp_config).toBeUndefined()
      expect(meta.verifyPhoneNumber).not.toHaveBeenCalled()
    })

    it(`refuses a ${role}: DELETE → 403, nothing deleted`, async () => {
      h.state.profile = { account_id: 'acct-1', account_role: role }

      const res = await DELETE()

      expect(res.status).toBe(403)
      expect(h.calls.deletes.whatsapp_config).toBeUndefined()
    })
  }

  for (const role of ['admin', 'owner'] as const) {
    it(`allows an ${role}: POST succeeds`, async () => {
      h.state.profile = { account_id: 'acct-1', account_role: role }

      const res = await postConfig(adminPayload)

      expect(res.status).toBe(200)
      expect(h.calls.inserts.whatsapp_config ?? []).toHaveLength(1)
    })

    it(`allows an ${role}: DELETE removes only this account's row`, async () => {
      h.state.profile = { account_id: 'acct-1', account_role: role }

      const res = await DELETE()

      expect(res.status).toBe(200)
      const deletes = h.calls.deletes.whatsapp_config ?? []
      expect(deletes).toHaveLength(1)
      expect(deletes[0].filters).toEqual({ account_id: 'acct-1' })
    })
  }

  it('returns 401 for DELETE with no authenticated user', async () => {
    h.state.user = null
    const res = await DELETE()
    expect(res.status).toBe(401)
    expect(h.calls.deletes.whatsapp_config).toBeUndefined()
  })
})
