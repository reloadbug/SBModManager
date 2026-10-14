'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * 只暴露白名单方法，渲染层拿不到 Node，也拿不到任意 IPC 通道。
 * 每个方法都返回 { ok, data } / { ok:false, error }，由渲染层统一处理。
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  bootstrap: () => invoke('app:bootstrap'),
  openExternal: (url) => invoke('app:openExternal', url),
  openPath: (p) => invoke('app:openPath', p),
  revealPath: (p) => invoke('app:revealPath', p),
  dataDir: () => invoke('app:dataDir'),

  config: {
    get: () => invoke('config:get'),
    set: (patch) => invoke('config:set', patch),
    reset: () => invoke('config:reset')
  },

  game: {
    inspect: () => invoke('game:inspect'),
    detect: () => invoke('game:detect'),
    setRoot: (root) => invoke('game:setRoot', root),
    ensureModsDir: () => invoke('game:ensureModsDir')
  },

  mods: {
    list: () => invoke('mods:list'),
    setEnabled: (id, enabled) => invoke('mods:setEnabled', id, enabled),
    uninstall: (id, opts) => invoke('mods:uninstall', id, opts),
    reveal: (id) => invoke('mods:reveal', id),
    /** 某个 Nexus modId 已装着的文件清单（覆盖对比用） */
    filesForModId: (modId) => invoke('mods:filesForModId', modId)
  },

  nexus: {
    list: (opts) => invoke('nexus:list', opts),
    /** 局部查「已安装 / 已下载」状态：传 modId 数组，回 `{ "1252": {...} }` */
    localState: (modIds) => invoke('nexus:localState', modIds),
    /** 分类 / 标签筛选器的可选值与各自 mod 数（一次请求批量取） */
    facets: (opts) => invoke('nexus:facets', opts),
    detail: (modId) => invoke('nexus:detail', modId),
    files: (modId) => invoke('nexus:files', modId),
    parseUrl: (url) => invoke('nexus:parseUrl', url),
    clearCache: () => invoke('nexus:clearCache'),

    authStatus: () => invoke('nexus:authStatus'),
    authVerify: () => invoke('nexus:authVerify'),
    login: () => invoke('nexus:login'),
    logout: () => invoke('nexus:logout'),
    fetchApiKey: () => invoke('nexus:fetchApiKey'),
    /** 订阅登录状态变化，返回取消订阅函数 */
    onAuthChanged: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('nexus:auth-changed', h);
      return () => ipcRenderer.removeListener('nexus:auth-changed', h);
    }
  },

  /** 浏览页黑名单（点了「不喜欢」的 mod）—— 纯本地 */
  blacklist: {
    list: () => invoke('blacklist:list'),
    ids: () => invoke('blacklist:ids'),
    add: (modId, meta) => invoke('blacklist:add', modId, meta),
    remove: (modId) => invoke('blacklist:remove', modId)
  },

  nxm: {
    status: () => invoke('nxm:status'),
    register: () => invoke('nxm:register'),
    unregister: () => invoke('nxm:unregister'),
    takePending: () => invoke('nxm:takePending'),
    parse: (url) => invoke('nxm:parse', url),
    prepare: (payload) => invoke('nxm:prepare', payload),
    start: (payload) => invoke('nxm:start', payload),
    cancel: () => invoke('nxm:cancel'),
    /** 收到 nxm:// 安装请求，返回取消订阅函数 */
    onIncoming: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('nxm:incoming', h);
      return () => ipcRenderer.removeListener('nxm:incoming', h);
    },
    /** 下载进度，返回取消订阅函数 */
    onProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('nxm:progress', h);
      return () => ipcRenderer.removeListener('nxm:progress', h);
    }
  },

  install: {
    tools: () => invoke('install:tools'),
    analyze: (archivePath, meta, opts) => invoke('install:analyze', archivePath, meta, opts),
    /** 变体包每套内容的预览图（`{ [目录]: 'file://...' }`，拿不到就是空对象） */
    variantCovers: (archivePath, dirs) => invoke('install:variantCovers', archivePath, dirs),
    run: (payload) => invoke('install:run', payload),
    pickArchive: () => invoke('install:pickArchive'),
    pickTarget: () => invoke('install:pickTarget'),
    /** 安装进度（解压 / 复制），返回取消订阅函数 */
    onProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('install:progress', h);
      return () => ipcRenderer.removeListener('install:progress', h);
    }
  },

  /**
   * 下载管理：加入队列 / 队列状态 / 自动安装。
   *
   * 授权边界：免费 Nexus 账号必须由用户在网页上点一次「Mod Manager Download」，
   * 本程序只负责那一次点击之后的全部自动化（下载 / 排队 / 安装 / 封面缓存）。
   */
  download: {
    list: () => invoke('download:list'),
    /** 从浏览页 / 详情页加入队列（等一次授权） */
    enqueue: (meta) => invoke('download:enqueue', meta),
    /** 本地压缩包直接进队列并自动安装（opts: {auto, confirmed, reason, from}） */
    importLocal: (archivePath, meta, opts) => invoke('download:importLocal', archivePath, meta, opts),
    /** 打开 Nexus 安装助手，高亮该 mod 的下载按钮 */
    authorize: (id) => invoke('download:authorize', id),
    /** 自动授权（免点击）：直接向 Nexus 站内端点要下载授权 */
    autoAuthorize: (id) => invoke('download:autoAuthorize', id),
    /** 一键把队列里所有「等待授权」的任务都授权掉 */
    autoAuthorizeAll: (opts) => invoke('download:autoAuthorizeAll', opts),
    start: (id) => invoke('download:start', id),
    cancel: (id) => invoke('download:cancel', id),
    confirmInstall: (id, opts) => invoke('download:confirmInstall', id, opts),
    /**
     * ⏸ 暂停 —— 中止下载但**保留半截文件**，之后 `start()` 就是「继续」（从断点续传）。
     * 与 `cancel()` 的分界：暂停留 .part，取消清 .part。
     */
    pause: (id) => invoke('download:pause', id),
    /** ⏸ 全部停止 —— 把正在跑的任务一次性暂停（同样保留进度） */
    pauseAll: () => invoke('download:pauseAll'),
    /**
     * 一键安装（默认选择）—— 不弹选择框，直接按「每组第一套 + 互不相关的全选」装。
     * 界面「确认安装」在有默认集时走这条；想改组合仍可打开选择框手动改。
     */
    confirmDefault: (id) => invoke('download:confirmDefault', id),
    /** 批量一键安装：把队列里所有「待确认」任务按默认选择装掉 */
    confirmAllDefault: (opts) => invoke('download:confirmAllDefault', opts),
    /** 🗑 彻底删除：记录 + 安装包 + 半截下载 + 缓存图（**不动游戏目录**） */
    purge: (id) => invoke('download:purge', id),
    /** 重新分析任务结构 —— 老任务的 plan 可能缺 `options`（变体候选）等后加字段 */
    plan: (id) => invoke('download:plan', id),
    /** 重算所有「待确认」任务的安装方案（规则升级后让老任务活过来） */
    refreshPlans: () => invoke('download:refreshPlans'),
    remove: (id, opts) => invoke('download:remove', id, opts),
    reveal: (id) => invoke('download:reveal', id),
    /** 队列变化（新增 / 状态变更 / 进度写库），返回取消订阅函数 */
    onChanged: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('download:changed', h);
      return () => ipcRenderer.removeListener('download:changed', h);
    },
    /** 下载 / 安装的细粒度进度，返回取消订阅函数 */
    onProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('download:progress', h);
      return () => ipcRenderer.removeListener('download:progress', h);
    },
    /** 批量自动授权的进度（done / total / ok / failed），返回取消订阅函数 */
    onAutoAuth: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('download:autoauth', h);
      return () => ipcRenderer.removeListener('download:autoauth', h);
    },
    /** 批量「一键安装」的进度（done / total / name），返回取消订阅函数 */
    onConfirmProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('download:confirmprogress', h);
      return () => ipcRenderer.removeListener('download:confirmprogress', h);
    }
  },

  /**
   * 缓存 / 取得某个 Mod 的展示图（最多 5 张「不同」图片，返回本地 file:// 地址）。
   * `urls` 可省略 —— 省略时自动去 Nexus 图集抓取，再回落官方 API。
   * `opts.force = true` 可强制刷新图集缓存。
   */
  modImages: (modId, urls, opts) => invoke('mod:images', modId, urls, opts),

  /**
   * 下载目录监听 —— 「手动下载」这条路的兜底。
   * 盯着下载文件夹，出现新的 mod 压缩包就自动导入队列。
   */
  watch: {
    status: () => invoke('watch:status'),
    set: (patch) => invoke('watch:set', patch),
    /** 不传参数 = 弹目录选择框；传路径 = 直接用该目录 */
    addDir: (dir) => invoke('watch:addDir', dir),
    removeDir: (dir) => invoke('watch:removeDir', dir),
    scanNow: () => invoke('watch:scanNow'),
    ignoreExisting: () => invoke('watch:ignoreExisting'),
    forget: (p) => invoke('watch:forget', p),
    /** 监听到新压缩包并已导入队列，返回取消订阅函数 */
    onFound: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('watch:found', h);
      return () => ipcRenderer.removeListener('watch:found', h);
    }
  },

  /** 前置组件（框架类 Mod）：清单 + 一键安装 */
  prereq: {
    list: () => invoke('prereq:list'),
    install: (key) => invoke('prereq:install', key),
    closeAssistant: () => invoke('prereq:closeAssistant'),
    /** UE4SS 走 GitHub 直下（不走 Nexus，不需要在网页上点任何东西） */
    ue4ssInfo: (force) => invoke('prereq:ue4ssInfo', force),
    installUe4ss: () => invoke('prereq:installUe4ss'),
    openReleases: () => invoke('prereq:openReleases'),
    /** UE4SS 下载进度，返回取消订阅函数 */
    onUe4ssProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('prereq:ue4ss-progress', h);
      return () => ipcRenderer.removeListener('prereq:ue4ss-progress', h);
    },
    /** 安装助手窗口被关掉，返回取消订阅函数 */
    onAssistantClosed: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('prereq:assistant-closed', h);
      return () => ipcRenderer.removeListener('prereq:assistant-closed', h);
    },
    /** 助手窗口里的下载进度（Manual → Slow download 这条路），返回取消订阅函数 */
    onDownloadProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('prereq:download-progress', h);
      return () => ipcRenderer.removeListener('prereq:download-progress', h);
    },
    /** 助手窗口把安装包下载完了 —— 带着本地路径，可以直接进安装流程 */
    onDownloaded: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('prereq:downloaded', h);
      return () => ipcRenderer.removeListener('prereq:downloaded', h);
    }
  },

  /** 运行日志：应用没有终端，出问题时这是唯一的回溯线索 */
  log: {
    info: () => invoke('log:info'),
    tail: (n, opts) => invoke('log:tail', n, opts),
    openDir: () => invoke('log:openDir'),
    open: (file) => invoke('log:open', file)
  },

  translate: {
    text: (text, lang) => invoke('translate:text', text, lang),
    stats: () => invoke('translate:stats'),
    clear: () => invoke('translate:clear'),
    /** 订阅翻译进度，返回取消订阅函数 */
    onProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('translate:progress', h);
      return () => ipcRenderer.removeListener('translate:progress', h);
    }
  }
});
