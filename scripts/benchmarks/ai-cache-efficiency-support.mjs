import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

export const initialRole = "前端工程师";
export const finalRole = "AI应用开发工程师";
export const initialWorkStyle = "远程协作";
export const finalWorkStyle = "混合办公";

/** 每段属于可核对的合成履历；不添加用于抬高命中率的无意义填充。 */
export function createSyntheticSnapshot() {
  const paragraphs = [
    "合成简历：缓存业务基准。以下项目均为测试资料，不代表个人实际经历。",
    `目标岗位：${initialRole}`,
    `工作方式：${initialWorkStyle}`,
    "事实约束：不增加任职年限、业绩数字、公司或学历。",
    ...Array.from({ length: 24 }, (_, index) => {
      const modules = ["资料导入", "来源引用", "权限检查", "自动保存", "异步恢复", "内容检索"];
      return `项目 ${index + 1}：企业资料工作台的${modules[index % modules.length]}模块。负责交互与 TypeScript 请求协调，保存文档版本和操作结果；校验输入资料的来源、修订号及权限，处理并发请求失败与重试。完成表单和列表的键盘访问检查，根据合成反馈修复状态不一致。该条记录仅用于核验内容保留，不含实际业绩声明。`;
    }),
    "保留校验：原有项目说明、顺序和事实全部保留。",
  ];
  const doc = { type: "doc", content: paragraphs.map((text, index) => ({
    type: "paragraph", attrs: { canvasNodeId: `benchmark-node-${index}` },
    content: [{ type: "text", text }],
  })) };
  return { document_id: "cache-benchmark-document", editor_session_id: "cache-benchmark-editor", canvas_version: 1,
    content_revision: 1, doc_json: doc, plain_text: documentText(doc) };
}

export function documentText(node) {
  if (node.type === "text") return node.text ?? "";
  const separator = node.type === "paragraph" || node.type === "heading" ? "" : "\n";
  return (node.content ?? []).map(documentText).join(separator);
}

/** Headless 客户端只确认 Sidecar 已准备的事务，不实现另一套文档变换规则。 */
export function acceptPreparedTransaction(snapshot, transaction) {
  assert.equal(transaction.document_id, snapshot.document_id, "Transaction targets another document");
  assert.equal(transaction.editor_session_id, snapshot.editor_session_id, "Transaction targets another editor session");
  assert.equal(transaction.content_revision, snapshot.content_revision, "Transaction revision is stale");
  assert.deepEqual(transaction.before_doc_json, snapshot.doc_json, "Transaction would overwrite another document version");
  const changed = JSON.stringify(transaction.doc_json) !== JSON.stringify(snapshot.doc_json);
  const next = { ...snapshot, doc_json: structuredClone(transaction.doc_json),
    plain_text: documentText(transaction.doc_json), content_revision: snapshot.content_revision + Number(changed) };
  return { changed, snapshot: next };
}

/** 只输出互不混淆的实际 provider 计数；缺失 usage 不按零费用处理。 */
export function summarizeMeasurements(records) {
  const measured = records.filter((record) => record.usage?.inputTokens !== undefined && record.usage?.outputTokens !== undefined);
  const cacheMeasured = measured.filter((record) => record.usage.cacheReadInputTokens !== undefined);
  const sum = (items, field) => items.reduce((total, record) => total + (record.usage[field] ?? 0), 0);
  const prompt = sum(measured, "inputTokens");
  const cachePrompt = sum(cacheMeasured, "inputTokens");
  const hit = sum(cacheMeasured, "cacheReadInputTokens");
  const ttft = records.map((record) => record.ttftMs).filter(Number.isFinite).sort((left, right) => left - right);
  return { calls: records.length, measuredCalls: measured.length, unmeasuredCalls: records.length - measured.length,
    cacheMeasuredCalls: cacheMeasured.length, promptTokens: prompt, cacheHitTokens: hit,
    cacheMissTokens: cacheMeasured.reduce((total, record) => total + (record.usage.cacheMissInputTokens
      ?? record.usage.inputTokens - record.usage.cacheReadInputTokens), 0),
    outputTokens: sum(measured, "outputTokens"), reasoningTokens: sum(measured, "reasoningOutputTokens"),
    hitRate: cachePrompt ? hit / cachePrompt : null,
    totalModelMs: records.reduce((total, record) => total + record.durationMs, 0),
    medianTtftMs: ttft.length ? ttft[Math.floor((ttft.length - 1) / 2)] : null,
    p95TtftMs: ttft.length ? ttft[Math.ceil(ttft.length * 0.95) - 1] : null };
}

export function assertExpectedDocument(initial, actual, stage) {
  const expected = structuredClone(initial.doc_json);
  if (stage >= 1) expected.content[1].content[0].text = `目标岗位：${finalRole}`;
  if (stage >= 2) expected.content[2].content[0].text = `工作方式：${finalWorkStyle}`;
  assert.deepEqual(normalizeTextFragments(actual.doc_json), normalizeTextFragments(expected), "Document differs from the exact requested changes");
  assert.equal(actual.plain_text, documentText(expected), "Plain text differs from persisted document JSON");
}

// Sidecar 的文本溯源可把相同格式的文字拆成多个叶节点；忽略这种无语义差别，仍比较所有结构和格式。
function normalizeTextFragments(node) {
  if (!node.content) return node;
  const content = [];
  for (const child of node.content.map(normalizeTextFragments)) {
    const previous = content.at(-1);
    const { text: _previousText, ...previousProperties } = previous ?? {};
    const { text: _childText, ...childProperties } = child;
    if (previous?.type === "text" && child.type === "text" && isDeepStrictEqual(previousProperties, childProperties)) previous.text += child.text;
    else content.push(structuredClone(child));
  }
  return { ...node, content };
}
