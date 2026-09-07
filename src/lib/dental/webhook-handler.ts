// ============================================================
// Dental Clinic — Webhook Handler.
//
// Routes inbound WhatsApp interactive replies to the dental
// appointment system. Called from the main webhook processor
// when a button reply ID starts with 'dental_'.
//
// Handles:
//   dental_confirm    → confirm appointment
//   dental_cancel     → cancel appointment
//   dental_reschedule → start rescheduling flow
//   dental_date_N     → select date in reschedule flow
//   dental_slot_N     → select time slot in reschedule flow
//   dental_resched_confirm  → confirm reschedule
//   dental_resched_cancel   → cancel reschedule
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { DENTAL_BUTTON_IDS, DENTAL_BUTTON_PREFIX } from './types';
import {
  transitionAppointment,
  findActiveAppointmentForPatient,
} from './appointment-service';
import { loadClinicConfig, formatInClinicTimezone } from './config';
import { createWhatsAppService, type DentalWhatsAppService } from './whatsapp-service';
import { getNextAvailableDates, getAvailableSlots } from './availability-service';

/**
 * Check if a button reply ID belongs to the dental system.
 */
export function isDentalButtonReply(buttonId: string): boolean {
  return buttonId.startsWith(DENTAL_BUTTON_PREFIX);
}

/**
 * Handle a dental-system interactive button reply.
 * Returns true if handled, false if the button ID is not recognized.
 */
export async function handleDentalButtonReply(
  db: SupabaseClient,
  accountId: string,
  contactPhone: string,
  buttonId: string,
): Promise<boolean> {
  const config = await loadClinicConfig(db, accountId);
  const waService = createWhatsAppService(db, config.demo_mode);

  // -------------------------------------------------------
  // CONFIRM
  // -------------------------------------------------------
  if (buttonId === DENTAL_BUTTON_IDS.CONFIRM) {
    const appointment = await findActiveAppointmentForPatient(db, accountId, contactPhone);
    if (!appointment) {
      await waService.sendTextMessage({
        accountId,
        phone: contactPhone,
        text: "Sorry, we couldn't find an upcoming appointment for you. Please contact the clinic directly.",
      });
      return true;
    }

    try {
      await transitionAppointment(
        db, accountId, appointment.id, 'confirmed', 'patient',
      );

      const tz = config.clinic_timezone;
      const dateStr = formatInClinicTimezone(appointment.starts_at, tz, {
        weekday: 'long', month: 'long', day: 'numeric',
      });
      const timeStr = formatInClinicTimezone(appointment.starts_at, tz, {
        hour: '2-digit', minute: '2-digit', hour12: false,
      });

      await waService.sendTextMessage({
        accountId,
        phone: contactPhone,
        text:
          `✅ Your appointment has been confirmed!\n\n` +
          `📅 ${dateStr} at ${timeStr}\n` +
          `👨‍⚕️ Dr. ${appointment.doctor?.full_name}\n` +
          `📍 ${config.clinic_name}\n\n` +
          `See you then! If you need to make changes, please contact us.`,
      });
    } catch (err) {
      console.error('[dental] confirm failed:', err);
      await waService.sendTextMessage({
        accountId,
        phone: contactPhone,
        text: "Sorry, we couldn't confirm your appointment. Please try again or contact the clinic.",
      });
    }
    return true;
  }

  // -------------------------------------------------------
  // CANCEL
  // -------------------------------------------------------
  if (buttonId === DENTAL_BUTTON_IDS.CANCEL) {
    const appointment = await findActiveAppointmentForPatient(db, accountId, contactPhone);
    if (!appointment) {
      await waService.sendTextMessage({
        accountId,
        phone: contactPhone,
        text: "Sorry, we couldn't find an upcoming appointment to cancel.",
      });
      return true;
    }

    try {
      await transitionAppointment(
        db, accountId, appointment.id, 'cancelled', 'patient',
        { reason: 'Patient cancelled via WhatsApp' },
      );

      await waService.sendTextMessage({
        accountId,
        phone: contactPhone,
        text:
          `❌ Your appointment has been cancelled.\n\n` +
          `If you'd like to book a new appointment, please contact ${config.clinic_name}.`,
      });
    } catch (err) {
      console.error('[dental] cancel failed:', err);
    }
    return true;
  }

  // -------------------------------------------------------
  // RESCHEDULE — Start
  // -------------------------------------------------------
  if (buttonId === DENTAL_BUTTON_IDS.RESCHEDULE) {
    const appointment = await findActiveAppointmentForPatient(db, accountId, contactPhone);
    if (!appointment || !appointment.doctor) {
      await waService.sendTextMessage({
        accountId,
        phone: contactPhone,
        text: "Sorry, we couldn't find an appointment to reschedule.",
      });
      return true;
    }

    try {
      await transitionAppointment(
        db, accountId, appointment.id, 'reschedule_requested', 'patient',
      );

      // Get next 3 available dates
      const dates = await getNextAvailableDates(
        db, accountId, appointment.doctor_id,
        config.clinic_timezone, 3, appointment.duration_minutes,
      );

      if (dates.length === 0) {
        await waService.sendTextMessage({
          accountId,
          phone: contactPhone,
          text: "Sorry, no available dates in the next 30 days. Please contact the clinic directly.",
        });
        return true;
      }

      // Create reschedule session
      await db.from('dental_reschedule_sessions').insert({
        appointment_id: appointment.id,
        account_id: accountId,
        patient_id: appointment.patient_id,
        step: 'date_selection',
        offered_dates: dates,
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      });

      // Send date options
      const dateButtons = dates.slice(0, 3).map((d, i) => {
        const dateObj = new Date(d + 'T12:00:00Z');
        const label = dateObj.toLocaleDateString('en-GB', {
          weekday: 'short', month: 'short', day: 'numeric',
          timeZone: config.clinic_timezone,
        });
        return { id: `${DENTAL_BUTTON_IDS.DATE_PREFIX}${i}`, title: label };
      });

      await waService.sendInteractiveButtons({
        accountId,
        phone: contactPhone,
        header: '📅 Reschedule Appointment',
        body: `Please choose a new date for your appointment with Dr. ${appointment.doctor.full_name}:`,
        footer: config.clinic_name,
        buttons: dateButtons,
      });
    } catch (err) {
      console.error('[dental] reschedule start failed:', err);
    }
    return true;
  }

  // -------------------------------------------------------
  // RESCHEDULE — Date selection
  // -------------------------------------------------------
  if (buttonId.startsWith(DENTAL_BUTTON_IDS.DATE_PREFIX)) {
    const dateIndex = parseInt(buttonId.replace(DENTAL_BUTTON_IDS.DATE_PREFIX, ''), 10);
    return await handleDateSelection(db, accountId, contactPhone, dateIndex, config, waService);
  }

  // -------------------------------------------------------
  // RESCHEDULE — Slot selection
  // -------------------------------------------------------
  if (buttonId.startsWith(DENTAL_BUTTON_IDS.SLOT_PREFIX)) {
    const slotIndex = parseInt(buttonId.replace(DENTAL_BUTTON_IDS.SLOT_PREFIX, ''), 10);
    return await handleSlotSelection(db, accountId, contactPhone, slotIndex, config, waService);
  }

  // -------------------------------------------------------
  // RESCHEDULE — Confirm
  // -------------------------------------------------------
  if (buttonId === DENTAL_BUTTON_IDS.RESCHEDULE_CONFIRM) {
    return await handleRescheduleConfirm(db, accountId, contactPhone, config, waService);
  }

  // -------------------------------------------------------
  // RESCHEDULE — Cancel
  // -------------------------------------------------------
  if (buttonId === DENTAL_BUTTON_IDS.RESCHEDULE_CANCEL) {
    // Find active session
    const { data: session } = await db
      .from('dental_reschedule_sessions')
      .select('*, appointment:dental_appointments(*)')
      .eq('account_id', accountId)
      .is('completed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (session) {
      await db
        .from('dental_reschedule_sessions')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', session.id);

      // Revert to original status if possible
      const appt = session.appointment;
      if (appt && appt.status === 'reschedule_requested') {
        await db
          .from('dental_appointments')
          .update({ status: 'reminder_sent', updated_at: new Date().toISOString() })
          .eq('id', appt.id);
      }
    }

    await waService.sendTextMessage({
      accountId,
      phone: contactPhone,
      text: 'Rescheduling cancelled. Your original appointment remains unchanged.',
    });
    return true;
  }

  return false;
}

// -------------------------------------------------------
// Reschedule helpers
// -------------------------------------------------------

async function handleDateSelection(
  db: SupabaseClient,
  accountId: string,
  contactPhone: string,
  dateIndex: number,
  config: import('./types').DentalClinicConfig,
  waService: DentalWhatsAppService,
): Promise<boolean> {
  // Find active session for this patient
  const { data: patient } = await db
    .from('dental_patients')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone', contactPhone)
    .maybeSingle();

  if (!patient) return true;

  const { data: session } = await db
    .from('dental_reschedule_sessions')
    .select('*, appointment:dental_appointments(*, doctor:dental_doctors(*))')
    .eq('account_id', accountId)
    .eq('patient_id', patient.id)
    .is('completed_at', null)
    .eq('step', 'date_selection')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session || !session.offered_dates?.[dateIndex]) {
    await waService.sendTextMessage({
      accountId,
      phone: contactPhone,
      text: 'Sorry, this rescheduling session has expired. Please start over.',
    });
    return true;
  }

  const selectedDate = session.offered_dates[dateIndex];
  const appointment = session.appointment;

  // Get available slots for this date
  const slots = await getAvailableSlots(
    db, accountId, appointment.doctor_id,
    selectedDate, selectedDate,
    config.clinic_timezone,
    appointment.duration_minutes,
  );

  const availableSlots = slots[0]?.slots.filter((s) => s.available).slice(0, 3) ?? [];

  if (availableSlots.length === 0) {
    await waService.sendTextMessage({
      accountId,
      phone: contactPhone,
      text: `No available time slots on that date. Please contact the clinic.`,
    });
    return true;
  }

  // Update session
  await db
    .from('dental_reschedule_sessions')
    .update({
      step: 'time_selection',
      selected_date: selectedDate,
      offered_slots: availableSlots.map((s) => s.time),
    })
    .eq('id', session.id);

  // Send slot options
  const slotButtons = availableSlots.map((s, i) => ({
    id: `${DENTAL_BUTTON_IDS.SLOT_PREFIX}${i}`,
    title: s.time,
  }));

  const dateLabel = new Date(selectedDate + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: config.clinic_timezone,
  });

  await waService.sendInteractiveButtons({
    accountId,
    phone: contactPhone,
    header: '🕐 Choose a Time',
    body: `Available times on ${dateLabel}:`,
    footer: config.clinic_name,
    buttons: slotButtons,
  });

  return true;
}

async function handleSlotSelection(
  db: SupabaseClient,
  accountId: string,
  contactPhone: string,
  slotIndex: number,
  config: import('./types').DentalClinicConfig,
  waService: DentalWhatsAppService,
): Promise<boolean> {
  const { data: patient } = await db
    .from('dental_patients')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone', contactPhone)
    .maybeSingle();

  if (!patient) return true;

  const { data: session } = await db
    .from('dental_reschedule_sessions')
    .select('*, appointment:dental_appointments(*, doctor:dental_doctors(*))')
    .eq('account_id', accountId)
    .eq('patient_id', patient.id)
    .is('completed_at', null)
    .eq('step', 'time_selection')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session || !session.offered_slots?.[slotIndex]) {
    await waService.sendTextMessage({
      accountId,
      phone: contactPhone,
      text: 'Sorry, this session has expired. Please start over.',
    });
    return true;
  }

  const selectedSlot = session.offered_slots[slotIndex];
  const { clinicLocalToUtc } = await import('./config');
  const newStartsAt = clinicLocalToUtc(session.selected_date, selectedSlot, config.clinic_timezone);

  // Update session
  await db
    .from('dental_reschedule_sessions')
    .update({
      step: 'confirmation',
      selected_slot: selectedSlot,
      new_starts_at: newStartsAt,
    })
    .eq('id', session.id);

  const dateLabel = new Date(session.selected_date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: config.clinic_timezone,
  });

  await waService.sendInteractiveButtons({
    accountId,
    phone: contactPhone,
    header: '✅ Confirm Reschedule',
    body:
      `Your new appointment:\n\n` +
      `📅 ${dateLabel}\n` +
      `🕐 ${selectedSlot}\n` +
      `👨‍⚕️ Dr. ${session.appointment?.doctor?.full_name}\n\n` +
      `Confirm this new time?`,
    footer: config.clinic_name,
    buttons: [
      { id: DENTAL_BUTTON_IDS.RESCHEDULE_CONFIRM, title: 'Confirm ✅' },
      { id: DENTAL_BUTTON_IDS.RESCHEDULE_CANCEL, title: 'Cancel ❌' },
    ],
  });

  return true;
}

async function handleRescheduleConfirm(
  db: SupabaseClient,
  accountId: string,
  contactPhone: string,
  config: import('./types').DentalClinicConfig,
  waService: DentalWhatsAppService,
): Promise<boolean> {
  const { data: patient } = await db
    .from('dental_patients')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone', contactPhone)
    .maybeSingle();

  if (!patient) return true;

  const { data: session } = await db
    .from('dental_reschedule_sessions')
    .select('*, appointment:dental_appointments(*, patient:dental_patients(*), doctor:dental_doctors(*))')
    .eq('account_id', accountId)
    .eq('patient_id', patient.id)
    .is('completed_at', null)
    .eq('step', 'confirmation')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session || !session.new_starts_at) {
    await waService.sendTextMessage({
      accountId,
      phone: contactPhone,
      text: 'Sorry, this session has expired. Please start over.',
    });
    return true;
  }

  const oldAppointment = session.appointment;
  const newStartsAt = new Date(session.new_starts_at);
  const newEndsAt = new Date(newStartsAt.getTime() + oldAppointment.duration_minutes * 60_000);

  try {
    // Create new appointment
    const { data: newAppt, error: createErr } = await db
      .from('dental_appointments')
      .insert({
        account_id: accountId,
        user_id: oldAppointment.user_id,
        patient_id: oldAppointment.patient_id,
        doctor_id: oldAppointment.doctor_id,
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
      })
      .select()
      .single();

    if (createErr) throw createErr;

    // Mark old appointment as rescheduled
    await db
      .from('dental_appointments')
      .update({
        status: 'rescheduled',
        rescheduled_to_id: newAppt.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', oldAppointment.id);

    // Complete the session
    await db
      .from('dental_reschedule_sessions')
      .update({ step: 'completed', completed_at: new Date().toISOString() })
      .eq('id', session.id);

    // Schedule reminders for new appointment
    const { scheduleRemindersForAppointment } = await import('./reminder-service');
    await scheduleRemindersForAppointment(db, newAppt, config);

    const dateStr = formatInClinicTimezone(session.new_starts_at, config.clinic_timezone, {
      weekday: 'long', month: 'long', day: 'numeric',
    });

    await waService.sendTextMessage({
      accountId,
      phone: contactPhone,
      text:
        `✅ Your appointment has been rescheduled!\n\n` +
        `📅 ${dateStr} at ${session.selected_slot}\n` +
        `👨‍⚕️ Dr. ${oldAppointment.doctor?.full_name}\n` +
        `📍 ${config.clinic_name}\n\n` +
        `See you then!`,
    });
  } catch (err) {
    console.error('[dental] reschedule confirm failed:', err);
    await waService.sendTextMessage({
      accountId,
      phone: contactPhone,
      text: 'Sorry, we couldn\'t complete the reschedule. The time slot may have been taken. Please try again.',
    });
  }

  return true;
}
