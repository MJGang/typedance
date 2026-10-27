import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticSnapshot, acceptPreparedTransaction, assertExpectedDocument, summarizeMeasurements } from "./ai-cache-efficiency-support.mjs";

test("measurement summary uses token-weighted cache input and keeps missing usage explicit", () => {
  const summary = summarizeMeasurements([
    { durationMs: 30, ttftMs: 10, usage: { inputTokens: 100, cacheReadInputTokens: 50, cacheMissInputTokens: 50, outputTokens: 3 } },
    { durationMs: 50, ttftMs: 20, usage: { inputTokens: 900, cacheReadInputTokens: 890, cacheMissInputTokens: 10, outputTokens: 4, reasoningOutputTokens: 2 } },
    { durationMs: 10, failedWithoutUsage: true },
  ]);
  assert.equal(summary.hitRate, 0.94);
  assert.equal(summary.promptTokens, 1000);
  assert.equal(summary.cacheMissTokens, 60);
  assert.equal(summary.outputTokens, 7);
  assert.equal(summary.reasoningTokens, 2);
  assert.equal(summary.measuredCalls, 2);
  assert.equal(summary.unmeasuredCalls, 1);
});

test("headless bridge rejects stale versions and preserves the exact requested content", () => {
  const original = createSyntheticSnapshot();
  const transaction = { document_id: original.document_id, editor_session_id: original.editor_session_id,
    content_revision: original.content_revision, before_doc_json: structuredClone(original.doc_json), doc_json: structuredClone(original.doc_json) };
  transaction.doc_json.content[1].content[0].text = "目标岗位：AI应用开发工程师";
  const result = acceptPreparedTransaction(original, transaction);
  assert(result.changed);
  assert.equal(result.snapshot.content_revision, original.content_revision + 1);
  assertExpectedDocument(original, result.snapshot, 1);
  const fragmented = structuredClone(result.snapshot);
  fragmented.doc_json.content[1].content = [{ type: "text", text: "目标岗位：" }, { type: "text", text: "AI应用开发工程师" }];
  assertExpectedDocument(original, fragmented, 1);
  fragmented.doc_json.content[1].content[1].marks = [{ type: "bold" }];
  assert.throws(() => assertExpectedDocument(original, fragmented, 1), /exact requested/);
  assert.throws(() => acceptPreparedTransaction(result.snapshot, transaction), /stale/);
  const corrupted = structuredClone(result.snapshot);
  corrupted.doc_json.content.pop();
  assert.throws(() => assertExpectedDocument(original, corrupted, 1), /exact requested/);
});
