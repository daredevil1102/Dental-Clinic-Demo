// Doctor availability overrides — get, put
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
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

  const { searchParams } = new URL(request.url);
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  let query = supabase
    .from('dental_doctor_availability')
    .select('*')
    .eq('doctor_id', id)
    .eq('account_id', profile.account_id)
    .order('available_date');

  if (fromDate) query = query.gte('available_date', fromDate);
  if (toDate) query = query.lte('available_date', toDate);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(
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
  // Expects: { available_date, start_time, end_time, breaks?, reason? }
  const { data, error } = await supabase
    .from('dental_doctor_availability')
    .upsert({
      doctor_id: id,
      account_id: profile.account_id,
      available_date: body.available_date,
      start_time: body.start_time ?? null,
      end_time: body.end_time ?? null,
      breaks: body.breaks ?? [],
      reason: body.reason ?? null,
    }, { onConflict: 'doctor_id,available_date' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
