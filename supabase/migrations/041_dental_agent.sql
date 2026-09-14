-- ============================================================
-- 041_dental_agent.sql
--
-- Dental AI Receptionist — schema additions.
--
-- Adds:
--   1. agent_enabled flag on dental_clinic_config
--   2. booked_via + calendar_uid on dental_appointments
--   3. dental_agent_sessions table for conversational state
--
-- Follows WACRM conventions:
--   • Every table scoped by account_id (multi-tenancy)
--   • RLS enabled on all new tables
--   • Idempotent (IF NOT EXISTS / guarded ALTER TABLE)
--   • Timestamps in UTC
-- ============================================================

-- -------------------------------------------------------
-- 1. dental_clinic_config — add agent feature flag
-- -------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dental_clinic_config' AND column_name = 'agent_enabled'
  ) THEN
    ALTER TABLE dental_clinic_config
      ADD COLUMN agent_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- -------------------------------------------------------
-- 2. dental_appointments — add booking source + calendar UID
-- -------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dental_appointments' AND column_name = 'booked_via'
  ) THEN
    ALTER TABLE dental_appointments
      ADD COLUMN booked_via text NOT NULL DEFAULT 'staff';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dental_appointments' AND column_name = 'calendar_uid'
  ) THEN
    ALTER TABLE dental_appointments
      ADD COLUMN calendar_uid text;
  END IF;
END $$;

-- -------------------------------------------------------
-- 3. dental_agent_sessions — conversational state for the
--    free-text AI receptionist.
--
--    Analogous to dental_reschedule_sessions but general
--    enough for book/cancel/reschedule/check_status intents.
--    The existing reschedule-sessions table is left untouched
--    (it serves the button-driven flow exclusively).
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_agent_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  patient_id      uuid REFERENCES dental_patients(id) ON DELETE SET NULL,
  conversation_id uuid,   -- CRM conversations.id for inbox correlation
  phone           text NOT NULL,

  -- Conversation state
  intent          text,    -- 'book' | 'cancel' | 'reschedule' | 'check_status' | 'faq_or_other' | null
  state           text NOT NULL DEFAULT 'awaiting_intent',
    -- State machine:
    --   awaiting_intent → collecting_info → confirming → executing → completed
    --   Any state → expired (30-min timeout)
    --   Any state → handed_off (transfer_to_human)

  -- Partially-filled entity bag for the current intent.
  -- Shape varies by intent:
  --   book:       { doctor_id, doctor_name, treatment_type, preferred_date, candidate_starts_at, offered_options }
  --   cancel:     { appointment_id }
  --   reschedule: { appointment_id, doctor_id, new_doctor_id, candidate_starts_at, offered_options }
  --   check_status: { appointment_id }
  slots           jsonb NOT NULL DEFAULT '{}',

  -- LLM conversation history (recent turns for context window)
  messages        jsonb NOT NULL DEFAULT '[]',

  -- Counters
  turn_count      int NOT NULL DEFAULT 0,

  -- Idempotency: tracks the last processed WhatsApp message ID
  -- to prevent duplicate processing on webhook retries.
  last_message_id text,

  -- Lifecycle
  expires_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dental_agent_sessions ENABLE ROW LEVEL SECURITY;

-- RLS: mirrors the established pattern from 040_dental_clinic.sql
DROP POLICY IF EXISTS dental_agent_sessions_select ON dental_agent_sessions;
CREATE POLICY dental_agent_sessions_select ON dental_agent_sessions
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS dental_agent_sessions_all ON dental_agent_sessions;
CREATE POLICY dental_agent_sessions_all ON dental_agent_sessions
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- Hot-path index: find active session by account + phone (the lookup
-- that runs on every qualifying inbound message).
CREATE INDEX IF NOT EXISTS idx_dental_agent_sessions_active
  ON dental_agent_sessions (account_id, phone)
  WHERE completed_at IS NULL;

-- Index on expires_at for cleanup queries.
CREATE INDEX IF NOT EXISTS idx_dental_agent_sessions_expires
  ON dental_agent_sessions (expires_at)
  WHERE completed_at IS NULL;
