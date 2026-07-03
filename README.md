<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.svg">
    <img alt="Daily Cockpit" src=".github/logo-light.svg" width="112">
  </picture>

  <h1>Daily Cockpit</h1>
  <p>Wake up to yesterday's local agent work, then turn today's intent into selectable AI hot-start tasks inside Obsidian.</p>
</div>

<div align="center">

[![License: MIT][license-shield]][license-url]
[![Obsidian][obsidian-shield]][obsidian-url]
[![Local Model][local-model-shield]][local-model-url]

</div>

<div align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#local-model">Local Model</a> &middot;
  <a href="#verification">Verification</a>
</div>

---

![Daily Cockpit preview](.github/cockpit-preview.svg)

## Why

Coding agents are useful, but their work often disappears into yesterday's terminal history. Daily Cockpit is a small Obsidian morning board that restores that context: what Codex, Claude, or other local agents did yesterday, where the session lives, and which thread can be resumed.

After that, it stays simple. You write one natural-language intent for today, a local model decomposes it into todos, and you explicitly choose which tasks become Hot Start candidates.

## Features

- **Yesterday's Agent Sessions**: scans local Codex, Claude, and Minimax-style session files, then shows platform, title, summary, path, id, and resume command.
- **Intent-first planning**: type one rough Chinese or English paragraph instead of maintaining a generic todo board.
- **Local-model decomposition**: calls an OpenAI-compatible chat endpoint and expects structured JSON tasks.
- **Selectable Hot Start**: every generated todo has a checkbox; only selected tasks enter the Hot Start list.
- **Obsidian-native export**: writes `Daily Cockpit/YYYY-MM-DD.md` with yesterday's sessions, the original intent, selected hot starts, and all candidates.
- **Local-first boundary**: session scanning reads local files only. Session text is not sent to any model during scan or render.

Daily Cockpit borrows one practical idea from [FanBox](https://github.com/alchaincyf/fanbox): agent memory should stay local, visible, and resumable. It does not recreate FanBox's full cockpit, file browser, terminal, or replay system.

## Quick Start

```bash
npm install
npm run build
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
```

Open Obsidian, then run **打开每日热启动** from the command palette or click the ribbon icon.

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

It also enables `daily-cockpit` in `.obsidian/community-plugins.json` when needed.

## Usage

Daily Cockpit adds one view, one ribbon action, and four commands:

| Entry point | What it does |
| --- | --- |
| `打开每日热启动` | Opens the full-window cockpit |
| Ribbon icon | Opens the same view |
| `刷新昨日工作会话` | Re-reads local agent session roots |
| `快速拆解待办` | Opens a modal for one quick intent |
| `导出热启动清单` | Writes `Daily Cockpit/YYYY-MM-DD.md` in the current vault |

Basic flow:

1. Open Daily Cockpit and review **昨日工作会话**.
2. Refresh sessions if you started or moved agent work after Obsidian opened.
3. Describe today's goal in one paragraph.
4. Click **拆成待办**.
5. Check the todos suitable for Hot Start preparation.
6. Export the Markdown note when you want a durable handoff.

## Local Model

By default, the plugin calls:

```text
http://127.0.0.1:11434/v1/chat/completions
```

The default model name is `qwen2.5:7b`. You can change endpoint, model, API key, export folder, and session scan roots in the plugin settings.

The code does not include a public LLM host or hardcoded API key. If you point the endpoint at a remote provider, that is your explicit configuration.

## Session Sources

Default scan roots:

```text
~/.codex/archived_sessions
~/.codex/memories/rollout_summaries
~/.claude/tasks
~/.minimax/plans
```

The scanner is intentionally bounded: it filters to the previous local day, caps the number of files and sessions, and tolerates missing or unreadable roots.

## Verification

```bash
npm run lint
npm test
npm run test:e2e
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
```

`npm run test:e2e` checks the browser harness at 320px, 768px, 1024px, and 1440px, including long todo lists with internal scroll containers.

## License

MIT

[license-shield]: https://img.shields.io/badge/license-MIT-3f7e6b.svg
[license-url]: LICENSE
[obsidian-shield]: https://img.shields.io/badge/Obsidian-plugin-3f7e6b.svg
[obsidian-url]: https://obsidian.md
[local-model-shield]: https://img.shields.io/badge/model-localhost%20default-3f7e6b.svg
[local-model-url]: #local-model
