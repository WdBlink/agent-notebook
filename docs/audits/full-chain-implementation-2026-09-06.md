# 全链路整改实施记录

日期：2026-09-06。基于 HEAD `0a31fac`、版本 `0.7.2` 的现有工作区实施；改动尚未提交或发布。保留开始前已有的 release workflow、AGENTS、TESTING、Traceink Skill/contract/hash 和审查文档改动。

已落地前次复核建议中第一至第三阶段的主要修复：输入与状态正确性、宿主证据接入、重复计算与进度成本。第四阶段的真实模型质量对照尚未执行，未据此删掉分析轮次或切换默认 V2。

## 已完成的行为

| 范围 | 最终行为 | 回归证据 |
| --- | --- | --- |
| 模型输入 | 按完整 JSON 序列化成本限制在 240000 字符；首尾源位置不重叠；消息、文件、总量裁剪传播 partial 状态 | structured-today-integration、transcript-reader |
| 失败恢复 | 终局失败可重试，只重做失败家族；成功 Digest 不重复追加；终局关系校验失败允许重新生成候选 | structured-today-integration、structured-today-workflow |
| 刷新竞态 | 发布校验请求序号、日期和来源配置；合并最新设置；前端拒绝旧版本和日期不一致快照 | desktop-refresh-race、desktop-app |
| 用户草稿 | 草稿按日期、Index 版本、工作线、Dossier 版本保留，导航离开再回来仍可编辑；正式保存仍受版本约束 | 真实 Electron 默认 Today 链路 |
| 子 Agent 证据 | 点击、引用和授权共用证据身份解析；冻结引用可在当前快照缺少子 Session 时回开；篡改引用仍拒绝 | structured-today-integration |
| 本地存储 | 仅文件不存在时回退空数据；读取错误保留原文件并报错；JSON 写入按路径串行、临时文件原子替换 | json-file-store |
| 发现覆盖 | 扫描先处理匹配目标日的目录/文件，再处理较新候选；截断或读取失败展示范围缺口 | agent-sessions |
| 深入分析原文 | 宿主校验冻结哈希与范围并读取内容；分析、批评、成文均收到受预算约束的原文；源文件缺失时不调用模型 | structured-today-integration：删除源文件拒绝；追加的现场内容不进入冻结输入 |
| Digest 复用 | 缓存键包含工作流版本、Provider/模型与完整请求；只缓存成功结果；损坏缓存丢弃重算 | structured-today-integration、structured-today-runtime-store |
| 进度成本 | 运行进度使用独立 SQLite 表，小体积 IPC 推送；进度回调不再加载/重写历史资产或重建全量 UI 状态；完整广播合并 | structured-today-runtime-store；main/preload/renderer 调用路径复核 |
| 活动与启动 | 窗口先创建再扫描；活动日期查询缓存；活动读取每次最多 3 个并发、缓存最多 256 项，失败可再读 | session-activity-cache；桌面构建及 Electron 链路 |
| CLI 资源 | 全应用 CLI 最多 3 个并发；过期智能标题队列停止继续调度，运行中进程可取消；处理取消大输入时的 EPIPE | agent-summary、desktop-cli-runner |

可量化的局部结果：重复准备相同家族不再调用 Digest，变化家族单独重算；20 次进度更新造成 0 次额外历史仓库发布，历史文件内容不变；CLI 实际子进程并发峰值为 3。缓存进度最多保留 200 条运行记录，Digest 最多 512 条且每条不超过 64 KiB。以上是操作计数和容量边界，不代表真实模型质量或端到端提速比例。

## 实际验证

- `npm run build` 通过，覆盖旧插件和桌面构建；后续桌面修改重新执行 `npm run build:desktop`。
- `npm run lint` 通过，包含 TypeScript、privacy、README 检查。
- `node --import tsx --test tests/*.test.ts`：461 项通过，0 失败。
- `npx playwright test tests/e2e/desktop-app.spec.ts tests/e2e/electron-structured-today.spec.ts tests/e2e/electron-durability.spec.ts tests/e2e/electron-message-span-candidate.spec.ts`：24 项通过，0 失败；其中 3 项运行真实 Electron，使用临时 profile 与假 Provider。
- 最后补查复现了取消大输入的未处理 EPIPE；补丁后重新运行 CLI 测试、TypeScript、桌面构建和 `git diff --check`。CLI 9 项通过，包括 1 MB stdin 取消和忽略 SIGTERM 的强制退出。
- 曾发现前端日期约束持续生效导致正常广播被拒绝；已改成仅导航请求进行时约束目标日期，并通过完整桌面回归。没有改测试去接受错误行为。

## 明确保留的边界

1. 草稿目前跨页面导航保留，尚不跨应用退出；已保存反思按原有持久化与版本约束处理。
2. 目标日优先和缺口提示不能替代完整消息活动日期索引。无日期命名的大量 Claude 历史、跨日长会话仍受候选扫描预算约束，不能宣称发现完整。
3. 冻结哈希与范围不是原文备份。源文件删除后无法恢复原文；本次选择显式失败。
4. 原始文件发现仍有整文件读取与主进程解析；没有新增扫描字节预算、Worker、阅读器分页或虚拟列表。需要真实规模测量再决定。
5. 没有执行真实 Provider 对照、用户全量数据性能基线、签名归档或发布，也没有改变个人模型配置和默认产品开关。

下一步应固定同一批真实材料，比较单轮/三轮与 V1/V2 的证据支持率、遗漏、错误合并/拆分、调用费用和延迟，再决定删减哪些模型节点与旧写入路径。现有确定性测试只证明契约与恢复行为，不能替代这项质量判断。
