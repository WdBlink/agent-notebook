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

- **Agent-written yesterday brief**: indexes canonical local metadata, then asks Codex to summarize Codex sessions and Claude Code to summarize Claude sessions with one read-only structured prompt.
- **Verified resume commands**: shows the real session ID, cwd/repository/worktree, and copies a shell-safe `cd ... && codex resume <id>` or `cd ... && claude --resume <id>` command.
- **Intent-first planning**: type one rough Chinese or English paragraph instead of maintaining a generic todo board.
- **Local-model decomposition**: calls an OpenAI-compatible chat endpoint and expects structured JSON tasks.
- **Selectable Hot Start**: every generated todo has a checkbox; only selected tasks enter the Hot Start list.
- **Obsidian-native export**: writes `Daily Cockpit/YYYY-MM-DD.md` with yesterday's sessions, the original intent, selected hot starts, and all candidates.
- **Trust boundary**: model output may supply only title, summary, artifacts, and status. Session IDs and paths always come from local metadata and are never accepted from generated text.

Daily Cockpit borrows one practical idea from [FanBox](https://github.com/alchaincyf/fanbox): agent memory should stay local, visible, and resumable. It does not recreate FanBox's full cockpit, file browser, terminal, or replay system.

## Quick Start

```bash
npm install
npm run build
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
```

Open Obsidian, then run **打开每日热启动** from the command palette or click the ribbon icon.

Codex and Claude Code are optional. When their CLIs are installed and **平台 CLI 总结** is enabled, an explicit refresh lets each provider summarize only its own sessions. Choose **仅显示元数据** to disable those model calls.

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
| `刷新昨日工作会话` | Indexes yesterday's sessions, optionally asks each provider for a structured summary, then caches the validated result |
| `快速拆解待办` | Opens a modal for one quick intent |
| `导出热启动清单` | Writes `Daily Cockpit/YYYY-MM-DD.md` in the current vault |

Basic flow:

1. Open Daily Cockpit and review **昨日工作会话**.
2. Click **刷新** when you want Codex/Claude to prepare a new yesterday brief. Startup never triggers a paid summary call.
3. Click **续上会话** to copy the exact terminal command for a session.
4. Describe today's goal in one paragraph.
5. Click **拆成待办**.
6. Check the todos suitable for Hot Start preparation.
7. Export the Markdown note when you want a durable handoff.

## How Session Summaries Work

```text
local metadata index
  -> canonical sessionId + transcript path + cwd/worktree
  -> one read-only prompt to the matching provider CLI
  -> strict JSON validation (summary fields only)
  -> cached Obsidian snapshot + locally generated resume command
```

The model is responsible for understanding work. The plugin is responsible for identity, paths, validation, caching, and command safety. Unknown IDs in model output are discarded, one provider failing does not hide the other provider's sessions, and no transcript instruction is treated as an instruction for the summarizer.

## Local Model

By default, the plugin calls:

```text
http://127.0.0.1:11434/v1/chat/completions
```

The default model name is `qwen2.5:7b`. This endpoint is used for today's intent-to-todo decomposition. You can change endpoint, model, API key, export folder, session scan roots, summary mode, and CLI paths in the plugin settings.

The code does not include a public LLM host or hardcoded API key. If you point the endpoint at a remote provider, that is your explicit configuration.

## Session Sources

Default scan roots:

```text
~/.codex/sessions
~/.codex/archived_sessions
~/.codex/memories/rollout_summaries
~/.claude/projects
~/.claude/tasks
~/.minimax/plans
```

The metadata index is intentionally bounded: it filters to the previous local day, gives each root a fair scan budget, caps the final session count, and tolerates missing or unreadable roots.

## Privacy

Metadata-only mode never invokes Codex or Claude Code. In provider CLI mode, clicking refresh lets Codex read the listed Codex transcript files and Claude Code read the listed Claude transcript files. Sessions are never sent across providers. Those CLI calls use your existing provider configuration and may consume tokens; the plugin does not trigger them during startup.

## Verification

```bash
npm run lint
npm test
npm run test:e2e
npm run test:obsidian -- --vault "$HOME/Knowledge/Obsidian"
npm run install:local -- --vault "$HOME/Knowledge/Obsidian"
npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"
```

`npm run test:e2e` checks the browser harness at 320px, 768px, 1024px, and 1440px, including long todo lists with internal scroll containers.

`npm run test:obsidian` is the real desktop E2E: it installs the current build, opens the actual Obsidian runtime, refreshes real local session metadata, selects a resumable session whose transcript exists, clicks its `续上会话` button, verifies the exact macOS clipboard value, exports Markdown, and saves a screenshot under `test-results/`.

## License

MIT

[license-shield]: https://img.shields.io/badge/license-MIT-3f7e6b.svg
[license-url]: LICENSE
[obsidian-shield]: https://img.shields.io/badge/Obsidian-plugin-3f7e6b.svg
[obsidian-url]: https://obsidian.md
[local-model-shield]: https://img.shields.io/badge/model-localhost%20default-3f7e6b.svg
[local-model-url]: #local-model
