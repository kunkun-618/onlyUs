/** 本地缓存的单条聊天消息。 */
export interface CachedChatMessage {
  /** 消息唯一标识，用于去重和稳定排序。 */
  id: string
  /** 发送者账号标识。 */
  sender_id: string
  /** 消息正文。 */
  content: string
  /** 可解析为日期的消息创建时间。 */
  created_at: string
}

/** 当前项目和账号下的聊天缓存。 */
export interface ChatCache {
  /** 按时间升序排列、最多保留五百条的消息。 */
  messages: CachedChatMessage[]
  /** 服务端或被截断的缓存中是否仍有更早消息。 */
  hasMore: boolean
  /** 最近同步时间，未记录时可省略。 */
  syncedAt?: string
}

/** 根据项目地址和账号生成隔离的缓存键。 */
const cacheKey = (url: string, userId: string): string => {
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(url) || !userId.trim()) throw new Error('Invalid cache scope')
  return 'pair_chat_v1:' + encodeURIComponent(url) + ':' + encodeURIComponent(userId)
}

/** 校验、去重并截取缓存消息，非法数据返回空值。 */
const normalizeCache = (value: unknown): ChatCache | null => {
  if (!value || typeof value !== 'object') return null
  // 待校验的缓存对象。
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') return null
  // 按消息标识去重的消息集合。
  const unique = new Map<string, CachedChatMessage>()
  // item 为逐条取出的原始缓存消息。
  for (const item of data.messages) {
    if (!item || typeof item !== 'object') return null
    // 转为字段可逐一校验的消息对象。
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id.trim() || typeof row.sender_id !== 'string' || !row.sender_id.trim() ||
      typeof row.content !== 'string' || row.content.length > 10000 || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) return null
    unique.set(row.id, { id: row.id, sender_id: row.sender_id, content: row.content, created_at: row.created_at })
  }
  // 去重后的有序消息；排序回调中的 a、b 为待比较的两条消息。
  const messages = Array.from(unique.values()).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
  // 仅保留格式有效的同步时间。
  const syncedAt = typeof data.syncedAt === 'string' && Number.isFinite(Date.parse(data.syncedAt)) ? data.syncedAt : undefined
  return { messages: messages.slice(-500), hasMore: data.hasMore || messages.length > 500, syncedAt }
}

/** 读取指定项目和账号的缓存，无效或读取失败时返回空值。 */
export const readChatCache = (url: string, userId: string): ChatCache | null => {
	try {
		// 本地存储中的缓存原始字符串。
		const stored = uni.getStorageSync(cacheKey(url, userId))
		if (typeof stored !== 'string' || !stored) return null
		// 解析后待检查版本与内容的缓存数据。
		const data = JSON.parse(stored)
		if (data?.version !== 1) return null
		return normalizeCache(data)
	} catch (_) { return null }
}

/** 校验并写入聊天缓存，返回是否成功。 */
export const writeChatCache = (url: string, userId: string, messages: readonly CachedChatMessage[], hasMore: boolean, syncedAt?: string): boolean => {
  try {
    // 当前项目和账号对应的存储键。
    const key = cacheKey(url, userId)
    // 经过校验、去重和容量限制的缓存数据。
    const data = normalizeCache({ messages, hasMore, syncedAt })
    if (!data) return false
    uni.setStorageSync(key, JSON.stringify({ version: 1, ...data }))
    return true
  } catch (_) { return false }
}

/** 删除指定项目和账号的聊天缓存，返回是否成功。 */
export const removeChatCache = (url: string, userId: string): boolean => {
  try {
    uni.removeStorageSync(cacheKey(url, userId))
    return true
  } catch (_) { return false }
}
