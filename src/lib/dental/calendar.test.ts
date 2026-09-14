import { describe, it, expect } from 'vitest'
import {
  buildGoogleCalendarLink,
  generateIcs,
  buildCalendarLinks,
  formatCalendarLinksForWhatsApp,
} from './calendar'
import type { DentalAppointment, DentalClinicConfig } from './types'

const mockConfig: DentalClinicConfig = {
  id: 'cfg-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  clinic_name: 'Amsterdam Dental Care',
  clinic_phone: '+31612345678',
  clinic_address: '123 Keizersgracht, Amsterdam',
  clinic_timezone: 'Europe/Amsterdam',
  reminder_initial_minutes: 720,
  reminder_final_minutes: 120,
  reminder_followup_interval: 180,
  default_duration_minutes: 30,
  demo_mode: true,
  agent_enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const mockAppointment: DentalAppointment = {
  id: 'appt-123',
  account_id: 'acct-1',
  user_id: 'user-1',
  patient_id: 'pat-1',
  doctor_id: 'doc-1',
  starts_at: '2024-02-15T09:00:00Z',
  ends_at: '2024-02-15T09:30:00Z',
  duration_minutes: 30,
  status: 'confirmed',
  treatment_type: 'Cleaning',
  notes: null,
  confirmed_at: '2024-02-10T12:00:00Z',
  cancelled_at: null,
  cancellation_reason: null,
  completed_at: null,
  conversation_id: null,
  rescheduled_from_id: null,
  rescheduled_to_id: null,
  last_reminder_sent_at: null,
  reminder_count: 0,
  patient_responded: true,
  patient_response_at: '2024-02-10T12:00:00Z',
  booked_via: 'agent',
  calendar_uid: 'dental-appt-123@amsterdam-dental-care',
  created_at: '2024-02-10T12:00:00Z',
  updated_at: '2024-02-10T12:00:00Z',
  doctor: {
    id: 'doc-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    full_name: 'Van der Berg',
    specialization: 'General Dentistry',
    phone: null,
    email: null,
    avatar_url: null,
    is_active: true,
    default_hours: {
      mon: { start: '09:00', end: '17:00' },
      tue: { start: '09:00', end: '17:00' },
      wed: { start: '09:00', end: '17:00' },
      thu: { start: '09:00', end: '17:00' },
      fri: { start: '09:00', end: '17:00' },
      sat: null,
      sun: null,
    },
    slot_duration_minutes: 30,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
}

describe('buildGoogleCalendarLink', () => {
  it('builds a valid Google Calendar URL', () => {
    const link = buildGoogleCalendarLink(mockAppointment, mockConfig)
    expect(link).toContain('https://calendar.google.com/calendar/render')
    expect(link).toContain('action=TEMPLATE')
    expect(link).toContain('dates=')
    expect(link).toContain('Cleaning')
    expect(link).toContain('Amsterdam%20Dental%20Care')
  })

  it('includes clinic address as location', () => {
    const link = buildGoogleCalendarLink(mockAppointment, mockConfig)
    expect(link).toContain('location=')
    expect(link).toContain('Keizersgracht')
  })

  it('handles missing treatment_type', () => {
    const appt = { ...mockAppointment, treatment_type: null }
    const link = buildGoogleCalendarLink(appt, mockConfig)
    expect(link).toContain('Dental%20Appointment')
  })
})

describe('generateIcs', () => {
  it('generates valid iCalendar content', () => {
    const ics = generateIcs(mockAppointment, mockConfig)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
  })

  it('uses the appointment calendar_uid', () => {
    const ics = generateIcs(mockAppointment, mockConfig)
    expect(ics).toContain('UID:dental-appt-123@amsterdam-dental-care')
  })

  it('generates a fallback UID when calendar_uid is null', () => {
    const appt = { ...mockAppointment, calendar_uid: null }
    const ics = generateIcs(appt, mockConfig)
    expect(ics).toContain('UID:dental-appt-123@')
  })

  it('sets SEQUENCE:0 for original appointments', () => {
    const ics = generateIcs(mockAppointment, mockConfig)
    expect(ics).toContain('SEQUENCE:0')
  })

  it('sets SEQUENCE:1 for rescheduled appointments', () => {
    const appt = { ...mockAppointment, rescheduled_from_id: 'old-appt-1' }
    const ics = generateIcs(appt, mockConfig)
    expect(ics).toContain('SEQUENCE:1')
  })

  it('includes a 2h alarm', () => {
    const ics = generateIcs(mockAppointment, mockConfig)
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('TRIGGER:-PT2H')
  })

  it('includes doctor name in description', () => {
    const ics = generateIcs(mockAppointment, mockConfig)
    expect(ics).toContain('Van der Berg')
  })
})

describe('buildCalendarLinks', () => {
  it('returns both Google Calendar and ICS links', () => {
    const links = buildCalendarLinks(mockAppointment, mockConfig, 'https://example.com')
    expect(links.googleCalendar).toContain('calendar.google.com')
    expect(links.icsDownload).toBe('https://example.com/api/dental/appointments/appt-123/ics')
  })
})

describe('formatCalendarLinksForWhatsApp', () => {
  it('formats links as a readable WhatsApp snippet', () => {
    const text = formatCalendarLinksForWhatsApp(mockAppointment, mockConfig)
    expect(text).toContain('📅 Add to your calendar')
    expect(text).toContain('Google Calendar')
    expect(text).toContain('.ics')
  })
})
