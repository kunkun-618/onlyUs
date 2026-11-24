export interface CachedChatMessage {
  id: string
  sender_id: string
  content: string
  created_at: string
}

export interface ChatCache {
  messages: CachedChatMessage[]
  hasMore: boolean
  syncedAt?: string
}

function cacheKey(url: string, userId: string): string {
  const project = url.trim().replace(/\/+$/, '').toLowerCase()
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(project) || !userId.trim()) throw new Error('Invalid cache scope')
  return 'pair_chat_v1:' + encodeURIComponent(project) + ':' + encodeURIComponent(userId)
}

function normalizeCache(value: unknown): ChatCache | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') return null
  const unique = new Map<string, CachedChatMessage>()
  for (const item of data.messages) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id.trim() || typeof row.sender_id !== 'string' || !row.sender_id.trim() ||
      typeof row.content !== 'string' || row.content.length > 10000 || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) return null
    unique.set(row.id, { id: row.id, sender_id: row.sender_id, content: row.content, created_at: row.created_at })
  }
  const messages = Array.from(unique.values()).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
  const syncedAt = typeof data.syncedAt === 'string' && Number.isFinite(Date.parse(data.syncedAt)) ? data.syncedAt : undefined
  return { messages: messages.slice(-500), hasMore: data.hasMore || messages.length > 500, syncedAt }
}

export function readChatCache(url: string, userId: string): ChatCache | null {
  try {
    const stored = uni.getStorageSync(cacheKey(url, userId))
    if (typeof stored !== 'string' || !stored) return null
    const data = JSON.parse(stored)
    if (data?.version !== 1) return null
    return normalizeCache(data)
  } catch (_) { return null }
}

export function writeChatCache(url: string, userId: string, messages: readonly CachedChatMessage[], hasMore: boolean, syncedAt?: string): boolean {
  try {
    const key = cacheKey(url, userId)
    const data = normalizeCache({ messages, hasMore, syncedAt })
    if (!data) return false
    uni.setStorageSync(key, JSON.stringify({ version: 1, ...data }))
    return true
  } catch (_) { return false }
}

export function removeChatCache(url: string, userId: string): boolean {
  try {
    uni.removeStorageSync(cacheKey(url, userId))
    return true
  } catch (_) { return false }
}
