# Testing Daily Cockpit

Daily Cockpit has three verification layers: pure TypeScript tests, browser harness tests, and local Obsidian vault installation checks.

## Environment Setup

```bash
npm install
npm run build
```

The plugin uses Node.js 22 during development and targets Obsidian's Electron runtime.

## Feature Inventory

| Feature | Command or entry point | Expected behavior |
| --- | --- | --- |
| Full-window cockpit | `Open Daily Cockpit` | Opens `daily-cockpit-view` with persistent navigation |
| Ribbon action | Cockpit icon | Opens the same full-window view |
| Quick capture | `Quick Capture` | Saves a new item to `灵感收纳箱` |
| Today planning | Card action `进今天` | Moves item to Today unless the five-item limit is reached |
| Current focus | Card action `现在做` | Keeps exactly one item in `正在做` |
| Daily export | `Export Daily Note` | Writes `Daily Cockpit/YYYY-MM-DD.md` |
| Local persistence | Obsidian plugin data | Data survives reload through `data.json` |

## Automated Checks

```bash
npm run lint
npm test
npm run test:e2e
```

`npm run lint` includes type checking, README asset checks, and a runtime privacy check for network primitives.

`npm test` covers state transitions, export formatting, renderer empty/error states, and Obsidian registration source checks.

`npm run test:e2e` builds a browser harness and verifies responsive layout at 320px, 768px, 1024px, and 1440px.

## Local Obsidian Check

```bash
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
open -a Obsidian
```

In Obsidian:

1. Open the command palette.
2. Run `Open Daily Cockpit`.
3. Capture a short Chinese idea.
4. Move it to `今天`.
5. Run `Export Daily Note`.
6. Confirm `Daily Cockpit/YYYY-MM-DD.md` exists in the vault.

## Cleanup

Remove the development install:

```bash
rm -rf "$HOME/Knowledge/Obsidian/.obsidian/plugins/daily-cockpit"
```

If needed, remove `daily-cockpit` from:

```text
$HOME/Knowledge/Obsidian/.obsidian/community-plugins.json
```
