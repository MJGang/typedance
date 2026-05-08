# TypeDance V1 需求规格说明书

> 版本: v1.0
> 最后更新: 2026-05-08
> 项目状态: 需求收敛阶段
> 历史来源: `docs/archive/requirements-v3.1-vision-draft-2026-05-07.md`

---

## 1. 产品定位

TypeDance V1 是一个面向知识工作者的本地优先 AI 简历优化工具。

它帮助用户基于个人资料库和目标招聘信息，生成更匹配、更可信、更有竞争力的简历版本，并导出可投递的 PDF。

V1 不追求成为通用 AI 写作编辑器，而是先打穿一个高焦虑、高价值、结果明确的场景：

> 用户担心因为简历表达不充分、岗位匹配度不够，错过更好的工作机会。

V1 采用“结果优先”范围基线：

- 主线目标是帮助用户在 30 分钟内生成一份针对目标岗位、可信、可投递的 PDF 简历。
- TipTap 3.x 是统一编辑器底座，但 V1 只承诺轻量通用富文本体验，不复制完整 Notion 能力。
- Skill Runtime 是资料读取和证据提取能力，不等同于插件平台。
- 内部多 Agent 用于压缩资料、提取证据和降低主 Agent 上下文负担，不作为面向用户的 Agent 平台。
- 联网搜索只用于目标岗位、公司和行业语言校准，不能作为用户经历证据。
- 所有 AI 生成都必须围绕真实资料、目标岗位和可解释证据链闭环。

---

## 2. 核心用户

### 2.1 首批用户

- 正在主动或被动看机会的白领与知识工作者
- 需要针对不同岗位反复调整简历的人
- 有较多项目、经历、材料，但不知道如何提炼价值的人
- 对简历质量敏感，愿意为更好的职业机会付费的人

### 2.2 典型用户

- 程序员：基于代码仓库、项目文档、Git 记录提炼技术贡献
- 产品经理：基于 PRD、复盘、需求文档提炼产品成果
- 运营/市场：基于活动方案、数据复盘、增长材料提炼业务结果
- 销售/商务：基于客户方案、项目材料、业绩记录提炼成交能力
- 管理者：基于绩效材料、团队项目、述职内容提炼管理价值

---

## 3. V1 价值主张

普通 AI 简历工具只会润色文字。TypeDance V1 的核心差异是：

1. 基于真实资料生成，不凭空编造。
2. 针对目标岗位优化，不生成一份万能简历。
3. 标注证据链和可信度，让用户知道每条表达从哪里来。
4. 支持多个岗位版本，帮助用户为高价值机会定制简历。

一句话表达：

> 用你的真实材料，为每个目标岗位生成更匹配的简历。

---

## 4. 核心闭环

```text
用户资料库
+ 目标招聘信息/JD
+ 目标薪资、年限、职级
+ /resume-match 或 /tailor-resume
= 针对当前机会优化过的简历版本
```

V1 用户流程：

1. 用户导入旧简历，或从简历模板开始。
2. 用户添加个人资料库材料，例如项目文档、工作总结、作品、代码仓库、过往简历。
3. 用户粘贴目标岗位 JD，或手动录入招聘信息。
4. TypeDance 分析岗位要求、薪资范围、经验要求和关键词。
5. TypeDance 从资料库中提取最相关的经历与证据。
6. 用户选中简历段落，通过 AI 浮窗执行 `/tailor-resume` 等命令。
7. AI 生成改写建议，并展示证据来源、可信度和风险提示。
8. 用户接受、编辑、重新生成或追问。
9. 用户导出针对该岗位的 PDF 简历。

---

## 5. 产品对象

### 5.1 个人资料库

个人资料库是简历生成的事实底座。

支持材料类型：

- 简历 Markdown/PDF
- 工作总结、述职、周报、复盘文档
- 项目文档、PRD、方案、会议纪要
- 本地文件夹或代码项目
- 作品链接、证书、教育经历
- 手动录入的经历片段

V1 重点不是做完整知识库，而是让 AI 在生成简历时有可信上下文。

### 5.2 目标岗位

目标岗位是简历优化的方向。

V1 支持用户粘贴招聘信息文本，后续可扩展为截图/OCR、浏览器扩展、招聘平台导入。

岗位信息字段：

- 岗位名称
- 公司名称
- 行业或业务方向
- 薪资范围
- 工作年限要求
- 技能或能力关键词
- 岗位职责
- 任职要求
- 用户兴趣等级

### 5.3 简历版本

简历不是一份固定文件，而是围绕不同目标岗位生成的多个版本。

示例：

- `张三-后端开发-金融科技公司.pdf`
- `张三-产品经理-B端SaaS.pdf`
- `张三-运营增长-教育行业.pdf`

每个版本需要记录：

- 关联的目标岗位
- 使用的资料来源
- AI 修改历史
- 用户接受的改动
- 导出时间

---

## 6. 核心交互

### 6.1 三元输入模型

TypeDance 的 AI 交互由三部分组成：

| 输入 | 含义 | 示例 |
| --- | --- | --- |
| 选中文本 | 我要优化哪里 | 选中一段项目经历 |
| `@` 引用 | 基于哪些材料 | `@工作总结`、`@项目文件夹`、`@目标JD` |
| `/` 命令 | 用什么策略处理 | `/tailor-resume`、`/match-jd` |

组合示例：

```text
选中一段经历
+ @目标JD
+ @项目复盘
+ /tailor-resume
= 针对该岗位重写这段经历
```

### 6.2 `/` Resume Action System

`/` 是面向简历优化的动作入口，不是 V1 的泛用插件命令平台。

V1 可以在内部通过 Skill Pack Runtime 读取 PDF、Markdown、本地文件夹、代码项目等资料，但用户感知仍然应该是“选择一个简历动作”，而不是“管理一套插件生态”。

V1 内置命令：

| Command | 作用 | 优先级 |
| --- | --- | --- |
| `/match-jd` | 分析当前简历与目标岗位的匹配度 | P0 |
| `/tailor-resume` | 针对目标岗位优化简历内容 | P0 |
| `/extract-highlights` | 从资料库提取适合写入简历的亮点 | P0 |
| `/gap-analysis` | 找出简历相对岗位要求的缺口与风险 | P0 |
| `/rewrite-bullet` | 将经历改写为更专业、量化、结果导向的 bullet | P0 |
| `/quality-review` | 生成导出前质量评分和风险检查 | P0 |
| `/company-language-calibration` | 在用户授权后分析目标公司、岗位和行业语言 | P1 |

V1.5 再考虑：

- `/boss-greeting`：生成招聘平台开场沟通话术。
- `/mock-interview`：基于简历和 JD 生成模拟面试问题。
- `/cover-letter`：针对岗位生成求职信。

### 6.3 `@` Reference System

`@` 用于引用本地资料、岗位信息或上下文。

V1 支持：

- `@目标JD`
- `@简历版本`
- `@本地文件`
- `@本地文件夹`
- `@项目资料`

后续扩展：

- `@url`
- `@招聘平台页面`
- `@浏览器扩展采集内容`
- `@邮件`
- `@云文档`

---

## 7. V1 功能需求

### 7.1 简历编辑

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| 简历模板 | 提供基础简历模板 | P0 |
| Markdown 导入 | 导入 Markdown 简历 | P0 |
| PDF 导入 | 从 PDF 提取简历文本，尽力恢复结构 | P1 |
| 富文本编辑 | 支持标题、列表、加粗、段落、链接等基础格式 | P0 |
| A4 预览 | 提供接近导出效果的 A4 简历预览 | P0 |
| PDF 导出 | 导出可投递 PDF | P0 |
| 自动保存 | 编辑后自动保存 | P0 |

### 7.2 Profile Evidence Vault

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| 添加资料 | 添加文件、文件夹、手动文本材料 | P0 |
| Skill Pack 读取资料 | 通过受控 Skill Pack 读取 PDF、Markdown、本地文件夹、代码项目等资料 | P0 |
| 材料摘要 | AI 生成资料摘要和可用亮点 | P0 |
| Evidence Card | 将资料压缩为可引用证据片段，记录来源、位置、摘录、可信度和生成时间 | P0 |
| 资料引用 | 在 AI 命令中通过 `@` 引用资料或证据片段 | P0 |
| 逐条主张证据链 | 每条关键简历表述标注来源、支持程度和风险提示 | P0 |
| 忽略规则 | 支持 `.gitignore` 或 `.typedanceignore` 风格忽略 | P1 |

V1 不做完整知识库管理，不提供标签系统、云同步、复杂资料版本管理或类 Obsidian/Notion 的资料浏览产品。

### 7.3 岗位管理

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| 粘贴 JD | 用户粘贴招聘信息文本 | P0 |
| 岗位解析 | 提取岗位名称、公司、薪资、年限、关键词 | P0 |
| 岗位卡片 | 保存感兴趣的岗位 | P0 |
| 匹配评分 | 分析简历与岗位要求的匹配程度 | P0 |
| 简历版本关联 | 每份简历可绑定一个目标岗位 | P0 |

岗位管理采用轻量 Job Target 模型：保存目标岗位、JD 解析结果、匹配评分和关联简历版本，但不做投递状态、面试流程、沟通记录或求职 CRM。

### 7.4 AI 简历优化

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| 选中改写 | 选中一段文字后唤起 AI 浮窗 | P0 |
| 流式生成 | AI 回复实时显示 | P0 |
| 接受/拒绝 | 用户可接受、拒绝、重新生成 | P0 |
| 多轮追问 | 在当前上下文中继续调整 | P1 |
| 内部多 Agent 证据流水线 | 子 Agent 读取资料、搜索授权外部背景、提取 Evidence Card，主 Agent 只消费压缩证据 | P0 |
| 证据链 | 展示生成内容引用了哪些资料和 Evidence Card | P0 |
| 可信度 | 标记明确支持、合理推断、需要确认 | P0 |
| 风险提示 | 提醒可能夸大、缺证据、敏感或与 JD 不匹配的表达 | P0 |
| 简历质量评分仪表盘 | 展示 JD 匹配度、证据覆盖率、风险表达、量化成果比例和 PDF 排版状态 | P0 |
| 投递前 Review Gate | 导出前检查缺证据主张、敏感信息、JD 不匹配、超页和排版异常 | P0 |
| JD/公司语言校准 | 用户授权联网后分析目标公司、岗位和行业语言，作为外部背景辅助改写 | P1 |

### 7.5 安全与隐私

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| 本地优先 | 用户资料默认存储在本地 | P0 |
| 每次发送预览 | 每次调用云端 LLM 前展示将发送的选中文本、JD 摘要、证据片段、来源和风险提示 | P0 |
| Secret 扫描 | 检测 API Key、Token、密码等敏感内容 | P0 |
| Skill Pack 权限清单 | 每个 Skill Pack 声明读文件、读目录、联网、调用模型、写缓存等能力 | P0 |
| 路径范围授权 | 用户授权 Skill Pack 可访问的本地路径范围，并可撤销 | P0 |
| 联网授权 | 联网搜索必须由用户授权，并记录搜索目标、来源链接和时间 | P0 |
| 本地模型 | 支持 Ollama 等本地 Provider | P1 |
| Provider 配置 | 支持 OpenAI、DeepSeek、Ollama 或兼容接口 | P0 |

---

## 8. 非目标

V1 明确不做：

- 通用 AI 写作平台
- 插件市场
- 面向普通用户的 Skill 开发 UI
- 泛用命令生态
- 团队协作
- 类 PPT 编辑
- 邮件发送
- 招聘平台自动登录或自动抓取
- 完整知识库管理
- 面向用户的多 Agent 长任务编排平台
- 通用联网研究 Agent
- 求职 CRM 或投递状态管理
- 复杂模板市场

这些能力进入长期愿景，但不抢占 V1 主线。

---

## 9. 技术方向

V1 仍保留原技术路线中的关键内核：

- 桌面端：Tauri 2
- 前端：React + Vite + TypeScript
- 编辑器：TipTap 3.x / ProseMirror
- 后端：Python FastAPI sidecar
- AI 编排：内部多 Agent / 多 worker 证据流水线，可基于 LangGraph 实现
- 导出：受控 HTML/CSS 简历渲染管线到 PDF
- 存储：本地用户目录 `~/.typedance/`
- LLM：可配置 Provider

V1 架构基线：

```text
Tauri Desktop Shell
  |
  v
React App
  |
  +--> TipTap 3.x Editor
  |      |
  |      +--> AI Floating Panel
  |      +--> A4 Preview
  |
  +--> Job Target UI
  +--> Evidence Vault UI
  +--> Quality Dashboard
  +--> Review Gate
  |
  v
FastAPI Sidecar
  |
  +--> Permission Manager
  +--> Skill Pack Runtime
  |      |
  |      +--> PDF / Markdown / Folder / Code readers
  |
  +--> Internal Agent Pipeline
  |      |
  |      +--> Evidence Reader Agents
  |      +--> Authorized Web Search Agent
  |      +--> Main Resume Agent
  |
  +--> Evidence Vault
  +--> Job Target Store
  +--> Resume Version Store
  +--> PDF Rendering Pipeline
  +--> LLM Provider Adapter
```

### 9.1 V1 核心数据关系

V1 的核心对象关系如下：

```text
Job Target
  |
  +--> Resume Version
          |
          +--> AI Edit Run
          |       |
          |       +--> Evidence Card[]
          |       +--> External Background[]
          |
          +--> PDF Export

Skill Pack
  |
  +--> Permission Grant
  |
  +--> Evidence Card

Evidence Card
  |
  +--> Source: user_file | pasted_text | local_folder | code_project | target_jd | external_web
```

对象边界：

- `Job Target`：目标岗位，包含 JD 原文、解析结果、兴趣等级、关键词、公司/岗位背景。
- `Resume Version`：围绕一个目标岗位生成或编辑的简历版本，记录使用的资料来源和用户接受的改动。
- `Evidence Card`：可引用证据片段，包含来源类型、来源位置、摘录、摘要、可信度和风险标签。
- `AI Edit Run`：一次 AI 改写或分析过程，记录输入摘要、引用证据、输出建议、用户处理结果和错误状态。
- `External Background`：授权联网后获得的公司、岗位或行业背景，只能用于语言校准和岗位理解，不能作为用户经历证据。
- `PDF Export`：一次导出记录，包含关联简历版本、导出时间、Review Gate 状态和排版检查结果。
- `Skill Pack`：受控资料读取/证据提取能力包，不是 V1 插件平台。
- `Permission Grant`：用户授予 Skill Pack 的路径、联网、模型调用和缓存写入权限。

### 9.2 AI Edit Run 状态机

V1 的内部 AI 工作流采用 checkpointed run 状态机。可使用 LangGraph checkpointer 实现持久化，优先考虑本地 SQLite checkpointer；未来服务端化或团队版再考虑 Postgres checkpointer。

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

状态含义：

- `created`：用户触发一次 AI 动作，但尚未检查权限和输入。
- `permission_required`：需要用户授权本地路径、联网、模型调用或云端发送上下文。
- `queued`：权限满足，等待执行。
- `running`：Skill Pack、子 Agent、主 Agent 或 PDF/Review Gate 流程正在执行。
- `waiting_user_confirmation`：云端 LLM 调用前等待用户确认将发送的上下文。
- `partial`：部分 Evidence Card、外部背景或中间结论已完成，但整体 run 尚未完成。
- `failed_retryable`：发生可重试失败，例如模型限流、网络超时、临时文件读取失败。
- `failed_final`：发生不可自动恢复失败，例如权限被拒绝、文件不存在、解析格式不支持。
- `canceled`：用户主动取消，已生成的 Evidence Card 可按用户选择保留或丢弃。
- `completed`：输出建议、证据链、风险提示和用户可处理结果均已生成。

Checkpoint 范围：

- 保存 run id、关联 Resume Version、Job Target、用户授权、节点完成状态、Evidence Card、External Background、错误状态和 token/cost budget。
- 不保存未经用户确认的敏感原文到长期日志。
- 子 Agent 输出必须先压缩为 Evidence Card 或 External Background，再交给主 Agent。
- 应支持应用重启后恢复未完成 run，但 V1 不把多小时长任务恢复作为面向用户的核心卖点。

### 9.3 Error & Rescue Registry

V1 必须把失败处理作为核心体验设计，而不是实现细节。任何失败都不能静默吞掉，也不能在证据不足时继续生成看似确定的简历内容。

| Codepath | What can go wrong | Rescue action | User sees |
| --- | --- | --- | --- |
| Skill Pack 权限检查 | Skill 请求未授权路径、联网或模型调用 | 阻止执行，进入 `permission_required`，展示权限原因和最小授权范围 | “需要授权读取这些资料/联网后才能继续” |
| 本地文件读取 | 文件不存在、权限不足、路径越界、编码失败 | 跳过该来源，记录失败 Evidence Source，允许用户重新选择或移除 | “部分资料无法读取，已跳过：{文件名}” |
| PDF/复杂格式解析 | PDF 加密、扫描件无文本、格式不支持、解析超时 | 降级为 OCR/手动文本导入建议；该文件不生成 Evidence Card | “这个 PDF 暂时无法解析，可尝试导入文本或截图 OCR” |
| 本地文件夹/代码项目扫描 | 文件过多、命中忽略规则、超出 token/cost budget | 按忽略规则和 budget 截断，生成扫描摘要和未覆盖提示 | “已扫描关键文件，仍有部分内容因范围过大未读取” |
| Secret 扫描 | 检测到 API Key、Token、密码、公司敏感信息 | 默认从发送上下文中移除，允许用户明确确认后加入 | “检测到可能敏感内容，默认不会发送给云端模型” |
| Evidence Card 生成 | 子 Agent 输出为空、重复、缺来源、可信度不明 | 拒绝写入 Evidence Vault，要求重试或标记为 `needs_confirmation` | “部分资料没有形成可用证据，请确认或重试” |
| 授权联网搜索 | 网络失败、搜索结果为空、来源不可访问、用户取消授权 | 不阻塞简历生成，只移除 External Background；保留 JD 本身分析 | “未获取外部背景，将仅基于 JD 和你的资料继续” |
| 外部网页解析 | 网页内容过旧、广告/噪声多、来源可信度低 | 降级为低可信 External Background，不能参与用户经历证据链 | “外部资料仅用于岗位语言参考，不会证明你的经历” |
| 云端 LLM 调用 | 用户拒绝发送预览、模型限流、超时、网络失败 | 进入 `failed_retryable` 或改用本地 Provider；保留已生成 Evidence Card | “模型暂时不可用，可以重试、切换 Provider 或稍后继续” |
| LLM 输出解析 | 返回空内容、格式不合法、JSON 无法解析、拒答 | 重试一次；仍失败则进入 `failed_final` 并显示可读错误 | “AI 返回内容无法使用，未修改你的简历” |
| 主 Agent 生成 | 输出含无证据主张、夸大表达、与 JD 不匹配 | 不自动写入简历，标记风险并要求用户确认或重新生成 | “这条表达缺少证据/可能夸大，请确认后再使用” |
| Checkpoint 恢复 | checkpoint 损坏、版本不兼容、关联文件已移动 | 恢复已完成 Evidence Card，终止未完成节点，提示重新运行缺失步骤 | “上次任务只能部分恢复，缺失步骤需要重新执行” |
| 用户取消 Run | 子 Agent 仍在运行、已有部分结果、写入冲突 | 停止后续节点，询问保留或丢弃部分 Evidence Card | “任务已取消，是否保留已提取的证据？” |
| Review Gate | 超页、缺证据主张、敏感信息、排版异常 | 阻止默认导出；允许用户查看问题、修复或强制导出 | “这份简历还有投递风险，建议修复后导出” |
| PDF 渲染/导出 | 字体缺失、分页异常、渲染器失败、文件写入失败 | 使用 fallback 字体/重试渲染；失败则保留 HTML 预览并提示原因 | “PDF 导出失败，预览未丢失，可修复后重试” |

错误处理原则：

1. 资料读取失败不能导致 AI 编造缺失事实。
2. 外部网页只能降级为岗位背景，不能升级为用户经历证据。
3. LLM 输出不可解析时，不得自动写入编辑器。
4. Review Gate 失败时默认阻止导出，但用户可以在明确风险后强制导出。
5. 所有可恢复失败必须进入 `failed_retryable`，所有不可恢复失败必须有用户可理解的解释。
6. 日志记录 run id、codepath、来源类型、错误类别和恢复动作；不记录未经用户确认的敏感原文。

### 9.4 Security & Threat Model

V1 的安全目标不是企业级合规，而是让用户确信：本地资料不会被越权读取、不会被静默上传、不会被外部内容污染成虚假经历。

| Threat | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Skill Pack 供应链风险 | Medium | High | Skill Pack 必须声明权限；默认最小权限；禁止未授权联网；写入仅限缓存/索引目录；用户可撤销授权 |
| 本地路径越权读取 | Medium | High | 所有文件读取必须经过 Permission Grant；限制到用户授权路径；禁止解析 `..`、符号链接越界和全盘扫描 |
| Prompt injection in user files | High | Medium | 用户资料中的指令视为不可信内容；子 Agent 只提取事实证据；主 Agent 不执行资料内指令 |
| Prompt injection in JD/web pages | High | Medium | JD 和网页只能作为岗位要求/外部背景；不得覆盖系统规则、权限规则或证据规则 |
| 外部网页污染用户经历 | Medium | High | `external_web` 只能生成 External Background；不能生成用户经历 Evidence Card；UI 明确区分外部背景和用户证据 |
| 云端 LLM 静默上传敏感资料 | Medium | High | 每次云端调用前必须显示上下文预览；Secret 扫描默认移除敏感内容；用户显式确认后才发送 |
| Checkpoint/日志泄露敏感原文 | Medium | High | Checkpoint 保存状态、摘要和证据引用；长期日志不保存未经确认的敏感原文；错误日志记录类别而非全文 |
| LLM 生成无证据夸大内容 | High | High | 逐条主张证据链；缺证据主张标记 `needs_confirmation`；Review Gate 默认阻止高风险导出 |
| PDF 导出泄露隐藏内容 | Low | High | 导出管线只渲染当前简历版本的显式内容；不嵌入 Evidence Vault、AI prompt、隐藏注释或日志 |
| Provider/API Key 泄露 | Medium | High | API Key 通过环境变量或本地配置注入；Secret 扫描覆盖资料和发送上下文；配置文件不写入文档或日志 |
| 缓存残留敏感资料 | Medium | Medium | 缓存目录位于 `~/.typedance/`；提供清理缓存能力；缓存条目关联 Permission Grant 和来源 |

安全原则：

1. 任何用户资料、JD、网页内容都不能改变系统权限规则。
2. Skill Pack 只能在声明并授权的能力范围内运行。
3. `external_web` 来源永远不能证明“用户做过某件事”。
4. 云端发送上下文必须可预览、可删减、可取消。
5. 日志、checkpoint、错误报告默认记录结构化摘要，不记录敏感全文。
6. 导出 PDF 必须只包含用户可见并确认的简历内容。

### 9.5 E2E Data Flow

V1 的主数据流如下：

```text
1. Import Resume / Create Template
   |
   v
2. Create Job Target
   |
   v
3. Add Materials
   |
   v
4. Permission Check
   |
   v
5. Skill Pack Read / Parse
   |
   v
6. Evidence Card Generation
   |
   v
7. Optional Authorized Web Search
   |
   v
8. External Background Generation
   |
   v
9. User selects resume text + @ evidence + / action
   |
   v
10. Cloud/local context preview
   |
   v
11. Main Resume Agent generates suggestion
   |
   v
12. Evidence/risk validation
   |
   v
13. User accepts/edits/rejects suggestion
   |
   v
14. Quality Dashboard updates
   |
   v
15. Review Gate
   |
   v
16. Controlled HTML/CSS render
   |
   v
17. PDF Export
```

影子路径：

| Node | Nil / missing | Empty | Error | Partial |
| --- | --- | --- | --- | --- |
| Resume input | 创建空模板 | 提示导入或从模板开始 | 保留原输入，不写入损坏内容 | 允许先编辑，后补资料 |
| Job Target | 不允许运行 `/match-jd` 或岗位校准 | 提示粘贴 JD 或手动录入岗位 | 保留简历编辑能力 | 允许先生成通用简历，但标记“未针对岗位” |
| Materials | 允许基于旧简历和 JD 生成，但降低证据评分 | Evidence Vault 为空 | 显示读取失败来源 | 可用已成功读取的 Evidence Card 继续 |
| Permission Check | 进入 `permission_required` | 不执行 Skill | 展示缺失权限原因 | 对已授权路径继续执行 |
| Skill Parse | 跳过该来源 | 不生成 Evidence Card | 进入可重试或最终失败 | 生成部分 Evidence Card，并标记覆盖不足 |
| Web Search | 默认跳过 | 无 External Background | 不阻塞主流程 | 使用可信来源，低可信来源降级 |
| Context Preview | 不允许云端调用 | 提示无可发送上下文 | 用户可删减后重试 | 仅发送用户确认的片段 |
| Main Agent | 不生成建议 | 返回“缺少上下文” | 不写入编辑器 | 返回带风险标记的建议 |
| Evidence Validation | 缺证据主张标记 `needs_confirmation` | 阻止自动接受 | 要求重新生成或用户确认 | 用户可接受有证据部分 |
| Review Gate | 缺少目标/证据/排版信息则提示补齐 | 阻止默认导出 | 可修复后重试 | 可强制导出，但明确风险 |
| PDF Render | 不导出 | 提示简历为空 | 保留 HTML 预览，允许重试 | 导出可用页面并提示排版风险 |

关键交互原则：

1. AI 建议默认不直接覆盖简历，必须由用户接受或编辑。
2. Evidence Card 在 AI 建议之前生成；AI 建议必须引用 Evidence Card 或明确标记为推断。
3. External Background 在数据流中与 Evidence Card 分离，只能影响语言校准和岗位理解。
4. Quality Dashboard 和 Review Gate 复用同一组质量指标，避免一个说能投、另一个说不能投。
5. 用户取消 run 时，UI 必须解释哪些内容已完成、哪些内容已丢弃或可保留。
6. PDF 导出走受控渲染管线，不直接把编辑器 DOM 当成最终投递结果。

### 9.6 Implementation Slices

V1 实施必须按可验证闭环切片，而不是按底层平台能力横向铺开。每个切片都要产生可演示的用户价值。

| Slice | Goal | Includes | Excludes | Acceptance |
| --- | --- | --- | --- | --- |
| 1. Editable Resume to PDF | 用户能编辑一份简历并稳定导出 PDF | TipTap 3.x 基础编辑、Resume Version、A4 预览、受控 HTML/CSS PDF 管线 | AI、Evidence Vault、Skill Runtime | 一份模板简历可编辑、预览、导出，PDF 排版稳定 |
| 2. Job Target Loop | 简历能绑定目标岗位并看到基础匹配 | Job Target、JD 粘贴、JD 解析、简历版本关联、基础匹配评分 | 联网搜索、公司语言校准 | 用户能为同一简历创建至少 3 个岗位版本 |
| 3. Evidence Vault Loop | 用户资料能转化为可引用证据 | Skill Pack 权限、资料导入、Evidence Card、来源类型、Secret 扫描 | 泛用知识库、标签系统、云同步 | 至少支持 Markdown/PDF/手动文本生成 Evidence Card |
| 4. AI Rewrite Loop | AI 能基于证据改写简历并给出风险 | AI Edit Run、context preview、主 Agent、逐条证据链、接受/拒绝 | 通用聊天助手、面试/求职信 | 用户选中 bullet 后可生成有证据和风险标记的改写建议 |
| 5. Quality & Review Gate | 用户导出前知道这份简历是否能投 | Quality Dashboard、Review Gate、PDF 风险检查、强制导出确认 | 求职 CRM、投递管理 | 导出前能发现缺证据、超页、敏感信息和 JD 不匹配 |
| 6. Language Calibration | 简历表达贴近目标公司/岗位语言 | 授权联网、External Background、公司/JD 语言校准 | 通用联网研究、自动抓登录态招聘平台 | 外部背景只影响表达风格，不进入用户经历证据链 |
| 7. Checkpoint Polish | 长流程可取消、恢复、重试 | LangGraph checkpoint、run 状态机、部分结果保留 | 面向用户的长任务平台 | 应用重启后可恢复未完成 AI Edit Run |

实施原则：

1. 每个 slice 必须保留“可投递简历”主线，不允许先做脱离用户结果的平台能力。
2. Skill Runtime、Agent Pipeline、Checkpoint 只在具体 slice 需要时引入。
3. 每个 slice 完成后都应能被非工程用户体验到价值。
4. V1.5 能力不得阻塞 V1 slice，例如求职信、模拟面试、Boss 话术、求职 CRM。
5. 如果某个底层抽象无法直接支持当前 slice，应延后到真正需要时再实现。

已确认的技术原则：

1. TipTap 3.x / ProseMirror 是主编辑器底座。
2. ProseMirror JSON 可作为编辑态和持久化候选格式；PDF 导出必须走受控简历 HTML/CSS 管线。
3. 核心数据关系是：Resume Version 绑定 Job Target，并引用 Evidence Card。
4. Skill Runtime 是受控资料读取和证据提取机制，不是 V1 插件平台。
5. 内部多 Agent 负责资料压缩、证据提取和语言校准；面向用户只暴露简历动作和结果。
6. AI Edit Run 使用 checkpointed 状态机，支持取消、恢复、重试和部分结果保留。
7. 每次云端 LLM 调用前必须进行上下文预览和用户确认。

---

## 10. V1 成功标准

产品成功不是“功能完整”，而是用户能完成高价值求职闭环。

V1 验收标准：

- 用户能在 30 分钟内从旧简历和目标 JD 生成一份可投递简历。
- 每条 AI 强化后的经历都能看到依据或风险提示。
- 用户能为至少 3 个不同岗位生成不同版本简历。
- 导出的 PDF 排版稳定，可直接投递。
- 用户能清楚知道哪些资料会被发送给云端模型。

---

## 11. 后续扩展方向

V1 后的自然延伸：

- 模拟面试：基于简历和 JD 生成问题、追问和回答建议。
- 求职信：针对岗位生成 cover letter。
- 招聘平台话术：生成 Boss 直聘等平台的开场沟通内容。
- 述职与晋升材料：基于资料库生成绩效自评、晋升答辩材料。
- 周报/月报：从工作记录中生成汇报内容，并扩展邮件发送。
- 类 PPT 模式：支持会议、汇报、路演等展示场景。
- 长期可扩展 Skill/Command 生态：将简历、述职、周报、面试等能力沉淀为可复用工作流；V1 仅保留受控 Skill Runtime。
