<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="app/desktop/assets/app-icon.png">
    <source media="(prefers-color-scheme: light)" srcset="app/desktop/assets/app-icon.png">
    <img alt="Agent Notebook notebook icon" src="app/desktop/assets/app-icon.png" width="104">
  </picture>

  <h1>Agent Notebook</h1>
  <p>A knowledge notebook co-written by you and your agents.</p>
</div>

<div align="center">

[![Node.js 22.12+][node-shield]][node-url]
[![License: MIT][license-shield]][license-url]

</div>

<div align="center">
  <a href="#macos-install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#quick-start-from-source">Build from source</a> ·
  <a href="#verification">Verify</a>
</div>

---

## Why

Agent work rarely fits inside one Session. Codex and Claude Code may advance the same intent across providers, worktrees, failures, and restarts, leaving the person to reconstruct what actually changed. Agent Notebook turns those read-only local traces into a small set of evidence-linked worklines while keeping interpretation, reflection, and closeout under human control.

The primary product is a standalone macOS app. It does not require Obsidian and never edits provider-owned Session files.

## What the App Does

- **Today Board** — move one day through an explicit `raw → compiled → stale → sealed` lifecycle without hiding the underlying Sessions.
- **Background preparation** — optionally choose one daily local time so the day's evidence-linked worklines can be ready when you return; source Sessions remain readable while preparation runs.
- **Evidence reconstruction** — organize shared intent across Codex and Claude Code, preserve conflict and uncertainty, and stop at questions that still need a person.
- **Honest activity** — distinguish explicit human interventions, observed Agent-independent activity, collaborative spans, running work, and evidence that is too weak to classify.
- **Evidence-led review** — open a workline dossier, trace generated claims back to admitted Sessions or artifacts, and read source transcripts in place.
- **Human closeout** — write reflection in a blank field, optionally keep up to three continuation bookmarks, and seal the exact active generation without AI-authored first-person conclusions.
- **Continuity views** — keep Sessions, Timeline, Map, and Sources available for inspection, navigation, provider configuration, bounded CTX context, and copy-only recovery.

## macOS Install

[Download the latest Agent Notebook release](https://github.com/WdBlink/agent-notebook/releases/latest).

Agent Notebook v0.7.4 ships a DMG and ZIP for each current Mac architecture:

```text
dist/macos/agent-notebook-0.7.4-macos-arm64.dmg
dist/macos/agent-notebook-0.7.4-macos-arm64.zip
dist/macos/agent-notebook-0.7.4-macos-x64.dmg
dist/macos/agent-notebook-0.7.4-macos-x64.zip
```

Use `arm64` on Apple Silicon and `x64` on Intel. The DMG is the normal install path; the ZIP is a fallback archive of the same app bundle.

These builds use an ad-hoc signature, without Apple Developer ID signing or notarization. After the first launch attempt, macOS may require **System Settings → Privacy & Security → Open Anyway**. Only approve a download whose source you trust.

## Usage

1. Launch Agent Notebook and open **Sources**.
2. Enable Codex, Claude Code, or both. The default read roots are `~/.codex/sessions`, `~/.codex/archived_sessions`, and `~/.claude/projects`.
3. Optionally set **每日自动准备工作脉络** to one local time. It is off by default and runs only while the app remains open.
4. Choose an uncompiled date. Its Today Board starts in **raw** and shows independent Session lanes plus only activity that can be supported by timestamps and authorship.
5. Choose **现在整理** when you want to start immediately, or let the configured daily time start the same preparation path. The board remains readable while preparation runs.
6. In **compiled**, scan the cross-Session workline board. Expand stored Session membership without another model call, use citation chips to open the exact read-only Session, or request one evidence dossier at a time.
7. If later evidence arrives, the day becomes **stale**. The previous structured index stays readable while new evidence is listed separately; choose **更新工作脉络** only when you want a new revision.
8. Read the dossier at its document reading scale. The reflection field starts blank and preserves your original words in local Agent Notebook data. After save, you may arrange five proposal categories; accept, dismiss, defer, and rewrite record a local disposition only and never write Wiki/CTX/project files, create reports, or start Agent work.
9. Review the exact active index, opened dossiers, your writing, proposal dispositions, and any continuation bookmarks, then choose **收笔并封存**. Historical sealed dates reopen without another model call.

Resume actions copy a verified command. Agent Notebook never executes that command automatically.

## Today Board States

| State | What you see | What changes it |
| --- | --- | --- |
| **raw** | Independent Session lanes and observed activity; they remain usable during preparation | **现在整理** or the configured local preparation time |
| **compiled** | A structured workline index with stored Session membership and any requested dossiers | New evidence or an explicit seal |
| **stale** | The prior structured index plus a separate list of uncompiled evidence | An explicit refresh request |
| **sealed** | The pinned index, opened dossiers, reflection, proposal dispositions, and bookmarks as read-only history | Nothing; the day is immutable |

Preparation freezes one per-node provider/model plan and never silently switches a failed node to an undeclared fallback. Failures remain visible and retryable without replacing raw Sessions or the last readable index. A reflection save or seal request is rejected if its index revision is no longer active.

## Historical Assets and Legacy Compatibility

The local stores preserve structured index/dossier revisions, admitted evidence references, per-workline human reflection, proposal dispositions, continuation bookmarks, and sealed pages. This lets a historical day replay the material that was actually reviewed rather than silently recompiling against newer Sessions or a newer workflow.

The store also continues to normalize legacy v0.5 note records and delivery receipts. Those records and the explicit Wiki/CTX delivery APIs remain compatibility data; note capture and delivery are no longer the primary Today workflow in v0.6.x.

## Quick Start From Source

Requirements: macOS and Node.js `>=22.12`.

```bash
npm install
npm run start:desktop
```

`start:desktop` builds the standalone Electron app before launching it. Use `npm run build:desktop` when you only need the packaged desktop JavaScript and assets under `dist/desktop/`.

## Source Install

Build all four local desktop archives with:

```bash
npm run dist:macos
```

`dist:macos` builds the desktop app and asks Electron Builder for both DMG and ZIP targets on both `arm64` and `x64`. The archives are written under `dist/macos/`; the command does not publish them.

## Verification

Checkpoint recovery data is temporary: successful tasks are cleaned up, and inactive failed/interrupted tasks expire 24 hours after their last activity. Saved Today pages, reflections, and decisions are retained. Expired tasks restart preparation rather than resuming old model outputs. Message-level preview is development-only and disabled in packaged apps.

To physically reclaim a legacy oversized checkpoint database, quit Agent Notebook and run from the source checkout after `npm ci`:

```bash
node --import tsx scripts/maintain-checkpoints.mjs "$HOME/Library/Application Support/Agent Notebook" --apply
```

This offline command refuses an open database, preserves a compressed `checkpoint-recovery-*` copy in the app data directory, removes expired/completed recovery state, compacts SQLite, and checks saved artifact bytes. The recovery copy can be removed after verifying historical pages. Provider transcript stores are untouched.

```bash
npm run lint
npm test
npx playwright test tests/e2e/desktop-app.spec.ts
npm run test:e2e
```

The Node unit/integration suite covers Session parsing, evidence-bounded activity, the four Today states, explicit preparation and refresh, Traceink workline compilation, generation history, atomic notebook mutations, transcript authorization, human reflection, and generation-safe saving and sealing. The Playwright browser suite covers the Today Board, activity lanes, workline and evidence readers, stale evidence, blank reflection, immutable historical replay, Sessions, Timeline, Map, Sources, responsive windows, and copy-only recovery.

Release archives have an additional bundle, version, architecture, checksum, and product-surface verifier. See [TESTING.md](TESTING.md) for the four archive-specific commands.

## Structured Today Workflow

Traceink uses the versioned `traceink-review-v1` prompt profile as an evidence-led editorial contract. It groups by shared intent and changing state rather than Session title, removes repetitive tool chatter while retaining failed paths and route changes, cites admitted evidence, separates fact from inference, preserves disagreement and scope, and describes only possible changes with falsifiable future observations.

The workflow may prepare basis evidence, but it cannot manufacture commitment. It is forbidden from claiming that the person decided, approved, adopted, delegated, migrated, authorized, or sealed anything. Generated semantic blocks remain extensible. Evidence membership, provenance, replay-safe revisions, explicit actions, and sealed immutability remain mechanically enforced.

The default Today producer is a bounded LangGraph workflow. It digests each main Session family through its source provider with bounded concurrency, includes child-Agent records as family evidence, synthesizes a typed workline index, reveals stored Session membership without another model call, and runs analysis → independent critique → composition only for a selected workline. Every run freezes one provider/model plan; failures never trigger an undeclared provider fallback. Provider-specific JSON Schema dialects are adapted at the CLI boundary, while dynamic enums require exact admitted Session and evidence IDs before local validation.

The default structured Today models are `gpt-5.6-luna` for Codex nodes and `fable` for Claude nodes. Override them with `AGENT_NOTEBOOK_TODAY_CODEX_MODEL` and `AGENT_NOTEBOOK_TODAY_CLAUDE_MODEL`; the existing `AGENT_NOTEBOOK_CODEX_REVIEW_MODEL` and `AGENT_NOTEBOOK_CLAUDE_REVIEW_MODEL` remain lower-priority compatibility overrides. Set `AGENT_NOTEBOOK_STRUCTURED_TODAY=0` only to use the preserved legacy Traceink producer.

## Local Model / Smart Session Titles

Agent Notebook renders provider metadata first. Low-priority smart titles may be generated only after the current day's workline material is already compiled or sealed, so they cannot compete with the primary review preparation. The default models are `gpt-5.3-codex-spark` and `fable`; override them with `AGENT_NOTEBOOK_CODEX_SUMMARY_MODEL` and `AGENT_NOTEBOOK_CLAUDE_SUMMARY_MODEL`, or set `AGENT_NOTEBOOK_DISABLE_SUMMARIES=1` for metadata-only mode.

These calls use the provider account and network already configured on the Mac. Original Session files remain read-only, generated summaries are cached locally, and failures stay visible instead of selecting a more expensive model silently.

## Session Recovery

Session recovery is intentionally copy-only. The evidence panel shows the provider, exact Session ID, transcript path, working directory, and verified resume command. You decide when and where that command runs.

## Privacy and Safety

- Provider Session stores are read-only.
- CTX reading is bounded to overview, progress, specification, and accepted decision documents.
- Provider toggles are applied before filesystem discovery.
- App preferences, legacy notes, review generations, reflections, bookmarks, and sealed pages stay in the macOS application-support directory.
- There is no hosted transcript service. Review and smart-title calls use only a provider CLI and account already configured on the Mac.
- Resume actions copy commands instead of executing external tools.
- The legacy Wiki/CTX delivery path still requires an explicit action and refuses project delivery without an existing CTX store; the app never adopts CTX automatically.

## Legacy Prototype

The Obsidian plugin releases from v0.2.0 through v0.3.1 are deprecated implementation history, not the current product. Shared readers and compatibility tests remain in the repository, but the standalone Agent Notebook app is the only primary release target.

## Contributing

Keep provider stores read-only, preserve explicit human authority boundaries, and run `npm run check` before submitting a change. Desktop release changes should also follow the archive-specific checks in [TESTING.md](TESTING.md).

## License

[MIT](LICENSE)

[node-shield]: https://img.shields.io/badge/node-%3E%3D22.12-417e69
[node-url]: https://nodejs.org/
[license-shield]: https://img.shields.io/badge/license-MIT-6b645a
[license-url]: LICENSE
