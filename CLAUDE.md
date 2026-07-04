# SidieGolf — Claude Context

## What this is
SidieGolf is a real-time golf scoring and side-game betting web app. It is a **single-file HTML app** — the entire application lives in `index.html`. All logic, styles, and markup are in that one file. Do not create separate CSS/JS files.

## The only file you should edit
**`index.html`** — this is the production file. Edit only this file unless instructed otherwise.

## Tech stack
- Vanilla JavaScript (no frameworks)
- Firebase compat SDK v10.14.1 (loaded via CDN): `firebase-app-compat`, `firebase-auth-compat`, `firebase-firestore-compat`
- Firebase Anonymous Authentication
- Firestore for real-time sync across devices
- Vercel for hosting + a single serverless function at `api/ghin-lookup.js`

## Critical: Firestore field values
Firestore rejects `undefined` field values and will throw `Unsupported field value: undefined`. Always use `null` or omit the key entirely. When building `_courseData` from API-fetched courses, wrap with `JSON.parse(JSON.stringify(...))` to strip any undefined values.

## Key functions / architecture
- `fbSerializeState()` — serializes app state into Firestore. `_courseData` must never have undefined fields.
- `buildCtx(idxs, course, tee, sc, handicapPct)` — builds engine context for handicap computation. `handicapPct` defaults to 100.
- `buildSingleLeaderboardAndLedgerHtml()` — renders leaderboard + money ledger. Each game gets its own scoped ctx using only that game's participants.
- Nassau games: each match uses `buildCtx(g.participants, ...)` — NOT the full group ctx. This ensures strokes are anchored to the lowest HCI among the match participants, not the whole group.
- `computeSmartPayout(ledgerByIdx)` — returns minimal net payment transactions.
- `window._sidieLastLedger` — caches last ledger for Settle Up overlay.
- `state.venmoHandles` — `{ playerName: '@handle' }` stored top-level in Firestore (not inside state blob) via dot-notation update.
- `fbSaveVenmoHandle(playerName, handle)` — saves a single Venmo handle to Firestore.
- `fbFinishRound()` — saves completed round to history. Uses `MOCK_COURSES[s.course].name` for course name (not `s.course.name`).

## GHIN API
The GHIN handicap lookup only works from `https://sidiegolf.com` due to CORS. It will fail in local/dev environments — that's expected.

## Privacy — IMPORTANT
- Never reference `bartoncreeklending.com` or `jason.m.inmon@gmail.com` anywhere in the code or comments.
- App contact email is `sidiegolf.app@gmail.com`.

## Deploy
Commits to `main` auto-deploy to production via Vercel. No manual deploy step needed — just commit your changes.

## How to make a fix
1. Edit `index.html` with the fix
2. Commit with a descriptive message
3. Vercel deploys automatically

## Firestore security rules
Current rules expire **July 25, 2026**. Before that date, update the rules in the Firebase console to proper production rules (not the open `allow read, write` rule).

## Testing
The app is live at `https://sidiegolf.com`. The manager starts a round and joiners connect via the round code. Anonymous auth is used for all players.
