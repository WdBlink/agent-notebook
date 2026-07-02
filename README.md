<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.svg">
    <img alt="Daily Cockpit" src=".github/logo-light.svg" width="112">
  </picture>

  <h1>Daily Cockpit</h1>
  <p>ADHD-friendly external working memory for Obsidian: capture ideas, protect today, and reconnect with yesterday.</p>
</div>

<div align="center">

[![License: MIT][license-shield]][license-url]
[![Obsidian][obsidian-shield]][obsidian-url]
[![Local-first][local-first-shield]][local-first-url]

</div>

<div align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#install">Install</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#verification">Verification</a>
</div>

---

![Daily Cockpit preview](.github/cockpit-preview.svg)

## Why

AI work makes it easy to open too many threads and carry too much unfinished context in your head. Daily Cockpit gives you one quiet Obsidian surface for the morning restart: what matters today, what is happening now, and what can safely wait.

It is not a generic todo app. New ideas land in an inbox first, Today is capped at five items, and the interface repeatedly reinforces that stored ideas are not debt.

## Features

- **Quick capture without pressure**: write a thought immediately, then let it default to `灵感收纳箱` instead of becoming urgent work.
- **Bounded daily planning**: `今天` has a five-item limit and `正在做` allows exactly one active item.
- **Gentle triage states**: move ideas through `先替我记着`, `近期看看`, `归档`, and `已完成` without creating an infinite backlog.
- **Full-window Obsidian view**: the main experience is a custom view, not a cramped sidebar.
- **Local-first storage**: data is saved through Obsidian plugin data in your vault; the runtime contains no network calls.
- **Daily Markdown export**: write a structured `Daily Cockpit/YYYY-MM-DD.md` note for review, journaling, or LLM-Wiki workflows.

## Quick Start

```bash
npm install
npm run build
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
```

Open Obsidian, then run **Open Daily Cockpit** from the command palette or click the cockpit ribbon icon.

## Install

Daily Cockpit is currently installed manually as a development/community plugin:

```bash
git clone https://github.com/WdBlink/daily-cockpit.git
cd daily-cockpit
npm install
npm run build
npm run install:local -- --vault "/path/to/your/vault"
```

The install script copies `main.js`, `styles.css`, and `manifest.json` into:

```text
<vault>/.obsidian/plugins/daily-cockpit/
```

It also adds `daily-cockpit` to `.obsidian/community-plugins.json` if the plugin is not already enabled.

## Usage

Daily Cockpit adds one view, one ribbon action, and three commands:

| Entry point | What it does |
| --- | --- |
| `Open Daily Cockpit` | Opens the full-window cockpit view |
| `Quick Capture` | Captures a thought into the inbox without opening the full view |
| `Export Daily Note` | Writes `Daily Cockpit/YYYY-MM-DD.md` in the current vault |

Core states:

| State | Purpose |
| --- | --- |
| `灵感收纳箱` | Default home for new ideas |
| `今天` | Confirmed commitments, capped at five |
| `正在做` | The one thing currently in focus |
| `近期看看` | Worth revisiting soon |
| `先替我记着` | Safe holding area with no pressure |
| `已完成` | Daily completion trail |
| `归档` | Record-only storage |

## Verification

```bash
npm run lint
npm test
npm run test:e2e
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
```

`npm run test:e2e` checks the browser harness at 320px, 768px, 1024px, and 1440px and fails if the cockpit creates horizontal overflow.

## Local-first

Daily Cockpit stores data through Obsidian's local plugin data API. Runtime source is checked for `fetch`, `XMLHttpRequest`, `WebSocket`, and remote URL primitives so captured ideas stay in the vault unless you export or sync them yourself.

## License

MIT

[license-shield]: https://img.shields.io/badge/license-MIT-3f7e6b.svg
[license-url]: LICENSE
[obsidian-shield]: https://img.shields.io/badge/Obsidian-plugin-3f7e6b.svg
[obsidian-url]: https://obsidian.md
[local-first-shield]: https://img.shields.io/badge/local--first-vault%20data-3f7e6b.svg
[local-first-url]: #local-first
