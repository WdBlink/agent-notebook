# Agent Notebook

macOS Electron/React/TypeScript app for reviewing local Codex and Claude Code work. `app/desktop/` owns the desktop UI, IPC and persistence; `src/` contains shared logic and the legacy Obsidian plugin. `runtime/` owns the PTY helper. Tests live in `tests/`.

## Working agreement

- Complete the requested change through relevant verification. Resolve routine, reversible choices from the code and state material assumptions; ask only when missing input changes scope, correctness or authorization.
- Inspect the working tree and trace affected callers before editing. Preserve existing user changes. Reuse local patterns and installed dependencies; fix shared causes without speculative abstractions.
- Load only task-relevant instructions and references. User instructions override skill guidelines within system/developer constraints. If a skill blocks authorized work, identify its file and exact rule, and finish independent work first.
- Batch independent reads/checks. Use subagents only when the session permits delegation and independent work justifies it; assign distinct ownership and integrate the results. Keep small changes local.
- Report the result, checks actually run, and material limitations concisely. Do not claim model performance gains without comparative measurements.

## Context and skills

- Project context lives in `./ctx`; consult its entry point and relevant current spec when needed. Apply ctx skill consistency rules when editing ctx docs. Historical `docs/superpowers/` plans are design history, not standing execution instructions.
- Preserve the existing gitignored external `ctx` symlink. Do not adopt, recreate or migrate ctx automatically; only do so when explicitly requested, using the user's external-store convention.
- `skills/traceink/` is the application-owned review bundle, not a general coding workflow. Its read-only/proposal boundaries govern review output, not maintenance of this repository. Do not load it for unrelated development.
- When changing `SKILL.md` or `references/editorial-contract.md`, update the matching SHA-256 in `src/traceink-skill-bundle.ts`, rebuild the desktop bundle, and run the bundle and affected review tests. Preserve evidence provenance, original user reflections and generation-safe persistence.
- Keep personal model defaults in the host configuration. Preserve application provider/model choices unless migration is requested; stronger coding models do not imply replacing every runtime model.

## Verification

Use `package.json` for executable commands and [TESTING.md](TESTING.md) for setup, targeted checks and release gates.

- For a focused logic change: `node --import tsx --test tests/<affected>.test.ts`; add a small regression check for changed behavior when needed.
- For TypeScript changes: `npm run typecheck`. For UI changes: build the affected surface and run its relevant Playwright spec.
- For Traceink bundle changes: `npm run build:desktop`, then `node --import tsx --test tests/traceink-skill-bundle.test.ts tests/traceink-review.test.ts tests/traceink-proposals.test.ts`.
- Full release gates remain `npm run check` plus archive verification and manual acceptance in `TESTING.md`. Do not repeat full builds or suites for a small change once relevant checks pass, unless new evidence warrants it.
- Use fixtures and temporary directories. Real provider calls, working-vault installation, application relaunch and release publishing are separate operations with their own authorization scope.
