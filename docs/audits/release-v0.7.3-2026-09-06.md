# v0.7.3 本地发布验收

- `npm run check` 通过：461 项 Node 测试、67 项 Playwright 测试，以及类型、隐私、README 检查。
- 使用 Electron Builder 生成 arm64/x64 两种架构的 DMG、ZIP，共四个安装包。
- 四包全部通过 `verify:desktop-release`，核对版本、原生架构、品牌、Skill/contract 原始字节、关键产品行为标记和 SHA-256。
- 打包后的 arm64 应用额外通过完整 Today 整理、证据回开、草稿导航、保存反思、提案选择、封页和重启回放。使用临时 profile 与假 Provider，没有修改已安装应用或真实用户数据。
- 归档验证脚本已从旧 `upsertStructuredTodayRun` 标记更新为独立进度存储校验，并检查 v8 冻结原文和小体积进度通知。

本地 Intel 包已验证架构与归档内容；原生 Intel 执行由标签触发的 GitHub Actions 发布工作流验证。没有执行真人手动验收或真实 Provider 质量评估。安装包沿用未签名、未公证状态。

## 远端检查期间的测试修复

首次 Intel 运行有 66/67 项端到端测试通过，旧白板拖拽用例读到了此前缩放保存的状态；一次重跑在旧生命周期自检中失败：25 ms 总预算在前置文件操作后只剩 5 ms，尚未到注入的挂起阶段便超时。

修复仅影响测试：拖拽等待缩放保存及实际位置变化，仍检查原来的 180×120 位移和子节点一致性；生命周期自检增加前置 IO 余量，并同步延长故意延迟的写入和观测窗口，仍检查取消、恢复与有界退出。专项 14 项测试、拖拽连续 5 次和类型检查通过。产品代码及本地安装包内容未因这两处测试调整而改变。

## 安装反馈与 v0.7.4 修正

用户通过浏览器下载并安装后，macOS 报告应用已损坏。下载文件与 GitHub 发布校验和一致，但应用保留了 Electron 的不完整 linker ad-hoc 签名：`codesign --verify --deep --strict` 报告 `code has no resources but signature indicates they must be present`。此前归档检查和临时 profile 启动没有覆盖这项签名缺陷。

v0.7.4 显式使用完整 ad-hoc 签名并关闭不适用于当前签名方式的 hardened runtime；归档验证增加严格递归签名检查。同一检查已拒绝旧 arm64 ZIP，并接受修复后的 arm64/x64 应用。此修复不提供 Apple Developer ID 身份或公证，不能据此宣称通过 Gatekeeper。

本地 v0.7.4 arm64 DMG/ZIP 均通过新增签名检查及原有归档检查；打包应用以临时 profile 和假 Provider 通过完整 Today 收口与重启回放测试（1 项）。
