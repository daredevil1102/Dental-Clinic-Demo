// Dental appointments — list + create
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { dentalAdmin } from '@/lib/dental/admin-client';
import { listAppointments, createAppointment } from '@/lib/dental/appointment-service';
import type { DentalAppointmentStatus } from '@/lib/dental/types';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  // Use the service-role admin client for the query so that appointments
  // created by the AI agent (which bypasses RLS) are always visible.
  // Authentication and account membership are verified above via the
  // RLS-scoped client.
  const db = dentalAdmin();

  const { searchParams } = new URL(request.url);
  const result = await listAppointments(db, profile.account_id, {
    doctor_id: searchParams.get('doctor_id') ?? undefined,
    patient_id: searchParams.get('patient_id') ?? undefined,
    status: (searchParams.get('status') as DentalAppointmentStatus | null) ?? undefined,
    from_date: searchParams.get('from_date') ?? undefined,
    to_date: searchParams.get('to_date') ?? undefined,
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50,
    offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
  });

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  try {
    const body = await request.json();
    const appointment = await createAppointment(
      supabase, profile.account_id, user.id, body,
    );
    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create' },
      { status: 400 },
    );
  }
}

