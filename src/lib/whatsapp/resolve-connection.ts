import type { WhatsAppConfig } from '@/types'

// ---------------------------------------------------------------------------
// Resolve the WhatsApp connection a single webhook *change* belongs to
// (claude-01 §4.1.1). Shared by both webhook routes — the manual route
// (this release) and the provider/embedded route (claude-02 §4.0) — so the
// ordering and the exactly-one-row rule live in one place.
//
// Ordering matters and the obvious order is wrong:
//   1. `value.metadata.phone_number_id` → whatsapp_config.phone_number_id.
//      UNIQUE since migration 013, so a match is exactly one row. Present on
//      message and status events.
//   2. Fallback: `entry.id` → whatsapp_config.waba_id, for events with no
//      metadata (template-lifecycle events). `waba_id` has NO constraint —
//      it is nullable and a WABA legitimately holds more than one number —
//      so this must require exactly one row and refuse to guess:
//        0 rows → unknown; ≥2 rows → ambiguous (both account_ids logged).
//
// Never "fix" the ambiguity with UNIQUE(waba_id): that breaks valid
// multi-number setups instead of invalid ones.
// ---------------------------------------------------------------------------

/** The minimum shape resolution needs off a webhook change. */
interface ResolvableChange {
  field: string
  value?: {
    metadata?: { phone_number_id?: string }
  }
}

export type ResolveConnectionResult =
  | { ok: true; config: WhatsAppConfig }
  | { ok: false; reason: 'unknown' | 'ambiguous' }

export async function resolveConnectionForChange(
  entry: { id: string },
  change: ResolvableChange,
  // Service-role client. Typed loosely because both callers lazy-init an
  // untyped admin client (`supabaseAdmin()`), mirroring the route.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<ResolveConnectionResult> {
  const phoneNumberId = change.value?.metadata?.phone_number_id

  // 1) Primary: resolve by phone_number_id (UNIQUE, migration 013).
  if (phoneNumberId) {
    const { data, error } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('phone_number_id', phoneNumberId)

    if (error) {
      console.error(
        '[resolve-connection] phone_number_id lookup failed:',
        phoneNumberId,
        error,
      )
      return { ok: false, reason: 'unknown' }
    }
    if (!data || data.length === 0) {
      console.error(
        '[resolve-connection] no connection for phone_number_id:',
        phoneNumberId,
      )
      return { ok: false, reason: 'unknown' }
    }
    if (data.length > 1) {
      // Shouldn't happen post-013, but a row created before the constraint
      // (or a race) would surface here. Guessing which account signed the
      // payload is not acceptable — mirror the existing #136 guard.
      console.error(
        `[resolve-connection] ${data.length} connections share phone_number_id ${phoneNumberId} — dropping. Accounts:`,
        data.map((r: WhatsAppConfig) => r.account_id),
      )
      return { ok: false, reason: 'ambiguous' }
    }
    return { ok: true, config: data[0] as WhatsAppConfig }
  }

  // 2) Fallback: no metadata → template-lifecycle event. Resolve by
  //    entry.id → waba_id, requiring exactly one row.
  const wabaId = entry.id
  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('waba_id', wabaId)

  if (error) {
    console.error('[resolve-connection] waba_id lookup failed:', wabaId, error)
    return { ok: false, reason: 'unknown' }
  }
  if (!data || data.length === 0) {
    console.error('[resolve-connection] no connection for waba_id:', wabaId)
    return { ok: false, reason: 'unknown' }
  }
  if (data.length > 1) {
    // Two accounts under one shared WABA is a real configuration. A
    // template event carries no phone_number_id, so we cannot attribute it
    // — drop and log both account_ids rather than write to the wrong one.
    console.error(
      `[resolve-connection] ${data.length} accounts share waba_id ${wabaId}; cannot attribute template event — dropping. Accounts:`,
      data.map((r: WhatsAppConfig) => r.account_id),
    )
    return { ok: false, reason: 'ambiguous' }
  }
  return { ok: true, config: data[0] as WhatsAppConfig }
}
