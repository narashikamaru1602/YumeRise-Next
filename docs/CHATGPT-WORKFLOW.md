# Working with ChatGPT — YumeRise Next data exchange

YumeRise Next stores everything locally (IndexedDB). This workflow moves data
**manually**, file by file, through your own ChatGPT account. There is no API
key, no plug-in and no automatic integration — you upload and download files
yourself. Nothing is sent anywhere until *you* upload a file.

Two file types, two jobs:

| File | Purpose |
| --- | --- |
| **JSON** (`.json`) | Structured **exchange**: analysis inputs, and *importing* plans ChatGPT prepares. Machine-validated, round-trippable. |
| **PDF** (`.pdf`) | Readable **analysis**: a printed report of your Progress data for ChatGPT (or a human) to read. Not importable — PDFs are for review, JSON is for data. |

---

## 1. Export a ChatGPT-ready JSON file

1. Open **Settings → Your data → Export for ChatGPT**.
2. The browser downloads `yumerise-chatgpt-export-YYYY-MM-DD.json`.

The file contains the same records and schema version as a normal
**Export data** download, plus:

- `"kind": "chatgpt-export"` — marks the file for the import step below.
- `"guide"` — human-readable field documentation (priority values, date
  formats, excluded fields) so ChatGPT can interpret the records correctly.
- Your records: `tasks`, `goals`, `sessions`, `blocks`.

Plain **Export data** still works unchanged and remains fully backward
compatible.

## 2. Upload it into ChatGPT and ask for analysis

Create a new chat and attach the `.json` file with a prompt such as:

> Attached is my YumeRise export (JSON). Analyse it: task completion rate and
> outstanding work by priority, focus-time totals and trends from the
> `sessions` array, and goal progress from `goals`. Cite the exact records you
> base each number on, and tell me if any period looks too thin to judge.

Tips:

- The `guide` block inside the file documents every field — mention it:
  “The file includes a `guide` describing each field.”
- Ask for **date ranges** in answers so figures stay tied to a period.
- Treat ChatGPT's numbers as *its* analysis of your data — the app's own
  Progress screen and PDF report remain the source of truth.

## 3. Ask ChatGPT to prepare a future plan (importable format)

Point ChatGPT at the schema document — paste `docs/YUMERISE-PLAN-SCHEMA.md`
into the chat (or attach it) and say:

> Using the attached YumeRise import schema, prepare a JSON plan for next week:
> tasks with `status: "todo"` and future `date` values, plus plan blocks for
> each workday. Output only one JSON object, starting with
> `"app": "yumerise-next"` and `"kind": "chatgpt-plan"`. Do **not** include a
> `sessions` array, and do not mark anything `done` unless I say so.

Rules ChatGPT must follow (they are in the schema doc too):

- Exactly `"app": "yumerise-next"`, `"version": 1`, `"kind": "chatgpt-plan"`.
- Only `tasks`, `goals` (optional) and `blocks`. **No sessions** — plans can
  never create focus history that never happened; if a sessions array is
  present anyway, YumeRise drops it before validation and tells you.
- Priorities are exactly `Low`, `Medium`, `High`. Statuses are exactly
  `todo`, `done`. Dates are `YYYY-MM-DD`; times are `HH:MM`.
- Every record needs its own unique `id` string.

A ready-to-use file sits next to this document:
`docs/yumerise-plan.example.json`.

## 4. Validate and import the resulting file

1. Save ChatGPT's answer as a `.json` file (start with `{`, end with `}`).
2. In YumeRise: **Settings → Your data → Import data** and pick the file.
3. The **preview** appears *before* anything is written: per-collection counts,
   invalid records listed by reason, and notes (e.g. “2 focus sessions in this
   plan file were ignored”).
4. Choose a strategy:
   - **Merge** (default) — adds new records, reports identical ones as
     skipped, and flags id-conflicts for an explicit decision. Existing data
     stays untouched otherwise.
   - **Replace** — requires an explicit confirmation and deletes records
     absent from the file. Never use it for plan imports.
5. **Cancel** at any step (including the final confirm) — nothing is written
   until the last step, and that write is atomic (all stores in one
   transaction; failure changes nothing).

Rejected before any write: invalid JSON, a file that is not a YumeRise export
(`app`/`version` mismatch), versions newer than 1, non-array sections, records
with invalid ids, titles, dates, times, priorities, statuses, goal kinds,
session durations or oversized strings. Invalid *records* are skipped and
listed; they never partially import.

Duplicate handling is deterministic: inside a file, the same `id` twice keeps
the **last** occurrence (reported); against stored data, an identical record is
counted as *identical* (skipped) and a different record with the same id is a
*conflict* you choose on record-by-record.

**Keep plans honest:** give new tasks future dates and `status: "todo"`.
Importing a task marked `done` with a past date *will* count as completed work
and change your Progress figures — that is real data entry, not something the
app can detect. Never ask ChatGPT for `sessions`; they are the one section a
plan file cannot write.

## 5. Export a PDF Progress report and upload it

1. Open **Progress**, pick the period (This week / Last week / month / 90 days
   / all time) with the existing controls.
2. Press **PDF report** (top-right). The browser downloads
   `yumerise-progress-YYYY-MM-DD.pdf`, generated locally in a second or two.
3. Upload the PDF into ChatGPT:

> Attached is my YumeRise progress report for the labelled period. Summarise
> the trends, call out anything unusual, and suggest one adjustment for next
> week. Use only figures printed in the report.

The report includes its reporting period, generation date, metrics, task /
focus / goal sections (only where data exists) and a methodology section with
definitions and limitations — everything ChatGPT needs to interpret it
correctly. Text stays selectable inside the PDF.

## 6. What is included and excluded

**JSON export (`Export for ChatGPT`):**

- Included: tasks (status, priority, dates, checklists), goals (progress,
  targets), focus sessions (**actual** recorded minutes), plan blocks, export
  timestamp and schema version, plus the interpretation `guide`.
- Excluded: appearance settings and preferences (theme, accent, focus
  duration), application internals, and any credentials — YumeRise stores
  none; there are no accounts, tokens or secrets in the app.

**PDF report:** only the aggregated figures of the selected period, computed
from your local records. The file states this on its cover.

**Nothing** in either flow is uploaded by the app itself: exports and PDFs are
built and downloaded on your device; uploading them to ChatGPT (or anywhere)
is your deliberate action.

## 7. Why JSON for imports and PDF for analysis

- **JSON** is strict, schema-validatable structure. YumeRise can check every
  field *before* writing anything, keep the write atomic, and report exactly
  what changed — impossible with prose or PDF.
- **PDF** is the readable, printable form: designed pages a person (or ChatGPT
  reading the file) can follow as a narrative. It is intentionally one-way —
  figures for review, not data for import.

**In short:** JSON out → analyse or extend with ChatGPT → validate and merge
plans back in. PDF out → share a readable snapshot of your progress.
