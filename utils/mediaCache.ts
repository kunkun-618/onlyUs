export type MediaCacheScope = { url: string; userId: string }

// #ifdef WEB
type CachedMedia = Blob
// #endif
// #ifndef WEB
type CachedMedia = string
// #endif
type ScopeState = { version: number; clearing: boolean; pending: Map<string, Promise<CachedMedia>> }
const scopes = new Map<string, ScopeState>()
const scopeKey = (scope: MediaCacheScope) => JSON.stringify([scope.url, scope.userId])
const stateFor = (key: string): ScopeState => {
  if (!scopes.has(key)) scopes.set(key, { version: 0, clearing: false, pending: new Map() })
  return scopes.get(key)!
}
const failure = (error: any) => new Error('媒体持久缓存失败（可能空间不足）：' + (error?.message || error?.errMsg || error?.name || String(error)))

// #ifdef WEB
const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  let blocked = false
  const request = indexedDB.open('pair-media-cache-v1', 1)
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore('media', { keyPath: 'key' })
    store.createIndex('scope', 'scope')
  }
  request.onerror = () => reject(failure(request.error))
  request.onblocked = () => { blocked = true; reject(new Error('媒体缓存数据库被其他页面阻塞')) }
  request.onsuccess = () => {
    if (blocked) { request.result.close(); return }
    request.result.onversionchange = () => request.result.close()
    resolve(request.result)
  }
})

// 事务提交才表示保存成功，单条请求成功不代表持久写入完成。
const webCache = async (scope: string, path: string, blob?: Blob): Promise<Blob | null> => {
  const db = await openDatabase()
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction('media', blob ? 'readwrite' : 'readonly')
      const store = tx.objectStore('media')
      const key = JSON.stringify([scope, path])
      const request = blob ? store.put({ key, scope, blob }) : store.get(key)
      let result: Blob | null = null
      request.onsuccess = () => { result = blob || request.result?.blob || null }
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure(tx.error || request.error))
      tx.onerror = () => { /* 由 onabort 返回最终事务错误。 */ }
    })
  } finally { db.close() }
}
// #endif

// #ifdef APP
const manifestKey = (scope: string) => 'pair_media_cache_v1:' + scope
const manifest = (scope: string): Record<string, string> => {
  const value = uni.getStorageSync(manifestKey(scope))
  if (!value) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('媒体缓存索引损坏')
  return value
}
const fileInfo = (filePath: string): Promise<boolean> => new Promise((resolve, reject) => {
  uni.getFileSystemManager().getFileInfo({
    filePath,
    success: (result: any) => resolve(result.size > 0),
    fail: (error: any) => error.errCode === 1300002 ? resolve(false) : reject(failure(error))
  })
})
const unlink = (filePath: string): Promise<void> => new Promise((resolve, reject) => {
  uni.getFileSystemManager().unlink({ filePath, success: () => resolve(), fail: (error: any) => error.errCode === 1300002 ? resolve() : reject(failure(error)) })
})
// #endif

/** 本地查询先于网络鉴权；每个 Web 调用者独立持有自己的对象地址。 */
export const cachedMedia = async (
  scope: MediaCacheScope,
  path: string,
  download: () => Promise<string>,
  assertSession: () => void,
  sessionVersion: number
): Promise<string> => {
  const key = scopeKey(scope)
  const state = stateFor(key)
  if (state.clearing) throw new Error('媒体缓存正在清理')
  const version = state.version
  const check = () => {
    assertSession()
    if (state.clearing || version !== state.version) throw new Error('媒体缓存作用域已失效')
  }
  check()
  // 新会话不能复用旧会话的下载任务。
  const pendingKey = JSON.stringify([path, sessionVersion])
  let task = state.pending.get(pendingKey)
  if (!task) {
    task = (async (): Promise<CachedMedia> => {
      // #ifdef WEB
      const existing = await webCache(key, path)
      check()
      if (existing instanceof Blob && existing.size > 0) return existing
      const temporary = await download()
      check()
      try {
        const response = await fetch(temporary)
        if (!response.ok) throw new Error('无法读取下载的媒体')
        const blob = await response.blob()
        if (!blob.size) throw new Error('媒体文件为空')
        check()
        await webCache(key, path, blob)
        check()
        return blob
      } finally { if (temporary.startsWith('blob:')) URL.revokeObjectURL(temporary) }
      // #endif
      // #ifdef APP
      const previous = manifest(key)[path]
      if (previous && await fileInfo(previous)) { check(); return previous }
      check()
      const temporary = await download()
      check()
      const extension = path.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0] || ''
      const destination = uni.env.USER_DATA_PATH + '/pair-media/' + Date.now() + '_' + Math.random().toString(36).slice(2) + extension
      let saved = ''
      try {
        saved = await new Promise<string>((resolve, reject) => {
          uni.getFileSystemManager().saveFile({ tempFilePath: temporary, filePath: destination, success: (result: any) => resolve(result.savedFilePath), fail: (error: any) => reject(failure(error)) })
        })
        check()
        if (!await fileInfo(saved)) throw new Error('媒体持久文件无效')
        check()
        const entries = manifest(key)
        entries[path] = saved
        uni.setStorageSync(manifestKey(key), entries)
        if (manifest(key)[path] !== saved) throw new Error('媒体缓存索引未持久保存')
        return saved
      } catch (error) {
        if (saved) await unlink(saved)
        throw failure(error)
      }
      // #endif
      throw new Error('当前平台不支持媒体持久缓存')
    })()
    state.pending.set(pendingKey, task)
    const current = task
    const remove = () => { if (state.pending.get(pendingKey) === current) state.pending.delete(pendingKey) }
    task.then(remove, remove)
  }
  const result = await task
  check()
  // #ifdef WEB
  return URL.createObjectURL(result as Blob)
  // #endif
  // #ifndef WEB
  return result as string
  // #endif
}

/** 仅删除指定项目和账号的缓存，先使在途任务失效并等待其结束。 */
export const clearMediaCacheScope = async (scope: MediaCacheScope): Promise<void> => {
  const key = scopeKey(scope)
  const state = stateFor(key)
  if (state.clearing) throw new Error('媒体缓存正在清理')
  state.clearing = true
  state.version++
  try {
    await Promise.all(Array.from(state.pending.values()).map(task => task.catch(() => undefined)))
    // #ifdef WEB
    const db = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('media', 'readwrite')
        const request = tx.objectStore('media').index('scope').openCursor(IDBKeyRange.only(key))
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) { cursor.delete(); cursor.continue() }
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(failure(tx.error || request.error))
      })
    } finally { db.close() }
    // #endif
    // #ifdef APP
    const entries = manifest(key)
    for (const path of Object.keys(entries)) {
      await unlink(entries[path])
      delete entries[path]
      uni.setStorageSync(manifestKey(key), entries)
    }
    uni.removeStorageSync(manifestKey(key))
    // #endif
  } finally { state.clearing = false }
}
