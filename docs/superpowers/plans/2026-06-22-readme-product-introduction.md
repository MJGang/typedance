# TypeDance README 产品介绍实施计划

> 对应设计：`docs/superpowers/specs/2026-06-22-readme-product-introduction-design.md`

## 目标

在仓库根目录创建面向外部读者的 `README.md`，集中介绍 TypeDance 的产品定位、核心体验、典型流程、产品原则和当前阶段。

## 内容边界

- 只写产品，不写架构、代码、技术栈、目录或开发命令
- 以当前产品文档和可见界面为事实依据
- 将现有能力与长期方向明确区分
- 不使用夸张承诺，不把 TypeDance 描述成一次性简历生成器

## 执行步骤

### 1. 核对产品事实

重点回读以下文档：

- `docs/product/ai-native-revision-system.md`
- `docs/product/resume-pack-prd.md`
- `docs/product/revision-workspace-design.md`
- `docs/product/current-to-target-gap-map.md`
- `docs/product-vision.md`

同时检查当前界面入口与相关测试，确认导入、工作台、AI 对话、资料上下文、模板与导出等能力的真实状态。

### 2. 创建产品型 README

按照设计说明组织正文：

1. 产品定位与价值主张
2. TypeDance 解决的问题
3. 结构化改稿方法
4. 核心产品体验
5. 典型使用流程
6. 产品原则与适用人群
7. 当前阶段与产品方向

### 3. 真实性复核

- 删除无法从当前产品或文档中证实的功能描述
- 检查目标能力是否被误写成已完成功能
- 检查内部术语是否提供用户视角解释
- 检查是否意外写入技术或开发内容

### 4. 文档验证

- 检查 Markdown 标题层级和格式
- 检查仓库内链接是否存在
- 运行 `git diff --check`
- 复核最终差异只包含本次 README 相关文档
