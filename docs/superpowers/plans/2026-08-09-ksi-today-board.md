# KSI Today Board Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before claiming completion.

**Goal:** Replace the capture-led Brief with one Today Board that progresses from raw Session lanes to cached KSI worklines, stale/new-evidence awareness, evidence review, and immutable sealed history.

**Architecture:** Preserve the existing provider scanner, transcript reader, Prompt-first `workline-review` compiler, notebook JSON store, Electron IPC, and review workspace. Add a deterministic board projection for raw/compiled/stale/sealed states, append-only package generations, and an activity-timeline extractor. Rebuild only the Today surface; keep Sessions, Timeline, Map, Sources, legacy notes, and resume behavior compatible.

**Tech Stack:** TypeScript 6, Electron 43, React 19, CSS, existing `lucide-react`, Node test runner, Playwright.

## Task 1: Define the board projection and package lifecycle

**Files:**

- Modify: `app/desktop/api.ts`
- Modify: `app/desktop/notebook-store.ts`
- Modify: `tests/notebook-store.test.ts`
- Create: `src/today-board.ts`
- Create: `tests/today-board.test.ts`

- [ ] Write failing tests for `raw`, `compiled`, `stale`, and `sealed` projections.
- [ ] Prove stale detection compares admitted snapshot evidence with the stored package cutoff/manifest rather than wall-clock time alone.
- [ ] Prove composing/refreshing a draft appends a generation and activates the newest successful package.
- [ ] Prove a failed compilation leaves the last successful generation untouched.
- [ ] Prove normalization loads legacy schema-1/2 pages and legacy notes without data loss.
- [ ] Implement the smallest backward-compatible page version and projection functions.
- [ ] Run `node --import tsx --test tests/today-board.test.ts tests/notebook-store.test.ts` until green.

## Task 2: Extract honest Session activity lanes

**Files:**

- Modify: `app/desktop/transcript-reader.ts`
- Modify: `app/desktop/api.ts`
- Modify: `app/desktop/main.ts`
- Create or modify: `src/session-activity.ts`
- Create: `tests/session-activity.test.ts`
- Modify: `tests/transcript-reader.test.ts`

- [ ] Write fixtures for Codex/Claude timestamps, interleaved roles, missing timestamps, and a running Session.
- [ ] Assert explicit user events remain pulses/windows and Agent blocks never masquerade as measured human attention.
- [ ] Assert concurrency and context-switch counts are derived deterministically and insufficient evidence yields `uncertain`.
- [ ] Implement a read-only activity extractor and expose it with the notebook/board state.
- [ ] Do not infer actual time saved or a diagnostic saturation score.
- [ ] Run the focused activity/transcript tests until green.

## Task 3: Version the KSI Prompt and persist evidence assets

**Files:**

- Modify: `src/workline-review.ts`
- Modify: `tests/workline-review.test.ts`
- Reuse: `skills/traceink/references/editorial-contract.md`
- Modify: `app/desktop/main.ts`

- [ ] Add failing compiler tests that compare behavior to the validated Skill contract: cross-Session grouping, evidence fidelity, possible-change language, conflict/scope retention, participation boundaries, and a real human question.
- [ ] Upgrade the Prompt profile and manifest provenance without copying the KSI six values into a rigid cognition schema.
- [ ] Persist Prompt/model/compiler provenance, evidence cutoff, exact source refs, completeness warnings, and stable package identity.
- [ ] Keep output normalization extensible for new semantic block kinds.
- [ ] Run `node --import tsx --test tests/workline-review.test.ts` until green.

## Task 4: Expose explicit compile and refresh actions through Electron

**Files:**

- Modify: `app/desktop/api.ts`
- Modify: `app/desktop/preload.ts`
- Modify: `app/desktop/main.ts`
- Modify: `tests/e2e/desktop-app.spec.ts`

- [ ] Extend the E2E bridge fixture with raw, compiled, stale, failure, and sealed scenarios.
- [ ] Rename or add an explicit `prepareDailyReview(date, mode)` API whose only mutation is a successful package-generation append.
- [ ] Surface compiler progress and failure; preserve the prior package on error.
- [ ] Ensure historical sealed state never calls the compiler.
- [ ] Keep all model output read-only: no open, resume, CTX/Wiki, background, or seal side effects.

## Task 5: Rebuild the Today surface

**Files:**

- Create: `app/desktop/today-board.tsx`
- Modify: `app/desktop/renderer.tsx`
- Modify: `app/desktop/renderer.css`
- Modify: `tests/e2e/desktop-app.spec.ts`

- [ ] Write failing E2E tests for raw Session lanes, exact Session IDs, activity tracks, and transcript actions.
- [ ] Write failing tests for compiled workline cards, inline Session disclosure, dossier entry, and project/provider filters.
- [ ] Write failing tests for stale labeling, new-evidence lanes, refresh, last-good-package failure behavior, and sealed read-only history.
- [ ] Implement the new Today Board in a separate component rather than extending the old `Brief` branches.
- [ ] Remove the capture tray and note editor entry from Today; retain legacy note API/persistence.
- [ ] Add compact summary metrics for observed Agent activity, explicit human interaction, concurrency, and attention-load cues with evidence/confidence labels.
- [ ] Keep the existing Daily Review workspace but open it from the selected/current workline board, not from a second duplicate index.
- [ ] Preserve independent scrolling, keyboard/focus states, reduced motion, and 720 px no-overflow behavior.

## Task 6: Close the review and history loop

**Files:**

- Modify: `app/desktop/today-board.tsx`
- Modify: `app/desktop/renderer.tsx`
- Modify: `app/desktop/notebook-store.ts`
- Modify: `tests/e2e/desktop-app.spec.ts`
- Modify: `tests/notebook-store.test.ts`

- [ ] Verify dossier → blank reflection → persisted user ink → return to board across multiple worklines.
- [ ] Verify sealing pins the selected package generation, reflections, bookmarks, manifest/provenance, and timestamp.
- [ ] Verify changing raw Sessions or Prompt profile cannot alter a sealed day.
- [ ] Render sealed worklines and reflections from stored assets without model access.
- [ ] Keep proposal routing non-binding and omit automatic CTX/Wiki/background promotion.

## Task 7: Regression, docs, and macOS artifacts

**Files:**

- Modify: `README.md`
- Modify: `package.json` after behavior is complete
- Modify: `scripts/verify-desktop-release.mjs` only if the new artifact contract requires it
- Modify: relevant project context progress only through the ctx workflow

- [ ] Run focused unit tests after every task.
- [ ] Run `npm run typecheck` and `npm run build:desktop`.
- [ ] Run the Today/review E2E slice, then the full `npm run check`.
- [ ] Inspect desktop and 720 px screenshots for semantic hierarchy and overflow.
- [ ] Build arm64 and x64 DMG/ZIP artifacts with `npm run dist:macos`.
- [ ] Run `npm run verify:desktop-release` and record artifact paths/hashes.
- [ ] Do not publish or replace a GitHub Release without a separate explicit instruction.

## Implementation discipline

- Follow red → green → refactor. Capture the intended failing assertion before production edits.
- Test observable behavior, persistence, and provenance; do not pin exact generated prose.
- The Skill contract is the semantic oracle, but the application owns persistence, interaction authority, and sealing.
- Prompt-led semantic organization stays flexible. Strong validation is limited to evidence membership, replay integrity, package identity, and user-authority boundaries.
- Preserve all unrelated dirty-worktree edits and never delete legacy user data.
