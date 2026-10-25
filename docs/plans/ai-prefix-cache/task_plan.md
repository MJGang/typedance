# AI 缓存与性能优化计划

## 目标
持续对照本地 DeepSeek Harness 源码，改善 TypeDance 多轮对话、资料变化和工具调用的前缀复用，以真实 DeepSeek 请求证明收益。

## 阶段
1. 已完成：源码对照、官方 API 文档和基线场景。
2. 已完成：单一请求与历史构造路径，前缀稳定性和正确性测试；Core 64 项、Host 105 项通过。
3. 已完成：Off 双组及 Low 真实模型对照，磁盘重建、工具、计划及压缩纠偏验证，结果记录于 docs/verification。
4. 已完成：本机完整验证和源码自查。
5. 远端交付：commit、PR、CI、合并与主分支快进按默认交付流程执行；实时结果以关联 PR 和最终交付记录为准。
6. 用户追加授权：发布 v0.1.7，完成签名、公开安装包/更新清单及安装运行检查，并单独说明升级验证范围。

## 约束
- 不改动主工作区的 .gitignore 和 output/；使用 codex/ai-prefix-cache worktree。
- Harness Core 只承担通用消息、循环、检查点；Agent Host 负责 TypeDance 资料与提供商协议。
- 凭据不写入文件、日志、报告或 Git。
- 不以重复相同请求的缓存替代多轮与动态资料场景证据。

## 已遇到的环境问题
- rtk proxy 不能直接执行 PowerShell cmdlet；改用 powershell -Command 单引号传入完整脚本，避免二次展开。
- CodeGraph 宽查询输出过大；改用准确文件/符号查询。
