## 工作线 1：吞吐瓶颈定位的证据档案

**证据范围：** 已读取指定的 5/5 个文件；无跳过或解析失败。未读取原始实验日志、代码及范围外材料，因此以下实验结果属于摘要级证据。

### 原来的判断或背景

未读到 09:12 之前可靠的先前判断。工作线从一个待验证的操作假设开始：scheduler 可能是当前吞吐瓶颈。你把验证限制为三组可逆实验，明确不改整体架构。[E1] 这证明的是调查起点，不代表你已认定 scheduler 就是根因。

### 发生了什么

1. 三组实验没有形成稳定的端到端改善：提高并发使总耗时改善 1.8%，但错误率增加 0.7%；队列策略重复三次仍无稳定变化；缓存改善了冷启动，却没有改变端到端吞吐。[E1][E2]
2. 你随后叫停，并明确收窄解释边界：这些结果只能说明 scheduler 优化不明显，不能直接推出需要换架构。[E1]
3. 在你要求的只读检查中，Claude Code 报告 11 个失败样本中有 8 个在进入 scheduler 前已丢失约束，并提出 Receipt 同时承担运行收据和研究中间表示、存在字段语义冲突的解释；它同时注明样本只来自同一类任务，尚不足以推广。[E3]
4. 你要求把这一发现整理成供判断的最小设计稿，范围限定为“不迁移、不改代码”。草案提出将研究表示与运行时 Receipt 分离，并以两类真实任务上的 pre-scheduler schema repair 是否下降作为证伪检查；会话明确记录该方案尚未获得采用确认。[E4][E5]

### 可能产生的变化 · AI 整理，尚未采纳

**推断，置信度中等偏低：** 调查重点可能需要从“继续把 scheduler 当作首要嫌疑对象”，转为“把任务表示列为更值得优先检验的竞争假设”。依据是调度侧实验收益不稳定，而多数已记录失败发生在调度之前。[E1][E2][E3]

这不等于应当更换架构，也不表示 Research IR 已被采用；现有证据最多支持重新安排假设验证的优先级。

### 支持、反对与适用边界

- **支持：** 8/11 个失败样本在调度前需要 schema repair；Claude Code 还报告了约束提前丢失及 Receipt 字段语义冲突。[E2][E3]
- **反对或保留：** 并发调整仍带来 1.8% 的耗时改善，缓存也改善了冷启动，说明 scheduler 周边并非完全没有作用；只是尚未转化为稳定的端到端收益。[E2]
- **证据边界：** 样本来自同一类任务；没有读到原始日志，无法独立复核失败分类和因果链；“表示冲突导致 schema repair”目前仍是 Agent 提出的解释，而非已验证结论。[E3]
- **权限边界：** 你只授权了可逆实验、只读检查和候选设计稿，没有授权迁移、代码修改或架构切换。[E1][E3][E4]

### 未来如何验证或推翻

候选验证方式是在两类实质不同的真实任务上，将研究表示与运行时 Receipt 分离，然后观察进入 scheduler 前的 schema repair：

- 若两类任务都明显下降，表示假设得到加强。
- 若只在一类任务下降，推断上应收窄其适用范围。
- 若没有下降，候选草案明确认为表示假设应被削弱。[E4][E5]

现有材料没有定义“明显下降”的量化阈值，这是执行验证前仍需补齐的判定条件。

### 证据登记

- [E1] Codex · session `codex-scheduler` · [codex-scheduler.jsonl](../ksi-review-day/codex-scheduler.jsonl) · 09:10–11:22 · cwd `/workspace/autoresearch`
- [E2] Document · [results-scheduler-runs.md](../ksi-review-day/results-scheduler-runs.md) · 第 1–6 行 · 由 E1 在 11:18 引用；测试夹具副本
- [E3] Claude Code · session `claude-representation` · [claude-representation.jsonl](../ksi-review-day/claude-representation.jsonl) · 12:40–14:10 · cwd `/workspace/autoresearch`
- [E4] Codex · session `codex-research-ir` · [codex-research-ir.jsonl](../ksi-review-day/codex-research-ir.jsonl) · 15:20–17:36 · cwd `/workspace/autoresearch`
- [E5] Document · [research-ir-draft.md](../ksi-review-day/research-ir-draft.md) · 第 1–5 行 · 由 E4 在 17:35 引用；测试夹具副本

### 仍需你判断

你是否愿意把后续验证的首要对象，从继续调 scheduler 改为先在两类真实任务上检验“研究表示与 Receipt 分离”这一候选假设？
