# 语音输入可靠性复核（0.1.5）

本次对照本地 `deepseek-harness` 的语音 Provider、录音生命周期和设备选择实现，核查 TypeDance 的对应行为。参考代码用于识别边界条件，不代表另一产品已在同一设备上验证通过。

## 已确认的问题

实际麦克风的 2.664 秒“你好呀”录音音量正常，0.1.4 的 VAD 返回零分段，因此 Host 返回空文字；同一段完整录音直接识别正确。修复后使用同一录音，在通用 Provider 和真实 Windows SEA Host 中分别连续两次返回“你好呀。”。实际录音仅在本机内存中处理，诊断结束后关闭服务，不保存到仓库、磁盘或云端。

`deepseek-harness` 的 `d6042ca0d7` 提交修复了冷启动 VAD 丢失首段开头的问题，首段最多补回 300 ms；它当前的零分段路径仍返回空文字。TypeDance 的短录音现在保留完整音频，常规检测漏检时同时检查动态前景和短语音证据，不直接把静音交给识别模型。

## 对照结果

| 边界 | 参考位置 | TypeDance 的处理 |
| --- | --- | --- |
| 冷启动首段丢字、连续分段重复 | `speech-to-text-sensevoice/src/inference.ts`、`tests/inference.spec.ts` | 长录音只给首段补回最多 300 ms；后续段不重复补回；短录音按完整声音识别 |
| 短句零分段 | 同一 Provider 的空结果路径 | 增加动态前景与短语音联合检测；真实麦克风和打包 Host 已复现并验证修复 |
| 空结果被丢弃 | `client-ui-voice-input/src/client/VoiceInput.tsx` | 空结果和转写错误保留完整录音，可重试或取消 |
| 设备选择、不可用设备、授权前隐藏名称 | `MicrophonePicker.tsx`、`audio.ts` | 设置页显式选设备，按精确 ID 采集；设备缺失不自动换设备；未知身份不误判为断开 |
| 预览长期占用设备 | `MicrophonePicker.tsx` | 仅点击测试后采集；隐藏页面、关闭面板或停止测试即释放，不自动恢复采集 |
| 授权晚于取消或卸载 | `audio.ts`、`tests/audio.client.spec.ts` | 用当前操作身份拦截迟到授权并立即停止返回的 tracks |
| 拔掉设备、录音器异常 | `audio.ts` | 明确处理音轨结束、AudioWorklet 处理异常和 AudioContext 中断；停止设备，不发送残缺录音 |
| 停止时最后一块音频未确认 | `audio.ts` 的最终数据等待 | 等待 Worklet 收尾确认；超时失败，禁止将未完整收尾的数据提交转写 |
| 采集设备采样率不同 | `audio.ts` 的离线重采样 | 当前 Web Audio 将设备输入重采样为 16 kHz；实际 48 kHz 设备到 16 kHz Context 已验证，未重写采集引擎 |
| 页切换、会话切换、取消 | `VoiceInput.tsx` 的 generation/lifetime | 当前对话身份守卫、AbortSignal 和设备释放已有覆盖，并继续回归验证 |
| Native 缓冲与进程生命周期 | Provider 的推理与 worker 实现 | 复制 VAD 缓冲、私有 IPC、可终止独立进程、单任务准入和空闲回收已有实现 |
| 下载失败、缓存和完整性 | Provider 的 installer | 固定 revision、大小、SHA-256；完整文件复用、取消清理半成品；用户显式选择下载源 |

浏览器设备选择和采集属于 Frontend；推理、语音分段与进程资源属于通用 `harness-speech`；Host 负责持久化语音偏好和保护 HTTP 接口，Sidecar 不参与 AI 编排。

## 发布验证

安装后通过真实 Host 执行清晰短句、3% 音量短句、连续重复，以及静音、平稳噪声、单音、直流偏移和孤立点击声控制测试。测试失败会阻止安装包发布。模型与 0.1.4 相同，可复用已下载文件。
