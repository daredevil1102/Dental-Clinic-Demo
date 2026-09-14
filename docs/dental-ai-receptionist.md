# Dental AI Receptionist

## Overview

The dental AI receptionist is a conversational agent that handles WhatsApp messages from patients, enabling them to book, cancel, and reschedule appointments through natural language conversation. It coexists with the existing button-driven reminder/response flow.

## Architecture

### Core Components

| File | Purpose |
|---|---|
| `src/lib/dental/agent/dispatch.ts` | Webhook entry point — feature-flag check + orchestration |
| `src/lib/dental/agent/engine.ts` | Main tool-calling loop — session, LLM, tools, reply |
| `src/lib/dental/agent/tools.ts` | 7 tool definitions + server-side executors |
| `src/lib/dental/agent/providers.ts` | OpenAI + Anthropic tool-calling adapters |
| `src/lib/dental/agent/prompt.ts` | System prompt builder with clinic/patient context |
| `src/lib/dental/agent/session.ts` | Session CRUD with 30-min sliding expiry |
| `src/lib/dental/agent/types.ts` | Agent-specific TypeScript types |
| `src/lib/dental/reschedule.ts` | Shared reschedule-commit logic (agent + button flow) |
| `src/lib/dental/calendar.ts` | Google Calendar link + `.ics` generation |
| `supabase/migrations/041_dental_agent.sql` | Schema additions |

### How It Works

1. **Inbound message arrives** via the WhatsApp webhook (`process-webhook.ts`)
2. Flows and dental button handlers get first priority
3. If unconsumed: the dental agent dispatch checks `agent_enabled` (1 indexed query)
4. If enabled: loads/creates a session, builds LLM context, enters the tool-calling loop
5. LLM classifies intent and calls tools (e.g., `get_provider_availability`, `create_booking`)
6. Tools execute against the existing service layer (never bypassing it)
7. Deterministic confirmation messages are composed from actual DB rows
8. Reply is sent via the existing `DentalWhatsAppService`

### Tool-Calling Flow

```
Patient message → LLM → tool_call(list_providers) → result → LLM → tool_call(get_provider_availability) → result → LLM → "Here are Dr. Smith's available slots..." → Patient picks one → LLM → tool_call(create_booking) → result → Deterministic confirmation + calendar link
```

### Session State Machine

```
awaiting_intent → collecting_info → confirming → executing → completed
Any state → handed_off (transfer_to_human)
Any state → expired (30-min timeout)
```

## Enabling the Agent

Set `agent_enabled = true` in `dental_clinic_config` for the account:

```sql
UPDATE dental_clinic_config
SET agent_enabled = true
WHERE account_id = '<your-account-id>';
```

The account must also have AI configured (BYOK API key) via the existing AI settings page.

## Available Tools

| Tool | Purpose | Mutating |
|---|---|---|
| `list_providers` | List active doctors with next-available annotation | No |
| `get_provider_availability` | Check real slot availability | No |
| `get_my_appointments` | Patient's own upcoming appointments | No |
| `create_booking` | Book a new appointment | Yes |
| `cancel_booking` | Cancel an existing appointment | Yes |
| `reschedule_booking` | Reschedule to a new time/provider | Yes |
| `transfer_to_human` | Hand off to staff | Yes (conversation state) |

## Safety Guarantees

1. **LLM never writes to the database directly** — all mutations go through `appointment-service.ts`
2. **Ownership enforced server-side** — a patient can only see/modify their own appointments
3. **Double-booking prevented by Postgres EXCLUDE constraint** — slot-taken results in graceful re-offer
4. **Deterministic confirmations** — booking/cancel/reschedule confirmations are composed from DB rows, not model text
5. **Prompt injection defense** — patient messages treated as untrusted content
6. **Anti-hallucination** — all dates/times/providers must come from tool call results
7. **Graceful degradation** — LLM timeout/error → automatic handoff to human staff
8. **Webhook retry idempotency** — `last_message_id` tracking prevents duplicate processing
9. **Rate limiting** — per-account cap prevents API key abuse

## Calendar Integration

- **Google Calendar deep link** — opens pre-filled event creation (no OAuth)
- **`.ics` download** — `GET /api/dental/appointments/[id]/ics` serves a standard calendar file
- **Stable UID** — calendar events survive reschedules (update-in-place, no duplicates)

## Coexistence with Button Flow

The AI agent and the button-driven flow coexist:
- **Buttons** (Confirm ✅ / Cancel ❌ / Reschedule 📅) are handled by `webhook-handler.ts` — these are interactive replies with `dental_` prefix
- **Free text** messages are handled by the AI agent — only when `agent_enabled = true`
- Both use the same underlying service layer (`appointment-service.ts`, `availability-service.ts`, `reschedule.ts`)
