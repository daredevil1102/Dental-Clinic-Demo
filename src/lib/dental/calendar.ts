// ============================================================
// Dental Clinic — Calendar link + .ics generation.
//
// Provides:
//   1. Google Calendar deep link (gcal:// URL scheme)
//   2. .ics file content for universal calendar compatibility
//   3. Stable UID that survives reschedules (update-in-place)
//
// Constraints from the prompt:
//   - R3/R12: Calendar link = shareable deep link + .ics, NOT OAuth
//   - Calendar UID persists across reschedules so the patient's
//     calendar updates the event rather than creating a duplicate
//   - All times are UTC internally, presented in clinic timezone
// ============================================================

import type { DentalAppointment, DentalClinicConfig } from './types';
import { formatInClinicTimezone } from './config';

/**
 * Build a Google Calendar deep link for an appointment.
 *
 * The link works without OAuth — it opens Google Calendar's
 * event creation page pre-filled with the appointment details.
 */
export function buildGoogleCalendarLink(
  appointment: DentalAppointment,
  config: DentalClinicConfig,
): string {
  const startsAt = new Date(appointment.starts_at);
  const endsAt = new Date(appointment.ends_at);

  // Google Calendar expects dates in YYYYMMDDTHHmmSSZ format
  const formatGcal = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const title = encodeURIComponent(
    `🦷 ${appointment.treatment_type ?? 'Dental Appointment'} — ${config.clinic_name}`,
  );

  const doctorName = appointment.doctor?.full_name ?? 'your provider';
  const dateStr = formatInClinicTimezone(appointment.starts_at, config.clinic_timezone, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = formatInClinicTimezone(appointment.starts_at, config.clinic_timezone, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const details = encodeURIComponent(
    `Appointment with Dr. ${doctorName}\n` +
    `${dateStr} at ${timeStr}\n` +
    `Duration: ${appointment.duration_minutes} minutes\n\n` +
    `${config.clinic_name}` +
    (config.clinic_phone ? `\nPhone: ${config.clinic_phone}` : ''),
  );

  const location = encodeURIComponent(config.clinic_address ?? config.clinic_name);

  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${title}` +
    `&dates=${formatGcal(startsAt)}/${formatGcal(endsAt)}` +
    `&details=${details}` +
    `&location=${location}`
  );
}

/**
 * Generate an .ics (iCalendar) file content for an appointment.
 *
 * Uses the appointment's `calendar_uid` for the VEVENT UID, so
 * rescheduled appointments produce an event update (not a duplicate).
 * The SEQUENCE counter increments when rescheduled_from_id is set.
 */
export function generateIcs(
  appointment: DentalAppointment,
  config: DentalClinicConfig,
): string {
  const uid = appointment.calendar_uid ??
    `dental-${appointment.id}@${config.clinic_name.replace(/\s+/g, '-').toLowerCase()}`;

  const formatIcal = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const startsAt = new Date(appointment.starts_at);
  const endsAt = new Date(appointment.ends_at);
  const now = new Date();

  const doctorName = appointment.doctor?.full_name ?? 'Provider';
  const summary = appointment.treatment_type
    ? `${appointment.treatment_type} — ${config.clinic_name}`
    : `Dental Appointment — ${config.clinic_name}`;

  const description =
    `Appointment with Dr. ${doctorName}\\n` +
    `Duration: ${appointment.duration_minutes} minutes\\n` +
    `${config.clinic_name}` +
    (config.clinic_phone ? `\\nPhone: ${config.clinic_phone}` : '');

  const location = config.clinic_address ?? config.clinic_name;

  // SEQUENCE increments when rescheduled (so the calendar updates in-place)
  const sequence = appointment.rescheduled_from_id ? 1 : 0;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dental Clinic//WACRM//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcal(now)}`,
    `DTSTART:${formatIcal(startsAt)}`,
    `DTEND:${formatIcal(endsAt)}`,
    `SUMMARY:${escapeIcal(summary)}`,
    `DESCRIPTION:${escapeIcal(description)}`,
    `LOCATION:${escapeIcal(location)}`,
    `SEQUENCE:${sequence}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Dental appointment reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

/**
 * Build both calendar link formats for an appointment.
 *
 * Returns the Google Calendar deep link and the .ics download URL.
 * The .ics URL points to the API route that serves the generated file.
 */
export function buildCalendarLinks(
  appointment: DentalAppointment,
  config: DentalClinicConfig,
  baseUrl?: string,
): {
  googleCalendar: string;
  icsDownload: string;
} {
  const googleCalendar = buildGoogleCalendarLink(appointment, config);
  const base = baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const icsDownload = `${base}/api/dental/appointments/${appointment.id}/ics`;

  return { googleCalendar, icsDownload };
}

/**
 * Format calendar links as a WhatsApp-friendly text snippet.
 */
export function formatCalendarLinksForWhatsApp(
  appointment: DentalAppointment,
  config: DentalClinicConfig,
): string {
  const links = buildCalendarLinks(appointment, config);
  return (
    `📅 Add to your calendar:\n` +
    `• Google Calendar: ${links.googleCalendar}\n` +
    `• Download .ics: ${links.icsDownload}`
  );
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

/** Escape special characters for iCalendar text values. */
function escapeIcal(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
