import { approvalHost, approvalSnapshot, nextManualProposal } from "../helpers/editor-approval-host";
import { createAgentHostServer } from "../../src";

const { host } = await approvalHost(process.argv[2], approvalSnapshot);
const server = createAgentHostServer({ host });
server.listen();
const conversation = host.createConversation("doc");
const run = host.startConversationRun("doc", conversation.id, { message: { content: "改写原文，等我手动应用" }, mutationMode: "review", context: { editor_snapshot: approvalSnapshot } });
const request = await nextManualProposal(host, run.id, approvalSnapshot);
console.log(JSON.stringify({ runId: run.id, conversationId: conversation.id, requestId: request.id }));
