# KSI Today Board Product Surface

**Status:** Approved for implementation on 2026-08-09

## Product promise

The product turns a day of scattered Codex and Claude Code activity into a durable work log that a person can review, understand, and close.

It is not a note application, an Agent runtime, or an automatically written diary. The application prepares the work scene; the user supplies the judgment.

The validated `traceink` Skill is the semantic oracle. Given the same admitted evidence, the client compiler must preserve the Skill's observable qualities: cross-Session worklines, clean removal of execution noise, reopenable evidence, visible user/Agent participation, possible changes rather than invented decisions, and one real question left for the user.

## One surface, four durable states

The existing `今日` navigation remains the product center. It does not split daytime monitoring and end-of-day review into separate top-level products.

### 1. Raw — no KSI package for this evidence set

The board shows every admitted Session as an independent lane. Each lane contains:

- semantic/native title, provider, Session ID, project, status, and active time range;
- a compact activity track with explicit user messages and Agent activity blocks;
- an evidence action that opens the existing in-app transcript reader;
- an honest fallback when timestamps are insufficient.

The primary action is `整理工作脉络`. It is on demand because compilation costs time and tokens. The empty state is compact; it never uses most of the window to teach the product.

### 2. Compiled — a KSI package covers the current evidence cutoff

The same board becomes a semantic workline index. A workline may span providers and Sessions. It shows:

- generated semantic title and operational status;
- a tentative change signal, clearly labelled as generated interpretation;
- aggregate participation track;
- number of contributing Sessions and evidence items;
- disclosure control.

Expanding a workline reveals its constituent Sessions. Each Session retains provider, exact Session ID, title, time range, participant track, and transcript action. Expanding therefore never hides the original evidence topology.

Opening the dossier uses the existing evidence-reader interaction and the Skill contract sections: prior context, what happened, possible change, support/counter-evidence/scope, future falsification, and the unresolved human question. Headings remain semantically extensible; the product does not freeze a cognition ontology.

### 3. Stale — a package exists and newer admitted evidence is present

The previous package remains readable and unchanged. The board labels the new Session/activity as `尚未整理` and shows the package cutoff. It never silently mixes generated versions.

The primary action becomes `更新工作脉络`. Running it creates and persists a new package generation while preserving the prior generation. If compilation fails, the prior package remains the active readable asset and the failure is visible and retryable.

### 4. Sealed — the user completed review

The sealed generation is immutable and read-only. It stores the exact Prompt profile, compiler/model provenance, evidence cutoff and manifest, generated package, user-authored reflections, continuation choices, and sealing time. Later evidence or Prompt changes never rewrite it.

Opening a historical date reads the stored asset without invoking a model. A seal mark appears only in this state.

## Day loop

```text
raw Session lanes
→ on-demand KSI compilation
→ semantic workline board
→ evidence dossier
→ user writes original reflection
→ AI may arrange non-binding proposals
→ user explicitly accepts, dismisses, defers, or rewrites
→ seal
→ immutable historical log
```

For this release, the existing dossier → reflection → closeout path remains authoritative. Proposal routing to tomorrow, Wiki, CTX, or background work is not allowed to become an implicit side effect. Existing continuation bookmarks remain copy/resume pointers only.

## Participation and attention language

The product can display only observable or reconstructable activity:

- `你参与`: an explicit user message, correction, constraint, selection, rejection, or confirmation;
- `Agent 独立推进`: Agent activity between user interventions when timestamps support it;
- `共同推进`: interleaved user and Agent activity;
- `无法确定`: missing or insufficient timestamps;
- `仍在运行`: a live operational interval, not proof of progress.

The board may show observed Agent-active duration, explicit user-interaction windows, concurrent lanes, and context-switch count. It must not claim actual time saved, diagnose cognitive capacity, or present a medical-style saturation score. The secondary label is `注意力负荷线索`, accompanied by the transparent basis and confidence. When evidence is insufficient, show that instead of fabricating minutes.

## Asset lifecycle

The local notebook store is the authority for work-log assets. KSI is the semantic compiler, not the database.

Each generated package is append-only and includes:

- stable package/generation ID;
- logical date, generation time, and evidence cutoff;
- Prompt profile, provider, and model;
- admitted Session/evidence references;
- generated worklines, participation spans, dossier blocks, and unresolved questions;
- warnings and completeness information.

The current implementation may persist exact reopenable references rather than duplicating multi-megabyte transcripts. A sealed page must retain enough manifest/hash/range information to prove which evidence was used and to reopen canonical local sources when present. Missing historical sources are reported honestly.

CTX is not the work-log store. It may remain an optional project-document source or an explicitly chosen downstream destination. Wiki promotion is optional and requires a confirmed human judgment; an AI candidate alone is never long-lived knowledge.

## Capture deprecation

The note/capture tray leaves the primary Today surface. Existing note data and IPC remain readable/exportable for compatibility during this release; no stored user data is deleted. The product does not add new note-taking or inbox features.

## Secondary surfaces

Sessions, Timeline, Map, and Sources retain their existing contracts and remain auxiliary evidence/navigation surfaces. Their navigation and tests must not regress. Today Board is the only surface replaced.

## Interaction and visual contract

- Use the current native Electron shell, macOS traffic-light safe area, app icon, top bar, and sidebar.
- The board fills the available viewport; independently scroll only the lane/index region and the expanded detail region when needed.
- Use a restrained electronic neutral canvas. TN elements are accents: one brass date clip, a paper edge, and the seal mark at semantically correct moments—not a yellow simulated notebook everywhere.
- Use existing `lucide-react` icons. Do not add an icon or animation dependency for this slice.
- Preserve focus indicators, keyboard access, reduced motion, and zero horizontal document overflow at 720 px.
- Loading uses a compact skeleton. Errors preserve the last good package and offer retry. Empty states occupy only the space their content needs.

## Acceptance criteria

- [ ] With no package, four Sessions render as four independent lanes with provider, Session ID, time/activity marks, and transcript actions.
- [ ] One on-demand compile can group Codex and Claude Code Sessions into a smaller number of worklines without losing any source Session.
- [ ] A workline expands inline to exact source Sessions and can open its dossier and every admitted source.
- [ ] If the snapshot contains evidence newer than the package cutoff, the prior package stays readable and the new evidence is visibly uncompiled.
- [ ] Refresh creates a new package generation; a failed refresh cannot destroy or replace the last good generation.
- [ ] The dashboard reports participation and attention-load cues without asserting unverifiable time savings or cognitive diagnosis.
- [ ] The dossier → blank reflection → save → return → seal flow remains operational and user text is never prefilled by AI.
- [ ] A sealed historical day loads without compiler invocation and remains unchanged after newer Session evidence.
- [ ] Capture is absent from the primary Today surface while legacy note data remains loadable.
- [ ] Sessions, Timeline, Map, Sources, transcript reading, and resume-copy behavior pass their existing regressions.
- [ ] Desktop and 720 px layouts have no horizontal overflow and keep usable independent scrolling.

## Non-goals for this release

- automatic high-frequency/background KSI compilation;
- a general note editor or capture inbox;
- claims of actual human time saved;
- fixed DecisionTransition/event ontologies in the UI;
- automatic Wiki/CTX promotion;
- automatic background execution;
- iCloud/iPad sync, personalization, or native mobile clients;
- deleting or rewriting legacy notes/pages.
