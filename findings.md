# 用户系统研究发现

更新日期：2026-10-29。本文记录研究资料，不构成实施指令。

## 当前代码证据

- Python Sidecar 将数据库、资料副本、预览与导出放入 TYPEDANCE_DATA_DIR；当前没有账号归属隔离。
- Agent Host 在同一数据根目录加载对话库、检查点、模型配置和模型密钥。
- packages/agent-host/src/model-settings.ts:45-68：配置在 agent-host/config.json，密钥在 agent-host/auth.json，环境变量 Key 优先。
- 桌面 runtime 当前以应用级目录启动业务服务；账号隔离需要可信的桌面身份协调层。
- 前端 Agent Host 请求存在 401 后取新 token 重发的行为，换号后必须禁止旧账号请求携带新账号 token 重放。
- 自动保存、流订阅、录音、编辑审批及内存草稿均须与账号和会话生命周期关联。
- 上述为静态源代码审查结果，不是实际多账号验收结果。

## 官方资料核对

### Logto

- Cloud 租户有默认登录域名；用户仍需完成各第三方开发者应用申请及审核。
- 生产可使用 Free 方案；Dev 租户用户存在 90 天清理规则。
- 本次查阅时 Free 提供 3 个社交连接；高级安全功能和服务保障按套餐核对。
- 关闭自动账号关联后走手动关联；不能由 TypeDance 按邮箱或昵称自行合并用户。
- offline_access 场景中，end-session 不会默认撤销所有授权；退出须显式撤销刷新令牌并清本机登录状态。

来源：

- https://docs.logto.io/logto-cloud/tenant-settings
- https://docs.logto.io/logto-cloud/custom-domain
- https://logto.io/pricing
- https://docs.logto.io/end-user-flows/sign-up-and-sign-in/social-sign-in
- https://docs.logto.io/end-user-flows/sign-out

### 微信桌面扫码与快捷确认

- 官方微信网站登录支持 Windows 微信 3.9.11 及以上、Mac 微信 4.0.0 及以上的本机快捷确认。
- 条件为本机已登录符合版本要求的微信且未锁定；仍需用户确认授权，可选择其他账号或二维码。
- 官方文档对 Chrome 142 及以上的嵌入授权框说明了本地网络访问权限要求。
- 未查到供第三方桌面应用直接读取本机微信身份的公开状态 API；检测应由微信授权页面完成。
- Logto 官方 wechat-web 源码使用 qrconnect 与 snsapi_login；指南中的 snsapi_userinfo/base 与源码不一致。
- Logto 托管页面按是否注入 iOS/Android native bridge 选择连接器；Windows 外部浏览器走 Web 分支，不因 OIDC 应用类型为 Native 而选择移动连接器。
- 微信 AppSecret 在 Logto 服务端使用，客户端不携带。
- 这些证据支持方案可行性；尚未验证真实 Cloud 租户版本及完整微信登录。

来源：

- https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html
- https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html
- https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js
- https://github.com/logto-io/logto/blob/master/packages/connectors/connector-wechat-web/src/constant.ts
- https://github.com/logto-io/logto/blob/master/packages/connectors/connector-wechat-web/src/index.ts
- https://github.com/logto-io/logto/blob/master/packages/experience/src/utils/native-sdk.ts
- https://github.com/logto-io/logto/blob/master/packages/experience/src/utils/social-connectors.ts
- https://github.com/logto-io/logto/blob/master/packages/experience/src/containers/SocialSignInList/use-social.ts

## 尚无运行证据的项目

- 真实 Logto 登录、刷新、撤销及桌面回调。
- GitHub、Google、微信实际授权及取消、换号。
- 微信免扫码与不同浏览器权限条件。
- 账号隔离、模型 Key 安全存储、旧资料归属和换号故障恢复。
- 实施与发布尚未开始，不报告任何上述项目已经通过。
