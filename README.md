# 我们俩

基于 uni-app x Vapor 的双人私密 Android 应用，包含账号登录、聊天、想你、共同相册、笔记和设置。支持本地演示模式；演示数据只保存在本机，不会同步给另一个人，也不适合存放敏感数据。

## 已实现

- 聊天输入内置 16 个 emoji 和 4 个专属贴纸，可发送文字与贴纸。
- 云端聊天缓存最多保留 500 条，并按 Supabase 项目地址和当前账号隔离；同步使用增量补拉，较早消息可继续分页加载。退出时清理当前会话缓存。
- 相册图片每批最多 9 张；视频每次 1 个，仅支持 MP4。单文件最大 50 MiB，云端 Storage bucket 同样限制文件大小和 MIME 类型。
- 笔记可导出 Markdown。原生端使用 UTF-8 写入应用目录并等待写入完成；失败会明确提示，提供复制内容作为备份的选项。Web 端触发浏览器下载。
- 设置中可修改登录密码；今日想你记录可统计，笔记可按全部、私密或共享筛选。
- 私密笔记仅作者可读，共享笔记对两位成员可读；相册对象位于私有 bucket。

## 运行与连接 Supabase

在 HBuilderX 打开本目录并运行到 Android。配置云端前可从登录页进入本地演示。

Supabase 初始化、账号白名单、权限和接口说明见 [supabase/README.md](supabase/README.md)。新项目使用 `supabase/setup.sql`；已初始化且已有用户及数据的项目，使用 `supabase/migrations/20261124_media.sql` 增量添加媒体字段和限制。该迁移不删库、不重建表、不删除已有用户或数据。前端连接只需项目 HTTPS URL 与 anon/publishable key，绝不要将 `service_role` 或 secret key 放入客户端。

当前没有连接远端 Supabase，也没有执行远端 SQL 或验证线上 RLS；需要按部署文档在目标项目执行并实际验收。Realtime 仅在应用活跃、连接存续时用于同步，不等于 Android 后台推送。

## 后台通知

当前未实现后台推送。面向国内 Android，建议优先评估 DCloud uni-push，并配置适用的厂商离线推送通道，不把依赖 Google 服务的 FCM 作为默认方案。建议链路为 Supabase Database Webhook 将业务事件通知受信任的服务端或 Edge Function，再由该服务端调用 uni-push 服务端接口；不需要因此强制把 Supabase 迁移到 uniCloud。

真正接入前还需开通 DCloud 推送服务，完成应用包名、签名和相关厂商通道/资质配置，并让客户端注册、上报 CID。服务端密钥只存放在服务端密钥管理环境，不得写入 App。具体边界、数据绑定和交付验收建议见 [docs/background-notifications.md](docs/background-notifications.md)。没有推送凭据与配置时，不发送通知，也不应宣称功能已完成。

## 编译与验收状态

项目曾通过 HBuilderX 5.34 Android Vapor 编译。近期样式 CSS 警告正在修复，最终编译验证尚未完成；也没有完成真机验收。Supabase 登录、RLS、媒体上传下载、双设备 Realtime、后台推送均未完成线上/真机验收。编译通过不代表这些功能已验收。
