# Task 1 — Today Board projection and package lifecycle

## Result

Implemented the durable Today Board lifecycle on top of the existing persisted page states. `unformed`, `draft`, and `sealed` remain persisted states; `raw`, `compiled`, `stale`, and `sealed` are derived modes exposed with the notebook state.

## Files changed

- `src/today-board.ts` — evidence revision manifest, package-generation model, legacy-generation upgrade, and raw/compiled/stale/sealed projection.
- `tests/today-board.test.ts` — projection and evidence-fingerprint behavior.
- `app/desktop/api.ts` — schema-3 page fields and derived `todayBoard` state.
- `app/desktop/notebook-store.ts` — generation append/activation, failure recording, normalization, and state projection.
- `tests/notebook-store.test.ts` — append-only refresh, failed compilation preservation, and schema-1/2/legacy-note normalization.

## Design choices

- Page schema 3 adds `packageGenerations`, `activePackageGenerationId`, and `lastCompilationError`, while retaining `reviewPackage` as a compatibility mirror of the active generation.
- A generation keeps the normalized compiler package plus a lightweight manifest of stable session identity (`provider:id:path`) and revision metadata. The package's own admitted evidence is the authority for inclusion.
- Staleness compares the current session manifest with the active generation manifest. It does not use the current wall clock. Legacy package-only pages fall back to comparing matching evidence identity and package cutoff.
- A successful compose with a package appends a generation and activates it. A sealed page still rejects composition; its derived mode remains `sealed` even if later evidence exists.
- Schema-1/2 pages and existing notes normalize without deletion. A legacy `reviewPackage` is represented as one legacy generation.

## Red phase

Command:

```sh
node --import tsx --test tests/today-board.test.ts tests/notebook-store.test.ts
```

Observed intended failure before implementation:

- `ERR_MODULE_NOT_FOUND` for `src/today-board`.
- `SyntaxError: ... notebook-store does not provide an export named 'recordDailyCompilationFailure'`.

This showed the tests were exercising missing production capability rather than passing against pre-existing behavior.

## Green verification

```sh
node --import tsx --test tests/today-board.test.ts tests/notebook-store.test.ts
```

Final result: 13 tests passed, 0 failed.

```sh
npm run typecheck
```

Final result: `tsc --noEmit` exited 0.

`git diff --check` also exited 0 before commit.

## Self-review

- Confirmed a snapshot with unchanged admitted evidence remains `compiled` even after the package cutoff.
- Confirmed altered session metadata and a new session independently produce `stale` and identify the uncompiled evidence.
- Confirmed the previous active generation and user reflection survive successful refresh and a recorded failed compilation.
- Confirmed sealing blocks recomposition and always derives the read-only `sealed` mode.
- Confirmed normalization accepts schema 1 and 2 page inputs, preserves legacy note content, and does not discard a valid old review package.

## Commit

`55694bbf4d92ab2b4ed616e12221afac7d04708d` — `Add Today Board package lifecycle`

## Concerns

- `recordDailyCompilationFailure` provides the durable failure path and the existing main-process flow already leaves the old page untouched when compiler invocation throws before mutation. Wiring persistent failure recording into that IPC error path is intentionally deferred because this task explicitly excludes `app/desktop/main.ts`; the current UI can still surface the thrown failure and retry.
