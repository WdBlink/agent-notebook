# Work Continuity

Work Continuity is a local, agent-native work continuity app for macOS. It reads Codex and Claude Code session stores, reconstructs what happened by project and day, and turns that evidence into a daily brief, a continuation queue, a timeline, and a navigable context map.

The product is a standalone Mac app. It does not require Obsidian and it never edits provider-owned session files.

## What The App Does

- **Brief** — see what moved today and the three most useful next actions.
- **Sessions** — inspect every matching Codex and Claude Code session, its status, path, and resume command.
- **Timeline** — review activity across all projects or within one project.
- **Map** — navigate a project tree derived from session evidence and bounded CTX documents; focusing a node preserves spatial context and expands its children.
- **Sources** — independently enable Codex and Claude Code and see exactly which local stores are being read.
- **Historical review** — open the restrained date picker; days with known session activity are marked.

The app uses the supplied stuffed Traveler's Notebook artwork as its product icon and keeps the first-demo visual language: a narrow dark rail, quiet editorial spacing, strong hierarchy, and warm physical-material cues.

## macOS Install

The first release supports both current Mac architectures:

```text
dist/macos/Work Continuity-0.4.0-macos-arm64.dmg
dist/macos/Work Continuity-0.4.0-macos-x64.dmg
```

Use the `arm64` image on Apple Silicon Macs and the `x64` image on Intel Macs. These initial builds are unsigned and not notarized, so local testing may require Control-clicking the app and choosing **Open**.

## Usage

1. Launch Work Continuity.
2. Open **Sources** and enable Codex, Claude Code, or both.
3. Choose a date from the calendar. Activity dots identify dates with known sessions.
4. Use **Brief** for the daily answer, **Sessions** for exact evidence, **Timeline** for sequence, and **Map** for project context.
5. Copy a resume command when you want to continue work. Work Continuity never executes it automatically.

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

The Node unit/integration suite covers session parsing, source selection, grouping, recovery metadata, and shared models. The Playwright browser suite includes a real Electron launch, responsive window checks, all five product surfaces, command-palette navigation, stable Map node identity during animated focus changes, and read-only CTX source inspection.

## Local Model / Smart Session Titles

Work Continuity first renders provider metadata immediately, then asks the installed Codex and Claude Code CLIs to produce compact Chinese titles and progress summaries in the background. The app explicitly selects inexpensive models (`gpt-5.3-codex-spark` and `fable` by default), uses ephemeral CLI sessions, caches only the generated summaries locally, and automatically refreshes the interface when they are ready. Model names can be overridden with `WORK_CONTINUITY_CODEX_SUMMARY_MODEL` and `WORK_CONTINUITY_CLAUDE_SUMMARY_MODEL`; setting `WORK_CONTINUITY_DISABLE_SUMMARIES=1` keeps the metadata-only mode.

These provider CLI calls may use the provider account and network configured on the Mac. Original session files remain read-only, and failures visibly fall back to metadata instead of silently selecting a more expensive model.

## Session Recovery

Session recovery is intentionally copy-only. The evidence panel shows the provider, exact session ID, transcript path, working directory, and verified resume command. The user remains in control of when and where that command runs.

## Privacy And Safety

- Provider session stores are read-only.
- CTX access is bounded to current overview, progress, specification, and accepted decision documents.
- Provider toggles are applied before filesystem discovery.
- App preferences stay in the macOS application-support directory.
- No transcript is uploaded by the app.
- Resume actions copy commands instead of executing external tools.

## Legacy Prototype

The Obsidian plugin releases from v0.2.0 through v0.3.1 are deprecated implementation history, not the current product. Their parser and recovery work remains in the repository while the standalone app is the only primary release target.

## License

MIT
