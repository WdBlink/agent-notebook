# Testing Work Continuity

Work Continuity has four release gates: static and unit checks, desktop browser interaction checks, macOS archive verification, and a short manual Today Board acceptance pass. Legacy Obsidian plugin checks remain available in a separate compatibility section; they are not desktop packaging directions.

## Prerequisites

- macOS
- Node.js `>=22.12`
- npm dependencies installed with `npm install`

The automated tests use fixtures and temporary directories. Provider authentication is not required unless you deliberately exercise a real Traceink compilation or live smart-title request.

## Desktop Development Checks

Build only the standalone app:

```bash
npm run build:desktop
```

Run the repository release gates:

```bash
npm run lint
npm test
npm run test:e2e
```

`npm run lint` runs TypeScript, privacy, and README checks. `npm test` rebuilds the project and runs the Node unit/integration suite. `npm run test:e2e` rebuilds the project and runs the full Playwright suite, including intentional legacy-plugin coverage.

For a faster desktop-only browser pass after `build:desktop`:

```bash
npx playwright test tests/e2e/desktop-app.spec.ts
```

The desktop coverage includes Session discovery and parsing, activity evidence, Today Board projection, explicit compile/refresh preparation, Traceink prompt and evidence contracts, atomic generation commits, stale evidence, transcript authorization, notebook recovery, per-workline human reflection, generation-safe saving and sealing, historical replay, the five navigation surfaces, responsive windows, and copy-only Session recovery.

## macOS Release Packages

Build the DMG and ZIP for both supported architectures without publishing:

```bash
npm run dist:macos
```

`dist:macos` runs `build:desktop`, then Electron Builder emits four archives under `dist/macos/`:

```text
Work Continuity-<version>-macos-arm64.dmg
Work Continuity-<version>-macos-arm64.zip
Work Continuity-<version>-macos-x64.dmg
Work Continuity-<version>-macos-x64.zip
```

Verify each archive explicitly:

```bash
VERSION="$(node -p 'require("./package.json").version')"

npm run verify:desktop-release -- --archive "dist/macos/Work Continuity-${VERSION}-macos-arm64.dmg" --arch arm64
npm run verify:desktop-release -- --archive "dist/macos/Work Continuity-${VERSION}-macos-arm64.zip" --arch arm64
npm run verify:desktop-release -- --archive "dist/macos/Work Continuity-${VERSION}-macos-x64.dmg" --arch x64
npm run verify:desktop-release -- --archive "dist/macos/Work Continuity-${VERSION}-macos-x64.zip" --arch x64
```

The verifier mounts or extracts the archive and then checks:

- the archive contains `Work Continuity.app` and the required app bundle files;
- `CFBundleShortVersionString` matches `package.json`;
- the executable contains exactly the requested architecture;
- the packaged main process and preload bridge expose explicit daily-review preparation;
- the packaged compiler carries `traceink-review-v1`;
- the main process preserves package generations, generation-safe reflection saves and sealing, and sealed evidence access;
- the renderer carries all four Today states, the workline board, participation display, evidence reader, human reflection, and sealing surface;
- a sibling `<archive>.sha256` matches when that checksum file exists.

The local `dist:macos` command does not create checksum files. The GitHub macOS workflow creates one checksum per archive before running the same verifier. It builds and tests on native Apple Silicon and Intel runners, then publishes only from the separate publish job after both architecture jobs pass.

Use `dist:macos` for desktop packages. `release:plugin:macos` is only for the deprecated plugin package and is not a Work Continuity desktop release command.

## Manual Today Board Acceptance

1. Open **Sources**, enable at least one provider with fixture or real local Sessions, and select an unsealed date.
2. Confirm **raw** shows independent Session lanes. Activity labels must distinguish explicit human intervention, observed Agent-independent work, collaborative/running spans, and uncertainty without turning duration into importance.
3. Choose **整理工作脉络** and confirm the board changes to **compiled** only after preparation succeeds.
4. Expand a workline's source Sessions, open its dossier, and reopen at least one admitted transcript or artifact from the evidence reader.
5. Confirm generated interpretation is labeled, the dossier leaves a real human question, and the reflection field starts blank.
6. Add later evidence for the same date and refresh the snapshot. Confirm **stale** preserves the prior workline generation while listing the uncompiled evidence separately.
7. Choose **更新工作脉络** and confirm success appends and activates a new generation; a failure must leave the prior generation readable.
8. Write and save a reflection, open **今日收口**, select zero to three continuation bookmarks, and seal the active generation. If a refresh activates a newer generation while the review is open, both the stale save and stale seal must fail without modifying the newer package.
9. Reopen the sealed date. Confirm the selected workline package, evidence links, original reflection, and bookmarks are read-only and no model request occurs.

These v0.6.0 archives are unsigned and not notarized. A first manual launch may require Control-clicking **Work Continuity.app** and choosing **Open**.

## Legacy Obsidian Plugin Compatibility

The following commands intentionally cover the deprecated Agent Whiteboard/Obsidian implementation and shared runtime readers. They remain useful for compatibility maintenance, but they are not the primary Work Continuity product or release path.

```bash
npm run build:plugin
npm run test:runtime-host
```

Use a temporary vault for install integrity checks; do not point automated checks at a working vault:

```bash
npm run install:local -- --vault "/path/to/temporary-vault"
npm run verify:local -- --vault "/path/to/temporary-vault"
```

The optional real-Obsidian lifecycle still requires macOS, an Obsidian-known vault, an unused debugging port, and permission to quit and relaunch Obsidian:

```bash
npm run test:obsidian -- \
  --whiteboard-only \
  --vault "/path/to/temporary-vault" \
  --port 9222 \
  --evidence test-results/obsidian-whiteboard-evidence.json
```

Do not report a real-Obsidian pass unless the command actually ran and its evidence contains `"status": "passed"` and `restoration.ok: true`. The provider-free lifecycle adapter can be checked separately:

```bash
node scripts/e2e-whiteboard-obsidian.mjs --contract-self-test
```
