# Agent FM 的共处接口草案

2026-11-05。产品目标是人与自己的 Agent 在同一空间共处。人通过网页听、看、计时、邀请对话；Agent 通过 CLI 获取受授权的上下文、准备内容、回应邀请。CLI 已有安装和启停能力，本稿扩展产品能力。下文保留整体设计方向；末节列明本次已实现的命令与暂未提供的能力。

## 参考依据

检查了 EigenFlux cli/main.go、cli/cmd、cli/internal 的实际结构，以及 mainbridge/README.md、maintenance/README.md。入口和能力模块分离，宿主与会话绑定明确，事件有保留窗口、去重和重试边界。飞书 CLI 的 --help 与 schema 展示了任务捷径、命令契约发现、风险标记和 dry-run。飞书源码未检查，因此只借鉴已验证的命令接口。

FM 的现状是 src/cli.ts 管理服务，src/server.ts 承载网页接口，domain/store 处理本机状态，codex/engine 绑定陪伴宿主。继续复用这些模块，逐步把共享业务操作从 HTTP 路由抽出，网页与 CLI 走同一层操作和校验。

## 文化内容与品味

内容覆盖由具体作品、声音及其适用场景驱动。保留年代、地区、语言、媒介、亚文化和来源元数据，支持当代独立音乐、游戏配乐、动画、电子音乐、摄影与数字艺术。文化标签用于发现，不把国家等同于单一风格。先验证工作时适听、资料可信、播放稳定，再考察轮换中的年代与媒介多样性。

编选库提供稳定体验。Agent 可准备带来源的候选节目，保留原文，提出简短编选理由。事实与解释分别标明，验证只检查结构、来源和播放能力，不能把它当事实真实性证明。Agent 制作的节目先进入待选区，用户选择或开启明确的自动编排后才进入下一组。正在播放的节目不因后台准备而替换。

## 使用流程

接入时确认交流语言，产品以英语为默认和兜底语言，不从姓名、国家或当前开发者的语言推断用户偏好。浏览器/宿主语言只作为建议。保存用户确认值，设置与 CLI 均可更改。作品原文与交流语言独立保留。会话绑定明确记录宿主、原会话 ID、能力与上下文权限；当前仅实现 Codex，保持原 FM 会话。未来宿主适配遵循同一契约。

一次邀请带上当时的节目、事实来源、语言和有界 FM 活动快照。邀请具有持久 ID，明确 queued/running/completed/failed/uncertain。切换节目后仍能知道回答指的是哪一组。自动收集本机活动不发起模型请求；用户邀请才触发回应。

## 候选命令

- fm open / status / doctor / autostart，服务生命周期。
- fm capabilities / schema <command>，查询当前版本能力、参数、输出及副作用。
- fm language get / set，确认并调整交流语言。
- fm companion status / bind，查看与明确绑定宿主会话。
- fm context read，读取当前节目、计时状态及允许的近期活动。
- fm events watch --after <cursor>，消费持久事件，断线按游标续读。
- fm program validate / prepare / list / select，验证候选、保存准备、列出与选择节目。
- fm invitation get / reply，宿主读取邀请与提交回应。

首批增加 language、context、capabilities；第二批把现有 Codex 路径接到 invitation；第三批增加 program。其他宿主在至少一个端到端接入验证之后才标记支持。保留旧命令兼容入口。

## 工程边界

使用当前 TypeScript 工程。建议按 cmd、application、adapters、content 逐步拆分，已有模块无需一次全部迁移。CLI 通过鉴权本机服务写入，避免与运行中服务并行直接改 SQLite。模型、网络解析放在状态事务之外。结构化 stdout 输出版本、数据和稳定错误码，stderr 放诊断。高影响操作支持 dry-run、明确参数和用户授权语义；日志不写凭据与聊天全文。

邀请与内容提交使用幂等键，事件有序号、游标与保留策略。游标过期明确请求重新读快照。升级保持会话、语言和数据兼容；恢复不重复播音或重复推理。禁用和卸载有确定语义。发布产物同时版本化 CLI、协议、Skill、网页和数据库迁移，保留一版可回退程序。

## 验收

用真实使用任务检查首次语言确认、切换语言、启动恢复、邀请上下文、失败重试、多个 Agent 竞争回应、候选失效与当前播放保护。单元测试验证领域状态，契约测试检查 CLI/HTTP 一致性，隔离宿主集成验证会话恢复，浏览器验证实际用户流程。安装、升级、停用、卸载单独验收。程序通过测试后仍需一个完整番茄的实际使用观察。

## 已实现的首版 CLI

命令入口为安装记录 location.json 中的 Node 与 launcher。以下命令输出 JSON，错误写到 stderr 并以非零状态退出。

- capabilities；schema "context read"（也可分成两个参数），无需服务即可查看契约。
- language get / set <BCP47>，复用网页设置的版本检查。
- companion status，读取现有绑定，首版不支持外部宿主抢占。
- context read，当前会话、最近 30 条事件及最多 6 次 FM 交流。
- events read [--after <cursor>]，分页最多 50 条，返回 cursor 和 hasMore。删除造成旧游标失效时返回 CURSOR_EXPIRED。
- invitation create，stdin JSON {id,text}；invitation get <id>。调用者提供稳定 ID，同 ID 同内容可重试，不同内容冲突。
- program validate / prepare，从 stdin 读取节目草稿；program list；program select <id>，排入下一钟。

当前没有 events watch、external invitation reply 或 companion bind 命令；capabilities 明确 externalReply:false 和 externalBinding:false。当前首版继续复用现有持久 Codex 会话。后续宿主协议接入之前不宣称这些能力。
