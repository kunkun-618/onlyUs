import { reactive } from 'vue'
import { inspectMedia, validateMedia, mediaExtension, type MediaMetadata } from './media'

/** 云连接响应式状态：项目地址、公开密钥、登录会话和实时连接状态。 */
export const cloud = reactive({
  url: String(uni.getStorageSync('pair_url') || ''),
  key: String(uni.getStorageSync('pair_key') || ''),
  session: uni.getStorageSync('pair_session') || null,
  status: '未连接'
})

/** 判断是否已填写项目地址和公开密钥。 */
export const configured = () => { return cloud.url.length > 0 && cloud.key.length > 0 }

// 会话变更版本号，用于拦截旧会话的异步结果。
let authVersion = 0

/** 保存云配置 */
export const saveConfig = (url: string, key: string) => {
	cloud.url = clean
	cloud.key = key
	
	// 存储失效或首次登录，触发本地存储
	if (uni.getStorageSync('pair_url') == '' || uni.getStorageSync('pair_key') == '') {
		uni.setStorageSync('pair_url', cloud.url)
		uni.setStorageSync('pair_key', cloud.key)
	}
}

/** 使用指定令牌发送云请求，未指定时使用公开密钥。 */
const raw = (path: string, method: string = 'GET', data: any = undefined, token: string = ''): Promise<any> => {
  // resolve 返回响应数据，reject 传递接口或网络错误。
  return new Promise((resolve, reject) => {
    uni.request({
      url: cloud.url + path,
      method: method as any,
      timeout: 15000,
      data,
      header: { apikey: cloud.key, Authorization: 'Bearer ' + (token || cloud.key), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      // r 为包含状态码和业务数据的请求响应。
      success: (r: any) => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data)
        else reject(new Error(r.data?.msg || r.data?.message || r.data?.error_description || r.data?.error || '请求失败 ' + r.statusCode))
      },
      fail: () => reject(new Error('网络连接失败，请检查网络和项目地址'))
    })
  })
}

// 并发请求共用的会话刷新任务，避免重复刷新令牌。
let refreshing: Promise<any> | null = null

/** 更新响应式会话并将绝对过期时间写入本地存储。 */
const persistSession = (session: any) => {
  cloud.session = { ...session, expires_at: Date.now() + session.expires_in * 1000 }
  uni.setStorageSync('pair_session', cloud.session)
}

/** 获取有效访问令牌，会话即将过期时合并刷新请求。 */
export const token = async (): Promise<string> => {
  if (!cloud.session) throw new Error('请先登录')
  if (cloud.session.expires_at < Date.now() + 60000) {
    if (!refreshing) {
      // 刷新开始时的会话版本，防止覆盖后续登录状态。
      const version = authVersion
      // 当前刷新任务；session 为服务端返回的新会话，结束时仅清理自身任务。
      const task = raw('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: cloud.session.refresh_token })
        .then(session => { if (version !== authVersion) throw new Error('登录会话已变更'); persistSession(session) })
        .finally(() => { if (refreshing === task) refreshing = null })
      refreshing = task
    }
    await refreshing
  }
  if (!cloud.session) throw new Error('请重新登录')
  return cloud.session.access_token
}
/** 携带登录令牌请求接口，并校验请求期间会话未发生变化。 */
export const request = async (path: string, method: string = 'GET', data: any = undefined) => {
  // 请求开始时的会话版本。
  const version = authVersion
  // 已获取或刷新后的访问令牌。
  const access = await token()
  if (version !== authVersion) throw new Error('登录会话已变更')
  // 等待会话一致性校验后才能返回的接口结果。
  const result = await raw(path, method, data, access)
  if (version !== authVersion) throw new Error('登录会话已变更')
  return result
}

export const login = async (email: string, password: string) => {
	clearSession()
	const version = authVersion
	const session = await raw('/auth/v1/token?grant_type=password', 'POST', { email: email.trim(), password })
	if (version !== authVersion) throw new Error('登录会话已变更')
	persistSession(session)
}

/** 使旧异步任务失效，并清除内存与本地存储中的会话。 */
export const clearSession = () => {
  authVersion++
  refreshing = null
  cloud.session = null
  uni.removeStorageSync('pair_session')
}
/** 尝试注销服务端会话，无论结果如何均清除本地登录状态。 */
export const logout = async () => {
  try { if (cloud.session) await request('/auth/v1/logout', 'POST') } finally { clearSession() }
}

/** 订阅数据变更并自动重连；onChange 接收表名和记录，onResync 在订阅就绪时触发。 */
export const watchChanges = (onChange: (table: string, row: any) => void, onResync: () => void) => {
  // 是否已由调用方主动停止订阅。
  let stopped = false
  // 当前实时连接实例。
  let socket: any = null
  // 周期心跳定时器句柄。
  let heartbeat: any = null
  // 等待重连的定时器句柄，同时用于避免重复安排重连。
  let reconnect: any = null
  // 递增的协议消息引用编号。
  let ref = 0
  // 当前重连等待时间，失败后指数增长，单位为毫秒。
  let delay = 1000
  // 最近确认连接存活的时间戳。
  let lastHeartbeat = 0
  // 需要订阅实时变更的业务表。
  const tables = ['messages', 'miss_you_logs', 'photos']
  /** 将主题、事件和载荷封装成实时协议消息发送。 */
  const send = (topic: string, event: string, payload: any) => socket?.send({ data: JSON.stringify({ topic, event, payload, ref: String(++ref) }) })
  /** 停止心跳并按退避间隔安排下一次连接。 */
  const schedule = () => {
    clearInterval(heartbeat)
    if (stopped || reconnect) return
    cloud.status = '重连中'
    reconnect = setTimeout(() => { reconnect = null; connect() }, delay)
    delay = Math.min(delay * 2, 30000)
  }
  /** 获取有效令牌并建立实时连接、订阅与心跳处理。 */
  const connect = async () => {
    try {
      // 建立本轮订阅时使用的访问令牌。
      const access = await token()
      if (stopped) return
      cloud.status = '连接中'
      // 当前连接中已确认成功订阅的表数量。
      let joined = 0
      socket = uni.connectSocket({ url: cloud.url.replace('https:', 'wss:') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cloud.key) + '&vsn=1.0.0', complete: () => {} })
      socket.onOpen(() => {
        // table 为逐个加入实时订阅的业务表名。
        for (const table of tables) send('realtime:pair-' + table, 'phx_join', {
          config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: table === 'photos' ? '*' : 'INSERT', schema: 'public', table }] }, access_token: access
        })
        lastHeartbeat = Date.now()
        heartbeat = setInterval(async () => {
          try {
            if (Date.now() - lastHeartbeat > 60000) { socket.close({}); schedule(); return }
            // 心跳时重新取得有效令牌，并同步到每个 table 对应的订阅。
            const fresh = await token()
            for (const table of tables) send('realtime:pair-' + table, 'access_token', { access_token: fresh })
            send('phoenix', 'heartbeat', {})
          } catch (_) { socket.close({}); schedule() }
        }, 25000)
      })
      // message 为实时连接收到的原始消息。
      socket.onMessage((message: any) => {
        try {
          // 解析后的实时协议帧，用于更新连接状态或分发数据变更。
          const frame = JSON.parse(message.data)
          if (frame.event === 'phx_reply' && frame.payload?.status === 'ok') lastHeartbeat = Date.now()
          if (frame.event === 'system') {
            if (frame.payload?.status === 'ok') {
              joined++
              if (joined >= tables.length) { cloud.status = '实时已连接'; delay = 1000; onResync() }
            } else { cloud.status = '订阅失败'; socket.close({}); schedule() }
          }
          if (frame.event === 'postgres_changes') onChange(frame.payload.data.table, frame.payload.data.record)
          if (frame.event === 'phx_error' || (frame.event === 'phx_reply' && frame.payload?.status === 'error')) { socket.close({}); schedule() }
        } catch (_) { /* 忽略非协议格式的消息帧。 */ }
      })
      socket.onClose(schedule)
      socket.onError(schedule)
    } catch (_) { schedule() }
  }
  connect()
  /** 停止订阅并清理心跳、重连任务和实时连接。 */
  return () => { stopped = true; clearInterval(heartbeat); clearTimeout(reconnect); socket?.close({}); cloud.status = '未连接' }
}

/** 补齐图片元数据后调用通用媒体上传流程。 */
export const uploadPhoto = async (filePath: string, metadata?: MediaMetadata) => {
  return uploadMedia(filePath, metadata || await inspectMedia(filePath, 'image'))
}
/** 上传媒体并创建记录，失败时先核对记录再清理孤立文件。 */
export const uploadMedia = async (filePath: string, metadata: MediaMetadata) => {
  validateMedia(metadata)
  // 上传开始时的会话版本，用于保证文件与记录属于同一登录状态。
  const version = authVersion
  // 上传存储对象所需的有效访问令牌。
  const access = await token()
  if (version !== authVersion) throw new Error('登录会话已变更')
  // 按账号隔离并附加时间与随机后缀的存储对象路径。
  const path = cloud.session.user.id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + mediaExtension(metadata.mime_type)
  // resolve 表示文件上传成功，reject 传递错误；r 为上传接口响应。
  await new Promise<void>((resolve, reject) => uni.uploadFile({
    url: cloud.url + '/storage/v1/object/photos/' + path, filePath, name: 'file',
    header: { apikey: cloud.key, Authorization: 'Bearer ' + access, 'x-upsert': 'false' },
    formData: { contentType: metadata.mime_type }, timeout: 120000,
    success: (r: any) => r.statusCode >= 200 && r.statusCode < 300 ? resolve() : reject(new Error('媒体上传失败：' + r.data)),
    fail: () => reject(new Error('媒体上传失败，请重试'))
  }))
  try {
    if (version !== authVersion) throw new Error('登录会话已变更')
    return await request('/rest/v1/photos', 'POST', {
      storage_path: path, file_name: metadata.file_name, media_type: metadata.media_type,
      mime_type: metadata.mime_type, size_bytes: metadata.size_bytes
    })
  } catch (e) {
    if (version !== authVersion) throw e
    // e 为记录写入异常；超时请求可能已提交，确认无记录前不能直接删除存储对象。
    // 查询同一路径下可能已成功提交的媒体记录。
    const rows = await request('/rest/v1/photos?storage_path=eq.' + encodeURIComponent(path))
    if (rows.length) return rows
    await request('/storage/v1/object/photos', 'DELETE', { prefixes: [path] })
    throw e
  }
}
/** 通过通用鉴权下载流程获取图片临时路径。 */
export const downloadPhoto = async (path: string): Promise<string> => {
  return downloadMedia(path)
}
/** 携带访问令牌下载私有媒体，并拒绝会话变化后的下载结果。 */
export const downloadMedia = async (path: string): Promise<string> => {
  // 下载开始时的会话版本。
  const version = authVersion
  // 访问私有媒体存储对象的有效令牌。
  const access = await token()
  if (version !== authVersion) throw new Error('登录会话已变更')
  // resolve 返回临时文件路径，reject 传递下载错误；r 为下载接口响应。
  return new Promise((resolve, reject) => uni.downloadFile({
    url: cloud.url + '/storage/v1/object/authenticated/photos/' + path.split('/').map(encodeURIComponent).join('/'),
    header: { apikey: cloud.key, Authorization: 'Bearer ' + access },
    timeout: 120000,
    success: (r: any) => {
      if (version !== authVersion) { reject(new Error('登录会话已变更')); return }
      r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new Error('无法下载媒体文件'))
    },
    fail: () => reject(new Error('媒体下载失败'))
  }))
}
