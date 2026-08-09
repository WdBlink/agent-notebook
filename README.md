# Work Continuity

Work Continuity is a local work notebook for macOS. It reads Codex and Claude Code session stores, groups the day's work by project, lets you keep timestamped notes, and turns an explicit end-of-day review into a stable sealed page.

The product is a standalone Mac app. It does not require Obsidian and it never edits provider-owned session files.

## What The App Does

- **Today** — keep local notes during the day, then enter a dedicated Daily Review when you are ready to stop.
- **Daily Review** — reconstruct a few cross-session worklines, read one evidence-linked dossier at a time, write your own interpretation in a blank field, and seal the exact material and ink.
- **Sessions** — inspect every matching Codex and Claude Code session, its status, path, and resume command.
- **Timeline** — review activity across all projects or within one project.
- **Map** — navigate a project tree derived from session evidence and bounded CTX documents; focusing a node preserves spatial context and expands its children.
- **Sources** — enable Codex and Claude Code independently, inspect read roots, and manage the local LLM-Wiki root.
- **Historical review** — open the restrained date picker; days with known session activity are marked.

The app uses the supplied stuffed Traveler's Notebook artwork as its product icon and keeps the first-demo visual language: a narrow dark rail, quiet editorial spacing, strong hierarchy, and warm physical-material cues.

## macOS Install

The first release supports both current Mac architectures:

```text
dist/macos/Work Continuity-0.6.0-macos-arm64.dmg
dist/macos/Work Continuity-0.6.0-macos-x64.dmg
```

Use the `arm64` image on Apple Silicon Macs and the `x64` image on Intel Macs. These initial builds are unsigned and not notarized, so local testing may require Control-clicking the app and choosing **Open**.

## Usage

1. Launch Work Continuity.
2. Open **Sources** and enable Codex, Claude Code, or both.
3. Choose a date from the calendar. Activity dots identify dates with known sessions.
4. Use **Today** to capture thoughts while you work. The existing Sessions, Timeline, Map, and Sources views remain available as supporting material.
5. When you finish thinking for the day, choose **开始整理今天**. Work Continuity reads the verified Codex and Claude Code evidence and reconstructs a few cross-session worklines.
6. Open one workline at a time. The dossier separates prior context, concrete evidence, possible change, future observation, and the unresolved question; every admitted source remains reopenable.
7. Choose **看完了，开始思考**, write in the initially blank field, return to review another workline, and finally choose **今日收口**. You may select up to three continuation bookmarks before sealing.
8. Copy a resume command when you want to continue work. Work Continuity never executes it automatically.

Notes remain local until you explicitly use the paper-plane action. From there you can export a card, write a source into the configured `LLM-Wiki/raw`, or hand it to an existing project's CTX intake.

Default read roots:

```text
~/.codex/sessions
~/.codex/archived_sessions
~/.claude/projects
```

## Quick Start From Source

Requirements: Node.js 20+ and macOS.

```bash
npm install
npm run build:desktop
npm run start:desktop
```

`npm run build:desktop` builds only the standalone app. The broader `npm run build` command also compiles the deprecated plugin prototype so its reusable readers remain covered.

## Source Install

Create both local DMGs with:

```bash
npm run dist:macos
```

Packaging uses Electron Builder and emits separate Apple Silicon and Intel images under `dist/macos/`.

## Verification

```bash
npm run typecheck
npm test
npx playwright test tests/e2e/desktop-app.spec.ts
npm run test:e2e
```

The Node unit/integration suite covers session parsing, KSI-informed cross-session workline compilation, evidence membership, extensible semantic blocks, note persistence, per-workline user ink, sealing, source selection, recovery metadata, and shared models. The Playwright browser suite covers the two-pane Today surface, note delivery, the workline index, dossier reading, blank reflection, immutable EOD sealing, responsive window checks, all five product surfaces, command-palette navigation, stable Map node identity during animated focus changes, and CTX source inspection.

## KSI-informed Review Compiler

Daily Review does not ask a model to write the user's diary. It uses a versioned Prompt profile (`ksi-workline-review-v1`) to prepare material the user can think with. The Prompt reconstructs shared work across Sessions, recovers a load-bearing assumption when the evidence supports one, cites concrete sources, describes a possible change, states a falsifiable future observation, preserves disagreement and scope, and ends with the question still left to the human.

Generated blocks remain advisory and extensible. The application mechanically validates only source membership, replay-safe presentation data, user-authored ink, explicit actions, and sealed immutability. It rejects invented Session references and forbids the compiler from claiming that the user decided, authorized, delegated, migrated, or sealed anything.

The review compiler uses one installed provider CLI in read-only, ephemeral mode and may read the verified Codex and Claude manifest together. Its inexpensive default models are inherited from the smart-title configuration; dedicated overrides are available through `WORK_CONTINUITY_CODEX_REVIEW_MODEL` and `WORK_CONTINUITY_CLAUDE_REVIEW_MODEL`. A compiler failure remains visible and never silently falls back to the former thin project summary.

## Local Model / Smart Session Titles

Work Continuity first renders provider metadata immediately, then asks the installed Codex and Claude Code CLIs to produce compact Chinese titles and progress summaries in the background. The app explicitly selects inexpensive models (`gpt-5.3-codex-spark` and `fable` by default), uses ephemeral CLI sessions, caches only the generated summaries locally, and automatically refreshes the interface when they are ready. Model names can be overridden with `WORK_CONTINUITY_CODEX_SUMMARY_MODEL` and `WORK_CONTINUITY_CLAUDE_SUMMARY_MODEL`; setting `WORK_CONTINUITY_DISABLE_SUMMARIES=1` keeps the metadata-only mode.

These provider CLI calls may use the provider account and network configured on the Mac. Original session files remain read-only, and failures visibly fall back to metadata instead of silently selecting a more expensive model.

## Session Recovery

Session recovery is intentionally copy-only. The evidence panel shows the provider, exact session ID, transcript path, working directory, and verified resume command. The user remains in control of when and where that command runs.

## Privacy And Safety

- Provider session stores are read-only.
- CTX reading is bounded to current overview, progress, specification, and accepted decision documents.
- A note is written to LLM-Wiki or CTX only after an explicit delivery action; the original note is preserved.
- The app refuses project delivery when the project has no existing CTX store.
- Provider toggles are applied before filesystem discovery.
- App preferences, notes, drafts, sealed pages, and delivery receipts stay in the macOS application-support directory.
- The app has no hosted transcript service. Review and smart-title model calls use only the provider CLI and account already configured on the Mac; the app itself keeps no remote copy.
- Resume actions copy commands instead of executing external tools.

## Legacy Prototype

The Obsidian plugin releases from v0.2.0 through v0.3.1 are deprecated implementation history, not the current product. Their parser and recovery work remains in the repository while the standalone app is the only primary release target.

## License

MIT
