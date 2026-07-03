# Testing Daily Cockpit

Daily Cockpit has three verification layers: TypeScript tests, browser harness tests, and local Obsidian vault installation checks.

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
| Quick decomposition | `快速拆解待办` | Sends one intent to the configured model and stores a task plan |
| Model settings | Plugin settings | Stores endpoint, model, API key, and export folder |
| Hot-start selection | Task checkbox | Adds or removes a generated todo from the hot-start list |
| Markdown export | `导出热启动清单` | Writes `Daily Cockpit/YYYY-MM-DD.md` |
| Local persistence | Obsidian plugin data | Data survives reload through `data.json` |

## Automated Checks

```bash
npm run lint
npm test
npm run test:e2e
```

`npm run lint` includes type checking, README asset checks, and a privacy check that rejects hardcoded public LLM hosts or API keys.

`npm test` covers task decomposition state, hot-start selection, export formatting, renderer states, model-output parsing, install behavior, and Obsidian registration source checks.

`npm run test:e2e` builds a deterministic browser harness and verifies responsive layout at 320px, 768px, 1024px, and 1440px.

## Local Obsidian Check

```bash
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
open -a Obsidian
```

In Obsidian:

1. Open the command palette.
2. Run `打开每日热启动`.
3. Enter one Chinese paragraph describing tomorrow's goal.
4. Click `拆成待办`.
5. Confirm generated todos appear. If no local model is running, confirm the recoverable model error appears instead.
6. Select at least one todo as hot start.
7. Run `导出热启动清单`.
8. Confirm `Daily Cockpit/YYYY-MM-DD.md` contains `## 原始意图`, `## 选定热启动`, and `## 全部待办候选`.

## Cleanup

Remove the development install:

```bash
rm -rf "$HOME/Knowledge/Obsidian/.obsidian/plugins/daily-cockpit"
```

If needed, remove `daily-cockpit` from:

```text
$HOME/Knowledge/Obsidian/.obsidian/community-plugins.json
```
