# Phase 1 — Test Plan

A follow-along test plan for verifying Phase 1 features by hand. Living
document: each feature adds a section. Currently covers **P1-1 (rebrand)** and
**P1-7 (PWA Level 1)**.

**How to use:** pick the environment (§2), run the automated checks (§3), then
walk the functionality tables (§4–§5) marking Pass/Fail, do the device matrix
(§6) and the user-flow scenarios (§7), and finish with the regression pass (§8).
Log anything that fails with the template in §9 and record sign-off in §10.

**Legend:** ✅ Pass · ❌ Fail · ⚠️ Pass-with-note · ⬜ Not run.

---

## 1. Scope

| In scope | Out of scope (why) |
|---|---|
| P1-1: app name = ConnectsWA everywhere on-screen, brand mark (favicon/sidebar/auth), default corporate-blue theme, en + ko locales | Marketing/landing pages & Hostinger promo (backlog B1) |
| P1-7: installable PWA — manifest, icons, iOS/Android install, fullscreen launch | Push notifications / offline (Phase 2, P2-3) |
| Regression: core flows still work after the rebrand | Backend/business-logic changes (none were made) |

---

## 2. Test environments & prerequisites

You need a working `.env.local` (Supabase URL + keys, encryption key, etc.) for
anything that requires login. The **rebrand** tests need login; most **PWA**
checks don't, but the **install** tests do need a real device.

| Env | How to start | Use for |
|---|---|---|
| **Dev** | `npm run dev` → http://localhost:3000 | Fast visual checks, both locales |
| **Prod (local)** | `npm run build && npm start` → http://localhost:3000 | Realistic build; icon/manifest routes; Lighthouse |
| **Device / hosted** | Deployed HTTPS URL (or a tunnel like ngrok/cloudflared) opened on a phone | The only way to test real install on Android/iOS |

> ⚠️ **HTTPS is required to install a PWA on a phone.** `localhost` counts as a
> secure context on desktop (Lighthouse works there), but a phone needs a real
> **HTTPS** origin — the deployed domain (OPS-1) or a temporary tunnel. Plain
> `http://<your-LAN-ip>:3000` will **not** offer "Install".

**Locale switch:** the app picks locale from the user/browser. To force Korean,
set the browser's preferred language to Korean (or your usual in-app switch) and
reload.

---

## 3. Automated checks (run first — must be green)

From the repo root:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: typecheck clean, lint 0 errors, all tests pass, build succeeds.
(Baseline at implementation time: typecheck ✓, lint 0 errors, 645 tests ✓,
build ✓.) If any fail, stop and fix before manual testing.

Optional quick icon/manifest smoke test against a running `npm start`:

```bash
curl -s localhost:3000/manifest.webmanifest
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" localhost:3000/icon
```

Expected: valid JSON manifest; `200 image/png` for `/icon`, `/apple-icon`,
`/icons/pwa-192`, `/icons/pwa-512`, `/icons/maskable`.

---

## 4. Functionality tests — P1-1 Rebrand

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| RB-01 | Open any page; look at the **browser tab** title | Reads **ConnectsWA** (or "<Page> — ConnectsWA"); no "wacrm" | ⬜ |
| RB-02 | Look at the **browser tab favicon** | Blue rounded-square mark with a white message-bubble + up-arrow; not the old violet | ⬜ |
| RB-03 | Sign-in page (`/login`, logged out) | Brand mark = new blue bubble+arrow; primary buttons/links are **blue**, not violet | ⬜ |
| RB-04 | Sign-up page (`/signup`) | Tagline reads "Get started with **ConnectsWA**"; mark matches | ⬜ |
| RB-05 | Log in; check the **sidebar** header | Logo mark = new glyph; label reads **ConnectsWA** | ⬜ |
| RB-06 | Scan primary UI (buttons, active nav, links) | Accent colour is corporate **blue** (cobalt) throughout | ⬜ |
| RB-07 | Settings → Theme picker | "Cobalt" is the active/default accent; switching themes still works | ⬜ |
| RB-08 | Settings → AI Assistant description text | Mentions **ConnectsWA**, not wacrm | ⬜ |
| RB-09 | Invite a teammate → the generated WhatsApp invite message | Says "on **ConnectsWA**" (or account name); no wacrm | ⬜ |
| RB-10 | WhatsApp templates → delete dialog copy | References **ConnectsWA**, not wacrm | ⬜ |
| RB-11 | Switch locale to **Korean**; repeat RB-01, RB-05, RB-08, RB-09 | Name shows as **ConnectsWA**; sentences read naturally (see KO note) | ⬜ |
| RB-12 | Search the running UI for the string "wacrm" (visually / Ctrl-F on rendered pages) | Not visible anywhere in the product UI | ⬜ |

> **KO note (RB-11):** particles were adjusted for the vowel-ending name
> (으로→로, 이→가, 은→는). A native Korean speaker should confirm they read
> naturally (backlog **B3**). Flag any awkward spacing/particle as a ⚠️.

**Not-to-break (internal, intentionally still "wacrm"):** API keys still start
`wacrm_live_`, webhook headers are still `X-Wacrm-*`. These are contracts, not
UI — do **not** report them as rebrand misses.

---

## 5. Functionality tests — P1-7 PWA

Run against **Prod (local)** for §5.1 and a **device/hosted** URL for §5.2.

### 5.1 Manifest & icons (desktop / Lighthouse)

| ID | Steps | Expected | Result |
|----|-------|----------|--------|
| PWA-01 | Open `/manifest.webmanifest` | Valid JSON: `name`/`short_name` = ConnectsWA, `display` = standalone, 3 icons (192, 512, maskable) | ✅ (curl-verified, local + tunnel) |
| PWA-02 | Open `/icon`, `/apple-icon`, `/icons/pwa-192`, `/icons/pwa-512`, `/icons/maskable` | Each shows the blue brand mark as a PNG (maskable = full-bleed, smaller glyph) | ✅ (all 200 image/png; on-device icon confirmed) |
| PWA-03 | Chrome DevTools → Application → Manifest | No errors; icons listed; "Installability" shows the app is installable | ⬜ |
| PWA-04 | Lighthouse (or DevTools) PWA / installability audit | "Installable" passes; manifest + icons detected | ⬜ |
| PWA-05 | DevTools → Application → Manifest → maskable preview (or maskable.app) | Glyph stays inside the safe circle when masked (not clipped) | ⬜ |

### 5.2 Install & launch (real devices)

> ⚠️ **Use a clean origin (Cloudflare tunnel or deployed domain), NOT ngrok-free**
> — ngrok's interstitial makes installs fall back to a shortcut with a wrong
> icon (see P1-7 doc + backlog B8).

| ID | Device | Steps | Expected | Result |
|----|--------|-------|----------|--------|
| PWA-06 | **Android Chrome** | Open clean HTTPS URL → menu → "Install app" / "Add to Home screen" | Installs; home-screen icon = blue mark, not clipped; name = ConnectsWA | ✅ (2026-08-09; icon correct on Cloudflare tunnel. ❌ on ngrok — see B8) |
| PWA-07 | **Android** | Launch from home screen | Opens **fullscreen** (no browser address bar); splash shows icon on dark bg | ❌ Opens in-browser (shortcut), not standalone — needs service worker (**B7**) |
| PWA-08 | **iOS Safari** | Open clean HTTPS URL → Share → "Add to Home Screen" | Icon = blue mark; label = ConnectsWA | ⬜ |
| PWA-09 | **iOS** | Launch from home screen | Opens fullscreen (standalone); status bar readable | ⬜ (likely also blocked until B7) |
| PWA-10 | Either | Use the app installed (navigate a few screens) | Behaves like the browser app; no broken layout in standalone | ⬜ |

---

## 6. Device / browser matrix

Run the smoke path (log in → inbox → one nav) on each; note rendering issues.

| Platform | Browser | Rebrand look | PWA install | Result |
|---|---|---|---|---|
| Desktop | Chrome/Edge | RB-01…08 | PWA-01…05 | ⬜ |
| Desktop | Firefox | RB-01…08 | manifest detected | ⬜ |
| Desktop | Safari (mac) | RB-01…08 | n/a | ⬜ |
| Android | Chrome | RB (mobile) | PWA-06/07 | ⬜ |
| iPhone | Safari | RB (mobile) | PWA-08/09 | ⬜ |

---

## 7. User acceptance test (UAT) scenarios

End-to-end, "act like a real user." Pass = the flow completes and everything on
screen is on-brand.

- **UAT-1 — New user first impression:** land on `/login` → note branding →
  sign up → verify email copy → land in app. *Expect:* ConnectsWA name + blue
  brand from first screen to dashboard; nothing says wacrm.
- **UAT-2 — Owner installs the app:** on a phone, open the hosted URL, install
  to home screen, launch, log in, open the inbox. *Expect:* feels like a native
  app (own icon, fullscreen), fully usable.
- **UAT-3 — Team invite:** owner invites a teammate; teammate reads the invite
  message and joins. *Expect:* invite text is on-brand and clear.
- **UAT-4 — Korean user:** switch to Korean, repeat UAT-1. *Expect:* name and
  copy read naturally to a Korean speaker.

---

## 8. Regression pass (rebrand must not break function)

The rebrand only touched text, one shared icon component, and the default theme.
Confirm core flows still work:

| ID | Flow | Expected | Result |
|----|------|----------|--------|
| REG-01 | Log in / log out | Works | ⬜ |
| REG-02 | Open inbox, select a conversation, send a message | Works | ⬜ |
| REG-03 | Theme switch (cobalt → another → back) persists across reload | Works | ⬜ |
| REG-04 | Light/dark mode toggle | Works; blue accent legible in both | ⬜ |
| REG-05 | Contacts / pipelines / broadcasts pages load | No console errors, no broken icons | ⬜ |
| REG-06 | Settings tabs (profile, WhatsApp, AI) load | Works | ⬜ |

---

## 9. Bug report template

```
[ID or area]  e.g. RB-06 / PWA-07
Environment:  dev | prod-local | Android Chrome | iOS Safari  (+ version)
Locale:       en | ko
Steps:        1… 2… 3…
Expected:     …
Actual:       …
Severity:     blocker | major | minor | cosmetic
Evidence:     screenshot / URL / console error
```

---

## 10. Sign-off

| Feature | Tester | Date | Result | Notes |
|---|---|---|---|---|
| P1-1 Rebrand | | | ⬜ | |
| P1-7 PWA | | | ⬜ | |

> A feature is "Done" (per the phase-1 workflow) when its functionality table,
> the relevant device matrix rows, and the regression pass are all ✅ (or ⚠️
> with accepted notes), and sign-off is recorded here.
