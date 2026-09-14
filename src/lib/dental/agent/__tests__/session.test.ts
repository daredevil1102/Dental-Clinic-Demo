import { describe, it, expect } from 'vitest'
import { isSessionExpired, isMessageAlreadyProcessed } from '../session'
import type { DentalAgentSession } from '../../types'

function makeSession(overrides: Partial<DentalAgentSession> = {}): DentalAgentSession {
  return {
    id: 'sess-1',
    account_id: 'acct-1',
    patient_id: 'pat-1',
    conversation_id: 'conv-1',
    phone: '+31612345678',
    intent: null,
    state: 'awaiting_intent',
    slots: {},
    messages: [],
    turn_count: 0,
    last_message_id: null,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('isSessionExpired', () => {
  it('returns false when session is still within timeout', () => {
    const session = makeSession()
    expect(isSessionExpired(session)).toBe(false)
  })

  it('returns true when session has expired', () => {
    const session = makeSession({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    expect(isSessionExpired(session)).toBe(true)
  })
})

describe('isMessageAlreadyProcessed', () => {
  it('returns false when last_message_id is null', () => {
    const session = makeSession({ last_message_id: null })
    expect(isMessageAlreadyProcessed(session, 'msg-123')).toBe(false)
  })

  it('returns false when message ID is different', () => {
    const session = makeSession({ last_message_id: 'msg-old' })
    expect(isMessageAlreadyProcessed(session, 'msg-new')).toBe(false)
  })

  it('returns true when message ID matches (idempotency)', () => {
    const session = makeSession({ last_message_id: 'msg-123' })
    expect(isMessageAlreadyProcessed(session, 'msg-123')).toBe(true)
  })
})
