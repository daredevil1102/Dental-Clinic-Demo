# P1-1 — Rebrand (in-app surface only)

- **Status:** In review (implemented; awaiting Manish review + commit)
- **Effort:** ~0.5 day
- **Branch:** `feat/p1-1-rebrand`
- **Last updated:** 2026-08-09

## 0. Implementation notes (what actually shipped)
Confirmed decisions: name **ConnectsWA** (rendered as a proper-case wordmark
though typed lowercase — trivially changeable), **blue** confirmed, keep the
**code mark**, marketing/Hostinger pages → **backlog**.

- **Colour approach changed from the draft.** The app has a *multi-theme*
  system (`src/lib/themes.ts`), not a single token. Rather than hand-roll new
  `#1A56DB` tokens across every light/dark/hover/soft variant (contrast risk),
  I switched `DEFAULT_THEME` from `violet` → **`cobalt`**, the existing, tested
  "Clean B2B-SaaS blue". The fixed brand mark uses hex `#2563EB` to match. If
  you want the exact `#1A56DB`, that's a follow-up retune of the cobalt tokens.
- **Shared `<BrandMark>`** created at `src/components/brand/brand-mark.tsx`
  (message bubble + upward arrow) and used in the sidebar + login + signup;
  `src/app/icon.tsx` mirrors the same paths by hand (next/og can't import it).
- **Extra user-facing strings** rebranded beyond the draft list: signup
  tagline, the `'our wacrm account'` fallback (invite dialog), and the
  "one wacrm user" config error.
- **Korean:** replaced the name in all 6 ko strings and fixed 3 attached
  particles for the now-vowel-ending name (으로→로, 이→가, 은→는).
  ⚠️ **Needs a native-Korean check** — see backlog.
- **Left untouched (internal, per D6):** `wacrm_live_` API-key prefix,
  `X-Wacrm-*` webhook headers, localStorage keys, code comments, tests.
- **Verification:** typecheck ✓, lint 0 errors ✓, 645 tests ✓, build ✓.

## 1. Context & problem
The product ships as "wacrm" (the codename). D6 says: rebrand the **surface**
(name, logo, colours) in Phase 1; leave internal code names untouched. The
current brand is **code-based, not file-based**:
- App name string: `src/app/layout.tsx` metadata (`title.default: "wacrm"`,
  `template: "%s — wacrm"`).
- User-facing "wacrm" strings: `messages/en.json` and `messages/ko.json`
  (invite text, template dialogs, AI settings copy, webhook status, etc.).
- Favicon: **generated in code** — `src/app/icon.tsx` (violet `#7c3aed`
  rounded square + white chat glyph).
- Sidebar mark: inline SVG in `src/components/layout/sidebar.tsx`.
- Theme color token: `src/lib/themes.ts` / `globals.css` (currently violet).
- `public/` has **no** real logo file (only Next.js default svgs).

## 2. Decisions (chosen for the working rebrand)
These are **reversible working choices** — the name/assets are formally Open
Decision #2 in the requirements. Everything is centralized, so swapping later
is cheap.

- **Name (confirmed):** **ConnectsWA** (rendered exactly as written, lowercase
  "s"). Supersedes the earlier "Laione Reach" draft suggestion.
- **Colours (corporate / McKinsey-blue family, replacing violet `#7c3aed`):**
  - Primary (buttons, mark bg, links): **`#1A56DB`** (strong corporate blue).
  - Deep navy (headers/sidebar accents): **`#0A2540`**.
  - *Alt on record:* you also offered **Bain red** — if you'd rather go red,
    it's a one-token change (primary `#CC0000`). Defaulting to blue as it reads
    more conventional for a CRM.
- **Logo/mark (my choice, implemented in code — no asset file needed):**
  rounded-square app mark, primary-blue background, white glyph = a speech
  bubble with a small upward arrow inside (chat + growth/outreach). Replaces the
  existing chat-only glyph in both `icon.tsx` and `sidebar.tsx` so they match.

## 3. Approach
Surface-only. Internal identifiers, table names, package name stay "wacrm" (D6).
- **Edit** `src/app/layout.tsx` — name in `title.default` + `template`, and
  `applicationName`.
- **Edit** `messages/en.json` + `messages/ko.json` — replace user-facing
  "wacrm" occurrences with the new name. Do NOT touch keys, only values, and
  leave strings that reference Meta/technical identifiers intact.
- **Edit** `src/app/icon.tsx` — new bg color + new glyph.
- **Edit** `src/components/layout/sidebar.tsx` — matching mark + name.
- **Edit** brand/primary token in `src/lib/themes.ts` (+ `globals.css` if the
  primary is defined there) — violet → `#1A56DB`.
- **Scope guard:** in-app surface only. Landing/marketing pages and the
  Hostinger promo are **out of scope** for this doc (separate task).

## 4. Task breakdown
- [x] Confirm name + colour (ConnectsWA / blue).
- [x] Swap app name + description in `layout.tsx` (+ `applicationName`).
- [x] Swap user-facing strings in `messages/en.json`, `messages/ko.json`.
- [x] Update `icon.tsx` (colour + glyph).
- [x] Add shared `<BrandMark>`; wire into sidebar + login + signup.
- [x] Switch default theme (violet → cobalt).
- [x] `npm run typecheck && npm run lint && npm test` (+ `build`).
- [ ] **Manual visual pass** (owner): login, sidebar, favicon/tab, both locales.

## 5. Testing & acceptance
- **Automated:** typecheck/lint/build green; i18n JSON still parses (no key
  changes).
- **Manual pass criteria:** no "wacrm" visible anywhere in the app UI; favicon
  + sidebar mark show the new blue mark; primary buttons are the new blue;
  Korean locale shows the new name too; no broken interpolation in messages.

## 6. Rollout & rollback
Additive/textual; no data or migration impact. Rollback = revert the commit.

## 7. Open questions / decisions
1. **Name** — keep "connectswa", 
2. **Real logo asset** — keep the
   
3. **Blue vs Bain red** — confirmed blue
4. **Marketing pages / Hostinger promo** — leave for now. add it in the backlog
