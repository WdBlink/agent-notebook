# KSI-informed Daily Review Vertical Slice Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before claiming release readiness.

**Goal:** Replace the current thin project-summary closeout with the preferred Daily Review flow: real Codex and Claude Code evidence becomes a small set of cross-Session worklines, each workline opens an evidence-linked dossier, the user writes their own reflection, and sealing preserves the exact generated material and user ink for later reading.

**Architecture:** Reuse the current provider snapshot, verified transcript paths, CLI runner, JSON notebook store, and Electron bridge. Add one Prompt-first review compiler whose semantic organization is extensible and whose KSI-informed editing rubric lives in a versioned Prompt profile. Persist a small replay/presentation package, not a cognition ontology. Replace only the end-of-day `ClosingRitual`; Sessions, Timeline, Map, Sources, daytime notes, and provider-owned resume behavior remain unchanged.

**Tech Stack:** TypeScript 6, Electron 43, React 19, the existing Codex/Claude CLI runner, JSON notebook persistence, Node test runner, Playwright.

## Product contract

This release is one vertical slice:

```text
verified Codex / Claude Sessions
→ a few cross-Session worklines
→ an evidence-linked dossier
→ a blank reflection field
→ user-authored ink
→ seal
→ byte-stable reading after restart or later evidence
```

The KSI-informed Prompt profile is a production capability, not background inspiration. It must instruct the model to:

- reconstruct a workline across all relevant Sessions instead of paraphrasing Session titles one by one;
- recover the prior or load-bearing assumption when the evidence supports one;
- cite concrete evidence that can be reopened in the product;
- explain a possible change without claiming the user adopted it;
- state a future observation that could support or falsify the possible change;
- preserve disagreement, uncertainty, and scope instead of averaging them into a smooth summary;
- distinguish observed material from model inference;
- end with the real question that remains for the user.

The Prompt must explicitly forbid first-person user conclusions, adoption, delivery, background authorization, and sealing. Missing or novel semantic roles do not invalidate a package. TypeScript validates replay safety, source membership, and UI requirements only; it does not freeze the model's cognitive vocabulary.

Out of scope for this release: prior-transition graphs, automatic outcome evaluation, SQLite, native emitters, iCloud/iPad, personalization, CTX/tomorrow/background migration, and a generic Event Protocol platform.

## Acceptance gate

- [x] A fixture containing Codex and Claude Code Sessions for the same intent compiles into one workline with every contributing Session still openable.
- [x] The dossier shows an ordered reconstruction, participation labels, evidence links, and a question left to the user; it does not present generated prose as the user's decision.
- [x] An unknown semantic block returned by a later Prompt round-trips and renders through a generic block instead of failing compilation.
- [x] Starting reflection presents an empty field; AI text is never inserted into the user's field.
- [x] A user can save one reflection per workline, return to the workline index, review another workline, and reopen saved ink.
- [x] Sealing stores the exact review package, all user reflections, and selected continuation bookmarks; refresh, restart, or newer evidence cannot rewrite them.
- [x] A model/read failure is visible and retryable; the product does not silently fall back to the old thin Session/project summary.
- [x] Sessions, Timeline, Map, Sources, note capture, evidence reader, and copy-only resume regression tests remain unchanged and pass.
- [x] The review workspace follows the selected v16 visual baseline at desktop and narrow widths, including independent scrolling and restrained TN details.
- [x] Full typecheck, unit suite, desktop E2E suite, arm64 DMG verification, and x64 DMG verification pass.

## Task 1: Implement the Prompt-first workline review compiler

**Files:**

- Create: `src/workline-review.ts`
- Create: `tests/workline-review.test.ts`
- Reuse: `src/agent-summary.ts`
- Reuse: `app/desktop/cli-runner.ts`
- Modify: `src/types.ts` only if a shared provider type is needed

**Step 1: Write failing behavioral tests**

Create fixtures with three Sessions across Codex and Claude Code. Use a fake CLI runner that records one request and returns two worklines. Assert:

- the request contains the complete verified manifest rather than one platform batch;
- Session titles are marked as weak metadata and transcript paths are the evidence authority;
- the Prompt carries the KSI editing boundary above and forbids user adoption;
- normalized worklines retain only manifest Session references;
- unknown review-block kinds and payload fields survive normalization;
- malformed output and zero valid worklines return a visible compilation error rather than project-summary fallback.

Run:

```bash
node --import tsx --test tests/workline-review.test.ts
```

Expected: FAIL because `src/workline-review.ts` does not exist.

**Step 2: Implement the smallest compiler**

Expose:

```ts
export interface WorklineReviewRunnerOptions {
  runner?: CliRunner;
  homeDir?: string;
  timeoutMs?: number;
  preferredProvider?: "codex" | "claude";
  model?: string;
}

export async function compileDailyWorklineReview(
  settings: CockpitSettings,
  logicalDate: string,
  sessions: AgentWorkSession[],
  options?: WorklineReviewRunnerOptions
): Promise<DailyReviewPackage>;
```

The public package should carry only what replay and the chosen UI need: package ID/version, logical date, generated time, evidence cutoff, Prompt/model provenance, source references, ordered worklines, participation spans, ordered semantic blocks, an optional human question, warnings, and preserved extensible payloads.

Use the existing read-only Codex/Claude invocation pattern. Select one enabled provider as the compiler; it may read the complete verified manifest. Do not let output introduce a new Session path, Session ID, provider, delivery, or execution action.

**Step 3: Make tests pass and refactor**

Run the focused test after each minimal change. Keep the Prompt version explicit (`ksi-workline-review-v1`) and the semantic block normalizer tolerant of unknown fields.

## Task 2: Persist review packages and per-workline user ink

**Files:**

- Modify: `app/desktop/api.ts`
- Modify: `app/desktop/notebook-store.ts`
- Modify: `tests/notebook-store.test.ts`

**Step 1: Write failing persistence tests**

Add tests proving:

- a new draft stores the exact `DailyReviewPackage` supplied by the compiler;
- one reflection is stored per workline without modifying generated blocks;
- legacy schema-version-1 pages still load;
- sealing freezes package, reflections, and bookmarks;
- recomposition after sealing fails even when the caller supplies a newer package.

Expected production change caught: replacing the stored package after refresh or merging AI text into the user reflection.

**Step 2: Add a backward-compatible page version**

Keep legacy fields readable. New pages use schema version 2 and add:

```ts
reviewPackage: DailyReviewPackage;
worklineReflections: DailyWorklineReflection[];
```

Do not add migration destinations, background authorization, knowledge claims, or decision graphs.

**Step 3: Run focused tests**

```bash
node --import tsx --test tests/notebook-store.test.ts tests/workline-review.test.ts
```

## Task 3: Wire compilation through Electron without changing secondary surfaces

**Files:**

- Modify: `app/desktop/main.ts`
- Modify: `app/desktop/preload.ts`
- Modify: `app/desktop/api.ts`
- Modify: `tests/e2e/desktop-app.spec.ts`

**Step 1: Extend the E2E bridge fixture first**

Provide a realistic package containing:

- one workline spanning Codex and Claude Code;
- user-led and agent-led spans;
- known and unknown semantic blocks;
- openable Session evidence;
- one unresolved human question.

Add a failing test that clicks `开始整理今天` and expects the workline index instead of the old `收笔之前` sheet.

**Step 2: Add one IPC action**

Add `prepareDailyReview(date)` or change `composeDailyPage(date)` to compile before persistence. Prefer an explicit `prepareDailyReview` name if compatibility remains clear. The main process must:

1. read the current verified snapshot for the selected date;
2. call `compileDailyWorklineReview` once;
3. persist the returned package as the draft;
4. return the notebook state;
5. surface read/model errors without writing a fake package.

No model output may invoke `openPath`, `copyText`, resume, CTX delivery, or background work.

## Task 4: Replace `ClosingRitual` with the v16 review workspace

**Files:**

- Modify: `app/desktop/renderer.tsx`
- Modify: `app/desktop/renderer.css`
- Modify: `tests/e2e/desktop-app.spec.ts`
- Visual source: `/Users/wdblink/.codex/visualizations/2026/07/16/019f6a07-c1b1-7fd1-9da5-22a345c42dab/daily-edition-v16-paper-edge-junior.html`

**Step 1: Write failing E2E behaviors**

Cover the continuous interaction:

1. index shows workline count and participation marks;
2. opening a workline shows ordered dossier blocks and source buttons;
3. a source button opens the existing in-app Session transcript reader;
4. `看完了，开始思考` opens a blank textarea;
5. saved ink returns to the workline index and is recoverable;
6. another workline can be reviewed;
7. sealing makes the whole review read-only;
8. narrow width has no horizontal document overflow.

**Step 2: Implement the workspace as local React state over persisted page state**

Use explicit states `index | dossier | reflection | seal`. Render only one workline dossier at a time. Keep generated copy visibly labelled `AI 整理` and user copy labelled `你的原始墨迹`. The textarea starts empty unless that exact workline already has saved user ink.

Reuse the demo's visual hierarchy and interaction details:

- neutral electronic canvas and bright paper;
- rust, blue-grey, and green as semantic inks;
- activity track for user/Agent participation;
- restrained brass date clip on the review cover only;
- paper-edge native scrollbars and independent pane scroll;
- seal stamp only after sealing;
- reduced-motion support.

Do not copy the demo's prototype-only bottom navigation or the CTX/tomorrow/background migration screen into this release.

**Step 3: Preserve existing surfaces**

Do not change the component or interaction contracts for `SessionsView`, `Timeline`, `MapView`, `SourcesView`, note capture, source drawer, transcript reader, or resume copy.

## Task 5: Product verification and release artifact

**Files:**

- Modify: `package.json` version after behavior is complete
- Modify: `README.md`, `PRIVACY.md`, or `TESTING.md` only where the shipped behavior makes current text false
- Modify: `ctx/progress/progress.md` in the same completed work chunk

**Step 1: Focused verification**

```bash
node --import tsx --test tests/workline-review.test.ts tests/notebook-store.test.ts
./node_modules/.bin/tsc --noEmit
npm run build:desktop
npm run test:e2e -- --grep "daily review|end-of-day|complete session|map keeps|narrow window"
```

**Step 2: Full verification**

```bash
npm run check
```

**Step 3: Build and verify both Mac installers**

```bash
npm run dist:macos
npm run verify:desktop-release
```

Inspect the generated arm64 and x64 DMGs, their hashes, and the installed app's About/version string. Do not publish or replace a GitHub Release without a separate explicit instruction.

## Implementation discipline

- Follow red → green → refactor for each task. A test must fail for the intended missing behavior before production code is written.
- Test user-visible behavior and real persistence; fake only external CLI execution.
- Do not assert only that a Prompt contains exact prose. The compiler test must also prove cross-provider grouping, evidence membership, extensible output, and authority boundaries at its observable API.
- Keep the old implementation plan as historical design input, but do not execute its SQLite, fixed processor, boundary-state-machine, or platform tasks in this release.
