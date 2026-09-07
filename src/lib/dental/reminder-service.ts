// ============================================================
// Dental Clinic — Reminder Service.
//
// Computes, schedules, and processes appointment reminders.
//
// Algorithm:
//   For each appointment:
//   1. Schedule initial reminder at T - 12h
//   2. Schedule follow-ups every 3h after initial
//   3. Schedule final reminder at T - 2h
//   4. Stop ALL reminders when patient responds
//   5. Never send more than 1 reminder in any 2h window
//
// The cron job calls `processDueReminders()` which finds all
// pending reminders with scheduled_at <= now and sends them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DentalAppointment,
  DentalAppointmentReminder,
  DentalClinicConfig,
  DentalReminderType,
} from './types';
import { loadClinicConfig, formatInClinicTimezone } from './config';
import { transitionAppointment } from './appointment-service';
import { sendAppointmentReminder, type DentalWhatsAppService } from './whatsapp-service';

// -------------------------------------------------------
// Schedule reminders for a new appointment
// -------------------------------------------------------

export async function scheduleRemindersForAppointment(
  db: SupabaseClient,
  appointment: DentalAppointment,
  config: DentalClinicConfig,
): Promise<void> {
  const startsAt = new Date(appointment.starts_at).getTime();
  const now = Date.now();

  const initialMs = config.reminder_initial_minutes * 60_000;
  const finalMs = config.reminder_final_minutes * 60_000;
  const followUpMs = config.reminder_followup_interval * 60_000;

  const reminders: Array<{
    appointment_id: string;
    account_id: string;
    reminder_type: DentalReminderType;
    scheduled_at: string;
    sequence_number: number;
  }> = [];

  let seq = 0;

  // 1. Initial reminder (T - 12h)
  const initialTime = startsAt - initialMs;
  if (initialTime > now) {
    reminders.push({
      appointment_id: appointment.id,
      account_id: appointment.account_id,
      reminder_type: 'initial_12h',
      scheduled_at: new Date(initialTime).toISOString(),
      sequence_number: seq++,
    });
  }

  // 2. Follow-ups every 3h after initial, until 2h before appointment
  if (initialMs > finalMs) {
    let followUpTime = initialTime + followUpMs;
    const latestFollowUp = startsAt - finalMs;

    while (followUpTime < latestFollowUp) {
      if (followUpTime > now) {
        reminders.push({
          appointment_id: appointment.id,
          account_id: appointment.account_id,
          reminder_type: 'follow_up',
          scheduled_at: new Date(followUpTime).toISOString(),
          sequence_number: seq++,
        });
      }
      followUpTime += followUpMs;
    }
  }

  // 3. Final reminder (T - 2h)
  const finalTime = startsAt - finalMs;
  if (finalTime > now) {
    reminders.push({
      appointment_id: appointment.id,
      account_id: appointment.account_id,
      reminder_type: 'final_2h',
      scheduled_at: new Date(finalTime).toISOString(),
      sequence_number: seq++,
    });
  }

  // If appointment is less than 2h away but still in future, schedule one immediate reminder
  if (reminders.length === 0 && startsAt > now) {
    reminders.push({
      appointment_id: appointment.id,
      account_id: appointment.account_id,
      reminder_type: 'initial_12h',
      scheduled_at: new Date(now + 60_000).toISOString(), // 1 minute from now
      sequence_number: 0,
    });
  }

  if (reminders.length === 0) return;

  const { error } = await db.from('dental_appointment_reminders').insert(reminders);

  if (error) {
    console.error('[dental] failed to schedule reminders:', error);
  } else {
    console.log(
      `[dental] scheduled ${reminders.length} reminders for appointment ${appointment.id}`,
    );
  }
}

// -------------------------------------------------------
// Cancel all pending reminders for an appointment
// (called when patient responds)
// -------------------------------------------------------

export async function cancelRemindersForAppointment(
  db: SupabaseClient,
  appointmentId: string,
): Promise<number> {
  const { data, error } = await db
    .from('dental_appointment_reminders')
    .update({ status: 'cancelled' })
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    console.error('[dental] failed to cancel reminders:', error);
    return 0;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    console.log(`[dental] cancelled ${count} pending reminders for ${appointmentId}`);
  }
  return count;
}

// -------------------------------------------------------
// Process due reminders (called by cron job)
// -------------------------------------------------------

export async function processDueReminders(
  db: SupabaseClient,
  waService: DentalWhatsAppService,
): Promise<{ processed: number; failed: number }> {
  const now = new Date().toISOString();

  // Fetch all pending reminders that are due
  const { data: dueReminders, error } = await db
    .from('dental_appointment_reminders')
    .select(`
      *,
      appointment:dental_appointments(
        *,
        patient:dental_patients(*),
        doctor:dental_doctors(*)
      )
    `)
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[dental] failed to fetch due reminders:', error);
    return { processed: 0, failed: 0 };
  }

  if (!dueReminders || dueReminders.length === 0) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const reminder of dueReminders) {
    const appointment = reminder.appointment as unknown as DentalAppointment;

    // Skip if appointment is no longer in a remindable state
    if (!appointment || appointment.patient_responded) {
      await db
        .from('dental_appointment_reminders')
        .update({ status: 'cancelled' })
        .eq('id', reminder.id);
      continue;
    }

    // Skip if appointment status is terminal
    const remindableStatuses = ['scheduled', 'reminder_sent'];
    if (!remindableStatuses.includes(appointment.status)) {
      await db
        .from('dental_appointment_reminders')
        .update({ status: 'cancelled' })
        .eq('id', reminder.id);
      continue;
    }

    try {
      // Load config for this account
      const config = await loadClinicConfig(db, appointment.account_id);

      // Send the WhatsApp reminder
      const result = await sendAppointmentReminder(
        db,
        waService,
        appointment,
        reminder as unknown as DentalAppointmentReminder,
        config,
      );

      // Mark reminder as sent
      await db
        .from('dental_appointment_reminders')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: result.messageId ?? null,
        })
        .eq('id', reminder.id);

      // Transition appointment to reminder_sent (if first reminder)
      if (appointment.status === 'scheduled') {
        try {
          await transitionAppointment(
            db,
            appointment.account_id,
            appointment.id,
            'reminder_sent',
            'system',
            { reminder_id: reminder.id, reminder_type: reminder.reminder_type },
          );
        } catch {
          // Non-critical — the appointment might already be in reminder_sent
        }
      }

      // Log the message
      await db.from('dental_message_log').insert({
        account_id: appointment.account_id,
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        direction: 'outbound',
        message_type: 'interactive',
        content: result.messageText,
        whatsapp_message_id: result.messageId,
        mock_mode: config.demo_mode,
      });

      processed++;
    } catch (err) {
      console.error('[dental] reminder send failed:', reminder.id, err);
      await db
        .from('dental_appointment_reminders')
        .update({
          status: 'failed',
          error_message: err instanceof Error ? err.message : 'Unknown error',
        })
        .eq('id', reminder.id);
      failed++;
    }
  }

  return { processed, failed };
}
