import type { AgentMessage } from "@typedance/contracts";
import type { HarnessModelMessage } from "@typedance/harness-core";
import { formatReferencedMessage } from "./editor-references";

export function toModelMessage(message: AgentMessage): HarnessModelMessage {
  const text = formatReferencedMessage(message.content, message.references);
  return message.role === "user" && message.attachments?.length
    ? { role: "user", content: [{ type: "text", text }, ...message.attachments.map((attachment) => attachment.content.type === "image"
      ? attachment.content : { type: "text" as const, text: `附件：${attachment.name}\n${attachment.content.text}` })] }
    : { role: message.role, content: text };
}
