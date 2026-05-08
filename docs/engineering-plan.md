# TypeDance V1 工程架构与实施计划

> 版本: v0.1
> 日期: 2026-05-08
> 输入来源: `docs/requirements.md`, `docs/product-vision.md`
> 目标: 将 V1 产品需求转成可实施、可验收、可并行拆分的工程计划。

---

## 1. 范围挑战

完整 V1 不是一个单次实现任务。它同时包含桌面壳、富文本编辑、PDF 导出、岗位解析、证据库、受控资料读取、AI 改写、权限、Review Gate、联网语言校准和 checkpoint 恢复。如果按平台能力横向铺开，会过早引入过多服务、状态和 UI 面。

工程计划采用“双层范围”：

- **架构蓝图覆盖完整 V1**：保证数据关系、权限边界、AI Run 状态机和导出链路一开始就是一致的。
- **实施按用户闭环切片推进**：每个 slice 都必须交付可演示价值，先让用户能编辑并导出 PDF，再逐步加入岗位、证据和 AI。

最小可实施路径：

```text
Slice 0: App Foundation
  |
  v
Slice 1: Editable Resume to PDF
  |
  v
Slice 2: Job Target Loop
  |
  v
Slice 3: Evidence Vault Loop
  |
  v
Slice 4: AI Rewrite Loop
  |
  v
Slice 5: Quality & Review Gate
  |
  v
Slice 6: Language Calibration
  |
  v
Slice 7: Checkpoint Polish
```

V1 的第一条工程铁律：任何底层抽象如果不能直接服务当前 slice 的可投递简历闭环，就延后。

---

## 2. 架构原则

1. **本地优先**：用户资料、简历版本、证据卡、运行状态默认存储在 `~/.typedance/`。
2. **证据先于生成**：AI 建议必须引用 Evidence Card 或明确标记为推断/需确认。
3. **用户确认云端上下文**：每次云端 LLM 调用前展示选中文本、JD 摘要、证据片段、来源和风险。
4. **外部背景不可证明用户经历**：联网搜索只能生成 External Background，不能进入用户经历 Evidence Card。
5. **AI 不直接覆盖简历**：AI 只能生成建议，用户接受后才写入 Resume Version。
6. **PDF 走受控渲染管线**：导出只渲染当前简历版本的显式内容，不直接把编辑器 DOM 当最终产物。
7. **失败可见、可恢复**：任何读取、生成、验证、导出失败都必须进入明确状态，并给用户可理解的救援动作。

Context7 校验备注：Tauri 2 官方文档确认 sidecar 可通过 shell plugin 管理，插件权限可限制文件系统读写范围；工程计划据此把 Tauri 层定位为桌面壳、权限入口和 sidecar 管理层，而不是业务逻辑层。

---

## 3. 总体架构

```text
Tauri Desktop Shell
  |
  |  invoke: OS commands, dialogs, app paths, sidecar lifecycle
  v
React + Vite + TypeScript App
  |
  +--> TipTap 3.x Editor
  |      |
  |      +--> AI Floating Panel
  |      +--> A4 Preview
  |
  +--> Job Target UI
  +--> Evidence Vault UI
  +--> Quality Dashboard
  +--> Review Gate UI
  |
  |  HTTP/SSE over localhost
  v
FastAPI Sidecar
  |
  +--> Domain API
  +--> Permission Manager
  +--> Skill Runtime
  |      |
  |      +--> Markdown Reader
  |      +--> PDF Reader
  |      +--> Folder / Code Reader
  |
  +--> AI Pipeline
  |      |
  |      +--> Evidence Workers
  |      +--> External Background Worker
  |      +--> Main Resume Agent
  |      +--> Evidence/Risk Validator
  |
  +--> PDF Rendering Pipeline
  +--> Local SQLite + File Store
  +--> LLM Provider Adapter
```

### 3.1 进程边界

| 层 | 职责 | 明确不做 |
| --- | --- | --- |
| Tauri Rust | 桌面窗口、安装包、系统路径、文件选择器、sidecar 启停、最小 OS 权限桥 | 简历业务规则、AI 编排、资料解析 |
| React App | 编辑体验、A4 预览、交互状态、AI 浮窗、质量面板、Review Gate 展示 | 长任务执行、敏感文件读取、最终权限判定 |
| FastAPI Sidecar | 领域 API、数据持久化、权限检查、资料解析、AI Run、PDF 管线 | 桌面安装更新、WebView 生命周期 |
| Skill Runtime | 受控读取资料并产出 Evidence Card | 插件市场、用户自定义 Skill UI、未授权联网 |
| AI Pipeline | 证据压缩、岗位理解、改写建议、风险验证 | 面向用户的多 Agent 平台、无证据编造 |

### 3.2 建议仓库结构

当前仓库只有文档。正式工程落地时建议采用以下结构：

```text
typedance/
  apps/
    desktop/                 # Tauri 2 app and Rust commands
    web/                     # React + Vite + TypeScript frontend
  services/
    sidecar/                 # FastAPI domain API and workers
  packages/
    contracts/               # JSON Schema / generated TS + Python types
    resume-renderer/          # controlled HTML/CSS resume rendering assets
  docs/
    requirements.md
    product-vision.md
    engineering-plan.md
```

`packages/contracts` 是关键边界：Resume Version、Job Target、Evidence Card、AI Edit Run、Review Gate Result 等模型先定义 schema，再生成前端和后端类型，避免 TS/Python/Rust 三层语义漂移。

---

## 4. 数据模型

### 4.1 本地存储

```text
~/.typedance/
  typedance.sqlite
  files/
    sources/
    exports/
    previews/
  cache/
    skill-runtime/
    pdf-render/
  logs/
    app.log
    runs.log
```

SQLite 存结构化对象和索引，文件系统存原始导入文件、导出 PDF、渲染预览和可清理缓存。长期日志只记录结构化摘要和错误类别，不记录未经用户确认的敏感原文。

### 4.2 核心实体

| Entity | 关键字段 | 说明 |
| --- | --- | --- |
| `ResumeVersion` | `id`, `title`, `job_target_id`, `doc_json`, `plain_text_snapshot`, `source_refs`, `accepted_edit_ids`, `created_at`, `updated_at` | 编辑态主对象。`doc_json` 使用 ProseMirror JSON，PDF 导出走受控 HTML/CSS。 |
| `JobTarget` | `id`, `title`, `company`, `jd_raw`, `jd_summary`, `keywords`, `salary_range`, `seniority`, `interest_level`, `created_at` | 轻量岗位模型，不做投递 CRM。 |
| `EvidenceSource` | `id`, `type`, `display_name`, `uri`, `permission_grant_id`, `hash`, `read_status`, `error_summary` | 用户资料来源或目标 JD。 |
| `EvidenceCard` | `id`, `source_id`, `source_type`, `locator`, `excerpt`, `summary`, `confidence`, `risk_tags`, `created_by_run_id` | 可引用证据片段。 |
| `PermissionGrant` | `id`, `scope_type`, `scope_uri`, `capabilities`, `expires_at`, `revoked_at` | 路径、联网、模型调用和缓存写入授权。 |
| `AIEditRun` | `id`, `resume_version_id`, `job_target_id`, `command`, `selected_range`, `state`, `input_summary`, `output_summary`, `error_code` | 一次 AI 改写或分析。 |
| `AIEditRunEvent` | `id`, `run_id`, `event_type`, `payload`, `created_at` | 流式输出、状态变化和用户确认记录。 |
| `ExternalBackground` | `id`, `job_target_id`, `source_url`, `summary`, `confidence`, `created_by_run_id` | 只用于语言校准和岗位理解。 |
| `ReviewGateResult` | `id`, `resume_version_id`, `job_target_id`, `status`, `findings`, `created_at` | 导出前质量检查结果。 |
| `PDFExport` | `id`, `resume_version_id`, `review_gate_result_id`, `file_path`, `layout_status`, `created_at` | 一次 PDF 导出记录。 |

### 4.3 对象关系

```text
JobTarget
  |
  +--> ResumeVersion
          |
          +--> AIEditRun
          |       |
          |       +--> AIEditRunEvent[]
          |       +--> EvidenceCard[]
          |       +--> ExternalBackground[]
          |
          +--> ReviewGateResult
                  |
                  +--> PDFExport

PermissionGrant
  |
  +--> EvidenceSource
          |
          +--> EvidenceCard
```

重要约束：

- `ExternalBackground` 不能被引用为用户经历证据。
- `EvidenceCard.source_type = external_web` 仅允许代表岗位/公司背景，不允许代表用户做过的事情。
- `ReviewGateResult.status != pass` 时默认阻止导出，但允许用户在明确风险后强制导出并记录原因。
- `AIEditRun` 的输出必须通过 Evidence/Risk Validator 后才进入“可接受建议”状态。

---

## 5. API 边界

### 5.1 Tauri commands

Tauri commands 只处理 OS 和进程相关能力：

| Command | 用途 |
| --- | --- |
| `get_app_paths` | 返回 app data、cache、log、export 目录。 |
| `start_sidecar` / `stop_sidecar` | 管理 FastAPI sidecar 生命周期。 |
| `check_sidecar_health` | 启动后健康检查。 |
| `select_files` / `select_folder` | 通过系统文件选择器获取用户授权入口。 |
| `open_exported_file` | 调用系统默认应用打开 PDF。 |
| `reveal_in_folder` | 在文件管理器中定位导出文件。 |

文件内容读取、证据提取和权限判定由 sidecar 完成；Tauri 只负责用户显式选择和 OS 桥接。

### 5.2 FastAPI endpoints

| Endpoint | 方法 | 说明 |
| --- | --- | --- |
| `/health` | `GET` | sidecar 健康状态和版本。 |
| `/resume-versions` | `GET/POST` | 列表和创建简历版本。 |
| `/resume-versions/{id}` | `GET/PATCH` | 读取/保存 ProseMirror JSON 和元信息。 |
| `/job-targets` | `GET/POST` | 创建岗位目标，保存 JD 原文。 |
| `/job-targets/{id}/parse` | `POST` | 解析 JD 字段、关键词和基础匹配输入。 |
| `/materials` | `POST` | 添加文件、文件夹、手动文本来源。 |
| `/materials/{id}/extract` | `POST` | 读取资料并生成 Evidence Card。 |
| `/evidence-cards` | `GET` | 按简历、岗位、来源检索证据。 |
| `/ai-runs` | `POST` | 创建 `/tailor-resume` 等动作。 |
| `/ai-runs/{id}` | `GET` | 查询 run 状态和结果。 |
| `/ai-runs/{id}/events` | `GET` | SSE 流式状态和输出。 |
| `/ai-runs/{id}/confirm-context` | `POST` | 用户确认云端发送上下文。 |
| `/ai-runs/{id}/cancel` | `POST` | 取消 run。 |
| `/review-gate/run` | `POST` | 运行导出前质量检查。 |
| `/exports/pdf` | `POST` | 基于通过或强制通过的 Review Gate 导出 PDF。 |

### 5.3 前端状态

前端不把服务端 run state 复制成另一套真相。React 本地状态只保存：

- 当前编辑器 selection 和临时 UI 展开态。
- SSE 流式输出缓存。
- 用户正在确认的上下文预览。
- 乐观保存状态和错误提示。

领域状态以 sidecar 查询结果为准。

---

## 6. 核心流程

### 6.1 简历编辑到 PDF

```text
Create Template / Import Markdown
  |
  v
ResumeVersion.doc_json
  |
  +--> TipTap Editor
  |
  +--> A4 Preview HTML
          |
          v
Review Gate
  |
  v
Controlled HTML/CSS Render
  |
  v
PDFExport
```

验收重点：

- 编辑器保存和预览稳定。
- PDF 导出只包含当前简历显式内容。
- 超页、空简历、字体 fallback、渲染失败都有明确提示。

### 6.2 证据驱动 AI 改写

```text
User selects resume text
  |
  +--> @ JobTarget
  +--> @ EvidenceCard[]
  +--> /tailor-resume
          |
          v
AIEditRun.created
  |
  v
Permission + Context Preview
  |
  v
Main Resume Agent
  |
  v
Evidence/Risk Validator
  |
  v
Suggestion with citations + risks
  |
  +--> Accept -> patch ResumeVersion
  +--> Reject -> close run
  +--> Regenerate -> new run attempt
```

验收重点：

- 没有证据时可以生成建议，但必须降级可信度并标记 `needs_confirmation`。
- 云端调用前必须展示即将发送的上下文。
- 接受建议是用户动作，不是 AI 自动覆盖。

### 6.3 授权联网语言校准

```text
JobTarget
  |
  v
User grants web search
  |
  v
External Background Worker
  |
  v
ExternalBackground
  |
  v
Language calibration hints
```

验收重点：

- 搜索目标、来源链接和时间必须记录。
- 网络失败不阻塞主流程。
- 外部背景只能影响表达风格和岗位理解，不能生成用户经历证据。

---

## 7. AI Run 状态机

```text
created
  |
  v
permission_required --> canceled
  |
  v
queued
  |
  v
running
  |
  +--> waiting_user_confirmation
  |       |
  |       +--> running
  |       +--> canceled
  |
  +--> partial
  |       |
  |       +--> running
  |       +--> failed_retryable
  |       +--> canceled
  |
  +--> failed_retryable --> running
  |
  +--> failed_final
  |
  +--> completed
```

工程建议：

- Slice 1-3 用普通数据库状态和后台任务队列实现，不引入 LangGraph。
- Slice 4 开始将 AI steps 抽象成可 checkpoint 的节点。
- Slice 7 再评估是否正式接入 LangGraph checkpointer；避免在还没有真实复杂 run 前为框架付复杂度成本。

---

## 8. 实施切片

### Slice 0: App Foundation

目标：让桌面壳、前端和 sidecar 可以稳定启动、通信和持久化。

包含：

- Tauri 2 + React/Vite 工程初始化。
- FastAPI sidecar 启动、健康检查、日志目录。
- SQLite 初始化和迁移机制。
- `packages/contracts` 的基础 schema。
- 本地 app data/cache/export 路径约定。

验收：

- 桌面应用启动后自动拉起 sidecar。
- 前端能显示 sidecar 健康状态和版本。
- 重启应用后 SQLite 数据保留。

测试：

- Tauri command 单元测试。
- FastAPI `/health` 测试。
- 端到端启动 smoke test。

### Slice 1: Editable Resume to PDF

目标：用户能编辑一份简历并稳定导出 PDF。

包含：

- 简历模板。
- Markdown 导入。
- TipTap 基础富文本编辑。
- Resume Version 保存。
- A4 预览。
- 受控 HTML/CSS 渲染。
- PDF 导出记录。

不包含：

- AI。
- Evidence Vault。
- Skill Runtime。

验收：

- 一份模板简历可编辑、自动保存、预览和导出。
- PDF 排版稳定，导出失败时保留预览并显示原因。
- 空简历、超页、字体缺失有可理解提示。

测试：

- ProseMirror JSON 保存/读取往返。
- Markdown 导入样例。
- PDF 导出 smoke test。
- A4 页面分页和超页检查。

### Slice 2: Job Target Loop

目标：简历能绑定目标岗位，并看到基础匹配。

包含：

- Job Target CRUD。
- JD 粘贴和字段解析。
- Resume Version 绑定 Job Target。
- 基础匹配评分：关键词覆盖、年限/职级提示、JD 重点要求。
- 至少 3 个岗位版本的管理体验。

不包含：

- 联网公司语言校准。
- 投递状态管理。

验收：

- 同一份简历可派生 3 个岗位版本。
- 每个版本能展示目标岗位、JD 摘要和基础匹配结果。
- 缺少 JD 时禁止运行岗位相关命令，并提示补齐。

测试：

- JD parser 单元测试。
- ResumeVersion 与 JobTarget 关系测试。
- 多版本创建和切换 E2E。

### Slice 3: Evidence Vault Loop

目标：用户资料能转化为可引用 Evidence Card。

包含：

- Evidence Source。
- Permission Grant。
- 手动文本、Markdown、PDF 的资料导入。
- Secret 扫描。
- Evidence Card 生成和检索。
- `.typedanceignore` / `.gitignore` 风格忽略规则的基础支持。

不包含：

- 泛用知识库管理。
- 标签系统。
- 云同步。

验收：

- 用户能导入至少 Markdown、PDF、手动文本并生成 Evidence Card。
- 文件读取失败不会导致 AI 编造缺失事实。
- 检测到疑似 secret 时默认不进入云端上下文。

测试：

- 权限范围校验。
- 文件不存在、编码错误、PDF 无文本等失败路径。
- Secret 扫描样例。
- Evidence Card 去重和来源定位。

### Slice 4: AI Rewrite Loop

目标：AI 能基于证据改写简历，并展示证据链和风险。

包含：

- `/tailor-resume`, `/rewrite-bullet`, `/extract-highlights`, `/gap-analysis` 的最小动作实现。
- AI Edit Run。
- 云端/本地 Provider Adapter。
- Context Preview。
- 流式生成。
- Evidence/Risk Validator。
- 接受、拒绝、重新生成。

不包含：

- 通用聊天助手。
- 面试/求职信。
- 面向用户的 Agent 编排平台。

验收：

- 用户选中 bullet 后可生成带证据引用和风险标记的改写建议。
- 用户拒绝发送云端上下文时 run 停在可理解状态。
- LLM 输出不可解析时不写入编辑器。

测试：

- Provider mock 流式输出。
- Context Preview 内容审计。
- 缺证据主张标记。
- 接受建议后的文档 patch 测试。

### Slice 5: Quality & Review Gate

目标：用户导出前知道这份简历是否能投。

包含：

- Quality Dashboard。
- `/match-jd`。
- `/quality-review`。
- Review Gate。
- 缺证据主张、敏感信息、JD 不匹配、超页、排版异常检查。
- 强制导出确认。

不包含：

- 求职 CRM。
- 投递管理。

验收：

- 导出前能看到可操作问题列表。
- 高风险结果默认阻止导出。
- 强制导出会记录用户确认和风险摘要。

测试：

- Review Gate 规则单元测试。
- 超页和空页样例。
- 敏感信息和无证据主张样例。
- 强制导出审计记录。

### Slice 6: Language Calibration

目标：授权联网后，简历表达更贴近目标公司/岗位语言。

包含：

- 联网授权。
- 搜索目标和来源记录。
- External Background。
- `/company-language-calibration`。
- 低可信来源降级。

不包含：

- 自动登录招聘平台。
- 通用联网研究 Agent。
- 外部网页作为用户经历证据。

验收：

- 用户可授权、撤销、查看联网搜索记录。
- 网络失败不阻塞主流程。
- External Background 与 Evidence Card 在 UI 和数据层明确分离。

测试：

- Web search mock。
- 低可信来源降级。
- 外部背景不能被用于用户经历证据的约束测试。

### Slice 7: Checkpoint Polish

目标：长流程可取消、恢复、重试。

包含：

- AI Run checkpoint。
- 应用重启恢复。
- 部分 Evidence Card 保留/丢弃选择。
- retry budget。
- run event 日志清理。

不包含：

- 面向用户的长任务平台。
- 多小时后台 Agent 市场。

验收：

- 应用重启后可恢复未完成 AI Edit Run。
- 用户取消 run 时能看到已完成和已丢弃内容。
- checkpoint 损坏时恢复已完成 Evidence Card，并提示缺失步骤。

测试：

- run 中断恢复。
- checkpoint 版本不兼容。
- 用户取消后的资源清理。

---

## 9. 测试策略

### 9.1 覆盖图

```text
Tauri Commands
  +--> unit tests for command inputs and path handling
  +--> startup smoke test

React UI
  +--> component tests for editor panels and review gate states
  +--> Playwright E2E for primary user flows

FastAPI Sidecar
  +--> pytest unit tests for domain services
  +--> API contract tests
  +--> worker/state-machine tests

Storage
  +--> migration tests
  +--> schema round-trip tests
  +--> corrupt/missing file tests

AI Pipeline
  +--> provider mock tests
  +--> evidence validation tests
  +--> prompt-injection fixture tests

PDF Pipeline
  +--> render smoke tests
  +--> layout regression snapshots
  +--> failure fallback tests
```

### 9.2 必测主路径

1. 创建模板简历 -> 编辑 -> 自动保存 -> 预览 -> 导出 PDF。
2. 创建 3 个 Job Target -> 为同一简历生成 3 个 Resume Version。
3. 导入资料 -> 生成 Evidence Card -> 引用到 AI 改写。
4. 选中 bullet -> `/tailor-resume` -> 预览上下文 -> 流式建议 -> 接受 -> 文档更新。
5. Review Gate 发现风险 -> 阻止导出 -> 修复后导出。
6. 用户拒绝云端发送 -> run 停止且不丢失已生成证据。
7. 外部网页 prompt injection -> 不能改变权限和证据规则。

### 9.3 回归测试铁律

任何已修复的 PDF 排版、权限越界、Evidence Card 来源丢失、LLM 输出误写入编辑器、Review Gate 漏拦风险，都必须补回归测试。

---

## 10. 失败模式

| Codepath | 生产失败方式 | 测试要求 | 处理要求 | 用户可见 |
| --- | --- | --- | --- | --- |
| Sidecar 启动 | 端口占用或二进制缺失 | 启动失败 smoke test | 重试备用端口，给出诊断 | “本地服务启动失败，可重试或查看日志” |
| SQLite 迁移 | 旧版本 schema 不兼容 | migration fixture | 自动备份后迁移，失败回滚 | “数据升级失败，已保留备份” |
| 文件读取 | 文件移动、权限不足、编码错误 | 失败路径单测 | 跳过来源并记录错误 | “部分资料无法读取，已跳过” |
| PDF 解析 | 扫描件无文本或加密 | PDF fixture | 建议 OCR/手动文本，不生成证据 | “这个 PDF 暂时无法解析” |
| Secret 扫描 | 误报或漏报 | secret fixtures | 默认移除疑似 secret，允许用户确认 | “检测到可能敏感内容” |
| AI 输出 | 空内容、JSON 不合法、拒答 | provider mock | 不写入编辑器，进入失败状态 | “AI 返回内容无法使用” |
| Evidence 验证 | 无证据主张被放行 | validation tests | 标记 `needs_confirmation` 或阻止 | “这条表达缺少证据” |
| Review Gate | 超页/敏感信息漏检 | rule regression | 默认阻止导出 | “这份简历还有投递风险” |
| PDF 导出 | 字体缺失、分页异常 | render regression | fallback 字体/保留 HTML 预览 | “PDF 导出失败，预览未丢失” |
| Checkpoint 恢复 | checkpoint 损坏 | corrupt fixture | 恢复已完成节点，提示重跑缺失步骤 | “任务只能部分恢复” |

关键红线：没有测试、没有错误处理、用户又看不到的失败模式，不允许进入实现计划。

---

## 11. 性能与资源预算

| 场景 | 目标 |
| --- | --- |
| App cold start | 首屏可见 < 3s，sidecar 健康 < 5s。 |
| Resume save | 绝大多数保存 < 200ms，失败可重试。 |
| A4 preview update | 编辑后节流更新，避免每次 keystroke 重渲染 PDF。 |
| PDF export | 常规 1-2 页简历 < 10s，失败保留 HTML 预览。 |
| Evidence extraction | 长资料异步执行，UI 展示进度和部分结果。 |
| AI streaming | 首 token 或首事件 < 3s；长等待必须有状态。 |
| Local storage | 原始资料和缓存可清理；日志不无限增长。 |

性能设计：

- PDF 导出和资料解析必须在 sidecar worker 中执行，不能阻塞 React UI。
- Evidence extraction 按来源分批，允许 partial 成功。
- A4 预览使用轻量 HTML 预览，最终 PDF 渲染只在导出或显式预览时触发。
- 大文件夹/代码项目扫描必须有文件数、大小、token/cost budget。

---

## 12. 安全与隐私实现要点

1. Tauri 文件系统权限默认只给应用目录，用户资料读取必须来自显式选择和 Permission Grant。
2. Permission Grant 记录路径范围、能力、创建时间、撤销时间和来源。
3. 所有路径解析必须防止 `..`、符号链接越界和全盘扫描。
4. Prompt injection 防线分两层：资料/JD/网页内容只当数据，不能改变系统规则；主 Agent 只消费 Evidence Card 和 External Background。
5. 云端 Provider Adapter 必须先通过 Context Preview，用户确认后才能发送。
6. API Key 只来自环境变量或本地安全配置，不写入文档、日志、checkpoint。
7. PDF 导出不嵌入 Evidence Vault、prompt、隐藏注释或内部日志。

---

## 13. 不在 V1 工程范围

- 插件市场。
- 面向普通用户的 Skill 开发 UI。
- 泛用 `/command` 生态。
- 团队协作和云同步。
- 求职 CRM、投递状态和面试流程管理。
- 自动登录或抓取招聘平台。
- 通用联网研究 Agent。
- 面向用户的多 Agent 长任务平台。
- 复杂模板市场。
- 类 PPT 编辑和邮件发送。

这些可以保留在长期产品愿景，但不能阻塞 V1 主线。

---

## 14. 已有资产

当前仓库已有：

- `docs/requirements.md`：V1 需求规格说明书，是当前工程计划的直接输入。
- `docs/product-vision.md`：长期愿景，帮助判断 V1/V1.5/V2/V3 边界。
- `docs/archive/requirements-v3.1-vision-draft-2026-05-07.md`：历史完整设想，必要时用于追溯被收敛掉的范围。

当前仓库未见应用代码。工程落地第一步应是 Slice 0，而不是直接实现 AI 或 Skill Runtime。

---

## 15. 并行实施策略

### 15.1 依赖表

| Workstream | Modules touched | Depends on |
| --- | --- | --- |
| App Foundation | `apps/desktop`, `apps/web`, `services/sidecar`, `packages/contracts` | - |
| Resume Editor & Storage | `apps/web`, `services/sidecar`, `packages/contracts` | App Foundation |
| PDF Rendering | `services/sidecar`, `packages/resume-renderer`, `apps/web` | Resume Editor & Storage |
| Job Target | `apps/web`, `services/sidecar`, `packages/contracts` | App Foundation |
| Evidence Vault | `services/sidecar`, `apps/web`, `packages/contracts` | App Foundation |
| AI Rewrite | `services/sidecar`, `apps/web`, `packages/contracts` | Job Target, Evidence Vault |
| Review Gate | `services/sidecar`, `apps/web`, `packages/contracts` | Resume Editor, Job Target, Evidence Vault |
| Language Calibration | `services/sidecar`, `apps/web` | Job Target, Permission Grant |
| Checkpoint Polish | `services/sidecar`, `packages/contracts` | AI Rewrite |

### 15.2 推荐 lanes

```text
Lane A: App Foundation -> Resume Editor & Storage -> PDF Rendering
Lane B: App Foundation -> Job Target
Lane C: App Foundation -> Evidence Vault
Lane D: Job Target + Evidence Vault -> AI Rewrite -> Checkpoint Polish
Lane E: Resume Editor + Job Target + Evidence Vault -> Review Gate
Lane F: Job Target + Permission Grant -> Language Calibration
```

执行顺序：

1. 先单线程完成 App Foundation，因为它是所有 lane 的公共依赖。
2. Foundation 稳定后，Lane A/B/C 可以并行。
3. Lane D/E/F 等 A/B/C 的数据模型稳定后再开。
4. PDF Rendering 和 Review Gate 都会触碰导出体验，合并时需要同一套 PDF fixture。

冲突提示：

- `packages/contracts` 是高冲突区，任何 lane 改 schema 都必须同步生成类型并跑 contract tests。
- `apps/web` 会被多个 lane 触碰，应按页面/feature folder 明确所有权。
- `services/sidecar` 的 domain services 必须按 bounded context 拆分，避免所有逻辑挤进一个 app service。

---

## 16. 开放决策

1. **PDF 引擎**：推荐先用受控 HTML/CSS + 浏览器渲染保证质量；打包体积和跨平台字体需在 Slice 1 验证。
2. **LangGraph 接入时机**：推荐 Slice 4 后再接入，Slice 1-3 用普通状态机降低复杂度。
3. **Schema 生成工具**：需要决定从 JSON Schema、Pydantic 还是 TypeScript 类型作为源头；推荐 Pydantic/JSON Schema 生成 TS 类型。
4. **LLM Provider 配置存储**：需要决定 API Key 存 OS keychain、环境变量还是本地加密配置；V1 默认环境变量/本地安全配置，避免把密钥写入 SQLite。
5. **PDF 导出强制通过策略**：需要产品确认哪些 Review Gate finding 可强制导出，哪些绝对阻止。

---

## 17. 完成度检查

- Step 0 范围挑战：完整 V1 过大，已收敛为 slice-first 工程计划。
- Architecture Review：架构边界、进程边界、存储边界已写入。
- Code Quality Review：contracts-first、bounded context、schema 生成策略已写入。
- Test Review：覆盖图、主路径和回归铁律已写入。
- Performance Review：启动、保存、PDF、Evidence、AI streaming 预算已写入。
- NOT in scope：已写入。
- What already exists：已写入。
- Failure modes：已写入，无“静默失败”允许进入实现。
- Parallelization：已写入 6 条 lane，Foundation 后可并行。
