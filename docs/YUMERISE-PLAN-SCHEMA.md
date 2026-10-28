# YumeRise import schema (for ChatGPT-generated plans)

The exact JSON shape YumeRise Next accepts on **Settings → Import data**.
Give this whole document to ChatGPT when you ask it to prepare a plan.

Everything below is validated **before anything is written**. One invalid
record is skipped and reported by name; it never blocks the rest of the file
and never half-imports.

---

## File header (required)

```json
{
  "app": "yumerise-next",
  "version": 1,
  "kind": "chatgpt-plan",
  "tasks": [],
  "blocks": []
}
```

| Field | Rule |
| --- | --- |
| `app` | Must be exactly `"yumerise-next"`. Anything else is rejected as a foreign file. |
| `version` | Must be the integer `1`. Newer versions are rejected with an explanation; missing/non-integer versions are rejected as not-an-export. |
| `kind` | For plans: exactly `"chatgpt-plan"`. Marks the file as future records — any `sessions` array present is **ignored with a note** (plans can never create focus history). |
| `exportedAt` | Optional ISO 8601 timestamp. Records without `createdAt`/`updatedAt` inherit it, so re-importing the same file twice is a no-op. |

Unknown top-level keys are ignored and reported as skipped. A `"guide"`
block, if present, is treated as documentation only — never imported.

## Records

### `tasks` — new or updated

```json
{
  "id": "task-2026-10-27-outline",
  "title": "Outline the launch post",
  "description": "",
  "date": "2026-10-27",
  "startTime": "09:00",
  "endTime": "10:30",
  "priority": "High",
  "status": "todo",
  "checklist": [
    { "id": "step-1", "text": "Bullet points", "done": false }
  ],
  "createdAt": "2026-10-23T10:00:00.000Z",
  "updatedAt": "2026-10-23T10:00:00.000Z"
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | Non-empty string, ≤128 chars. Unique per record. |
| `title` | yes | Non-empty string, ≤500 chars. |
| `description` | no | ≤5000 chars. |
| `date` | no | `YYYY-MM-DD` (a real calendar date). Omitted → the file date. |
| `startTime` | yes | `HH:MM` (00:00–23:59) or `""` for “no time”. |
| `endTime` | yes | `HH:MM` (00:00–23:59) or `""`. |
| `priority` | yes | Exactly `"Low"`, `"Medium"` or `"High"`. |
| `status` | yes | Exactly `"todo"` or `"done"`. |
| `checklist` | no | ≤200 items: `{ "text": "...", "done": false }` (`id` optional). `done` must be a real boolean. |
| `createdAt`, `updatedAt` | no | ISO 8601 (`2026-10-23T10:00:00.000Z` — always include the `Z` or an offset). |

### `blocks` — plan time slots

```json
{
  "id": "block-2026-10-27-morning",
  "title": "Deep work: launch post",
  "date": "2026-10-27",
  "startTime": "09:00",
  "endTime": "10:30",
  "linkedTaskId": "task-2026-10-27-outline"
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | Non-empty string, ≤128 chars. |
| `title` | yes | Non-empty string, ≤500 chars. |
| `date` | recommended | `YYYY-MM-DD`, or omitted/`null` (the block then has no day). |
| `startTime` | recommended | `HH:MM`; omitted defaults to `09:00`. |
| `endTime` | yes | `HH:MM` or `""`. |
| `linkedTaskId` | no | Must reference a task id that exists (in the file or already in YumeRise); otherwise the link is detached, not imported broken. |
| `createdAt`, `updatedAt` | no | ISO 8601. |

### `goals` — new goals (or progress updates to existing ids)

```json
{
  "id": "goal-read-2-books",
  "title": "Read 2 books",
  "kind": "active",
  "progress": 30,
  "target": 2,
  "current": 0.6,
  "unit": "books",
  "note": ""
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | Non-empty string, ≤128 chars. |
| `title` | yes | Non-empty string, ≤500 chars. |
| `kind` | yes | Exactly `"active"` or `"long"`. |
| `progress` | yes | Number `0`–`100` (a JSON *number*, not a string). |
| `target`, `current` | no | Numbers ≥ 0 (negatives clamp to 0). |
| `unit` | no | ≤40 chars. |
| `note` | no | ≤5000 chars. |
| `done` | no | Real boolean `true`/`false`. |
| `createdAt`, `updatedAt` | no | ISO 8601. |

### `sessions` — **not allowed in plan files**

Focus sessions record time that actually happened. A `"kind": "chatgpt-plan"`
file's `sessions` array is dropped before validation, with a note in the
preview. Only a real YumeRise export (`"kind": "chatgpt-export"`, which the
app itself produces) may contain sessions.

## Limits

- File ≤ 5 MB; ≤ 20 000 records per collection; ≤ 60 000 records total.
- Any single string ≤ 8 192 chars (titles/checklists are capped lower, above).
- Timestamps must be parseable by `Date`; prefer full ISO 8601 with `Z` or an
  offset (timezone-naive strings are accepted but day attribution can shift).

## What gets rejected (before any write)

Non-JSON files · wrong `app` · missing/older/newer `version` ·
non-array sections · missing/oversized `id` or `title` · invalid `date`
(e.g. `2026-13-40`, `10/27/2026`) · invalid `time` (e.g. `9am`, `24:00`) ·
`priority` outside Low/Medium/High · `status` outside todo/done ·
goal `kind` outside active/long · non-numeric or out-of-type
`progress`/`minutes` · string `done` values (`"false"` is never read as done).

## Duplicates and strategies

- Inside a file: same `id` twice → the **last** one wins, with a note.
- Merge (default): new ids are added; byte-identical records are reported as
  *identical* and skipped; same id with different content is a *conflict*
  you decide on. Unrelated stored data is untouched.
- Replace: explicit confirmation required; deletes everything absent from the
  file. Do not use it for plan imports.

## Safety

Imported values are type-checked, length-capped and copied into fresh
objects; prototype-polluting keys (`__proto__` etc.) are dropped; strings are
only ever rendered as text — no imported content can execute code, HTML or
commands. The final write is one atomic transaction: a failure changes
nothing.

## Keep plans honest

- New work: future `date`, `status: "todo"`.
- Marking something `"done"` in a file **counts as completed work** in
  Progress analytics — only do that for work you actually finished.
- Never invent `sessions`; the import path refuses them in plan files.
- Timestamps: include `Z`/offset; `createdAt` in the future will look odd on
  the Progress screen.

---

## Minimal valid example

Also available as a file: `docs/yumerise-plan.example.json`.

```json
{
  "app": "yumerise-next",
  "version": 1,
  "kind": "chatgpt-plan",
  "exportedAt": "2026-10-23T09:00:00.000Z",
  "tasks": [
    {
      "id": "task-2026-10-27-outline",
      "title": "Outline the launch post",
      "description": "",
      "date": "2026-10-27",
      "startTime": "09:00",
      "endTime": "10:30",
      "priority": "High",
      "status": "todo",
      "checklist": [
        { "id": "step-1", "text": "Bullet points", "done": false },
        { "id": "step-2", "text": "Pick screenshots", "done": false }
      ]
    },
    {
      "id": "task-2026-10-28-budget",
      "title": "Review budget",
      "description": "",
      "date": "2026-10-28",
      "startTime": "",
      "endTime": "",
      "priority": "Medium",
      "status": "todo",
      "checklist": []
    }
  ],
  "goals": [
    {
      "id": "goal-read-2-books",
      "title": "Read 2 books",
      "kind": "active",
      "progress": 30,
      "target": 2,
      "current": 0.6,
      "unit": "books",
      "note": ""
    }
  ],
  "blocks": [
    {
      "id": "block-2026-10-27-morning",
      "title": "Deep work: launch post",
      "date": "2026-10-27",
      "startTime": "09:00",
      "endTime": "10:30",
      "linkedTaskId": "task-2026-10-27-outline"
    }
  ]
}
```
