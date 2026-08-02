# Workline Review Compiler 设计规格

- 日期：2026-08-02
- 状态：已确认，等待实施计划
- 产品：Daily Review / Work Continuity
- 范围：Mac 客户端的单工作线回看材料编译器，以及未来 iCloud / iPad 阅读与追加写入边界

## 1. 产品目标

专用编译器把一天中散落在 Codex、Claude Code、项目文档、Git diff、测试结果和交付物里的工作痕迹，整理成一条条可读、可追溯的工作线材料包。

编译器的目标不是替用户生成认识，而是把复杂现场准备到用户终于可以亲自思考：

```text
原始工作证据
    → 可读的单工作线材料包
    → 用户亲自阅读、判断和书写
    → AI 只在用户写完后整理结构
    → 用户确认并封页
```

首版的主输出对象是单条 `WorklinePackage`，不是跨项目日报总览。全日总览未来由可靠的单工作线材料包组合产生。

## 2. 已确认的产品边界

### 2.1 输入范围

编译器只读取：

- Codex Session；
- Claude Code Session；
- Session 明确引用、修改或生成的项目文档；
- 与上述工作明确关联的 Git diff；
- Session 中明确执行过的测试结果；
- Session 中明确生成的文件和交付物。

编译器不能因为“可能相关”而扫描整个项目目录。

### 2.2 输出边界

输出正文完全自适应，不要求所有工作线套用同一模板。编程、调研、设计、实验和运维任务可以采用不同结构。

固定的产品级元素只有：

- 工作线标题与身份；
- 日期和时间范围；
- “我参与 / Agent 独立推进 / 协作 / 不确定”区间；
- 当前状态；
- 原始证据入口；
- 事实、推断与待判断问题的明确区分。

### 2.3 推断边界

编译器可以根据多份证据重建阶段和因果关系，但必须遵守：

- 直接证据支持的内容标为 `fact`；
- 证据支持但无法直接证明的连接标为 `inference`；
- 需要用户回答的内容标为 `question`；
- 每条事实与推断必须能展开查看依据；
- 流畅叙事不能掩盖证据缺口；
- 编译器不能输出“用户今天应该得出的结论”。

### 2.4 工作线边界

一个 Session 可以被拆成多条工作线，多条 Session 也可以被合并为同一条工作线。

首版自动拆分和合并：

- 高置信度边界直接形成工作线；
- 低置信度边界进入人工确认；
- 用户可以查看工作线包含的具体 Session 区间；
- 用户可以纠正本次拆分与合并；
- 用户纠正不跨日期学习，不建设个性化引擎。

### 2.5 运行时机

白天只进行轻量索引，不持续生成或改写回看材料。

用户点击“开始整理今天”时：

1. 冻结 Evidence Cutoff；
2. 检查核心来源和模型可用性；
3. 构建 Evidence IR；
4. 识别工作线；
5. 编译单工作线材料包；
6. 验证证据完整性；
7. 材料包验证通过后才进入正式回看。

截止点之后的新证据不会自动改变当前材料包。用户可以忽略、查看原文，或者主动纳入并生成新版本。

### 2.6 失败策略

采用“核心失败阻断、非核心缺失可降级”的策略：

- 核心 Session 读取失败、工作线无法形成、核心语义处理失败或事实无法验证时，阻止进入正式回看；
- 关联文档、Git diff、测试附件或产物缺失时，允许进入回看，但必须在具体位置醒目标注；
- 非核心缺失不能只藏在全局警告中；
- 重新编译失败不能覆盖上一个可用版本。

## 3. 总体架构

```text
Codex / Claude Code / 明确关联的项目材料
                    ↓
              Source Adapters
                    ↓
              Daytime Index
                    ↓
       Start Review + Evidence Cutoff
                    ↓
               Evidence IR
                    ↓
             WorklineBoundary
                    ↓
     Specialized Workline Processors
                    ↓
             EvidenceValidator
                    ↓
        Versioned WorklinePackage
                    ↓
         Human Reflection / Seal
```

Dyslex.ai 只提供处理原则和输出合同的灵感，不是客户端运行时依赖，也不作为面向用户的产品概念。

## 4. 数据模型

### 4.1 编译运行

```ts
type CompilationRun = {
  id: string;
  logicalDate: string;
  evidenceCutoff: string;
  sourceHashes: Record<string, string>;
  status: "preflight" | "compiling" | "blocked" | "ready" | "cancelled";
  compilerVersion: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};
```

### 4.2 证据中间层

```ts
type EvidenceItem = {
  id: string;
  sourceType: "session" | "document" | "git" | "test" | "artifact";
  sourceId: string;
  timestamp?: string;
  actor?: "user" | "agent" | "tool";
  eventType: string;
  excerpt: string;
  sourceLocation: string;
  contentHash: string;
};
```

Evidence IR 保存结构化事件、必要摘录和原始位置，不完整复制全部聊天记录。

### 4.3 编译陈述

```ts
type CompiledClaim = {
  id: string;
  kind: "fact" | "inference" | "question";
  text: string;
  evidenceIds: string[];
  confidence: number;
  producer: string;
};
```

### 4.4 参与区间

```ts
type ParticipationSpan = {
  kind: "user-led" | "agent-led" | "collaborative" | "uncertain";
  startEvidenceId: string;
  endEvidenceId: string;
  reason: string;
};
```

### 4.5 工作线材料包

```ts
type WorklinePackage = {
  id: string;
  logicalDate: string;
  title: string;
  sessionRanges: SessionRange[];
  participation: ParticipationSpan[];
  blocks: AdaptiveBlock[];
  claims: CompiledClaim[];
  evidenceIds: string[];
  unresolvedQuestions: string[];
  compilationVersion: string;
  evidenceCutoff: string;
};
```

正文使用有限的类型化组件，而不是允许模型生成任意 HTML：

```ts
type AdaptiveBlock =
  | TimelineBlock
  | ComparisonBlock
  | ExperimentBlock
  | ChangeSetBlock
  | ArtifactBlock
  | ParticipationBlock
  | QuestionBlock
  | ProseBlock;
```

## 5. 专项处理器

### 5.1 WorklineBoundary

职责：

- 合并跨 Codex、Claude Code 的同一工作；
- 拆分中途换题的 Session；
- 记录每条工作线包含的消息区间；
- 给出边界置信度。

限制：

- 不能因为目录相同就强行合并；
- 不能丢弃无法分类的 Session；
- 不能记住跨日期的用户纠正。

### 5.2 IntentDecoder

恢复工作为什么开始、最初目标、明确限制和目标变化，并区分：

- 用户明确提出的目标；
- Agent 对目标的复述；
- 根据行动推断出的目标。

### 5.3 TimelineReconstructor

把消息和工具事件压缩为有意义的推进阶段。阶段变化应由目标变化、新证据、路线切换、测试结果、产物完成、等待或阻塞触发。工具调用本身不构成阶段。

### 5.4 ParticipationClassifier

识别用户定方向、纠正路径、作出决定、确认结果，以及 Agent 独立推进的区间。用户发送过消息不等于用户主导，无法判断时使用 `uncertain`。

### 5.5 ArtifactReader

读取 Session 明确关联的文档、代码改动、测试与交付物。它描述材料发生了什么变化，不能把材料价值写成用户结论。

### 5.6 DecisionBoundaryDetector

识别证据冲突、尚未闭合的问题、方向分叉、需要用户授权的事项和 Agent 无法自行决定的边界。它只能输出中立问题，不能提供推荐结论。

### 5.7 AccessibleComposer

根据任务类型选择呈现结构：

- 实验：假设 → 试验 → 结果 → 异常；
- 产品设计：问题 → 方案变化 → 反馈 → 未决边界；
- 编程：目标 → 修改 → 测试 → 当前状态；
- 调研：问题 → 来源 → 发现 → 证据冲突。

Composer 只能组合已有 Claim，不能新增事实。

### 5.8 EvidenceValidator

验证：

- 所有事实是否有证据；
- 所有推断是否明确标记；
- 引用位置是否有效；
- 核心 Session 是否读取完整；
- Composer 是否引入了新陈述；
- 材料是否覆盖工作线的开始、主要推进和当前停点。

## 6. 模型调用设计

处理器是逻辑边界，不机械对应八次远程调用。

首版调用结构：

```text
本地确定性处理
来源扫描、Evidence IR、文档解析、Git diff、测试结果和缓存

模型调用 1
识别全日工作线边界

模型调用 2
对每条工作线生成 Intent、Timeline、Participation、Claim 和待判断问题

本地确定性处理
证据验证、自适应组件选择和材料包组装
```

模型提供方通过统一接口接入：

```ts
interface CompilerProvider {
  compileWorkline(input: WorklineCompilerInput): Promise<WorklineCompilerOutput>;
}
```

首版复用用户已安装和登录的 Codex 或 Claude Code CLI。以后可增加本地模型或其他提供方，不改变 Evidence IR 和前端合同。

所有模型输出必须通过 JSON Schema。无法解析的 Markdown 不能成为正式材料包。

## 7. 编译状态与恢复

```text
INDEXED
  → PREFLIGHT
  → COMPILING
      ├─ 核心失败 → BLOCKED
      └─ 验证通过 → READY
                           → REVIEWING
                           → SEALED
```

### 7.1 Preflight

检查：

- 核心 Session 存在且可读；
- Session 解析器能识别正文；
- 配置的模型提供方可用；
- 本地存储可写且空间足够；
- Evidence Cutoff 已建立；
- 上次中断的运行是否可以恢复。

### 7.2 缓存

处理器缓存键包含：

```text
来源内容哈希
+ 处理器版本
+ Prompt 版本
+ 模型标识
+ 输出 Schema 版本
```

单个来源变化只使依赖它的处理器结果失效。

### 7.3 重试

- 结构解析失败自动重试一次；
- 模型临时错误指数退避，最多重试两次；
- 证据矛盾不能通过重试消除，必须变成待判断问题；
- 核心来源不可读时等待用户修复或明确排除；
- 用户取消时不把半成品保存为正式材料包。

### 7.4 崩溃恢复

`CompilationRun` 与各处理器结果逐步持久化。应用退出或设备重启后，从最近成功的阶段继续。

### 7.5 新证据

`READY` 后出现的新内容进入 `NEW_EVIDENCE_AVAILABLE`，不自动改写材料包。主动纳入时生成新版本；失败时保留原 `READY` 版本。

## 8. 本地存储

首版使用 SQLite 保存结构化编译数据，替换继续扩张单一 JSON 文件的方式。

主要表：

```text
source_index
evidence_items
compilation_runs
processor_results
worklines
workline_packages
compiled_claims
user_reflections
sealed_pages
```

原始 Session 继续由 Codex 和 Claude Code 保存。数据库保留材料包实际采用的必要摘录、来源位置和哈希，以保证封页内容即使在来源移动后仍可阅读。

用户反思与 AI 编译结果分表保存。清除 AI 缓存不能删除用户文字。

## 9. 隐私与安全

产品必须说明：

- 原始 Session 保持只读；
- 应用不运营开发者自建的内容服务器；
- 未启用 iCloud 时，全部产品数据只保存在本机；
- 启用 iCloud 后，只有第 11 节明确列出的封页阅读数据进入用户的 CloudKit Private Database；
- 选定材料可能由用户配置的 Codex 或 Claude Code 远程模型处理；
- 每次编译读取了哪些来源；
- 哪个模型提供方处理了本次材料；
- 哪些文件因为证据关联被额外读取。

所有 Session、文档和工具输出均是不可信数据。来源中的命令和提示词只能作为材料，不能成为编译器指令。

编译阶段没有 Shell 执行、文件写入、Git 修改、任意目录扫描或后台委托权限。

## 10. 人工书写与封页

三层数据严格分开：

```text
AI 编译层：可重新生成并版本化
用户反思层：只能由用户修改
封页快照：封页后不可自动改变
```

封页保存：

- 采用的 WorklinePackage 版本；
- Evidence Cutoff；
- 核心来源哈希；
- 用户原始反思；
- 用户最终确认的明日事项；
- 用户接受的非核心材料缺失。

封页后新增证据属于下一次整理。

## 11. iCloud 与 iPad 扩展

### 11.1 产品边界

iPad 首版只同步和阅读已封页内容，但支持两类追加写入：

1. 对封页、工作线或证据添加页边批注；
2. 创建属于当前日期的新便签或夹页。

iPad 不能修改过去已封页的正文。

### 11.2 推荐架构

```text
Mac Electron
├── 本地 SQLite 和完整编译器
└── Swift CloudKit Sync Helper
             ↓
     CloudKit Private Database
             ↓
iPad SwiftUI 阅读器
├── 本地离线副本
├── 封页阅读
├── 页边批注
└── 今日新便签
```

Mac 使用小型原生 Swift Helper 和 `CKSyncEngine` 同步，不把 Electron 主数据层整体改写为 Core Data，也不直接同步 SQLite 文件。

### 11.3 同步内容

同步：

- 已封页的每日页面；
- 采用的 WorklinePackage 版本；
- 用户原始反思；
- 明日书签；
- 事实、推断与待判断问题；
- 参与区间；
- 阅读所需证据摘录；
- 页边批注；
- 移动端新便签；
- 必要的文档快照或分享卡片。

不向 iCloud 同步：

- 完整原始 Session；
- Mac 本地绝对路径；
- 编译器缓存和中间状态；
- 模型凭证；
- Shell 输出全集；
- 未采用的项目文件；
- 后台执行权限。

### 11.4 同步元数据

```ts
type SyncMetadata = {
  id: string;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  originDeviceId: string;
  contentHash: string;
  syncState: "local" | "queued" | "synced" | "failed";
};
```

本地预留：

```text
sync_outbox
sync_receipts
sync_tombstones
cloudkit_state
```

### 11.5 移动端写入

```ts
type PageAnnotation = SyncMetadata & {
  id: string;
  pageId: string;
  worklineId?: string;
  claimId?: string;
  body: string;
  createdAt: string;
  originDeviceId: string;
};

type MobileCapture = SyncMetadata & {
  id: string;
  logicalDate: string;
  timezone: string;
  body: string;
  projectId?: string;
  createdAt: string;
  originDeviceId: string;
};
```

批注和便签采用追加式版本：编辑产生新 revision，删除产生 tombstone，不覆盖历史封页。同步冲突保留双方 revision，由用户选择采用版本。

移动端新便签同步回 Mac 后进入当前日期采集区，或者在用户明确选择项目后进入对应项目的待吸收区，不倒写进历史页面。

### 11.6 隐私和搜索

用户反思和证据摘录使用 CloudKit encrypted fields；较大附件使用 `CKAsset`。由于加密字段不能用于 CloudKit 服务端索引，iPad 下载后在本地建立全文搜索索引。

iCloud 不可用时，Mac 的本地产品功能必须保持完整。界面显示上次同步时间、待同步数量和手动刷新，不承诺实时同步。

### 11.7 系统兼容性

- Mac 主应用保持当前本地功能的系统兼容范围；
- iCloud 同步功能只在 macOS 14 及以上启用；
- iPad 阅读器最低支持 iPadOS 17；
- 较老 Mac 仍可使用本地索引、编译、回看、书写和封页，只不显示 iCloud 同步入口；
- 首版不为较老系统额外实现一套底层 `CKDatabase` 同步引擎。

## 12. 非目标

首版不包含：

- 个性化学习；
- 模仿用户反思文风；
- 自动形成用户结论；
- 自动封页；
- 自动执行后台任务；
- 运行时依赖 Dyslex.ai 或 Superpowers 插件；
- 扫描整个项目寻找潜在材料；
- iPad 上运行工作线编译器；
- iPad 修改历史封页正文；
- 同步完整原始 Agent 会话。

## 13. 验收标准

### 13.1 工作线

- 多 Session 同一任务可以合并；
- 单 Session 明显换题可以拆分；
- 每条工作线可以查看原 Session 区间；
- 低置信度边界进入确认；
- 用户纠正不跨日期学习。

### 13.2 证据

- 每条事实至少有一个有效 `evidenceId`；
- 推断必须显式标记；
- 待判断问题说明由哪些冲突或缺口产生；
- Composer 不能新增事实。

### 13.3 稳定性

- Evidence Cutoff 之后的新内容不改变当前材料包；
- 新编译生成新版本，不覆盖旧版本；
- 失败不破坏上一个 `READY` 版本；
- 应用退出后可以恢复编译；
- 封页后 AI 不能修改用户文字或采用的材料版本。

### 13.4 性能

以一天约 12 个 Session 为典型负载：

- 白天增量索引不阻塞界面；
- 点击整理后立即显示真实处理阶段；
- 已有缓存时目标在 10 秒内恢复材料包；
- 首次完整编译目标控制在 2 分钟以内；
- 单个处理器失败只重跑相关阶段。

### 13.5 iCloud / iPad

- Mac 离线时仍可编译、回看和封页；
- 已封页内容能同步到同一 iCloud 账号的 iPad；
- iPad 离线时能阅读已下载页面并写入待同步批注；
- 批注和新便签不改变历史封页；
- 同步失败不丢失本地写入；
- 完整 Session 和本地绝对路径不上传；
- 冲突保留双方 revision，不静默覆盖。

## 14. 测试样本

建立脱敏 Golden Tests，至少覆盖：

- 单 Session 单任务；
- 单 Session 中途换题；
- Codex 与 Claude Code 共同推进；
- Agent 独立运行数小时；
- 用户仅发送“继续”；
- 文档结论与测试结果冲突；
- 文件丢失；
- 模型输出不符合 Schema；
- Session 内包含提示词注入；
- 编译期间产生新证据；
- 应用在编译期间退出；
- 封页后原始会话变化；
- 现有 `notebook-v1.json` 中的便签、草稿和封页无损迁移到新存储；
- iPad 离线批注后恢复网络；
- Mac 与 iPad 同时编辑同一批注；
- iCloud 账号退出、配额不足和同步延迟。

Golden Tests 验证产品合同和证据完整性，不以生成文字是否“更漂亮”作为主要指标。

## 15. Apple 平台参考

- [Deciding whether CloudKit is right for your app](https://developer.apple.com/documentation/cloudkit/deciding-whether-cloudkit-is-right-for-your-app)
- [CKSyncEngine](https://developer.apple.com/documentation/cloudkit/cksyncengine)
- [Configuring iCloud services](https://developer.apple.com/documentation/Xcode/configuring-icloud-services)
- [Encrypting User Data](https://developer.apple.com/documentation/cloudkit/encrypting-user-data)
- [CKAsset](https://developer.apple.com/documentation/cloudkit/ckasset)
- [Sync to iCloud with CKSyncEngine — WWDC23](https://developer.apple.com/videos/play/wwdc2023/10188/)
