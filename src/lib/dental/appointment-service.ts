// ============================================================
// Dental Clinic — Appointment Service.
//
// Core appointment CRUD + state machine transitions.
// All mutations go through this service to ensure:
//   1. State machine invariants are enforced
//   2. Audit trail is written
//   3. Reminders are scheduled/cancelled atomically
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DentalAppointment,
  DentalAppointmentStatus,
  CreateAppointmentRequest,
} from './types';
import { VALID_STATUS_TRANSITIONS } from './types';
import { loadClinicConfig } from './config';
import { scheduleRemindersForAppointment, cancelRemindersForAppointment } from './reminder-service';

// -------------------------------------------------------
// Create
// -------------------------------------------------------

export async function createAppointment(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: CreateAppointmentRequest,
): Promise<DentalAppointment> {
  const config = await loadClinicConfig(db, accountId, userId);
  const duration = input.duration_minutes ?? config.default_duration_minutes;
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  // Validate: appointment must be in the future
  if (startsAt.getTime() <= Date.now()) {
    throw new Error('Appointment must be in the future');
  }

  const { data, error } = await db
    .from('dental_appointments')
    .insert({
      account_id: accountId,
      user_id: userId,
      patient_id: input.patient_id,
      doctor_id: input.doctor_id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_minutes: duration,
      status: 'scheduled',
      treatment_type: input.treatment_type ?? null,
      notes: input.notes ?? null,
    })
    .select('*, patient:dental_patients(*), doctor:dental_doctors(*)')
    .single();

  if (error) {
    // Handle double-booking EXCLUDE constraint violation
    if (error.code === '23P01') {
      throw new Error(
        'This time slot conflicts with an existing appointment for this doctor',
      );
    }
    throw new Error(`Failed to create appointment: ${error.message}`);
  }

  // Audit
  await writeAudit(db, data.id, accountId, 'created', null, 'scheduled', userId, {
    patient_id: input.patient_id,
    doctor_id: input.doctor_id,
    starts_at: startsAt.toISOString(),
  });

  // Schedule reminders
  await scheduleRemindersForAppointment(db, data as DentalAppointment, config);

  return data as DentalAppointment;
}

// -------------------------------------------------------
// Read
// -------------------------------------------------------

export async function getAppointment(
  db: SupabaseClient,
  accountId: string,
  appointmentId: string,
): Promise<DentalAppointment | null> {
  const { data, error } = await db
    .from('dental_appointments')
    .select('*, patient:dental_patients(*), doctor:dental_doctors(*), reminders:dental_appointment_reminders(*)')
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error('[dental] getAppointment error:', error);
    return null;
  }

  return data as DentalAppointment | null;
}

export interface ListAppointmentsFilter {
  doctor_id?: string;
  patient_id?: string;
  status?: DentalAppointmentStatus | DentalAppointmentStatus[];
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

export async function listAppointments(
  db: SupabaseClient,
  accountId: string,
  filter: ListAppointmentsFilter = {},
): Promise<{ data: DentalAppointment[]; count: number }> {
  let query = db
    .from('dental_appointments')
    .select('*, patient:dental_patients(*), doctor:dental_doctors(*)', { count: 'exact' })
    .eq('account_id', accountId)
    .order('starts_at', { ascending: true });

  if (filter.doctor_id) query = query.eq('doctor_id', filter.doctor_id);
  if (filter.patient_id) query = query.eq('patient_id', filter.patient_id);
  if (filter.status) {
    if (Array.isArray(filter.status)) {
      query = query.in('status', filter.status);
    } else {
      query = query.eq('status', filter.status);
    }
  }
  if (filter.from_date) query = query.gte('starts_at', filter.from_date);
  if (filter.to_date) query = query.lte('starts_at', filter.to_date);
  if (filter.limit) query = query.limit(filter.limit);
  if (filter.offset) query = query.range(filter.offset, filter.offset + (filter.limit ?? 50) - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('[dental] listAppointments error:', error);
    return { data: [], count: 0 };
  }

  return { data: (data ?? []) as DentalAppointment[], count: count ?? 0 };
}

// -------------------------------------------------------
// State Machine Transitions
// -------------------------------------------------------

export async function transitionAppointment(
  db: SupabaseClient,
  accountId: string,
  appointmentId: string,
  newStatus: DentalAppointmentStatus,
  actor: string = 'system',
  details: Record<string, unknown> = {},
): Promise<DentalAppointment> {
  // Load current state
  const { data: current, error: fetchErr } = await db
    .from('dental_appointments')
    .select('*')
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .single();

  if (fetchErr || !current) {
    throw new Error(`Appointment not found: ${appointmentId}`);
  }

  const oldStatus = current.status as DentalAppointmentStatus;

  // Validate transition
  const validTargets = VALID_STATUS_TRANSITIONS[oldStatus];
  if (!validTargets.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${oldStatus} → ${newStatus}. Valid targets: ${validTargets.join(', ')}`,
    );
  }

  // Build update payload
  const update: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // Status-specific fields
  switch (newStatus) {
    case 'confirmed':
      update.confirmed_at = new Date().toISOString();
      update.patient_responded = true;
      update.patient_response_at = new Date().toISOString();
      break;
    case 'cancelled':
      update.cancelled_at = new Date().toISOString();
      update.patient_responded = true;
      update.patient_response_at = new Date().toISOString();
      if (details.reason) update.cancellation_reason = details.reason;
      break;
    case 'reschedule_requested':
      update.patient_responded = true;
      update.patient_response_at = new Date().toISOString();
      break;
    case 'completed':
      update.completed_at = new Date().toISOString();
      break;
    case 'reminder_sent':
      update.last_reminder_sent_at = new Date().toISOString();
      update.reminder_count = (current.reminder_count ?? 0) + 1;
      break;
  }

  const { data: updated, error: updateErr } = await db
    .from('dental_appointments')
    .update(update)
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .select('*, patient:dental_patients(*), doctor:dental_doctors(*)')
    .single();

  if (updateErr) {
    throw new Error(`Failed to update appointment: ${updateErr.message}`);
  }

  // Audit
  await writeAudit(db, appointmentId, accountId, newStatus, oldStatus, newStatus, actor, details);

  // Cancel pending reminders when patient responds or appointment is terminal
  const terminalStatuses: DentalAppointmentStatus[] = [
    'confirmed', 'cancelled', 'completed', 'no_show',
  ];
  if (terminalStatuses.includes(newStatus)) {
    await cancelRemindersForAppointment(db, appointmentId);
  }

  return updated as DentalAppointment;
}

// -------------------------------------------------------
// Find appointment by patient phone + upcoming status
// Used by webhook handler to match inbound replies.
// -------------------------------------------------------

export async function findActiveAppointmentForPatient(
  db: SupabaseClient,
  accountId: string,
  patientPhone: string,
): Promise<DentalAppointment | null> {
  // Find the patient by phone
  const { data: patient } = await db
    .from('dental_patients')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone', patientPhone)
    .maybeSingle();

  if (!patient) return null;

  // Find their most recent upcoming appointment that is awaiting response
  const { data: appointment } = await db
    .from('dental_appointments')
    .select('*, patient:dental_patients(*), doctor:dental_doctors(*)')
    .eq('account_id', accountId)
    .eq('patient_id', patient.id)
    .in('status', ['scheduled', 'reminder_sent'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return appointment as DentalAppointment | null;
}

// -------------------------------------------------------
// Mark past appointments as completed / no-show
// Called by the cron job for any appointment past its end time.
// -------------------------------------------------------

export async function autoCompleteAppointments(
  db: SupabaseClient,
): Promise<number> {
  const now = new Date().toISOString();

  // Confirmed appointments past their end time → completed
  const { data: confirmed } = await db
    .from('dental_appointments')
    .update({
      status: 'completed',
      completed_at: now,
      updated_at: now,
    })
    .eq('status', 'confirmed')
    .lt('ends_at', now)
    .select('id, account_id');

  // Unconfirmed appointments past their end time → no_show
  const { data: unconfirmed } = await db
    .from('dental_appointments')
    .update({
      status: 'no_show',
      updated_at: now,
    })
    .in('status', ['scheduled', 'reminder_sent'])
    .lt('ends_at', now)
    .select('id, account_id');

  const completed = [...(confirmed ?? []), ...(unconfirmed ?? [])];

  // Write audit entries for all auto-completed
  for (const appt of completed) {
    await writeAudit(
      db,
      appt.id,
      appt.account_id,
      'auto_completed',
      null,
      confirmed?.find((c) => c.id === appt.id) ? 'completed' : 'no_show',
      'system',
      { reason: 'past_end_time' },
    );
  }

  return completed.length;
}

// -------------------------------------------------------
// Audit helper
// -------------------------------------------------------

async function writeAudit(
  db: SupabaseClient,
  appointmentId: string,
  accountId: string,
  action: string,
  oldStatus: string | null,
  newStatus: string | null,
  actor: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from('dental_appointment_audit').insert({
    appointment_id: appointmentId,
    account_id: accountId,
    action,
    old_status: oldStatus,
    new_status: newStatus,
    actor,
    details,
  });

  if (error) {
    console.error('[dental] audit write failed:', error);
  }
}
