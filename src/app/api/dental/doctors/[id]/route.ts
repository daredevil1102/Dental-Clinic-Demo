// Individual doctor — get, update
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  const { data, error } = await supabase
    .from('dental_doctors')
    .select('*')
    .eq('id', id)
    .eq('account_id', profile.account_id)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
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

  const body = await request.json();
  const { data, error } = await supabase
    .from('dental_doctors')
    .update({
      ...(body.full_name !== undefined && { full_name: body.full_name }),
      ...(body.specialization !== undefined && { specialization: body.specialization }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.is_active !== undefined && { is_active: body.is_active }),
      ...(body.default_hours !== undefined && { default_hours: body.default_hours }),
      ...(body.slot_duration_minutes !== undefined && { slot_duration_minutes: body.slot_duration_minutes }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('account_id', profile.account_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
