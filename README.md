# YumeRise Next

A polished, welcoming productivity experience for phone and laptop: tasks, schedules,
focus sessions, and neutral progress analytics — with account-based authentication and
cross-device synchronization.

This repository is the **new** project. The code under `../../OLDER/` and the reference
repositories under `../../REPOS/`, `../../BETTER UI REPOS/`, `../../DESKTOP UI/` are
**read-only reference material** and are never modified by work in this folder.

---

## 1. Product purpose

YumeRise Next helps a person plan the day, protect focus time, and see honest progress.

- **Plan** — tasks with checklists, scheduled time blocks, a today/pending view that
  recovers missed work instead of silently losing it.
- **Focus** — a focus timer whose sessions are recorded durably on the client and written
  exactly once on the server.
- **Progress** — neutral analytics (completion rates, focus minutes, trends). No points,
  no leaderboards.

## 2. Confirmed decisions (fixed — do not reopen in implementation)

| # | Decision |
|---|---|
| D1 | Product name: **YumeRise Next** |
| D2 | Identity: **account-based authentication with cross-device synchronization** |
| D3 | Visual direction: **Calm Focus** — polished, welcoming; per the Exact Theme Color Specification: light = white/cool-white surfaces with **purple primary `#7C5CFC`**, teal-green progress, coral/sky/lavender/mint tags; dark = near-black surfaces with **Rose (default) or Graphite accent palettes**, warm golden tan secondary |
| D4 | **Light and dark themes** both supported and both verified; **System (OS)** mode available; dark accent picker shown only when Dark is explicitly chosen |
| D5 | **Mobile-first**, with a deliberately designed desktop experience |
| D6 | Web: **modular vanilla JavaScript** — no React/framework migration |
| D7 | Android: **Capacitor 8** wrapping the shared web client (per the frontend-rebuild directive; supersedes the earlier native-XML direction) |
| D8 | Charts: **dependency-free SVG** |
| D9 | **Remove** XP, streaks, achievements, leaderboards from the product direction |
| D10 | Replace gamified progress with **neutral, useful analytics** |
| D11 | **Defer** notes, categories, habits unless later explicitly approved |

These confirm the Phase 2 report's open questions as follows: identity → account-based
sync (Phase 2 §I-1 option C direction), web architecture → modular vanilla (§I-3 option a),
charts → hand-rolled SVG (§I-2), Android toolkit → XML/ViewBinding (§I-6).

## 3. Planned structure

```
NEW/YumeRise-Next/
├── README.md                  # this file
├── docs/
│   ├── IMPLEMENTATION_PLAN.md # phased plan with acceptance criteria
│   └── ARCHITECTURE_DECISIONS.md  # decision record: what/why/alternatives
├── index.html                 # Vite entry point
├── capacitor.config.json      # Capacitor 8 config (webDir: dist)
├── android/                   # generated Capacitor Android platform
├── src/
│   ├── main.js                # app entry: shell + router wiring
│   ├── core/                  # dom, icons, theme, router, db (IndexedDB), utils
│   ├── data/                  # repositories (tasks, goals, sessions, blocks)
│   ├── ui/                    # kit (dialog/toast/states), components, SVG charts
│   ├── views/                 # home, tasks, plan, focus, goals, progress, settings
│   ├── features/focus/        # focus timer (survives navigation)
│   ├── native/                # Capacitor bridge with graceful web fallbacks
│   └── styles/                # tokens, base, shell, components, views
└── tests/                     # node --test suite (pure logic)
```

No API service exists yet — the client is local-first (IndexedDB) until account
sync is designed (ADR-003, open).

## 4. Technology choices

| Layer | Choice | Why |
|---|---|---|
| API | Node.js + Express + Prisma + PostgreSQL (adapted, not rewritten) | Reference backend has 113 passing tests, complete per-user scoping, and a working idempotency layer; rewriting re-earns none of it. See ADR-002. |
| Web | Vite + modular vanilla ES modules, zero runtime dependencies today | Honors D6; reference `main.js` monolith is split into view modules with one shared escaping helper. |
| Android | Kotlin, XML layouts, ViewBinding, Retrofit, WorkManager | Honors D7; reference app already has a durable offline focus queue to adapt. |
| Tokens | One JSON source → generated CSS custom properties + `values/colors.xml` | CSS and Android XML cannot consume each other; generation removes drift. |
| Charts | Hand-written SVG | Honors D8; reference repos contain no reusable chart code anyway (Phase 2 §B3). |
| Testing | `node --test` (API), browser-level checks (web), JVM unit tests (Android) | Matches what the reference project already runs successfully. |

## 5. How this project is run and tested

Current commands (verified in this environment):

- **Web app** — in the project root: `npm install`, then `npm run dev` (dev server,
  port 5180) or `npm run build && npm run preview` (production bundle check).
- **Unit tests** — `npm test` runs the `node --test` suite over `tests/` (pure logic:
  date/label/time helpers).
- **Android** — the Capacitor 8 platform lives in `android/` (generated by
  `npx cap add android`; web assets sync into it with `npx cap sync`). Compiling the
  APK still requires a JDK 17 toolchain, which is not available on this machine —
  see risks.

Report rules that apply to every phase: state which checks actually ran, their real
results, and what remains unverified. Never claim a platform was tested when it was not.

## 6. Reuse assessment (from the Phase 2 audit — evidence in `docs/ARCHITECTURE_DECISIONS.md`)

**Strong candidates for reuse (adapt, then verify):**
- API task/goal/time-block/pending services + ownership scoping — `backend/src/services/*`
- Idempotency layer and expiry reconciliation — `backend/src/utils/idempotency.js`, `services/expiryService.js`
- Focus-session transactional write — `services/focusService.js`
- Test harness (in-memory store) — `backend/tests/helpers/fakeStore.js`
- Android offline queue and encrypted session storage — `focus/FocusPendingStore.kt`, `auth/SessionStore.kt`
- Android WorkManager sync — `sync/SyncWorker.kt`, `sync/FocusSyncWorker.kt`
- Three-tier design-token model (MIT, `puredashboard`) and safe-area/bottom-bar patterns
  (Apache-2.0, `javascript-mobile-app-template`) as *patterns*, re-implemented

**Must be redesigned (kept as capability, rebuilt as implementation):**
- Web rendering layer — 1,433-line monolith, full innerHTML re-render, no URL state,
  four unescaped HTML sinks (`main.js:170`, `:462`, `:779`, `:422`)
- Web offline story — none exists (no IndexedDB, no service worker, no outbox)
- Web theme system — light-theme class-scope bug (`main.js:178` vs `main.js:776`),
  no `prefers-color-scheme`
- Gamification surfaces and models (XP/streaks/achievements/leaderboard) — removed per D9/D10,
  replaced by a neutral analytics surface
- Android accessibility (zero `contentDescription`s), Android light theme (none exists),
  Android edge-to-edge handling
- Notifications/settings presentation on both clients

**Deferred (not in scope until approved):** notes, categories/tags, habits/routines,
push notifications, admin/moderation surfaces, OTP email delivery.

**Rejected as source code:** GPL-licensed `habit-tracker` (copyleft), all reference repos
without a license file (`daily-planner-app`, `glassmorphism-dashboard`,
`liquid-glass-ui-kit`, `dashboard-ui-main`) — ideas only, never code.

## 7. Known risks and unresolved technical questions

**Security (inherited findings, must not be reintroduced):**
- Four XSS sinks in the reference web client (paths above) — the redesign's escaping
  helper is a hard requirement, not a nice-to-have.
- Reference Android config allows cleartext HTTP to a legacy production host and the
  reference production TLS certificate was issued for the wrong domain and expired.
  YumeRise Next must ship **no** production endpoints in code; base URLs come from
  configuration only, and TLS must be correct before any deployment.
- Rate limiting in the reference API covers only auth routes.
- Focus duration is client-reported; the API must validate plausibility, not trust it.

**Architecture:**
- **Identity implementation is not yet designed (ADR-003, open).** Account-based sync is
  confirmed as product direction, but the concrete session/registration flow for
  YumeRise Next — reusing the reference auth stack vs. slimming it — is the next
  architectural decision and must be recorded before API work starts.
- Idempotency keys never expire in the reference implementation; a TTL/cleanup step is needed
  before broad offline queuing.
- The reference test suite runs against an in-memory store; PostgreSQL behaviour remains
  unverified until an approved integration run happens.
- Token generation must be wired into a check so generated CSS/Android files cannot drift.

**Toolchain / environment:**
- No JDK 17 available on this machine → Android cannot be compiled or tested yet
  (needs explicit approval to install or point at a toolchain).
- No database may be created without approval → API validation runs on its in-memory
  test harness only, for now.
- The workspace root is not a git repository; version control for YumeRise Next is an
  explicit, later decision.
