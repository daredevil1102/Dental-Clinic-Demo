// Availability — query open slots
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAvailableSlots } from '@/lib/dental/availability-service';
import { loadClinicConfig } from '@/lib/dental/config';

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

  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctor_id');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  if (!doctorId || !fromDate || !toDate) {
    return NextResponse.json(
      { error: 'doctor_id, from_date, to_date are required' },
      { status: 400 },
    );
  }

  const config = await loadClinicConfig(supabase, profile.account_id, user.id);

  try {
    const slots = await getAvailableSlots(
      supabase,
      profile.account_id,
      doctorId,
      fromDate,
      toDate,
      config.clinic_timezone,
      config.default_duration_minutes,
    );
    return NextResponse.json(slots);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 400 },
    );
  }
}
