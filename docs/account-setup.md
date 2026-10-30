# 配置 TypeDance 账号服务

TypeDance 使用 Logto Cloud 托管身份认证。桌面程序是 OAuth Native/public client，通过系统浏览器登录，无须部署 TypeDance 官方业务服务。Python Sidecar、TS Agent Host、资料、对话和模型调用仍在用户电脑上；模型 API Key 由用户在设置中填写，费用由用户承担。

## Logto 控制台

1. 创建适合正式使用的 Logto 租户，创建 **Native** 类型应用。Native 是应用类型，不代表付费套餐；套餐、额度及附加功能以控制台当前计费页为准。
2. 登记登录 Redirect URI：`http://127.0.0.1/callback`。客户端每次登录随机分配本机端口；Logto 对 Native 应用的 HTTP loopback 回调匹配会忽略端口，路径必须一致。无需开放防火墙公网端口，也无需给本机配置 HTTPS 域名。
3. 允许 Authorization Code、PKCE 与 refresh token / offline_access。不要给桌面程序放 App Secret。
4. 在 Logto 中配置 GitHub、Google、微信连接器，启用到登录体验中。保存各连接器的 ID，不能用第三方平台的 Client ID 代替。
5. 需要账号管理入口时，在 Logto 启用 Account API 与 Account Center；客户端打开同一租户的 `/account/security`。

第三方平台的 Client Secret / AppSecret 只填 Logto 控制台。Google 与 GitHub 开发者应用的公网回调填写 Logto 连接器页面给出的地址，它们与 TypeDance 本机回调是两段不同的流程。

Windows 原生认证请求遵循系统代理配置，并保持 TLS 证书、签发者和身份凭证校验。一次浏览器登录最多等待 10 分钟；取消或超时后，需要返回 TypeDance 重新发起登录，旧的本机回调链接不能复用。收到回调后，客户端先完整发送浏览器提示页，再关闭本次监听端口。

微信需要审核通过的网站应用及微信登录权限，网站信息、主体和授权域配置以微信开放平台实际审核要求为准，不能保证免审核或免域名资料。微信官方授权页在支持版本、已登录且未锁定的本机微信上可提供免扫码确认；不满足条件时由官方页面提供二维码与换号。TypeDance 不读取微信进程、会话文件或本机微信账号。该体验仍需要真实应用验收。

## 客户端公开配置

默认配置文件位于 Windows `%APPDATA%/app.typedance.desktop/account-config.json`。如系统实际应用数据目录不同，以 Tauri 的 app_data_dir 为准。文件内容：

```json
{
  "endpoint": "https://YOUR-TENANT.logto.app",
  "app_id": "YOUR-NATIVE-APP-ID",
  "connectors": {
    "github": "LOGTO-GITHUB-CONNECTOR-ID",
    "google": "LOGTO-GOOGLE-CONNECTOR-ID",
    "wechat": "LOGTO-WECHAT-CONNECTOR-ID"
  }
}
```

Endpoint 使用租户 HTTPS 源地址，不附加 `/oidc`、路径或参数。未准备好的连接器可从 connectors 删除。以上都是公开配置，不含管理令牌或模型 Key。未配置时客户端停留在账号服务配置提示，业务服务不会启动。

可用运行环境变量覆盖，或在构建时嵌入：`TYPEDANCE_LOGTO_ENDPOINT`、`TYPEDANCE_LOGTO_APP_ID`、`TYPEDANCE_LOGTO_GITHUB_CONNECTOR_ID`、`TYPEDANCE_LOGTO_GOOGLE_CONNECTOR_ID`、`TYPEDANCE_LOGTO_WECHAT_CONNECTOR_ID`。优先级为运行环境、构建配置、JSON 文件。修改文件后可在登录页刷新状态；修改运行环境或构建配置需重启。生产发行应嵌入同一套官方公开配置，用户无需自行创建 Logto 应用。

测试和隔离安装可用绝对路径 `TYPEDANCE_ACCOUNT_DATA_DIR` 改变账号资料根目录；此设置只改变本机存储位置，不跳过身份认证。开发环境可指定 `TYPEDANCE_PYTHON_BINARY`、`TYPEDANCE_NODE_BINARY`、`TYPEDANCE_CHROMIUM_PATH`，并预先安装项目依赖及 Playwright Chromium。运行根目录 `pnpm dev`，由桌面按登录状态启动业务服务。

## 登录窗口

登录页使用项目原版蓝色折纸 T 图标，采用约 480 × 640 的独立小窗口；屏幕可用空间不足时按可用工作区收紧尺寸。页面没有独立标题栏，最小化、关闭按钮位于内容右上角，顶部空白处可拖动窗口。已配置的渠道按微信、Google、GitHub 排列；未配置的渠道不展示。首个可用渠道采用黑色主按钮，其余为白色描边按钮；配置齐全时微信为首选入口。

可信账号进入 ready 后，原生层恢复工作台窗口；退出、切换账号或失效锁定完成保存后返回小窗口。locking 保存期间保留原窗口尺寸，避免编辑器在保存中重新布局。同一次运行中保留工作台的尺寸、位置和最大化状态。窗口外观不会改变身份判断或启动未认证的业务服务。

## 工作台账号入口

登录后，简历工作台和模板侧栏左下角常驻显示当前账号头像、昵称与登录状态。第三方未提供头像或图片加载失败时，显示昵称首字。点击入口可展开账号与安全、设置、切换账号、退出登录；账号与安全打开 Logto Account Center，常规设置保留 AI、语音输入和客户端更新。

发现客户端更新时，账号入口显示提醒，设置菜单显示“有更新”并直接打开更新页。退出和切换账号继续执行下述保存与服务停止流程；菜单不会绕过该流程。

## 本机资料与退出

- 通过验证的 issuer 与 subject 决定独立 profile；显示名称、邮箱、头像不会决定资料归属。账号相同且在同一台电脑重登，可重新打开该账号原有资料。
- 刷新凭据与模型 Key 保存在 Windows 凭据管理器，不写 auth.json，不从共享环境变量继承模型 Key。更换 Windows 用户或其他电脑不会自动取得本机资料和 Key。
- 退出或换号前先暂停新 AI 任务并等待已有任务结束，再保存所有已打开画布，最后停止原账号服务。保存失败时保留原工作区及重试入口。网络失效锁定也先完成保存；不会因为登录失败删除本机资料。
- 本机退出不删除账号资料。远端撤销失败时，待撤销 token 留在系统安全存储，程序运行期间及下次启动联网后重试；公开队列文件不含 token。浏览器中的第三方平台登录状态由相应平台管理。
- 历史未归属数据包括简历与画布、参考文件、AI 对话及设置，只在用户明确确认后迁入当前账号，先保留原数据备份并记录归属；开始后会锁定来源，失败时仅同一账号可重试原目录，完成前不能跳过进入含有部分数据的工作区。检测到多份历史来源时，在界面选择其中一份导入，不自动合并多个目录。未开始导入时，也可以暂不导入，保留所有历史数据并进入空的账号工作区。
- 历史模型 Key 只有在认领时才迁入系统安全存储，读回校验成功后清理原 auth.json 及其应用写入临时副本。外部真实资料文件只保留引用，不删除、不搬移。
- 模型 Key 与服务地址保存使用不含秘密的持久化事务标记。安全存储或配置写入失败、进程中断后，未完成事务会阻止模型 Key 被使用；重新填写 Key 保存或主动清除 Key 后才能恢复，避免把新 Key 发往旧服务地址。

账号分目录、服务能力令牌和系统凭据保护属于应用隔离。业务资料仍是本机文件，不能把它描述成对同一 Windows 用户管理员访问的加密保险箱。本期不提供云同步、平台 AI 代付、手机号登录或长期离线解锁。

## 验收边界

代码和自动化验证覆盖本机接口授权、请求隔离、保存门槛、迁移与系统凭据。当前未提供真实租户，不能将这些结果视作 GitHub、Google、微信生产登录已完成。实际启用前需验证各平台首次注册/重登、回调错误和超时、刷新撤销、账号管理、微信免扫码/扫码/换号、A/B 账号资料与模型 Key 隔离及真实 BYOK 调用。

官方依据：[Native 回调匹配实现](https://github.com/logto-io/logto/blob/master/packages/core/src/oidc/redirect-uri/index.ts)、[回调匹配测试](https://github.com/logto-io/logto/blob/master/packages/core/src/oidc/redirect-uri/index.test.ts)、[Logto Account Center](https://docs.logto.io/end-user-flows/account-settings/by-account-center-ui)。
