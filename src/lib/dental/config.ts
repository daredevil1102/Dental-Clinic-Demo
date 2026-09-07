// ============================================================
// Dental Clinic — Configuration loader & defaults.
//
// Loads the per-account dental_clinic_config row, falling back
// to sensible defaults when no row exists yet (first visit
// before settings are saved).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DentalClinicConfig } from './types';

/** Sensible defaults used when no config row exists yet. */
export const DENTAL_DEFAULTS = {
  clinic_name: 'Amsterdam Dental Care',
  clinic_timezone: 'Europe/Amsterdam',
  reminder_initial_minutes: 720,    // 12 hours
  reminder_final_minutes: 120,      // 2 hours
  reminder_followup_interval: 180,  // 3 hours
  default_duration_minutes: 30,
  demo_mode: true,
} as const;

/**
 * Load the dental clinic config for an account, creating a default
 * row if none exists. Uses the service-role client so it can be
 * called from cron/webhook paths that bypass RLS.
 */
export async function loadClinicConfig(
  db: SupabaseClient,
  accountId: string,
  userId?: string,
): Promise<DentalClinicConfig> {
  const { data, error } = await db
    .from('dental_clinic_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error('[dental] failed to load clinic config:', error);
    // Return defaults as a fallback so callers never crash
    return {
      id: '',
      account_id: accountId,
      user_id: userId ?? '',
      clinic_name: DENTAL_DEFAULTS.clinic_name,
      clinic_phone: null,
      clinic_address: null,
      clinic_timezone: DENTAL_DEFAULTS.clinic_timezone,
      reminder_initial_minutes: DENTAL_DEFAULTS.reminder_initial_minutes,
      reminder_final_minutes: DENTAL_DEFAULTS.reminder_final_minutes,
      reminder_followup_interval: DENTAL_DEFAULTS.reminder_followup_interval,
      default_duration_minutes: DENTAL_DEFAULTS.default_duration_minutes,
      demo_mode: DENTAL_DEFAULTS.demo_mode,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  if (data) return data as DentalClinicConfig;

  // No config row yet — create one with defaults (needs userId)
  if (!userId) {
    // Can't create without a user_id; return in-memory defaults
    return {
      id: '',
      account_id: accountId,
      user_id: '',
      ...DENTAL_DEFAULTS,
      clinic_phone: null,
      clinic_address: null,
      clinic_timezone: DENTAL_DEFAULTS.clinic_timezone,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const { data: created, error: createErr } = await db
    .from('dental_clinic_config')
    .insert({
      account_id: accountId,
      user_id: userId,
      ...DENTAL_DEFAULTS,
    })
    .select()
    .single();

  if (createErr) {
    console.error('[dental] failed to create default config:', createErr);
    return {
      id: '',
      account_id: accountId,
      user_id: userId,
      ...DENTAL_DEFAULTS,
      clinic_phone: null,
      clinic_address: null,
      clinic_timezone: DENTAL_DEFAULTS.clinic_timezone,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  return created as DentalClinicConfig;
}

/**
 * Format a UTC date to clinic-local display string.
 */
export function formatInClinicTimezone(
  utcDate: string | Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  return date.toLocaleString('en-GB', {
    timeZone: timezone,
    ...options,
  });
}

/**
 * Get "now" in the clinic's timezone as a Date-like reference.
 */
export function clinicNow(timezone: string): Date {
  // JavaScript Date is always UTC internally.
  // We use Intl to format, but the Date object itself stays UTC.
  return new Date();
}

/**
 * Convert a local clinic time string ("10:30") on a specific date
 * to a UTC ISO string.
 */
export function clinicLocalToUtc(
  date: string,       // "2024-01-15"
  time: string,       // "10:30"
  timezone: string,   // "Europe/Amsterdam"
): string {
  // Build the date-time string as if it were in the clinic timezone
  const dtStr = `${date}T${time}:00`;

  // Use Intl.DateTimeFormat to find the UTC offset for this timezone
  // on this specific date (handles DST correctly)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Create a temporary date to find the offset
  const tempDate = new Date(dtStr + 'Z'); // Treat as UTC first
  const parts = formatter.formatToParts(tempDate);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  // Build the date as it appears in the target timezone when input is UTC
  const utcInTz = new Date(
    `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}Z`,
  );

  // The offset is the difference between our input UTC and what it shows as in the timezone
  const offsetMs = utcInTz.getTime() - tempDate.getTime();

  // Subtract the offset to get the actual UTC time
  const actualUtc = new Date(tempDate.getTime() - offsetMs);
  return actualUtc.toISOString();
}

/**
 * Get the day-of-week key for a date in the clinic timezone.
 */
export function getDayKey(
  date: Date | string,
  timezone: string,
): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dayName = d.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).toLowerCase();

  const mapping: Record<string, 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'> = {
    mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu',
    fri: 'fri', sat: 'sat', sun: 'sun',
  };
  return mapping[dayName] ?? 'mon';
}

/**
 * Get the date string (YYYY-MM-DD) for a Date in the clinic timezone.
 */
export function getDateInTimezone(date: Date, timezone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
}
