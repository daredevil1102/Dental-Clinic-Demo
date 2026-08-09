# P1-8 — OpenRouter AI provider

- **Status:** Deferred (decision recorded 2026-08-09)
- **Effort if built:** ~1–2 days
- **Branch:** n/a
- **Last updated:** 2026-08-09

## 1. Context & problem
Requirement P1-8 asks to add OpenRouter "as a provider option alongside
OpenAI/Anthropic." Today the codebase supports only two providers — the type
`AiProvider` in `src/lib/ai/types.ts` is `'openai' | 'anthropic'`, and the
settings dropdown reflects that.

We are already *using* OpenRouter, but via a shortcut, not a real provider:
`.env.local` sets
```
OPENAI_BASE_URL=https://openrouter.ai/api/v1/chat/completions
```
and `src/lib/ai/providers/openai.ts` honors that override. Selecting the
"OpenAI" provider therefore routes to OpenRouter behind the scenes.

## 2. Decision
**Deferred. Do NOT build first-class OpenRouter for the pilot.** We recommend
`gpt-4o-mini` and keep provider selection invisible to clients. Code comments
added in `providers/openai.ts` and `defaults.ts` on 2026-08-09.

**Would building P1-8 make OpenRouter visible to clients?** Yes — that is the
whole difference. The env-var shortcut keeps it *invisible* (clients see
"OpenAI"); building P1-8 would add a visible "OpenRouter" dropdown choice.
Since we don't want clients choosing providers, the shortcut matches the goal.

## 3. Known limitations of the shortcut (tech debt)
The `OPENAI_BASE_URL` override is **global**, not per-workspace:
1. Every account that picks "OpenAI" is rerouted to OpenRouter. A real
   `api.openai.com` path is unavailable platform-wide while this is set, and a
   genuine OpenAI key pasted under "OpenAI" will fail.
2. Model IDs must be OpenRouter **slugs** (`openai/gpt-4o-mini`), not bare
   names (`gpt-4o-mini`). The default in `AI_PROVIDER_DEFAULT_MODEL` is a bare
   OpenAI id, so it must be overridden in Settings → AI when the base URL
   points at OpenRouter.

Acceptable for a single-operator pilot. **Revisit before onboarding any client
who needs to choose their own provider or bring a real OpenAI key.**

## 4. If/when we build it (sketch, not scheduled)
- Extend `AiProvider` to include `'openrouter'`; add a `providers/openrouter.ts`
  adapter (OpenAI-compatible, so mostly a thin wrapper with the OpenRouter base
  URL + headers).
- Per-workspace base URL/model rather than a global env var.
- Surface an OpenRouter model list / helper in Settings → AI.
- Remove the global `OPENAI_BASE_URL` reliance.

## 5. Open questions
- When do we expect the first client who wants provider choice? That sets the
  deadline for unwinding the shortcut.
