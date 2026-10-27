import { randomUUID } from "node:crypto";
import { editorResponseSchema, type CanvasMutationMode, type EditorRequest, type EditorResponse, type EditorSnapshot, type EditorTransaction } from "@typedance/contracts";

type Pending = { request: EditorRequest; resolve: (response: EditorResponse) => void; cleanup: () => void; startExecution: () => void; executing: boolean };
type Emit = (type: "editor_request" | "editor_execution_started" | "editor_response", payload: Record<string, unknown>) => void;

/** 活动编辑器的请求/确认通道。Host 不执行文档变换，也不假定事件已被前端执行。 */
export class EditorSession {
  snapshot: EditorSnapshot;
  readonly mode: CanvasMutationMode;
  #pending = new Map<string, Pending>();
  #signal: AbortSignal;
  #emit: Emit;
  #decisions: Array<{ status: EditorResponse["status"]; persisted?: boolean; revision?: number }> = [];
  #auditedDecisions = 0;

  constructor(input: { snapshot: EditorSnapshot; mode: CanvasMutationMode; signal: AbortSignal; emit: Emit }) {
    this.snapshot = input.snapshot;
    this.mode = input.mode;
    this.#signal = input.signal;
    this.#emit = input.emit;
  }

  updateSnapshot(snapshot: EditorSnapshot): void {
    if (snapshot.document_id !== this.snapshot.document_id) throw new Error("编辑器快照不属于本次授权文档");
    if (snapshot.editor_session_id === this.snapshot.editor_session_id) {
      if (snapshot.content_revision >= this.snapshot.content_revision) this.snapshot = snapshot;
      return;
    }
    // A fresh read can reconnect the same document. Old transactions must be regenerated.
    for (const [id, item] of this.#pending) {
      item.cleanup();
      this.#pending.delete(id);
      const error = "编辑器已重新连接，请重新读取当前画布后操作";
      if (item.request.kind === "transaction") this.#decisions.push({ status: "failed" });
      this.#emit("editor_response", { request_id: id, status: "failed", error });
      item.resolve({ status: "failed", error });
    }
    this.snapshot = snapshot;
  }

  pending(requestId: string): EditorRequest {
    const item = this.#pending.get(requestId);
    if (!item || this.#signal.aborted) throw new Error("编辑请求已结束，请重新发送任务");
    return item.request;
  }

  beginExecution(requestId: string): EditorRequest {
    const request = this.pending(requestId);
    const item = this.#pending.get(requestId)!;
    if (request.kind !== "transaction" || request.mode !== "review") throw new Error("此请求无需人工确认");
    if (!item.executing) {
      item.executing = true;
      item.startExecution();
      this.#emit("editor_execution_started", { request_id: requestId });
    }
    return request;
  }

  supersedeApproval(): void {
    for (const [id, item] of this.#pending) {
      if (item.request.kind !== "transaction" || item.request.mode !== "review" || item.executing) continue;
      item.cleanup();
      this.#pending.delete(id);
      const error = "用户已补充新的要求，此预览已结束；请先处理最新输入，再核对当前画布并生成待确认修改";
      this.#decisions.push({ status: "failed" });
      this.#emit("editor_response", { request_id: id, status: "failed", error });
      item.resolve({ status: "failed", error });
    }
  }

  respond(requestId: string, value: unknown): void {
    const item = this.#pending.get(requestId);
    if (!item || this.#signal.aborted) throw new Error("编辑请求已结束");
    const response = editorResponseSchema.parse(value);
    if (item.request.kind === "transaction" && item.request.mode === "review"
      && (response.status === "applied" || response.status === "unchanged") && !item.executing) throw new Error("请先确认应用修改");
    const snapshot = response.snapshot;
    if (snapshot && (snapshot.document_id !== this.snapshot.document_id || (item.request.kind !== "snapshot" && snapshot.editor_session_id !== this.snapshot.editor_session_id)
      || JSON.stringify(snapshot.doc_json).length > 500_000)) throw new Error("编辑器快照不属于本次授权文档或编辑会话");
    if ((response.status === "snapshot" || response.status === "applied" || response.status === "unchanged") && !snapshot) throw new Error("编辑器必须返回实际快照");
    if (item.request.kind === "snapshot" && (response.status === "applied" || response.status === "unchanged")) throw new Error("只读请求不能报告写入");
    if (item.request.kind === "transaction" && response.status === "snapshot") throw new Error("写请求必须返回实际执行决定");
    if (snapshot && snapshot.editor_session_id === this.snapshot.editor_session_id && snapshot.content_revision < this.snapshot.content_revision) throw new Error("编辑器返回了过期快照");
    item.cleanup();
    this.#pending.delete(requestId);
    if (snapshot) this.updateSnapshot(snapshot);
    if (item.request.kind === "transaction") this.#decisions.push({ status: response.status,
      ...(response.status === "applied" ? { persisted: response.persisted === true } : {}), revision: snapshot?.content_revision });
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
    if (transaction.editor_session_id !== this.snapshot.editor_session_id) throw new Error("编辑器已重新连接，请重新读取当前画布后操作");
    return this.#request("transaction", transaction);
  }

  async auditCompletion() {
    if (this.#auditedDecisions === this.#decisions.length) return undefined;
    const decisions = this.#decisions.slice(this.#auditedDecisions);
    const snapshot = await this.refresh();
    this.#auditedDecisions = this.#decisions.length;
    return { snapshot, decisions };
  }

  #request(kind: EditorRequest["kind"], transaction?: EditorTransaction): Promise<EditorResponse> {
    this.#signal.throwIfAborted();
    const request: EditorRequest = { id: randomUUID(), document_id: this.snapshot.document_id,
      editor_session_id: this.snapshot.editor_session_id, kind, mode: this.mode === "solo" ? "solo" : "review", ...(transaction ? { transaction } : {}) };
    return new Promise((resolve, reject) => {
      const abort = () => finish(new Error("编辑请求已取消"));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const startExecution = () => {
        timeout = setTimeout(() => finish(new Error(kind === "transaction"
          ? "编辑执行结果回传超时，修改可能已生效；请先核对当前画布，勿直接重复修改"
          : "读取编辑器超时，请检查当前画布连接后重试")), 300_000);
      };
      const cleanup = () => { clearTimeout(timeout); this.#signal.removeEventListener("abort", abort); };
      const finish = (error: Error) => {
        cleanup(); this.#pending.delete(request.id);
        this.#emit("editor_response", { request_id: request.id, status: "failed", error: error.message });
        reject(error);
      };
      const waitingForApproval = kind === "transaction" && request.mode === "review";
      this.#pending.set(request.id, { request, resolve, cleanup, startExecution, executing: !waitingForApproval });
      this.#signal.addEventListener("abort", abort, { once: true });
      if (!waitingForApproval) startExecution();
      this.#emit("editor_request", { request });
    });
  }
}
