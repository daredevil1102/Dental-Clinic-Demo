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
-- ⚠️ APPLY ORDER (§6.2 / task 8.10a): every SERVER path that decrypts a
-- token must first be switched to the service-role client. Applying this
-- REVOKE before those reads are moved takes sending OFFLINE. Do not paste
-- this migration into production until 8.10a(c) is complete.
--
-- ⚠️ REVIEW BEFORE APPLY (Postgres column-privilege semantics): a
-- column-level `REVOKE SELECT (col)` has NO effect while the role still
-- holds table-level SELECT (Supabase grants table-wide SELECT to
-- anon/authenticated by default). If the criterion-#4 test (a user-scoped
-- client selecting access_token must get a permission error, not a row of
-- nulls) does not go red with the statement below, this must instead become
-- `REVOKE SELECT ON whatsapp_config FROM anon, authenticated;` followed by a
-- `GRANT SELECT (<safe columns>) ...`. Verified against a representative row
-- at 8.10a, not here. Tracked in the 8.6 report.
-- ------------------------------------------------------------
REVOKE SELECT (access_token, verify_token, app_secret)
  ON whatsapp_config FROM anon, authenticated;
