# 我们俩

基于当前 uni-app x Vapor 工程实现的双人私密 Android 应用。提供登录、想你、聊天、照片、笔记、设置。页面采用暖纸色与陶土色，适配手机及宽屏。

## 运行

在 HBuilderX 打开本目录，运行到 Android 设备。未配置 Supabase 时，可在登录页进入本地演示；演示数据只在本机，不会发送给另一个人。演示没有真实认证，不应用于存储敏感数据。Web 演示图片使用临时地址，刷新后可能失效。

## 连接云端

1. 按 `supabase/README.md` 创建项目、关闭公开注册、执行 `supabase/setup.sql`、手工创建两个邮箱账号并维护两条成员白名单。
2. 登录页点击“连接 Supabase 项目”，填写 HTTPS 项目 URL 与 anon JWT 或 publishable key。不要提供 service_role 或 secret key。
3. 使用预置账号登录。应用通过 uni.request、uni.uploadFile 和 WebSocket 接入 Supabase；没有依赖浏览器 fetch 的 SDK。
4. 使用两部手机验证消息、想你、私密/共享笔记、上传下载和权限。实时连接状态只表示订阅状态，不代表对方在线。后台及离线无推送，恢复前台或每 30 秒补拉数据。

## 笔记与照片

笔记默认 private，只有本人编辑删除，对方可查看 shared。Markdown 导出包含当前账号有权读取的所有分页笔记；Android 写入 `uni.env.USER_DATA_PATH` 应用目录，当前未提供系统“另存为”或文件分享入口，卸载应用会丢失沙盒文件。Web 触发浏览器下载。

照片放在私有 photos bucket，通过用户令牌下载。保存操作写入手机相册，需授权。云端清理只允许上传者，清理前应先保存到手机。演示数据与正式云数据相互独立。

## 页面结构

`pages/index/index.uvue` 负责应用壳、主滚动区、导航和页面生命周期；`pages/index/components/` 按登录、首页、聊天、相册、笔记、设置及弹窗拆分视图；`pages/index/composables/usePairApp.ts` 集中管理页面状态、业务操作和同步清理，`composables/context.ts` 将同一页面实例注入子组件。多面板共用样式维护在 `pages/index/styles/shared.css`，面板独有样式留在组件内。新增页面面板时，在对应组件中通过 `usePairContext()` 取用所需状态和操作，并由页面壳添加原有 tab 条件分支。

## APK 云打包

1. 登录 HBuilderX 的 DCloud 账号，确认 `manifest.json` 中的真实 AppID（当前已配置）。
2. 在发行的 Android 云打包界面设置固定包名，例如 `com.yourname.justus`，确认后不要随意更改。
3. 配置应用图标与签名。自用测试可使用公共测试证书，长期更新建议固定自有证书并妥善保管。
4. 先运行到 Android 验证，随后通过“发行 → 原生 App 云打包 → Android”生成 APK，并用两部手机验收。

## 当前验证状态

2026-11-23 用户已完成 Supabase 初始化及 AppID 配置。随后使用 HBuilderX 5.34 对 Android Vapor 字节码目标进行了真实编译，修复 display:block、百分比 max-width/max-height 和 scroll-y 的兼容警告后再次编译成功，最终日志未再出现上述警告。

同日完成页面模块拆分后，14:29:57 再次通过 Android Vapor 字节码编译，入口页及九个子组件均编译成功，日志未出现组件或样式警告。拆分后的登录布局、聊天滚动定位和弹窗交互仍需真机复测。

验证命令：`cli.exe launch app-android --project <本项目路径> --compile true`。这是仅编译检查，编译结束停止运行属于正常行为。尚未在真实设备验证 Supabase 登录、RLS、上传下载及双设备 Realtime，也未生成发行 APK。请勿将编译成功或本地演示视为正式上线验收。
