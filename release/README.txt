Agent Whiteboard __VERSION__ for macOS (__ARCH__)
==================================================

Requirements
------------
- macOS on __ARCH__
- Obsidian Desktop 1.5.0 or later
- Codex and/or Claude Code local session files (optional)

Install
-------
1. Double-click "Install Agent Whiteboard.command".
2. Select your Obsidian Vault folder.
3. Open Obsidian -> Settings -> Community plugins.
4. Enable "Agent Whiteboard" and reload Obsidian if it was already open.

The installer copies only plugin assets into:
  <vault>/.obsidian/plugins/agent-notebook/

It does not delete or replace data.json, and it does not start Codex or Claude Code.

Manual install
--------------
Copy the included "agent-notebook" folder to:
  <vault>/.obsidian/plugins/agent-notebook/

Privacy
-------
Session readers are local and read-only. Provider selection is stored locally.
Terminal processes start only after an explicit user action.
