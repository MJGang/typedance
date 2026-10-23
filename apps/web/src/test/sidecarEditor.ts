import { execFileSync } from "node:child_process"
import { delimiter, resolve } from "node:path"
import type { EditorOperation } from "@typedance/contracts"

// pnpm/vitest 的项目工作目录是 apps/web；import.meta.url 会被 jsdom 转换成 HTTP URL。
const source = resolve(process.cwd(), "../../services/sidecar/src")

/** 跨语言组件集成测试直接执行实际业务模块，避免在 mock 中复制分栏规则。 */
export function prepareWithSidecar(doc: Record<string, unknown>, operations: EditorOperation[]) {
  const output = execFileSync("python", ["-X", "utf8", "-c", [
    "import json, sys",
    "from typedance_sidecar.editor_operations import capability_catalog, prepare_operations",
    "payload = json.load(sys.stdin)",
    "print(json.dumps(prepare_operations(payload['doc'], payload['operations'], capability_catalog()['revision'])))",
  ].join("\n")], {
    encoding: "utf8", input: JSON.stringify({ doc, operations }),
    env: { ...process.env, PYTHONPATH: [source, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
  })
  return JSON.parse(output) as { doc_json: Record<string, unknown>; catalog_revision: string; effects: Array<{ capability: string; title: string; effect: string }> }
}
