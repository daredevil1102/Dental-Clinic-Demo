// ============================================================
// Dental Agent — Webhook dispatch entry point.
//
// Called from process-webhook.ts when:
//   1. The message is free text (not an interactive button reply)
//   2. No Flow consumed it
//   3. No dental button handler consumed it
//
// Does a cheap early-exit if the account doesn't have the dental
// agent enabled. Non-dental accounts pay only one indexed
// maybeSingle() query.
//
// Returns true if the message was consumed (suppresses automations
// and generic AI auto-reply), false otherwise.
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { runAgentTurn } from './engine';
import type { AgentContext } from './types';

export interface DispatchArgs {
  accountId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  text: string;
  configOwnerUserId: string;
  /** WhatsApp message ID for idempotency. */
  waMessageId?: string;
}

/**
 * Entry point for the dental AI receptionist.
 *
 * Cheap early-exit pattern: one indexed query on dental_clinic_config.
 * If agent_enabled is false (or no row), returns false immediately.
 * Non-dental tenants pay ~1ms for this check.
 */
export async function dispatchInboundToDentalAgent(
  args: DispatchArgs,
): Promise<boolean> {
  const {
    accountId,
    conversationId,
    contactId,
    phone,
    text,
    configOwnerUserId,
    waMessageId,
  } = args;

  // Don't process empty messages
  if (!text.trim()) return false;

  const db = supabaseAdmin();

  // -------------------------------------------------------
  // 1. Cheap feature-flag check
  // -------------------------------------------------------
  const { data: config } = await db
    .from('dental_clinic_config')
    .select('agent_enabled')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!config?.agent_enabled) return false;

  // -------------------------------------------------------
  // 2. Rate limit check (per-account)
  // -------------------------------------------------------
  const rateCheck = checkRateLimit(
    `dental-agent:${accountId}`,
    RATE_LIMITS.aiAutoReplyAccount, // Reuse the same per-account AI budget
  );

  if (!rateCheck.success) {
    console.warn(
      `[dental agent] account ${accountId} hit rate limit — skipping this inbound`,
    );
    return false;
  }

  // -------------------------------------------------------
  // 3. Run the agent turn
  // -------------------------------------------------------
  try {
    const ctx: AgentContext = {
      accountId,
      conversationId,
      contactId,
      phone,
      configOwnerUserId,
    };

    const result = await runAgentTurn(
      db,
      ctx,
      text,
      waMessageId ?? `unknown_${Date.now()}`,
    );

    if (!result.consumed) return false;

    // -------------------------------------------------------
    // 4. Send the reply via WhatsApp
    // -------------------------------------------------------
    if (result.reply) {
      const { loadClinicConfig } = await import('../config');
      const { createWhatsAppService } = await import('../whatsapp-service');

      const clinicConfig = await loadClinicConfig(db, accountId, configOwnerUserId);
      const waService = createWhatsAppService(db, clinicConfig.demo_mode);

      await waService.sendTextMessage({
        accountId,
        phone,
        text: result.reply,
      });

      // Log the message
      const { data: patient } = await db
        .from('dental_patients')
        .select('id')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .maybeSingle();

      await db.from('dental_message_log').insert({
        account_id: accountId,
        patient_id: patient?.id ?? null,
        direction: 'outbound',
        message_type: 'text',
        content: result.reply,
        mock_mode: clinicConfig.demo_mode,
      });
    }

    return true;
  } catch (err) {
    // The dispatch must NEVER throw — same contract as the flow runner
    // and AI auto-reply. A failing agent must not break the webhook's
    // 200 response to Meta.
    console.error('[dental agent] dispatch failed:', err);
    return false;
  }
}
