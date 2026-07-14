# Testing Daily Cockpit

Daily Cockpit has four verification layers: TypeScript tests, browser harness tests, local Obsidian vault installation checks, and a real Obsidian desktop E2E.

## Environment Setup

```bash
npm install
npm run build
```

The plugin uses Node.js 22 during development and targets Obsidian's Electron runtime.

## Feature Inventory

| Feature | Command or entry point | Expected behavior |
| --- | --- | --- |
| Full-window hot-start view | `打开每日热启动` | Opens `daily-cockpit-view` |
| Ribbon action | List-check icon | Opens the same full-window view |
| Yesterday work sessions | `刷新昨日工作会话` | Indexes canonical local metadata and, in provider CLI mode, asks each platform to summarize only its own sessions |
| Session recovery | `续上会话` | Copies a shell-safe command containing the verified cwd/worktree and real session ID |
| Quick decomposition | `快速拆解待办` | Sends one intent to the configured model and stores a task plan |
| Model settings | Plugin settings | Stores endpoint, model, API key, export folder, and session scan roots |
| Hot-start selection | Task checkbox | Adds or removes a generated todo from the hot-start list |
| Markdown export | `导出热启动清单` | Writes `Daily Cockpit/YYYY-MM-DD.md` with sessions and hot starts |
| Local persistence | Obsidian plugin data | Data survives reload through `data.json` |

## Automated Checks

```bash
npm run lint
npm test
npm run test:e2e
npm run test:obsidian -- --vault "$HOME/Knowledge/Obsidian"
```

`npm run lint` includes type checking, README asset checks, and a privacy check that rejects hardcoded public LLM hosts or API keys.

`npm test` covers task decomposition state, hot-start selection, current Codex/Claude metadata formats, provider prompt isolation, generated-ID rejection, resume command quoting, export formatting, renderer states, install behavior, and Obsidian registration source checks.

`npm run test:e2e` builds a deterministic browser harness and verifies responsive layout, session refresh, and scroll containment at 320px, 768px, 1024px, and 1440px.

`npm run test:obsidian` is the real local Obsidian E2E. It builds and installs the plugin, restarts Obsidian with a remote debugging port, temporarily selects metadata-only mode, clicks the real `刷新` button, requires a real yesterday Codex/Claude transcript, clicks that session's `续上会话` button, verifies the exact macOS clipboard value, restores the prior summary mode, exports Markdown, and writes `test-results/obsidian-daily-cockpit.png`.

## Local Obsidian Check

```bash
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
npm run test:obsidian -- --vault "$HOME/Knowledge/Obsidian"
open -a Obsidian
```

In Obsidian:

1. Open the command palette.
2. Run `打开每日热启动`.
3. Confirm `昨日工作会话` is visible. If there are no local session files from yesterday, confirm the empty state appears instead.
4. Run `刷新昨日工作会话` and confirm each summarized card keeps a real `id`, session file, and cwd/worktree. A CLI failure should appear as a compact warning without hiding resumable sessions.
5. Click `续上会话`, run `pbpaste`, and confirm the clipboard has `cd <quoted path> && codex resume <id>` or `cd <quoted path> && claude --resume <id>`.
6. Paste that command into a terminal. Confirm the provider displays the prior conversation, correct working directory, and the same session ID before exiting.
7. Enter one Chinese paragraph describing today's goal.
8. Click `拆成待办`.
9. Confirm generated todos appear. If no local model is running, confirm the recoverable model error appears instead.
10. Select at least one todo as hot start.
11. Run `导出热启动清单`.
12. Confirm `Daily Cockpit/YYYY-MM-DD.md` contains `## 昨日工作会话`, `## 原始意图`, `## 选定热启动`, and `## 全部待办候选`.

## Cleanup

Remove the development install:

```bash
rm -rf "$HOME/Knowledge/Obsidian/.obsidian/plugins/daily-cockpit"
```

If needed, remove `daily-cockpit` from:

```text
$HOME/Knowledge/Obsidian/.obsidian/community-plugins.json
```
