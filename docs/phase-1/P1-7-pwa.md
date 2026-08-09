# P1-7 — PWA Level 1 (installable, native feel)

- **Status:** In review (implemented; awaiting owner install test + commit review)
- **Effort:** ~0.5 day build (see note on why it feels bigger)
- **Branch:** `feat/p1-7-pwa`
- **Last updated:** 2026-08-09
- **Brand inputs locked:** name **ConnectsWA**, mark = shared `<BrandMark>`
  (bubble + upward arrow), icon background `#2563EB`.

## 0. Implementation notes (what shipped)
All icons are **code-generated** via next/og — no static PNGs, no new deps.
- New shared raster helper `src/lib/brand/brand-icon.tsx` (`renderBrandIcon`)
  renders the mark at any size; mirrors the DOM `<BrandMark>` glyph.
- `src/app/icon.tsx` refactored to use it (favicon 32); new
  `src/app/apple-icon.tsx` (180, full-bleed for iOS).
- Manifest icon routes: `src/app/icons/pwa-192`, `pwa-512`, `maskable`
  (512, full-bleed + smaller glyph for Android adaptive masking).
- `src/app/manifest.ts` (name/short_name ConnectsWA, `display: standalone`,
  bg/theme `#020617` to match the dark shell, the three icons).
- `src/app/layout.tsx`: added `appleWebApp` metadata (iOS fullscreen).
- **Runtime-verified:** booted `next start`, every route returns HTTP 200
  `image/png` (683 B–10 KB) and `/manifest.webmanifest` serves valid JSON —
  so Satori renders the multi-path glyph, not just compiles.
- **Not done (owner):** real device install test on Android + iOS.

## 1. Context & problem
The app is browser-only today. There is **no web-app manifest** (confirmed:
nothing matching `manifest*` under `src/app/` or `public/`). PWA Level 1 makes
the site installable to a phone home screen and open fullscreen with its own
icon and splash — the "native feel" in decision D2. Level 2 (push
notifications) is explicitly **Phase 2 (P2-3)** and out of scope here.

> Why this "0.5 day" item can feel like a chunk: the build is small, but doing
> it *well* means generating a proper icon set (incl. a maskable icon with
> safe-zone padding), setting theme/splash correctly, and testing install on
> both Android and iOS — iOS has real caveats. The code is little; the QA and
> icon assets are the real work. We'll use this as the pilot for the doc/review
> workflow precisely because it's low-risk.

## 2. Goals / Non-goals
- **Goals:** installable app (Add to Home Screen), standalone/fullscreen
  display, correct app name + icons + theme color + splash on Android & iOS.
- **Non-goals:** service worker, offline caching, push notifications, background
  sync — all Phase 2. No new npm dependencies (D2: "No new dependencies").

## 3. Approach
Next.js app-router native metadata. **Read `node_modules/next/dist/docs/`
first** (per `AGENTS.md`) to confirm the manifest + metadata API in this
modified Next version before writing code.

Anticipated changes (verify against the guide):
- **New:** `src/app/manifest.ts` (Next's typed metadata route) — `name`,
  `short_name`, `start_url`, `display: "standalone"`, `background_color`,
  `theme_color`, `icons[]`.
- **New:** icon assets — 192×192, 512×512, a **maskable** 512 (with padding),
  and `apple-touch-icon` 180×180. Generated from one square source ≥512
  (or derived from the code mark in `icon.tsx`).
- **Edit:** `src/app/layout.tsx` metadata — `themeColor`, apple web-app meta
  (`appleWebApp`), `applicationName`.
- Depends on **P1-1** for the final name + brand color + mark, so the icons and
  theme color are correct on the first pass. Sequence P1-1 → P1-7, or use
  placeholders and redo icons.

## 4. Task breakdown
- [x] Read Next manifest/metadata guide in `node_modules/next/dist/docs/`.
- [x] Confirm brand inputs from P1-1 (name, color, mark).
- [x] Generate icon set (192, 512, maskable 512, apple-touch 180) — code-gen.
- [x] Add `src/app/manifest.ts`.
- [x] Add apple-web-app metadata in `layout.tsx` (theme-color already set).
- [x] `npm run typecheck && npm run lint && npm run build` (+ runtime fetch check).
- [ ] **Manual install test: Android Chrome + iOS Safari** (owner).

## 5. Testing & acceptance
- **Automated:** build passes; Lighthouse "Installable" check green.
- **Manual pass criteria:**
  - Android Chrome shows "Install app"; installs with correct name/icon.
  - iOS Safari → Share → Add to Home Screen shows correct icon; launches
    fullscreen (no browser chrome) with a correct splash/theme color.
  - Icon is not clipped on Android adaptive (maskable) surfaces.

## 6. Rollout & rollback
Purely additive. Rollback = revert the commit (remove `manifest.ts`, icons, and
the metadata additions); no data or migration impact.

## 7. Open questions / decisions
- Confirm P1-1 brand color/name are final enough to bake into icons, or accept
  one icon redo later -- confirmed and accepeted
