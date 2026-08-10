# Work Continuity v0.6.1

Work Continuity v0.6.1 fixes the first-run failure that could appear as `CLI 输出超过 4 MB 限制` while organizing a day with many or very long Codex Sessions.

## Fixes

- Streams Codex JSONL output and retains only the final Traceink result and bounded structured diagnostics. Large reasoning, command, and tool-progress events no longer fill the app's result buffer or leak into error messages.
- Keeps the 4 MB safety boundary on the actual final result instead of applying it to all intermediate provider traffic.
- Gives the Traceink compiler an explicit bounded-batch reading contract for long frozen transcripts, including coverage tracking and visible missing-range reporting.
- Shows structured Claude Code `result` and `errors[]` diagnostics instead of reducing failures to a bare exit code.
- Uses a bounded graceful-stop → forced-stop lifecycle so a timed-out or malformed provider call cannot leave a hidden CLI process running.

## Boundaries

- The v0.6.1 archives remain unsigned and not notarized. macOS may require Control-clicking the app and choosing **Open** for the first launch.
- This maintenance release preserves the v0.6.0 Today Board, Traceink prompt profile, sealed history, and human-authority workflow; it does not introduce a new compact-evidence ontology or silently discard experimental evidence.

# Work Continuity v0.6.0

Work Continuity v0.6.0 replaces the capture-led Today surface with one evidence-led Today Board. A day now moves through a visible `raw → compiled → stale → sealed` lifecycle: source Sessions remain independent until you ask the app to organize them, new evidence never silently rewrites an existing compilation, and a sealed historical page stays fixed.

## Highlights

- Reconstructs shared worklines across Codex and Claude Code Sessions with the KSI-informed Traceink prompt profile (`traceink-review-v1`) instead of producing one summary card per Session.
- Isolates the product-owned Codex model/reasoning pair from incompatible interactive CLI settings, surfaces structured provider errors, and tries the other already-enabled provider once only when CLI invocation fails.
- Keeps compilation on demand. **Raw** shows source Session lanes, **compiled** shows the current workline package, **stale** preserves that package beside newly arrived evidence, and **sealed** replays the chosen historical generation without calling the model again.
- Shows only evidence-supported participation: explicit human interventions, observed Agent-independent activity windows, collaborative spans, and uncertainty remain distinct. Agent activity volume is never presented as proof of human attention or importance.
- Adds an evidence reader for each workline. Generated interpretations stay labeled, admitted sources can be reopened, disagreement and scope survive compression, and the dossier stops at a question that still requires the person.
- Gives human reflection its own blank, local field. Traceink prepares material to think with; it does not write first-person conclusions, infer adoption, or overwrite the person's original words.
- Makes reflection saves and sealing generation-safe. Every save or seal request names the exact active compilation generation; a concurrent refresh makes an older review fail instead of writing into or sealing different material. Once sealed, the selected package, evidence references, human reflection, and continuation bookmarks are immutable.
- Preserves **Sessions**, **Timeline**, **Map**, and **Sources**, including read-only transcript inspection, provider selection, bounded CTX context, and copy-only resume commands.
- Removes note capture and delivery from the primary Today surface. Existing notebook note records remain readable by the compatibility store, but they are legacy data rather than the v0.6.0 product workflow.
- Packages separate DMG and ZIP archives for Apple Silicon and Intel Macs and verifies the Work Continuity bundle, architecture, version, Today Board, Traceink profile, evidence reader, and sealing contract inside each archive.

## Boundaries

- macOS only.
- The v0.6.0 archives are unsigned and not notarized. macOS may require Control-clicking the app and choosing **Open** for the first launch.
- Provider Session stores are read-only. Work Continuity never edits Codex or Claude Code transcripts.
- Traceink compilation uses installed provider CLIs and the provider account/network already configured on the Mac. Invocation failures remain visible; an already-enabled second provider may be tried once, but semantic validation failures never trigger another call or fall back to a thin summary.
- Resume remains copy-only. Work Continuity does not start a terminal, PTY, tmux Session, or provider process.
- Legacy Wiki/CTX note-delivery APIs remain compatibility code and still require an explicit action; they are not part of the primary Today Board.
