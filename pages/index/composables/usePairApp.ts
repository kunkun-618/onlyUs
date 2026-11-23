import { computed, onUnmounted, ref } from 'vue'
import { cloud, configured, saveConfig, login, logout, clearSession, request, watchChanges, uploadPhoto, downloadPhoto } from '../../../utils/cloud'

export function usePairApp() {
  const tabs = [{ key: 'home', label: '我们', icon: '♥' }, { key: 'chat', label: '聊天', icon: '☏' }, { key: 'photos', label: '相册', icon: '▧' }, { key: 'notes', label: '笔记', icon: '✎' }, { key: 'settings', label: '设置', icon: '⚙' }]
  const tab = ref('home')
  const entered = ref(false)
  const demo = ref(false)
  const busy = ref(false)
  const sending = ref(false)
  const email = ref('')
  const password = ref('')
  const messages = ref<any[]>([])
  const misses = ref<any[]>([])
  const notes = ref<any[]>([])
  const photos = ref<any[]>([])
  const members = ref<any[]>([])
  const unread = ref(0)
  const messageText = ref('')
  const scrollTarget = ref('')
  const heartActive = ref(false)
  const hasMore = ref(false)
  const loadingHistory = ref(false)
  const notesMore = ref(false)
  const photosMore = ref(false)
  const photoFailed = ref<Record<string, boolean>>({})
  const configOpen = ref(false)
  const configUrl = ref(cloud.url)
  const configKey = ref(cloud.key)
  const noteOpen = ref(false)
  const noteTitle = ref('')
  const noteContent = ref('')
  const noteShared = ref(false)
  const editingId = ref('')
  const noteReadOnly = ref(false)
  const noteFilter = ref('all')
  let originalNote = ''
  let stopRealtime: (() => void) | null = null
  let poll: any = null
  let heartTimer: any = null
  let refreshPromise: Promise<void> | null = null
  let refreshAgain = false
  let generation = 0
  let lastRefresh = 0
  let foreground = true
  const photoLoading = new Set<string>()
  const photoPaths = new Map<string, string>()
  const userId = computed(() => demo.value ? 'demo-me' : cloud.session?.user.id || '')
  const myName = computed(() => demo.value ? '小满' : members.value.find(m => m.user_id === userId.value)?.display_name || '我')
  const partnerName = computed(() => demo.value ? '阿屿' : members.value.find(m => m.user_id !== userId.value)?.display_name || '你')
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  const todayMiss = computed(() => misses.value.filter(m => new Date(m.created_at).toDateString() === new Date().toDateString()).length)
  const latestMiss = computed(() => misses.value[0])
  const filteredNotes = computed(() => notes.value.filter(n => noteFilter.value === 'all' || n.visibility === noteFilter.value))
  function toast(title: string) { uni.showToast({ title, icon: 'none' }) }
  function error(e: any) { toast(e?.message || '操作未完成，请稍后重试') }
  function formatDate(value: string) { return new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) }
  function formatTime(value: string) { return formatDate(value) + ' ' + new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
  function confirm(content: string): Promise<boolean> { return new Promise(resolve => uni.showModal({ title: '请确认', content, success: r => resolve(r.confirm), fail: () => resolve(false) })) }
  function localId() { return 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2) }
  function persistDemo() { if (demo.value) uni.setStorageSync('pair_demo', { messages: messages.value, misses: misses.value, notes: notes.value, photos: photos.value }) }
  function bottom() { scrollTarget.value = ''; setTimeout(() => { scrollTarget.value = 'chat-end' }, 100) }
  function switchTab(key: string) {
    if (tab.value === key) return
    tab.value = key
    if (key === 'chat') { unread.value = 0; bottom() }
    if (key === 'photos' && !demo.value) hydratePhotos()
    if (!demo.value && Date.now() - lastRefresh > 30000) refreshAll()
  }
  function startDemo() {
    demo.value = true
    entered.value = true
    const cache = uni.getStorageSync('pair_demo')
    const now = new Date().toISOString()
    messages.value = cache?.messages || [{ id: 'welcome', sender_id: 'demo-partner', content: '把想说的话都放在这里吧，日常的小事也想听你说。', created_at: now }]
    misses.value = cache?.misses || []
    notes.value = cache?.notes || [{ id: 'first-note', owner_id: 'demo-me', title: '我们的小小约定', content: '好好吃饭，慢慢生活。\n看到好看的天空，就拍下来给对方。\n有想念的时候，就按一下那颗爱心。', visibility: 'shared', created_at: now, updated_at: now }]
    photos.value = cache?.photos || []
    notesMore.value = false; photosMore.value = false; hasMore.value = false
  }
  async function signIn() {
    if (!configured()) { configOpen.value = true; return }
    if (!email.value.trim() || !password.value) { toast('请填写邮箱和密码'); return }
    busy.value = true
    try { await login(email.value, password.value); password.value = ''; demo.value = false; await refreshAll(); if (!cloud.session || !members.value.length) throw new Error('初始数据加载失败，请检查网络后重试'); entered.value = true; beginSync() } catch (e) { clearSession(); error(e) } finally { busy.value = false }
  }
  function beginSync() {
    stopRealtime?.()
    stopRealtime = watchChanges((table, row) => {
      if (table === 'messages') {
        if (!row?.id || messages.value.some(m => m.id === row.id)) return
        messages.value.push(row)
        if (row.sender_id !== userId.value && tab.value !== 'chat') { unread.value++; toast('收到 ' + partnerName.value + ' 的新消息') }
        if (tab.value === 'chat') bottom()
        return
      }
      if (table === 'miss_you_logs') {
        if (!row?.id || misses.value.some(m => m.id === row.id)) return
        misses.value.unshift(row)
        if (row.sender_id !== userId.value) { toast(partnerName.value + ' 说：想你了 ♥'); heartActive.value = true; clearTimeout(heartTimer); heartTimer = setTimeout(() => { heartActive.value = false }, 2500) }
        return
      }
      if (foreground) refreshAll()
    }, () => { refreshAll() })
    clearInterval(poll)
    poll = setInterval(() => { if (foreground) refreshAll() }, 30000)
  }
  function resetData() {
    generation++
    lastRefresh = 0; photoLoading.clear()
    refreshPromise = null; refreshAgain = false
    stopRealtime?.(); stopRealtime = null; clearInterval(poll)
    messages.value = []; misses.value = []; notes.value = []; photos.value = []; members.value = []
    photoPaths.clear(); photoFailed.value = {}; unread.value = 0
    noteOpen.value = false; noteContent.value = ''; noteTitle.value = ''; messageText.value = ''
    entered.value = false; tab.value = 'home'
  }
  async function applyConfig() {
    try { saveConfig(configUrl.value, configKey.value); resetData(); clearSession(); demo.value = false; configOpen.value = false; toast('连接已保存，请使用预置账号登录') } catch (e) { error(e) }
  }
  async function refreshAll() {
    if (demo.value || !cloud.session) return
    if (refreshPromise) { refreshAgain = true; return refreshPromise }
    const revision = generation
    const task = (async () => {
      try {
        const result = await Promise.all([
          request('/rest/v1/app_members?select=*'),
          request('/rest/v1/messages?select=*&order=created_at.desc,id.desc&limit=50'),
          request('/rest/v1/miss_you_logs?select=*&order=created_at.desc,id.desc&created_at=gte.' + encodeURIComponent(new Date(new Date().setHours(0, 0, 0, 0)).toISOString())),
          request('/rest/v1/notes?select=*&order=updated_at.desc,id.desc&limit=' + Math.max(notes.value.length, 50)),
          request('/rest/v1/photos?select=*&order=created_at.desc,id.desc&limit=' + Math.max(photos.value.length, 50))
        ])
        if (revision !== generation) return
        if (!result[0].some((m: any) => m.user_id === userId.value)) { resetData(); clearSession(); throw new Error('当前账号没有成员权限') }
        lastRefresh = Date.now()
        if (JSON.stringify(members.value) !== JSON.stringify(result[0])) members.value = result[0]
        const ids = new Set(messages.value.map(m => m.id))
        const newCount = result[1].filter((m: any) => !ids.has(m.id)).length
        const merged = new Map(messages.value.map(m => [m.id, m]))
        result[1].forEach((m: any) => merged.set(m.id, m))
        if (newCount) messages.value = Array.from(merged.values()).sort((a: any, b: any) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        if (!hasMore.value && messages.value.length <= 50) hasMore.value = result[1].length === 50
        if (JSON.stringify(misses.value) !== JSON.stringify(result[2])) misses.value = result[2]
        notesMore.value = result[3].length >= Math.max(notes.value.length, 50)
        if (notes.value.length !== result[3].length || notes.value.some((n, i) => n.id !== result[3][i].id || n.updated_at !== result[3][i].updated_at)) notes.value = result[3]
        photosMore.value = result[4].length >= Math.max(photos.value.length, 50)
        if (photos.value.length !== result[4].length || photos.value.some((p, i) => p.id !== result[4][i].id)) photos.value = result[4].map((p: any) => ({ ...p, local: photoPaths.get(p.id) || '' }))
        if (tab.value === 'chat' && newCount) bottom()
        if (tab.value === 'photos') hydratePhotos()
      } catch (e) { error(e) }
    })().finally(() => {
      if (refreshPromise === task) {
        refreshPromise = null
        if (refreshAgain) { refreshAgain = false; refreshAll() }
      }
    })
    refreshPromise = task
    return task
  }
  async function hydratePhotos() {
    const revision = generation
    for (const photo of photos.value) {
      if (revision !== generation || tab.value !== 'photos' || !foreground) return
      if (photo.local || photoFailed.value[photo.id] || photoLoading.has(photo.id)) continue
      photoLoading.add(photo.id)
      try { const path = await downloadPhoto(photo.storage_path); if (revision !== generation) return; photoPaths.set(photo.id, path); const current = photos.value.find(p => p.id === photo.id); if (current) current.local = path }
      catch (_) { if (revision === generation) photoFailed.value[photo.id] = true }
      finally { photoLoading.delete(photo.id) }
    }
  }
  async function loadOlder() {
    if (loadingHistory.value || demo.value || !messages.value.length) return
    loadingHistory.value = true
    const revision = generation
    try {
      const first = messages.value[0]
      const cursor = 'or=' + encodeURIComponent('(created_at.lt.' + first.created_at + ',and(created_at.eq.' + first.created_at + ',id.lt.' + first.id + '))')
      const rows = await request('/rest/v1/messages?select=*&order=created_at.desc,id.desc&limit=50&' + cursor)
      if (revision !== generation) return
      const seen = new Set(messages.value.map(m => m.id))
      messages.value = [...rows.filter((m: any) => !seen.has(m.id)).reverse(), ...messages.value]
      hasMore.value = rows.length === 50
    } catch (e) { error(e) } finally { loadingHistory.value = false }
  }
  async function sendMessage() {
    const content = messageText.value.trim()
    if (!content || sending.value) return
    sending.value = true
    const revision = generation
    try {
      const row = demo.value ? { id: localId(), sender_id: userId.value, content, created_at: new Date().toISOString() } : (await request('/rest/v1/messages', 'POST', { content }))[0]
      if (revision !== generation) return
      if (!messages.value.some(m => m.id === row.id)) messages.value.push(row)
      messageText.value = ''; persistDemo(); bottom()
    } catch (e) { error(e) } finally { sending.value = false }
  }
  async function sendMiss() {
    if (heartActive.value) return
    heartActive.value = true
    const revision = generation
    try {
      const row = demo.value ? { id: localId(), sender_id: userId.value, created_at: new Date().toISOString() } : (await request('/rest/v1/miss_you_logs', 'POST', {}))[0]
      if (revision !== generation) return
      if (!misses.value.some(m => m.id === row.id)) misses.value.unshift(row)
      persistDemo(); toast(demo.value ? '已记录一份想念（本地演示）' : '想念已送出 ♥')
    } catch (e) { error(e) } finally { heartTimer = setTimeout(() => { heartActive.value = false }, 1800) }
  }
  async function loadMoreNotes() {
    const revision = generation
    try { const rows = await request('/rest/v1/notes?select=*&order=updated_at.desc,id.desc&offset=' + notes.value.length + '&limit=50'); if (revision !== generation) return; notes.value.push(...rows.filter((n: any) => !notes.value.some(m => m.id === n.id))); notesMore.value = rows.length === 50 } catch (e) { error(e) }
  }
  async function loadMorePhotos() {
    const revision = generation
    try { const rows = await request('/rest/v1/photos?select=*&order=created_at.desc,id.desc&offset=' + photos.value.length + '&limit=50'); if (revision !== generation) return; photos.value.push(...rows.filter((p: any) => !photos.value.some(m => m.id === p.id))); photosMore.value = rows.length === 50; hydratePhotos() } catch (e) { error(e) }
  }
  function editNote(note: any) {
    editingId.value = note?.id || ''; noteTitle.value = note?.title || ''; noteContent.value = note?.content || ''; noteShared.value = note?.visibility === 'shared'; noteReadOnly.value = !!note && note.owner_id !== userId.value
    originalNote = JSON.stringify([noteTitle.value, noteContent.value, noteShared.value]); noteOpen.value = true
  }
  async function closeNote() { if (!noteReadOnly.value && originalNote !== JSON.stringify([noteTitle.value, noteContent.value, noteShared.value]) && !await confirm('离开后将丢失未保存的修改，确定离开吗？')) return; noteOpen.value = false }
  async function saveNote() {
    if (busy.value || noteReadOnly.value) return
    if (!noteTitle.value.trim() && !noteContent.value.trim()) { toast('写点什么再保存吧'); return }
    busy.value = true
    try {
      const data = { title: noteTitle.value.trim(), content: noteContent.value, visibility: noteShared.value ? 'shared' : 'private' }
      if (demo.value) {
        const old = notes.value.find(n => n.id === editingId.value)
        const now = new Date().toISOString()
        const row = { ...data, id: editingId.value || localId(), owner_id: userId.value, created_at: old?.created_at || now, updated_at: now }
        notes.value = [row, ...notes.value.filter(n => n.id !== row.id)]; persistDemo()
      } else {
        const rows = await request('/rest/v1/notes' + (editingId.value ? '?id=eq.' + editingId.value : ''), editingId.value ? 'PATCH' : 'POST', data)
        if (!rows.length) throw new Error('没有编辑权限，或笔记已被删除')
        notes.value = [rows[0], ...notes.value.filter(n => n.id !== rows[0].id)]
      }
      noteOpen.value = false; toast('小心事已保存')
    } catch (e) { error(e) } finally { busy.value = false }
  }
  async function deleteNote() {
    if (!await confirm('确定删除这篇笔记吗？删除后无法恢复。')) return
    try { if (!demo.value) { const rows = await request('/rest/v1/notes?id=eq.' + editingId.value, 'DELETE'); if (!rows.length) throw new Error('笔记已删除或无权限') }; notes.value = notes.value.filter(n => n.id !== editingId.value); persistDemo(); noteOpen.value = false; toast('笔记已删除') } catch (e) { error(e) }
  }
  async function addPhoto() {
    if (busy.value) return
    uni.chooseImage({ count: 1, sizeType: ['compressed'], success: async r => {
      busy.value = true; uni.showLoading({ title: '收藏这一刻…', mask: true })
      try {
        const path = r.tempFilePaths[0]
        if (demo.value) {
          let saved: any = { savedFilePath: path }
          // #ifndef WEB
          saved = await new Promise((resolve, reject) => uni.getFileSystemManager().saveFile({ tempFilePath: path, success: resolve, fail: reject }))
          // #endif
          photos.value.unshift({ id: localId(), uploader_id: userId.value, local: saved.savedFilePath, file_name: '我们的照片.jpg', created_at: new Date().toISOString() }); persistDemo()
        } else { await uploadPhoto(path); await refreshAll() }
        toast('照片已收藏')
      } catch (e) { error(e) } finally { busy.value = false; uni.hideLoading() }
    }, fail: () => {} })
  }
  async function previewPhoto(photo: any) { try { if (!photo.local) { photo.local = await downloadPhoto(photo.storage_path); photoPaths.set(photo.id, photo.local); photoFailed.value[photo.id] = false }; uni.previewImage({ urls: [photo.local] }) } catch (e) { error(e) } }
  async function savePhoto(photo: any) {
    try { const path = photo.local || await downloadPhoto(photo.storage_path); uni.saveImageToPhotosAlbum({ filePath: path, success: () => toast('已保存到手机相册'), fail: () => toast('保存失败，请检查相册权限') }) } catch (e) { error(e) }
  }
  async function deletePhoto(photo: any) {
    if (!await confirm('删除此云端照片后，两个人都无法再从这里下载。请先保存到手机。确定清理？')) return
    try {
      if (!demo.value) { await request('/storage/v1/object/photos', 'DELETE', { prefixes: [photo.storage_path] }); const rows = await request('/rest/v1/photos?id=eq.' + photo.id, 'DELETE'); if (!rows.length) throw new Error('文件已清理，元数据删除失败，请刷新后重试') }
      // #ifndef WEB
      else if (photo.local) uni.getFileSystemManager().removeSavedFile({ filePath: photo.local })
      // #endif
      photos.value = photos.value.filter(p => p.id !== photo.id); photoPaths.delete(photo.id); persistDemo(); toast('照片已清理')
    } catch (e) { error(e) }
  }
  async function exportNotes() {
    try {
      let rows = notes.value
      if (!demo.value) {
        rows = []; let offset = 0
        while (true) { const page = await request('/rest/v1/notes?select=*&order=created_at.asc,id.asc&limit=100&offset=' + offset); rows.push(...page); if (page.length < 100) break; offset += page.length }
      }
      if (!rows.length) { toast('还没有可以导出的笔记'); return }
      const text = '# 我们俩 · 笔记导出\n\n导出时间：' + new Date().toISOString() + '\n\n' + rows.map(n => '## ' + (n.title || '无题') + '\n\n可见性：' + n.visibility + '\n作者：' + n.owner_id + '\n创建时间：' + n.created_at + '\n更新时间：' + n.updated_at + '\n\n' + n.content + '\n\n---\n').join('\n')
      // #ifdef WEB
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = 'notes_export_' + new Date().toISOString().slice(0, 10) + '.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      // #endif
      // #ifndef WEB
      const fs = uni.getFileSystemManager()
      const path = uni.env.USER_DATA_PATH + '/notes_export_' + new Date().toISOString().slice(0, 10) + '.md'
      fs.writeFile({ filePath: path, data: text, encoding: 'utf8', success: () => uni.showModal({ title: '笔记已导出', content: 'Markdown 文件已保存到应用文件目录：\n' + path, showCancel: false }), fail: () => toast('导出失败，无法写入本地文件') })
      // #endif
    } catch (e) { error(e) }
  }
  async function clearCache() {
    if (!await confirm('将清理图片临时文件和内存列表；云端数据及登录状态保留。')) return
    // #ifndef WEB
    const fs = uni.getFileSystemManager()
    for (const path of photoPaths.values()) fs.unlink({ filePath: path })
    // #endif
    photoPaths.clear(); photoFailed.value = {}
    if (!demo.value) { photos.value = []; notes.value = []; messages.value = []; await refreshAll() }
    toast('本地缓存已刷新')
  }
  async function signOut() {
    if (!await confirm(demo.value ? '确定退出本地演示？演示数据保留在此设备。' : '确定退出当前账号？')) return
    try { if (!demo.value) await logout() } catch (_) { clearSession() }
    resetData(); demo.value = false
  }
  function handleShow() { foreground = true; if (entered.value && !demo.value) { if (Date.now() - lastRefresh > 10000) refreshAll(); if (tab.value === 'photos') hydratePhotos() } }
  function handleHide() { foreground = false }
  onUnmounted(() => { stopRealtime?.(); clearInterval(poll); clearTimeout(heartTimer) })
  if (configured() && cloud.session) { entered.value = true; refreshAll(); beginSync() }
  return {
    tabs, tab, entered, demo, busy, sending, email, password, messages, misses, notes, photos, members, unread, messageText, scrollTarget, heartActive, hasMore, loadingHistory, notesMore, photosMore, photoFailed, configOpen, configUrl, configKey, noteOpen, noteTitle, noteContent, noteShared, editingId, noteReadOnly, noteFilter,
    cloud, configured, userId, myName, partnerName, today, todayMiss, latestMiss, filteredNotes,
    toast, formatDate, formatTime, switchTab, startDemo, signIn, applyConfig, refreshAll, loadOlder, sendMessage, sendMiss, loadMoreNotes, loadMorePhotos, editNote, closeNote, saveNote, deleteNote, addPhoto, previewPhoto, savePhoto, deletePhoto, exportNotes, clearCache, signOut, handleShow, handleHide
  }
}
