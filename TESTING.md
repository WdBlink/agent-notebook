# Testing Daily Cockpit

Daily Cockpit has four verification layers: TypeScript tests, Playwright browser tests, installation integrity checks, and a real Obsidian desktop E2E.

## Prerequisites

```bash
npm install
npm run build
ollama serve
ollama pull qwen2.5:7b
```

Real recovery verification also requires an authenticated `codex` CLI and at least one canonical Codex session with activity on the previous local calendar day.

## Feature Contract

| Feature | Entry point | Expected behavior |
| --- | --- | --- |
| Continuity board | `打开 Daily Cockpit` | Opens `daily-cockpit-view` with previous work before the composer |
| Session index | `刷新昨日工作会话` | Reads canonical Codex and Claude metadata for the previous local day |
| Session Recovery | `续上会话` | Copies a quoted command containing the verified workspace and session ID |
| Artifact access | Session and project actions | Opens an artifact, reveals a transcript, or opens a project directory |
| Intent decomposition | `快速拆解待办` or the inline form | Calls the configured model and stores a target-dated task plan |
| Task completion | Task checkbox | Changes only the user's completion state |
| Markdown export | `导出每日简报` | Writes previous work, tomorrow's intent, and tasks |
| Local persistence | Obsidian plugin data | Migrates to schema version 3 and survives reload |

## Automated Checks

```bash
npm run lint
npm test
npm run test:e2e
npm run check
```

- `npm run lint` performs type checking, privacy checks, and README asset checks.
- `npm test` covers dates, migration, canonical provider metadata, summary isolation, recovery quoting, project grouping, export, installation, and renderer state restoration.
- `npm run test:e2e` verifies responsive layout, internal long-list scrolling, project refresh, task completion, clipboard behavior, and preservation of scroll, focus, selection, and drafts.

## Real Obsidian E2E

```bash
npm run test:obsidian -- \
  --vault "$HOME/Knowledge/Obsidian" \
  --model qwen2.5:7b
```

The script:

1. Builds and installs the current plugin.
2. Verifies installed file hashes and schema version without manufacturing a Markdown result.
3. Restarts the actual Obsidian desktop app over a debugging port.
4. Clicks the real previous-work refresh control in metadata mode.
5. Requires a canonical Codex session from the previous local day.
6. Clicks `续上会话` and compares the macOS clipboard with the command derived from local metadata.
7. Runs `codex exec resume <id>` in the recorded workspace and requires the same thread ID plus a returned marker.
8. Submits the real inline form to the configured Ollama model and requires a dated task plan.
9. Clicks the real export button and validates the written Markdown headings.
10. Saves `test-results/obsidian-daily-cockpit.png`, restores the original plugin data, and removes the temporary export folder.

## Manual Acceptance

```bash
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
open -a Obsidian
```

1. Run `打开 Daily Cockpit` and confirm the previous-work board is the primary surface.
2. Confirm sessions are grouped by project or worktree, while Codex and Claude appear as source labels.
3. Use `打开目录`, `查看产物`, and `查看过程` on paths that exist.
4. Click `续上会话`, run `pbpaste`, and confirm the command contains the exact quoted directory and session ID.
5. Execute the command in a terminal and confirm the provider resumes the same conversation.
6. Enter one paragraph for tomorrow, click `拆成待办`, and confirm only ordinary tasks appear.
7. Scroll a long task list, edit the input draft, toggle a task, and confirm position and draft remain intact.
8. Run `导出每日简报` and confirm the filename uses the plan's `targetDate`.
9. Confirm the note contains `## 昨日工作`, `## 明日意图`, and `## 待办事项`.

## Cleanup

Remove the development install only when needed:

```bash
rm -rf "$HOME/Knowledge/Obsidian/.obsidian/plugins/daily-cockpit"
```
