# YumeRise Next — Architecture Decision Record

Format: context → decision → alternatives → consequences. Status: `Accepted`,
`Open`, or `Superseded`. Evidence paths refer to the read-only reference workspace
(`../../OLDER/yume rise/…`, `../../REPOS/…`, `../../BETTER UI REPOS/…`).

---

## ADR-001 — Build in a new isolated project, reference code stays untouched

**Status:** Accepted
**Context:** The reference codebase carries an uncommitted body of work (Phase 2A–2I
audit) that must be preserved; the workspace root is not a git repository, so in-place
reorganization risks losing work with no history to recover from.
**Decision:** All new work happens in `NEW/YumeRise-Next/`. Reference repositories are
read-only inputs. Nothing is copied wholesale; reuse is deliberate, file-by-file, and
recorded in the README reuse table.
**Alternatives:** in-place refactor of `OLDER/yume rise` (rejected: risks uncommitted
work); wholesale copy then edit (rejected: inherits monolith, XSS sinks, gamification).
**Consequences:** some duplication during migration; originals remain auditable as-is.

## ADR-002 — Adapt the existing Express/Prisma API instead of replacing it

**Status:** Accepted
**Context:** The reference API has 113 passing tests (`backend/tests/`, verified by run),
consistent per-user scoping (`taskService.js:16-20` pattern), a working idempotency layer
(`backend/src/utils/idempotency.js`), and transactional focus writes (`focusService.js:60-76`).
**Decision:** Port services/routes into `services/api/` with deliberate scope surgery
(see ADR-008, ADR-003), keeping the test harness (`tests/helpers/fakeStore.js`).
**Alternatives:** rewrite (rejected: re-earns tested behavior for no user-visible gain);
keep as-is unmodified (rejected: gamification and auth surfaces must change).
**Consequences:** port must fix known gaps: no idempotency TTL, auth-only rate limiting,
client-trusted focus duration, no analytics aggregates.

## ADR-003 — Authentication and sync identity design

**Status:** **Open — must be resolved before Phase 5 route work**
**Context:** Product direction (confirmed) is account-based authentication with
cross-device synchronization. The reference stack offers: session tokens stored hash-only
(`authService.js:124-136`), httpOnly cookie + bearer dual mode
(`middleware/authenticate.js:11-27`), 3-step signup with OTP (`authService.js:261-363`),
per-service scoping by `req.user.id`, and rate limits on auth routes only.
**Decision needed:** full reuse of the reference auth stack vs. a slimmed flow (e.g.
email+password only, deferring OTP) for v1 — and how the Android boot gate
(`MainActivity.kt:67-71`) and the web boot (`main.js:1223-1239`) adopt it.
**Constraint:** no weakening of authentication/authorization; no secrets in the repo;
production TLS must be valid before any deployment.
**Alternatives considered:** local-first-no-accounts (superseded by confirmed direction);
silent device session (superseded by confirmed direction).

## ADR-004 — Web stays modular vanilla JavaScript

**Status:** Accepted (confirmed D6)
**Context:** Reference web is a 1,433-line monolith (`frontend/src/main.js`) with full
innerHTML re-render (`render()`, `main.js:173-184`), no URL state (`let view`, `:27`),
and four unescaped sinks (`:170`, `:462`, `:779`, `:422`).
**Decision:** split into view modules + one escaping helper + targeted partial updates +
URL-addressable navigation. Zero runtime dependencies unless a future ADR approves one.
**Alternatives:** framework migration (rejected: confirmed decision + project rules);
vendoring a small reactive diffing core (`REPOS/puredashboard/src/reactive.js`, MIT) —
held as a *future* option if partial rendering proves insufficient.
**Consequences:** rendering discipline is enforced by review/tests, not by a framework.

## ADR-005 — Android remains XML + ViewBinding

**Status:** Accepted (confirmed D7)
**Context:** The reference app is XML/ViewBinding with a custom single-activity screen
stack, a durable offline focus queue (`focus/FocusPendingStore.kt`), WorkManager sync,
and a foreground timer service — but zero tests, zero `contentDescription`s, and a
dark-only theme.
**Decision:** keep XML/ViewBinding; port the offline/native strengths; add tests,
accessibility, light theme, edge-to-edge during Phase 7.
**Alternatives:** Compose migration (rejected: confirmed decision; would also migrate
away from the only tested-by-nothing surface with no way to detect regressions).

## ADR-006 — One token source, generated per platform

**Status:** Accepted
**Context:** Both platforms already share an identity (violet `#B98EF1` accent:
`frontend/src/style.css:24`, `android/.../values/colors.xml:8`) but maintain values by
hand in two formats; CSS and Android XML cannot consume each other.
**Decision:** `packages/design-tokens/tokens.json` is the single source; a small
generator (Node, no dependencies) emits CSS custom properties and Android
`colors.xml`/`dimens.xml`; a check command fails on drift.
**Alternatives:** hand-maintained parallel files (rejected: guaranteed drift);
a token build dependency like Style Dictionary (rejected: unnecessary dependency).

## ADR-007 — Charts are hand-written SVG

**Status:** Accepted (confirmed D8)
**Context:** No reference repository contains reusable chart code — the only charts are
hardcoded demo SVG (`REPOS/glassmorphism-dashboard/index.html:848-864`, unlicensed) and
CSS divs in the reference web (`main.js:558,578`).
**Decision:** implement minimal SVG chart primitives (bars, line, ring) with accessible
text/table alternatives and non-color-only state cues.
**Consequences:** more implementation effort; full control over size, theme, and a11y.

## ADR-008 — Remove gamification, add neutral analytics

**Status:** Accepted (confirmed D9/D10)
**Context:** XP/streaks/achievements/leaderboard are server-authoritative and threaded
through completion hooks (`progressionService.js`, called from `taskController.js:32`,
`goalController.js:8,29,57`, `focusService.js:64-72`), six models
(`schema.prisma:302-374`), two routes (`progression.js`, `leaderboard.js`), and Android
screens (`ProgressScreen.kt`, `LeaderboardScreen.kt`, XP/streak cards in
`view_home.xml`). "Progress" screens in reference imagery show *visibility of progress*,
not points.
**Decision:** remove gamification models, routes, hooks, and UI; replace the progress
surface with neutral analytics (completion rate, focus minutes, trends) per Phase 8.
**Consequences:** completion paths simplify; `/leaderboard`, `/admin`, OTP email lose
their reason to exist; test suite needs corresponding replacement tests.

## ADR-009 — Web offline uses an IndexedDB outbox keyed to server idempotency

**Status:** Accepted
**Context:** Web currently has no offline story (no IndexedDB/service worker/outbox;
failure comment at `main.js:751-754`). Android's queue
(`FocusPendingStore.kt`: add-before-network, remove-after-confirm, owner scoping) is the
proven pattern; the server already dedupes via `Idempotency-Key` with hash-conflict 409s.
**Decision:** mirror the Android contract in an IndexedDB outbox; every mutating request
carries an idempotency key; pending count is surfaced in the UI; service worker caches the
app shell. Server side gains key TTL/cleanup (Phase 5).
**Consequences:** exactly-once offline writes become testable on both clients.

## ADR-010 — Reuse and licensing rules for reference material

**Status:** Accepted
**Decision:** code may be re-implemented from sources that are MIT/Apache-2.0 or our own;
**never** from GPL (`REPOS/habit-tracker`, copyleft) or from repos with no license file
(`daily-planner-app`, `glassmorphism-dashboard`, `liquid-glass-ui-kit`,
`dashboard-ui-main`). Reference images are visual inspiration only — never shipped assets.
**Consequences:** all reused patterns are re-written into our own modules with attribution
noted here where required (Apache-2.0 patterns: safe-area/bottom-bar from
`javascript-mobile-app-template`).

## ADR-011 — Version control decision deferred

**Status:** Open (low urgency)
**Context:** Workspace root is not a git repository; only `OLDER/yume rise` has history.
Initializing a repository requires explicit approval.
**Decision needed:** initialize git in `NEW/YumeRise-Next` before Phase 4 code lands.
