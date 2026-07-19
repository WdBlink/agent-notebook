# Agent Whiteboard v0.3.0

The first macOS-focused Agent Whiteboard release turns Daily Cockpit into a persistent, local-first workspace for Agent projects and work continuity.

## Highlights

- One persistent canvas for multiple local project directories.
- Codex Agent and shell terminal nodes with isolated embedded PTYs.
- Markdown notes, spatial headings, connections, frame resize, and saved viewport state.
- Read-only Codex and Claude Code session recovery with independently selectable providers.
- Verified session IDs, working directories, transcript locations, and copy-only resume commands.
- Previous-work brief and project grouping remain available in the Daily Cockpit view.

## macOS downloads

- `agent-whiteboard-v0.3.0-macos-arm64.zip` — Apple Silicon (M1, M2, M3, M4, and later).
- `agent-whiteboard-v0.3.0-macos-x64.zip` — Intel Macs.
- `SHA256SUMS.txt` — release archive checksums.

Each ZIP contains a guided macOS installer and a manually installable `daily-cockpit` plugin folder. Obsidian Desktop 1.5.0 or later is required.

The installer is not signed or notarized in this first release. If macOS blocks it, Control-click **Install Agent Whiteboard.command** and choose **Open** after verifying the download and checksum.

To install, unzip the matching download, open **Install Agent Whiteboard.command**, choose your Obsidian vault, then enable **Agent Whiteboard** in Obsidian's Community plugins settings.

## Current boundaries

- The first release supports macOS only.
- Codex Agent and shell terminals can be launched from the whiteboard; Claude Code launch is not enabled yet.
- Session stores remain owned by their provider and are never edited by Agent Whiteboard.
- The release is not yet listed in the Obsidian community-plugin directory.
