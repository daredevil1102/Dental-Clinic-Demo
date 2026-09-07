// Clinic config — get + update
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadClinicConfig } from '@/lib/dental/config';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const config = await loadClinicConfig(supabase, profile.account_id, user.id);
  return NextResponse.json(config);
}

export async function PUT(request: Request) {
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
    .from('dental_clinic_config')
    .upsert({
      account_id: profile.account_id,
      user_id: user.id,
      ...body,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
