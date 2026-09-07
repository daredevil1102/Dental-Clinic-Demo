// ============================================================
// Dental Clinic — Cron endpoint.
//
// Processes due appointment reminders + auto-completes past
// appointments. Secured by DENTAL_CRON_SECRET header (same
// pattern as /api/automations/cron).
//
// Hit this endpoint on a schedule:
//   GET /api/dental/cron
//   Header: x-cron-secret: <DENTAL_CRON_SECRET>
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { dentalAdmin } from '@/lib/dental/admin-client';
import { processDueReminders } from '@/lib/dental/reminder-service';
import { autoCompleteAppointments } from '@/lib/dental/appointment-service';
import { loadClinicConfig } from '@/lib/dental/config';
import { createWhatsAppService } from '@/lib/dental/whatsapp-service';

export const maxDuration = 30;

export async function GET(request: Request) {
  // Use DENTAL_CRON_SECRET or fall back to AUTOMATION_CRON_SECRET
  const expected = process.env.DENTAL_CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);

  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = dentalAdmin();

  try {
    // 1. Get all accounts that have dental config
    const { data: configs } = await db
      .from('dental_clinic_config')
      .select('account_id, user_id');

    let totalProcessed = 0;
    let totalFailed = 0;

    if (configs && configs.length > 0) {
      for (const cfg of configs) {
        const config = await loadClinicConfig(db, cfg.account_id, cfg.user_id);
        const waService = createWhatsAppService(db, config.demo_mode);

        const result = await processDueReminders(db, waService);
        totalProcessed += result.processed;
        totalFailed += result.failed;
      }
    } else {
      // No configs yet — still process any pending reminders (may have been seeded)
      // Create a default mock service
      const waService = createWhatsAppService(db, true);
      const result = await processDueReminders(db, waService);
      totalProcessed += result.processed;
      totalFailed += result.failed;
    }

    // 2. Auto-complete past appointments
    const autoCompleted = await autoCompleteAppointments(db);

    return NextResponse.json({
      ok: true,
      reminders_processed: totalProcessed,
      reminders_failed: totalFailed,
      auto_completed: autoCompleted,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[dental:cron] error:', error);
    return NextResponse.json(
      { error: 'Internal error', details: String(error) },
      { status: 500 },
    );
  }
}
