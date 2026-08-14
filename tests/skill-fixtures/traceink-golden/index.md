## 2026-08-09 工作线索引

**读取范围：** 已读取指定的 5/5 个文件；无跳过、读取或解析失败。未读取范围外的原始实验日志、代码或仓库材料。两个文档以测试夹具中的副本为准，未核对会话所述原始路径。

### 1. 吞吐瓶颈定位：从 scheduler 试验推进到任务表示候选

- **时间与状态：** 09:10–17:36（UTC+08:00）。三组 scheduler 实验已停止；只读的任务表示检查和最小 Research IR 草案已完成。跨任务验证尚未进行，候选方案也未获采用确认。[E1][E3][E4][E5]
- **贡献会话：** Codex `codex-scheduler`、Claude Code `claude-representation`、Codex `codex-research-ir`。
- **参与标记：**
  - `你参与`：限定实验范围、叫停过度推论、要求只读检查，并把后续工作限定为设计稿。[E1][E3][E4]
  - `Agent 独立推进`：执行三组实验、检查失败样本并起草候选方案。[E1][E3][E4]
  - `共同推进`：用户持续设定判断边界，Agent 在边界内推进证据与方案。
- **可能的变化信号 · AI 整理，尚未采纳：** scheduler 调参没有带来稳定改善，而 11 个失败样本中有 8 个在调度前已需 schema repair；这使“问题更接近任务表示”值得优先验证。但现有样本来自同一类任务，尚不能推广，Research IR 仍只是候选。[E1][E2][E3][E4][E5]
- **证据可展开度：** 可以展开，但完整度为中等：现有材料足以重构路线变化，缺少三组实验的原始日志，以及两类真实任务的后续验证结果。

**证据定位**

- [E1] Codex · session `codex-scheduler` · [codex-scheduler.jsonl](../ksi-review-day/codex-scheduler.jsonl) · 09:10–11:22
- [E2] Document · [results-scheduler-runs.md](../ksi-review-day/results-scheduler-runs.md) · 第 1–6 行；由 E1 在 11:18 引用
- [E3] Claude Code · session `claude-representation` · [claude-representation.jsonl](../ksi-review-day/claude-representation.jsonl) · 12:40–14:10
- [E4] Codex · session `codex-research-ir` · [codex-research-ir.jsonl](../ksi-review-day/codex-research-ir.jsonl) · 15:20–17:36
- [E5] Document · [research-ir-draft.md](../ksi-review-day/research-ir-draft.md) · 第 1–5 行；由 E4 在 17:35 引用

今天只重构出这一条跨 Session 工作线。要展开工作线 1 的证据档案吗？
