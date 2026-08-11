import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Acceptance criterion #4, proved against a real database (P1-10 §6.2 / §9):
//
//   "no stored credential, plaintext or ciphertext, is returned from the server
//    OR DATABASE to the browser."
//
// A narrowed UI query cannot prove this — it only changes what the app asks
// for, not what the database is willing to give. The only proof is asking the
// database for a credential column AS `authenticated` and being refused.
//
// ─── This test is SKIPPED unless a sandbox database is configured ───────────
// It requires its own env vars, deliberately NOT the app's normal ones, so it
// can never be pointed at production by accident (claude-00 §4: development
// runs against a separate free Supabase project; there is no staging server):
//
//   SANDBOX_SUPABASE_URL       — the sandbox project URL
//   SANDBOX_SUPABASE_ANON_KEY  — its anon key
//   SANDBOX_TEST_USER_EMAIL    — a confirmed user in that project
//   SANDBOX_TEST_USER_PASSWORD
//
// Run it TWICE around applying migration 037's grant statements:
//   - BEFORE the grants it must FAIL (the select succeeds) — that is what
//     proves the migration is doing something.
//   - AFTER the grants it must PASS.
// If it does not go red before and green after, the migration is still wrong.
// Fix the migration, never this test.
// ---------------------------------------------------------------------------

const URL = process.env.SANDBOX_SUPABASE_URL
const ANON = process.env.SANDBOX_SUPABASE_ANON_KEY
const EMAIL = process.env.SANDBOX_TEST_USER_EMAIL
const PASSWORD = process.env.SANDBOX_TEST_USER_PASSWORD

const configured = Boolean(URL && ANON && EMAIL && PASSWORD)

const CREDENTIAL_COLUMNS = ['access_token', 'verify_token', 'app_secret'] as const

const SAFE_COLUMNS =
  'id, account_id, phone_number_id, waba_id, status, connected_at, registered_at, subscribed_apps_at, last_registration_error, last_inbound_at, created_at, updated_at'

describe.skipIf(!configured)(
  'criterion #4 — the database refuses credential columns to `authenticated`',
  () => {
    async function signedInClient() {
      const supabase = createClient(URL!, ANON!)
      const { error } = await supabase.auth.signInWithPassword({
        email: EMAIL!,
        password: PASSWORD!,
      })
      if (error) throw new Error(`sandbox sign-in failed: ${error.message}`)
      return supabase
    }

    for (const column of CREDENTIAL_COLUMNS) {
      it(`refuses to select ${column} — a permission error, not a row of nulls`, async () => {
        const supabase = await signedInClient()

        const { data, error } = await supabase
          .from('whatsapp_config')
          .select(column)
          .limit(1)

        // The distinction that matters: a row of nulls would mean the column
        // is still readable and merely empty. We require an outright refusal.
        expect(error).not.toBeNull()
        expect(error?.code ?? '').toMatch(/42501|PGRST/)
        expect(data).toBeFalsy()
      })
    }

    it('still returns the safe columns for the caller’s own account', async () => {
      const supabase = await signedInClient()

      const { error } = await supabase
        .from('whatsapp_config')
        .select(SAFE_COLUMNS)
        .limit(1)

      // RLS is unchanged: the member can still read their own row's
      // non-credential columns, which is what the settings page needs.
      expect(error).toBeNull()
    })

    it('refuses `select(*)`, since it expands to include the revoked columns', async () => {
      const supabase = await signedInClient()

      const { error } = await supabase.from('whatsapp_config').select('*').limit(1)

      expect(error).not.toBeNull()
    })
  },
)
