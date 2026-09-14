// ============================================================
// Dental Clinic — Shared reschedule-commit logic.
//
// Extracted from webhook-handler.ts (handleRescheduleConfirm)
// so that both the button-driven flow and the AI agent call
// the same, single implementation. One implementation, two
// front doors.
//
// Steps:
//   1. Create the new appointment row (rescheduled_from_id → old)
//   2. Mark the old appointment as 'rescheduled' (rescheduled_to_id → new)
//   3. Schedule reminders for the new appointment
//   4. Cancel pending reminders for the old appointment
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DentalAppointment, DentalClinicConfig } from './types';
import { scheduleRemindersForAppointment, cancelRemindersForAppointment } from './reminder-service';

export interface CommitRescheduleArgs {
  db: SupabaseClient;
  accountId: string;
  oldAppointment: DentalAppointment;
  newStartsAt: Date;
  config: DentalClinicConfig;
  /** Doctor for the new appointment — defaults to old appointment's doctor. */
  newDoctorId?: string;
  /** Who initiated: 'patient', 'patient_via_agent', 'staff', etc. */
  actor: string;
  /** How this was booked: 'button' | 'agent' | 'staff'. */
  bookedVia?: string;
}

export interface CommitRescheduleResult {
  newAppointment: DentalAppointment;
}

/**
 * Atomically commit a reschedule: create new row, mark old as
 * rescheduled, schedule fresh reminders, cancel old reminders.
 *
 * Throws on failure (including the EXCLUDE constraint for double-booking,
 * which callers should catch and handle gracefully).
 */
export async function commitReschedule(
  args: CommitRescheduleArgs,
): Promise<CommitRescheduleResult> {
  const {
    db,
    accountId,
    oldAppointment,
    newStartsAt,
    config,
    actor,
    bookedVia = 'staff',
  } = args;

  const newDoctorId = args.newDoctorId ?? oldAppointment.doctor_id;
  const newEndsAt = new Date(
    newStartsAt.getTime() + oldAppointment.duration_minutes * 60_000,
  );

  // 1. Create new appointment
  const { data: newAppt, error: createErr } = await db
    .from('dental_appointments')
    .insert({
      account_id: accountId,
      user_id: oldAppointment.user_id,
      patient_id: oldAppointment.patient_id,
      doctor_id: newDoctorId,
      starts_at: newStartsAt.toISOString(),
      ends_at: newEndsAt.toISOString(),
      duration_minutes: oldAppointment.duration_minutes,
      status: 'confirmed',
      treatment_type: oldAppointment.treatment_type,
      notes: oldAppointment.notes,
      rescheduled_from_id: oldAppointment.id,
      confirmed_at: new Date().toISOString(),
      patient_responded: true,
      patient_response_at: new Date().toISOString(),
      booked_via: bookedVia,
      // Inherit calendar_uid so the patient's calendar updates in-place
      calendar_uid: oldAppointment.calendar_uid,
    })
    .select()
    .single();

  if (createErr) {
    // Propagate the error — the EXCLUDE constraint (23P01) will be
    // caught by the caller for graceful re-offer of availability.
    throw createErr;
  }

  // 2. Mark old appointment as rescheduled
  await db
    .from('dental_appointments')
    .update({
      status: 'rescheduled',
      rescheduled_to_id: newAppt.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', oldAppointment.id);

  // 3. Write audit for both old and new
  await db.from('dental_appointment_audit').insert([
    {
      appointment_id: oldAppointment.id,
      account_id: accountId,
      action: 'rescheduled',
      old_status: oldAppointment.status,
      new_status: 'rescheduled',
      actor,
      details: { rescheduled_to: newAppt.id },
    },
    {
      appointment_id: newAppt.id,
      account_id: accountId,
      action: 'created_from_reschedule',
      old_status: null,
      new_status: 'confirmed',
      actor,
      details: { rescheduled_from: oldAppointment.id },
    },
  ]);

  // 4. Schedule reminders for new, cancel old
  await scheduleRemindersForAppointment(db, newAppt as DentalAppointment, config);
  await cancelRemindersForAppointment(db, oldAppointment.id);

  return { newAppointment: newAppt as DentalAppointment };
}
