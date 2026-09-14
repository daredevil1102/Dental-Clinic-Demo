// ============================================================
// Dental Agent — Session management.
//
// CRUD operations for dental_agent_sessions. Handles creation,
// loading, updating, expiry detection, and cleanup.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DentalAgentSession,
  DentalAgentState,
  DentalAgentIntent,
  DentalAgentSessionSlots,
} from '../types';

/** Session timeout in milliseconds (30 minutes). */
const SESSION_TIMEOUT_MS = 30 * 60_000;

/** Maximum number of LLM conversation turns stored per session. */
const MAX_SESSION_MESSAGES = 20;

/**
 * Load the active (non-completed, non-expired) session for a phone+account.
 * Returns null if no active session exists.
 */
export async function loadActiveSession(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<DentalAgentSession | null> {
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('dental_agent_sessions')
    .select('*')
    .eq('account_id', accountId)
    .eq('phone', phone)
    .is('completed_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[dental agent] loadActiveSession error:', error);
    return null;
  }

  return data as DentalAgentSession | null;
}

/**
 * Create a new agent session for this phone+account.
 * Automatically completes any prior active sessions.
 */
export async function createSession(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  conversationId: string,
  patientId: string | null,
): Promise<DentalAgentSession> {
  // Complete any prior active sessions for this phone+account
  await db
    .from('dental_agent_sessions')
    .update({
      state: 'expired',
      completed_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('phone', phone)
    .is('completed_at', null);

  const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString();

  const { data, error } = await db
    .from('dental_agent_sessions')
    .insert({
      account_id: accountId,
      phone,
      conversation_id: conversationId,
      patient_id: patientId,
      state: 'awaiting_intent',
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create agent session: ${error.message}`);
  }

  return data as DentalAgentSession;
}

/**
 * Update an existing session's state, intent, slots, messages, etc.
 * Also refreshes the expires_at timestamp (session activity = more time).
 */
export async function updateSession(
  db: SupabaseClient,
  sessionId: string,
  updates: {
    state?: DentalAgentState;
    intent?: DentalAgentIntent | null;
    slots?: DentalAgentSessionSlots;
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    turn_count?: number;
    patient_id?: string;
    last_message_id?: string;
    completed_at?: string;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // Refresh expiry on every update (activity = more time)
  if (!updates.completed_at) {
    payload.expires_at = new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString();
  }

  if (updates.state !== undefined) payload.state = updates.state;
  if (updates.intent !== undefined) payload.intent = updates.intent;
  if (updates.slots !== undefined) payload.slots = updates.slots;
  if (updates.turn_count !== undefined) payload.turn_count = updates.turn_count;
  if (updates.patient_id !== undefined) payload.patient_id = updates.patient_id;
  if (updates.last_message_id !== undefined) payload.last_message_id = updates.last_message_id;
  if (updates.completed_at !== undefined) payload.completed_at = updates.completed_at;

  // Trim messages to keep session payload bounded
  if (updates.messages !== undefined) {
    payload.messages = updates.messages.slice(-MAX_SESSION_MESSAGES);
  }

  const { error } = await db
    .from('dental_agent_sessions')
    .update(payload)
    .eq('id', sessionId);

  if (error) {
    console.error('[dental agent] updateSession error:', error);
  }
}

/**
 * Mark a session as completed with a terminal state.
 */
export async function completeSession(
  db: SupabaseClient,
  sessionId: string,
  terminalState: 'completed' | 'expired' | 'handed_off',
): Promise<void> {
  await updateSession(db, sessionId, {
    state: terminalState,
    completed_at: new Date().toISOString(),
  });
}

/**
 * Check if a session has expired (past its expires_at).
 */
export function isSessionExpired(session: DentalAgentSession): boolean {
  return new Date(session.expires_at).getTime() < Date.now();
}

/**
 * Check if this message was already processed by this session
 * (webhook retry idempotency).
 */
export function isMessageAlreadyProcessed(
  session: DentalAgentSession,
  messageId: string,
): boolean {
  return session.last_message_id === messageId;
}
