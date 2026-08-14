Deploy

Deploy on Hostinger
Hostinger's Managed Node.js Hosting is the recommended way to run this template in production: Hostinger patches the OS and the Node runtime, handles SSL, and gives you a Git-based deploy flow from hPanel. You deploy from your fork without ever opening an SSH session if you don't want to.

This walkthrough assumes you have already completed getting-started, supabase-setup, and whatsapp-setup — i.e., your fork builds locally and you have your Supabase + Meta credentials ready.

1. Buy a Managed Node.js plan
Sign up at hostinger.com/web-apps-hosting and choose a Node.js plan that gives you enough memory for npm run build (2 GB+ recommended).
During the onboarding wizard, pick the Node.js stack and the region closest to your users.
Finish setup until you land in hPanel.
2. Create the app in hPanel
In hPanel, open the hosting plan and go to Websites → Create / Manage and pick the Node.js application option, then:

Application name — wacrm.
Application root — accept the default (e.g., domains/yourdomain/public_html).
Application URL — the domain or subdomain you want to use (e.g., crm.example.com). You can attach a domain now or later under Domains.
Node.js version — **select 24.** hPanel defaults to 22, and this is the one deploy setting no file in the repo can enforce. `.nvmrc`, CI and both `engines` fields all pin 24; Node 20 and 22 ship npm 10, which resolves this project's optional peer dependencies differently from the npm 11 that wrote `package-lock.json`. The lockfile is deliberately shaped to install under both, so picking 22 will not break the deploy — but 24 is the tested combination and is supported until April 2028, where 22 ends April 2027.
Application startup file / command — Next.js uses npm start once it is built, so set:
Start command: npm start
Alternatively: node node_modules/next/dist/bin/next start -p $PORT
Save the app. hPanel provisions a container and shows you the app's control page.

3. Connect your GitHub fork
In hPanel → Git:

Create repository → paste your fork's HTTPS URL (e.g., https://github.com/<your-username>/wacrm.git).
Pick the branch you want to deploy (usually main).
Set the deploy path to the Application root from step 2.
Alternative: if you prefer ZIP uploads, use File Manager instead — upload the repo contents into the application root. Git-based deploy is simpler because redeploying is one click.

4. Install dependencies and build
hPanel's Node.js app page exposes a Run NPM install button and a terminal. Either works:

Button flow:
Click Run NPM install. Wait for it to finish.
Click Run NPM Build (or execute npm run build from the app terminal).
Terminal flow:
npm ci
npm run build
Next.js expects NEXT_PUBLIC_* variables to be present at build time, so set env vars (step 5) before running the build.

5. Configure environment variables
In hPanel → Node.js app → Environment variables, add every value from environment-variables.md:

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ENCRYPTION_KEY
META_APP_SECRET
NEXT_PUBLIC_SITE_URL — set to https://<your-domain> (with the scheme, without a trailing slash).
AUTOMATION_CRON_SECRET — if you plan to use Wait steps (automations-and-cron.md).
Save, then re-run the build so the new NEXT_PUBLIC_* values get baked into the client bundle.

6. Start the app
From the app page, click Restart application (or run the equivalent from the terminal). hPanel boots npm start behind its own reverse proxy on the domain you configured. Hit the URL in a browser — you should land on the marketing page.

SSL is provisioned automatically. If you used a subdomain, Hostinger's AutoSSL usually takes a minute or two; until then the site may serve the plain-HTTP version.

7. Update the Meta webhook
Back in Meta for Developers → WhatsApp® → Configuration, change the callback URL to https://<your-domain>/api/whatsapp/webhook and re-verify.

8. Schedule the automations cron
If you use the Wait step in any automation, schedule the cron drain.

Inside hPanel — open Advanced → Cron Jobs and add:
* * * * * curl -s -H "x-cron-secret: <AUTOMATION_CRON_SECRET>" https://<your-domain>/api/automations/cron > /dev/null
Paste the literal secret here (cron jobs in hPanel don't read app env vars) or store it in a file the cron reads.
Outside — any uptime monitor (UptimeRobot, Better Stack, GitHub Actions) can hit the URL once a minute. See automations-and-cron.md for detail.
9. Deploying updates
Two options:

Click-deploy: push to your fork, then hit Pull in hPanel → Git and Restart application.
Terminal:
cd <application-root>
git pull
npm ci
npm run build
# then restart from the Node.js app page
If the database schema changed, apply any new SQL files from supabase/migrations/ in the Supabase SQL editor first — migrations are idempotent.

When to reach for a VPS instead
Managed Node.js covers most deploys of this template. Consider Hostinger VPS if you need:

Long-running background workers beyond what the single Next.js process gives you.
System-level cron behaviour you can't replicate from hPanel.
Custom binaries (e.g., ffmpeg) for media transforms.
Otherwise, Managed Node.js is the fast path.

Deploy

Automations cron
The Automations module lets you build flows that react to WhatsApp® events (new message, new contact, keyword match, schedule, etc.). Most steps run inline — the exception is the Wait step, which parks the execution in automation_pending_executions until its due time.

A cron job has to drain that table. If you skip this, Wait steps never resume and any flow that uses them stalls.

The endpoint
GET /api/automations/cron
Header: x-cron-secret: <AUTOMATION_CRON_SECRET>
Returns { "processed": <n> } with how many rows were claimed.
Returns 503 if the env var is not set.
Returns 401 if the header is missing or wrong.
The route claims up to 50 pending rows per call via a two-step UPDATE-by-id so overlapping calls don't double-process.

1. Generate the secret
Any long random string works. One option:

openssl rand -hex 32
Copy the result into AUTOMATION_CRON_SECRET in your deployment env.

2. Schedule the pinger
Option A — hPanel cron (Hostinger Managed Node.js)
hPanel → Advanced → Cron Jobs → add a new job set to every minute (* * * * *). Command:

curl -s -H "x-cron-secret: <AUTOMATION_CRON_SECRET>" https://crm.example.com/api/automations/cron > /dev/null
Paste the literal secret — hPanel cron jobs don't inherit the Node app's environment variables.

Option B — external pinger
Any uptime monitor that supports custom headers works:

UptimeRobot — "Keyword Monitoring" with custom HTTP headers.
Better Stack.
GitHub Actions with a schedule: trigger.
Hit the URL once per minute. Anything slower just means Wait-step resolution is that much more delayed.

3. Verify
curl -s -H "x-cron-secret: <secret>" https://crm.example.com/api/automations/cron
# -> {"processed":0}
Then create a test automation with a short Wait step (e.g., 30 seconds) and trigger it. Watch the automation's Logs tab — the execution should resume and mark as completed within one cron interval of the wait expiring.

4. What if you don't use Wait?
Skip this page. Trigger → inline steps → done flows do not need a cron — they finish synchronously inside the webhook handler or from the UI. The cron only matters for flows that park execution.