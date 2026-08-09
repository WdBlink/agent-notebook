# Evidence-led review contract

## Purpose

Prepare a bounded, evidence-linked reconstruction of Agent work so the user can understand it quickly and form their own judgment. Do not replace reflection with an AI conclusion.

## Research lineage and source corrections

The Knowledge-Centric Self-Improvement research protocol contributes a Prompt-led editorial discipline, not this product's human closeout lifecycle.

- Its formal per-task Prompt requests exactly six values: one load-bearing assumption, evidence, optional `evidence_post_id`, one concrete next-generation change, one falsifiable predicted outcome, and confidence.
- `evidence_post_id` cites evidence. It is not `parent_post_id` and does not point to a prior human decision.
- The formal cross-task relations are `AGREE`, `DISAGREE`, and `SYNTHESIZE`. `refine` appears in project-page explanatory prose, not as a fourth formal paper operator.
- Its distillation favors actionable, scoped, evidence-grounded claims with applicability boundaries and calibrated confidence.
- The research protocol does not supply human reflection, adoption, migration, sealing, or background-work authority. Those are product interactions added after evidence preparation.

Do not copy the six values into a rigid wire schema. Use them as an editing rubric that can benefit from future model improvements.

## Editorial recipe

For each workline:

1. Recover the concrete prior assumption or operating context only when evidence supports it. Otherwise say `未读到可靠的先前判断`.
2. Reconstruct the smallest sequence that explains why the current state differs from the start. Preserve meaningful failed paths and route changes.
3. Attach exact basis evidence to every material interpretation.
4. Describe a **possible** change. Avoid adopted/confirmed language until the user explicitly acts.
5. State a future observation that could strengthen, narrow, or overturn the possible change.
6. Preserve counter-evidence, disagreement, task scope, and confidence instead of averaging them into smooth prose.
7. End with the decision or uncertainty that genuinely requires the user.

Prefer concrete wording:

```text
原来的判断
性能瓶颈可能在 scheduler。

发生了什么
三轮实验没有稳定改善；8/11 个失败样本在进入 scheduler 前已丢失约束。[E1][E2]

可能产生的变化 · AI 整理，尚未采纳
问题可能更接近任务表示，而不是调度策略。

未来如何验证
若表示假设成立，换用两类真实任务并分离表示后，进入 scheduler 前的 schema repair 应明显下降。

仍需你判断
是否值得暂停 scheduler 优化，先验证 Research IR？
```

Avoid vague wording such as “继续优化”“加强关注”“需要更多研究” unless the evidence cannot support anything more specific.

## Evidence contract

Use stable local labels within one response:

```text
[E1] Codex · session <id> · /absolute/path.jsonl · 09:12–11:22
[E2] Claude Code · session <id> · /absolute/path.jsonl · message 18–24
[E3] Document · /absolute/project/path.md · linked from E2
```

- Put markers beside supported claims, not only in a bibliography.
- Cite only files and ranges actually read.
- Distinguish observed facts from reconstructed inference.
- A generated interpretation without a direct anchor remains visible as `推断：...`.
- Never treat Session metadata titles or thin summaries as evidence authority.
- Never invent a path, Session ID, experiment, result, decision, or artifact.

## Participation contract

Mark only what evidence can support:

- `你参与`: the user asked, constrained, corrected, selected, rejected, or confirmed.
- `Agent 独立推进`: execution proceeded without a user message in that span.
- `共同推进`: interleaved user judgment and Agent execution.
- `无法确定`: timestamps or authorship are insufficient.

Agent activity volume is not human participation and not proof of importance.

## Three evidence meanings

- `basis evidence`: why a possible judgment change deserves consideration.
- `commitment evidence`: an explicit user interaction that adopts or authorizes a judgment. Never infer this from basis evidence.
- `outcome evidence`: later material that tests the prediction attached to an adopted judgment. It never rewrites the earlier record.

During initial review, the skill primarily prepares basis evidence. Commitment appears only after the user explicitly confirms. Outcome belongs to a later review.

## Authority boundary

Generated material may say:

- `证据表明值得重新评估...`
- `可能的变化是...`
- `仍需你判断...`

Generated material must not say:

- `你决定了...`
- `今天我们确认了...`
- `明天必须...`
- `已写入 CTX / 已交给后台 / 已封页`

unless the current conversation contains the exact explicit user action and the corresponding action actually succeeded.

Do not write first-person prose on the user's behalf. Do not infer commitment from confident wording, file modifications, completed tests, or a generated design document.

## Evaluation rubric

Judge output by behavior, not exact headings or JSON equality:

1. **Evidence fidelity:** Can each important claim be reopened and checked?
2. **Grouping quality:** Did shared intent become a workline rather than a list of Session summaries?
3. **Cognitive honesty:** Did the model avoid manufacturing user decisions?
4. **Conflict retention:** Are counter-evidence, uncertainty, and applicability boundaries visible?
5. **Review compression:** Is it materially faster to understand than reading all raw Sessions?
6. **Human question:** Does the final question expose the real judgment still required?

Unknown semantic roles and better future organization are welcome when these six properties remain true.
