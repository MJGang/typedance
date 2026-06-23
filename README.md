# TypeDance

> 本地优先的 AI-native Office 文档工作台，让 AI、上下文、画布和导出成为文档生产的原生能力。

TypeDance 的目标不是做一个简历改稿工具，而是做一个原生支持 AI 的 Office 文档工作台。

它首先要提供通用文档底座：文档画布、上下文、AI 协作、模板排版、导出、版本和本地安全。在这个底座之上，再通过 Skill、Plugin 或 Workflow 支持不同写作场景，例如简历、小说、周报、述职材料、晋升材料、项目总结、求职信等。

当前仓库优先实现的是 Resume Pack。它是第一个验证场景，用来验证 TypeDance 的通用 Office 底座能力，而不是产品边界。

## 背景

现有 AI 文档工具有几个明显断点：

- 很多 AI 简历或写作工具要求用户把旧简历、项目资料、工作记录等敏感内容上传到云端，资料安全和上下文使用边界不透明；
- Codex、Claude Code 等通用 AI 工具虽然具备强上下文理解能力，但不面向正式文档生产，缺少文档画布、场景化 Skill/Plugin/Workflow、模板排版和 PDF/HTML 导出闭环；
- 单一聊天框很难承载不同类型文档的完整流程，写简历、写小说、写周报、写述职材料需要完全不同的结构、上下文和交付方式；
- 用户最终要的不是一段 AI 生成文本，而是一份可以继续编辑、确认、排版和交付的正式文档。

TypeDance 解决的是这个断点：把 AI、上下文、文档画布和交付格式组织进同一个本地优先的 Office 工作台。

## 后续迭代导向

当前代码里仍然存在 Resume Pack 这样的场景化组织方式，但后续产品方向不应继续把每类文档都做成一个独立 Pack 产品。

更合适的方向是构建一个通用 AI-native Office 底座：

- 文档画布、编辑体验、模板排版、版本和导出属于通用 Office 能力；
- 本地文件、文件夹、网页链接、导入文档等上下文属于通用工作台能力；
- Agent Host、Harness Runtime、工具调用、事件流、模型设置属于通用 AI 协作能力；
- 简历、小说、周报、述职、晋升材料、项目总结等场景通过 Skill、Plugin 或 Workflow 扩展；
- Resume 能力应逐步从“一个独立 Pack”收敛为内置 Resume Skill/Plugin/Workflow、简历模板和简历诊断工具。

也就是说，TypeDance 的长期心智应该是“原生支持 AI 的 Office”，而不是“很多 Pack 的集合”。Pack 可以保留为内部组织或兼容概念，但不应成为用户理解产品的核心入口。

## Pack 抽象

Document Pack 是当前阶段用于组织场景能力的内部抽象。

一个 Pack 可以定义：

- 文档需要哪些资料来源；
- 文档内部有哪些结构化对象；
- Agent 可以使用哪些工具；
- 用户在哪个画布里编辑；
- 哪些内容需要证据、确认、风险提示或版本记录；
- 最终支持哪些模板和导出格式。

底层工作台、Agent Runtime、上下文系统、插件系统和导出能力可以被不同 Pack 复用；但后续迭代应逐步把通用能力上移到 Office 底座，把场景差异下沉到 Skill、Plugin 或 Workflow。

## 当前实现

当前代码已经围绕 Resume Pack 实现了一条完整桌面链路：

- 工作台列表：创建、打开、删除文档工作台；
- 导入入口：支持旧简历导入和新建简历；
- 文档画布：基于 TipTap 编辑 source resume canvas，并自动保存；
- 上下文系统：支持本地文件、本地文件夹、网页链接和导入文档作为上下文；
- AI 对话：支持工作区会话、多轮消息、流式事件、停止运行和模型设置；
- 画布反馈：接收 Agent 产生的 canvas patch 事件，并高亮受影响的 canvas node、source block 或 module；
- 模板与导出：支持样式配置，并导出 PDF/HTML；
- 插件入口：工作区可加载 Pack 对应的 Agent 插件。

这些能力是 Resume Pack 先用起来，但目标是沉淀为通用 Office 能力，再服务更多 Skill、Plugin 和 Workflow。

## 上下文

TypeDance 把上下文作为工作台能力，而不是一次性 Prompt 拼接。

当前上下文来源包括：

- 本地文件；
- 本地文件夹；
- 网页链接；
- 导入文档；
- 用户在对话中补充的事实、偏好和任务要求。

本地文件和文件夹以只读引用的方式加入工作台。移除上下文只是解除引用，不会删除用户真实文件。Agent Host 在运行时按工作区和用户提及加载上下文，让 AI 基于授权资料协作，同时保留资料来源边界。

## 架构

TypeDance 当前采用多进程桌面架构：

- Web 前端：React、TypeScript、Vite、TipTap、shadcn/ui，负责工作台、画布、对话、上下文和模板界面；
- Tauri Desktop：负责桌面壳、窗口生命周期、本机路径选择、发布运行时和外部二进制进程管理；
- Agent Host：Node.js 服务，负责对话、模型调用、Agent Run、SSE 事件流、插件加载、模型设置和 Prompt 组装；
- Harness Core：通用 Agent Runtime，负责 run lifecycle、event log、tool registry、plugin registry、permission engine、memory、verification 和多轮工具调用循环；
- Python Sidecar：FastAPI 服务，负责本机文件、SQLite 数据、文档导入、上下文读取、画布初始化、结构化文档对象和 PDF/HTML 导出；
- Shared Contracts：用共享 schema 约束前后端对象，减少跨进程接口漂移。

这套边界的目的，是让文档业务、AI 编排、本机资源访问和桌面发布各自独立演进。

## 结构化对象

TypeDance 不把 AI 输出只保存成聊天文本。

当前 Sidecar 已经有这些核心对象：

- `Document`
- `SourceDocument`
- `SourceResumeCanvas`
- `DraftVersion`
- `DocumentModule`
- `DocumentClaim`
- `EvidenceLink`
- `RevisionIssue`
- `RevisionProposal`
- `UserConfirmation`
- `RenderProjection`
- `ExportArtifact`
- `ContextSource`
- `WorkspaceView`

这些对象让 Pack 能表达：资料从哪里来、当前文档是什么状态、AI 发现了什么问题、建议改哪里、依据是什么、是否需要用户确认、最终导出了什么文件。

## 发布

TypeDance 当前面向 Windows 桌面端发布。

发布链路包括：

- pnpm monorepo 统一测试和构建；
- Node SEA 打包 Agent Host 与 Markdown Converter；
- PyInstaller 打包 Python Sidecar；
- Tauri NSIS 安装包构建；
- Playwright Chromium 资源打包；
- 版本一致性校验；
- 敏感文件扫描，避免 `.env`、密钥、数据库等进入发布输入；
- 运行时健康检查和安装包冒烟测试；
- SHA-256 产物校验。

目标是让用户不需要准备 Node、Python 或源码仓库，也能运行完整的本地 AI 文档工作台。
