# 选择对话时自动展开 AI 面板

## 目标

用户点击工作台左侧任意对话时，如果右侧 AI 面板当前隐藏，则自动展开面板，并在面板中加载所选对话。面板已经展开时，现有选择行为保持不变。

## 实现边界

- 改动属于 Frontend 交互状态协调，不涉及 Harness Core、TS Agent Host 或 Python Sidecar。
- `RevisionWorkspacePage` 继续持有当前对话与 AI 面板显隐状态的协调职责。
- `WorkbenchSidebar` 只上报所选对话 ID，不直接感知或控制右侧面板。

## 交互与数据流

1. 用户点击左侧对话行。
2. `WorkbenchSidebar` 调用 `onSelectConversation(conversationId)`。
3. `RevisionWorkspacePage` 的页面级选择处理函数同步更新 `activeConversationId`，并调用 `setAssistantPanelVisible(true)`。
4. 右侧 `AgentChatPanel` 按新的 `activeConversationId` 加载并展示对应对话。

不使用监听 `activeConversationId` 的副作用，避免初始化、创建对话或其他非点击路径意外改变用户的面板显隐选择。

## 测试

- 页面以 AI 面板隐藏状态渲染。
- 等待左侧对话列表加载后点击一个既有对话。
- 断言 AI 面板重新出现，页面恢复双栏布局，并展示所选对话标题。
- 保留现有面板手动隐藏与恢复测试，确保原入口不受影响。
