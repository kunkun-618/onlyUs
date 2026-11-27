export interface AppCache {
  members: any[]
  messages: any[]
  misses: any[]
  notes: any[]
  photos: any[]
  initialized: string[]
  cursors: Record<string, string>
}

const key = (url: string, userId: string) => 'pair_data_v1:' + encodeURIComponent(url) + ':' + encodeURIComponent(userId)

export const readAppCache = (url: string, userId: string): AppCache | null => {
  try {
    const data = JSON.parse(uni.getStorageSync(key(url, userId)) || 'null')
    if (data?.version !== 1) return null
    for (const name of ['members', 'messages', 'misses', 'notes', 'photos', 'initialized']) {
      if (!Array.isArray(data[name])) return null
    }
    return { ...data, cursors: data.cursors || {} }
  } catch (_) { return null }
}

export const writeAppCache = (url: string, userId: string, data: AppCache) => {
  // 配额异常交给调用方提示，不能静默声称已保存到本机。
  uni.setStorageSync(key(url, userId), JSON.stringify({ version: 1, ...data }))
}

export const removeAppCache = (url: string, userId: string) => uni.removeStorageSync(key(url, userId))
