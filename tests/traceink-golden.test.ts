import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("./skill-fixtures/traceink-golden/", import.meta.url);

test("Traceink golden index preserves the proven review signals", async () => {
  const markdown = await readFile(new URL("index.md", ROOT), "utf8");
  const manifest = JSON.parse(await readFile(new URL("explicit-input-manifest.json", ROOT), "utf8")) as { files: string[] };
  const discoveredFixtureFiles = await readdir(new URL("../ksi-review-day/", ROOT));

  assert.equal(manifest.files.length, 5);
  assert.equal(discoveredFixtureFiles.length, 6);
  assert.ok(discoveredFixtureFiles.includes("claude-release-check.jsonl"));
  for (const relativePath of manifest.files) await readFile(new URL(relativePath, ROOT));
  assert.ok(!manifest.files.some((item) => item.includes("claude-release-check")));
  assert.match(markdown, /已读取.*5\/5 个文件/);
  assert.match(markdown, /你参与/);
  assert.match(markdown, /Agent 独立推进/);
  assert.match(markdown, /共同推进/);
  assert.match(markdown, /可能的变化信号 · AI 整理，尚未采纳/);
  assert.match(markdown, /证据可展开度/);
  for (const marker of ["E1", "E2", "E3", "E4", "E5"]) assert.match(markdown, new RegExp(`\\[${marker}\\]`));
  assert.doesNotMatch(markdown, /claude-release-check/);
});

test("Traceink full-day golden never hides the independent release workline", async () => {
  const markdown = await readFile(new URL("full-day-index.md", ROOT), "utf8");

  assert.match(markdown, /6\/6 个文件/);
  assert.match(markdown, /从 scheduler 吞吐实验转向 Research IR 表示假设/);
  assert.match(markdown, /0\.6\.0 双架构安装包的发布前边界检查/);
  assert.match(markdown, /claude-release-check/);
  assert.match(markdown, /你想先展开哪条工作线的证据档案：1 还是 2/);
});

test("today's direct Traceink result remains the five-workline product oracle", async () => {
  const markdown = await readFile(new URL("today-2026-08-15-index.md", ROOT), "utf8");

  assert.equal((markdown.match(/^## \d+[.、] /gm) ?? []).length, 5);
  for (const signal of ["**时间：**", "**状态：**", "**参与：**", "**当前停点：**", "**证据完整度：**"]) {
    assert.ok(markdown.includes(signal), signal);
  }
  for (const title of [
    "Work Continuity",
    "中金式 AI Loop",
    "没有 Alpha",
    "Autoresearch Adapter ↔ Evaluator",
    "FOLO RSS → LLM-Wiki"
  ]) assert.match(markdown, new RegExp(title));
});

test("Traceink golden dossier preserves the evidence-led reading contract", async () => {
  const markdown = await readFile(new URL("dossier.md", ROOT), "utf8");
  const headings = [
    "原来的判断或背景",
    "发生了什么",
    "可能产生的变化 · AI 整理，尚未采纳",
    "支持、反对与适用边界",
    "未来如何验证或推翻",
    "证据登记",
    "仍需你判断"
  ];

  for (const heading of headings) assert.ok(markdown.includes(`### ${heading}`));
  assert.match(markdown, /不代表你已认定 scheduler 就是根因/);
  assert.match(markdown, /没有授权迁移、代码修改或架构切换/);
  assert.match(markdown, /现有材料没有定义“明显下降”的量化阈值/);
});

test("Traceink golden proposals preserve user ink, five categories, and zero implicit effects", async () => {
  const markdown = await readFile(new URL("proposals.md", ROOT), "utf8");
  const original = "我的思考是：我倾向于先验证 Research IR，但 Receipt 不应该直接承担 IR。明天先选两类真实任务，把最小 fixture 准备好；fixture 的整理可以交给后台，只允许只读材料和生成独立文档。这个方向变化值得以后写进 CTX，但现在先别执行任何写入。";

  assert.ok(markdown.includes(`> ${original}`));
  for (const marker of ["J1", "T1", "C1", "B1", "D1"]) assert.match(markdown, new RegExp(`\\[${marker}\\]`));
  for (const category of ["形成的判断", "明日候选", "CTX 候选", "后台候选", "只留在今天"]) assert.match(markdown, new RegExp(category));
  for (const action of ["接受", "驳回", "延后", "改写"]) assert.match(markdown, new RegExp(action));
  assert.match(markdown, /不触发写入、后台授权或收口动作/);
});
