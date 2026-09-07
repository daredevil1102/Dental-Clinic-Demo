// ============================================================
// Dental Clinic — Availability Service.
//
// Calculates available appointment slots for a doctor on a
// given date, considering:
//   1. Default weekly hours (from dental_doctors.default_hours)
//   2. Per-day overrides (dental_doctor_availability)
//   3. Breaks (lunch, etc.)
//   4. Existing booked appointments
//   5. Slot duration
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DentalDoctor, DayAvailability, AvailableSlot } from './types';
import { getDayKey, clinicLocalToUtc, getDateInTimezone } from './config';

/**
 * Get available slots for a doctor on a range of dates.
 */
export async function getAvailableSlots(
  db: SupabaseClient,
  accountId: string,
  doctorId: string,
  fromDate: string,  // "2024-01-15"
  toDate: string,    // "2024-01-22"
  timezone: string,
  durationMinutes: number = 30,
): Promise<DayAvailability[]> {
  // Load doctor
  const { data: doctor, error: docErr } = await db
    .from('dental_doctors')
    .select('*')
    .eq('id', doctorId)
    .eq('account_id', accountId)
    .single();

  if (docErr || !doctor) {
    throw new Error('Doctor not found');
  }

  // Load overrides for the date range
  const { data: overrides } = await db
    .from('dental_doctor_availability')
    .select('*')
    .eq('doctor_id', doctorId)
    .gte('available_date', fromDate)
    .lte('available_date', toDate);

  const overrideMap = new Map(
    (overrides ?? []).map((o) => [o.available_date, o]),
  );

  // Load existing appointments for the date range
  const fromUtc = clinicLocalToUtc(fromDate, '00:00', timezone);
  const toUtc = clinicLocalToUtc(toDate, '23:59', timezone);

  const { data: appointments } = await db
    .from('dental_appointments')
    .select('starts_at, ends_at, status')
    .eq('doctor_id', doctorId)
    .eq('account_id', accountId)
    .gte('starts_at', fromUtc)
    .lte('starts_at', toUtc)
    .not('status', 'in', '("cancelled","rescheduled")');

  const bookedSlots = (appointments ?? []).map((a) => ({
    start: new Date(a.starts_at).getTime(),
    end: new Date(a.ends_at).getTime(),
  }));

  // Generate days
  const days: DayAvailability[] = [];
  const current = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(toDate + 'T00:00:00Z');

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const dayName = current.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });

    const dayKey = getDayKey(current, 'UTC');
    const override = overrideMap.get(dateStr);

    let dayStart: string | null = null;
    let dayEnd: string | null = null;
    let breaks: Array<{ start: string; end: string }> = [];

    if (override) {
      // Use override
      dayStart = override.start_time;
      dayEnd = override.end_time;
      breaks = override.breaks ?? [];
    } else {
      // Use default hours
      const defaultDay = (doctor as DentalDoctor).default_hours[dayKey];
      if (defaultDay) {
        dayStart = defaultDay.start;
        dayEnd = defaultDay.end;
      }
    }

    if (!dayStart || !dayEnd) {
      // Day off
      days.push({ date: dateStr, day_name: dayName, slots: [] });
      current.setUTCDate(current.getUTCDate() + 1);
      continue;
    }

    // Generate time slots
    const slots = generateSlots(
      dateStr,
      dayStart,
      dayEnd,
      breaks,
      durationMinutes,
      timezone,
      bookedSlots,
    );

    days.push({ date: dateStr, day_name: dayName, slots });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

/**
 * Generate time slots for a single day.
 */
function generateSlots(
  dateStr: string,
  dayStart: string,
  dayEnd: string,
  breaks: Array<{ start: string; end: string }>,
  durationMinutes: number,
  timezone: string,
  bookedSlots: Array<{ start: number; end: number }>,
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];

  const startMinutes = timeToMinutes(dayStart);
  const endMinutes = timeToMinutes(dayEnd);
  const now = Date.now();

  for (let m = startMinutes; m + durationMinutes <= endMinutes; m += durationMinutes) {
    const timeStr = minutesToTime(m);
    const slotEndStr = minutesToTime(m + durationMinutes);

    // Check if slot overlaps with a break
    const inBreak = breaks.some((b) => {
      const breakStart = timeToMinutes(b.start);
      const breakEnd = timeToMinutes(b.end);
      return m < breakEnd && m + durationMinutes > breakStart;
    });

    if (inBreak) continue;

    // Convert to UTC for comparison
    const slotUtcStart = clinicLocalToUtc(dateStr, timeStr, timezone);
    const slotUtcEnd = clinicLocalToUtc(dateStr, slotEndStr, timezone);
    const slotStartMs = new Date(slotUtcStart).getTime();
    const slotEndMs = new Date(slotUtcEnd).getTime();

    // Skip past slots
    if (slotStartMs < now) {
      continue;
    }

    // Check if overlaps with any booked appointment
    const isBooked = bookedSlots.some(
      (b) => slotStartMs < b.end && slotEndMs > b.start,
    );

    slots.push({
      time: timeStr,
      datetime: slotUtcStart,
      available: !isBooked,
    });
  }

  return slots;
}

/**
 * Convert "09:30" to minutes since midnight (570).
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert minutes since midnight to "09:30".
 */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Get the next N available dates with at least one open slot.
 */
export async function getNextAvailableDates(
  db: SupabaseClient,
  accountId: string,
  doctorId: string,
  timezone: string,
  count: number = 3,
  durationMinutes: number = 30,
): Promise<string[]> {
  const dates: string[] = [];
  const today = new Date();
  const maxDaysAhead = 30;

  for (let i = 1; i <= maxDaysAhead && dates.length < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = getDateInTimezone(d, timezone);

    const availability = await getAvailableSlots(
      db,
      accountId,
      doctorId,
      dateStr,
      dateStr,
      timezone,
      durationMinutes,
    );

    if (availability[0]?.slots.some((s) => s.available)) {
      dates.push(dateStr);
    }
  }

  return dates;
}
