15:24–15:40 左右：你在 Pages 的变量和 KV 绑定变更后，生产环境未完整生效；机器人能发消息，但 Telegram getWebhookInfo 显示 webhook 返回 500。
15:55 前后：我在新版里引入了管理员命令和折叠按钮，代码中先使用了 normalizedText 再声明，导致回调处理时抛错 ReferenceError，触发 Telegram 的 “Wrong response from the webhook: 500”。这是主要卡住点。
15:57–15:59：你清理/重设 webhook，Tail 开始有请求，但仍报同一异常。
16:00–16:05：我调整消息处理顺序，先调用 isCommandForThisBot 获取 normalizedText，再进入管理员命令和普通命令分支；同时你在 CF 把变量（BOT_TOKEN、ADMIN_TG_ID、KV 绑定等）确认在 Production 生效。错误消失。
16:06 以后：功能恢复，订阅查询正常返回；Functions Tail 只剩常规 200 记录，Cron Worker 与管理接口也可用。
结论：卡住的根因有两点叠加
代码层：normalizedText 使用顺序错误（已修复）。
配置层：Pages 变量/KV 未在生产环境即时生效，期间 webhook 报 500；重新部署和重设 webhook 后恢复。