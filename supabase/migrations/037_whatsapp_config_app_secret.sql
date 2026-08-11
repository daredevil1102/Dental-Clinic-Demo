-- ============================================================
-- 037_whatsapp_config_app_secret.sql — per-client App Secret + inbound
-- health signal (claude-01 / P1-10 §3).
--
-- WHY:
--   Meta signs each inbound webhook with the App Secret of the app that
--   owns the number. Every manual client owns their OWN Meta app, so a
--   single deployment-wide META_APP_SECRET can only ever verify one of
--   them — every other client's inbound is dropped 401 (claude-01 §1).
--   `app_secret` stores each connection's own secret (encrypted, exactly
--   like access_token / verify_token).
--
--   `app_secret` is NULLABLE on purpose: NULL means "verify with
--   META_APP_SECRET", so the one grandfathered production connection keeps
--   working with no client action and no downtime. Nullable in the schema
--   is a statement about that one legacy row — it is still REQUIRED for
--   every new connection at the API layer (§5.1.1).
--
--   `last_inbound_at` is a best-effort diagnostic stamped in
--   process-webhook.ts when an inbound message is persisted, so a silently
--   dead connection ("no inbound for six days") is visible without opening
--   the database (§3.1 / §6.3).
--
-- Additive + idempotent (claude-00 invariant 7): both columns are nullable,
-- so OLD code tolerates them and this is safe to run before the code deploy.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS app_secret      TEXT,
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- Credentials become server-only (claude-01 §6.2, acceptance criterion #4).
--
-- RLS governs WHICH ROWS a member sees; these grants govern WHICH COLUMNS.
-- Both are needed — RLS alone still lets a member read their own row's
-- ciphertext by querying the columns directly from the browser.
--
-- Table-level SELECT must be revoked FIRST. A column-level REVOKE alone is a
-- no-op while the role still holds table-wide SELECT, which Supabase grants
-- to anon and authenticated by default; the grant below then re-adds only
-- the safe columns.
--
-- ⚠️ APPLY ORDER (§6.2 / task 8.10a, rollout step 2): every SERVER path that
-- decrypts a token must be switched to the service-role client BEFORE these
-- two statements run. `createClient()` from @/lib/supabase/server
-- authenticates as `authenticated` — the same role the browser uses — so this
-- revoke hits server code too. Running it early takes SENDING OFFLINE. The
-- ALTER TABLE above is safe to apply on its own; these two are not.
--
-- ⚠️ CHECK WHILE APPLYING: revoking table SELECT also affects any write that
-- RETURNS the row, because PostgREST needs SELECT on the returned columns.
-- The config route's user-scoped update/insert (config/route.ts :371, :388)
-- must either return nothing or return only granted columns — verify at
-- 8.10a. claude-02 adds connection_method and business_id to the grant list.
-- ------------------------------------------------------------
REVOKE SELECT ON whatsapp_config FROM anon, authenticated;

GRANT SELECT (
  id, account_id, phone_number_id, waba_id, status, connected_at,
  registered_at, subscribed_apps_at, last_registration_error,
  last_inbound_at, created_at, updated_at
) ON whatsapp_config TO authenticated;
-- anon gets nothing back.
