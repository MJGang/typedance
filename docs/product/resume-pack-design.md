# Resume Pack 终局设计

> 状态：产品与工程协议草案  
> 目标：定义 TypeDance 的第一个 Document Pack：AI-native 简历改稿系统。

## 1. Resume Pack 的定位

Resume Pack 不是一个简历模板集合，也不是普通富文本编辑器。

它是一套专门用于简历场景的文档规则包，负责让系统理解、重组、审核和渲染简历。

核心目标：

```text
把旧简历、材料和用户补充信息
转化为可信、清晰、可投递的结构化简历草稿。
```

简历不是一份文本，而是一组：

```text
模块
主张
证据
问题
确认状态
版本
```

PDF 只是最终导出结果。

## 2. WPS 模块设计在 Resume Pack 中的升级

WPS 的模块主要服务手动编辑和排版。

TypeDance 的模块是 AI 可操作对象：

```text
WPS 模块：
内容区块 + 用户手动增删排序

TypeDance Resume Module：
语义结构 + AI 生成 + AI 诊断 + 证据链 + 改稿任务 + 渲染映射
```

用户仍然可以看到模块列表，但每个模块还会带有：

- 问题数量。
- 证据状态。
- AI 修改状态。
- 待确认事项。
- 可执行动作。

## 3. 模块清单

```text
BasicInfo
基本信息：姓名、手机号、邮箱、城市、链接、求职状态。

CareerSummary
职业摘要：2-4 行总结核心定位、经验年限、优势方向。

JobIntent
求职意向：目标岗位、城市、薪资、到岗时间。默认可选。

CoreSkills
核心技能：按能力分组，不做无序关键词堆砌。

WorkExperience
工作经历：公司、岗位、时间、业务背景、职责、成果。

ProjectExperience
项目经历：项目名称、角色、技术栈、贡献、结果。

Education
教育经历：学校、专业、学历、时间、相关亮点。

InternshipExperience
实习经历：适合应届生、转行或经验较少用户。

Certificates
证书：职业证书、语言证书、技术认证。

Awards
荣誉奖项：奖学金、比赛、公司荣誉。

Portfolio
作品与链接：作品集、开源项目、文章、案例、产品链接。

SelfEvaluation
自我评价：默认不鼓励长篇模板化表达，可转成职业摘要。

CustomModule
自定义模块：志愿服务、科研、培训、社团等特殊内容。
```

## 4. 模块状态

```text
clean
已通过。

needs_review
有建议。

needs_confirmation
存在待确认事实。

weak
内容偏弱。

hidden
保留在数据中，但不进入当前简历。
```

## 5. 模块数据结构

### BasicInfo

```ts
BasicInfo {
  name: string
  phone?: string
  email?: string
  city?: string
  location_preference?: string
  links?: Link[]
  current_status?: string
}
```

质量规则：

- 必须有姓名。
- 手机号或邮箱至少有一个。
- 不建议放身份证、详细住址。
- 链接要有清晰标签。

### CareerSummary

```ts
CareerSummary {
  headline?: string
  summary_points: Claim[]
  target_direction?: string
}
```

质量规则：

- 2-4 行。
- 避免“学习能力强、责任心强”等套话。
- 强主张应能从经历中找到支撑。

### JobIntent

```ts
JobIntent {
  target_roles: string[]
  city?: string
  expected_salary?: string
  availability?: string
  work_mode?: "onsite" | "hybrid" | "remote" | "any"
}
```

质量规则：

- 默认不强制展示。
- 可以作为内部生成基础简历方向。
- 展示时必须简洁。

### CoreSkills

```ts
CoreSkills {
  groups: SkillGroup[]
}

SkillGroup {
  name: string
  skills: Skill[]
}

Skill {
  name: string
  level?: "familiar" | "proficient" | "expert"
  evidence_links: EvidenceLink[]
  related_modules: string[]
}
```

质量规则：

- 按能力分组。
- 技能最好能在工作或项目经历中体现。
- 弱证据技能可以保留，但应降级或后置。
- 避免堆太多工具名。

### WorkExperience

```ts
WorkExperience {
  items: WorkExperienceItem[]
}

WorkExperienceItem {
  company: string
  title: string
  start_date?: string
  end_date?: string
  business_context?: string
  responsibilities: Claim[]
  achievements: Claim[]
  related_projects?: string[]
}
```

质量规则：

- 必须有公司、岗位、时间。
- 不只写职责，要写贡献和结果。
- 业务背景不能长篇介绍公司。
- 与项目经历重复时要分工清楚。

### ProjectExperience

```ts
ProjectExperience {
  items: ProjectExperienceItem[]
}

ProjectExperienceItem {
  name: string
  role?: string
  start_date?: string
  end_date?: string
  context?: string
  tech_stack?: Skill[]
  contributions: Claim[]
  outcomes: Claim[]
  evidence_links: EvidenceLink[]
}
```

质量规则：

- 每个项目回答：什么场景、你做了什么、结果是什么。
- 必须突出个人贡献。
- 技术栈要和贡献绑定。
- 结果数字缺证据时必须标记。

### Education

```ts
Education {
  items: EducationItem[]
}

EducationItem {
  school: string
  degree?: string
  major?: string
  start_date?: string
  end_date?: string
  highlights?: Claim[]
}
```

质量规则：

- 应届生可以展开。
- 工作多年用户默认简洁。
- 成绩、奖项、课程只有相关或有竞争力时展示。

### Certificates

```ts
Certificates {
  items: CertificateItem[]
}

CertificateItem {
  name: string
  issuer?: string
  date?: string
  credential_url?: string
  relevance?: "high" | "medium" | "low"
}
```

质量规则：

- 只展示相关或有含金量的证书。
- 低相关证书默认隐藏。

### Portfolio

```ts
Portfolio {
  items: PortfolioItem[]
}

PortfolioItem {
  title: string
  url: string
  type: "github" | "website" | "article" | "product" | "case_study" | "other"
  description?: string
  related_claims?: string[]
}
```

质量规则：

- 链接必须可理解。
- 作品描述要说明价值，不只是贴 URL。
- 内部项目或隐私链接要提示风险。

## 6. Claim 是核心单位

模块是容器，`Claim` 才是 AI 真正改、查、审、确认的单位。

```ts
Claim {
  id: string
  text: string
  claim_type:
    | "responsibility"
    | "achievement"
    | "skill"
    | "summary"
    | "education"
    | "other"
  evidence_links: EvidenceLink[]
  confidence:
    | "supported"
    | "user_confirmed"
    | "inferred"
    | "unsupported"
  risk_flags: string[]
  source_span_refs: string[]
}
```

## 7. 问题类型

```text
vague_expression
空泛表达，例如“负责多个模块”“提升用户体验”。

unsupported_claim
缺少证据的主张。

overclaimed
可能夸大，例如“主导整个系统”但材料显示只是参与。

weak_relevance
真实但对当前简历方向帮助不大。

missing_metric
有贡献但没有结果或影响。

timeline_unclear
工作、项目、教育时间冲突或缺失。

duplicated_content
工作经历和项目经历重复表达同一件事。

skill_without_evidence
技能列表里写了某技能，但经历中没有体现。

module_missing
关键模块缺失。

module_too_long
模块过长，影响扫读。

module_too_weak
模块存在，但无法证明能力。

tone_generic
表达模板化。

ats_risk
可能影响 ATS 解析。

privacy_risk
包含敏感或不必要隐私信息。

layout_risk
超页、密度过低、标题层级混乱。
```

严重级别：

```text
info
建议。

warning
需要注意。

blocking
导出前必须确认或处理。
```

## 8. 动作清单

```text
accept_proposal
接受 AI 建议。

keep_original
保留原文。

rewrite_conservative
保守改写，去掉未经证实的数字或绝对表述。

rewrite_stronger
在有证据时强化表达。

add_metric
引导用户补充数字、规模、影响。

find_evidence
从来源材料里查找支撑。

confirm_truth
用户确认主张真实。

delete_item
删除弱相关或重复内容。

hide_module
隐藏模块，但保留数据。

reorder_module
重排模块。

compress_module
压缩模块。

expand_module
扩展模块。

split_module
拆分混在一起的模块。

merge_module
合并重复模块。

ask_user
打开轻量输入，让用户补充事实或偏好。
```

## 9. EvidenceLink

```ts
EvidenceLink {
  id: string
  source_document_id: string
  source_type:
    | "old_resume"
    | "uploaded_file"
    | "pasted_text"
    | "manual_user_input"
    | "project_material"
    | "work_summary"
    | "certificate"
    | "external_context"

  source_title?: string
  source_span?: SourceSpan

  supports_claim_id?: string
  support_level:
    | "direct"
    | "partial"
    | "inferred"
    | "contradicted"
    | "none"

  extracted_text?: string
  normalized_fact?: string
  confidence: number
  user_confirmed: boolean
  created_at: string
}
```

规则：

- `external_context` 不能证明用户做过某件事。
- `external_context` 只能用于岗位、行业、公司语言参考。
- 数字、规模、主导性表达必须重点校验。

## 10. Resume Agent 编排

```text
SourceParserAgent
读取旧简历，提取文本、段落、标题、列表、时间线。

PackRouterAgent
判断这是 resume pack。

ResumeStructureAgent
拆成 BasicInfo、WorkExperience、ProjectExperience、Skills 等模块。

CareerFactAgent
抽取事实、经历、技能、成果、时间。

ClaimExtractorAgent
把关键表达拆成 Claim。

IssueDetectorAgent
发现空泛、缺证据、重复、技能无支撑、时间线不清等问题。

ResumePlannerAgent
决定新版草稿的模块顺序、取舍、表达策略。

ClaimWriterAgent
生成新版模块内容和 bullet。

EvidenceVerifierAgent
检查新版 Claim 是否有来源或需要用户确认。

CoachNarratorAgent
生成用户能看懂的改稿说明和问题卡。

DraftRenderer
把结构化 DraftVersion 投影成默认模板预览。
```

## 11. 导入旧简历后的标准输出

一次 `import_reconstruct` 必须输出：

```text
DraftVersion
新版结构化草稿。

ResumeModule[]
模块列表和模块状态。

RevisionIssue[]
待处理问题卡。

RevisionProposal[]
修改方案。

EvidenceLink[]
证据关系。

RenderProjection
用于前端显示的 HTML / doc_json。
```

前端不消费“一段 AI 分析”，而是消费这些可操作对象。

## 12. 交互落点

Resume Pack 在改稿工作台里体现为：

```text
新版简历草稿为主
待处理事项为侧边任务
旧简历和来源材料按需打开
局部对比用于确认修改
输入框只用于补充事实或表达偏好
```

用户不需要问“怎么优化”，系统直接给出下一步。

## 13. 导出规则

1. 导出必须基于 accepted DraftVersion。
2. blocking issue 未处理时默认不允许导出，除非用户显式确认风险。
3. 缺证据强主张必须确认、降级或删除。
4. PDF 只包含用户可见并确认的内容。
5. 默认模板应专业、克制、ATS 友好。

