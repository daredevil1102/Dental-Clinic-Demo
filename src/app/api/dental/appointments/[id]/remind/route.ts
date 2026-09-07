// Manual remind trigger for a specific appointment
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAppointment } from '@/lib/dental/appointment-service';
import { loadClinicConfig } from '@/lib/dental/config';
import { createWhatsAppService, sendAppointmentReminder } from '@/lib/dental/whatsapp-service';
import type { DentalAppointmentReminder } from '@/lib/dental/types';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const appointment = await getAppointment(supabase, profile.account_id, id);
  if (!appointment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!['scheduled', 'reminder_sent'].includes(appointment.status)) {
    return NextResponse.json(
      { error: `Cannot send reminder — appointment is ${appointment.status}` },
      { status: 400 },
    );
  }

  const config = await loadClinicConfig(supabase, profile.account_id, user.id);
  const waService = createWhatsAppService(supabase, config.demo_mode);

  // Create an ad-hoc reminder record
  const fakeReminder: DentalAppointmentReminder = {
    id: crypto.randomUUID(),
    appointment_id: appointment.id,
    account_id: profile.account_id,
    reminder_type: 'follow_up',
    status: 'pending',
    scheduled_at: new Date().toISOString(),
    sent_at: null,
    delivered_at: null,
    whatsapp_message_id: null,
    error_message: null,
    sequence_number: appointment.reminder_count,
    created_at: new Date().toISOString(),
  };

  try {
    const result = await sendAppointmentReminder(
      supabase, waService, appointment, fakeReminder, config,
    );
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Send failed' },
      { status: 500 },
    );
  }
}
