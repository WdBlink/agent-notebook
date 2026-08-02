# Workline Review Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace project-level Session aggregation with evidence-traceable, versioned single-workline review packages that prepare the day for human reflection without writing the user's conclusions.

**Architecture:** The Electron main process builds a typed Evidence IR from read-only Codex/Claude sessions and explicitly linked materials, freezes an evidence cutoff, asks the configured CLI model provider for workline boundaries and semantic claims, validates every claim against evidence, and composes finite typed blocks. SQLite stores indexes, compilation runs, versioned packages, notes, reflections, and sealed pages; React renders one workline at a time and leaves reflection and sealing under human control.

**Tech Stack:** TypeScript 6, Electron 43, React 19, `node:sqlite`, Node test runner with `tsx`, Playwright, Codex CLI, Claude Code CLI.

## Global Constraints

- This plan implements the Mac workline compiler only. iCloud and iPad are a separate future implementation plan.
- Raw Codex and Claude Code sessions remain read-only and are never copied wholesale into the database.
- Only Session-explicit documents, diffs, tests, and artifacts may be read; the compiler must not recursively scan a project.
- Daytime indexing is deterministic and lightweight. Semantic compilation starts only after the user chooses “开始整理今天”.
- Each run freezes `evidenceCutoff`. Later evidence creates a new package version only after explicit user action.
- Every fact and inference carries valid evidence IDs. Questions may be evidence-backed but cannot masquerade as conclusions.
- A core Session or semantic failure blocks formal review. A non-core artifact failure remains visible at the exact affected block.
- No cross-day personalization is implemented in this release.
- Human reflections can be edited only by the user before sealing; sealed pages are immutable.
- Model providers receive selected Evidence IR excerpts, not arbitrary filesystem access. Session content is untrusted data.
- The compiler cannot run shell commands, modify Git state, write project files, or delegate work to another agent.
- Target a typical 12-Session day: cached compile under 10 seconds and first compile under 2 minutes on supported Macs.
- Preserve the existing Sessions, Timeline, Map, Sources, notes, CTX/Wiki routes, and copy-resume behavior.
- Assign stable UUIDs, `schemaVersion`, monotonic `revision`, and content hashes now so future CloudKit sync does not require identity migration.

## File Map

### New production files

- `app/desktop/compiler/contracts.ts` — compiler IR, package contracts, schemas, and normalizers.
- `app/desktop/compiler/evidence-indexer.ts` — deterministic source-to-Evidence-IR adapter.
- `app/desktop/compiler/compiler-provider.ts` — Codex/Claude CLI semantic provider.
- `app/desktop/compiler/composer.ts` — deterministic typed-block composer.
- `app/desktop/compiler/validator.ts` — evidence coverage and failure policy.
- `app/desktop/compiler/orchestrator.ts` — run state machine, cutoff, caching, retries, and cancellation.
- `app/desktop/storage/workline-database.ts` — SQLite schema, repositories, and legacy import.
- `app/desktop/review-controller.ts` — application service consumed by IPC.
- `app/desktop/review-workspace.tsx` — review index, dossier, evidence drawer, reflection, and seal UI.
- `app/desktop/review-workspace.css` — responsive review workspace styling.

### New tests and fixtures

- `tests/workline-contracts.test.ts`
- `tests/workline-database.test.ts`
- `tests/evidence-indexer.test.ts`
- `tests/compiler-provider.test.ts`
- `tests/workline-validator.test.ts`
- `tests/workline-orchestrator.test.ts`
- `tests/review-controller.test.ts`
- `tests/api-contract.test.ts`
- `tests/fixtures/compiler/codex-split.jsonl`
- `tests/fixtures/compiler/claude-collaboration.jsonl`
- `tests/fixtures/compiler/linked-design.md`
- `tests/fixtures/compiler/test-report.json`
- `scripts/benchmark-workline-compiler.mts`

### Existing files to modify

- `app/desktop/api.ts` — public review state and IPC API.
- `app/desktop/cli-runner.ts` — abortable CLI calls and compiler-safe tool policy.
- `src/agent-summary.ts` — add cancellation to the existing shared CLI request contract.
- `app/desktop/main.ts` — database lifecycle, review controller, IPC handlers, and progress broadcasts.
- `app/desktop/preload.ts` — expose typed review methods.
- `app/desktop/notebook-store.ts` — version-2 pages pinned to workline package versions.
- `app/desktop/renderer.tsx` — mount the new review workspace and retire old project aggregation from the closing flow.
- `app/desktop/renderer.css` — shared shell integration only.
- `app/desktop/index.html` — stylesheet inclusion.
- `scripts/build-desktop.mjs` — copy the review stylesheet.
- `tests/e2e/desktop-app.spec.ts` — complete review, reflection, and sealing path.
- `README.md`, `PRIVACY.md`, `TESTING.md` — behavior, data boundaries, and verification instructions.

---

## Task 1: Lock the Compiler Contracts and Normalization Boundary

**Files:**

- Create: `app/desktop/compiler/contracts.ts`
- Create: `tests/workline-contracts.test.ts`

**Interfaces:**

```ts
export type CompilationStatus =
  | "preflight"
  | "identifying_boundaries"
  | "awaiting_boundary_confirmation"
  | "compiling"
  | "blocked"
  | "ready"
  | "cancelled";

export type VersionMetadata = {
  id: string;
  schemaVersion: number;
  revision: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRange = {
  sessionId: string;
  provider: "codex" | "claude";
  startEvidenceId: string;
  endEvidenceId: string;
};

export type BoundaryDecision = {
  candidateId: string;
  action: "accept" | "split" | "merge" | "exclude";
  rangeIds: string[];
};

export function normalizeBoundaryResult(
  value: unknown,
  evidenceById: ReadonlyMap<string, EvidenceItem>,
): BoundaryNormalizationResult;

export function normalizeSemanticResult(
  value: unknown,
  evidenceById: ReadonlyMap<string, EvidenceItem>,
): SemanticNormalizationResult;
```

- [ ] Write contract tests that reject duplicate IDs, unknown block kinds, invalid confidence values, reversed Session ranges, and facts or inferences with unknown evidence IDs.

```ts
test("rejects a fact whose evidence is absent", () => {
  const result = normalizeSemanticResult(
    { claims: [{ id: "c1", kind: "fact", text: "完成", evidenceIds: ["missing"], confidence: 1 }], blocks: [] },
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /unknown evidence/i);
});
```

- [ ] Run `node --import tsx --test tests/workline-contracts.test.ts` and confirm it fails because `contracts.ts` does not exist.
- [ ] Implement `EvidenceItem`, `WorklineCandidate`, `BoundaryAmbiguity`, `CompiledClaim`, `ParticipationSpan`, the finite `AdaptiveBlock` union, `WorklinePackage`, and the two normalizers. Use explicit property checks; do not add a schema dependency.
- [ ] Make `fact` and `inference` require at least one valid evidence ID. Allow `question` to have zero evidence IDs only when `basis: "user-judgment"` is explicit.
- [ ] Run `node --import tsx --test tests/workline-contracts.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/compiler/contracts.ts tests/workline-contracts.test.ts
git commit -m "Define workline compiler contracts"
```

---

## Task 2: Add SQLite Persistence and One-Time Legacy Import

**Files:**

- Create: `app/desktop/storage/workline-database.ts`
- Create: `tests/workline-database.test.ts`
- Modify: `app/desktop/notebook-store.ts`

**Interfaces:**

```ts
export class WorklineDatabase {
  constructor(databasePath: string);
  close(): void;
  transaction<T>(operation: () => T): T;
  importLegacyNotebookOnce(legacyPath: string): LegacyImportResult;
  saveEvidence(items: readonly EvidenceItem[]): void;
  createCompilationRun(input: CreateCompilationRunInput): CompilationRun;
  updateCompilationRun(id: string, patch: CompilationRunPatch): CompilationRun;
  saveProcessorResult(result: ProcessorResultRecord): void;
  savePackage(value: WorklinePackage): void;
  getLatestUsablePackage(worklineIdentity: string): WorklinePackage | undefined;
  loadNotebook(): NotebookDocument;
  saveNotebook(document: NotebookDocument): void;
}
```

- [ ] Write tests using a temporary SQLite file. Cover migrations on an empty database, foreign-key rejection, transaction rollback, package version retention, and idempotent legacy JSON import.
- [ ] Add a fixture object in the test for a version-1 sealed page and assert that import preserves its date, reflection, and sealed timestamp without inventing evidence provenance.
- [ ] Run `node --import tsx --test tests/workline-database.test.ts`; expect module-not-found failure.
- [ ] Implement the database with `DatabaseSync` from `node:sqlite`, `PRAGMA journal_mode=WAL`, and `PRAGMA foreign_keys=ON`.
- [ ] Create migrations for `schema_meta`, `source_index`, `evidence_items`, `compilation_runs`, `processor_results`, `worklines`, `workline_packages`, `compiled_claims`, `notebook_notes`, `daily_pages`, `user_reflections`, and `sealed_pages`.
- [ ] Store processor and block payloads as validated JSON text, while IDs, versions, timestamps, statuses, hashes, and foreign keys remain queryable columns.
- [ ] Import `notebook-v1.json` inside a transaction, record its SHA-256 hash in `schema_meta`, and leave the source file untouched. A repeated import with the same hash must perform zero writes.
- [ ] Run `node --import tsx --test tests/workline-database.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/storage/workline-database.ts app/desktop/notebook-store.ts tests/workline-database.test.ts
git commit -m "Persist workline reviews in SQLite"
```

---

## Task 3: Build the Deterministic Evidence Indexer

**Files:**

- Create: `app/desktop/compiler/evidence-indexer.ts`
- Create: `tests/evidence-indexer.test.ts`
- Create: `tests/fixtures/compiler/codex-split.jsonl`
- Create: `tests/fixtures/compiler/claude-collaboration.jsonl`
- Create: `tests/fixtures/compiler/linked-design.md`
- Create: `tests/fixtures/compiler/test-report.json`

**Interfaces:**

```ts
export type EvidenceIndexRequest = {
  logicalDate: string;
  evidenceCutoff: string;
  sessions: readonly ProviderSession[];
  explicitFiles: readonly ExplicitEvidenceFile[];
  projectRoots: readonly string[];
};

export async function buildEvidenceIndex(
  request: EvidenceIndexRequest,
): Promise<EvidenceIndexResult>;
```

- [ ] Create fixtures where one Codex Session changes topic and must later be split, one Claude Session contains collaboration, one linked document is valid, one test report is valid, and one transcript contains quoted prompt-injection text.
- [ ] Write tests proving the indexer ignores events after the cutoff, includes only explicitly allowed files, rejects symlink escapes outside canonical project roots, caps each file excerpt at 256 KiB, and treats quoted instructions as inert text.
- [ ] Write a test asserting stable evidence IDs across two identical runs and changed IDs when source content changes.
- [ ] Run `node --import tsx --test tests/evidence-indexer.test.ts`; expect module-not-found failure.
- [ ] Implement canonical `realpath` containment checks and SHA-256 IDs derived from source type, source identity, stable location, and content hash.
- [ ] Extract Git and test evidence only from Session tool output or explicitly linked files. Do not invoke Git, a shell, a test runner, `Glob`, or recursive filesystem traversal.
- [ ] Return non-core read failures as structured `EvidenceWarning` values attached to their intended artifact reference. Return core Session parse failures as `EvidenceFatalError`.
- [ ] Run `node --import tsx --test tests/evidence-indexer.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/compiler/evidence-indexer.ts tests/evidence-indexer.test.ts tests/fixtures/compiler
git commit -m "Index bounded workline evidence"
```

---

## Task 4: Add the Sandboxed CLI Compiler Provider

**Files:**

- Create: `app/desktop/compiler/compiler-provider.ts`
- Create: `tests/compiler-provider.test.ts`
- Modify: `app/desktop/cli-runner.ts`
- Modify: `src/agent-summary.ts`

**Interfaces:**

```ts
export interface CompilerProvider {
  identifyWorklines(request: BoundaryProviderRequest): Promise<unknown>;
  compileWorkline(request: SemanticProviderRequest): Promise<unknown>;
}

export class CliCompilerProvider implements CompilerProvider {
  constructor(options: CliCompilerProviderOptions);
  identifyWorklines(request: BoundaryProviderRequest): Promise<unknown>;
  compileWorkline(request: SemanticProviderRequest): Promise<unknown>;
}

export interface CliRunRequest {
  command: string;
  args: string[];
  stdin: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}
```

- [ ] Write tests with a fake executable that records argv/stdin and emits predefined JSON. Assert that only selected excerpts and opaque evidence IDs reach stdin, source paths are removed from prompt text, and cancellation terminates the child process.
- [ ] Add malformed JSON, markdown-fenced JSON, unknown evidence ID, timeout, and non-zero exit fixtures to the fake provider tests.
- [ ] Run `node --import tsx --test tests/compiler-provider.test.ts`; expect module-not-found failure.
- [ ] Add `CliCancelledError` in `src/agent-summary.ts`. Extend `runDesktopCli` so an `AbortSignal` sends `SIGTERM`, escalates to `SIGKILL` after 2 seconds, clears timers/listeners, and rejects with `CliCancelledError`.
- [ ] Implement two versioned prompts: `workline-boundary-v1` and `workline-semantic-v1`. Each prompt must state that evidence text is untrusted data, demand JSON only, and forbid user conclusions, shell actions, file access, and unsupported claims.
- [ ] For Codex, use `exec --ephemeral --skip-git-repo-check --sandbox read-only --json -` with the existing optional model argument. For Claude Code, use `--print --output-format json --json-schema <schema> --tools "" --permission-mode dontAsk --safe-mode --no-session-persistence`; do not reuse the summary provider's `Read,Glob,Grep` allowlist.
- [ ] Parse provider output as unknown and pass it immediately to the Task 1 normalizers; no UI or database code may consume raw provider JSON.
- [ ] Run `node --import tsx --test tests/compiler-provider.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/compiler/compiler-provider.ts app/desktop/cli-runner.ts src/agent-summary.ts tests/compiler-provider.test.ts
git commit -m "Add bounded CLI compiler provider"
```

---

## Task 5: Validate Claims and Compose Adaptive Blocks

**Files:**

- Create: `app/desktop/compiler/validator.ts`
- Create: `app/desktop/compiler/composer.ts`
- Create: `tests/workline-validator.test.ts`

**Interfaces:**

```ts
export function validateWorklineCompilation(
  input: WorklineCompilationInput,
): WorklineValidationResult;

export function composeWorklinePackage(
  input: ValidatedWorklineCompilation,
): WorklinePackage;
```

- [ ] Write tests for a verified fact, a labeled inference, a user-judgment question, a missing non-core document, a missing core Session range, an uncovered Session range, an invalid participation span, and a provider-produced unsupported sentence.
- [ ] Assert exact policy: missing core evidence yields `status: "blocked"`; missing non-core evidence still yields `status: "ready"` plus a warning on the affected block; a validator failure never deletes the last usable package.
- [ ] Run `node --import tsx --test tests/workline-validator.test.ts`; expect module-not-found failure.
- [ ] Implement evidence coverage checks over every candidate range and ensure each `ParticipationSpan` is ordered and bounded by evidence in the same workline.
- [ ] Implement deterministic composition into `TimelineBlock`, `ComparisonBlock`, `ExperimentBlock`, `ChangeSetBlock`, `ArtifactBlock`, `ParticipationBlock`, `QuestionBlock`, and `ProseBlock`. The composer may arrange and label normalized content but must not generate new prose.
- [ ] Sort blocks by explicit stage order, then first evidence timestamp, then stable ID. Compute package `contentHash` after canonical key ordering.
- [ ] Persist validator errors separately from package payloads so a failed recompile can display diagnostics while retaining the prior usable version.
- [ ] Run `node --import tsx --test tests/workline-validator.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/compiler/validator.ts app/desktop/compiler/composer.ts tests/workline-validator.test.ts
git commit -m "Validate and compose workline packages"
```

---

## Task 6: Implement the Compilation State Machine

**Files:**

- Create: `app/desktop/compiler/orchestrator.ts`
- Create: `tests/workline-orchestrator.test.ts`

**Interfaces:**

```ts
export class WorklineCompilerOrchestrator {
  constructor(dependencies: WorklineCompilerDependencies);
  start(request: StartCompilationRequest): Promise<CompilationRunSnapshot>;
  confirmBoundaries(runId: string, decisions: readonly BoundaryDecision[]): Promise<CompilationRunSnapshot>;
  retry(runId: string): Promise<CompilationRunSnapshot>;
  cancel(runId: string): Promise<CompilationRunSnapshot>;
  includeNewEvidence(runId: string, cutoff: string): Promise<CompilationRunSnapshot>;
  resumeInterruptedRuns(): Promise<void>;
  getSnapshot(runId: string): CompilationRunSnapshot;
}
```

- [ ] Write tests using fake clock, indexer, provider, validator, composer, and in-memory repository. Cover high-confidence automatic continuation, low-confidence pause, invalid boundary decisions, frozen cutoff, explicit new-evidence versioning, cache hits, cancellation, provider failure, partial processor retry, and interrupted-run recovery.
- [ ] Add an assertion that `start()` records `preflight` before any provider call and that low-confidence candidates transition to `awaiting_boundary_confirmation` without semantic compilation.
- [ ] Add assertions that evidence after the cutoff sets `newEvidenceAvailable: true` without changing the run status, and that `includeNewEvidence` creates a new run and new package revision while the old package remains readable.
- [ ] Run `node --import tsx --test tests/workline-orchestrator.test.ts`; expect module-not-found failure.
- [ ] Implement the state transitions exactly as `preflight → identifying_boundaries → awaiting_boundary_confirmation | compiling → blocked | ready`, with `cancelled` reachable from every non-terminal state.
- [ ] Limit semantic processor concurrency to two. Cache boundary results by boundary prompt version plus sorted Evidence IR hashes, and semantic results by processor version plus workline evidence hashes.
- [ ] Checkpoint after indexing, boundary normalization, each semantic result, validation, and package persistence. `resumeInterruptedRuns()` must resume from the last complete checkpoint rather than repeat successful processor calls.
- [ ] Treat a cache record as usable only when its processor version, prompt version, model identifier, output schema version, compiler version, and all input hashes match.
- [ ] Run `node --import tsx --test tests/workline-orchestrator.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/compiler/orchestrator.ts tests/workline-orchestrator.test.ts
git commit -m "Orchestrate versioned workline compilation"
```

---

## Task 7: Upgrade Notebook Pages to Pin Workline Package Versions

**Files:**

- Modify: `app/desktop/notebook-store.ts`
- Modify: `tests/notebook-store.test.ts`

**Interfaces:**

```ts
export type DailyNotebookPageV1 = {
  schemaVersion: 1;
  logicalDate: string;
  status: "unformed" | "draft" | "sealed";
  createdAt?: string;
  updatedAt?: string;
  evidenceCutoff?: string;
  sealedAt?: string;
  workRecords: DailyWorkRecord[];
  reflection: string;
  bookmarks: DailyContinuationBookmark[];
};

export type StructuredTomorrowItem = {
  id: string;
  text: string;
  worklineId?: string;
  accepted: boolean;
};

export type DailyNotebookPageV2 = {
  schemaVersion: 2;
  id: string;
  logicalDate: string;
  status: "draft" | "sealed";
  revision: number;
  createdAt: string;
  updatedAt: string;
  evidenceCutoff: string;
  packageRefs: Array<{ packageId: string; packageRevision: number; contentHash: string }>;
  reflections: Array<{ id: string; worklineId: string; text: string; createdAt: string; updatedAt: string }>;
  tomorrowItems: StructuredTomorrowItem[];
  sealedAt?: string;
  contentHash: string;
};

export type DailyNotebookPage = DailyNotebookPageV1 | DailyNotebookPageV2;
```

- [ ] Extend notebook tests to load an unmodified version-1 page, create a version-2 open page from package references, append reflections to two worklines, reject edits after sealing, and preserve package references when a later package version is compiled.
- [ ] Add a regression test proving a version-1 sealed page remains readable and is labeled `legacy-unverified` without synthesized claim or evidence IDs.
- [ ] Run `node --import tsx --test tests/notebook-store.test.ts`; expect failures for missing version-2 behavior.
- [ ] Implement pure transforms `createCompiledPage`, `saveWorklineReflection`, `setTomorrowItems`, and `sealCompiledPage`; compute a new hash and increment `revision` on every accepted user write.
- [ ] Require sealing to pin exact package ID, package revision, and package content hash. Never resolve “latest” when rendering a sealed page.
- [ ] Keep existing note, archive, and capture transforms behaviorally unchanged.
- [ ] Run `node --import tsx --test tests/notebook-store.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/notebook-store.ts tests/notebook-store.test.ts
git commit -m "Version compiled daily notebook pages"
```

---

## Task 8: Wire the Review Controller and Electron IPC

**Files:**

- Create: `app/desktop/review-controller.ts`
- Create: `tests/review-controller.test.ts`
- Create: `tests/api-contract.test.ts`
- Modify: `app/desktop/api.ts`
- Modify: `app/desktop/main.ts`
- Modify: `app/desktop/preload.ts`

**IPC contract:**

```ts
export type ReviewApi = {
  startDailyReview(logicalDate: string): Promise<{ runId: string }>;
  confirmReviewBoundaries(runId: string, decisions: BoundaryDecision[]): Promise<void>;
  retryDailyReview(runId: string): Promise<void>;
  cancelDailyReview(runId: string): Promise<void>;
  includeNewReviewEvidence(runId: string): Promise<{ replacementRunId: string }>;
  getReviewEvidence(evidenceId: string): Promise<EvidenceDetail>;
};

export class ReviewController {
  indexDaytimeSnapshot(snapshot: AgentWorkSnapshot): Promise<void>;
  startDailyReview(logicalDate: string): Promise<{ runId: string }>;
  shutdown(): Promise<void>;
}
```

- [ ] Write controller tests with a fake orchestrator and repository. Assert that start returns a run ID immediately, progress is emitted in order, boundary confirmation is scoped to the run, evidence details redact paths outside approved roots, and shutdown cancels active child processes before closing SQLite.
- [ ] Add API shape tests to `tests/api-contract.test.ts` for the six methods and the new `DesktopState.review` discriminated union.
- [ ] Run `node --import tsx --test tests/review-controller.test.ts tests/api-contract.test.ts`; expect failures for missing APIs.
- [ ] Implement `ReviewController` as the sole application service between IPC and the orchestrator. It must serialize mutations per run and broadcast immutable snapshots through the existing state channel.
- [ ] Call `indexDaytimeSnapshot` after startup scanning, manual refresh, date change, and source-setting changes. It may update `source_index` and hashes only; assert in tests that it never invokes `CompilerProvider`.
- [ ] Open `WorklineDatabase` once during app startup, run migrations, import legacy JSON once, resume interrupted runs, and close the database during `before-quit`. Keep the legacy JSON file intact.
- [ ] Register IPC handlers with argument validation. Reject unknown run IDs, malformed decisions, dates outside the existing supported date format, and evidence IDs that do not belong to the selected run.
- [ ] Expose only the typed six-method API through preload; do not expose database, filesystem, CLI, or generic invoke access.
- [ ] Run `node --import tsx --test tests/review-controller.test.ts tests/api-contract.test.ts`; expect all tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/review-controller.ts app/desktop/api.ts app/desktop/main.ts app/desktop/preload.ts tests/review-controller.test.ts tests/api-contract.test.ts
git commit -m "Expose the workline review controller"
```

---

## Task 9: Replace the Closing Flow with the Workline Review Workspace

**Files:**

- Create: `app/desktop/review-workspace.tsx`
- Create: `app/desktop/review-workspace.css`
- Modify: `app/desktop/renderer.tsx`
- Modify: `app/desktop/renderer.css`
- Modify: `app/desktop/index.html`
- Modify: `scripts/build-desktop.mjs`
- Modify: `tests/e2e/desktop-app.spec.ts`

**Components:**

```ts
export function ReviewWorkspace(props: ReviewWorkspaceProps): JSX.Element;
export function WorklineIndex(props: WorklineIndexProps): JSX.Element;
export function WorklineDossier(props: WorklineDossierProps): JSX.Element;
export function EvidenceDrawer(props: EvidenceDrawerProps): JSX.Element;
export function ReflectionEditor(props: ReflectionEditorProps): JSX.Element;
export function SealDayBar(props: SealDayBarProps): JSX.Element;
```

- [ ] Extend the Playwright fake bridge with deterministic states for `preflight`, `awaiting_boundary_confirmation`, `blocked`, `ready`, reflection saved, and sealed.
- [ ] Write a failing E2E test: start review, confirm one ambiguous split, open the first workline, inspect fact and inference evidence, write a reflection, manually add and accept structured tomorrow items, continue to the next workline, and seal the day.
- [ ] Write a failing E2E test proving a core failure cannot enter dossier view and a non-core missing document appears inside the relevant artifact block.
- [ ] Run `npm run test:e2e -- --grep "workline review"`; expect selector failures because the workspace is absent.
- [ ] Implement a compact progress state and an explicit boundary-confirmation sheet; do not use instructional paragraphs that occupy the empty page.
- [ ] Render one workline at a time. The index shows title, duration, participation marks, status, and judgment count—not a Session card wall. The dossier renders only the finite adaptive block components.
- [ ] Make fact and inference labels visually distinct without color alone. Clicking either opens the evidence drawer at the cited excerpt, with provider, Session range, timestamp, and “在 Sessions 中打开”.
- [ ] Keep reflection empty by default. Do not show generated conclusions, suggested prose, automatic completion, or live structural rewriting while the user types.
- [ ] After the user submits reflection, show only the user's manually entered `tomorrowItems` and existing continuation bookmarks as individually confirmable actions. Do not infer extra tasks or mutate project files in this release.
- [ ] Preserve the existing app shell and the Sessions, Timeline, Map, Sources, capture notes, CTX/Wiki entry points, and copy-resume interactions unchanged.
- [ ] Give the workline index and dossier independent scroll containers; add compact responsive layouts at 1100 px and 760 px; support keyboard traversal, visible focus, screen-reader labels, and `prefers-reduced-motion`.
- [ ] Replace the old `ClosingRitual` entry with `startDailyReview`. Remove the old project-level `composeDailyPage` path only after the E2E path passes.
- [ ] Run `npm run test:e2e -- --grep "workline review"`; expect all matching tests to pass.
- [ ] Run `npm run typecheck`; expect exit code 0.
- [ ] Commit:

```bash
git add app/desktop/review-workspace.tsx app/desktop/review-workspace.css app/desktop/renderer.tsx app/desktop/renderer.css app/desktop/index.html scripts/build-desktop.mjs tests/e2e/desktop-app.spec.ts
git commit -m "Build the workline review workspace"
```

---

## Task 10: Run the Acceptance Matrix, Privacy Audit, and Performance Gate

**Files:**

- Create: `scripts/benchmark-workline-compiler.mts`
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `TESTING.md`
- Modify: `tests/e2e/desktop-app.spec.ts`

- [ ] Add a golden acceptance test with four worklines: a split Session, a cross-provider merge, an Agent-only long run, and a workline with a missing linked document. Assert stable order, participation labels, evidence links, and warning placement.
- [ ] Add a restart E2E test that reaches `ready`, relaunches the app, restores the same run/package IDs, preserves an open reflection, and never rewrites a sealed page.
- [ ] Implement `scripts/benchmark-workline-compiler.mts` with a deterministic synthetic 12-Session day. Measure deterministic indexing only and fail when the median of five warm runs exceeds 1,000 ms on the development Mac; print evidence count, bytes, and median.
- [ ] Run `node --import tsx scripts/benchmark-workline-compiler.mts`; expect a printed median below 1,000 ms.
- [ ] Run a repository privacy scan:

```bash
rg -n "recursive|readdir|glob|Glob|Grep|allowDangerously|dangerouslyDisable|--dangerously" app/desktop/compiler app/desktop/review-controller.ts
```

  Inspect every match and confirm it is a prohibition, test, or bounded explicit-file operation. Remove any unbounded project traversal or unrestricted CLI flag.

- [ ] Update `PRIVACY.md` with source boundaries, excerpt storage, model input, cutoff/version behavior, deletion semantics, and the fact that no arbitrary project scan occurs.
- [ ] Update `README.md` with the human-first review loop and supported provider setup. Update `TESTING.md` with unit, E2E, benchmark, legacy migration, provider failure, and evidence-integrity commands.
- [ ] Run the full verification suite:

```bash
npm run check
node --import tsx scripts/benchmark-workline-compiler.mts
git diff --check
```

  Expect all commands to exit 0, no Electron console errors in Playwright, and no whitespace errors.

- [ ] Manually verify with a copied read-only fixture day: start review, freeze cutoff, confirm an ambiguous boundary, open every evidence link, write two reflections, add new evidence through explicit inclusion, confirm the old package remains accessible, seal, relaunch, and confirm immutability.
- [ ] Commit:

```bash
git add scripts/benchmark-workline-compiler.mts README.md PRIVACY.md TESTING.md tests/e2e/desktop-app.spec.ts
git commit -m "Verify the workline review compiler"
```

---

## Deferred Follow-Up: iCloud and Native iPad

Do not start this work until Task 10 proves that sealed Mac pages have stable IDs, schema versions, revisions, content hashes, and immutable package references. Create a separate plan covering:

- a signed Swift helper embedded in the Mac app using `CKSyncEngine`;
- CloudKit Private Database records for sealed pages, package projections, annotations, mobile captures, tombstones, outbox entries, receipts, and conflict records;
- encrypted content fields and explicit user iCloud enablement;
- a macOS 14 feature gate while retaining the non-sync compiler on older currently supported Macs;
- a native SwiftUI iPadOS 17 reader with local search, sealed-page reading, append-only page annotations, and current-day quick notes;
- conflict rules where sealed page bodies never merge, annotations merge by stable ID, and mobile captures append as new evidence candidates;
- offline outbox retries, account-change handling, schema promotion, migration fixtures, and multi-device acceptance tests.

The iPad client may write annotations and quick notes, but it must never edit a sealed page or run the Mac compiler.
