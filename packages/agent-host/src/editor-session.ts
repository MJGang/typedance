import { randomUUID } from "node:crypto";
import { editorResponseSchema, type CanvasMutationMode, type EditorRequest, type EditorResponse, type EditorSnapshot, type EditorTransaction } from "@typedance/contracts";

type Pending = { request: EditorRequest; resolve: (response: EditorResponse) => void; reject: (error: Error) => void; cleanup: () => void };
type Emit = (type: "editor_request" | "editor_response", payload: Record<string, unknown>) => void;

/** 活动编辑器的请求/确认通道。Host 不执行文档变换，也不假定事件已被前端执行。 */
export class EditorSession {
  snapshot: EditorSnapshot;
  readonly mode: CanvasMutationMode;
  #pending = new Map<string, Pending>();
  #signal: AbortSignal;
  #emit: Emit;

  constructor(input: { snapshot: EditorSnapshot; mode: CanvasMutationMode; signal: AbortSignal; emit: Emit }) {
    this.snapshot = input.snapshot;
    this.mode = input.mode;
    this.#signal = input.signal;
    this.#emit = input.emit;
  }

  pending(requestId: string): EditorRequest {
    const item = this.#pending.get(requestId);
    if (!item || this.#signal.aborted) throw new Error("编辑请求已结束，请重新发送任务");
    return item.request;
  }

  respond(requestId: string, value: unknown): void {
    const item = this.#pending.get(requestId);
    if (!item || this.#signal.aborted) throw new Error("编辑请求已结束");
    const response = editorResponseSchema.parse(value);
    const snapshot = response.snapshot;
    if (snapshot && (snapshot.document_id !== this.snapshot.document_id || snapshot.editor_session_id !== this.snapshot.editor_session_id
      || JSON.stringify(snapshot.doc_json).length > 500_000)) throw new Error("编辑器快照不属于本次授权文档或编辑会话");
    if ((response.status === "snapshot" || response.status === "applied") && !snapshot) throw new Error("编辑器必须返回实际快照");
    if (item.request.kind === "snapshot" && response.status === "applied") throw new Error("只读请求不能报告写入");
    if (item.request.kind === "transaction" && response.status === "snapshot") throw new Error("写请求必须返回实际执行决定");
    if (snapshot && snapshot.content_revision < this.snapshot.content_revision) throw new Error("编辑器返回了过期快照");
    item.cleanup();
    this.#pending.delete(requestId);
    if (snapshot) this.snapshot = snapshot;
    this.#emit("editor_response", { request_id: requestId, status: response.status, error: response.error,
      ...(response.persisted !== undefined ? { persisted: response.persisted } : {}),
      ...(snapshot ? { content_revision: snapshot.content_revision, page_count: snapshot.print_snapshot?.page_tops.length } : {}) });
    item.resolve(response);
  }

  async refresh(): Promise<EditorSnapshot> {
    const response = await this.#request("snapshot");
    if (response.status !== "snapshot" || !response.snapshot) throw new Error(response.error || "当前编辑器不可用");
    return response.snapshot;
  }

  async apply(transaction: EditorTransaction): Promise<EditorResponse> {
    if (this.mode === "suggest") throw new Error("建议模式不能修改文档，请切换手动应用或自动修改模式");
    return this.#request("transaction", transaction);
  }

  #request(kind: EditorRequest["kind"], transaction?: EditorTransaction): Promise<EditorResponse> {
    this.#signal.throwIfAborted();
    const request: EditorRequest = { id: randomUUID(), document_id: this.snapshot.document_id,
      editor_session_id: this.snapshot.editor_session_id, kind, mode: this.mode === "solo" ? "solo" : "review", ...(transaction ? { transaction } : {}) };
    return new Promise((resolve, reject) => {
      const abort = () => finish(new Error("编辑请求已取消"));
      const timeout = setTimeout(() => finish(new Error("等待编辑器响应超时，请重新发送任务")), 300_000);
      const cleanup = () => { clearTimeout(timeout); this.#signal.removeEventListener("abort", abort); };
      const finish = (error: Error) => { cleanup(); this.#pending.delete(request.id); reject(error); };
      this.#pending.set(request.id, { request, resolve, reject, cleanup });
      this.#signal.addEventListener("abort", abort, { once: true });
      this.#emit("editor_request", { request });
    });
  }
}
