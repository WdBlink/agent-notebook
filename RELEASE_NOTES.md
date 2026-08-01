# Work Continuity v0.5.0

This release turns the standalone macOS app into a daily work notebook: collect thoughts while working, understand the day across Codex and Claude Code, then deliberately organize and seal a stable page.

## Highlights

- Replaces the former Brief dashboard with the Today notebook surface from the validated HTML prototype.
- Keeps timestamped notes and the Daily Page in separate, independently scrolling panes across wide and compact windows.
- Groups multiple provider sessions into project-level work records instead of repeating the Codex or Claude Code session list.
- Expands each work record to show what changed, what remains uncertain, and every contributing source session.
- Adds durable local note creation, editing, favorites, deletion, and delivery history.
- Exports an individual note as a standalone SVG card.
- Routes a note explicitly to the configured `LLM-Wiki/raw` intake or an existing project's CTX intake; the original note remains unchanged.
- Adds the complete EOD flow: bounded draft, personal writing, up to three continuation bookmarks, temporary draft save, and immutable sealing.
- Preserves Sessions, Timeline, Map, Sources, in-app transcript reading, provider selection, and copy-only resume commands.
- Adds a versioned, normalized, atomically replaced notebook store separate from provider evidence and semantic caches.
- Fixes the GitHub release workflow so tags build and verify the independent Electron application rather than the deprecated Obsidian plugin.
- Packages and verifies separate macOS DMGs and ZIP archives for Apple Silicon and Intel.

## Boundaries

- macOS only.
- Unsigned and not notarized.
- Provider session stores remain read-only.
- Wiki and CTX writes occur only after an explicit note-delivery action.
- Project delivery requires an existing CTX store; the app never adopts CTX automatically.
- Continuation remains copy-only: the app does not own a terminal, PTY, tmux session, or provider process.
