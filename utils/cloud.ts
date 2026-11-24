import { reactive } from 'vue'
import { inspectMedia, validateMedia, mediaExtension, type MediaMetadata } from './media'

export const cloud = reactive({
  url: String(uni.getStorageSync('pair_url') || ''),
  key: String(uni.getStorageSync('pair_key') || ''),
  session: uni.getStorageSync('pair_session') || null,
  status: '未连接'
})

export function configured() { return cloud.url.length > 0 && cloud.key.length > 0 }
let authVersion = 0
export function saveConfig(url: string, key: string) {
  const clean = url.trim().replace(/\/+$/, '')
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(clean)) throw new Error('请输入有效的 HTTPS 项目地址')
  const cleanKey = key.trim()
  if (!cleanKey.startsWith('sb_publishable_')) {
    const payload = cleanKey.split('.')[1] || ''
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let bits = 0, value = 0, decoded = ''
    for (const char of payload.replace(/-/g, '+').replace(/_/g, '/')) {
      const digit = alphabet.indexOf(char)
      if (digit < 0) continue
      value = (value << 6) | digit; bits += 6
      if (bits >= 8) { bits -= 8; decoded += String.fromCharCode((value >> bits) & 255) }
    }
    let role = ''
    try { role = JSON.parse(decoded).role } catch (_) {}
    if (role !== 'anon') throw new Error('只允许 anon JWT 或 sb_publishable_ 公开密钥')
  }
  clearSession()
  cloud.url = clean
  cloud.key = key.trim()
  uni.setStorageSync('pair_url', cloud.url)
  uni.setStorageSync('pair_key', cloud.key)
}

function raw(path: string, method: string = 'GET', data: any = undefined, token: string = ''): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: cloud.url + path,
      method: method as any,
      timeout: 15000,
      data,
      header: { apikey: cloud.key, Authorization: 'Bearer ' + (token || cloud.key), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      success: (r: any) => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data)
        else reject(new Error(r.data?.msg || r.data?.message || r.data?.error_description || r.data?.error || '请求失败 ' + r.statusCode))
      },
      fail: () => reject(new Error('网络连接失败，请检查网络和项目地址'))
    })
  })
}

let refreshing: Promise<any> | null = null
function persistSession(session: any) {
  cloud.session = { ...session, expires_at: Date.now() + session.expires_in * 1000 }
  uni.setStorageSync('pair_session', cloud.session)
}
export async function token(): Promise<string> {
  if (!cloud.session) throw new Error('请先登录')
  if (cloud.session.expires_at < Date.now() + 60000) {
    if (!refreshing) {
      const version = authVersion
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
export async function request(path: string, method: string = 'GET', data: any = undefined) {
  const version = authVersion
  const access = await token()
  if (version !== authVersion) throw new Error('登录会话已变更')
  const result = await raw(path, method, data, access)
  if (version !== authVersion) throw new Error('登录会话已变更')
  return result
}
export async function login(email: string, password: string) {
  clearSession()
  const version = authVersion
  const session = await raw('/auth/v1/token?grant_type=password', 'POST', { email: email.trim(), password })
  if (version !== authVersion) throw new Error('登录会话已变更')
  persistSession(session)
  try {
    const members = await request('/rest/v1/app_members?select=*')
    if (!members.some((m: any) => m.user_id === session.user.id)) throw new Error('该账号不在双人成员名单内')
  } catch (e) { clearSession(); throw e }
}
export function clearSession() {
  authVersion++
  refreshing = null
  cloud.session = null
  uni.removeStorageSync('pair_session')
}
export async function logout() {
  try { if (cloud.session) await request('/auth/v1/logout', 'POST') } finally { clearSession() }
}

export function watchChanges(onChange: (table: string, row: any) => void, onResync: () => void) {
  let stopped = false
  let socket: any = null
  let heartbeat: any = null
  let reconnect: any = null
  let ref = 0
  let delay = 1000
  let lastHeartbeat = 0
  const tables = ['messages', 'miss_you_logs', 'photos']
  const send = (topic: string, event: string, payload: any) => socket?.send({ data: JSON.stringify({ topic, event, payload, ref: String(++ref) }) })
  const schedule = () => {
    clearInterval(heartbeat)
    if (stopped || reconnect) return
    cloud.status = '重连中'
    reconnect = setTimeout(() => { reconnect = null; connect() }, delay)
    delay = Math.min(delay * 2, 30000)
  }
  const connect = async () => {
    try {
      const access = await token()
      if (stopped) return
      cloud.status = '连接中'
      let joined = 0
      socket = uni.connectSocket({ url: cloud.url.replace('https:', 'wss:') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cloud.key) + '&vsn=1.0.0', complete: () => {} })
      socket.onOpen(() => {
        for (const table of tables) send('realtime:pair-' + table, 'phx_join', {
          config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: table === 'photos' ? '*' : 'INSERT', schema: 'public', table }] }, access_token: access
        })
        lastHeartbeat = Date.now()
        heartbeat = setInterval(async () => {
          try {
            if (Date.now() - lastHeartbeat > 60000) { socket.close({}); schedule(); return }
            const fresh = await token()
            for (const table of tables) send('realtime:pair-' + table, 'access_token', { access_token: fresh })
            send('phoenix', 'heartbeat', {})
          } catch (_) { socket.close({}); schedule() }
        }, 25000)
      })
      socket.onMessage((message: any) => {
        try {
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
        } catch (_) { /* Ignore non-protocol frames. */ }
      })
      socket.onClose(schedule)
      socket.onError(schedule)
    } catch (_) { schedule() }
  }
  connect()
  return () => { stopped = true; clearInterval(heartbeat); clearTimeout(reconnect); socket?.close({}); cloud.status = '未连接' }
}

export async function uploadPhoto(filePath: string, metadata?: MediaMetadata) {
  return uploadMedia(filePath, metadata || await inspectMedia(filePath, 'image'))
}
export async function uploadMedia(filePath: string, metadata: MediaMetadata) {
  validateMedia(metadata)
  const version = authVersion
  const access = await token()
  if (version !== authVersion) throw new Error('登录会话已变更')
  const path = cloud.session.user.id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + mediaExtension(metadata.mime_type)
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
    // A timed-out metadata insert may have committed; never delete its object blindly.
    const rows = await request('/rest/v1/photos?storage_path=eq.' + encodeURIComponent(path))
    if (rows.length) return rows
    await request('/storage/v1/object/photos', 'DELETE', { prefixes: [path] })
    throw e
  }
}
export async function downloadPhoto(path: string): Promise<string> {
  return downloadMedia(path)
}
export async function downloadMedia(path: string): Promise<string> {
  const version = authVersion
  const access = await token()
  if (version !== authVersion) throw new Error('登录会话已变更')
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
