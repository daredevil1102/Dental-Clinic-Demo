-- ============================================================
-- 040_dental_clinic.sql
--
-- Dental Clinic Appointment Reminder & Scheduling Automation.
--
-- Follows WACRM conventions:
--   • Every table scoped by account_id (multi-tenancy)
--   • user_id for audit / NOT NULL FK compliance
--   • RLS enabled on all tables
--   • Idempotent (IF NOT EXISTS / DROP IF EXISTS where needed)
--   • Timestamps in UTC; presentation layer converts to
--     Europe/Amsterdam via dental_clinic_config.timezone
-- ============================================================

-- -------------------------------------------------------
-- ENUM: appointment status state machine
-- -------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE dental_appointment_status AS ENUM (
    'scheduled',
    'reminder_sent',
    'confirmed',
    'cancelled',
    'reschedule_requested',
    'rescheduled',
    'completed',
    'no_show'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dental_reminder_status AS ENUM (
    'pending',
    'sent',
    'delivered',
    'cancelled',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dental_reminder_type AS ENUM (
    'initial_12h',
    'follow_up',
    'final_2h'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -------------------------------------------------------
-- TABLE: dental_clinic_config
-- Per-account clinic settings. One row per account.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_clinic_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id),

  clinic_name         text NOT NULL DEFAULT 'Amsterdam Dental Care',
  clinic_phone        text,
  clinic_address      text,
  clinic_timezone     text NOT NULL DEFAULT 'Europe/Amsterdam',

  -- Reminder intervals (in minutes before appointment)
  reminder_initial_minutes   int NOT NULL DEFAULT 720,   -- 12 hours
  reminder_final_minutes     int NOT NULL DEFAULT 120,   -- 2 hours
  reminder_followup_interval int NOT NULL DEFAULT 180,   -- 3 hours between follow-ups

  -- Default appointment duration in minutes
  default_duration_minutes   int NOT NULL DEFAULT 30,

  -- Demo mode: when true, uses mock WhatsApp service
  demo_mode     boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE(account_id)
);

ALTER TABLE dental_clinic_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_clinic_config_select ON dental_clinic_config
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_clinic_config_all ON dental_clinic_config
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- -------------------------------------------------------
-- TABLE: dental_doctors
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_doctors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id),

  full_name       text NOT NULL,
  specialization  text,
  phone           text,
  email           text,
  avatar_url      text,
  is_active       boolean NOT NULL DEFAULT true,

  -- Default working hours (JSON). Overridden by dental_doctor_availability.
  -- Format: { "mon": { "start": "09:00", "end": "17:00" }, ... }
  default_hours   jsonb NOT NULL DEFAULT '{
    "mon": {"start": "09:00", "end": "17:00"},
    "tue": {"start": "09:00", "end": "17:00"},
    "wed": {"start": "09:00", "end": "17:00"},
    "thu": {"start": "09:00", "end": "17:00"},
    "fri": {"start": "09:00", "end": "13:00"},
    "sat": null,
    "sun": null
  }'::jsonb,

  -- Default slot duration in minutes
  slot_duration_minutes int NOT NULL DEFAULT 30,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dental_doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_doctors_select ON dental_doctors
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_doctors_all ON dental_doctors
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dental_doctors_account
  ON dental_doctors(account_id);

-- -------------------------------------------------------
-- TABLE: dental_patients
-- Links to WACRM contacts table for WhatsApp messaging.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_patients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id),

  -- Link to WACRM contact (nullable — can exist independently)
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,

  full_name     text NOT NULL,
  phone         text NOT NULL,
  email         text,
  date_of_birth date,
  notes         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One patient per phone per account
  UNIQUE(account_id, phone)
);

ALTER TABLE dental_patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_patients_select ON dental_patients
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_patients_all ON dental_patients
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dental_patients_account
  ON dental_patients(account_id);
CREATE INDEX IF NOT EXISTS idx_dental_patients_contact
  ON dental_patients(contact_id);
CREATE INDEX IF NOT EXISTS idx_dental_patients_phone
  ON dental_patients(account_id, phone);

-- -------------------------------------------------------
-- TABLE: dental_doctor_availability
-- Per-day overrides for doctor schedules (holidays, special hours).
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_doctor_availability (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     uuid NOT NULL REFERENCES dental_doctors(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- The specific date this override applies to
  available_date  date NOT NULL,

  -- NULL = day off / holiday. Non-null = custom hours for that day.
  start_time      time,
  end_time        time,

  -- Optional break periods within the day (JSON array)
  -- Format: [{"start": "12:00", "end": "13:00"}]
  breaks          jsonb DEFAULT '[]'::jsonb,

  -- Reason for override (e.g. "Public holiday", "Conference")
  reason          text,

  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE(doctor_id, available_date)
);

ALTER TABLE dental_doctor_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_doctor_availability_select ON dental_doctor_availability
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_doctor_availability_all ON dental_doctor_availability
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dental_availability_doctor_date
  ON dental_doctor_availability(doctor_id, available_date);

-- -------------------------------------------------------
-- TABLE: dental_appointments
-- Core appointment table with state machine.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id),

  patient_id    uuid NOT NULL REFERENCES dental_patients(id) ON DELETE CASCADE,
  doctor_id     uuid NOT NULL REFERENCES dental_doctors(id) ON DELETE CASCADE,

  -- Appointment time in UTC. The clinic timezone from config is used
  -- for display and reminder scheduling only.
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 30,

  -- State machine status
  status        dental_appointment_status NOT NULL DEFAULT 'scheduled',

  -- Treatment / reason
  treatment_type  text,
  notes           text,

  -- Tracking
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  completed_at          timestamptz,

  -- Links to WACRM conversation (set when WhatsApp reminder is sent)
  conversation_id       uuid,

  -- Rescheduling
  rescheduled_from_id   uuid REFERENCES dental_appointments(id),
  rescheduled_to_id     uuid REFERENCES dental_appointments(id),

  -- Reminder state tracking
  last_reminder_sent_at   timestamptz,
  reminder_count          int NOT NULL DEFAULT 0,
  patient_responded       boolean NOT NULL DEFAULT false,
  patient_response_at     timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Guard against double-booking: no overlapping appointments per doctor
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'rescheduled'))
);

ALTER TABLE dental_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_appointments_select ON dental_appointments
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_appointments_all ON dental_appointments
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dental_appointments_account
  ON dental_appointments(account_id);
CREATE INDEX IF NOT EXISTS idx_dental_appointments_doctor_date
  ON dental_appointments(doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_dental_appointments_patient
  ON dental_appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_dental_appointments_status
  ON dental_appointments(account_id, status);
CREATE INDEX IF NOT EXISTS idx_dental_appointments_starts
  ON dental_appointments(starts_at)
  WHERE status IN ('scheduled', 'reminder_sent');

-- -------------------------------------------------------
-- TABLE: dental_appointment_reminders
-- Individual reminder events — the cron job queries this.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_appointment_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES dental_appointments(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  reminder_type   dental_reminder_type NOT NULL,
  status          dental_reminder_status NOT NULL DEFAULT 'pending',

  -- When to send (UTC)
  scheduled_at    timestamptz NOT NULL,
  -- When actually sent
  sent_at         timestamptz,
  -- When delivery confirmed by Meta
  delivered_at    timestamptz,

  -- Meta WhatsApp message ID (for tracking delivery status)
  whatsapp_message_id text,

  -- Error details if failed
  error_message   text,

  -- Sequence number within this appointment's reminder chain
  sequence_number int NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate reminders for same appointment + type + sequence
  UNIQUE(appointment_id, reminder_type, sequence_number)
);

ALTER TABLE dental_appointment_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_reminders_select ON dental_appointment_reminders
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_reminders_all ON dental_appointment_reminders
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- The cron job's hot path: find all pending reminders due now
CREATE INDEX IF NOT EXISTS idx_dental_reminders_pending
  ON dental_appointment_reminders(scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_dental_reminders_appointment
  ON dental_appointment_reminders(appointment_id);

-- -------------------------------------------------------
-- TABLE: dental_appointment_audit
-- Full audit trail for every state change.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_appointment_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES dental_appointments(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  action          text NOT NULL,  -- e.g. 'created', 'reminder_sent', 'confirmed', 'cancelled'
  old_status      text,
  new_status      text,
  actor           text NOT NULL DEFAULT 'system', -- 'system', 'patient', 'staff', user_id
  details         jsonb DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dental_appointment_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_audit_select ON dental_appointment_audit
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_audit_insert ON dental_appointment_audit
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dental_audit_appointment
  ON dental_appointment_audit(appointment_id, created_at);

-- -------------------------------------------------------
-- TABLE: dental_reschedule_sessions
-- Tracks active rescheduling conversations.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_reschedule_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES dental_appointments(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES dental_patients(id) ON DELETE CASCADE,

  -- Conversation state
  step            text NOT NULL DEFAULT 'date_selection',
    -- date_selection → time_selection → confirmation → completed
  offered_dates   jsonb,        -- dates shown to patient
  selected_date   date,
  offered_slots   jsonb,        -- time slots shown for selected date
  selected_slot   text,         -- e.g. "10:30"
  new_starts_at   timestamptz,  -- calculated new start time

  expires_at      timestamptz NOT NULL,  -- session timeout (30 min)
  completed_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dental_reschedule_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_reschedule_select ON dental_reschedule_sessions
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_reschedule_all ON dental_reschedule_sessions
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dental_reschedule_appointment
  ON dental_reschedule_sessions(appointment_id)
  WHERE completed_at IS NULL;

-- -------------------------------------------------------
-- TABLE: dental_message_log
-- Logs all WhatsApp messages sent by the dental system
-- (for demo mode and audit purposes).
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_message_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  appointment_id  uuid REFERENCES dental_appointments(id) ON DELETE SET NULL,
  patient_id      uuid REFERENCES dental_patients(id) ON DELETE SET NULL,

  direction       text NOT NULL DEFAULT 'outbound', -- 'outbound' | 'inbound'
  message_type    text NOT NULL, -- 'text' | 'interactive' | 'template'
  content         text,
  interactive_payload jsonb,
  whatsapp_message_id text,

  -- For demo mode: the full message that WOULD have been sent
  mock_mode       boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dental_message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY dental_message_log_select ON dental_message_log
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dental_message_log_insert ON dental_message_log
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dental_message_log_appointment
  ON dental_message_log(appointment_id, created_at);

-- -------------------------------------------------------
-- Enable btree_gist for the EXCLUDE constraint
-- (Supabase has this available)
-- -------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;
