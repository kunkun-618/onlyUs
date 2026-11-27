import { computed, onUnmounted, ref, watch } from 'vue'
import { cloud, configured, saveConfig, login, logout, clearSession, request, watchChanges, uploadPhoto, downloadPhoto } from '../../../utils/cloud'
import { readChatCache, removeChatCache } from '../../../utils/chatCache'
import { readAppCache, writeAppCache, removeAppCache } from '../../../utils/appCache'
import { clearMediaCacheScope } from '../../../utils/mediaCache'
import { exportNoteFile } from '../../../utils/noteExport'
import { SUPABASE_URL ,SUPABASE_PUBLISHABLE_KEY } from '../../../config/supabaseConfig'

/** 创建双人空间的页面状态、数据同步与交互操作。 */
export const usePairApp = () => {
	// 底部导航的标识、名称与图标配置。
	const tabs = [
		{ key: 'home', label: '我们', icon: '♥' },
		{ key: 'chat', label: '聊天', icon: '✉︎' },
		{ key: 'photos', label: '相册', icon: '▧' },
		{ key: 'notes', label: '笔记', icon: '✎' },
		{ key: 'settings', label: '设置', icon: '👤︎' }
	]
	const tab = ref('home') // 当前选中的导航页签。
	const entered = ref(false)  // 是否已进入登录后或演示模式的主界面。
	const busy = ref(false) // 登录、笔记保存及照片添加等操作的忙碌状态。
	const sending = ref(false)  // 消息发送锁，防止重复提交。
	const exporting = ref(false)  // 笔记导出锁，防止重复导出。
	const syncError = ref('')
	const syncing = ref(false)
	let initialized = new Set<string>()
	let cursors: Record<string, string> = {}
	let lastIdCheck = 0
	let cacheTimer: any = null
	let cacheWarning = false
	const now = ref(Date.now()) // 驱动日期展示与跨日刷新的当前时间戳。
	const email = ref('') // 登录表单中的邮箱。
	const password = ref('')  // 登录表单中的密码。
	const messages = ref<any[]>([]) // 按时间升序展示的聊天消息。
	const misses = ref<any[]>([]) // 想念记录，供今日统计和最近记录展示使用。
	const notes = ref<any[]>([])  // 当前已加载的笔记列表。
	const photos = ref<any[]>([]) // 当前已加载的照片元数据及本地路径。
	const members = ref<any[]>([])  // 双人空间的成员资料。
	const unread = ref(0) // 非聊天页收到的未读消息数量。
	const messageText = ref('') // 待发送的聊天输入内容。
	const scrollTarget = ref('')  // 聊天滚动区域要定位的元素标识。
	const heartActive = ref(false)  // 想念爱心的激活状态，同时限制连续发送。
	const hasMore = ref(false)  // 聊天列表是否可能还有更早消息。
	const loadingHistory = ref(false) // 是否正在加载更早的聊天消息。
	const notesMore = ref(false)  // 笔记列表是否可能还有下一页。
	const photosMore = ref(false) // 照片列表是否可能还有下一页。
	const photoFailed = ref<Record<string, boolean>>({})  // 按照片标识记录下载失败状态，避免反复自动重试。
	const noteOpen = ref(false) // 笔记编辑或阅读面板的显示状态。
	const noteTitle = ref('') // 当前笔记表单的标题。
	const noteContent = ref('') // 当前笔记表单的正文。
	const noteShared = ref(false) // 当前笔记是否对另一位成员共享。
	const editingId = ref('') // 正在编辑的笔记标识，空值表示新建。
	const noteReadOnly = ref(false) // 是否仅允许阅读当前笔记。
	const noteFilter = ref('all') // 笔记列表的可见性筛选条件。
	let originalNote = '' // 打开笔记时的表单快照，用于检测未保存修改。
	let stopRealtime: (() => void) | null = null  // 关闭当前实时订阅的清理函数。
	let poll: any = null  // 定期刷新数据的轮询定时器。
	let heartTimer: any = null  // 恢复爱心未激活状态的延时定时器。
	let refreshPromise: Promise<void> | null = null // 正在执行的刷新任务，用于合并并发刷新。
	let generation = 0  // 数据代次，阻止重置前的异步结果写回当前状态。
	let signingOut = false  // 退出流程锁，避免退出期间再次登录或切换模式。
	let lastRefresh = 0 // 上次成功刷新数据的时间戳。
	let foreground = true // 页面是否处于前台，控制轮询与照片下载。	
	const photoLoading = new Set<string>()  // 正在下载的照片标识集合，用于去重。
	const photoPaths = new Map<string, string>()  // 照片标识到已下载本地路径的缓存。
	
	// 当前用户标识。
	const userId = computed(() => cloud.session?.user.id || '')
	// 从成员 m 中查找当前用户的显示名。
	const myName = computed(() => members.value.find(m => m.user_id === userId.value)?.display_name || '我')
	// 从成员 m 中查找另一位成员的显示名。
	const partnerName = computed(() => members.value.find(m => m.user_id !== userId.value)?.display_name || '你')
	// 首页展示的中文日期与星期。
	const today = computed(() => new Date(now.value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }))
	// 筛选创建日期为今天的想念记录 m。
	const todayMisses = computed(() => misses.value.filter(m => new Date(m.created_at).toDateString() === new Date(now.value).toDateString()))
	// 今天累计的想念次数。
	const todayMiss = computed(() => todayMisses.value.length)
	// 最近一条想念记录。
	const latestMiss = computed(() => misses.value[0])
	// 按可见性条件筛选笔记 n 后的展示列表。
	const filteredNotes = computed(() => notes.value.filter(n => noteFilter.value === 'all' || n.visibility === noteFilter.value))
	
	/** 将 title 作为无图标的轻提示展示。 */
	const toast = (title: string) => { uni.showToast({ title, icon: 'none' }) }
	
	/** 展示异常 e 的消息，缺少消息时使用通用提示。 */
	const error = (e: any) => { toast(e?.message || '操作未完成，请稍后重试') }
	
	/** 将日期字符串 value 格式化为中文月日。 */
	const formatDate = (value: string) => {
		return new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
	}
	
	/** 将日期字符串 value 格式化为中文月日及小时分钟。 */
	const formatTime = (value: string) => {
		const targetTime = new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
		return formatDate(value) + ' ' + targetTime
	}
	
	/** 展示确认文案 content；以弹窗结果 r 通知 resolve，失败按取消处理。 */
	const confirm = (content: string): Promise<boolean> => {
		return new Promise(resolve => uni.showModal({
			title: '请确认',
			content,
			success: r => resolve(r.confirm),
			fail: () => resolve(false)
		}))
	}
	
	/** 为本地演示记录生成带时间戳和随机片段的标识。 */
	const localId = () => ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2))
	
	/** 按创建时间及标识比较记录 a、b，保留数据库亚毫秒精度。 */
	const compareMessages = (a: any, b: any): number => {
		// 两条记录创建时间的毫秒差。
		const milliseconds = Date.parse(a.created_at) - Date.parse(b.created_at)
		/** 从时间字符串 value 提取毫秒之后的小数位用于精细排序。 */
		const fraction = (value: string) => ((value.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0')).slice(3, 9)
		return milliseconds || fraction(a.created_at).localeCompare(fraction(b.created_at)) || a.id.localeCompare(b.id)
	}
	
	const persistData = () => {
		clearTimeout(cacheTimer)
		if (!cloud.session || !entered.value) return
		try {
			writeAppCache(cloud.url, userId.value, {
				members: members.value, messages: messages.value, misses: misses.value,
				notes: notes.value, photos: photos.value.map(p => ({ ...p, local: '' })),
				initialized: [...initialized], cursors
			})
			cacheWarning = false
		} catch (_) {
			if (!cacheWarning) toast('本地存储空间不足，部分新数据尚未保存，请释放空间')
			cacheWarning = true
		}
	}
	watch([members, messages, misses, notes, photos], () => {
		clearTimeout(cacheTimer)
		cacheTimer = setTimeout(persistData, 150)
	}, { deep: true })

	/** 保存全部已下载的数据，不再截断聊天历史。 */
	const persistChat = () => {
		persistData()
	}
	
	/** 删除当前真实账号的本地聊天缓存。 */
	const removeCurrentChat = () => {
		if (cloud.session) {
			removeChatCache(cloud.url, userId.value)
			removeAppCache(cloud.url, userId.value)
		}
	}
	
	/** 恢复当前用户的聊天列表、分页状态与同步游标。 */
	const restoreChat = () => {
		const data = readAppCache(cloud.url, userId.value)
		if (data) {
			members.value = data.members
			messages.value = data.messages.sort(compareMessages)
			misses.value = data.misses.sort((a, b) => -compareMessages(a, b))
			notes.value = data.notes
			photos.value = data.photos
			initialized = new Set(data.initialized)
			cursors = data.cursors
			hasMore.value = !initialized.has('messages')
			return
		}
		const cache = readChatCache(cloud.url, userId.value)
		messages.value = cache ? [...cache.messages].sort(compareMessages) : []
		hasMore.value = cache?.hasMore || false
	}
	
	/** 根据末条记录 row 构造按创建时间、标识向后翻页的筛选条件。 */
	const afterCursor = (row: any) => {
		return 'or=' + encodeURIComponent('(created_at.gt.' + row.created_at + ',and(created_at.eq.' + row.created_at + ',id.gt.' + row.id + '))')
	}	 
	
	/** 延迟滚动到聊天底部；revision 保存当前代次，防止重置后误滚动。 */
	const bottom = () => {
		const revision = generation
		scrollTarget.value = ''
		setTimeout(() => {
			if (revision === generation) {
				scrollTarget.value = 'chat-end'
			}
		}, 100) 
	}	
	
	/** 切换到 key 对应的页签，并按需清除未读、下载照片和刷新数据。 */
	const switchTab = (key: string) => {
		if (tab.value === key) return
		tab.value = key
		if (key === 'chat') {
			unread.value = 0
			bottom()
		} else if (key === 'photos') {
			hydratePhotos()
		}	
		if (Date.now() - lastRefresh > 30000) refreshAll()
	}
	
	/** 清理真实会话并恢复或初始化本地演示数据。 */
	const startDemo = () => {
		if (signingOut) return
		clearSession()
		resetData()
		entered.value = true
		// 上次保存在本机的演示数据。
		const cache = uni.getStorageSync('pair_demo')
		// 初始化演示消息与笔记使用的统一时间。
		const now = new Date().toISOString()
		messages.value = cache?.messages || [{
			id: 'welcome',
			sender_id: 'demo-partner',
			content: '把想说的话都放在这里吧，日常的小事也想听你说。',
			created_at: now
		}]
		misses.value = cache?.misses || []
		notes.value = cache?.notes || [{
			id: 'first-note',
			owner_id: 'demo-me',
			title: '我们的小小约定',
			content: '好好吃饭，慢慢生活。\n看到好看的天空，就拍下来给对方。\n有想念的时候，就按一下那颗爱心。',
			visibility: 'shared',
			created_at: now,
			updated_at: now
		}]
		photos.value = cache?.photos || []
		notesMore.value = false;
		photosMore.value = false;
		hasMore.value = false
	}

	const signIn = async() => {
		if (!email.value.trim() || !password.value) {
			toast('请填写邮箱和密码')
			return
		}

		saveConfig(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
		resetData()
		busy.value = true

		const revision = generation
		try {
			await login(email.value, password.value)
			if (revision !== generation) return
			password.value = ''
			restoreChat()
			entered.value = true
			refreshAll()
			beginSync()
		} catch (e) {
			if (revision === generation) {
				clearSession()
				resetData()
				error(e)
			}
		} finally {
			if (revision === generation) busy.value = false
		}
	}

	/** 建立实时订阅，并通过前台轮询补齐数据变更。 */
	const beginSync = () => {
		stopRealtime?.()
		// 订阅所属的数据代次，防止旧订阅更新新会话。
		const revision = generation
		// table 为变更表名，row 为记录；列表回调中的 m 用于按标识去重。
		stopRealtime = watchChanges((table, row) => {
		if (revision !== generation) return
		if (table === 'messages') {
		if (!row?.id || messages.value.some(m => m.id === row.id)) return
		messages.value.push(row)
		messages.value.sort(compareMessages); persistChat()
		if (row.sender_id !== userId.value && tab.value !== 'chat') {
			unread.value++
			toast('收到 ' + partnerName.value + ' 的新消息')
		}
		if (tab.value === 'chat') bottom()
		return
		}
		if (table === 'miss_you_logs') {
		if (!row?.id || misses.value.some(m => m.id === row.id)) return
		misses.value.unshift(row)
		if (row.sender_id !== userId.value) {
			toast(partnerName.value + ' 说：想你了 ♥');
			heartActive.value = true;
			clearTimeout(heartTimer);
			heartTimer = setTimeout(() => { heartActive.value = false }, 2500)
		}
		return
		}
		if (foreground) refreshAll()
	}, () => { if (revision === generation) refreshAll() })
	clearInterval(poll)
	poll = setInterval(() => { if (foreground) refreshAll() }, 30000)
	}
	
	/** 使旧异步任务失效，停止同步并清空页面业务状态。 */
	const resetData = () => {
		clearTimeout(cacheTimer)
		initialized = new Set()
		cursors = {}
		lastIdCheck = 0
		syncError.value = ''
		syncing.value = false
		generation++
		busy.value = false
		sending.value = false
		exporting.value = false
		loadingHistory.value = false
		hasMore.value = false
		notesMore.value = false
		photosMore.value = false
		clearTimeout(heartTimer)
		heartActive.value = false
		lastRefresh = 0
		photoLoading.clear()
		refreshPromise = null
		stopRealtime?.()
		stopRealtime = null
		clearInterval(poll)
		messages.value = []
		misses.value = []
		notes.value = []
		photos.value = []
		members.value = []
		photoPaths.clear()
		photoFailed.value = {}
		unread.value = 0
		noteOpen.value = false
		noteContent.value = ''
		noteTitle.value = ''
		messageText.value = ''
		entered.value = false
		tab.value = 'home'
	}

	/** 合并并发刷新请求，同步成员、消息、今日想念、笔记和照片。 */
	const refreshAll = async () => {
		if (!cloud.session) return
		if (refreshPromise) {
			return refreshPromise
		}
		// 本次刷新所属代次，防止重置后的状态被覆盖。
		const revision = generation
		// 供并发调用复用，并在结束时释放的刷新任务。
		const task = (async () => {
			syncing.value = true
			syncError.value = ''
			try {
				// 各表独立提交，游标只由连续完成的分页推进，不使用实时消息的时间。
				const readIncremental = async (table: string, target: typeof messages, field: string) => {
					const since = cursors[table] ? new Date(Date.parse(cursors[table]) - 1000).toISOString() : ''
					if (!since && !target.value.length) {
						const recent = await request('/rest/v1/' + table + '?select=*&order=' + field + '.desc,id.desc&limit=50')
						if (revision !== generation) return []
						const merged = new Map(target.value.map(row => [row.id, row]))
						recent.forEach((row: any) => merged.set(row.id, row))
						target.value = [...merged.values()].sort((a, b) => table === 'messages' ? compareMessages(a, b) : Date.parse(b[field]) - Date.parse(a[field]))
					}
					let cursor: any = null
					while (revision === generation) {
						const boundary = cursor ? '&or=' + encodeURIComponent('(' + field + '.gt.' + cursor[field] + ',and(' + field + '.eq.' + cursor[field] + ',id.gt.' + cursor.id + '))') : ''
						const page = await request('/rest/v1/' + table + '?select=*&order=' + field + '.asc,id.asc&limit=100' + (since ? '&' + field + '=gte.' + encodeURIComponent(since) : '') + boundary)
						if (revision !== generation) return []
						const merged = new Map(target.value.map(row => [row.id, row]))
						page.forEach((row: any) => merged.set(row.id, { ...merged.get(row.id), ...row }))
						target.value = Array.from(merged.values()).sort((a, b) => table === 'messages' ? compareMessages(a, b) : Date.parse(b[field]) - Date.parse(a[field]) || b.id.localeCompare(a.id))
						if (page.length) cursors[table] = page[page.length - 1][field]
						clearTimeout(cacheTimer)
						cacheTimer = setTimeout(persistData, 250)
						if (table === 'messages' && tab.value === 'chat' && page.length) bottom()
						if (page.length < 100) break
						cursor = page[page.length - 1]
					}
					if (revision === generation) { initialized.add(table); persistData() }
					return []
				}
				// 仅校验可变数据的可见 ID，避免删除、取消共享后仍留下过期本地记录。
				const reconcile = async (table: string, target: typeof notes) => {
					const before = new Set(target.value.map(row => row.id))
					const ids = new Set<string>()
					let cursor = ''
					while (revision === generation) {
						const page = await request('/rest/v1/' + table + '?select=id&order=id.asc&limit=1000' + (cursor ? '&id=gt.' + encodeURIComponent(cursor) : ''))
						if (revision !== generation) return
						page.forEach((row: any) => ids.add(row.id))
						if (page.length < 1000) break
						cursor = page[page.length - 1].id
					}
					const known = new Set(target.value.map(row => row.id))
					const missing = [...ids].filter(id => !known.has(id))
					for (let i = 0; i < missing.length; i += 50) {
						const rows = await request('/rest/v1/' + table + '?select=*&id=in.(' + missing.slice(i, i + 50).map(encodeURIComponent).join(',') + ')')
						if (revision !== generation) return
						const merged = new Map(target.value.map(row => [row.id, row]))
						rows.forEach((row: any) => merged.set(row.id, row))
						target.value = [...merged.values()]
					}
					const field = table === 'notes' ? 'updated_at' : 'created_at'
					target.value = target.value.filter(row => ids.has(row.id) || !before.has(row.id)).sort((a, b) => table === 'messages' ? compareMessages(a, b) : Date.parse(b[field]) - Date.parse(a[field]) || b.id.localeCompare(a.id))
					persistData()
				}
				const guard = async (work: () => Promise<any>) => {
					try { await work() } catch (e: any) {
						if (revision === generation) syncError.value = '同步未完成，正在显示本地数据：' + (e?.message || '请检查网络')
					}
				}
				await Promise.all([
					guard(async () => {
						const rows = await request('/rest/v1/app_members?select=*')
						if (revision !== generation) return
						if (!rows.some((m: any) => m.user_id === userId.value)) {
							removeCurrentChat(); resetData(); clearSession(); toast('当前账号没有成员权限'); return
						}
						members.value = rows; persistData()
					}),
					guard(async () => { await readIncremental('messages', messages, 'created_at'); if (revision === generation) hasMore.value = false }),
					guard(() => readIncremental('miss_you_logs', misses, 'created_at')),
					guard(async () => { await readIncremental('notes', notes, 'updated_at'); if (revision === generation) await reconcile('notes', notes) }),
					guard(async () => { await readIncremental('photos', photos, 'created_at'); if (revision === generation) await reconcile('photos', photos) })
				])
				if (revision !== generation) return
				// 启动及每十分钟只核对 ID，补回迟提交且落在时间游标之前的记录。
				if (Date.now() - lastIdCheck > 600000) {
					await Promise.all([
						guard(() => reconcile('messages', messages)),
						guard(() => reconcile('miss_you_logs', misses))
					])
					if (revision !== generation) return
					lastIdCheck = Date.now()
				}
				lastRefresh = Date.now()
				notesMore.value = false
				photosMore.value = false
				photoFailed.value = {}
				hydratePhotos()
			} catch (e) { if (revision === generation) error(e) }
			finally { if (revision === generation) syncing.value = false }
		})().finally(() => {
			if (refreshPromise === task) {
				refreshPromise = null
			}
		})
		refreshPromise = task
		return task
	}

	/** 在后台逐项保存图片和视频，不阻塞页面和元数据同步。 */
	const hydratePhotos = async () => {
		const revision = generation
		// photo 为当前待检查的照片，跳过视频、已下载及失败或下载中的项目。
		for (const photo of photos.value) {
			if (revision !== generation || !foreground) return
			if (photo.local || photoFailed.value[photo.id] || photoLoading.has(photo.id)) continue
			photoLoading.add(photo.id)
			// path 为下载路径，current 为当前列表中匹配照片 p 的记录，避免写回旧对象。
			try {
				const path = await downloadPhoto(photo.storage_path)
				if (revision !== generation) return
				photoPaths.set(photo.id, path)
				const current = photos.value.find(p => p.id === photo.id)
				if (current) current.local = path
			}
			catch (_) { if (revision === generation) photoFailed.value[photo.id] = true }
			finally { if (revision === generation) photoLoading.delete(photo.id) }
		}
	}

	/** 按最早消息的复合游标加载一页历史消息。 */
	const loadOlder = async () => {
		if (loadingHistory.value || !messages.value.length) return
		loadingHistory.value = true
		// 历史请求所属的数据代次。
		const revision = generation
		try {
			// 当前列表最早的消息，作为向前翻页边界。
			const first = messages.value[0]
			// 查询早于边界时间与标识的复合筛选条件。
			const cursor = 'or=' + encodeURIComponent('(created_at.lt.' + first.created_at + ',and(created_at.eq.' + first.created_at + ',id.lt.' + first.id + '))')
			// 服务端按时间倒序返回的历史消息页。
			const rows = await request('/rest/v1/messages?select=*&order=created_at.desc,id.desc&limit=50&' + cursor)
			if (revision !== generation) return
			// 已有消息 m 的标识集合，用于过滤分页重叠记录。
			const seen = new Set(messages.value.map(m => m.id))
			messages.value = [...rows.filter((m: any) => !seen.has(m.id)).reverse(), ...messages.value]
			hasMore.value = rows.length === 50
			messages.value.sort(compareMessages); persistChat()
		}
		catch (e) { if (revision === generation) error(e) }
		finally { if (revision === generation) loadingHistory.value = false }
	}

	/** 发送输入框消息并更新列表、缓存与滚动位置。 */
	const sendMessage = async (sticker?) => {
		// 发送正文 / 表情包
		const content = typeof sticker === 'string' ? sticker : messageText.value.trim()
		if (!content || sending.value) return
		sending.value = true
		// 发送操作所属的数据代次。
		const revision = generation
		try {
			// 本地构造或云端返回的消息；后续以消息 m 的标识检查重复。
			const row = (await request('/rest/v1/messages', 'POST', { content }))[0]
			if (revision !== generation) return
			if (!messages.value.some(m => m.id === row.id)) messages.value.push(row)
			messages.value.sort(compareMessages); persistChat()
		if (typeof sticker !== 'string') {
				messageText.value = ''
			}
			bottom()
		}
		catch (e) { if (revision === generation) error(e) }
		finally { if (revision === generation) sending.value = false }
	}

	/** 发送一条想念记录，并在短暂冷却后恢复爱心状态。 */
	const sendMiss = async () => {
	if (heartActive.value) return
	heartActive.value = true
	// 想念发送操作所属的数据代次。
	const revision = generation
	try {
		// 本地构造或云端返回的想念记录；以已有记录 m 的标识去重。
		const row = (await request('/rest/v1/miss_you_logs', 'POST', {}))[0]
		if (revision !== generation) return
		if (!misses.value.some(m => m.id === row.id)) misses.value.unshift(row)
		toast('想念已送出 ♥')
	}
	catch (e) { if (revision === generation) error(e) }
	finally { if (revision === generation) heartTimer = setTimeout(() => { heartActive.value = false }, 1800) }
	}	
	/** 追加下一页笔记，并更新是否还能继续加载。 */
	const loadMoreNotes = async () => {
	// 笔记分页请求所属的数据代次。
	const revision = generation
	// rows 为返回页；n 为新笔记，m 为已有笔记，按标识排除重复。
	try {
		const rows = await request('/rest/v1/notes?select=*&order=updated_at.desc,id.desc&offset=' + notes.value.length + '&limit=50')
		if (revision !== generation) return
		notes.value.push(...rows.filter((n: any) => !notes.value.some(m => m.id === n.id)))
		notesMore.value = rows.length === 50
	} catch (e) { error(e) }
	}	
	/** 追加下一页照片元数据，并补充图片本地路径。 */
	const loadMorePhotos = async () => {
	// 照片分页请求所属的数据代次。
	const revision = generation
	// rows 为返回页；p 为新照片，m 为已有照片，按标识排除重复。
	try {
		const rows = await request('/rest/v1/photos?select=*&order=created_at.desc,id.desc&offset=' + photos.value.length + '&limit=50')
		if (revision !== generation) return
		photos.value.push(...rows.filter((p: any) => !photos.value.some(m => m.id === p.id)))
		photosMore.value = rows.length === 50
		hydratePhotos()
	} catch (e) { error(e) }
	}	
	/** 用 note 初始化笔记面板；空值表示新建，他人笔记只读。 */
	const editNote = (note: any) => {
	editingId.value = note?.id || ''
	noteTitle.value = note?.title || ''
	noteContent.value = note?.content || ''
	noteShared.value = note?.visibility === 'shared'
	noteReadOnly.value = !!note && note.owner_id !== userId.value
	originalNote = JSON.stringify([noteTitle.value, noteContent.value, noteShared.value])
	noteOpen.value = true
	}	
	/** 关闭笔记面板，存在未保存修改时先请求确认。 */
	const closeNote = async () => {
	if (!noteReadOnly.value
		&& originalNote !== JSON.stringify([noteTitle.value, noteContent.value, noteShared.value])
		&& !await confirm('离开后将丢失未保存的修改，确定离开吗？')
	) return
	noteOpen.value = false
	}
	
	/** 保存新建或编辑的笔记，并将最新记录置于列表首位。 */
	const saveNote = async () => {
	if (busy.value || noteReadOnly.value) return
	if (!noteTitle.value.trim() && !noteContent.value.trim()) {
		toast('写点什么再保存吧')
		return
	}
	busy.value = true
	// 笔记保存操作所属的数据代次。
	const revision = generation
	try {
		// 提交到本地或云端的笔记标题、正文与可见性。
		const data = {
		title: noteTitle.value.trim(),
		content: noteContent.value,
		visibility: noteShared.value ? 'shared' : 'private'
		}
		// 云端保存结果，空列表表示无权限或目标已被删除。
		const rows = await request('/rest/v1/notes' + (editingId.value ? '?id=eq.' + editingId.value : ''), editingId.value ? 'PATCH' : 'POST', data)
		if (revision !== generation) return
		if (!rows.length) throw new Error('没有编辑权限，或笔记已被删除')
		notes.value = [rows[0], ...notes.value.filter(n => n.id !== rows[0].id)]
		noteOpen.value = false; toast('小心事已保存')
	}
	catch (e) { if (revision === generation) error(e) }
	finally { if (revision === generation) busy.value = false }
	}	
	/** 确认后删除当前笔记，并关闭笔记面板。 */
	const deleteNote = async () => {
	if (!await confirm('确定删除这篇笔记吗？删除后无法恢复。')) return
	// rows 用于确认云端实际删除记录；n 为按标识移除的列表笔记。
	try {
		const rows = await request('/rest/v1/notes?id=eq.' + editingId.value, 'DELETE')
		if (!rows.length) throw new Error('笔记已删除或无权限')

		notes.value = notes.value.filter(n => n.id !== editingId.value)
		noteOpen.value = false
		toast('笔记已删除')
	} catch (e) { error(e) }
	}	
	/** 选择一张压缩图片，在演示模式保存到本机，否则上传云端。 */
	const addPhoto = async () => {
	if (busy.value) return
	// r 为选图结果；文件保存回调中的 resolve、reject 分别接收成功与失败结果。
	uni.chooseImage({
		count: 1,
		sizeType: ['compressed'],
		success: async r => {
		busy.value = true
		uni.showLoading({ title: '收藏这一刻…', mask: true })
		try {
			// 用户选中图片的临时文件路径。
			const path = r.tempFilePaths[0]
			await uploadPhoto(path)
			await refreshAll()
			
			toast('照片已收藏')
		}
		catch (e) { error(e) }
		finally {
			busy.value = false
			uni.hideLoading()
		}
		},
		fail: () => {}
	})
	}	
	/** 预览 photo，缺少本地路径时先下载并更新缓存。 */
	const previewPhoto = async (photo: any) => { try { if (!photo.local) { photo.local = await downloadPhoto(photo.storage_path); photoPaths.set(photo.id, photo.local); photoFailed.value[photo.id] = false }; uni.previewImage({ urls: [photo.local] }) } catch (e) { error(e) } }
	
	/** 将 photo 对应的图片保存到手机相册。 */
	const savePhoto = async (photo: any) => {
	// path 为已有或新下载的本地图片路径。
	try {
		const path = photo.local || await downloadPhoto(photo.storage_path)
		uni.saveImageToPhotosAlbum({
		filePath: path,
		success: () => toast('已保存到手机相册'),
		fail: () => toast('保存失败，请检查相册权限')
		})
	} catch (e) { error(e) }
	}	
	/** 确认后删除 photo 的文件与元数据，并清理列表及路径缓存。 */
	const deletePhoto = async (photo: any) => {
	if (!await confirm('删除此云端照片后，两个人都无法再从这里下载。请先保存到手机。确定清理？')) return
	try {
		// rows 为元数据删除结果，确认文件清理后记录也已删除。
		await request('/storage/v1/object/photos', 'DELETE', { prefixes: [photo.storage_path] })
		const rows = await request('/rest/v1/photos?id=eq.' + photo.id, 'DELETE')
		if (!rows.length) throw new Error('文件已清理，元数据删除失败，请刷新后重试')

		// #ifndef WEB
		else if (photo.local) uni.getFileSystemManager().removeSavedFile({ filePath: photo.local })
		// #endif
		// p 为列表中的照片，按标识排除已删除项。
		photos.value = photos.value.filter(p => p.id !== photo.id)
		photoPaths.delete(photo.id)
		toast('照片已清理')
	} catch (e) { error(e) }
	}	
	/** 导出全部可访问笔记为文件，失败时提供复制正文的备份方式。 */
	const exportNotes = async () => {
	if (exporting.value) return
	exporting.value = true
	// 导出任务所属的数据代次。
	const revision = generation
	// 已生成的导出正文，文件导出失败时用于复制备份。
	let text = ''
	try {
		// 待导出的笔记集合，真实模式下改为分页获取全部记录。
		let rows = [...notes.value]


		if (revision !== generation) return
		if (!rows.length) {
		toast('还没有可以导出的笔记')
		return
		}
		// n 为待导出笔记，将标题、元数据和正文拼接为文档内容。
		text = '# 我们俩 · 笔记导出\n\n导出时间：' + new Date().toISOString() + '\n\n' + rows.map(n => '## ' + (n.title || '无题') + '\n\n可见性：' + n.visibility + '\n作者：' + n.owner_id + '\n创建时间：' + n.created_at + '\n更新时间：' + n.updated_at + '\n\n' + n.content + '\n\n---\n').join('\n')
		// 导出工具返回的文件位置或保存结果说明。
		const destination = await exportNoteFile(text)
		if (revision !== generation) return
		uni.showModal({ title: '本地笔记已导出', content: (initialized.has('notes') ? '' : '首次同步尚未完成，本次仅包含已保存到本机的笔记。\n') + destination, showCancel: false })
	} catch (e: any) {
		if (revision !== generation) return
		if (!text) { error(e); return }
		// 是否同意复制备份；e 为导出异常，r 为弹窗结果，resolve 返回确认状态。
		const copy = await new Promise<boolean>(resolve => uni.showModal({ title: '导出失败', content: (e?.message || '无法生成文件') + '\n是否复制笔记内容作为备份？', confirmText: '复制内容', success: r => resolve(r.confirm), fail: () => resolve(false) }))
		if (!copy || revision !== generation) return
		await new Promise<void>(resolve => uni.setClipboardData({ data: text, showToast: false, success: () => { if (revision === generation) toast('笔记内容已复制'); resolve() }, fail: () => { if (revision === generation) toast('复制失败，请稍后重新导出'); resolve() } }))
	} finally { if (revision === generation) exporting.value = false }
	}	
	/** 清理聊天与图片缓存，并保留当前登录入口和页签重新加载数据。 */
	const clearCache = async () => {
	// 确认弹窗打开前的数据代次。
	const revision = generation
	if (!await confirm('将删除本机保存的聊天、笔记、想念和媒体文件。离线时将无法查看，联网后会重新下载。确定清理？')) return
	if (revision !== generation) return
	try { await clearMediaCacheScope({ url: cloud.url, userId: userId.value }) }
	catch (e) { error(e); return }
	if (revision !== generation) return
	removeCurrentChat()
	// #ifndef WEB
	// 用于删除已下载临时图片的文件系统管理器。
	const fs = uni.getFileSystemManager()
	// path 为缓存映射中的本地图片路径。
	for (const path of photoPaths.values()) fs.unlink({ filePath: path })
	// #endif
		// 数据重置前是否已经进入主界面。
		const wasEntered = entered.value
		// 数据重置前选中的页签。
		const currentTab = tab.value
		resetData()
		entered.value = wasEntered
		tab.value = currentTab
		// 重置后的数据代次，用于检查重新加载期间是否再次重置。
		const reloadRevision = generation
		await refreshAll()
		if (reloadRevision !== generation) return
		if (cloud.session && entered.value) beginSync()
	toast(syncError.value ? '缓存已清理，联网后将重新同步' : '本地缓存已刷新')
	}	
	/** 执行退出并确保清理本地会话，即使云端退出失败也完成收尾。 */
	const finishSignOut = async () => {
	if (signingOut) return
	signingOut = true
	// 退出前的模式，决定是否需要调用云端退出。
	persistData()
	resetData()
	// 清理后所属的数据代次，限制退出收尾操作的作用范围。
	const revision = generation
	try { await logout() }
	catch (_) { /* Local session cleanup is completed below. */ }
	finally { signingOut = false; if (revision === generation) { clearSession(); resetData();} }
	}	
	/** 根据当前模式展示退出确认，通过后执行退出流程。 */
	const signOut = async () => {
	// 确认弹窗打开前的数据代次。
	const revision = generation
	if (!await confirm('确定退出当前账号？')) return
	if (revision !== generation) return
	await finishSignOut()
	}	
	/** 更新当前时间，跨日时刷新真实账号的数据。 */
	const updateNow = () => {
	// 更新时间前的本地日期，用于判断是否跨日。
	const previousDay = new Date(now.value).toDateString()
	now.value = Date.now()
	if (previousDay !== new Date(now.value).toDateString() && entered.value) refreshAll()
	}	
	// 每秒更新展示时间与跨日检测的定时器。
	const clock = setInterval(updateNow, 1000)	
	/** 页面回到前台时更新时间，并按需刷新数据和补充照片下载。 */
	const handleShow = () => {
	foreground = true
	updateNow()
	if (entered.value) {
		if (Date.now() - lastRefresh > 10000) refreshAll()
		hydratePhotos()
	}
	}
	
	/** 标记页面进入后台，暂停受前台状态约束的同步工作。 */
	const handleHide = () => { persistData(); foreground = false }
	onUnmounted(() => {
	persistData()
	resetData()
	clearInterval(clock)
	})	
	if (configured() && cloud.session) {
	restoreChat()
	entered.value = true
	refreshAll()
	beginSync()
	}
	
	return {
	tabs, tab, entered, busy, sending, exporting, syncing, syncError, email, password, messages, misses, notes, photos,
	members, unread, messageText, scrollTarget, heartActive, hasMore, loadingHistory, notesMore, photosMore,
	photoFailed, noteOpen, noteTitle, noteContent, noteShared, editingId,
	noteReadOnly, noteFilter, cloud, userId, myName, partnerName, today, todayMiss, todayMisses, latestMiss,
	filteredNotes, toast, configured, formatDate, formatTime, switchTab, startDemo, signIn,
	refreshAll, loadOlder, sendMessage, sendMiss, loadMoreNotes, loadMorePhotos, editNote, closeNote,
	saveNote, deleteNote, addPhoto, previewPhoto, savePhoto, deletePhoto, exportNotes, clearCache, signOut,
	finishSignOut, handleShow, handleHide
	}
}
