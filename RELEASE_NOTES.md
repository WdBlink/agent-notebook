# Work Continuity v0.4.0

This release begins the standalone macOS application line. Work Continuity is no longer packaged as an Obsidian plugin.

## Highlights

- Restores the visual skeleton, proportions, spacing, date control, activity pulse, and editorial hierarchy of the selected first HTML demo.
- Uses the supplied stuffed Traveler's Notebook artwork as the app, Dock, window, and installer icon.
- Reads local Codex and Claude Code session stores independently or together.
- Replaces provider-default session names with background-generated Chinese work titles and progress summaries, using explicitly selected inexpensive provider models.
- Opens immediately from metadata, reuses a local transcript-versioned summary cache, and updates every product surface when new summaries arrive.
- Shows whether each title came from Codex AI, Claude AI, or metadata fallback, with model and job diagnostics under Sources.
- Uses a desktop-native ESM-safe process runner and isolated, concurrency-limited summary batches so one slow or failed transcript cannot suppress the rest of the day.
- Publishes and caches each completed session summary immediately instead of waiting for every slower sibling to finish.
- Restores the original Demo's desktop Brief sidebar behavior (`position: sticky; top: 94px`) while keeping its responsive static layout below 900px.
- Presents Brief, Sessions, project-scoped Timeline, interactive Map, and Sources surfaces.
- Limits AI continuation suggestions to the three highest-value next actions.
- Marks active dates in the calendar for historical review.
- Keeps exact session IDs, transcript paths, working directories, and copy-only resume commands available as evidence.
- Treats provider-side Codex archival as canonical completion evidence, even when an AI summary suggests more work remains.
- Opens session history in a spacious, read-only in-app transcript reader instead of depending on an external editor.
- Loads bounded current CTX documents in read-only mode when a project has a context store.
- Animates Map focus changes without replacing node DOM identity, expands child branches, and exposes source documents in the inspector.
- Adapts the desktop shell into a compact bottom-navigation layout at narrow window sizes.
- Packages separate macOS DMGs for Apple Silicon and Intel through Electron Builder.

## Boundaries

- macOS only for the first standalone build.
- Unsigned and not notarized.
- Local-first and read-only: provider transcripts and CTX documents are never modified.
- Obsidian plugin artifacts from v0.2.0 through v0.3.1 are deprecated prototypes.
