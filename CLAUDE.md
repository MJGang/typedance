# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

TypeDance — 本地优先的 AI 简历优化工具。核心工作流：TipTap 富文本编辑 → 模板套用 → PDF 预览/导出。

## 技术栈

- **前端**: React 19 + TypeScript + Vite 6 + TailwindCSS 4 + shadcn/ui (radix-nova)
- **后端服务**: Python 3.11+ / FastAPI / SQLite / WeasyPrint
- **桌面端**: Tauri 2 (Rust) — 尚在搭建
- **包管理**: pnpm 10 (monorepo workspace)
- **测试**: Vitest（前端单元测试）、Playwright（E2E）、pytest（Python）

## 目录结构

```
apps/web/          # React SPA，主要前端
  └─ src/
     ├─ components/ui/    # shadcn/ui 组件
     ├─ features/
     │  ├─ workspace/     # 简历编辑工作台（编辑器、面板、布局）
     │  └─ templates/     # 模板库（浏览、样式配置、样张编辑）
     ├─ api.ts            # Sidecar API 调用层
     └─ App.tsx           # 根组件，持有全局状态
apps/desktop/       # Tauri 桌面壳（待完善）
packages/contracts/ # Zod schema 定义，前后端共享类型
packages/resume-renderer/ # TipTap JSON → HTML 渲染
services/sidecar/   # Python FastAPI，持久化 + PDF 导出
  ├─ src/typedance_sidecar/
  │  ├─ main.py          # FastAPI 路由
  │  ├─ models.py        # Pydantic 模型（镜像 contracts schema）
  │  ├─ db.py            # SQLite 存储（Resume/Template/Setting Repository）
  │  ├─ pdf.py           # HTML → PDF 生成（WeasyPrint）
  │  └─ template_policy.py # CSS class 校验策略
  └─ tests/
docs/               # 需求、设计、产品愿景文档（中文）
```

## 架构要点

1. **Contracts 驱动**: `@typedance/contracts` 中的 Zod schema 是唯一事实源，Python 侧用 Pydantic 镜像相同结构，保证前后端类型一致
2. **本地优先**: 无云后端，数据存 SQLite（`~/.typedance/typedance.sqlite`），Sidecar 负责持久化和 PDF 生成
3. **TipTap JSON 为内容主格式**: 简历内容以 TipTap doc_json 存储，plain_text_snapshot 作为回退展示
4. **模板样式 = CSS class 组合**: 模板样式定义为 Tailwind class 字符串，通过 `pdfClassPolicySchema` 校验合法性后再写入 PDF

## 常用命令

```bash
# 安装依赖
pnpm install
pip install -e ".[dev]"  # 在 services/sidecar 下执行

# 本地开发（并发启动 web + sidecar）
pnpm dev

# 构建（顺序: contracts → resume-renderer → web）
pnpm build

# 运行所有单元测试
pnpm test

# 运行单个包的测试
pnpm --filter @typedance/web test
pnpm --filter @typedance/contracts test
pnpm --filter @typedance/resume-renderer test
pnpm --filter @typedance/sidecar test

# E2E 测试（Playwright）
pnpm --filter @typedance/web test:e2e

# Lint
pnpm lint

# 单独启动 sidecar（端口 4317）
pnpm --filter @typedance/sidecar dev

# 单独启动 web（端口 5173）
pnpm --filter @typedance/web dev
```

## 开发规范

- **Commit 格式**: `type(scope): 中文描述`（详见 AGENTS.md）
- **文档语言**: 默认中文（需求、计划、评审记录等）
- **组件开发**: 优先使用项目中已有的 shadcn/ui 组件（位于 `@/components/ui/`），`@/` 指向 `apps/web/src`
- **API 调用**: 通过 `apps/web/src/api.ts` 中的类型安全函数与 Sidecar 通信
- **新包添加**: 编辑 `pnpm-workspace.yaml`，工作区目录为 `apps/*`、`packages/*`、`services/*`
- **Context7**: 任何框架/库/SDK/API 的使用必须通过 Context7 查询最新文档，禁止凭记忆编写（详见 AGENTS.md）

## 注意

- 使用中文进行思考，和输出，因为我的母语不是英语