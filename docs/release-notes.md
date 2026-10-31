修复 GitHub 登录验证通过后，本机业务服务无法启动的问题。

- 修正桌面端本地服务令牌长度，解决“A desktop-issued local service token is required”弹窗及随后等待 60 秒超时。
- 保持 Python Sidecar、Agent Host 与前端的令牌安全校验，按账号隔离本机资料。
- 发布验收与正式登录使用同一个令牌生成器，并验证安装后的服务健康状态及无凭据、错误凭据的访问拒绝，避免测试令牌掩盖实际登录问题。
- 保留登录窗底部自动下载、安装和重启更新的交互；修复此问题不需要清空本机资料或先卸载旧客户端。

账号服务配置方式见[配置说明](https://github.com/MJGang/typedance/blob/v0.1.19/docs/account-setup.md)。业务数据仍按账号保存在本机，模型 API Key 由用户自行提供。
