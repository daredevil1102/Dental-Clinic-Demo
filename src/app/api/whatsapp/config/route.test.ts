import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decrypt } from '@/lib/whatsapp/encryption'

// ---------------------------------------------------------------------------
// CHARACTERIZATION tests for the manual connection save route (P1-10 §8.0b).
//
// These pin the route's *current* behaviour, INCLUDING the two known bugs, so
// §8.7–§8.9 can be verified as deliberate changes rather than regressions:
//
//   Bug 1 (§5.2, fixed at 8.8): a registration error writes status
//     'disconnected' + null timestamps even when re-saving a live connection.
//     The test below ASSERTS 'disconnected' and passes against unchanged code.
//     It is updated in the same commit that fixes the bug.
//
//   Bug 2 (§5.3, fixed at 8.9): a failed WABA subscription is swallowed and the
//     route still reports a clean success. Characterized here as success:true.
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
  profile: { account_id: string } | null
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
    state.profile = { account_id: 'acct-1' }
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

import { POST } from './route'

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
  it('stores encrypted credentials as a connected config for any account-linked user (no role gate today)', async () => {
    const res = await postConfig({
      phone_number_id: 'PNID-1',
      waba_id: 'WABA-1',
      access_token: 'ACCESS-TOKEN',
      verify_token: 'VERIFY-TOKEN',
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

describe('POST /api/whatsapp/config — Bug 1: registration error downgrades even a live connection', () => {
  it('writes status=disconnected with null timestamps on a registration error (CURRENT behaviour)', async () => {
    // An existing, already-registered connection for the same number — i.e. a
    // live client re-saving with a fresh PIN while Meta is having a moment.
    h.state.existing = {
      id: 'cfg-1',
      phone_number_id: 'PNID-1',
      registered_at: '2026-01-01T00:00:00.000Z',
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
    // Bug 1: the live connection is downgraded to disconnected on a transient
    // registration failure. This assertion is intentionally correct-as-buggy.
    expect(payload.status).toBe('disconnected')
    expect(payload.connected_at).toBeNull()
    expect(payload.registered_at).toBeNull()
    expect(payload.last_registration_error).toContain('register failed')
  })
})

describe('POST /api/whatsapp/config — Bug 2: subscription failure reported as success', () => {
  it('returns success:true and null subscribed_apps_at when subscribeWabaToApp throws (CURRENT behaviour)', async () => {
    meta.subscribeWabaToApp.mockRejectedValueOnce(new Error('subscribe failed'))

    const res = await postConfig({
      phone_number_id: 'PNID-1',
      waba_id: 'WABA-1',
      access_token: 'ACCESS-TOKEN',
      pin: '123456',
    })
    const json = await res.json()

    // Bug 2: onboarding "succeeds" even though inbound will never be delivered.
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)

    const inserts = h.calls.inserts.whatsapp_config ?? []
    expect(inserts).toHaveLength(1)
    expect(inserts[0].status).toBe('connected')
    expect(inserts[0].subscribed_apps_at).toBeNull()
  })
})
