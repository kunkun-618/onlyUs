# 双人私密 App：Supabase 后端部署与接口约定

适用于本项目 Android uni-app x Vapor。仅使用 Supabase Auth、PostgreSQL、Storage、Realtime；前端通过 HTTPS REST、`uni.uploadFile` 和 WebSocket 直接访问，不需要 Supabase SDK，也不需要 uniCloud。需求文件中的 SDK 示例不作为本交付的接入方式。本目录不修改任何前端文件。

## 1. 部署顺序

1. 在 Supabase 项目 Authentication 设置中关闭 **Allow new users to sign up**（公开注册），关闭不使用的登录方式及匿名登录，仅保留邮箱密码登录。
2. 在 Authentication → Users 手工创建两个邮箱密码账号，勾选自动确认邮箱或由管理员完成邮箱确认。记录各自 UUID；不要通过客户端注册。密码重置由管理员处理。
3. 新项目在 SQL Editor 中以 `postgres` 管理员完整执行 `setup.sql`，再填写成员。已部署且已有用户/数据的项目只执行 `migrations/20261124_media.sql`，它仅增量添加媒体字段及 bucket 限制，不删库、不重建表、不删除用户或数据。不要为已有部署重新初始化或清空数据。先建表和权限，再填写成员；此时成员表为空，任何客户端账号都不能读取业务数据。
4. 将下面的占位 UUID 和昵称换成真实值，在 SQL Editor 单独执行。不要把占位值直接运行：

   ```sql
   begin;
   insert into public.app_members (user_id, display_name) values
     ('替换为账号A的UUID'::uuid, '成员 A'),
     ('替换为账号B的UUID'::uuid, '成员 B')
   on conflict (user_id) do update set display_name = excluded.display_name;
   -- 必须正好两行；如有多余行先回滚并修正。
   select user_id, display_name from public.app_members;
   commit;
   ```

5. 检查 Storage 中 `photos` bucket 为 **Private**，单文件上限 50 MiB，允许 MIME 类型仅为 `image/jpeg`、`image/png`、`image/webp`、`image/gif`、`video/mp4`；检查 Realtime publication 包含 `messages`、`miss_you_logs`、`notes`、`photos`。保留 Supabase 默认 Storage 管理架构、API 角色授权和 `storage.objects` RLS，不要手动关闭其 RLS。
6. 在项目 API 设置获取项目地址和 **anon key**，交给前端；在 API 暴露 schema 中保留 `public`，不要暴露 `app_private`。使用下文的权限验收清单验证。

两人上限采用**管理员管理**，没有数据库硬性数量约束：`app_members` 仅管理员可写，客户端只有成员读取权限。管理员必须始终只维护两个 UUID；Auth 中即使存在第三个用户，只要未加入成员表，也不能访问本应用数据。不要添加第三名成员。更换账号时应先删除旧成员再插入新成员，并在 Auth 后台禁用旧账号。业务外键指向 `auth.users`，删除成员白名单不会删除其历史数据。直接删除有历史数据的 Auth 用户可能被外键阻止；更换成员不需要删除 Auth 用户。

`setup.sql` 面向新项目或本脚本已初始化的项目；重复执行不会清空表或重新填入成员，但会重新配置策略、触发器和授权。它不是既有生产项目的通用迁移脚本，业务表上的旧 RLS 策略会被替换。已存在用户与业务数据的项目按上一步只执行 `migrations/20261124_media.sql`，不要删除或重建数据库对象。

迁移文件 `migrations/20261124_media.sql` 仅适用于已经存在 `public.photos` 和 Supabase `storage.buckets` 的部署；先备份并在 SQL Editor 以管理员执行，再核对列、约束及 bucket 限制。它不删除用户、数据或表。全新环境执行 `setup.sql` 即可，不要执行任何删库/删表/重建操作。

已有 Storage 项目必须先检查 `pg_policies` 中 `storage.objects` 的其他策略。PostgreSQL 宽松策略按 OR 合并，任何允许所有登录用户访问的旧策略都可能绕过本脚本的限制。删除或将其严格限定到其他 bucket 后再上线；本脚本仅替换 `app_photos_*`，不会擅自删除其他 bucket 的策略：

```sql
select policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename = 'objects';
select count(*) as member_count from public.app_members; -- 应为 2
```

## 2. 数据与权限

所有业务表启用 RLS，`anon` 无业务表权限。已登录但不在 `app_members` 的账号同样无权访问。`app_private.is_app_member()` 是固定空 `search_path` 的 `SECURITY DEFINER` 函数，由管理员拥有，通过当前 JWT 的 `auth.uid()` 判断成员，避免查询成员表时 RLS 递归；客户端不能传入他人的 UUID。不要将函数所有者改为客户端角色。

| 表 | 字段与默认值 | 成员权限 |
| --- | --- | --- |
| `app_members` | `user_id uuid` 主键、关联 Auth；`display_name text` | 两成员可读名单，只有管理员增删改 |
| `messages` | `id uuid`、`sender_id uuid`、`content text`、`created_at timestamptz` | 两成员可读；只能以本人身份新增，不支持编辑或删除 |
| `miss_you_logs` | `id uuid`、`sender_id uuid`、`created_at timestamptz` | 两成员可读；只能以本人身份新增，不支持编辑或删除 |
| `notes` | `id uuid`、`owner_id uuid`、`title text`、`content text`、`visibility text`、`created_at/updated_at timestamptz` | 自己的全部笔记及对方 `shared` 笔记可读；仅 owner 可新增、编辑、删除 |
| `photos` | `id uuid`、`uploader_id uuid`、唯一 `storage_path text`、`file_name text`、`media_type text`（默认 `image`，仅 `image/video`）、`mime_type text`、`size_bytes bigint`（可空、非负）、`created_at timestamptz` | 两成员可读；只能新增、删除本人的元数据，不支持修改 |

ID 和时间由数据库生成，身份字段默认当前登录用户。客户端不得提交 `id`、`created_at`、`updated_at`；也不得修改 owner/sender/uploader。笔记可编辑列仅 `title/content/visibility`，`updated_at` 由触发器维护。`visibility` 默认为 `private`，只接受 `private/shared`。时间返回带时区的 ISO 8601 字符串，前端按本地时区显示。

消息正文去掉首尾空格后长度为 1–10000；笔记标题最多 200 字符、正文最多 100000；照片文件名 1–255 字符。`storage_path` 必须属于上传人的 UUID 目录。元数据和文件不构成跨服务事务，数据库不自动检查文件存在，也不会自动删除 Storage 文件。

## 3. Auth 与通用请求头

下文 `BASE` 表示真实项目 HTTPS 地址，`ANON_KEY` 表示项目 anon key；`ACCESS_TOKEN` 是邮箱密码登录返回的用户访问 JWT，`UID` 是响应 `user.id`。这些是占位符，不是可直接使用的配置。

**anon key 可以放在客户端，它不是 service_role。** `service_role`、secret key、数据库密码可绕过安全边界，只能留在管理端，绝不能打包进 APK、写入前端日志或提交仓库。RLS 必须结合用户 access token 使用，不能把 anon key 当作登录凭证。

| 操作 | 方法和相对地址 | JSON 请求体 |
| --- | --- | --- |
| 邮箱密码登录 | `POST /auth/v1/token?grant_type=password` | `{"email":"账号邮箱","password":"账号密码"}` |
| 刷新会话 | `POST /auth/v1/token?grant_type=refresh_token` | `{"refresh_token":"当前refresh_token"}` |
| 查询当前用户 | `GET /auth/v1/user` | 无 |
| 退出登录 | `POST /auth/v1/logout` | 无 |

登录和刷新使用 `apikey: ANON_KEY`、`Content-Type: application/json`。用户接口及后续 REST/Storage 请求还须带 `Authorization: Bearer ACCESS_TOKEN`。登录成功保存 `access_token/refresh_token/expires_in/user.id`；刷新成功后替换两个 token，防止刷新令牌轮转后继续使用旧值。退出后清除本地 token、缓存和 WebSocket。Auth 验证用户身份，成员表进一步决定业务权限。

REST 默认头：

```text
apikey: ANON_KEY
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

需要新增或编辑后的记录时加 `Prefer: return=representation`，返回 JSON **数组**；查询也返回数组。无需返回记录可用 `Prefer: return=minimal`。请检查 HTTP 状态码和响应体；RLS 拦截读取通常是空数组，过滤后没有可操作行的 UPDATE/DELETE 也可能成功但影响 0 行。使用返回记录判断实际结果，不要仅凭 2xx 判定删除或编辑成功。

## 4. REST 接口约定

以下地址均拼接 `BASE`，查询参数中的动态值需 URL 编码。所有写入仅带允许列，身份字段通常省略。

| 用途 | 方法与相对地址 | 请求体示例 |
| --- | --- | --- |
| 成员昵称 | `GET /rest/v1/app_members?select=user_id,display_name` | 无 |
| 聊天历史 | `GET /rest/v1/messages?select=*&order=created_at.desc,id.desc&limit=50` | 无 |
| 发送消息 | `POST /rest/v1/messages` | `{"content":"你好"}` |
| 想你历史 | `GET /rest/v1/miss_you_logs?select=*&order=created_at.desc,id.desc&limit=50` | 无 |
| 发送想你 | `POST /rest/v1/miss_you_logs` | `{}` |
| 可见笔记 | `GET /rest/v1/notes?select=*&order=updated_at.desc,id.desc&limit=50` | 无，RLS 自动过滤私密笔记 |
| 新建笔记 | `POST /rest/v1/notes` | `{"title":"日记","content":"正文","visibility":"private"}` |
| 编辑笔记 | `PATCH /rest/v1/notes?id=eq.NOTE_ID` | `{"content":"新正文","visibility":"shared"}` |
| 删除笔记 | `DELETE /rest/v1/notes?id=eq.NOTE_ID` | 无 |
| 照片列表 | `GET /rest/v1/photos?select=*&order=created_at.desc,id.desc&limit=50` | 无 |
| 新增媒体元数据 | `POST /rest/v1/photos` | `{"storage_path":"UID/唯一文件名.mp4","file_name":"原始视频.mp4","media_type":"video","mime_type":"video/mp4","size_bytes":123456}` |
| 删除媒体元数据 | `DELETE /rest/v1/photos?id=eq.PHOTO_ID` | 无 |

聊天历史以 `(created_at,id)` 做游标，避免相同时间记录漏页：下一页保留倒序排序，追加 `or=(created_at.lt.TIME,and(created_at.eq.TIME,id.lt.ID))`，TIME/ID 取上一页最后一条记录；实际发送时编码参数。展示时可将结果反转。单用 `created_at.lt.TIME` 会漏掉时间相同的消息。首次订阅与历史查询结果均按主键去重。

想你统计可对 `/rest/v1/miss_you_logs?select=id` 使用 `Prefer: count=exact` 并读取 `Content-Range`；仅需统计时使用 HEAD。笔记导出在前端读取所有可见分页数据后完成，无需后端导出接口。

## 5. 私有照片：multipart 上传与下载

媒体仍保存在私有 `photos` bucket 和 `photos` 表。图片支持 jpg/png/webp/gif，每批最多 9 张；视频仅支持 mp4，单次上传 1 个。客户端选择器和上传逻辑须执行 50 MiB（52,428,800 bytes）单文件限制，bucket 同步强制相同上限及 MIME 白名单。对象路径统一为 `UID/随机UUID或时间戳加随机串.扩展名`，不含 bucket 前缀，不要只用原始文件名。路径首段必须是登录用户 UUID。建议生成 ASCII 文件名，并对路径逐段 URL 编码，保留目录 `/`。`file_name` 单独保存原始显示名称。

新增元数据时显式提交 `media_type`（`image` 或 `video`）、`mime_type`（标准 MIME，如 `image/jpeg`、`video/mp4`）和实际 `size_bytes`（非负整数）；旧记录迁移后默认为 `image`，`mime_type/size_bytes` 可为空。上述大小、MIME 与每批/单次数量规则也需由客户端校验，数据库字段约束不承担文件内容检测或批次控制。

`uni.uploadFile` 可以直接调用 Storage 的标准上传接口，支持 **multipart/form-data POST**：

```text
url: BASE + /storage/v1/object/photos/UID/唯一文件名.扩展名
filePath: 本地图片或视频临时路径
name: file
header:
  apikey: ANON_KEY
  Authorization: Bearer ACCESS_TOKEN
  x-upsert: false
formData:
  cacheControl: 3600
```

不要手工设置 `Content-Type: application/json` 或 `multipart/form-data`，由 `uni.uploadFile` 生成包含 boundary 的 multipart 请求头。不要把文件再放进 JSON。该接口不是 S3 multipart 分片上传，也不需要 SDK 或预签名上传。上传响应的 `data` 可能是字符串，须检查 `statusCode` 并解析 JSON；Storage 错误体可能含 `statusCode/error/message`。首次上传需 INSERT 权限；重名返回冲突，生成新路径重试，禁止 `x-upsert: true`，本方案未提供对象 UPDATE 权限。

文件上传成功后，再 POST 照片元数据。写元数据失败时尝试删除刚上传的本人对象；网络状态不确定时，先按 `storage_path` 查询元数据避免误删已成功登记的对象。没有元数据的孤立对象可由上传人或管理员清理。

| 操作 | 方法与相对地址 | 约定 |
| --- | --- | --- |
| 上传 | `POST /storage/v1/object/photos/UID/唯一文件名.扩展名` | 上述 multipart，两个成员各自只能写本人目录；图片 9 张/批，视频 1 个/次 |
| 下载 | `GET /storage/v1/object/authenticated/photos/UID/唯一文件名.扩展名` | 带 `apikey` 和用户 Bearer token，返回文件字节；两成员可读 |
| 删除文件 | `DELETE /storage/v1/object/photos` | JSON：`{"prefixes":["UID/唯一文件名.jpg"]}`，只能删除本人目录 |

下载可用 `uni.downloadFile` 并传请求头，成功后再保存到手机。不要使用 `/object/public/` URL，bucket 为私有。不要持久化公开 URL 或含 token 的临时 URL，数据库只存 `storage_path`。本方案直接带 JWT 下载，不依赖签名 URL；已下载到对方设备的副本无法远程撤回。

清理云端照片时，先调用 Storage 删除并核验返回删除对象，再 DELETE 本人 `photos` 行。任一步失败都保留待重试信息；若文件已删除但元数据删除失败，列表会暂时存在失效项，重试元数据删除。不要直接用 SQL 删除 `storage.objects`，那不会正确清理实际文件。对方可下载，但不能清理上传人的文件或元数据。

## 6. 无 SDK 的 Realtime WebSocket 协议

`setup.sql` 将四张业务表加入 `supabase_realtime` publication。使用项目相同主机，将 HTTPS 换成 WSS，连接相对地址 `/realtime/v1/websocket?apikey=ANON_KEY&vsn=1.0.0`。使用 JSON 对象格式的 Phoenix 协议帧；`vsn=1.0.0` 对应对象格式，不要混用 v2 数组帧。连接参数中的 anon key 只标识项目，订阅身份由 join payload 中用户 access token 提供。

连接后为每张表发送独立订阅，例如消息：

```json
{
  "topic": "realtime:app-messages",
  "event": "phx_join",
  "payload": {
    "config": {
      "broadcast": {"self": false},
      "presence": {"key": ""},
      "postgres_changes": [
        {"event": "INSERT", "schema": "public", "table": "messages"}
      ]
    },
    "access_token": "ACCESS_TOKEN"
  },
  "ref": "1"
}
```

`miss_you_logs` 同样订阅 INSERT；`notes`、`photos` 可订阅 `event: "*"`，分别使用不同 topic 和递增的字符串 `ref`。处理 `phx_reply` 的状态及后续 `system` 订阅状态，确认订阅成功；不要只把 WebSocket 已连接当作订阅成功。变化事件为 `postgres_changes`，主要数据在 `payload.data` 下，例如 `type/record/old_record/schema/table`。

每约 25 秒发送心跳，`ref` 递增并确认响应：

```json
{"topic":"phoenix","event":"heartbeat","payload":{},"ref":"2"}
```

access token 刷新后，对每个已加入 topic 发送 `event: "access_token"`，payload 为 `{"access_token":"新ACCESS_TOKEN"}`，或携新 token 断开重连并重新订阅。退出发送 `phx_leave` 并关闭连接。断网后指数退避重连，重新订阅并 REST 拉取补偿数据；Realtime 不提供离线消息持久重放。WebSocket 在线通知不是 Android 后台推送，App 进入后台后不保证持续接收。

INSERT/UPDATE 事件受行可见性检查；对方不会收到 private 笔记正文。**可见性从 shared 改为 private 时，对方通常收不到该次 UPDATE**，因此笔记列表在页面进入、恢复前台、重连及适当定时刷新时都应重新查询，以最新 REST 结果整体替换可见列表，而非只合并。自己已经读到或导出的内容无法从对方设备撤回。

Supabase Postgres Changes 的 DELETE 事件不能按原行 SELECT RLS 精确过滤。这里维持 `REPLICA IDENTITY DEFAULT`，不要改成 FULL；DELETE 只用于提示失效或按主键清缓存，不应包含旧正文，也不要把它当作可读授权。对方可能获知 private 笔记被删除的 UUID，但不能据此读取笔记内容。若 UUID/删除行为本身也必须完全保密，需要另外设计按接收者授权的 Broadcast 服务，不应直接订阅 notes DELETE。本方案对 notes 可只订阅 INSERT/UPDATE，并靠定时 REST 全量可见列表处理删除和撤回。

成员被移除后，新 REST 请求不再可访问业务数据；前端同时应断开会话并清缓存。移除成员不等于清除既有本地数据，也不等于立刻吊销所有已签发 JWT。

### Android 后台通知边界

Realtime WebSocket 仅适用于 App 活跃且连接存续期间的实时同步；Android 进入后台或进程被系统挂起后，WebSocket 不保证保活，心跳和自动重连不能替代系统推送。本项目当前未实现推送服务、凭证管理、CID 绑定或通知发送。

面向国内 Android，建议优先评估 DCloud uni-push 及适用的厂商离线通道，不以依赖 Google 服务的 FCM 作为默认路径。建议由 Supabase Database Webhook 将业务事件送至受信任的服务端或 Edge Function，再由其调用 uni-push 服务端接口。该方案不要求把 Supabase 迁移到 uniCloud。落地前需开通 DCloud 推送服务、配置包名和签名、按目标厂商完成通道及资质配置，并由客户端注册和提交 CID。服务端密钥只保存在服务端；不得放进客户端或仓库。无实际服务凭据时不配置伪发送代码。详细实施边界见 [../docs/background-notifications.md](../docs/background-notifications.md)。

## 7. 部署后验收

使用 A、B 两个用户 access token 和一个不在成员表的测试账号分别测试，勿用 service_role 验证 RLS：

1. 无用户 JWT、非成员读取业务表失败或返回空；非成员上传和下载照片失败；客户端不能增删改 `app_members`。
2. A 新增消息/想你成功，冒充 B 的 `sender_id` 失败；A/B 均可读，客户端不能编辑或删除消息/想你。
3. A 的 private 笔记仅 A 可读；shared 笔记 B 可读，但 B 的编辑/删除影响 0 行或失败；A 不能修改 `owner_id` 和数据库时间。
4. A 可 multipart 上传到 A 的目录，不能上传到 B 的目录；B 能带 JWT 下载 A 的媒体，但不能删除；未登录无法通过公开 URL 下载。验证 jpg/png/webp/gif 与 mp4 接受，其他 MIME 及超过 50 MiB 拒绝；覆盖上传失败。新元数据可写入 `media_type/mime_type/size_bytes`，非成员或冒充 uploader 的写入失败；既有记录仍在且 `media_type=image`。
5. A 删除照片文件和本人元数据成功；重复运行 SQL 后权限结果不变、成员与已有数据仍保留、四张表 publication 不重复。
6. 两账号同时在线：聊天和想你实时到达；notes/photos 新增更新后刷新正确。断线重连补拉不漏记录、不重复展示；shared 撤回后下一次完整拉取清除对方缓存项。另在 Android 后台验证不将 WebSocket 当作推送验收；本项目没有真正后台推送实现。

本地 SQL 和部署说明不代表已部署：没有连接云账户、执行远端 SQL 或实际验证线上 RLS/上传/Realtime。须在目标 Supabase 环境按上述步骤执行并验收后上线。
