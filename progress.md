# 用户系统进度

## 当前状态（以此节为准）

- 可配置账号实现已落入隔离工作区，本机分层验证已通过；下方保留的是实施过程记录。最终验证边界见 docs/account-validation.md。
- 登录 UI 按用户最终要求改为约 480 × 640 原生小窗口，项目蓝色折纸 T 原图标、浅蓝灰至白色背景，无左侧面板或独立标题栏，最小化/关闭融入内容右上角。渠道顺序为微信、Google、GitHub；登录后恢复工作台窗口。
- imagegen 内置工具生成视觉稿；实际 UI 为原生可交互组件组合，项目图标直接复用原文件，不把生成图当登录页面。
- 当前未创建 Logto 云资源，真实 GitHub/Google/微信和真实 BYOK 仍待公开应用配置及用户授权的测试条件。
- 最终复核：Host 174、Web 462、Python 291（另 1 skip）、基准脚本 2、发布脚本 18、Rust 14 项通过；最终 UI 构建、release 编译检查、ESLint、Maia 及格式检查通过。统一脚本的本机超时与分段复核如实记录，不把失败执行记为成功。
- 原生启动复核确认真实主窗口可见且为 480 × 640，WebView2 已启动，未登录时业务服务为 0、未创建 profile，退出无子进程残留。探针已排除零尺寸系统辅助窗口。源配置不再隐藏启动窗口；本机构建目录的完整性标签已局部修正。
- 默认仓库交付按提交、PR 当前 head CI、自查、合并与安全同步继续；远端结果由 PR 和最终交付记录，不以本地计划代替检查证明。
- PR #36 首次完整 CI 通过。自动评审提出保存失败后聊天仍指向已取消运行的问题，已补两项先失败后通过的回归，用真实活动暂停/恢复通知重新加载运行并重建订阅，专项 62 项通过；后续合并以修复提交的 CI 为准。

## 2026-10-29

- 用户确定 Logto Cloud，GitHub、Google、微信，暂不做手机号。
- 用户确定必须登录后进入工作台，资料与对话按账号保存在本机。
- 用户确定 BYOK，模型费用由用户自行承担。
- 用户新增微信本机已登录时免扫码确认的体验要求。
- 已核对官方微信文档、Logto 连接器与托管登录页源码；只建立可行性证据，未实际登录。
- 用户此前明确要求先讨论清楚，当前尚未进入业务编码。
- 在独立 worktree E:/workspaces/typedance-account-identity、分支 codex/account-identity 整理方案。
- 主工作区原有 .gitignore 与 output/ 内容保持不动。
- 创建 task_plan.md、findings.md、progress.md 和可评审实施文档。
- 尚未创建云资源、读取真实凭据、修改业务代码或进行 Git 远端写入。
- 本次只校验文档内容和工作区改动范围，不运行与文档无关的应用测试。
- 只读评审提出三处必要补充：卸载重装、旧明文 Key 的清理、profileKey 与授权的区别；均已修正文档。
- 用户明确准备完成后要切换其他模型编码，已补充编码交接章节；本模型不开始业务实施。
- 四份 UTF-8 Markdown 文档通过空白与文件结尾检查；隔离 worktree 中只有四份未跟踪文档。
- 最终只读检查另观察到主工作区 Cargo.toml 有改动；未查看内容、未编辑，已在交接中列为需保留的其他工作。
- 用户随后撤回切换模型决定，明确授权当前模型开始编码；原先只讨论的限制已解除。
- 用户确认尚未创建 Logto，先完成可配置实现；Native 是客户端类型而非付费套餐，已核对当前免费应用名额。
- 集成分支已从 e19cc0b 快进同步到 origin/main 4c14e57（0.1.13），保留全部方案文件与主工作区其他改动。
- 并行分支：codex/account-desktop、codex/account-services、codex/account-web；根负责集成、离线迁移及验收。
- 已统一AccountState、Tauri命令和服务端鉴权协议，新增providers与locking/finish_account_lock，以便会话过期先保存再锁定。
- Rust提供仅当前profile可用的私有凭据broker，Host通过CredentialStore调用，不再落地auth.json或继承共享环境Key。
- 根已新增generic SQLite一致快照/文件迁移模块及安全测试，并将root dev入口改为只启动桌面，账号服务由桌面协调。
- 工具路径已实测：Node D:/apps/nodejs/node.exe，Python D:/Python/Python314/python.exe，cargo C:/Users/51149/.cargo/bin/cargo.exe。部分PATH命令发现和npx联网长时间等待，优先使用绝对路径。
- 三个子智能体随后都遇到会话用量限制，未完成提交。根已将各自分支中51个本任务文件复制到集成worktree，继续补齐；不要再覆盖根已补写的文件。
- 根已补写Rust account/mod.rs（身份与会话协调）、改造runtime的账号启动与私有端口、lib命令注册及updater异步恢复。此部分尚待编译和真实运行，不报告完成。
- 迁移专项测试：12 passed，1 skipped（当前进程无Windows符号链接创建权限）。
- Python全量测试先因两个修改测试文件的BOM位置错误无法收集，已修复；重跑为274 passed、6 failed、1 skipped。失败集中于Markdown转换与revision API，待依赖构建完成后读取具体错误并修复，尚不能判定既有问题。
- 根pnpm安装947包完成，耗时40分49秒。node_modules只在集成worktree，外部分支尚未确认安装状态。
- Cargo fetch已更新锁文件。首次cargo check因ring的MSVC D8050失败，正在使用工作目录TEMP/TMP与-j2重试，不修改全局环境。
- 当前运行验证session：cargo check 55806（本地TEMP）；根pnpm build 12676。旧36953失败、43248/68859为已完成Python结果；2724依赖安装已完成。
- 用户询问是否需要TypeDance官方服务，已解释当前方案无需自建官方业务后台：Logto托管身份，Sidecar/Host和BYOK仍在用户电脑；此问题未取消编码授权。


- 集成初次Rust开发检查已通过；完整Rust单测首次编译进行中。Web构建首次因系统TEMP的esbuild AccessDenied失败，改用worktree TEMP/TMP继续，不把环境失败当作功能通过。
- 子智能体恢复可用，已重新分工到同一集成树的不同文件范围：Web认证/保存测试，Host与Sidecar/路径迁移，release脚本。根负责Rust生命周期、旧资料认领和离线撤销。
- 已补资料认领收据，先认领后复制，原备份不会再次分配给别的账号；旧明文模型凭据及PID临时副本不进入迁移目标。
- 已补系统安全存储中的待撤销token及无秘密公开索引，联网重试；修正取消后服务发布ready、更新失败解锁锁定账号、taskkill只启动不等结果、Host关闭失败仍继续运行等自查问题。
- docs/account-setup.md记录Native回调、公开配置和验收边界；真实Logto/三方平台与真实BYOK尚未验证。

- 最终自查补齐AI保存前pause/resume（暂停新run并等待取消、保存失败可恢复），编辑桥拒绝暂停前已取到的迟到请求，更新安装复用保存暂停门槛。锁定首次保存失败后可显式重试。
- 已修复重复托盘退出/已locking退出绕过保存，以及待导入长时间停留后过期身份激活的问题；已验证可信身份由Current先接管，初始化失败可撤销新grant。
- 第一轮Rust单测14/14通过，包含Windows真实凭据读写删除；需继续复核最后自查改动。Host保存关闭4例在统一顺序验证中通过。Web浏览器未配置gate已截图，Maia已由shadcn info --json确认。
- 根统一verify:change正在运行，build已通过，Host测试进行中。不能将该进度表述为整套/PR已通过。

- 会话刷新中断前台验证，因此已实际创建脱离工具会话的本机验证进程PID 21628，按顺序写入.cache/typedance-verify/verification-result.json与各阶段日志。Web最终单worker全量461/461通过（277秒），原5秒阈值保持不变；Host之前170/170通过。后续Python/发布脚本/Rust/原生检查继续按该结果文件审计，不凭进程已启动宣称完成。

- 用户要求用imagegen重新设计登录页；已读取并使用内置imagegen技能，生成双栏纸张氛围概念稿和独立背景图。素材已复制到apps/web/public/images/account-welcome.png，Google/微信SVG从Logto官方连接器取得；仅展示层重做，认证门槛保留。
- 发布健康脚本确定故障已修：Start-Process的ShellExecute创建前挂起，改为ProcessStartInfo直接启动及子环境token；保持原45秒外层预算，18/18发布测试通过。根顺带修正health token为URL-safe，以符合实际服务格式校验。
- 最新Rust单测14/14和release配置cargo check通过；当前独立进程19656正在构建原生gate验证程序。真实Logto和三方登录未验证。
