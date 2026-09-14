// .ics file download for a dental appointment.
//
// Public endpoint — no auth required. The patient receives this
// link in their WhatsApp confirmation message and clicks it to
// add the appointment to their calendar app.
//
// The appointment ID in the URL provides sufficient access control:
//   - IDs are UUIDv4 (unguessable)
//   - The .ics contains only the patient's own appointment
//   - No PII beyond what's in the calendar event itself

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { generateIcs } from '@/lib/dental/calendar';
import { loadClinicConfig } from '@/lib/dental/config';
import type { DentalAppointment } from '@/lib/dental/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = supabaseAdmin();

  // Load the appointment with doctor join
  const { data: appointment, error } = await db
    .from('dental_appointments')
    .select('*, doctor:dental_doctors(*)')
    .eq('id', id)
    .maybeSingle();

  if (error || !appointment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const config = await loadClinicConfig(db, appointment.account_id);
  const icsContent = generateIcs(appointment as DentalAppointment, config);

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointment-${id}.ics"`,
      // Allow caching for 5 minutes — if the appointment is rescheduled
      // the UID stays the same but the content changes, so short TTL.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
