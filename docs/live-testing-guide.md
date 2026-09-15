# Live Testing the Dental AI Receptionist

## Prerequisites Checklist

You need 4 things configured before the agent will respond:

- [ ] **Migration applied** — `041_dental_agent.sql` adds the `agent_enabled` column and `dental_agent_sessions` table
- [ ] **Agent enabled** — `agent_enabled = true` in your account's `dental_clinic_config` row
- [ ] **AI key configured** — an OpenAI or Anthropic API key saved in Settings → AI Assistant
- [ ] **WhatsApp connected** — your Meta Business account connected in Settings → WhatsApp

---

## Step 1 — Apply the migration

Run the new migration against your Supabase project:

```bash
# Option A: via Supabase CLI (if linked)
npx supabase db push

# Option B: manually paste the SQL into the Supabase SQL Editor
# Go to: https://supabase.com/dashboard → your project → SQL Editor
# Paste the contents of: supabase/migrations/041_dental_agent.sql
# Click "Run"
```

## Step 2 — Enable the agent for your account

In the **Supabase SQL Editor**, run:

```sql
-- Find your account's config row
SELECT id, account_id, clinic_name, agent_enabled
FROM dental_clinic_config;

-- Enable the agent
UPDATE dental_clinic_config
SET agent_enabled = true
WHERE account_id = '<your-account-id-from-above>';
```

> **Tip:** If you don't have a `dental_clinic_config` row yet, visit the dental settings page in your app first — it auto-creates one with defaults.

## Step 3 — Ensure AI is configured

Go to **Settings → AI Assistant** in your app and make sure:
- You've pasted a valid API key (OpenAI or Anthropic)
- A model is selected
- AI auto-reply is enabled for the account

The dental agent reuses the same BYOK credentials.

## Step 4 — Start the dev server

```bash
npm run dev
```

Your app should be running at `http://localhost:3000`.

## Step 5 — Expose via tunnel (for Meta webhooks)

Meta needs a public HTTPS URL to send webhook events. Use ngrok or Cloudflare Tunnel:

```bash
# Option A: ngrok
ngrok http 3000

# Option B: Cloudflare Tunnel (if installed)
cloudflared tunnel --url http://localhost:3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`).

## Step 6 — Update Meta webhook URL

1. Go to [Meta for Developers](https://developers.facebook.com) → your app → WhatsApp → Configuration
2. Update the **Callback URL** to: `https://<your-tunnel>/api/whatsapp/webhook`
3. The verify token is your existing one (already configured)

## Step 7 — Send a message!

From your personal WhatsApp, message the business number with something like:

| Test message | Expected behavior |
|---|---|
| `Hi, I'd like to book an appointment` | Agent asks what you need and offers providers |
| `What times does Dr. Smith have available?` | Agent calls `get_provider_availability` and lists slots |
| `Can I cancel my appointment?` | Agent calls `get_my_appointments` and asks which one |
| `I need to reschedule` | Agent finds your appointment and offers new times |
| `I want to talk to a human` | Agent calls `transfer_to_human` and hands off |

---

## Troubleshooting

### Agent doesn't respond
1. Check the server console for `[dental agent]` log lines
2. Verify `agent_enabled = true`: `SELECT agent_enabled FROM dental_clinic_config WHERE account_id = '...'`
3. Verify AI config exists: `SELECT provider, model FROM ai_config WHERE account_id = '...'`
4. Check that the message isn't being consumed by a Flow first (Flows have higher priority)

### "No AI config" in logs
→ Go to Settings → AI Assistant and save your API key

### Rate limit hit
→ The agent shares rate limits with generic AI auto-reply. Wait a few minutes or check `[dental agent] account ... hit rate limit` in logs.

### Double messages
→ If both the agent AND generic AI auto-reply are responding, check that `dentalAgentConsumed` is properly suppressing the AI auto-reply. The agent should consume the message first.

---

## Demo Mode vs. Live Mode

| Setting | Behavior |
|---|---|
| `demo_mode = true` | Messages are logged but NOT sent via WhatsApp API. Check the server console for `[dental:mock]` lines. |
| `demo_mode = false` | Messages are sent via the real WhatsApp Business API. |

To toggle: update `demo_mode` in `dental_clinic_config`:

```sql
UPDATE dental_clinic_config
SET demo_mode = false
WHERE account_id = '<your-account-id>';
```

## Quick Smoke Test (Demo Mode)

If you just want to verify the agent works without a live WhatsApp connection:

1. Keep `demo_mode = true`
2. Use the Supabase SQL Editor to simulate an inbound by calling the dispatch directly from a test script, or simply send a real WhatsApp message — the agent will process it and log the reply to the console (but won't actually deliver it to WhatsApp in demo mode)
