// Individual appointment — get, update, delete
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAppointment, transitionAppointment } from '@/lib/dental/appointment-service';

export async function GET(
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

  return NextResponse.json(appointment);
}

export async function PATCH(
  request: Request,
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

  try {
    const body = await request.json();
    if (body.status) {
      const updated = await transitionAppointment(
        supabase, profile.account_id, id, body.status, user.id, body,
      );
      return NextResponse.json(updated);
    }

    // Simple field update (notes, treatment_type)
    const { data, error } = await supabase
      .from('dental_appointments')
      .update({
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.treatment_type !== undefined && { treatment_type: body.treatment_type }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .select('*, patient:dental_patients(*), doctor:dental_doctors(*)')
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 400 },
    );
  }
}
