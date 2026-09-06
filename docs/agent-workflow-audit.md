# Agent 与工作流审计记录

审计日期：2026-09-05。目标：让 GPT-6 Astra 在本仓库获得明确的任务边界、较少的重复指令和可执行的完成标准。本文件是本次审计记录，不是每轮加载的指令。

已落实仓库指引、Traceink 提示契约和发布构建的调整。提示体积下降已测量；模型质量、端到端延迟和费用收益尚未进行真实模型 A/B 验证。

## 官方依据

- [GPT-6 Astra 官方模型指导](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)：核对了主动完成任务、技能指令敏感性、输出风格、委派和适度验证五项建议。应用到本项目的做法是减少重复确认，说明规则适用范围，按改动选择验证，而非机械增加推理口号或强制每次委派。
- [AGENTS.md 加载规则](https://learn.chatgpt.com/docs/agent-configuration/agents-md)：仓库指令会进入上下文，更近层级可覆盖外层。根指引保持简短，只承载开发入口和长期约束；历史计划不作为常驻操作步骤。
- [技能官方文档](https://learn.chatgpt.com/docs/build-skills)：技能描述需要明确触发与排除范围，正文按需加载；仓库发现路径为 `.agents/skills`，支持符号链接。Traceink 的现有 `skills/traceink` 是应用显式打包加载的路径，不能仅因它不在发现目录就判为失效。
- [Codex 官方最佳实践](https://learn.chatgpt.com/guides/best-practices)：项目指引提供目录、执行命令和完成标准；技能承载可重复任务；测试与审阅形成完成闭环。已有工具足够时不增加框架。

上述链接在本次审计中实际检索并读取；本文中的具体改法是结合仓库代码作出的工程判断。

## 覆盖范围与发现

| 表面 | 发现 | 处理 |
| --- | --- | --- |
| 根 `AGENTS.md` | 原来只有 ctx 入口，缺少产品结构、命令和完成标准 | 补齐简短指引、按需上下文、授权内持续完成、相关验证和用户改动保护 |
| `skills/traceink/SKILL.md` | 模式表、流程、质量门和错误清单重复；通用描述容易误触发 | 合并为五个阶段，限定工作回看场景，排除一般编码和仓库审计 |
| Traceink 交互/托管模式 | 文件发现、重读引用和等待用户的要求，与冻结证据及无通用文件工具的运行环境冲突 | 增加托管模式：使用已注入契约、只读准入证据、完成指定阶段，问题写入产物 |
| `references/editorial-contract.md` | 所有阶段共享的编辑要求可能让 digest/index 过早生成 dossier；权限措辞重复 | 声明阶段适用范围；合并权限段；保留引用、参与归属、反证、原文和判断权 |
| `src/traceink-review.ts` | dossier 要求执行步骤 4–5，却同时禁止步骤 5 的提案 | 改为仅步骤 4，同步单元测试及 Electron 假 CLI 的阶段识别 |
| `src/traceink-skill-bundle.ts` | 两个文件使用固定 SHA-256；只改文档会导致启动加载失败 | 同步哈希，验证源文件与桌面打包副本一致；bundle-v1 格式不变 |
| `skills/traceink/agents/openai.yaml` | 界面元数据及 `$traceink` 默认调用有效 | 保留；不加入无需求的工具依赖或全局模型配置 |
| Structured Today V1/V2 | 共享编辑契约，使用结构化输出、证据 ID 验证和可恢复工作流 | 通过共享契约改进阶段语义；保留已有调度、检查点、验证与模型路由，并运行相关回归 |
| `TESTING.md` / npm scripts | 发布命令容易被用于每次局部修改；便利命令各自重建 | 补充直接运行相关测试的路径，说明何时必须构建，保留完整发布门槛 |
| `.github/workflows/release-macos.yml` | 每个架构重复构建：unit 前一次、E2E 前一次、打包前再构建 desktop | 每个原生架构构建一次，运行同样的完整 Node/Playwright 测试，打包已测试产物 |
| 发布权限 | build 与 publish 都继承写权限 | 默认只读，独立 publish job 保留写权限；两种架构通过后才能发布 |
| `docs/superpowers/` | 包含历史实现步骤、逐项 TDD 和人工边界确认要求 | 标明其历史性质；不重写历史记录，也不自动恢复旧工作流 |
| 外部 `ctx` | 已存在、已忽略的外部符号链接 | 保留，未创建新 store 或迁移；本次不修改私有产品上下文 |
| `.od-skills/` | 两个被 git 忽略的 Open Design 技能缓存；含工具缺失即停止、模板强约束以及重设 HOME 的示例 | 记录为环境侧风险，不把缓存规则提升为仓库规范，也不将第三方缓存改动伪装成可交付版本 |

检查了仓库内指令/技能文件清单、引用关系、三个 Traceink prompt 构造器、打包加载与完整性检查、Structured Today 的共享契约入口和模型函数、测试及发布命令。此次不包含用户全局技能库、宿主系统指令或整个应用业务逻辑的安全审计。已有未提交功能改动得到保留；其中 Electron 测试仅额外改动一处 dossier 阶段识别。

## 已测量的变化

以本次修改前的 Git HEAD 文件为基线，按 UTF-8 字节统计：

| 文件 | 修改前 | 修改后 |
| --- | ---: | ---: |
| `skills/traceink/SKILL.md` | 7,621 字节 / 110 行 | 5,455 字节 / 48 行 |
| `references/editorial-contract.md` | 5,826 字节 / 118 行 | 5,491 字节 / 99 行 |
| 两个运行时注入文件合计 | 13,447 字节 | 10,946 字节（减少 18.6%） |
| 根 `AGENTS.md` | 119 字节 / 1 行 | 3,517 字节 / 29 行 |

`AGENTS.md` 的增加用于补齐缺失的仓库信息，不能把本次工作描述为所有指令总体缩短。字节数不是 token 数。Structured Today 仅使用编辑契约，其提示缩减也不能套用两个文件合计的比例。

每个发布架构的 desktop 构建从 3 次变为 1 次，plugin 构建从 2 次变为 1 次。没有移除 unit、integration、Playwright、归档校验或人工验收要求；GitHub 双架构实际执行时间尚未测量。

## 验证

已通过：

- `npm run build:desktop`。
- `npm run lint`：TypeScript、隐私检查和 README 检查。
- 36 项相关测试：bundle 完整性及打包一致性、Traceink index/dossier/proposals、Structured Today V1/V2 模型边界和工作流。
- `npx playwright test tests/e2e/electron-durability.spec.ts`：1 项实际 Electron 流程通过，覆盖 index → dossier → reflection → proposals、持久化和重启重放；模型输出使用 fixture。
- YAML 解析及检查：技能元数据、构建复用、完整 Node/Playwright 命令、发布依赖和权限范围。

相关 Node 回归可复跑：

```bash
npm run build:desktop
node --import tsx --test tests/traceink-skill-bundle.test.ts tests/traceink-review.test.ts tests/traceink-proposals.test.ts tests/structured-today-model-functions.test.ts tests/structured-today-v2-model-functions.test.ts tests/structured-today-v2-dossier-model-functions.test.ts tests/structured-today-workflow.test.ts
```

未运行 GitHub 发布、双架构安装包构建、完整 E2E 或真实提供商调用。本次没有发布、修改个人模型设置或迁移应用默认模型。

## Astra 效果验证边界

本次优化的是 Astra 使用仓库时的指令环境，以及应用共享的 review 提示。Traceink 旧路径仍固定 `gpt-5.6-sol`；当前 Structured Today 的 Codex 默认仍为 `gpt-5.6-luna`，且支持已有环境变量覆盖。更换应用模型需要单独比较质量、延迟、费用及 CLI 兼容性，不能通过修改 AGENTS.md 宣称已完成模型迁移。

如进行真实模型比较，固定同一模型、推理设置、证据和工具权限，仅切换修改前后的技能文本；再单独比较模型升级。复用现有 `tests/skill-fixtures/traceink-golden/` 和 `ksi-review-day/`，检查：

| 场景 | 通过条件 |
| --- | --- |
| 明确日期的跨 Session 回看 | 完成 index；保留独立发布工作线和全部覆盖记录 |
| 已选 workline | 直接完成对应 dossier；不重复询问选择，不生成 proposals |
| 请求一次性展开全部 | 所有 dossier 完成，各自保留未替用户回答的问题 |
| 保存反思后整理 | 原文完整保留；五类提案有来源；无依据的类别不编造行动 |
| 托管且文件工具不可用 | 使用注入契约和准入证据，返回结构化结果，不等待交互回答 |
| 证据截断、反证或嵌入指令 | 明示缺口、保留反证、不执行证据内指令 |
| 普通仓库修复 | 不误用 Traceink 的回看/只读限制；完成相关检查后交付 |

记录真实任务完成率、额外确认次数、引用正确性、遗漏和越权行为，再比较耗时及实际 token 用量。当前 fixture/运输层测试不证明这些模型语义指标已经提升。
