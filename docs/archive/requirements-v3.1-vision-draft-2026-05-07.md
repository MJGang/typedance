# TypeDance 需求规格说明书

> 版本: v3.1
> 最后更新: 2026-05-07
> 项目状态: 设计阶段

---

## 1. 项目概述

### 1.1 项目背景

在 AI 协助下编写和修改 .md 文件。以 Markdown 为核心格式，直接操作本地文件，像 Obsidian 一样管理文档，像 Notion 一样拥有富文本编辑体验。

V1 以简历场景为切入点，但简历功能以插件形式交付——核心是一个通用的 AI 写作编辑器。底层架构不绑定任何特定文档类型，通过插件系统可扩展至任意写作场景。

### 1.2 项目目标

构建一个桌面端应用（基于 Tauri 2），提供：

- 文档解析（Markdown / PDF → ProseMirror JSON）
- Notion 风格的所见即所得编辑体验（基于 TipTap 3.x）
- 选中文字后的 AI 辅助浮窗（`@` 引用文件 + `/` 调用 Skill + 自定义指令）
- Agent 自主探索本地文件/项目的能力（LangGraph Workflow）
- 所见即所得的 A4 分页预览
- 导出 PDF
- 可配置的多 LLM Provider 支持
- 可扩展的插件系统（commands / agents / skills / hooks）
- 灵活的模板系统（V2 目标）

### 1.3 命名由来

**TypeDance** = Type（打字/文字）+ Dance（跳动/舞蹈）

致敬 ByteDance（字节跳动）的命名基因——「文字也跳动」。寓意 AI 让文字在指尖起舞，流畅、灵动、富有创造力。

- 用户目录: `~/.typedance/`
- 配置: `~/.typedance/config.toml`
- 插件: `~/.typedance/plugins/`
- 品牌色: 待定

### 1.4 目标用户

- 有写作需求的用户。V1 聚焦程序员群体（因简历 + AI 关联代码的需求最明确），但产品定位不限于此

---

## 2. 技术栈

| 层 | 技术 | 版本要求 | 选型理由 |
|------|------|---------|---------|
| **桌面壳** | Tauri 2 | ^2.0 | 跨平台桌面应用框架，Rust 性能与安全性 |
| **前端框架** | React + Vite + TypeScript | ^18 / ^5 / ^5 | 成熟生态，与 TipTap 深度集成 |
| **富文本编辑器** | TipTap 3.x (ProseMirror) | ^3.0 | BubbleMenu 原生支持选中文字弹出浮窗，Block 级编辑模型 |
| **UI 样式** | Tailwind CSS | ^3.0 | 快速搭建 UI |
| **后端** | Python FastAPI | ^0.115 | AI 集成 + PDF 生成生态成熟 |
| **Agent 框架** | LangChain + LangGraph | latest | 编排多节点 Agent 工作流 |
| **PDF 导出** | WeasyPrint / Playwright | - | HTML→PDF，支持分页控制 |
| **PDF 解析** | PyMuPDF (fitz) | - | PDF 文本提取 |
| **项目依赖管理** | uv + pyproject.toml | - | 现代 Python 包管理 |
| **LLM Provider** | OpenAI / DeepSeek / Ollama 等 | - | 配置式切换 |

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  TypeDance (Tauri 2 Desktop App)                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────┐  ┌─────────────────────────────┐  │
│  │ React 前端 (Vite)     │  │ Python Sidecar (FastAPI)     │  │
│  │                       │  │                             │  │
│  │  TipTap 3.x 编辑器    │──HTTP──?  LangGraph Agent       │  │
│  │  (ProseMirror JSON)   │  │   127.0.0.1:9876           │  │
│  │  AI 浮窗 (BubbleMenu) │  │                             │  │
│  │  A4 分页预览          │  │  FastAPI 路由                │  │
│  │  AI 输入 (@ / /)      │  │  ┌─────────────────────────┐ │  │
│  └──────────┬────────────┘  │  │ POST /api/ai/edit       │ │  │
│             │               │  │ POST /api/parse          │ │  │
│  ┌──────────┴────────────┐  │  │ POST /api/export/pdf     │ │  │
│  │ Tauri Rust 层          │  │  │ POST /api/projects/...  │ │  │
│  │                        │  │  │ GET  /api/config         │ │  │
│  │  ├── 启动 Python       │  │  └─────────────────────────┘ │  │
│  │  ├── 文件选择器         │  │                             │  │
│  │  ├── 进程生命周期管理    │  │  Data Flow:                 │  │
│  │  └── 本地文件读写       │  │  ProseMirror JSON ? Python  │  │
│  └────────────────────────┘  └─────────────────────────────┘  │
│                                                              │
│  通信方式:                                                   │
│  前端 ? Python: HTTP (localhost)                             │
│  文件操作: Tauri Rust Command (安全沙箱)                       │
│  数据格式: 统一的 ProseMirror JSON                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 启动流程

```
1. 用户启动 TypeDance
2. Tauri 读取 ~/.typedance/config.toml
3. Tauri 启动 Python 子进程 (sidecar): python backend/main.py --port 9876
4. Python 服务加载 config.toml，初始化 LLM Provider
5. 扫描 ~/.typedance/plugins/ 加载所有插件（commands / agents / skills / hooks）
6. React 前端加载，连接 Python API
7. 读取已有文档列表，初始化 TipTap 编辑器
8. 编辑器加载 ProseMirror JSON，渲染 Block 树
```

---

## 4. 核心设计：文档模型

### 4.1 设计理念

文档不再预设固定的结构化字段，而是采用 **ProseMirror JSON** 作为核心文档模型。这与 Notion 的设计哲学一致：

> 用户操作 Block → 直接产生富文本 JSON → 渲染/导出

**优势：**

- ? 用户可自由增删任意模块（技能/语言/章节等），不受字段限制
- ? 用户可调字体大小、加粗、颜色等（TipTap Marks 原生支持）
- ? 模板 = 预设的 Block 结构 + 样式表
- ? AI 修改 = 定位到选中的 Range 操作，不关心语义
- ? 内容与样式统一，所见即所得
- ? 无需后端 Pydantic 模型，编辑器原生格式即存储格式

### 4.2 文档数据格式

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1, "textAlign": "center" },
      "content": [
        { "type": "text", "marks": [{ "type": "bold" }], "text": "张三" }
      ]
    },
    {
      "type": "paragraph",
      "attrs": { "textAlign": "center" },
      "content": [
        { "type": "text", "text": "zhangsan@email.com | 138-0000-0000" }
      ]
    },
    {
      "type": "horizontalRule"
    },
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "Work Experience" }]
    },
    {
      "type": "bulletList",
      "content": [
        {
          "type": "listItem",
          "content": [
            {
              "type": "paragraph",
              "content": [{ "type": "text", "text": "重构了订单查询接口" }]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 5. 功能需求

### 5.1 文档解析

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Markdown 解析 | 解析 Markdown → ProseMirror JSON | P0 |
| PDF 解析 | 提取 PDF 文本，AI 辅助整理为 ProseMirror JSON | P0 |
| 空模板 | 初始化为空的 Block 结构（含示例内容） | P1 |
| 多文档管理 | 支持创建/切换/删除多份文档 | P1 |

### 5.2 富文本编辑（Notion 风格）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| TipTap 3.x 编辑器 | 基于 TipTap 3.x 的所见即所得编辑器 | P0 |
| Block 级操作 | 悬停显示拖拽手柄，支持拖动调整 Block 顺序 | P0 |
| 富文本格式 | 字体大小、加粗/斜体、颜色、列表、标题级别等 | P0 |
| 自由增删模块 | 用户任意添加/删除 Block 组，无需预设 | P0 |
| `/` 命令菜单 | 输入 `/` 触发插入命令（类似 Notion） | P1 |
| A4 分页线 | 编辑器宽度 = A4，每 297mm 显示分页线 + 页码 | P0 |
| 撤销/重做 | 完整的 Undo/Redo 历史 | P0 |

### 5.3 AI 辅助浮窗（核心交互）

用户选中一段文字后，通过 TipTap 3.x 的 BubbleMenu 弹出 AI 浮窗；浮窗内的**输入框**支持 `@` 和 `/` 两种高级交互。

```
┌─────────────────────────────────────────────────────────────┐
│  ? AI 助手                                                 │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 帮我优化这段 @~/my-project 使用 /code-project          │  │  ← 输入框
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  [润色] [扩写] [缩写] [更专业] [量化]  [+ 更多预设]           │
│                                                              │
│  ──────────────────────────────────────────────────────      │
│  ?? 已在 @~/my-project 中检索到相关代码：                     │
│  "重构了订单查询接口，引入 Redis 缓存层..."               │
│                                                              │
│  [? 接受]    [? 重新生成]                                    │
└─────────────────────────────────────────────────────────────┘
```

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 选中浮窗 | 选中文字自动弹出 AI 浮窗 | P0 |
| 预设快捷按钮 | 润色/扩写/缩写/更专业/量化 等一键操作 | P0 |
| @ 引用文件/文件夹 | 输入 @ 选择本地路径，注入 Agent 上下文 | P0 |
| / 调用 Skill | 输入 / 选择 Skill 命令，注入分析策略 | P0 |
| 自定义指令输入 | 纯文本自由输入指令 | P0 |
| 流式输出 | AI 回复实时显示（SSE） | P0 |
| 接受/重新生成 | 用户确认或拒绝 AI 建议 | P0 |
| 多轮对话 | 浮窗内持续对话直到满意 | P1 |

### 5.4 @ 和 / 交互设计（核心交互）

AI 输入框使用 `contentEditable div`，支持富文本 badge 的插入。

| 语法 | 对标产品 | 用途 | 触发方式 |
|------|---------|------|---------|
| `@` | Cline VS Code 插件 | 引用本地文件/文件夹，注入文件内容 | 输入 @ 弹出路径选择器 |
| `/` | Claude Code | 调用 Skill 命令，注入分析策略 | 输入 / 弹出命令选择器 |

#### 5.4.1 概述

AI 输入框使用 `contentEditable div`，支持富文本 badge 的插入。

| 语法 | 对标产品 | 用途 | 触发方式 |
|------|---------|------|---------|
| `@` | Cline VS Code 插件 | 引用本地文件/文件夹，注入文件内容 | 输入 @ 弹出路径选择器 |
| `/` | Claude Code | 调用 Skill 命令，注入分析策略 | 输入 / 弹出命令选择器 |

#### 5.4.2 @ 引用（对标 Cline）

```
用户输入 @
    │
    ▼
弹出引用选择器
    ├── 文件浏览器 (目录树)
    ├── 最近使用路径缓存
    ├── 手动输入路径 + Tab 补全
    └── [浏览文件夹...] → Tauri 原生文件对话框
    │
    ▼
插入 badge → <span class="mention-badge mention-file">@~/my-project</span>
    │
    ▼
发送时 → 解析 badge → 读取文件/目录内容 → 注入 Agent context
```

支持的 @ 类型：

| 语法 | 示例 | 行为 |
|------|------|------|
| `@路径/文件` | `@~/project/src/utils.ts` | 读取该文件内容 |
| `@路径/文件夹` | `@~/project/` | Agent 自主探索目录 |
| `@url:链接` | `@url:https://example.com` | Fetch URL（未来） |

#### 5.4.3 / 命令（对标 Claude Code）

```
用户输入 /（行首或空格后）
    │
    ▼
弹出命令选择器
    ├── 内置命令 (backend/commands/)
    │   └── code-project: 分析代码项目
    ├── 插件贡献的命令 (plugins/*/commands/)
    └── 用户自定义 (~/.typedance/skills/)
    │
    ▼
插入 badge → <span class="mention-badge mention-cmd">/code-project</span>
    │
    ▼
发送时 → 加载对应命令/SKILL.md 内容 → 注入 Agent system prompt
```

/ 命令的文件格式（YAML frontmatter + Markdown）：

```markdown
---
name: code-project
description: 分析代码项目，提取可用于简历的技术成就描述
argument-hint: [项目路径]
---

# 代码项目分析

## 分析策略
1. 先看 README / package.json，了解项目定位
2. 识别技术栈：读取依赖配置文件
3. 寻找用户描述涉及的功能模块的相关代码
4. 关注量化指标：性能优化、规模、代码变更

## 输出要求
- 技术栈要准确，不编造
- 区分"个人贡献"和"团队协作"
- 优先提取可量化的成就
```

#### 5.4.4 前后端数据流

```typescript
// 前端发送
POST /api/ai/edit
{
  "selected_text": "负责后端API开发",
  "surrounding_blocks": [...],
  "message": "帮我根据 优化这段经历，使用",
  "refs": {
    "paths": [
      { "type": "folder", "path": "~/projects/api-server" }
    ],
    "commands": ["code-project"]
  }
}

// 后端处理
1. 解析 commands → 加载对应的 SKILL.md → 注入 Agent system prompt
2. 解析 paths → Explorer Node 读取文件 → 生成上下文摘要
3. combine: 选中文本 + 上下文 + 项目摘要 + Skill 策略
4. LLM → Writer Node → Reviewer Node → 返回结果
```

### 5.5 本地文件探索

用户在编写内容时，可以通过 `@` 关联本地文件或文件夹，Agent 自主探索并提取关键信息。

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 关联路径选择 | Tauri 文件选择器 + 手动输入 | P0 |
| 自主探索 | Agent 自动浏览目录结构、读取关键文件 | P0 |
| 技术栈识别 | 自动识别项目技术栈 | P0 |
| 代码搜索 | 搜索与描述相关的关键词 | P1 |
| Git 历史分析 | 读取 commit log | P1 |
| 多路径关联 | 一次操作关联多个路径 | P1 |
| 缓存索引 | 缓存分析结果 | P2 |

**Agent 工作流：**

```
用户发送 AI 请求
    │
    ▼
Orchestrator Node (LangGraph)
  ├─ 有 @paths? ──否──? Writer Node (直接处理)
  │
  └─ 是 ──? Explorer Node (循环)
                ├── list_directory()
                ├── read_file()
                ├── search_files()
                ├── get_tech_stack()
                └── [模型自主决定]
       │
       ▼
    Writer Node (选中文本 + @paths + /command + 指令 → 输出)
       │
       ▼
    Reviewer Node (检查准确度/专业度/量化 → 不过关返回 Writer)
       │
       ▼
    返回前端 → 替换选中 Range
```

### 5.6 PDF 导出

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 所见即所得 | 导出结果与编辑器预览完全一致 | P0 |
| 分页控制 | ProseMirror JSON → HTML → WeasyPrint PDF | P0 |
| 字体嵌入 | 西文 Inter + 中文 fallback | P1 |
| 多模板 | 通过 CSS 切换多套 PDF 样式 | P2 |

### 5.7 模板系统（V2 目标）

```
Template = 初始 ProseMirror JSON + CSS 样式表
~/.typedance/templates/
├── resume-classic/
│   ├── template.json
│   └── style.css
├── resume-modern/
│   ├── template.json
│   └── style.css
└── novel/
    ├── template.json
    └── style.css
```

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 预设模板 | 初始提供 2-3 套 | P2 |
| 用户自定义模板 | 用户保存自己的 Block 结构 + CSS | P3 |
| 模板市场 | 社区分享模板 | P3 |

---

## 6. 多 Agent 协作与长任务

### 6.1 设计目标

用户可以让 Agent 自主完成长时间、多步骤的任务而不中断。例如：
- 阅读 10 个关联项目，综合分析后写一份简历
- 对多个文档进行批量润色和格式化
- 根据大量素材进行头脑风暴和内容组织

关键能力：
- 主 Agent 拆解任务 → spawn 子 Agent 并行处理
- 任务状态 checkpoint 到磁盘，app 重启可恢复
- 前端通过 SSE 实时查看进度
- 支持暂停、取消、查看中间结果

### 6.2 参考设计

综合六个系统的多 Agent 模式：

| 系统 | 子 Agent 机制 | 长任务支持 |
|------|-------------|-----------|
| Claude Code | Task tool + background:true + worktree 隔离 | 后台执行不阻塞主对话 |
| Codex CLI | spawn_agent + wait_agent + close_agent | 超时控制，独立上下文 |
| Deer Flow | LangGraph Subgraph + 线程池 + SSE | 3 并发，15 分钟超时，checkpoint |
| Kimi Agent Swarm | CreateSubagent + Task tool + 256K 上下文 | main 15 steps / sub 100 steps |
| MiniMax Mini Agent | Agent() SDK 实例化 + run_in_background | max_steps + token_limit + 轮询 |
| TypeDance（我们） | LangGraph Checkpointer + Task Tool + SSE | **原生 Checkpoint，可运行数小时** |

### 6.3 架构

用户发起长任务 → FastAPI POST /api/ai/edit → 主 Agent (Orchestrator Node) → 拆解任务 → spawn 子 Agent 池 → 全部完成 → 主 Agent 整合 → Writer/Reviewer → SSE 返回结果

### 6.4 LangGraph Checkpointer

LangGraph 原生支持 Checkpointing，是长任务能力的基石：

```python
from langgraph.checkpoint.sqlite import SqliteSaver

checkpointer = SqliteSaver.from_conn_string("checkpoints.db")
graph = workflow.compile(checkpointer=checkpointer)

# 首次执行
thread_id = "task-resume-123"
config = {"configurable": {"thread_id": thread_id}}

# 用户关闭 app，进程退出
# ... 重新打开 app ...

# 从上次中断处恢复
for event in graph.astream(input, config):
    pass  # 自动跳过已完成的 Node
```

Checkpoint 存储内容：AgentState、已完成节点、下次执行位置、时间戳

### 6.5 Task Tool

主 Agent 通过 Task Tool spawn 子 Agent：

```python
class TaskTool(BaseTool):
    name = "task"
    description = "创建一个子 Agent 执行独立任务"
    
    async def _run(self, agent_type, prompt, context=None, timeout=3600):
        # 1. 创建独立的 Agent State
        # 2. 在后台线程运行子 Graph
        # 3. 通过 SSE 推送进度事件
        # 4. 超时自动终止
        # 5. 返回 task_id
```

### 6.6 并发与超时

- 最多 3 个子 Agent 同时运行
- 每个子 Agent 24 小时超时
- 使用 asyncio.Semaphore 控制并发

### 6.7 进度汇报（SSE）

前端通过 SSE 接收实时进度：
- task_started / subagent_started / subagent_running
- subagent_completed / task_completed

前端 UI 展示每个子 Agent 的状态（待宜/进行中/已完成/排队中）

### 6.8 用户控制

| 操作 | 实现 |
|------|------|
| 取消任务 | DELETE /api/tasks/{task_id} |
| 查看进度 | GET /api/tasks/{task_id}/status |
| 暂停/继续 | POST /api/tasks/{task_id}/pause + /resume |
| 查看中间结果 | GET /api/tasks/{task_id}/partial |
## 7. 插件系统（核心扩展能力）

TypeDance 的插件系统综合了 **Claude Code** 和 **Codex CLI** 的设计哲学——一切能力都是文件，插件即目录。

### 7.1 插件目录结构

```
~/.typedance/plugins/
└── my-plugin/
    ├── .typedance-plugin/
    │   └── plugin.json              ← 插件清单（必选）
    ├── commands/                     ← / 命令贡献
    │   └── my-command.md            ← Markdown + YAML frontmatter
    ├── agents/                       ← 子 Agent 定义
    │   └── my-agent.md
    ├── skills/                       ← 技能知识
    │   └── my-skill/
    │       ├── SKILL.md
    │       ├── references/
    │       └── templates/
    ├── hooks/
    │   └── hooks.json                ← 事件钩子
    ├── assets/                        ← 图标/截图
    └── README.md
```

### 7.2 插件清单 (plugin.json)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件描述",
  "author": {
    "name": "作者",
    "url": "https://..."
  },
  "commands": "./commands/",
  "agents": "./agents/",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "我的插件",
    "category": "Writing",
    "logo": "./assets/icon.png",
    "brandColor": "#000000"
  }
}
```

所有组件路径均为可选字段。组件也可放在默认路径（commands/ / agents/ / skills/）而不在 plugin.json 声明，系统自动发现。

### 7.3 五组件设计

| 组件 | 来源 | 作用 |
|------|------|------|
| **commands/** | Claude Code + Codex CLI | 贡献 `/` 命令，每个命令 = 一个 Markdown 文件 + YAML frontmatter |
| **agents/** | Claude Code + Codex CLI | 定义子 Agent，处理特定场景（审校/分析/翻译等） |
| **skills/** | Claude Code + Codex CLI | 领域知识注入，Agent 在执行命令时引用的专业知识 |
| **hooks/** | Claude Code 独有 | 生命周期事件钩子（AI 修改前/后、导出前/后等） |
| **assets/** | Codex CLI 独有 | 品牌资源（图标、截图、品牌色），Marketplace 展示用 |

### 7.4 Hooks 事件系统（借鉴 Claude Code）

```json
// hooks/hooks.json
{
  "hooks": [
    {
      "event": "pre-edit",
      "handler": {
        "type": "command",
        "command": "load-context"
      }
    },
    {
      "event": "post-edit",
      "handler": {
        "type": "script",
        "command": "python check_diff.py"
      }
    },
    {
      "event": "pre-export",
      "handler": {
        "type": "prompt",
        "prompt": "为导出文档添加页眉页脚"
      }
    }
  ]
}
```

| 事件 | 触发时机 | 用途举例 |
|------|---------|---------|
| `pre-edit` | AI 修改执行前 | 自动加载选中段落的上文 |
| `post-edit` | AI 修改完成后 | 检查 diff，记录变更 |
| `pre-export` | PDF 导出前 | 补充页眉页脚、目录 |
| `post-export` | PDF 导出后 | 打开系统 PDF 查看器 |

### 7.5 Marketplace 机制（借鉴 Codex CLI）

```json
// ~/.typedance/plugins/marketplace.json
{
  "source": "typedance-curated",
  "plugins": [
    {
      "name": "resume-skills",
      "source": { "type": "local", "path": "./plugins/resume-skills" },
      "policy": { "installation": "AVAILABLE" },
      "category": "Writing"
    },
    {
      "name": "tech-writing",
      "source": { "type": "github", "url": "https://github.com/..." },
      "policy": { "installation": "ONE_CLICK" },
      "category": "Writing"
    }
  ]
}
```

### 7.6 插件加载流程

```
TypeDance 启动
    │
    ▼
扫描 ~/.typedance/plugins/
    │
    ├── 读取每个目录下的 .typedance-plugin/plugin.json
    ├── 发现 commands/ → 注册为可用的 / 命令
    ├── 发现 agents/ → 注册子 Agent
    ├── 发现 skills/ → 注册技能知识
    └── 发现 hooks/hooks.json → 注册事件钩子
    │
    ▼
合并内置组件 + 所有插件的组件
    │
    ▼
用户输入 / → 显示所有插件贡献的命令
用户输入 @ → 访问本地文件系统
AI 请求 → Agent 自动选择可用 Agent 和 Skill
```

---

## 8. 用户目录结构 (~/.typedance/)

```
~/.typedance/
├── config.toml              ← LLM 配置 + 编辑器偏好
├── data/
│   ├── documents/           ← 用户文档 (ProseMirror JSON)
│   │   └── *.json
│   └── projects/            ← 文件探索缓存
│       └── *.cache.json
├── plugins/                  ← 用户安装的插件
│   ├── marketplace.json     ← 插件市场索引
│   └── resume-skills/
│       └── .typedance-plugin/
│           └── plugin.json
├── skills/                   ← 用户自定义 skills（覆盖/追加内置）
│   └── code-project/
│       └── SKILL.md
├── templates/               ← 用户自定义模板 (V2)
│   ├── resume-modern/
│   │   ├── template.json
│   │   └── style.css
└── logs/
    └── agent.log
```

---

## 9. 配置文件 (~/.typedance/config.toml)

```toml
# TypeDance 配置文件
# 支持环境变量注入: api_key = "$OPENAI_API_KEY"

[llm]
provider = "openai"        # openai / deepseek / ollama / custom
model = "gpt-4o"
api_key = ""
base_url = "https://api.openai.com/v1"
temperature = 0.7
max_tokens = 4096

[editor]
font_family = "Inter, -apple-system, 'Microsoft YaHei', sans-serif"
language = "zh-CN"
page_size = "A4"

[agent]
max_tool_calls = 30
auto_review = true
max_context_length = 8000

[storage]
data_dir = "~/.typedance/data"

[plugins]
dir = "~/.typedance/plugins"
auto_discover = true
```

---

## 10. 非功能需求

### 10.1 性能

- Python 后端启动时间 < 3 秒
- 首次文件探索时间 < 30 秒（中等规模，< 500 文件）
- AI 回复应支持流式输出（SSE）
- 编辑器响应无显著延迟

### 10.2 可用性

- 支持中英文混合编辑
- 自动保存（用户输入后 3 秒自动保存）
- 操作可撤销（Ctrl+Z）
- 明确的错误提示

### 10.3 安全性

- 本地文件仅用于 AI 上下文，不上传到外部存储
- API Key 通过环境变量注入

### 10.4 扩展性

- LLM Provider 可配置扩展
- 插件系统命令/Agent/Skill/Hook 均可扩展
- 模板系统中后期加入不影响架构
- PDF 样式完全由 CSS 控制

---

## 11. API 路由设计

| 方法 | 路由 | 描述 |
|------|------|------|
| POST | `/api/parse` | 解析文档 (Markdown/PDF) → ProseMirror JSON |
| POST | `/api/ai/edit` | AI 修改选中文本（含 @paths + /commands） |
| GET  | `/api/ai/stream` | SSE 流式 AI 对话 |
| GET  | `/api/documents` | 获取文档列表 |
| GET  | `/api/documents/:id` | 获取单份文档 |
| PUT  | `/api/documents/:id` | 保存文档 (ProseMirror JSON) |
| POST | `/api/export/pdf` | 导出 PDF |
| GET  | `/api/config` | 读取配置 |
| PUT  | `/api/config` | 更新配置 |
| POST | `/api/files/explore` | 探索本地文件/文件夹 |
| GET  | `/api/plugins` | 列出已安装插件 |
| GET  | `/api/plugins/:name` | 获取插件详情 |
| GET  | `/api/skills` | 列出可用 skills（含插件贡献） |
| GET  | `/api/skills/:name` | 获取单个 SKILL.md 内容 |
| GET  | `/api/commands` | 列出可用 / 命令（含插件贡献） |

---

## 12. 前端组件树

```
src/components/
├── DocumentEditor.tsx       ← TipTap 3.x 编辑器主体
│   └── extensions/
│       ├── StarterKit
│       └── BubbleMenu       ← 选中文字弹出
├── AIFloatingMenu.tsx       ← BubbleMenu 内渲染的 AI 浮窗
│   ├── AIInput/             ← 支持 @ 和 / 的输入框
│   │   ├── AIInput.tsx      ← contentEditable 输入框
│   │   ├── AtMentionPopover.tsx    ← @ 文件选择器
│   │   ├── SlashCommandPopover.tsx ← / 命令选择器
│   │   └── types.ts         ← Badge, Ref 类型
│   ├── PresetButtons.tsx    ← 预设快捷操作按钮
│   ├── AIResponse.tsx       ← AI 回复展示区（流式）
│   └── AIDialog.tsx         ← 完整对话面板（多轮）
├── PluginManager.tsx        ← 插件管理界面
├── FileSelector.tsx         ← 关联文件/文件夹选择器
└── PagePreview.tsx          ← A4 分页预览
```

---

## 13. 开发路线图

### Phase 1: 后端基础设施

- 项目初始化（目录结构、pyproject.toml）
- config.toml 读写服务
- LLM Service (多 Provider 适配)
- Document CRUD (ProseMirror JSON 存储)
- FastAPI 基础路由
- 插件目录扫描与组件加载

### Phase 2: LangGraph Agent

- Agent 状态模型（含 @paths + /commands 解析）
- Explorer Node (文件工具集)
- Writer Node (文档写作)
- Reviewer Node (自审)
- Workflow (StateGraph) 串联
- Skill 注入机制（SKILL.md → system prompt）

### Phase 3: 前端 + Tauri

- Tauri 2 项目脚手架
- Python Sidecar 启动/关闭管理
- React + TipTap 3.x 编辑器集成
- AI 浮窗 + 输入组件（@ + /）
- A4 分页预览组件
- 文件/文件夹选择器

### Phase 4: PDF 导出 & 集成

- ProseMirror JSON → HTML → PDF 渲染链
- PDF 导出 API
- 前后端联调
- Skill / Hook 详细实现
- 用户体验打磨

---

## 14. 参考项目

| 项目 | 参考重点 |
|------|---------|
| [OpenAI Codex CLI](https://github.com/openai/codex) | 系统提示词分层设计、Tool Schema、插件系统（plugin.json / skills / marketplace） |
| [OpenCode](https://github.com/opencode-ai/opencode) | 层次化任务分解、思考链、自审机制 |
| [OpenCLAW](https://github.com/Canner/openclaw) | 多 Agent 协作模式、工具系统设计 |
| [Deer-Flow](https://github.com/bytedance/deer-flow) | Skill 目录结构(SKILL.md)、LangGraph 集成、pyproject.toml |
| [TipTap 3.x](https://tiptap.dev) | BubbleMenu、Block 级编辑、ProseMirror JSON 数据模型 |
| [Claude Code](https://github.com/anthropics/claude-code) | 插件系统（commands/agents/hooks）、/ 命令 frontmatter |
| [Cline](https://github.com/cline/cline) | @ 引用文件/文件夹的设计模式 |

