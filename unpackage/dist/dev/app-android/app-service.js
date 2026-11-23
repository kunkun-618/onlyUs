(function(vue) {
  "use strict";
  function currentPageCaptureScreenshot(fullPage, callback) {
    var _a;
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    (_a = currentPage.vm) === null || _a === void 0 ? void 0 : _a.$viewToTempFilePath({
      wholeContent: fullPage,
      overwrite: true,
      success: (res) => {
        const fileManager = uni.getFileSystemManager();
        fileManager.readFile({
          encoding: "base64",
          filePath: res.tempFilePath,
          success(readFileRes) {
            callback(readFileRes.data, "");
          },
          fail(err) {
            callback("", `captureScreenshot fail: ${JSON.stringify(err)}`);
          }
        });
      },
      fail: (err) => {
        callback("", `captureScreenshot fail: ${JSON.stringify(err)}`);
      }
    });
  }
  function initRuntimeSocket(hosts, port, id) {
    if (hosts == "" || port == "" || id == "")
      return Promise.resolve(null);
    return hosts.split(",").reduce((promise, host) => {
      return promise.then((socket) => {
        if (socket != null)
          return Promise.resolve(socket);
        return tryConnectSocket(host, port, id);
      });
    }, Promise.resolve(null));
  }
  const SOCKET_TIMEOUT = 500;
  function tryConnectSocket(host, port, id) {
    return new Promise((resolve, reject) => {
      const socket = uni.connectSocket({
        url: `ws://${host}:${port}/${id}`,
        fail() {
          resolve(null);
        }
      });
      const timer = setTimeout(() => {
        socket.close({
          code: 1006,
          reason: "connect timeout"
        });
        resolve(null);
      }, SOCKET_TIMEOUT);
      socket.onOpen((e) => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.onClose((e) => {
        clearTimeout(timer);
        resolve(null);
      });
      socket.onError((e) => {
        clearTimeout(timer);
        resolve(null);
      });
      socket.onMessage((result) => {
        if (typeof result["data"] == "string") {
          const message = JSON.parse(result["data"]);
          if (message["type"] == "screencap") {
            const id2 = message["id"];
            currentPageCaptureScreenshot(message["fullPage"], (base64, error) => {
              socket.send({
                data: JSON.stringify({
                  id: id2,
                  base64,
                  error
                })
              });
            });
          }
        }
        resolve(null);
      });
    });
  }
  function initRuntimeSocketService() {
    const hosts = "10.58.129.51";
    const port = "8090";
    const id = "app-android_PGq3Bp";
    return Promise.resolve().then(() => {
      return initRuntimeSocket(hosts, port, id).then((socket) => {
        if (socket == null) {
          return false;
        }
        return true;
      });
    }).catch(() => {
      return false;
    });
  }
  initRuntimeSocketService();
  const ON_SHOW = "onShow";
  const ON_HIDE = "onHide";
  const ON_UNLOAD = "onUnload";
  function isUniApp(target) {
    const proxy = target === null || target === void 0 ? void 0 : target.proxy;
    const ctx = target === null || target === void 0 ? void 0 : target.ctx;
    const type = target === null || target === void 0 ? void 0 : target.type;
    return (proxy === null || proxy === void 0 ? void 0 : proxy.$mpType) === "app" || (ctx === null || ctx === void 0 ? void 0 : ctx.$mpType) === "app" || (type === null || type === void 0 ? void 0 : type.mpType) === "app";
  }
  function getAppVm() {
    const app = getApp({ allowDefault: true });
    return app === null || app === void 0 ? void 0 : app.$vm;
  }
  function removeAppHook(vm, name, hook, originalHook, target) {
    const hooks = vm.$[name];
    if (!Array.isArray(hooks)) {
      return;
    }
    for (let i = hooks.length - 1; i >= 0; i--) {
      const appHook = hooks[i];
      if (appHook === hook || originalHook && appHook.__uni_app_hook === originalHook && appHook.__uni_app_target === target) {
        hooks.splice(i, 1);
      }
    }
  }
  function isTargetInvalid(target) {
    var _a;
    return (target === null || target === void 0 ? void 0 : target.isUnmounted) || (target === null || target === void 0 ? void 0 : target.__isUnload) || ((_a = target === null || target === void 0 ? void 0 : target.root) === null || _a === void 0 ? void 0 : _a.__isUnload);
  }
  function queueRemoveAppHook(removeHook) {
    Promise.resolve().then(removeHook);
  }
  function injectAppHook(lifecycle, hook, target) {
    const isAppInstance = isUniApp(target);
    const appVm = getAppVm();
    const appInstance = isAppInstance ? target : appVm === null || appVm === void 0 ? void 0 : appVm.$;
    if (appInstance) {
      if (isAppInstance) {
        vue.injectHook(lifecycle, hook, appInstance);
        return;
      }
      let isRemoved = false;
      let wrappedHook;
      const removeHook = () => {
        if (isRemoved || !wrappedHook) {
          return;
        }
        isRemoved = true;
        const appVm2 = getAppVm();
        appVm2 && removeAppHook(appVm2, lifecycle, wrappedHook, hook, target);
      };
      const appHook = (...args) => {
        if (isRemoved || isTargetInvalid(target)) {
          queueRemoveAppHook(removeHook);
          return;
        }
        return hook(...args);
      };
      wrappedHook = vue.injectHook(lifecycle, appHook, appInstance);
      if (wrappedHook) {
        wrappedHook.__uni_app_hook = hook;
        wrappedHook.__uni_app_target = target;
        if (isTargetInvalid(target)) {
          removeHook();
        }
      }
      if (target && wrappedHook) {
        vue.onBeforeUnmount(() => removeHook(), target);
        vue.injectHook(ON_UNLOAD, () => removeHook(), target);
      }
    }
  }
  const createLifeCycleHook = (lifecycle, flag = 0) => (hook, target = vue.getCurrentInstance()) => {
    if (vue.isInSSRComponentSetup)
      return;
    if (flag === 1) {
      injectAppHook(lifecycle, hook, target);
      return;
    }
    vue.injectHook(lifecycle, hook, target);
  };
  const onShow = /* @__PURE__ */ createLifeCycleHook(
    ON_SHOW,
    2
    /* HookFlags.PAGE */
  );
  const onHide = /* @__PURE__ */ createLifeCycleHook(
    ON_HIDE,
    2
    /* HookFlags.PAGE */
  );
  const pairAppKey = Symbol("pair-app");
  function providePairContext(app) {
    vue.provide(pairAppKey, app);
  }
  function usePairContext() {
    const app = vue.inject(pairAppKey);
    if (!app)
      throw new Error("Pair app context is unavailable");
    return app;
  }
  const cloud = vue.reactive({
    url: String(uni.getStorageSync("pair_url") || ""),
    key: String(uni.getStorageSync("pair_key") || ""),
    session: uni.getStorageSync("pair_session") || null,
    status: "未连接"
  });
  function configured() {
    return cloud.url.length > 0 && cloud.key.length > 0;
  }
  let authVersion = 0;
  function saveConfig(url, key) {
    const clean = url.trim().replace(/\/+$/, "");
    if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(clean))
      throw new Error("请输入有效的 HTTPS 项目地址");
    const cleanKey = key.trim();
    if (!cleanKey.startsWith("sb_publishable_")) {
      const payload = cleanKey.split(".")[1] || "";
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let bits = 0, value = 0, decoded = "";
      for (const char of payload.replace(/-/g, "+").replace(/_/g, "/")) {
        const digit = alphabet.indexOf(char);
        if (digit < 0)
          continue;
        value = value << 6 | digit;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          decoded += String.fromCharCode(value >> bits & 255);
        }
      }
      let role = "";
      try {
        role = JSON.parse(decoded).role;
      } catch (_) {
      }
      if (role !== "anon")
        throw new Error("只允许 anon JWT 或 sb_publishable_ 公开密钥");
    }
    clearSession();
    cloud.url = clean;
    cloud.key = key.trim();
    uni.setStorageSync("pair_url", cloud.url);
    uni.setStorageSync("pair_key", cloud.key);
  }
  function raw(path, method = "GET", data = void 0, token2 = "") {
    return new Promise((resolve, reject) => {
      uni.request({
        url: cloud.url + path,
        method,
        timeout: 15e3,
        data,
        header: { apikey: cloud.key, Authorization: "Bearer " + (token2 || cloud.key), "Content-Type": "application/json", Prefer: "return=representation" },
        success: (r) => {
          if (r.statusCode >= 200 && r.statusCode < 300)
            resolve(r.data);
          else
            reject(new Error(r.data?.msg || r.data?.message || r.data?.error_description || r.data?.error || "请求失败 " + r.statusCode));
        },
        fail: () => reject(new Error("网络连接失败，请检查网络和项目地址"))
      });
    });
  }
  let refreshing = null;
  function persistSession(session) {
    cloud.session = { ...session, expires_at: Date.now() + session.expires_in * 1e3 };
    uni.setStorageSync("pair_session", cloud.session);
  }
  async function token() {
    if (!cloud.session)
      throw new Error("请先登录");
    if (cloud.session.expires_at < Date.now() + 6e4) {
      if (!refreshing) {
        const version = authVersion;
        const task = raw("/auth/v1/token?grant_type=refresh_token", "POST", { refresh_token: cloud.session.refresh_token }).then((session) => {
          if (version !== authVersion)
            throw new Error("登录会话已变更");
          persistSession(session);
        }).finally(() => {
          if (refreshing === task)
            refreshing = null;
        });
        refreshing = task;
      }
      await refreshing;
    }
    if (!cloud.session)
      throw new Error("请重新登录");
    return cloud.session.access_token;
  }
  async function request(path, method = "GET", data = void 0) {
    const version = authVersion;
    const access = await token();
    if (version !== authVersion)
      throw new Error("登录会话已变更");
    const result = await raw(path, method, data, access);
    if (version !== authVersion)
      throw new Error("登录会话已变更");
    return result;
  }
  async function login(email, password) {
    clearSession();
    const version = authVersion;
    const session = await raw("/auth/v1/token?grant_type=password", "POST", { email: email.trim(), password });
    if (version !== authVersion)
      throw new Error("登录会话已变更");
    persistSession(session);
    try {
      const members = await request("/rest/v1/app_members?select=*");
      if (!members.some((m) => m.user_id === session.user.id))
        throw new Error("该账号不在双人成员名单内");
    } catch (e) {
      clearSession();
      throw e;
    }
  }
  function clearSession() {
    authVersion++;
    refreshing = null;
    cloud.session = null;
    uni.removeStorageSync("pair_session");
  }
  async function logout() {
    try {
      if (cloud.session)
        await request("/auth/v1/logout", "POST");
    } finally {
      clearSession();
    }
  }
  function watchChanges(onChange, onResync) {
    let stopped = false;
    let socket = null;
    let heartbeat = null;
    let reconnect = null;
    let ref = 0;
    let delay = 1e3;
    let lastHeartbeat = 0;
    const tables = ["messages", "miss_you_logs", "photos"];
    const send = (topic, event, payload) => socket?.send({ data: JSON.stringify({ topic, event, payload, ref: String(++ref) }) });
    const schedule = () => {
      clearInterval(heartbeat);
      if (stopped || reconnect)
        return;
      cloud.status = "重连中";
      reconnect = setTimeout(() => {
        reconnect = null;
        connect();
      }, delay);
      delay = Math.min(delay * 2, 3e4);
    };
    const connect = async () => {
      try {
        const access = await token();
        if (stopped)
          return;
        cloud.status = "连接中";
        let joined = 0;
        socket = uni.connectSocket({ url: cloud.url.replace("https:", "wss:") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(cloud.key) + "&vsn=1.0.0", complete: () => {
        } });
        socket.onOpen(() => {
          for (const table of tables)
            send("realtime:pair-" + table, "phx_join", {
              config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [{ event: table === "photos" ? "*" : "INSERT", schema: "public", table }] },
              access_token: access
            });
          lastHeartbeat = Date.now();
          heartbeat = setInterval(async () => {
            try {
              if (Date.now() - lastHeartbeat > 6e4) {
                socket.close({});
                schedule();
                return;
              }
              const fresh = await token();
              for (const table of tables)
                send("realtime:pair-" + table, "access_token", { access_token: fresh });
              send("phoenix", "heartbeat", {});
            } catch (_) {
              socket.close({});
              schedule();
            }
          }, 25e3);
        });
        socket.onMessage((message) => {
          try {
            const frame = JSON.parse(message.data);
            if (frame.event === "phx_reply" && frame.payload?.status === "ok")
              lastHeartbeat = Date.now();
            if (frame.event === "system") {
              if (frame.payload?.status === "ok") {
                joined++;
                if (joined >= tables.length) {
                  cloud.status = "实时已连接";
                  delay = 1e3;
                  onResync();
                }
              } else {
                cloud.status = "订阅失败";
                socket.close({});
                schedule();
              }
            }
            if (frame.event === "postgres_changes")
              onChange(frame.payload.data.table, frame.payload.data.record);
            if (frame.event === "phx_error" || frame.event === "phx_reply" && frame.payload?.status === "error") {
              socket.close({});
              schedule();
            }
          } catch (_) {
          }
        });
        socket.onClose(schedule);
        socket.onError(schedule);
      } catch (_) {
        schedule();
      }
    };
    connect();
    return () => {
      stopped = true;
      clearInterval(heartbeat);
      clearTimeout(reconnect);
      socket?.close({});
      cloud.status = "未连接";
    };
  }
  async function uploadPhoto(filePath) {
    const access = await token();
    const path = cloud.session.user.id + "/" + Date.now() + "_" + Math.random().toString(36).slice(2) + ".jpg";
    await new Promise((resolve, reject) => uni.uploadFile({
      url: cloud.url + "/storage/v1/object/photos/" + path,
      filePath,
      name: "file",
      header: { apikey: cloud.key, Authorization: "Bearer " + access, "x-upsert": "false" },
      success: (r) => r.statusCode >= 200 && r.statusCode < 300 ? resolve() : reject(new Error("照片上传失败：" + r.data)),
      fail: () => reject(new Error("照片上传失败，请重试"))
    }));
    try {
      return await request("/rest/v1/photos", "POST", { storage_path: path, file_name: "照片_" + Date.now() + ".jpg" });
    } catch (e) {
      const rows = await request("/rest/v1/photos?storage_path=eq." + encodeURIComponent(path));
      if (rows.length)
        return rows;
      await request("/storage/v1/object/photos", "DELETE", { prefixes: [path] });
      throw e;
    }
  }
  async function downloadPhoto(path) {
    const access = await token();
    return new Promise((resolve, reject) => uni.downloadFile({
      url: cloud.url + "/storage/v1/object/authenticated/photos/" + path.split("/").map(encodeURIComponent).join("/"),
      header: { apikey: cloud.key, Authorization: "Bearer " + access },
      success: (r) => r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new Error("无法下载照片")),
      fail: () => reject(new Error("照片下载失败"))
    }));
  }
  function usePairApp() {
    const tabs = [{ key: "home", label: "我们", icon: "♥" }, { key: "chat", label: "聊天", icon: "☏" }, { key: "photos", label: "相册", icon: "▧" }, { key: "notes", label: "笔记", icon: "✎" }, { key: "settings", label: "设置", icon: "⚙" }];
    const tab = vue.ref("home");
    const entered = vue.ref(false);
    const demo = vue.ref(false);
    const busy = vue.ref(false);
    const sending = vue.ref(false);
    const email = vue.ref("");
    const password = vue.ref("");
    const messages = vue.ref([]);
    const misses = vue.ref([]);
    const notes = vue.ref([]);
    const photos = vue.ref([]);
    const members = vue.ref([]);
    const unread = vue.ref(0);
    const messageText = vue.ref("");
    const scrollTarget = vue.ref("");
    const heartActive = vue.ref(false);
    const hasMore = vue.ref(false);
    const loadingHistory = vue.ref(false);
    const notesMore = vue.ref(false);
    const photosMore = vue.ref(false);
    const photoFailed = vue.ref({});
    const configOpen = vue.ref(false);
    const configUrl = vue.ref(cloud.url);
    const configKey = vue.ref(cloud.key);
    const noteOpen = vue.ref(false);
    const noteTitle = vue.ref("");
    const noteContent = vue.ref("");
    const noteShared = vue.ref(false);
    const editingId = vue.ref("");
    const noteReadOnly = vue.ref(false);
    const noteFilter = vue.ref("all");
    let originalNote = "";
    let stopRealtime = null;
    let poll = null;
    let heartTimer = null;
    let refreshPromise = null;
    let refreshAgain = false;
    let generation = 0;
    let lastRefresh = 0;
    let foreground = true;
    const photoLoading = /* @__PURE__ */ new Set();
    const photoPaths = /* @__PURE__ */ new Map();
    const userId = vue.computed(() => demo.value ? "demo-me" : cloud.session?.user.id || "");
    const myName = vue.computed(() => demo.value ? "小满" : members.value.find((m) => m.user_id === userId.value)?.display_name || "我");
    const partnerName = vue.computed(() => demo.value ? "阿屿" : members.value.find((m) => m.user_id !== userId.value)?.display_name || "你");
    const today = (/* @__PURE__ */ new Date()).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    const todayMiss = vue.computed(() => misses.value.filter((m) => new Date(m.created_at).toDateString() === (/* @__PURE__ */ new Date()).toDateString()).length);
    const latestMiss = vue.computed(() => misses.value[0]);
    const filteredNotes = vue.computed(() => notes.value.filter((n) => noteFilter.value === "all" || n.visibility === noteFilter.value));
    function toast(title) {
      uni.showToast({ title, icon: "none" });
    }
    function error(e) {
      toast(e?.message || "操作未完成，请稍后重试");
    }
    function formatDate(value) {
      return new Date(value).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
    }
    function formatTime(value) {
      return formatDate(value) + " " + new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    function confirm(content) {
      return new Promise((resolve) => uni.showModal({ title: "请确认", content, success: (r) => resolve(r.confirm), fail: () => resolve(false) }));
    }
    function localId() {
      return "local-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }
    function persistDemo() {
      if (demo.value)
        uni.setStorageSync("pair_demo", { messages: messages.value, misses: misses.value, notes: notes.value, photos: photos.value });
    }
    function bottom() {
      scrollTarget.value = "";
      setTimeout(() => {
        scrollTarget.value = "chat-end";
      }, 100);
    }
    function switchTab(key) {
      if (tab.value === key)
        return;
      tab.value = key;
      if (key === "chat") {
        unread.value = 0;
        bottom();
      }
      if (key === "photos" && !demo.value)
        hydratePhotos();
      if (!demo.value && Date.now() - lastRefresh > 3e4)
        refreshAll();
    }
    function startDemo() {
      demo.value = true;
      entered.value = true;
      const cache = uni.getStorageSync("pair_demo");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      messages.value = cache?.messages || [{ id: "welcome", sender_id: "demo-partner", content: "把想说的话都放在这里吧，日常的小事也想听你说。", created_at: now }];
      misses.value = cache?.misses || [];
      notes.value = cache?.notes || [{ id: "first-note", owner_id: "demo-me", title: "我们的小小约定", content: "好好吃饭，慢慢生活。\n看到好看的天空，就拍下来给对方。\n有想念的时候，就按一下那颗爱心。", visibility: "shared", created_at: now, updated_at: now }];
      photos.value = cache?.photos || [];
      notesMore.value = false;
      photosMore.value = false;
      hasMore.value = false;
    }
    async function signIn() {
      if (!configured()) {
        configOpen.value = true;
        return;
      }
      if (!email.value.trim() || !password.value) {
        toast("请填写邮箱和密码");
        return;
      }
      busy.value = true;
      try {
        await login(email.value, password.value);
        password.value = "";
        demo.value = false;
        await refreshAll();
        if (!cloud.session || !members.value.length)
          throw new Error("初始数据加载失败，请检查网络后重试");
        entered.value = true;
        beginSync();
      } catch (e) {
        clearSession();
        error(e);
      } finally {
        busy.value = false;
      }
    }
    function beginSync() {
      stopRealtime?.();
      stopRealtime = watchChanges((table, row) => {
        if (table === "messages") {
          if (!row?.id || messages.value.some((m) => m.id === row.id))
            return;
          messages.value.push(row);
          if (row.sender_id !== userId.value && tab.value !== "chat") {
            unread.value++;
            toast("收到 " + partnerName.value + " 的新消息");
          }
          if (tab.value === "chat")
            bottom();
          return;
        }
        if (table === "miss_you_logs") {
          if (!row?.id || misses.value.some((m) => m.id === row.id))
            return;
          misses.value.unshift(row);
          if (row.sender_id !== userId.value) {
            toast(partnerName.value + " 说：想你了 ♥");
            heartActive.value = true;
            clearTimeout(heartTimer);
            heartTimer = setTimeout(() => {
              heartActive.value = false;
            }, 2500);
          }
          return;
        }
        if (foreground)
          refreshAll();
      }, () => {
        refreshAll();
      });
      clearInterval(poll);
      poll = setInterval(() => {
        if (foreground)
          refreshAll();
      }, 3e4);
    }
    function resetData() {
      generation++;
      lastRefresh = 0;
      photoLoading.clear();
      refreshPromise = null;
      refreshAgain = false;
      stopRealtime?.();
      stopRealtime = null;
      clearInterval(poll);
      messages.value = [];
      misses.value = [];
      notes.value = [];
      photos.value = [];
      members.value = [];
      photoPaths.clear();
      photoFailed.value = {};
      unread.value = 0;
      noteOpen.value = false;
      noteContent.value = "";
      noteTitle.value = "";
      messageText.value = "";
      entered.value = false;
      tab.value = "home";
    }
    async function applyConfig() {
      try {
        saveConfig(configUrl.value, configKey.value);
        resetData();
        clearSession();
        demo.value = false;
        configOpen.value = false;
        toast("连接已保存，请使用预置账号登录");
      } catch (e) {
        error(e);
      }
    }
    async function refreshAll() {
      if (demo.value || !cloud.session)
        return;
      if (refreshPromise) {
        refreshAgain = true;
        return refreshPromise;
      }
      const revision = generation;
      const task = (async () => {
        try {
          const result = await Promise.all([
            request("/rest/v1/app_members?select=*"),
            request("/rest/v1/messages?select=*&order=created_at.desc,id.desc&limit=50"),
            request("/rest/v1/miss_you_logs?select=*&order=created_at.desc,id.desc&created_at=gte." + encodeURIComponent(new Date((/* @__PURE__ */ new Date()).setHours(0, 0, 0, 0)).toISOString())),
            request("/rest/v1/notes?select=*&order=updated_at.desc,id.desc&limit=" + Math.max(notes.value.length, 50)),
            request("/rest/v1/photos?select=*&order=created_at.desc,id.desc&limit=" + Math.max(photos.value.length, 50))
          ]);
          if (revision !== generation)
            return;
          if (!result[0].some((m) => m.user_id === userId.value)) {
            resetData();
            clearSession();
            throw new Error("当前账号没有成员权限");
          }
          lastRefresh = Date.now();
          if (JSON.stringify(members.value) !== JSON.stringify(result[0]))
            members.value = result[0];
          const ids = new Set(messages.value.map((m) => m.id));
          const newCount = result[1].filter((m) => !ids.has(m.id)).length;
          const merged = new Map(messages.value.map((m) => [m.id, m]));
          result[1].forEach((m) => merged.set(m.id, m));
          if (newCount)
            messages.value = Array.from(merged.values()).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
          if (!hasMore.value && messages.value.length <= 50)
            hasMore.value = result[1].length === 50;
          if (JSON.stringify(misses.value) !== JSON.stringify(result[2]))
            misses.value = result[2];
          notesMore.value = result[3].length >= Math.max(notes.value.length, 50);
          if (notes.value.length !== result[3].length || notes.value.some((n, i) => n.id !== result[3][i].id || n.updated_at !== result[3][i].updated_at))
            notes.value = result[3];
          photosMore.value = result[4].length >= Math.max(photos.value.length, 50);
          if (photos.value.length !== result[4].length || photos.value.some((p, i) => p.id !== result[4][i].id))
            photos.value = result[4].map((p) => ({ ...p, local: photoPaths.get(p.id) || "" }));
          if (tab.value === "chat" && newCount)
            bottom();
          if (tab.value === "photos")
            hydratePhotos();
        } catch (e) {
          error(e);
        }
      })().finally(() => {
        if (refreshPromise === task) {
          refreshPromise = null;
          if (refreshAgain) {
            refreshAgain = false;
            refreshAll();
          }
        }
      });
      refreshPromise = task;
      return task;
    }
    async function hydratePhotos() {
      const revision = generation;
      for (const photo of photos.value) {
        if (revision !== generation || tab.value !== "photos" || !foreground)
          return;
        if (photo.local || photoFailed.value[photo.id] || photoLoading.has(photo.id))
          continue;
        photoLoading.add(photo.id);
        try {
          const path = await downloadPhoto(photo.storage_path);
          if (revision !== generation)
            return;
          photoPaths.set(photo.id, path);
          const current = photos.value.find((p) => p.id === photo.id);
          if (current)
            current.local = path;
        } catch (_) {
          if (revision === generation)
            photoFailed.value[photo.id] = true;
        } finally {
          photoLoading.delete(photo.id);
        }
      }
    }
    async function loadOlder() {
      if (loadingHistory.value || demo.value || !messages.value.length)
        return;
      loadingHistory.value = true;
      const revision = generation;
      try {
        const first = messages.value[0];
        const cursor = "or=" + encodeURIComponent("(created_at.lt." + first.created_at + ",and(created_at.eq." + first.created_at + ",id.lt." + first.id + "))");
        const rows = await request("/rest/v1/messages?select=*&order=created_at.desc,id.desc&limit=50&" + cursor);
        if (revision !== generation)
          return;
        const seen = new Set(messages.value.map((m) => m.id));
        messages.value = [...rows.filter((m) => !seen.has(m.id)).reverse(), ...messages.value];
        hasMore.value = rows.length === 50;
      } catch (e) {
        error(e);
      } finally {
        loadingHistory.value = false;
      }
    }
    async function sendMessage() {
      const content = messageText.value.trim();
      if (!content || sending.value)
        return;
      sending.value = true;
      const revision = generation;
      try {
        const row = demo.value ? { id: localId(), sender_id: userId.value, content, created_at: (/* @__PURE__ */ new Date()).toISOString() } : (await request("/rest/v1/messages", "POST", { content }))[0];
        if (revision !== generation)
          return;
        if (!messages.value.some((m) => m.id === row.id))
          messages.value.push(row);
        messageText.value = "";
        persistDemo();
        bottom();
      } catch (e) {
        error(e);
      } finally {
        sending.value = false;
      }
    }
    async function sendMiss() {
      if (heartActive.value)
        return;
      heartActive.value = true;
      const revision = generation;
      try {
        const row = demo.value ? { id: localId(), sender_id: userId.value, created_at: (/* @__PURE__ */ new Date()).toISOString() } : (await request("/rest/v1/miss_you_logs", "POST", {}))[0];
        if (revision !== generation)
          return;
        if (!misses.value.some((m) => m.id === row.id))
          misses.value.unshift(row);
        persistDemo();
        toast(demo.value ? "已记录一份想念（本地演示）" : "想念已送出 ♥");
      } catch (e) {
        error(e);
      } finally {
        heartTimer = setTimeout(() => {
          heartActive.value = false;
        }, 1800);
      }
    }
    async function loadMoreNotes() {
      const revision = generation;
      try {
        const rows = await request("/rest/v1/notes?select=*&order=updated_at.desc,id.desc&offset=" + notes.value.length + "&limit=50");
        if (revision !== generation)
          return;
        notes.value.push(...rows.filter((n) => !notes.value.some((m) => m.id === n.id)));
        notesMore.value = rows.length === 50;
      } catch (e) {
        error(e);
      }
    }
    async function loadMorePhotos() {
      const revision = generation;
      try {
        const rows = await request("/rest/v1/photos?select=*&order=created_at.desc,id.desc&offset=" + photos.value.length + "&limit=50");
        if (revision !== generation)
          return;
        photos.value.push(...rows.filter((p) => !photos.value.some((m) => m.id === p.id)));
        photosMore.value = rows.length === 50;
        hydratePhotos();
      } catch (e) {
        error(e);
      }
    }
    function editNote(note) {
      editingId.value = note?.id || "";
      noteTitle.value = note?.title || "";
      noteContent.value = note?.content || "";
      noteShared.value = note?.visibility === "shared";
      noteReadOnly.value = !!note && note.owner_id !== userId.value;
      originalNote = JSON.stringify([noteTitle.value, noteContent.value, noteShared.value]);
      noteOpen.value = true;
    }
    async function closeNote() {
      if (!noteReadOnly.value && originalNote !== JSON.stringify([noteTitle.value, noteContent.value, noteShared.value]) && !await confirm("离开后将丢失未保存的修改，确定离开吗？"))
        return;
      noteOpen.value = false;
    }
    async function saveNote() {
      if (busy.value || noteReadOnly.value)
        return;
      if (!noteTitle.value.trim() && !noteContent.value.trim()) {
        toast("写点什么再保存吧");
        return;
      }
      busy.value = true;
      try {
        const data = { title: noteTitle.value.trim(), content: noteContent.value, visibility: noteShared.value ? "shared" : "private" };
        if (demo.value) {
          const old = notes.value.find((n) => n.id === editingId.value);
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const row = { ...data, id: editingId.value || localId(), owner_id: userId.value, created_at: old?.created_at || now, updated_at: now };
          notes.value = [row, ...notes.value.filter((n) => n.id !== row.id)];
          persistDemo();
        } else {
          const rows = await request("/rest/v1/notes" + (editingId.value ? "?id=eq." + editingId.value : ""), editingId.value ? "PATCH" : "POST", data);
          if (!rows.length)
            throw new Error("没有编辑权限，或笔记已被删除");
          notes.value = [rows[0], ...notes.value.filter((n) => n.id !== rows[0].id)];
        }
        noteOpen.value = false;
        toast("小心事已保存");
      } catch (e) {
        error(e);
      } finally {
        busy.value = false;
      }
    }
    async function deleteNote() {
      if (!await confirm("确定删除这篇笔记吗？删除后无法恢复。"))
        return;
      try {
        if (!demo.value) {
          const rows = await request("/rest/v1/notes?id=eq." + editingId.value, "DELETE");
          if (!rows.length)
            throw new Error("笔记已删除或无权限");
        }
        ;
        notes.value = notes.value.filter((n) => n.id !== editingId.value);
        persistDemo();
        noteOpen.value = false;
        toast("笔记已删除");
      } catch (e) {
        error(e);
      }
    }
    async function addPhoto() {
      if (busy.value)
        return;
      uni.chooseImage({ count: 1, sizeType: ["compressed"], success: async (r) => {
        busy.value = true;
        uni.showLoading({ title: "收藏这一刻…", mask: true });
        try {
          const path = r.tempFilePaths[0];
          if (demo.value) {
            let saved = { savedFilePath: path };
            saved = await new Promise((resolve, reject) => uni.getFileSystemManager().saveFile({ tempFilePath: path, success: resolve, fail: reject }));
            photos.value.unshift({ id: localId(), uploader_id: userId.value, local: saved.savedFilePath, file_name: "我们的照片.jpg", created_at: (/* @__PURE__ */ new Date()).toISOString() });
            persistDemo();
          } else {
            await uploadPhoto(path);
            await refreshAll();
          }
          toast("照片已收藏");
        } catch (e) {
          error(e);
        } finally {
          busy.value = false;
          uni.hideLoading();
        }
      }, fail: () => {
      } });
    }
    async function previewPhoto(photo) {
      try {
        if (!photo.local) {
          photo.local = await downloadPhoto(photo.storage_path);
          photoPaths.set(photo.id, photo.local);
          photoFailed.value[photo.id] = false;
        }
        ;
        uni.previewImage({ urls: [photo.local] });
      } catch (e) {
        error(e);
      }
    }
    async function savePhoto(photo) {
      try {
        const path = photo.local || await downloadPhoto(photo.storage_path);
        uni.saveImageToPhotosAlbum({ filePath: path, success: () => toast("已保存到手机相册"), fail: () => toast("保存失败，请检查相册权限") });
      } catch (e) {
        error(e);
      }
    }
    async function deletePhoto(photo) {
      if (!await confirm("删除此云端照片后，两个人都无法再从这里下载。请先保存到手机。确定清理？"))
        return;
      try {
        if (!demo.value) {
          await request("/storage/v1/object/photos", "DELETE", { prefixes: [photo.storage_path] });
          const rows = await request("/rest/v1/photos?id=eq." + photo.id, "DELETE");
          if (!rows.length)
            throw new Error("文件已清理，元数据删除失败，请刷新后重试");
        } else if (photo.local)
          uni.getFileSystemManager().removeSavedFile({ filePath: photo.local });
        photos.value = photos.value.filter((p) => p.id !== photo.id);
        photoPaths.delete(photo.id);
        persistDemo();
        toast("照片已清理");
      } catch (e) {
        error(e);
      }
    }
    async function exportNotes() {
      try {
        let rows = notes.value;
        if (!demo.value) {
          rows = [];
          let offset = 0;
          while (true) {
            const page = await request("/rest/v1/notes?select=*&order=created_at.asc,id.asc&limit=100&offset=" + offset);
            rows.push(...page);
            if (page.length < 100)
              break;
            offset += page.length;
          }
        }
        if (!rows.length) {
          toast("还没有可以导出的笔记");
          return;
        }
        const text = "# 我们俩 · 笔记导出\n\n导出时间：" + (/* @__PURE__ */ new Date()).toISOString() + "\n\n" + rows.map((n) => "## " + (n.title || "无题") + "\n\n可见性：" + n.visibility + "\n作者：" + n.owner_id + "\n创建时间：" + n.created_at + "\n更新时间：" + n.updated_at + "\n\n" + n.content + "\n\n---\n").join("\n");
        const fs = uni.getFileSystemManager();
        const path = uni.env.USER_DATA_PATH + "/notes_export_" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".md";
        fs.writeFile({ filePath: path, data: text, encoding: "utf8", success: () => uni.showModal({ title: "笔记已导出", content: "Markdown 文件已保存到应用文件目录：\n" + path, showCancel: false }), fail: () => toast("导出失败，无法写入本地文件") });
      } catch (e) {
        error(e);
      }
    }
    async function clearCache() {
      if (!await confirm("将清理图片临时文件和内存列表；云端数据及登录状态保留。"))
        return;
      const fs = uni.getFileSystemManager();
      for (const path of photoPaths.values())
        fs.unlink({ filePath: path });
      photoPaths.clear();
      photoFailed.value = {};
      if (!demo.value) {
        photos.value = [];
        notes.value = [];
        messages.value = [];
        await refreshAll();
      }
      toast("本地缓存已刷新");
    }
    async function signOut() {
      if (!await confirm(demo.value ? "确定退出本地演示？演示数据保留在此设备。" : "确定退出当前账号？"))
        return;
      try {
        if (!demo.value)
          await logout();
      } catch (_) {
        clearSession();
      }
      resetData();
      demo.value = false;
    }
    function handleShow() {
      foreground = true;
      if (entered.value && !demo.value) {
        if (Date.now() - lastRefresh > 1e4)
          refreshAll();
        if (tab.value === "photos")
          hydratePhotos();
      }
    }
    function handleHide() {
      foreground = false;
    }
    vue.onUnmounted(() => {
      stopRealtime?.();
      clearInterval(poll);
      clearTimeout(heartTimer);
    });
    if (configured() && cloud.session) {
      entered.value = true;
      refreshAll();
      beginSync();
    }
    return {
      tabs,
      tab,
      entered,
      demo,
      busy,
      sending,
      email,
      password,
      messages,
      misses,
      notes,
      photos,
      members,
      unread,
      messageText,
      scrollTarget,
      heartActive,
      hasMore,
      loadingHistory,
      notesMore,
      photosMore,
      photoFailed,
      configOpen,
      configUrl,
      configKey,
      noteOpen,
      noteTitle,
      noteContent,
      noteShared,
      editingId,
      noteReadOnly,
      noteFilter,
      cloud,
      configured,
      userId,
      myName,
      partnerName,
      today,
      todayMiss,
      latestMiss,
      filteredNotes,
      toast,
      formatDate,
      formatTime,
      switchTab,
      startDemo,
      signIn,
      applyConfig,
      refreshAll,
      loadOlder,
      sendMessage,
      sendMiss,
      loadMoreNotes,
      loadMorePhotos,
      editNote,
      closeNote,
      saveNote,
      deleteNote,
      addPhoto,
      previewPhoto,
      savePhoto,
      deletePhoto,
      exportNotes,
      clearCache,
      signOut,
      handleShow,
      handleHide
    };
  }
  const _style_0$a = {};
  const _export_sfc = (sfc, props) => {
    const target = sfc.__vccOpts || sfc;
    for (const [key, val] of props) {
      target[key] = val;
    }
    return target;
  };
  const __className$9 = "GenPagesIndexComponentsLoginPanel";
  const _sfc_main$a = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "0f994f9a",
    __className: __className$9,
    __filename: "pages/index/components/LoginPanel.uvue",
    __name: "LoginPanel",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsLoginPanelSharedData", sharedDataClassId: 0 })));
      const { email, password, busy, signIn, configOpen, configured: configured2, startDemo } = usePairContext();
      return () => {
        "raw js";
        const _component_input = vue.resolveComponent("input");
        const _component_button = vue.resolveComponent("button");
        const n6 = vue.createSharedDataComponentWithFallback(_component_input, "4a2b8d91", {
          value: () => vue.unref(email),
          "onUpdate:value": () => (_value) => vue.isRef(email) ? email.value = _value : null,
          class: "input",
          placeholder: "你的预置账号邮箱",
          type: "text"
        });
        vue.setSharedData(__sharedData, 2, n6?.sharedData ?? null);
        const n8 = vue.createSharedDataComponentWithFallback(_component_input, "4a2b9193", {
          value: () => vue.unref(password),
          "onUpdate:value": () => (_value) => vue.isRef(password) ? password.value = _value : null,
          class: "input",
          placeholder: "输入密码",
          password: true
        });
        vue.setSharedData(__sharedData, 3, n8?.sharedData ?? null);
        const n10 = vue.createSharedDataComponentWithFallback(_component_button, "4a2b9530", {
          class: "primary",
          disabled: () => vue.unref(busy),
          onClick: () => vue.unref(signIn)
        }, {
          "default": vue.withSharedDataVaporCtx(() => {
            vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 5, vue.toDisplayString(vue.unref(busy) ? "正在登录…" : "进入我们的小世界")));
          }, "string")
        });
        vue.setSharedData(__sharedData, 4, n10?.sharedData ?? null);
        vue.setSharedDataEvent(__sharedData, 6, () => configOpen.value = true);
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 0, vue.toSharedDataBoolean(!vue.unref(configured2)())), () => {
          vue.setSharedDataEvent(__sharedData, 1, (e) => vue.unref(startDemo)(e));
        });
        return __sharedData;
      };
    }
  });
  const LoginPanel = /* @__PURE__ */ _export_sfc(_sfc_main$a, [["styles", [_style_0$a]], ["__scriptLang", "ts"]]);
  const _style_0$9 = {};
  const __className$8 = "GenPagesIndexComponentsHomePanel";
  const _sfc_main$9 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "dcf4fbfe",
    __className: __className$8,
    __filename: "pages/index/components/HomePanel.uvue",
    __name: "HomePanel",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsHomePanelSharedData", sharedDataClassId: 0 })));
      const { today, myName, partnerName, sendMiss, heartActive, demo, todayMiss, switchTab, latestMiss, userId, formatTime } = usePairContext();
      return () => {
        "raw js";
        vue.setSharedDataEvent(__sharedData, 0, (e) => vue.unref(sendMiss)(e));
        vue.setSharedDataEvent(__sharedData, 1, () => vue.unref(switchTab)("chat"));
        vue.setSharedDataEvent(__sharedData, 2, () => vue.unref(switchTab)("photos"));
        vue.setSharedDataEvent(__sharedData, 3, () => vue.unref(switchTab)("notes"));
        vue.renderSharedDataEffect(() => {
          const _myName = vue.unref(myName);
          const _partnerName = vue.unref(partnerName);
          const _heartActive = vue.unref(heartActive);
          const _latestMiss = vue.unref(latestMiss);
          vue.setSharedData(__sharedData, 4, vue.toDisplayString(vue.unref(today)));
          vue.setSharedData(__sharedData, 5, vue.toDisplayString(_myName.slice(0, 1)));
          vue.setSharedData(__sharedData, 6, vue.toDisplayString(_myName));
          vue.setSharedData(__sharedData, 7, vue.toDisplayString(_partnerName.slice(0, 1)));
          vue.setSharedData(__sharedData, 8, vue.toDisplayString(_partnerName));
          vue.setSharedDataClass(__sharedData, 9, ["heart-button", { "heart-active": _heartActive }]);
          vue.setSharedData(__sharedData, 10, vue.toDisplayString(_heartActive ? "把想念，送到你身边" : "我有一点，想你了"));
          vue.setSharedData(__sharedData, 11, vue.toDisplayString(vue.unref(demo) ? "轻触爱心，记录这一刻的想念" : "轻触爱心，向对方发送一份想念"));
          vue.setSharedData(__sharedData, 12, vue.toDisplayString(vue.unref(todayMiss)));
          vue.setSharedData(__sharedData, 13, vue.toDisplayString(_latestMiss ? (_latestMiss.sender_id === vue.unref(userId) ? "你" : _partnerName) + " 说：想你了" : "还没有想念记录"));
          vue.setSharedData(__sharedData, 14, vue.toDisplayString(_latestMiss ? vue.unref(formatTime)(_latestMiss.created_at) : "点击上面的爱心，送出第一份想念"));
        });
        return __sharedData;
      };
    }
  });
  const HomePanel = /* @__PURE__ */ _export_sfc(_sfc_main$9, [["styles", [_style_0$9]], ["__scriptLang", "ts"]]);
  const _style_0$8 = {};
  const __className$7 = "GenPagesIndexComponentsChatPanel";
  const _sfc_main$8 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "147112ab",
    __className: __className$7,
    __filename: "pages/index/components/ChatPanel.uvue",
    __name: "ChatPanel",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsChatPanelSharedData", sharedDataClassId: 0 })));
      const { partnerName, demo, cloud: cloud2, hasMore, loadOlder, loadingHistory, messages, userId, formatTime } = usePairContext();
      return () => {
        "raw js";
        vue.renderSharedDataEffect(() => {
          vue.setSharedData(__sharedData, 5, vue.toDisplayString(vue.unref(partnerName)));
          vue.setSharedData(__sharedData, 6, vue.toDisplayString(vue.unref(demo) ? "本地演示" : vue.unref(cloud2).status));
        });
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 0, vue.toSharedDataBoolean(vue.unref(hasMore))), () => {
          vue.setSharedDataEvent(__sharedData, 1, (e) => vue.unref(loadOlder)(e));
          vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 2, vue.toDisplayString(vue.unref(loadingHistory) ? "正在加载…" : "加载更早的消息")));
        });
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 3, vue.toSharedDataBoolean(!vue.unref(messages).length)), () => {
        });
        vue.createSharedDataFor(vue.setSharedDataScoped(__sharedData, 4, vue.createSharedDataVFor(__sharedDataScope, () => new UniDynamicSharedData(__sharedDataScope, { bundleKey: `${__className$7}SharedData`, sharedDataClassId: 1 }))), () => vue.unref(messages), (__sharedData_VFor0, _for_item0) => {
          vue.renderSharedDataEffect(() => {
            const _message = _for_item0.value;
            const _userId = vue.unref(userId);
            const _message_sender_id = _message.sender_id;
            vue.setSharedDataClass(__sharedData_VFor0, 1, ["message-row", { "message-self": _message_sender_id === _userId }]);
            vue.setSharedData(__sharedData_VFor0, 2, vue.toDisplayString(_message_sender_id === _userId ? "我" : vue.unref(partnerName)));
            vue.setSharedData(__sharedData_VFor0, 3, vue.toDisplayString(vue.unref(formatTime)(_message.created_at)));
            vue.setSharedDataClass(__sharedData_VFor0, 4, ["message-bubble", { "bubble-self": _message_sender_id === _userId }]);
            vue.setSharedData(__sharedData_VFor0, 5, vue.toDisplayString(_message.content));
          });
          return null;
        }, (__sharedData_VFor0, message) => vue.setSharedData(__sharedData_VFor0, 0, vue.toDisplayString(message.id)));
        return __sharedData;
      };
    }
  });
  const ChatPanel = /* @__PURE__ */ _export_sfc(_sfc_main$8, [["styles", [_style_0$8]], ["__scriptLang", "ts"]]);
  const _style_0$7 = {};
  const __className$6 = "GenPagesIndexComponentsChatComposer";
  const _sfc_main$7 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "3f11d069",
    __className: __className$6,
    __filename: "pages/index/components/ChatComposer.uvue",
    __name: "ChatComposer",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsChatComposerSharedData", sharedDataClassId: 0 })));
      const { messageText, sendMessage, sending } = usePairContext();
      return () => {
        "raw js";
        const _component_input = vue.resolveComponent("input");
        const _component_button = vue.resolveComponent("button");
        const n0 = vue.createSharedDataComponentWithFallback(_component_input, "50280e3c", {
          value: () => vue.unref(messageText),
          "onUpdate:value": () => (_value) => vue.isRef(messageText) ? messageText.value = _value : null,
          class: "message-input",
          placeholder: "说点什么，让我靠近你一点…",
          maxlength: 1e4,
          "confirm-type": "send",
          onConfirm: () => vue.unref(sendMessage)
        });
        vue.setSharedData(__sharedData, 0, n0?.sharedData ?? null);
        const n2 = vue.createSharedDataComponentWithFallback(_component_button, "25931ccf", {
          class: "send-button",
          disabled: () => vue.unref(sending),
          onClick: () => vue.unref(sendMessage)
        }, {
          "default": vue.withSharedDataVaporCtx(() => {
          }, "string")
        });
        vue.setSharedData(__sharedData, 1, n2?.sharedData ?? null);
        return __sharedData;
      };
    }
  });
  const ChatComposer = /* @__PURE__ */ _export_sfc(_sfc_main$7, [["styles", [_style_0$7]], ["__scriptLang", "ts"]]);
  const _style_0$6 = {};
  const __className$5 = "GenPagesIndexComponentsPhotosPanel";
  const _sfc_main$6 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "a374d26e",
    __className: __className$5,
    __filename: "pages/index/components/PhotosPanel.uvue",
    __name: "PhotosPanel",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsPhotosPanelSharedData", sharedDataClassId: 0 })));
      const { photos, addPhoto, previewPhoto, photoFailed, formatDate, savePhoto, userId, deletePhoto, photosMore, loadMorePhotos } = usePairContext();
      return () => {
        "raw js";
        const _component_button = vue.resolveComponent("button");
        vue.setSharedDataEvent(__sharedData, 5, (e) => vue.unref(addPhoto)(e));
        vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 6, vue.toDisplayString(vue.unref(photos).length)));
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 0, vue.toSharedDataBoolean(!vue.unref(photos).length)), () => {
          const n12 = vue.createSharedDataComponentWithFallback(_component_button, "a587e7be", {
            class: "primary",
            onClick: () => vue.unref(addPhoto)
          }, {
            "default": vue.withSharedDataVaporCtx(() => {
            }, "string")
          });
          vue.setSharedData(__sharedData, 1, n12?.sharedData ?? null);
        });
        vue.createSharedDataFor(vue.setSharedDataScoped(__sharedData, 4, vue.createSharedDataVFor(__sharedDataScope, () => new UniDynamicSharedData(__sharedDataScope, { bundleKey: `${__className$5}SharedData`, sharedDataClassId: 1 }))), () => vue.unref(photos), (__sharedData_VFor0, _for_item0) => {
          vue.createSharedDataIf(() => vue.setSharedData(__sharedData_VFor0, 1, vue.toSharedDataBoolean(_for_item0.value.local)), () => {
            vue.setSharedDataEvent(__sharedData_VFor0, 2, () => vue.unref(previewPhoto)(_for_item0.value));
            vue.renderSharedDataEffect(() => vue.setSharedDataAttr(__sharedData_VFor0, 3, vue.toSharedDataString(_for_item0.value.local)));
          }, () => {
            vue.setSharedDataEvent(__sharedData_VFor0, 4, () => vue.unref(previewPhoto)(_for_item0.value));
            vue.renderSharedDataEffect(() => {
              const _photo = _for_item0.value;
              vue.setSharedData(__sharedData_VFor0, 5, vue.toDisplayString(vue.unref(photoFailed)[_photo.id] ? "轻触重试加载" : "照片加载中…"));
            });
          }, 517);
          vue.setSharedDataEvent(__sharedData_VFor0, 8, () => vue.unref(savePhoto)(_for_item0.value));
          vue.renderSharedDataEffect(() => {
            const _photo = _for_item0.value;
            vue.setSharedData(__sharedData_VFor0, 9, vue.toDisplayString(_photo.file_name));
            vue.setSharedData(__sharedData_VFor0, 10, vue.toDisplayString(vue.unref(formatDate)(_photo.created_at)));
          });
          vue.createSharedDataIf(() => vue.setSharedData(__sharedData_VFor0, 6, vue.toSharedDataBoolean(_for_item0.value.uploader_id === vue.unref(userId))), () => {
            vue.setSharedDataEvent(__sharedData_VFor0, 7, () => vue.unref(deletePhoto)(_for_item0.value));
          });
          return null;
        }, (__sharedData_VFor0, photo) => vue.setSharedData(__sharedData_VFor0, 0, vue.toDisplayString(photo.id)), 1);
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 2, vue.toSharedDataBoolean(vue.unref(photosMore))), () => {
          vue.setSharedDataEvent(__sharedData, 3, (e) => vue.unref(loadMorePhotos)(e));
        });
        return __sharedData;
      };
    }
  });
  const PhotosPanel = /* @__PURE__ */ _export_sfc(_sfc_main$6, [["styles", [_style_0$6]], ["__scriptLang", "ts"]]);
  const _style_0$5 = {};
  const __className$4 = "GenPagesIndexComponentsNotesPanel";
  const _sfc_main$5 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "60efa97f",
    __className: __className$4,
    __filename: "pages/index/components/NotesPanel.uvue",
    __name: "NotesPanel",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsNotesPanelSharedData", sharedDataClassId: 0 })));
      const { noteFilter, editNote, filteredNotes, formatDate, userId, partnerName, notesMore, loadMoreNotes, exportNotes } = usePairContext();
      return () => {
        "raw js";
        vue.setSharedDataEvent(__sharedData, 4, () => noteFilter.value = "all");
        vue.setSharedDataEvent(__sharedData, 5, () => noteFilter.value = "shared");
        vue.setSharedDataEvent(__sharedData, 6, () => noteFilter.value = "private");
        vue.setSharedDataEvent(__sharedData, 7, () => vue.unref(editNote)(null));
        vue.renderSharedDataEffect(() => {
          const _noteFilter = vue.unref(noteFilter);
          vue.setSharedDataClass(__sharedData, 9, ["filter", { "filter-active": _noteFilter === "all" }]);
          vue.setSharedDataClass(__sharedData, 10, ["filter", { "filter-active": _noteFilter === "shared" }]);
          vue.setSharedDataClass(__sharedData, 11, ["filter", { "filter-active": _noteFilter === "private" }]);
        });
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 0, vue.toSharedDataBoolean(!vue.unref(filteredNotes).length)), () => {
        });
        vue.createSharedDataFor(vue.setSharedDataScoped(__sharedData, 1, vue.createSharedDataVFor(__sharedDataScope, () => new UniDynamicSharedData(__sharedDataScope, { bundleKey: `${__className$4}SharedData`, sharedDataClassId: 1 }))), () => vue.unref(filteredNotes), (__sharedData_VFor0, _for_item0) => {
          vue.setSharedDataEvent(__sharedData_VFor0, 1, () => vue.unref(editNote)(_for_item0.value));
          vue.renderSharedDataEffect(() => {
            const _note = _for_item0.value;
            const _note_visibility = _note.visibility;
            vue.setSharedDataClass(__sharedData_VFor0, 2, ["note-tag", { "tag-private": _note_visibility === "private" }]);
            vue.setSharedData(__sharedData_VFor0, 3, vue.toDisplayString(_note_visibility === "shared" ? "两人共享" : "仅自己可见"));
            vue.setSharedData(__sharedData_VFor0, 4, vue.toDisplayString(vue.unref(formatDate)(_note.updated_at)));
            vue.setSharedData(__sharedData_VFor0, 5, vue.toDisplayString(_note.title || "无题的小纸条"));
            vue.setSharedData(__sharedData_VFor0, 6, vue.toDisplayString(_note.content.slice(0, 160)));
            vue.setSharedData(__sharedData_VFor0, 7, vue.toDisplayString(_note.owner_id === vue.unref(userId) ? "我" : vue.unref(partnerName)));
          });
          return null;
        }, (__sharedData_VFor0, note) => vue.setSharedData(__sharedData_VFor0, 0, vue.toDisplayString(note.id)));
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 2, vue.toSharedDataBoolean(vue.unref(notesMore))), () => {
          vue.setSharedDataEvent(__sharedData, 3, (e) => vue.unref(loadMoreNotes)(e));
        });
        vue.setSharedDataEvent(__sharedData, 8, (e) => vue.unref(exportNotes)(e));
        return __sharedData;
      };
    }
  });
  const NotesPanel = /* @__PURE__ */ _export_sfc(_sfc_main$5, [["styles", [_style_0$5]], ["__scriptLang", "ts"]]);
  const _style_0$4 = {};
  const __className$3 = "GenPagesIndexComponentsSettingsPanel";
  const _sfc_main$4 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "c504a2a6",
    __className: __className$3,
    __filename: "pages/index/components/SettingsPanel.uvue",
    __name: "SettingsPanel",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsSettingsPanelSharedData", sharedDataClassId: 0 })));
      const { myName, demo, cloud: cloud2, configOpen, refreshAll, exportNotes, clearCache, signOut } = usePairContext();
      return () => {
        "raw js";
        const _component_button = vue.resolveComponent("button");
        vue.setSharedDataEvent(__sharedData, 2, () => configOpen.value = true);
        vue.setSharedDataEvent(__sharedData, 3, (e) => vue.unref(refreshAll)(e));
        vue.setSharedDataEvent(__sharedData, 4, (e) => vue.unref(exportNotes)(e));
        vue.setSharedDataEvent(__sharedData, 5, (e) => vue.unref(clearCache)(e));
        vue.renderSharedDataEffect(() => {
          const _myName = vue.unref(myName);
          const _demo = vue.unref(demo);
          const _cloud = vue.unref(cloud2);
          vue.setSharedData(__sharedData, 6, vue.toDisplayString(_myName.slice(0, 1)));
          vue.setSharedData(__sharedData, 7, vue.toDisplayString(_myName));
          vue.setSharedData(__sharedData, 8, vue.toDisplayString(_demo ? "本地演示身份" : _cloud.session?.user.email));
          vue.setSharedData(__sharedData, 9, vue.toDisplayString(_demo ? "演示" : "私密成员"));
          vue.setSharedData(__sharedData, 10, vue.toDisplayString(_demo ? "尚未连接" : _cloud.status));
        });
        const n27 = vue.createSharedDataComponentWithFallback(_component_button, "d3189dd0", {
          class: "logout-button",
          onClick: () => vue.unref(signOut)
        }, {
          "default": vue.withSharedDataVaporCtx(() => {
            vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 1, vue.toDisplayString(vue.unref(demo) ? "退出本地演示" : "退出登录")));
          }, "string")
        });
        vue.setSharedData(__sharedData, 0, n27?.sharedData ?? null);
        return __sharedData;
      };
    }
  });
  const SettingsPanel = /* @__PURE__ */ _export_sfc(_sfc_main$4, [["styles", [_style_0$4]], ["__scriptLang", "ts"]]);
  const _style_0$3 = {};
  const __className$2 = "GenPagesIndexComponentsConnectionDialog";
  const _sfc_main$3 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "36f2b867",
    __className: __className$2,
    __filename: "pages/index/components/ConnectionDialog.uvue",
    __name: "ConnectionDialog",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsConnectionDialogSharedData", sharedDataClassId: 0 })));
      const { configUrl, configKey, applyConfig, configOpen } = usePairContext();
      return () => {
        "raw js";
        const _component_input = vue.resolveComponent("input");
        const _component_textarea = vue.resolveComponent("textarea");
        const _component_button = vue.resolveComponent("button");
        const n4 = vue.createSharedDataComponentWithFallback(_component_input, "bc29b200", {
          value: () => vue.unref(configUrl),
          "onUpdate:value": () => (_value) => vue.isRef(configUrl) ? configUrl.value = _value : null,
          class: "input",
          placeholder: "https://项目ID.supabase.co"
        });
        vue.setSharedData(__sharedData, 0, n4?.sharedData ?? null);
        const n6 = vue.createSharedDataComponentWithFallback(_component_textarea, "bc29a946", {
          value: () => vue.unref(configKey),
          "onUpdate:value": () => (_value) => vue.isRef(configKey) ? configKey.value = _value : null,
          class: "key-input",
          placeholder: "项目公开 API key，禁止 service_role"
        });
        vue.setSharedData(__sharedData, 1, n6?.sharedData ?? null);
        const n9 = vue.createSharedDataComponentWithFallback(_component_button, "bc299a82", {
          class: "primary",
          onClick: () => vue.unref(applyConfig)
        }, {
          "default": vue.withSharedDataVaporCtx(() => {
          }, "string")
        });
        vue.setSharedData(__sharedData, 2, n9?.sharedData ?? null);
        vue.setSharedDataEvent(__sharedData, 3, () => configOpen.value = false);
        return __sharedData;
      };
    }
  });
  const ConnectionDialog = /* @__PURE__ */ _export_sfc(_sfc_main$3, [["styles", [_style_0$3]], ["__scriptLang", "ts"]]);
  const _style_0$2 = {};
  const __className$1 = "GenPagesIndexComponentsNoteEditor";
  const _sfc_main$2 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "621096aa",
    __className: __className$1,
    __filename: "pages/index/components/NoteEditor.uvue",
    __name: "NoteEditor",
    setup(__props) {
      const __sharedDataScope = vue.useSharedDataScope();
      const __sharedData = vue.withSharedDataComponent(new UniDynamicSharedDataComponent(__sharedDataScope, vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexComponentsNoteEditorSharedData", sharedDataClassId: 0 })));
      const { noteReadOnly, editingId, closeNote, noteTitle, noteContent, noteShared, busy, saveNote, deleteNote } = usePairContext();
      return () => {
        "raw js";
        const _component_input = vue.resolveComponent("input");
        const _component_textarea = vue.resolveComponent("textarea");
        const _component_switch = vue.resolveComponent("switch");
        const _component_button = vue.resolveComponent("button");
        vue.setSharedDataEvent(__sharedData, 8, (e) => vue.unref(closeNote)(e));
        vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 9, vue.toDisplayString(vue.unref(noteReadOnly) ? "你写给我的" : vue.unref(editingId) ? "编辑小纸条" : "新的一页")));
        const n3 = vue.createSharedDataComponentWithFallback(_component_input, "21c316fc", {
          value: () => vue.unref(noteTitle),
          "onUpdate:value": () => (_value) => vue.isRef(noteTitle) ? noteTitle.value = _value : null,
          class: "note-title-input",
          placeholder: "给这一天起个名字",
          maxlength: 200,
          disabled: () => vue.unref(noteReadOnly)
        });
        vue.setSharedData(__sharedData, 0, n3?.sharedData ?? null);
        const n4 = vue.createSharedDataComponentWithFallback(_component_textarea, "21c31b16", {
          value: () => vue.unref(noteContent),
          "onUpdate:value": () => (_value) => vue.isRef(noteContent) ? noteContent.value = _value : null,
          class: "note-textarea",
          placeholder: "把值得记住的事，慢慢写下来…",
          maxlength: 1e5,
          disabled: () => vue.unref(noteReadOnly)
        });
        vue.setSharedData(__sharedData, 1, n4?.sharedData ?? null);
        vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 10, vue.toDisplayString(vue.unref(noteShared) ? "两人共享" : "仅自己可见")));
        const _on_change = ($event) => noteShared.value = $event.detail.value;
        const n6 = vue.createSharedDataComponentWithFallback(_component_switch, "21c32337", {
          checked: () => vue.unref(noteShared),
          disabled: () => vue.unref(noteReadOnly),
          color: "#be7060",
          onChange: () => _on_change
        });
        vue.setSharedData(__sharedData, 7, n6?.sharedData ?? null);
        vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 11, vue.toDisplayString(vue.unref(noteShared) ? "对方可以阅读，只有作者可以编辑或删除。" : "这是一篇私密笔记，只有你自己可以看到。")));
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 2, vue.toSharedDataBoolean(!vue.unref(noteReadOnly))), () => {
          const n12 = vue.createSharedDataComponentWithFallback(_component_button, "21c32dbc", {
            class: "primary",
            disabled: () => vue.unref(busy),
            onClick: () => vue.unref(saveNote)
          }, {
            "default": vue.withSharedDataVaporCtx(() => {
              vue.renderSharedDataEffect(() => vue.setSharedData(__sharedData, 4, vue.toDisplayString(vue.unref(busy) ? "保存中…" : "保存这份小心事")));
            }, "string")
          });
          vue.setSharedData(__sharedData, 3, n12?.sharedData ?? null);
        });
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 5, vue.toSharedDataBoolean(vue.unref(editingId) && !vue.unref(noteReadOnly))), () => {
          vue.setSharedDataEvent(__sharedData, 6, (e) => vue.unref(deleteNote)(e));
        });
        return __sharedData;
      };
    }
  });
  const NoteEditor = /* @__PURE__ */ _export_sfc(_sfc_main$2, [["styles", [_style_0$2]], ["__scriptLang", "ts"]]);
  const _style_0$1 = {};
  const __className = "GenPagesIndexIndex";
  const _sfc_main$1 = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __dynamicSharedData: true,
    __hash: "d0e3752e",
    __className,
    __filename: "pages/index/index.uvue",
    __name: "index",
    setup(__props) {
      const __sharedDataRenderer = vue.useSharedDataRenderer();
      const __sharedData = __sharedDataRenderer == "component" ? vue.withSharedDataComponent(new UniDynamicSharedDataComponent(vue.useSharedDataScope(), vue.useSharedDataComponentOptions({ bundleKey: "GenPagesIndexIndexSharedData", sharedDataClassId: 0 }))) : vue.withSharedDataPage(new UniDynamicSharedDataPage(vue.useSharedDataPageId(), vue.useSharedDataPageOptions({ bundleKey: "GenPagesIndexIndexSharedData", sharedDataClassId: 0 })));
      const __sharedDataScope = vue.useSharedDataScope(__sharedData);
      const app = usePairApp();
      providePairContext(app);
      const { entered, tab, myName, scrollTarget, demo, configOpen, noteOpen, tabs, unread, switchTab } = app;
      onShow(app.handleShow);
      onHide(app.handleHide);
      return () => {
        "raw js";
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 0, vue.toSharedDataBoolean(!vue.unref(entered))), () => {
          const n2 = vue.createSharedDataComponent(LoginPanel, "59e5d894", { class: "login-host" });
          vue.setSharedData(__sharedData, 1, n2.sharedData ?? null);
        }, () => {
          vue.setSharedDataEvent(__sharedData, 16, () => tab.value = "settings");
          vue.renderSharedDataEffect(() => {
            vue.setSharedData(__sharedData, 17, vue.toDisplayString(vue.unref(myName).slice(0, 1)));
            vue.setSharedDataAttr(__sharedData, 18, vue.toSharedDataString(vue.unref(scrollTarget)));
          });
          vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 4, vue.toSharedDataBoolean(vue.unref(demo))), () => {
            vue.setSharedDataEvent(__sharedData, 5, () => configOpen.value = true);
          });
          vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 6, vue.toSharedDataBoolean(vue.unref(tab) === "home")), () => {
            const n18 = vue.createSharedDataComponent(HomePanel, "3a5565c2");
            vue.setSharedData(__sharedData, 7, n18.sharedData ?? null);
          }, () => vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 8, vue.toSharedDataBoolean(vue.unref(tab) === "chat")), () => {
            const n20 = vue.createSharedDataComponent(ChatPanel, "3a555e3e");
            vue.setSharedData(__sharedData, 9, n20.sharedData ?? null);
          }, () => vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 10, vue.toSharedDataBoolean(vue.unref(tab) === "photos")), () => {
            const n25 = vue.createSharedDataComponent(PhotosPanel, "3a5556f4");
            vue.setSharedData(__sharedData, 11, n25.sharedData ?? null);
          }, () => vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 12, vue.toSharedDataBoolean(vue.unref(tab) === "notes")), () => {
            const n27 = vue.createSharedDataComponent(NotesPanel, "77d17ef4");
            vue.setSharedData(__sharedData, 13, n27.sharedData ?? null);
          }, () => {
            const n29 = vue.createSharedDataComponent(SettingsPanel, "77d17f90");
            vue.setSharedData(__sharedData, 14, n29.sharedData ?? null);
          }, 1541), 1285), 1029), 773);
          vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 2, vue.toSharedDataBoolean(vue.unref(tab) === "chat")), () => {
            const n33 = vue.createSharedDataComponent(ChatComposer, "77d182cd");
            vue.setSharedData(__sharedData, 3, n33.sharedData ?? null);
          });
          const _selector34_0 = vue.createSharedDataSelector(() => vue.unref(tab));
          const _selector34_1 = vue.createSharedDataSelector(() => vue.unref(tab));
          const n34 = vue.createSharedDataFor(vue.setSharedDataScoped(__sharedData, 15, vue.createSharedDataVFor(__sharedDataScope, () => new UniDynamicSharedData(__sharedDataScope, { bundleKey: `${__className}SharedData`, sharedDataClassId: 1 }))), () => vue.unref(tabs), (__sharedData_VFor0, _for_item0) => {
            vue.renderSharedDataEffect(() => {
              const _item = _for_item0.value;
              const _unread = vue.unref(unread);
              vue.setSharedData(__sharedData_VFor0, 4, vue.toDisplayString(_item.icon));
              vue.setSharedData(__sharedData_VFor0, 6, vue.toDisplayString(_item.label));
              vue.setSharedData(__sharedData_VFor0, 7, vue.toDisplayString(_item.key === "chat" && _unread ? " · " + _unread : ""));
            });
            vue.createSharedDataIf(() => vue.setSharedData(__sharedData_VFor0, 1, vue.toSharedDataBoolean(vue.unref(tab) === _for_item0.value.key)), () => {
            });
            vue.setSharedDataEvent(__sharedData_VFor0, 2, () => vue.unref(switchTab)(_for_item0.value.key));
            _selector34_0(_for_item0.value.key, () => {
              vue.setSharedDataClass(__sharedData_VFor0, 3, ["tab-icon", { "tab-selected": vue.unref(tab) === _for_item0.value.key }]);
            });
            _selector34_1(_for_item0.value.key, () => {
              vue.setSharedDataClass(__sharedData_VFor0, 5, ["tab-label", { "tab-selected": vue.unref(tab) === _for_item0.value.key }]);
            });
            return null;
          }, (__sharedData_VFor0, item) => vue.setSharedData(__sharedData_VFor0, 0, vue.toDisplayString(item.key)), 1);
          n34.onReset(_selector34_0.reset);
          n34.onReset(_selector34_1.reset);
        }, 261);
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 19, vue.toSharedDataBoolean(vue.unref(configOpen))), () => {
          const n47 = vue.createSharedDataComponent(ConnectionDialog, "77d195f7");
          vue.setSharedData(__sharedData, 20, n47.sharedData ?? null);
        });
        vue.createSharedDataIf(() => vue.setSharedData(__sharedData, 21, vue.toSharedDataBoolean(vue.unref(noteOpen))), () => {
          const n50 = vue.createSharedDataComponent(NoteEditor, "77d19916");
          vue.setSharedData(__sharedData, 22, n50.sharedData ?? null);
        });
        return __sharedData;
      };
    }
  });
  const PagesIndexIndex = /* @__PURE__ */ _export_sfc(_sfc_main$1, [["styles", [_style_0$1]], ["__scriptLang", "ts"]]);
  __definePage("pages/index/index", PagesIndexIndex);
  const _style_0 = {};
  const _sfc_main = /* @__PURE__ */ vue.defineVaporSharedDataComponent({
    __name: "App",
    setup(__props) {
      let firstBackTime = 0;
      vue.onLaunch(() => {
        uni.__log__("log", "at App.uvue:7", "App Launch");
      });
      vue.onAppShow(() => {
        uni.__log__("log", "at App.uvue:11", "App Show");
      });
      vue.onAppHide(() => {
        uni.__log__("log", "at App.uvue:15", "App Hide");
      });
      vue.onLastPageBackPress(() => {
        uni.__log__("log", "at App.uvue:20", "App LastPageBackPress");
        if (firstBackTime == 0) {
          uni.showToast({
            title: "再按一次退出应用",
            position: "bottom"
          });
          firstBackTime = Date.now();
          setTimeout(() => {
            firstBackTime = 0;
          }, 2e3);
        } else if (Date.now() - firstBackTime < 2e3) {
          firstBackTime = Date.now();
          uni.exit();
        }
      });
      vue.onExit(() => {
        uni.__log__("log", "at App.uvue:37", "App Exit");
      });
    }
  });
  const App = /* @__PURE__ */ _export_sfc(_sfc_main, [["styles", [_style_0]], ["__scriptLang", "ts"], ["__uniDefaultScriptLang", "ts"]]);
  const __global__ = typeof globalThis === "undefined" ? Function("return this")() : globalThis;
  __global__.__uniX = true;
  function createApp() {
    const app = vue.createSSRApp(App);
    return {
      app
    };
  }
  createApp().app.mount("#app");
})(Vue);
//# sourceMappingURL=file:///D:/work/kun/app/testProject/unpackage/cache/vapor/.app-android/sourcemap/app-service.js.map
