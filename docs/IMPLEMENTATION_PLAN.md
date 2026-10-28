# YumeRise Next — Implementation Plan

Companion to `../README.md`. Decisions here are consistent with the confirmed product
decisions (D1–D11 in the README) and preserve the findings of the Phase 2 investigation
report in `../../AGENTS`-adjacent workspace documentation.

Rules for every phase:
- Work stays inside `NEW/YumeRise-Next/`; the reference repositories are read-only.
- Every phase ends with a report: what ran, real results, what remains unverified.
- No secrets, credentials, or production endpoints are ever written into this repository.
- No claim of PostgreSQL, Android, browser, or end-to-end testing unless it actually ran.

---

## Phase status

| Phase | Name | Status |
|---|---|---|
| 3 | Foundation + reference-web validation | **current** |
| 4 | Design tokens + web shell | not started |
| 5 | API adaptation (accounts + core resources) | not started |
| 6 | Web core flows (tasks, schedule, focus) | not started |
| 7 | Android bring-up (build, a11y, light theme) | not started |
| 8 | Neutral analytics + charts (SVG) | not started |
| 9 | Cross-device sync verification | not started |

---

## Phase 3 — Foundation and reference validation (current)

**Scope**
1. Create this project skeleton, `README.md`, and these docs.
2. Launch the reference web application locally and record real observations
   (startup, errors, responsive behavior at phone and desktop widths, both themes where reachable).
3. Document reference run commands, dependencies, and limitations from manifests.

**Acceptance criteria**
- [x] `NEW/YumeRise-Next/` exists with README + `docs/` (this file, `ARCHITECTURE_DECISIONS.md`).
- [ ] Reference web app startup attempted, with actual output recorded in
      `docs/REFERENCE_APP_VALIDATION.md`.
- [ ] Browser inspection performed *or* the exact blocker documented.
- [ ] No original file anywhere in the workspace modified.

**Explicitly out of scope:** new features, API changes, Android builds, database creation,
JDK installation, git initialization.

---

## Phase 4 — Design tokens and web shell

**Scope:** `packages/design-tokens/tokens.json` as single source → generator emitting CSS
custom properties and Android `colors.xml`; web app shell with modular view files, a
single escaping helper, URL-addressable navigation, light/dark themes honoring D3/D4/D5.

**Acceptance criteria**
- Token generation is reproducible and drift is detectable by a check command.
- Every interpolation path goes through the escaping helper (no raw `innerHTML` of user text).
- Shell verified at ≈360 px and ≥1280 px in **both** themes; keyboard focus visible;
  `prefers-reduced-motion` respected.
- Mobile: bottom navigation with safe-area padding; desktop: sidebar layout (Calm Focus, Phase 2 §E2).

## Phase 5 — API adaptation (accounts + core resources)

**Scope:** adapt the reference API into `services/api/`: retain task/checklist, time-block,
pending/expiry, and focus-session services with per-user scoping; **remove** XP, streak,
achievement, leaderboard, and admin surfaces (D9); decide and record the concrete
authentication/session design per ADR-003 **before** writing routes.

**Acceptance criteria**
- Test suite adapted from the reference harness passes, with gamification tests removed
  and neutral-analytics tests added; results reported honestly.
- Idempotency TTL/cleanup implemented for offline queuing.
- Focus duration validated server-side (plausibility bounds), not trusted blindly.
- No production endpoint or secret in any file.

## Phase 6 — Web core flows

**Scope:** tasks + checklists, schedule/time blocks, today/pending recovery, focus timer
with IndexedDB outbox (add-before-network, remove-after-confirm, `Idempotency-Key` per
mutation), settings/theme.

**Acceptance criteria**
- Offline create → reconnect → exactly-once effect demonstrated by a test.
- Each data component ships empty/loading/error/partial/offline states (Phase 2 §E,
  `designing-user-experience` state matrix).
- 44×44 px minimum targets, no hover-only affordances, forms with labels above inputs.

## Phase 7 — Android bring-up

**Scope:** compile the adapted Android app (requires approved JDK 17), port tokens,
add `contentDescription`s, light theme, edge-to-edge insets, unit tests for the offline queue.

**Acceptance criteria**
- `assembleDebug` result reported truthfully (pass/fail/blocked).
- Offline focus queue covered by JVM unit tests.
- Light and dark themes both verified on device or emulator — or explicitly marked unverified.

## Phase 8 — Neutral analytics (dependency-free SVG)

**Scope:** server-side aggregates (completion rate, focus minutes, trends) + hand-written
SVG charts with accessible text/table alternatives.

**Acceptance criteria**
- No chart dependency added.
- Charts convey state without relying on color alone; contrast verified in both themes.

## Phase 9 — Cross-device sync verification

**Scope:** prove account-based sync end to end with **real** accounts and two clients.

**Acceptance criteria**
- Actual end-to-end run reported — never simulated with mock data.
- Conflict behavior documented for focus sessions and task edits.
