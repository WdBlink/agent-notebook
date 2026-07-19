# Testing Daily Cockpit

Daily Cockpit has four verification layers: model and state tests, browser interaction tests, local installation integrity checks, and an optional real Obsidian desktop run.

## Prerequisites

```bash
npm install
npm run build
```

The fake-runtime Agent Whiteboard checks do not require Codex, Claude Code, Ollama, or provider authentication. The native host integration uses `/bin/zsh` only and temporary project directories. The continuity-board real E2E still requires the local services and provider sessions used by that feature.

## Automated Checks

```bash
npm run typecheck
node --import tsx --test tests/whiteboard-model.test.ts
npm test
npm run test:e2e
npm run test:runtime-host
npm run check
```

The Node tests cover exact schema-one migration output, schema-two byte idempotence, malformed and non-finite records, duplicate identities and roots, orphan edges, explicit ownership, frame containment, terminal creation without persisted runtime truth, argv-only launch resolution, versioned IPC validation, owner isolation, resize acknowledgement, recoverable terminal operation queues, bounded fail-closed companion cleanup, committed board revisions, typed same-record conflict choices, controller broadcasts, cancellation commit phases, concurrent settings/whiteboard/registration writes, rejected migration recovery, canonical aliases, and cancellation-safe runner cleanup across every forced stage.

The Playwright tests exercise one global pane at desktop and narrow widths. They cover Codex/shell creation with explicit Claude unavailability, isolated xterm buffers through the actual xterm buffer API, resize acknowledgement, input routing, delete cleanup, structured recoverable failures, focused `Shift+F10`, frame movement, physical frame resize handles, explicit reassignment, controlled viewport refresh, semantic zoom, global headings, deferred saves, rejected-save retry, both same-record conflict choices, two-controller broadcasts, the shipped modal presenter and plugin consumer, cancellation during validation and queue wait, blocked close after the durable commit point, commit focus, durable removal/rerender, close-time flush, and a migration-error to populated-canvas transition on the same mounted React root.

`test:runtime-host` starts the packaged host with system Node, launches two real PTYs from distinct temporary paths containing spaces and Unicode, checks output sequence and routing isolation, waits for exact resize acknowledgements, and verifies process termination. It never starts an interactive provider session.

## Local Install

```bash
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
```

`install-local.mjs` validates a present whiteboard before changing plugin assets. A malformed outer document or malformed whiteboard fails closed. A valid schema-one whiteboard is preserved for plugin-load migration. It installs only the current-platform `node-pty` native binary and helper beside the versioned host. `verify-local.mjs` is read-only, hashes those assets, rejects an unpruned runtime tree or persisted terminal truth, and strictly validates schema two; `--allow-schema-one` exists only for inspecting a deliberately restored pre-migration backup.

Use a temporary vault for automated install/verify tests. Do not point repository checks at a working vault.

## macOS Release Packages

Build and verify the current Mac architecture with:

```bash
ARCH="$(node -p process.arch)"
VERSION="$(node -p 'require("./package.json").version')"
npm run release:macos -- --arch "$ARCH"
for FORMAT in dmg zip; do
  npm run verify:release -- \
    --archive "dist/release/agent-whiteboard-v${VERSION}-macos-${ARCH}.${FORMAT}" \
    --arch "$ARCH"
done
```

The release workflow repeats lint, Node tests, native-host tests, DMG mounting, archive construction, architecture inspection, manifest hashing, and packaged-runtime smoke tests on native Apple Silicon and Intel macOS runners. A tag matching `package.json` publishes both DMG files, ZIP fallbacks, and `SHA256SUMS.txt`.

## Real Whiteboard E2E

macOS, Obsidian at the configured application path, an unused debugging port, and a vault already known to Obsidian are required. Close or save unrelated editor work before starting because the runner controls Obsidian shutdown and relaunch.

```bash
npm run test:obsidian -- \
  --whiteboard-only \
  --vault "$HOME/Knowledge/Obsidian" \
  --port 9222 \
  --evidence test-results/obsidian-whiteboard-evidence.json
```

Use `--obsidian-bin /path/to/Obsidian` when the application is not installed at `/Applications/Obsidian.app/Contents/MacOS/Obsidian`.

The runner performs this lifecycle:

1. Delivers a controlled Obsidian quit, waits for CDP closure and the complete observed process tree to exit, then snapshots `main.js`, `styles.css`, `manifest.json`, `data.json`, and `community-plugins.json`.
2. Builds and installs the plugin, then atomically writes a schema-one fixture while Obsidian is closed.
3. Launches Obsidian with CDP, validates exact schema-two migration, and opens Agent Whiteboard through the visible ribbon control.
4. Uses visible context-menu and zoom controls, drags a frame, and records provider process and transcript snapshots.
5. Quits and launches a second Obsidian process, then verifies exact viewport, geometry, ownership, and schema-two persistence.
6. Aborts and joins every in-flight stage, closes CDP, verifies every launch PID is dead, then atomically restores every pre-run file and checks the restoration hashes again after a stability interval in `finally`. If an injected mutator ignores cancellation, restoration is refused and the evidence records the unresolved owner.

Strict schema-two verification is recorded before cleanup. After cleanup, the runner intentionally restores the exact original bytes, which may be schema one; it does not claim that restored user data is schema two. The evidence JSON survives cleanup and contains launch PIDs, action timestamps, document hashes, provider-process observations, transcript hashes, and restoration hashes.

Cleanup paths can be audited with controlled failures:

```bash
npm run test:obsidian -- --whiteboard-only --vault "$VAULT" --fail-after install
npm run test:obsidian -- --whiteboard-only --vault "$VAULT" --fail-after migration
npm run test:obsidian -- --whiteboard-only --vault "$VAULT" --fail-after placeholders
npm run test:obsidian -- --whiteboard-only --vault "$VAULT" --fail-after relaunch
```

Each injected failure must exit nonzero while still writing evidence and restoring the original vault files. Do not report a real-Obsidian pass unless this command was actually executed and its evidence has `"status": "passed"` and `restoration.ok: true`.

The provider-free runner lifecycle and process parser can be exercised without Obsidian:

```bash
node scripts/e2e-whiteboard-obsidian.mjs --contract-self-test
```

This adapter test covers delayed write/launch cancellation, cancellation-ignoring restoration refusal, process-group termination, independent cleanup-budget starvation, child-process provider-poll rejection, CDP/process restoration ordering, and direct/shell/env/npm/npx provider command corpora with transition polling.

## Manual Whiteboard Acceptance

1. Open `Agent Whiteboard` and confirm every registered project frame appears in one pane with no project selector.
2. Add valid, duplicate-symlink, unreadable, invalid, and cancelled project paths; only unique readable canonical directories may persist.
3. Move and resize frames, relaunch Obsidian, and confirm owned nodes move by the same delta and remain contained.
4. Overlap a node with another frame and confirm ownership does not change; use the reassignment menu and confirm it does.
5. Use a frame context menu to create one Codex session and one shell terminal; confirm exact project cwd, isolated input/output, resize acknowledgement, stop/restart, and delete cleanup. Confirm Claude Code reports unavailable and starts no process.
6. Zoom to `0.5` or below and confirm each frame summary remains at least 12 screen pixels.
7. Trigger a save failure and confirm the visible retry state keeps the latest edit until persistence succeeds.

Obsidian's `onunload` hook is synchronous, so it cannot await gateway disposal. The plugin starts disposal there, while companion IPC disconnect handling is the authoritative fail-closed cleanup path.
