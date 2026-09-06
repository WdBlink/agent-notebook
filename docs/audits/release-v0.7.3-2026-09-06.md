# v0.7.3 本地发布验收

- `npm run check` 通过：461 项 Node 测试、67 项 Playwright 测试，以及类型、隐私、README 检查。
- 使用 Electron Builder 生成 arm64/x64 两种架构的 DMG、ZIP，共四个安装包。
- 四包全部通过 `verify:desktop-release`，核对版本、原生架构、品牌、Skill/contract 原始字节、关键产品行为标记和 SHA-256。
- 打包后的 arm64 应用额外通过完整 Today 整理、证据回开、草稿导航、保存反思、提案选择、封页和重启回放。使用临时 profile 与假 Provider，没有修改已安装应用或真实用户数据。
- 归档验证脚本已从旧 `upsertStructuredTodayRun` 标记更新为独立进度存储校验，并检查 v8 冻结原文和小体积进度通知。

本地 Intel 包已验证架构与归档内容；原生 Intel 执行由标签触发的 GitHub Actions 发布工作流验证。没有执行真人手动验收或真实 Provider 质量评估。安装包沿用未签名、未公证状态。
