'use strict';
/* 剑星 Mod 管理器 · 渲染层 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => (r ? [...r.querySelectorAll(s)] : []);

const state = {
  config: null,
  game: null,
  installed: [],
  // 崩溃诊断页：report 是主进程 `crash:report` 的整份分析结果（含结论/嫌疑/发现/步骤/崩溃清单）
  crash: { report: null, loading: false, error: '', at: 0 },
  auth: null,
  prereq: null,
  prereqs: [],
  prereqBusy: null,
  showBuiltin: false,
  // 已安装页：排序方式（time = 安装时间倒序，默认）与最近一次分组结果。
  // ⚠️ 图表上显示的是**分组后的卡片**，`state.installed` 仍是磁盘扫描出来的原始项
  //    （侧栏计数、启用数都还按原始项算），两者不要混。
  installedSort: 'time',
  // 已安装页排序方向：'asc'（正序）/ 'desc'（倒序）。
  // 每种排序各有自己的**默认方向**（安装时间默认倒序 —— 最新装的在最上面；其余默认正序），
  // 切换排序时会用它重置；点方向按钮、或再点一次当前排序名，都能翻转。
  installedSortDir: 'desc',
  installedGroups: [],
  // 默认「全部内容」—— 不隐藏任何 mod（用户 2026-10-12 明确要求）
  // blocked = 点了「不喜欢」的 modId 集合（字符串）；blockMode = hide（默认不显示）/ all / only
  // liked = 点了「喜欢」的 modId 集合（字符串）；onlyLiked = 「只看喜欢」视图（走本地记录，不碰 Nexus）
  browse: { sort: 'downloads', search: '', offset: 0, items: [], total: 0, loading: false, done: false, adultMode: 'all', category: '', tags: [], facets: null, gen: 0, onlyUninstalled: false, blocked: new Set(), blockMode: 'hide', liked: new Set(), onlyLiked: false, onlyDownloaded: false },
  // 浏览页多选 / 批量下载：ids 是 modId 字符串集合（跨滚动保留），
  // all = 「已全选当前列表」，之后追加加载的新卡片自动并入选择。
  // anchor = 上一次点的那张 Mod（Shift 连选的起点）；换筛选 / 全选 / 退出多选时清空
  sel: { on: false, all: false, busy: false, ids: new Set(), anchor: null },
  // 已安装页的多选 / 筛选（用户 2026-11-07：「已安装的mod也要支持全选多选筛选等功能，与查看在线mod一致」）。
  // ⚠️ 与浏览页的 `sel` **分开存**：两页的勾选互不相干 —— 浏览页存 modId，这里存**分组键**
  //    （`mod:<modId>` / `one:<磁盘 id>`），因为已安装页一行卡片就是一个 Mod，可能对应多个文件。
  gsel: { on: false, busy: false, ids: new Set(), anchor: null },
  // 已安装页筛选条件：q = 关键词（名字 / Mod ID / 作者），state = 启用状态，kind = 类型
  instFilters: { q: '', state: '', kind: '', bug: '' },
  /**
   * 「Mod 库」统一视图（2026-11-10 用户定案：浏览 / 已下载 / 已安装 合成一个页面）。
   *
   * status ∈ all（默认，在线+已下载+已安装）/ online（只在线，走 Nexus 分页）
   *        / downloaded（下好了没装）/ installed（装着）/ enabled / disabled / partial
   * marks 三个布尔是**叠加**筛选，与 status 不冲突；kind 是本地类型（服装 / CNS / 前置 / 脚本…）。
   */
  // 标记三态（用户 2026-11-11）：'' 任意 · 'in' 只看有 · 'ex' 排除掉有。
  // 负面标记（不感兴趣 / 有 bug）默认第一下就是「排除」，正常浏览时不碍眼。
  lib: { status: 'all', marks: { liked: '', blocked: '', bug: '', verified: '' }, kind: '', sort: '', catSet: false },
  libRecords: [],       // 最近一次拼出来的统一记录（全选 / 计数都走它）
  libShownRecords: [],  // 过滤之后真正显示的记录
  installedShown: [],   // 本次渲染后**真正显示出来**的分组（筛选之后），全选用它
  // 「这个 Mod 有 bug」标记（Nexus modId 字符串集合）。和黑名单不同：它**不影响**
  // 浏览页显示，只在安装路径上拦一道（批量安装先问一句）。
  bugIds: new Set(),
  // 「已验证」标记（用户实测过能用的 Nexus modId 集合）。和「有 bug」是同一类**个人实测结论**：
  // 那个说「装进去会出事」，这个说「我确认真能跑」。两者互不排斥，只跟「未验证」这颗筛选互斥。
  verifiedIds: new Set(),
  modalTask: null,   // 「选择要安装哪些内容」对话框对应的下载任务 id
  pick: new Set(),   // 该对话框里已勾选的候选目录（归档内相对路径）
  pickGroups: null,  // dir → 同组目录数组（同一件东西的不同版本，组内单选）
  drawer: { open: false, kind: null, mod: null, lang: 'zh', translated: null, translating: false, files: [] },
  nxm: { open: false, info: null, prep: null, downloading: false, downloaded: null },
  install: { open: false, archivePath: null, meta: null, plan: null, running: false, manualTarget: null, pickDir: '', pickDirs: null, result: null },
  downloads: [],
  downloadStats: {},
  // 管理器自带安装包（data/library）的盘点结果 —— 队列被清理过之后，
  // 「下好了没装」只能靠它才看得见（主进程 `library:list`）。
  library: null,
  // 「管理器里还有 N 个包」一次列几个（卡片比原来的一行文字占地方）
  libShown: 12,
  // modId -> { name, author, summary, version, image }：卡片要显示封面和作者，
  // 磁盘上的包只有文件名可推断出 modId，所以详情得另外补（下载队列里的任务优先，其次问 Nexus）。
  libMeta: null,
  // 已经问过 Nexus 的 modId（问不到的也记下来，避免每次重绘都再问一遍）
  libMetaTried: null,
  nxmStatus: null,
  installTools: null,
  // 下载目录监听状态（bootstrap 带回）
  watch: { enabled: true, autoInstall: true, running: false, dirs: [], seen: 0 },
  // UE4SS 最新 Release 信息（前置组件页显示用）
  ue4ssInfo: null,
  ue4ssInfoLoading: false,
  ue4ssInfoError: null,
  ue4ssInstalledTag: null
};

/* ---------------- 基础工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 长文件名截断（下载队列里一个 mod 可能有多个文件任务，得能区分） */
function clip(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/*
 * 下载量 / 点赞数这类大数字。
 *
 * 「万」是中文独有量级，硬拼成 `${n/10000} 万` 在英文界面会变成 `1.3 万`。
 * 交给 Intl 的 compact 记法各语言自己缩：中文「1.3万」、英文「13K」、
 * 韩文「1.3만」、俄文「13 тыс.」—— 一套代码覆盖 14 种语言。
 * 「万」只有 1 个字，走 DOM 翻译器的片段替换会被单字保护挡掉，所以必须从代码层解决。
 */
function fmtNum(n) {
  n = Number(n) || 0;
  if (window.I18N) return window.I18N.compact(n);
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return String(n);
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 版本号显示：有的来源自带 `v`（Nexus 上是 `v2.3`），有的不带（`2.3`）。
 * 直接拼 `'v' + v` 会得到 `vv2.3` —— 实测已安装页和覆盖明细都踩过。
 */
function verText(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return /^v/i.test(s) ? s : 'v' + s;
}

let toastTimer = null;
function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'on' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, type === 'err' ? 4200 : 2400);
}

/** 统一解包主进程返回 { ok, data } */
async function call(promise, { silent = false } = {}) {
  let r;
  try { r = await promise; }
  catch (e) { if (!silent) toast('调用失败：' + e.message, 'err'); throw e; }
  if (!r) { const e = new Error('无返回'); if (!silent) toast('无返回', 'err'); throw e; }
  if (r.ok === false) { if (!silent) toast(r.error, 'err'); throw new Error(r.error); }
  return r.data;
}

/* ---------------- 通用模态框 ---------------- */

function openModal(title, bodyHtml, buttons) {
  $('#mTitle').textContent = title;
  $('#mBody').innerHTML = bodyHtml;
  $('#mFoot').innerHTML = (buttons || []).map(b =>
    `<button class="btn${b.primary ? ' p' : ''}${b.danger ? ' d' : ''}" data-mbtn="${esc(b.id)}">${esc(b.label)}</button>`
  ).join('');
  $('#modal').classList.add('on');
}

function closeModal() { $('#modal').classList.remove('on'); }

/* ---------------- 覆盖对比（要装的新 Mod vs 已装的旧 Mod）---------------- */

/** 对比框当前上下文（点「仍然覆盖」时要用） */
let cmpCtx = null;

/**
 * 对比框右侧「要装进去（新）」的那份 meta。
 *
 * ⚠️ **由 `conflictListHtml(..., { incoming })` 的调用方在渲染冲突清单时写入** ——
 *    那一刻上下文（下载任务的 `t.meta` / 安装计划的 `install.meta`）是明确的。
 *
 *    曾经这里靠 `state.modalTask` 去取：可它是**任务 id 字符串**而不是任务对象，
 *    `st.meta` 永远是 undefined；另一个候选 `state.cmpIncoming` 则**从未被赋值过**。
 *    于是 `meta` 恒为 `{}` —— 对比框右侧整块显示成「Mod #? / 版本 — / 作者 — / 没有封面图」
 *    （用户 2026-10-14 的截图）。改成显式传参，不再事后猜 state。
 */
let cmpIncomingMeta = {};

/**
 * 「和已装的那个 Mod 做对比」—— 用户要求：
 * > 这种需要覆盖的要提供对比按钮，并列显示对应的已安装模组的信息，尤其是图片。
 *
 * 左右两栏并列，每栏给：封面/图集、名字、版本、作者、Mod ID、文件清单。
 *   · **左边（旧）**：已装着的那个 Mod —— 按 modId 从主进程拉图集（本地有缓存就是瞬时）
 *   · **右边（新）**：正要装进去的这个 —— 先用 meta 里已有的图，meta 里没有就按 modId 去拉
 *
 * 用户 2026-10-14 补充：「其实主要是比较截图」—— 所以两侧都会**主动拉图集**，
 * 只给一张封面是不够比的。
 *
 * @param {number} oldModId 已装 Mod 的 Nexus modId
 * @param {string} [oldName] 显示名（主进程已经给了，省一次查询）
 * @param {{version?:string,author?:string,pictureUrl?:string}} [oldInfo]
 *        已装那个 mod 的版本 / 作者 / 封面 —— 来自 installFlow 的 `owners`，
 *        有了它左栏第一帧就是完整的，不用等图集拉回来（用户说「显示不完整」就是指这个）。
 */
async function openCmpModal(oldModId, oldName, oldInfo = {}) {
  const meta = cmpIncomingMeta || {};
  const incomingImgs = (meta.images || []).filter(x => x && x.localUrl);

  const faceOf = (local) => local
    ? `<img class="cmp-face" src="${esc(local)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cmp-face ph',textContent:'封面加载失败'}))">`
    : `<div class="cmp-face ph">没有封面图</div>`;

  const kv = (k, v) => v
    ? `<div class="cmp-kv"><b>${esc(k)}</b><span>${esc(String(v))}</span></div>`
    : `<div class="cmp-kv"><b>${esc(k)}</b><span>—</span></div>`;

  // 两侧都先摆「名字 + Mod ID + 版本 + 作者 + 封面」，图集/文件清单随后异步补进来。
  openModal('覆盖对比：已装的 vs 要装的', `
    <div class="cmpwrap">
      <div class="cmpgrid">
        <div class="cmpcol old">
          <h4>已装着（会被替换掉）</h4>
          <div class="cmp-body">
            <div id="cmpOldFace">${faceOf(oldInfo.pictureUrl || '')}</div>
            <div class="cmp-name">${esc(oldName || 'Mod #' + oldModId)}</div>
            ${kv('Mod ID', '#' + oldModId)}
            ${kv('版本', verText(oldInfo.version))}
            ${kv('作者', oldInfo.author)}
            <div class="cmp-files" id="cmpOldFiles"><span class="spin"></span> 正在读取已装 Mod 的文件清单…</div>
          </div>
        </div>
        <div class="cmpcol new">
          <h4>要装进去（新）</h4>
          <div class="cmp-body">
            <div id="cmpNewFace">${faceOf(incomingImgs[0] ? incomingImgs[0].localUrl : (meta.image || meta.pictureUrl || ''))}</div>
            <div class="cmp-name">${esc(meta.name || 'Mod #' + (meta.modId || '?'))}</div>
            ${kv('Mod ID', meta.modId ? '#' + meta.modId : '')}
            ${kv('版本', verText(meta.version))}
            ${kv('作者', meta.author)}
            <div class="cmp-files">${(meta.fileName ? esc(meta.fileName) : '（文件清单见下载卡片）')}</div>
          </div>
        </div>
      </div>
      <div class="txt" style="color:var(--dim2);font-size:11px;margin-top:10px">
        下面这些文件会被上面这份新的替换掉；左右信息相同就是「同一个 Mod 升级」，
        不同就是「装了这个会顶掉那个」。
      </div>
    </div>`, [
      { id: 'cmpClose', label: '关闭' },
      { id: 'cmpGo', label: '查看被替换的文件', primary: true }
    ]
  );

  cmpCtx = { oldModId, oldName };

  // 旧 Mod 的封面 / 图集 / 文件清单 —— 全部按需拉（本地有缓存就是瞬时）
  try {
    const imgs = await call(window.api.modImages(oldModId, null, undefined), { silent: true }) || [];
    const faceBox = document.getElementById('cmpOldFace');
    if (faceBox && $('#modal') && $('#modal').classList.contains('on') && imgs.length) {
      faceBox.innerHTML = faceOf(imgs[0].localUrl)
        + (imgs.length > 1
          ? `<div class="lbl" style="margin-top:6px">图集 · ${imgs.length} 张</div>${imageGrid(imgs)}`
          : '');
    }
  } catch { /* 拿不到图就保持「没有封面图」 */ }

  try {
    const files = await call(window.api.mods.filesForModId(oldModId), { silent: true }) || [];
    const box = document.getElementById('cmpOldFiles');
    if (box) {
      box.innerHTML = files.length
        ? files.map(f => esc(f.rel || f.name)).join('<br>')
        : '（这条记录没有文件清单）';
    }
  } catch { /* 忽略 */ }

  // 新 Mod 的图集 —— meta 里通常只有一张封面，而用户看对比**主要就是看截图**，
  // 所以按 modId 再正儿八经拉一次图集（走同一条本地缓存，拉过一次就是瞬时的）。
  const newModId = Number(meta.modId) || 0;
  if (newModId && !incomingImgs.length) {
    try {
      const imgs = await call(window.api.modImages(newModId, null, undefined), { silent: true }) || [];
      const faceBox = document.getElementById('cmpNewFace');
      if (faceBox && $('#modal') && $('#modal').classList.contains('on') && imgs.length) {
        faceBox.innerHTML = faceOf(imgs[0].localUrl)
          + (imgs.length > 1
            ? `<div class="lbl" style="margin-top:6px">图集 · ${imgs.length} 张</div>${imageGrid(imgs)}`
            : '');
      }
    } catch { /* 忽略 */ }
  }
}

/* ---------------- 导航 ---------------- */

const TITLES = {
  // 2026-11-10 起「已安装 Mod」并入「Mod 库」：在线 / 已下载 / 已安装 用顶部状态筛选区分。
  'p-browse': ['Mod 库', '在线、已下载、已安装 —— 一处看全'],
  'p-download': ['下载管理', '队列会自动完成 下载 → 识别 → 安装'],
  'p-prereq': ['前置组件', 'Mod 加载器与框架'],
  'p-crash': ['崩溃诊断', '读游戏日志与崩溃快照，判断是哪个 Mod 让它崩了'],
  'p-settings': ['设置', '路径 / 账号 / 翻译']
};

/** 各页离开时的滚动位置 —— 切回来直接恢复，不重置、不重新拉数据 */
const pageScroll = new Map();

function switchPage(id) {
  // 老入口（导航、按钮、抽屉里的「去已安装看看」）一律导向 Mod 库，并把状态切到「已安装」
  if (id === 'p-installed') {
    setLibStatus('installed', { silent: true });
    id = 'p-browse';
  }
  const cur = $('.page.on');
  const curId = cur && cur.id;
  if (curId && curId !== id) pageScroll.set(curId, $('#body').scrollTop);

  $$('.nav-i').forEach(n => n.classList.toggle('on', n.dataset.p === id));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === id));
  const [t, s] = TITLES[id] || ['', ''];
  $('#ttl').textContent = t;
  $('#sub').textContent = s;
  $('#searchBox').style.display = id === 'p-browse' ? 'flex' : 'none';
  $('#btnImport').style.display = (id === 'p-browse' || id === 'p-download') ? '' : 'none';
  const btnLk = $('#btnLinker');
  if (btnLk) btnLk.style.display = (id === 'p-browse') ? '' : 'none';
  const btnSite = $('#btnOpenSite');
  if (btnSite) btnSite.style.display = (id === 'p-browse') ? '' : 'none';
  $('#btnRefresh').style.display = id === 'p-prereq' ? 'none' : '';
  // 第一次进某页才置顶；来过的恢复到离开时的位置（display:none → block 后要等一帧才设得进）
  const back = pageScroll.get(id);
  $('#body').scrollTop = 0;
  if (back) {
    requestAnimationFrame(() => { const el = $('#body'); if (el && el.scrollTop === 0) el.scrollTop = back; });
    setTimeout(() => { const el = $('#body'); if (el && el.scrollTop === 0) el.scrollTop = back; }, 60);
  }
  if (id === 'p-browse' && state.browse.items.length === 0 && !state.browse.loading) loadBrowse(true);
  // 回到浏览页时刷新本地状态 —— 用户可能刚去下载页装完东西
  else if (id === 'p-browse') scheduleCardStateRefresh();
  if (id === 'p-download') renderDownload();
  if (id === 'p-prereq') {
    // 进前置组件页才去查 GitHub（避免启动时无谓地打接口），查到后重绘一次
    if (!state.ue4ssInfo && !state.ue4ssInfoLoading) {
      refreshUe4ssInfo().then(() => { if ($('#p-prereq').classList.contains('on')) renderPrereq(); }).catch(() => {});
    }
  }
  if (id === 'p-settings') refreshWatchLine();
  // 崩溃诊断页开销不小（读 UE4SS.log 尾部 + 解析 20 份崩溃快照），只在进页时才跑
  if (id === 'p-crash' && !state.crash.report && !state.crash.loading) renderCrash();
}

/* ---------------- 侧栏状态 ---------------- */

/**
 * 游戏版本的一句话说法。
 * 读的是主程序 exe 的版本资源，读不到就老实说读不到 —— 别拿空字符串糊过去，
 * 也别编个「v1.0」出来。
 */
function gameVerOf(g) {
  const v = (g && g.version) || null;
  if (!v || !v.ok || !v.version) return '';
  return String(v.version);
}

function gameVerText(g) {
  if (!g || !g.found) return '<span style="color:var(--dim2)">还没设置游戏目录</span>';
  const v = gameVerOf(g);
  if (v) {
    return `<b style="color:var(--text);font-size:13px" data-i18n-skip>v${esc(v)}</b>` +
      '<span style="color:var(--dim2)"> · 读自主程序版本信息</span>';
  }
  const why = ((g.version && g.version.reason) || '这个 exe 里读不到版本号');
  return `<span style="color:var(--dim2)">${esc(why)}</span>`;
}

function renderSidebar() {
  const g = state.game;
  const ok = g && g.found;
  const ver = ok ? gameVerOf(g) : '';
  $('#gameDot').className = 'dot' + (ok ? '' : ' bad');
  $('#gameStat').textContent = ok ? '游戏已就绪' : '未找到游戏目录';
  $('#gamePath').textContent = ok
    ? `${g.root}\n${ver ? 'v' + ver + ' · ' : ''}UE4SS ${g.ue4ss.installed ? '✓' : '✗'} · CNS ${g.cns.installed ? '✓' : '✗'}`
    : (g && g.configured) || '—';
  syncGameVerChip(ver);
  syncInstalledNav();

  const active = (state.downloads || []).filter(t => DL_ACTIVE.has(t.status)).length;
  const badge = $('#navCountDownload');
  badge.textContent = active;
  badge.style.display = active ? '' : 'none';
  badge.style.background = active ? 'rgba(232,163,61,.2)' : '';
  badge.style.color = active ? 'var(--accent)' : '';
}

/* ---------------- 已安装 Mod ---------------- */

const KIND_LABEL = { pak: 'Pak 模组', script: '脚本模组', logicmod: '逻辑模组', prereq: '前置组件' };

/** 优先用下载时缓存到本地的封面（离线也能显示），其次回落到注册表里的来源图 */
function coverForMod(modId) {
  const id = Number(modId);
  if (!id) return '';
  const t = (state.downloads || []).find(x =>
    Number(x.meta && x.meta.modId) === id && x.meta && x.meta.image);
  return (t && t.meta.image) || '';
}

/* ---------------- 展示图（图集） ---------------- */

/** 把本地缓存好的图片渲染成网格；点图用系统看图程序打开 */
function imageGrid(imgs) {
  const list = (Array.isArray(imgs) ? imgs : []).filter(x => x && x.localUrl);
  if (!list.length) return '';
  return `<div class="imgrid">${list.map(i =>
    `<img src="${esc(i.localUrl)}" alt="" title="点击用系统看图打开"
      data-openpath="${esc(i.path || '')}"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'图片加载失败'}))">`
  ).join('')}</div>`;
}

/** 某个 mod 本地已缓存的展示图（注册表 meta.images） */
function cachedImagesOf(meta) {
  return (meta && Array.isArray(meta.images) ? meta.images : []).filter(x => x && x.localUrl);
}

/**
 * 异步把某个 Mod 的图集填进 `#galleryBox`。
 *
 * 两段式（0.4.9，用户 2026-11-09：「已经显示的图集要保存到本地……已经缓存了图片的
 * 就不要再下载一次了」）：
 *   ① 先问 `mod:imagesDisk` —— 只读 `data/cache/images/<modId>/` 里已有的文件，
 *      有就立刻画出来，**一个网络请求都不发**（也就没有 spinner）。
 *   ② 本地确实没有（或者用户点了「刷新图集」传了 force），才走 `mod:images`
 *      去抓 Nexus 的图集，抓到的同样落盘，下次打开就是第 ① 条的快路径。
 */
async function fillGallery(modId, { force = false } = {}) {
  const box = $('#galleryBox');
  if (!box) return;

  const token = String(modId);
  box.dataset.modid = token;               // 记住这块图集属于哪个 Mod
  // 抽屉里已经画着的东西（在线 Mod 那张主图 hero）先留着 ——
  // 2026-11-09 用户反馈：已经有图的 Mod 点开详情，图集区一直转圈，
  // 而原来的写法是「一上来就把这块清空、只放一个 spinner」，主图也跟着没了，
  // 于是一边有图一边说在加载，看着就像卡死。现在改成「不清空，只在下面加一行进度」。
  const keep = box.innerHTML.trim();
  const stale = () => {
    const b = $('#galleryBox');
    return !b || b.dataset.modid !== token;   // 抽屉关了 / 换成别的 Mod 了
  };

  if (!force) {
    let local = [];
    try { local = await call(window.api.modImagesDisk(modId), { silent: true }); } catch { local = []; }
    if (stale()) return;
    if (local && local.length) {
      $('#galleryBox').innerHTML = `<div class="lbl">图集 · ${local.length} 张（已缓存到本地）</div>${imageGrid(local)}`;
      return;                              // 本地就有，收工，不联网
    }
  }

  // 本地没有：图先不动，底下挂一行进度；最多等 8 秒就换成「先看主图」的口径，
  // 免得 spinner 一直转（真正的请求还在跑，回来了照样把图集补上）。
  const note = document.createElement('div');
  note.className = 'galnote';
  note.style.cssText = 'color:var(--dim2);font-size:12px;margin-top:6px';
  note.innerHTML = '<span class="spin"></span> 正在获取这个 Mod 的图集…';
  box.appendChild(note);
  const timer = setTimeout(() => {
    if (stale() || note.dataset.done) return;
    note.innerHTML = '图集还在抓，先看这张主图；抓到会自动补上。';
  }, 8000);

  let imgs = [];
  try {
    imgs = await call(window.api.modImages(modId, null, force ? { force: true } : undefined), { silent: true });
  } catch { imgs = []; }
  clearTimeout(timer);
  note.dataset.done = '1';
  if (stale()) return;                     // 抽屉已关 / 内容已换，别再写
  const box2 = $('#galleryBox');
  if (!box2) return;
  if (imgs && imgs.length) {
    box2.innerHTML = `<div class="lbl">图集 · ${imgs.length} 张（已缓存到本地）</div>${imageGrid(imgs)}`;
    return;
  }
  // 一张都没抓到：把原来的内容放回去，只在下面说一句，不把主图吃掉
  box2.innerHTML = keep;
  const tip = document.createElement('div');
  tip.className = 'galnote';
  tip.style.cssText = 'color:var(--dim2);font-size:12px;margin-top:6px';
  tip.textContent = '没能取到更多图集（可能被 Cloudflare 拦住，或该 Mod 没有额外图片）。';
  box2.appendChild(tip);
}

/* ---------------- 已安装 Mod：分组与排序 ---------------- */

/**
 * 已安装页的排序方式。
 *
 * 用户 2026-10-14 要求：默认**按安装时间倒序**（最新装的排最上面），并且要能切换。
 * 同时也给了兜底口径 ——「优先按时间，其次按 Mod ID，mod 名称」：
 * 时间一样时按 Mod ID、再一样按名称，保证顺序**确定**（不会两次刷新换个位置）。
 */
// 已安装页的排序方式。`defDir` = 这种排序的**默认方向**：
// 「安装时间」默认倒序（最新装的最上面，符合直觉），其余默认正序。
const INSTALLED_SORTS = [
  { value: 'time', label: '安装时间', title: '按安装时间排序 —— 默认最新装的排最上面', defDir: 'desc' },
  { value: 'name', label: '名称', title: '按 Mod 名称排序', defDir: 'asc' },
  { value: 'modid', label: 'Mod ID', title: '按 Nexus Mod ID 排序', defDir: 'asc' },
  { value: 'kind', label: '类型', title: '按类型排序（前置组件 → Pak → 脚本）', defDir: 'asc' }
];

/** 排序方向的合法取值（配置被手工改坏时靠它兜底） */
const SORT_DIRS = ['asc', 'desc'];

/** 某种排序方式的默认方向（未知 mode 一律正序） */
function sortDefaultDir(mode) {
  const s = INSTALLED_SORTS.find(x => x.value === mode);
  return (s && s.defDir) || 'asc';
}

// 逻辑模组（Logic Mod）与 pak 一样是「已安装的实体模组」，排在 pak 旁边
const KIND_RANK = { prereq: 0, pak: 1, logicmod: 1, script: 2 };

/** 一组里最「新」的安装时间（注册表里的 installedAt，没有就退回文件 mtime） */
function groupMtime(items) {
  let t = '';
  for (const m of items) if (m.mtime && m.mtime > t) t = m.mtime;
  return t;
}

/**
 * 已安装列表的比较器 —— 每个模式都带**兜底键**，保证全序、结果稳定可复现。
 * 默认口径即用户说的：时间倒序 → Mod ID 升序 → 名称升序。
 */
/**
 * 已安装页排序比较器。
 *
 * `dir` 是方向（'asc' / 'desc'），**不传时用该排序方式的默认方向** ——
 * 所以老的 `compareInstalled(a, b, 'time')` 行为与加方向之前一字不差。
 *
 * ⚠️ 方向**只作用于主键**，主键相同时靠次键（Mod ID / 名称）稳定排列的那一段不跟着翻转：
 *   · 否则「倒序」就成了「正序的完全逆序」，两个方向下的相对次序都得重新解释；
 *   · 更要紧的是 `byModId` 里「没有 modId 的恒排最后」这条约定 —— 它表示**来源不明**、
 *     不是大小关系，整体取反会把手动丢进 ~Mods 的包一股脑翻到最前面去。
 */
function compareInstalled(a, b, mode, dir) {
  const sign = (SORT_DIRS.includes(dir) ? dir : sortDefaultDir(mode)) === 'desc' ? -1 : 1;

  /** Mod ID 比较（`s` 为方向：-1 降序）。没有 modId 的**恒排最后**，与方向无关 */
  const byModId = (s) => {
    const av = a.modId || 0;
    const bv = b.modId || 0;
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return s < 0 ? bv - av : av - bv;
  };
  /** 名称比较（`s` 为方向） */
  const byName = (s) => (s < 0
    ? String(b.name || '').localeCompare(String(a.name || ''), 'zh-Hans-CN', { numeric: true })
    : String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { numeric: true }));

  let r = 0;
  if (mode === 'name') {
    r = byName(sign);
    if (!r) r = byModId(1);
  } else if (mode === 'modid') {
    r = byModId(sign);
    if (!r) r = byName(1);
  } else if (mode === 'kind') {
    const ra = KIND_RANK[a.kind], rb = KIND_RANK[b.kind];
    const ua = ra === undefined, ub = rb === undefined;
    if (ua !== ub) r = ua ? 1 : -1;                             // 未知类型恒排最后
    else if (ra !== rb) r = ((ra ?? 0) - (rb ?? 0)) * sign;
    if (!r) r = byName(1);
    if (!r) r = byModId(1);
  } else {
    // time：安装时间 → Mod ID → 名称（默认倒序 = 最新装的排最上面）
    // ⚠️ `groupMtime` 返回的是 **ISO 字符串**，只能比大小、不能相减（相减得 NaN，
    // 会静默退化成「按 Mod ID 排」，主键整个失效）。
    const at = groupMtime(a.items);
    const bt = groupMtime(b.items);
    if (at !== bt) r = (at < bt ? -1 : 1) * sign;
    if (!r) r = byModId(1);
    if (!r) r = byName(1);
  }
  return r;
}

/**
 * 把已安装项按 **Nexus Mod ID** 归并成「一张卡」。
 *
 * 用户 2026-10-14：「多个同 mod id 的不同模组文件合并显示，与浏览 mod 里面一致，
 * 点击单个 mod，可以看到不同模组文件」。
 * 浏览页本来就是「一个 Nexus Mod 一张卡」，这里保持同一口径：
 *   · **有 modId** 的 → 同一个 Mod 的多个已安装文件合成一张卡，
 *     抽屉里逐个列出，每个文件可单独启用 / 禁用 / 卸载；
 *   · **没有 modId** 的（手动丢进 `~Mods`、未登记的）→ 各自一张卡。
 *     它们之间没有任何依据能证明是同一个东西，硬并就是瞎猜。
 *
 * ⚠️ 组对象**刻意做成与单个 installed 项同形**（id / name / kind / enabled / size /
 *    files / meta …），这样 `installedCard()` 与 `openInstalledDrawer()` 不用大改；
 *    多出来的 `items` 才是「这个 Mod 装了哪几个文件」。
 */
/**
 * 一组里最近一次「启用」的时刻。一条 Mod 可能有多个文件，取最晚的那个 ——
 * 用户排查崩溃时关心的是「最后一次让它生效是什么时候」。
 */
function groupEnabledAt(items) {
  let t = '';
  for (const m of items || []) {
    const at = String((m.meta && m.meta.enabledAt) || '');
    if (at && at > t) t = at;
  }
  return t;
}

/** ISO 时间 → `11-10 22:31`（同一年省略年份）；解析不出来返回空串 */
function fmtWhen(iso) {
  const t = Date.parse(String(iso || ''));
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  const md = p(d.getMonth() + 1) + '-' + p(d.getDate());
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  return d.getFullYear() === new Date().getFullYear() ? md + ' ' + hm : d.getFullYear() + '-' + md + ' ' + hm;
}

function groupInstalled(list) {
  const byKey = new Map();
  for (const m of list || []) {
    const src = (m.meta && m.meta.source) || {};
    // 归组的 modId 有四个来源，优先级从「最可信」到「尽力认」：
    //   1. 注册表里记的 source.modId —— 本程序装的，绝对准
    //   2. 扫描条目自带的 meta.modId
    //   3. 「批量解析」对上的关联（mod-links.json）
    //   4. 文件名后缀的 [nx<modId>] 标识 —— 见 src/main/modTag.js
    // 第 4 条是关键：一个 mod 解压出十几个 pak 时，只要文件名带同一个标识，
    // 哪怕注册表里还没有它（刚拷进去 / 装到一半 / 记录被清过），也必须显示成同一张卡，
    // 否则就是一屏「Addon_Nier_03_xxx」这种长得一模一样、谁也不认识谁的碎卡片。
    const tagId = Number((m.tag && m.tag.modId) || 0) || 0;
    const linkId = Number((m.link && m.link.modId) || 0) || 0;
    const modId = Number(src.modId || (m.meta && m.meta.modId) || 0) || linkId || tagId || 0;
    const key = modId ? ('mod:' + modId) : ('one:' + m.id);
    let g = byKey.get(key);
    if (!g) { g = { key, modId, items: [] }; byKey.set(key, g); }
    g.items.push(m);
  }

  const groups = [];
  for (const g of byKey.values()) {
    const items = g.items;
    // 卡片上的名字优先取**带来源信息**的那条（Nexus 上的正式名），没有才用磁盘上的目录名
    const head = items.find(m => m.meta && (m.meta.name || m.meta.source)) || items[0];
    const meta = head.meta || {};
    const enabledN = items.filter(m => m.enabled).length;
    groups.push({
      key: g.key,
      modId: g.modId,
      items,
      id: items[0].id,                                   // 兜底：reveal 之类需要一个具体 id
      name: head.name || items[0].name,
      kind: items[0].kind,
      builtin: items.some(m => m.builtin),
      registered: items.some(m => m.registered),
      // 「批量解析」对上的：注册表没记录，但知道了它是 Nexus 上的哪个 Mod。
      // 单独标出来 —— 它和 registered 是两件不同的事（后者代表「本程序装的、可回滚」）。
      linked: items.some(m => m.linked),
      link: (items.find(m => m.link) || {}).link || null,
      enabled: enabledN > 0,
      partial: enabledN > 0 && enabledN < items.length,   // 部分启用
      size: items.reduce((n, m) => n + (m.size || 0), 0),
      fileCount: items.reduce((n, m) => n + (m.fileCount || 0), 0),
      files: items.flatMap(m => m.files || []),
      mtime: groupMtime(items),
      // 最近一次「启用」的时刻：排查「装了哪个之后开始崩」先按它排（0.5.3）
      enabledAt: groupEnabledAt(items),
      enabledAtGuess: items.some(m => m.meta && m.meta.enabledAtGuess === true),
      archive: (items.find(m => m.archive) || {}).archive || null,
      location: items[0].location,
      meta
    });
  }
  return groups;
}

/** 按组键取回上一次渲染出来的分组（点击卡片 / 抽屉按钮用） */
function groupOf(key) {
  return (state.installedGroups || []).find(g => g.key === key) || null;
}

function installedCard(g) {
  const meta = g.meta || {};
  const src = meta.source || {};
  const modId = g.modId || src.modId || meta.modId || null;
  const img = coverForMod(modId) || meta.image || src.pictureUrl || '';
  const zh = meta.nameZh || meta.summaryZh || meta.summary || src.summary || '';
  const version = meta.version || src.version || '';
  const author = meta.author || src.author || '';
  const cover = img
    ? `<img src="${esc(img)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'图片加载失败'}))">`
    : `<div class="ph">${g.kind === 'prereq' ? '前置组件' : '本地文件<br>无封面图'}</div>`;
  const tagCls = g.kind === 'prereq' ? 'tag pre' : (g.kind === 'script' ? 'tag script' : 'tag');
  const tagTxt = g.builtin ? '内置'
    : (g.registered ? KIND_LABEL[g.kind] : (g.linked ? '已关联' : '未登记'));
  const tagTitle = g.builtin ? ''
    : (g.registered ? '本程序安装的，卸载可完整回滚'
      : (g.linked ? '批量解析对上的 Nexus Mod：文件是自己放的，来源信息来自 Nexus'
        : '磁盘上发现的 Mod，不知道对应 Nexus 的哪个条目'));
  // 一个 Mod 装了多个文件时，卡片上直接标出来（点开能逐个看）
  const n = g.items.length;
  const multi = n > 1
    ? `<span class="tag nfile" title="这个 Mod 装了 ${n} 个文件，点开卡片可以逐个启用 / 禁用 / 卸载">${n} 个已装文件</span>`
    : '';
  // 用户点过「标为有 bug」的 Mod：卡片上要一眼看见，别让人又装回去。
  // 2026-11-10 用户要求「要用鲜明的红色标记」——徽标改成实心红，卡片本身也加一圈红框。
  const isBug = installedIsBug(g);
  const bug = isBug
    ? '<span class="tag bug" title="你标记过这个 Mod 有 bug —— 批量安装时会先问一句要不要跳过">⚠ 有 bug</span>'
    : '';
  const swTitle = g.partial ? '部分文件已启用 —— 点击全部启用' : (g.enabled ? '点击禁用' : '点击启用');

  return `
  <div class="card${g.enabled ? '' : ' off'}${isBug ? ' hasbug' : ''}" data-gid="${esc(g.key)}">
    <div class="cover">
      ${cover}
      <div class="ck${state.gsel.ids.has(g.key) ? ' on' : ''}" data-gck="${esc(g.key)}">✓</div>
      <span class="${tagCls}"${tagTitle ? ` title="${esc(tagTitle)}"` : ''}>${esc(tagTxt)}</span>
      ${multi}
      ${bug}
      ${g.kind === 'prereq' ? '' : `<button class="sw${g.enabled ? '' : ' off'}${g.partial ? ' part' : ''}" data-gtoggle="${esc(g.key)}" title="${esc(swTitle)}"></button>`}
    </div>
    <div class="cbody">
      <h3 data-i18n-skip title="${esc(g.name)}">${esc(g.name)}</h3>
      <div class="zh"${zh ? ' data-i18n-skip' : ''} title="${esc(zh)}">${esc(zh || (g.kind === 'prereq' ? 'Mod 运行依赖' : '本地已安装'))}</div>
      <div class="meta">
        ${modId ? `<span class="chip mid" title="Nexus Mod ID（Nexus 网址 /mods/ 后面那个数字）">#${esc(String(modId))}</span>` : ''}
        ${version ? `<span class="chip">${esc(verText(version))}</span>` : ''}
        ${author ? `<span>${esc(author)}</span>` : ''}
        <span>${fmtSize(g.size)}</span>
        <span>·</span>
        <span>${g.fileCount} 个文件</span>
      </div>
    </div>
  </div>`;
}

/**
 * 「要你处理」的原因 —— 一句话说清要用户做什么。
 *
 * 2026-10-14 之前它服务已安装页顶部那条「N 项待处理」列表；那批任务统一挪到下载页之后，
 * 这里改为给**下载页卡片**用（`dlItem()`）—— 待确认时它比 `install.reason` 那句泛泛的话
 * 具体得多：会区分「有互斥组 → 点一键安装」和「结构认不出来 → 手动指定安装位置」。
 */
function taskWhy(t) {
  const inst = t.install || {};
  const plan = inst.plan;
  // 「这包不是游戏 Mod」这类**结论性**诊断优先 —— 它不是「结构没见过」，
  // 说成「需要手动指定安装位置」会把人往错方向引（白找目录）。
  if (plan && plan.diagnosis) return plan.diagnosis;
  if (plan && plan.needsTargetPick) {
    // 有 `reason` 就是「这次选择有问题」（比如选了两套会互相覆盖的内容），照实说
    if (plan.reason) return plan.reason;
    const n = (plan.options || []).length;
    const g = (plan.exclusiveGroups || []).length;
    // 2026-10-14：无冲突的包现在会被**自动装掉**，还停在待确认的通常是这两种：
    //   · 有互斥组 → 每组已按第一套预选好，用户点一下就行（不必逐套挑）
    //   · 老任务还没算出默认集 → 也得让用户知道点哪个按钮
    if (n) {
      return g
        ? `包里有 ${n} 套内容，其中 ${g} 组是同一件东西的不同版本 —— 已按「每组第一套」替你选好，点「一键安装」即可（想改就点「选择内容」）`
        : `包里有 ${n} 套内容，互不相关 —— 点「一键安装」全部装上`;
    }
    return '结构无法识别，需要手动指定安装位置';
  }
  if (t.status === 'failed' && t.error) return String(t.error).replace(/^安装失败：/, '');
  if (inst.requiresCns) return '需要先安装 CNS 才会生效';
  const r = inst.reason || '需要你确认后才能安装';
  return r.length > 40 ? r.slice(0, 38) + '…' : r;
}

/**
 * 「会被覆盖的文件」清单 —— 用户要求的核心。
 *
 * > 这种需要覆盖的情况要把被覆盖的文件列出来，点击后能在资源管理器里面显示出来；
 * > 要列出被替换的 mod 文件属于哪个 mod，是否为同一个 mod。
 *
 * 每行回答四件事：
 *   1. 是哪个文件（文件名 + 相对游戏根的路径）
 *   2. 现在多大 → 装进去多大（一样大 = 内容相同的同一个文件）
 *   3. 原来是谁装的（同一个 mod / 别的 mod / 不是 mod 装的）
 *   4. 点「定位」→ 在资源管理器里定位到它
 *
 * 2026-10-13 追加（用户要求「提供对比按钮，并列显示对应的已安装模组的信息，尤其是图片」）：
 *   5. 点「对比」→ 弹出左右对比框：**要装的新 Mod** vs **已装的那个 Mod**，
 *      各带封面/图集、名字、版本、作者、Mod ID、文件清单。
 *
 * ⚠️ 行元素从 `<button>` 改成 `<div>`：里面要塞两个真按钮（定位 / 对比），
 *    HTML 不允许 button 嵌套 button（浏览器会自动拆开，点击就错位）。
 *
 * @param {{total:number,shown:number,sameSizeCount:number,items:Array}} d
 * @param {{compact?:boolean}} [opts] `compact` 用在卡片上（只显示前 3 条 + 折叠）
 */
function conflictListHtml(d, opts = {}) {
  if (!d || !d.items || !d.items.length) return '';
  // 「对比」按钮要用「要装进去的那份」的 meta（名字 / 图集 / 版本 / 作者）——
  // 由调用方从当前上下文显式给（下载任务是 t.meta，安装确认是 plan 对应的 install.meta）。
  // ⚠️ 别在这里去猜 state：`state.modalTask` 存的是**任务 id 字符串**不是任务对象，
  //    曾经照着它取 `.meta` 永远拿到 undefined，对比框右侧整块都是「Mod #? / —」。
  if (opts.incoming) cmpIncomingMeta = opts.incoming;

  // ---- 对比入口：按**目标 mod** 去重 ----
  // 用户 2026-10-14：「这 3 个文件是一组 mod，只显示一个对比框即可，信息里面罗列 3 个文件即可」。
  // 同一组 mod 的 N 个文件（.pak / .ucas / .utoc）原来各挂一个**一模一样**的「对比」按钮
  // —— 3 行 3 个按钮，点哪个都是同一个对比框。改成：按目标去重、在列表顶部出一个入口，
  // 按钮上标出它会替换掉几个文件。行内不再放对比按钮。
  const tgtOf = (x) => {
    const owners = x.owners || (x.owner ? [x.owner] : []);
    return owners.filter(o => !o.isSelf)[0] || owners[0] || null;
  };
  const tgtMap = new Map();
  for (const x of d.items) {
    const tg = tgtOf(x);
    if (!tg || !tg.modId) continue;
    const k = String(tg.modId);
    if (!tgtMap.has(k)) {
      // 顺手把**已装那个 mod** 的版本 / 作者 / 封面一起带上（installFlow 里已经给了）——
      // 对比框左栏因此能立刻画出封面与版本作者，不用等按 modId 拉图回来
      // （用户 2026-10-14：「目前对比的功能显示不完整」，左栏只报了一个名字）。
      tgtMap.set(k, {
        modId: tg.modId, name: tg.name || '', n: 0,
        version: tg.version || '', author: tg.author || '', pictureUrl: tg.pictureUrl || ''
      });
    }
    tgtMap.get(k).n++;
  }
  const cmpBar = tgtMap.size
    ? `<div class="cfl-cmpbar">${[...tgtMap.values()].map(g => {
        const label = g.name || ('Mod #' + g.modId);
        // ⚠️ 文案拆成**三个独立的文本节点**，别拼成一句：i18n 是按文本节点整串查表的。
        //    · `<span>⇄ 对比</span>` —— 字典里有这条原文，能整串命中翻掉
        //    · `<span data-i18n-skip>` —— Mod 名是动态数据，不能被片段替换啃
        //    · `<span>（3 个文件）</span>` —— 靠字典里已有的「个文件」片段剥数字翻
        //    拼成一句「⇄ 与「X」对比（3 个文件）」的话整串查不到、片段替换又因
        //    残留中文被拒，非中文界面会整句留在中文。
        return `<button class="cfl-btn cmp" data-cmp="${esc(String(g.modId))}" data-cmp-name="${esc(g.name)}"
          data-cmp-ver="${esc(String(g.version || ''))}" data-cmp-author="${esc(g.author || '')}"
          data-cmp-pic="${esc(g.pictureUrl || '')}"
          title="和「${esc(label)}」做左右对比（图片 / 版本 / 作者 / 文件）"
          ><span>⇄ 对比</span><span data-i18n-skip>「${esc(clip(label, 20))}」</span>${
            g.n > 1 ? `<span>（${g.n} 个文件）</span>` : ''
          }</button>`;
      }).join('')}</div>`
    : '';

  const limit = opts.compact ? 3 : d.items.length;
  const rows = d.items.slice(0, limit).map(x => {
    // 归属：说清「原来是谁装的」「是不是同一个 mod」—— 用户明确要求的。
    // ⚠️ 同一路径可能被**多个** mod 登记（实测 minervha_master 那组被 4 个 mod 共用），
    //    所以渲染 owners 数组而不是单个 owner；只报一个会误导。
    const owners = x.owners || (x.owner ? [x.owner] : []);
    const others = owners.filter(o => !o.isSelf);
    // 版本号可能自带 `v`（注册表里就有 "v1.0"），别拼成 "vv1.0"
    const vtag = (o) => {
      const v = o && o.version ? String(o.version).trim() : '';
      if (!v) return '';
      return (/^v/i.test(v) ? ' ' : ' v') + esc(v);
    };
    let own;
    if (!owners.length) {
      own = `<em class="tag gray">不是 mod 装的</em><span>游戏原文件（或手动放进去的）</span>`;
    } else if (!others.length) {
      own = `<em class="tag self">同一个 mod</em><span>「${esc(owners[0].name)}」${vtag(owners[0])} 上次装的</span>`;
    } else {
      const names = others.slice(0, 3).map(o => `「${esc(o.name)}」${vtag(o)}`).join('、');
      const more = others.length > 3 ? ` 等 ${others.length} 个` : '';
      const mixed = owners.length > others.length ? '（其中也有你自己装的）' : '';
      own = `<em class="tag other">别的 mod</em><span>属于 ${names}${more}${mixed}</span>`;
    }
    // 大小对比：一样大 = 内容相同（installer 就是按这条判「软冲突」的）
    const size = (x.currentSize == null)
      ? '<span class="cfl-s">当前文件读不到</span>'
      : x.sameSize
        ? `<span class="cfl-s ok">${fmtSize(x.currentSize)} → 一样大（内容相同）</span>`
        : `<span class="cfl-s warn">${fmtSize(x.currentSize)} → ${x.incomingSize == null ? '?' : fmtSize(x.incomingSize)}（会被替换）</span>`;
    return `
      <div class="cfl-row" data-reveal-path="${esc(x.path)}" title="点「定位」在资源管理器中显示：${esc(x.path)}">
        <span class="cfl-top"><b>${esc(x.name)}</b>${size}</span>
        <span class="cfl-p">${esc(x.rel)}</span>
        <span class="cfl-o">${own}</span>
        <span class="cfl-act">
          <button class="cfl-btn" data-reveal-path="${esc(x.path)}" title="在资源管理器中显示">定位</button>
        </span>
      </div>`;
  }).join('');
  const more = d.items.length > limit
    ? `<div class="cfl-more">还有 ${d.items.length - limit} 个没显示（共 ${d.total} 个）</div>`
    : '';
  return `<div class="cflist">${cmpBar}${rows}${more}</div>`;
}

/** 从任务里取「会被覆盖的文件」清单 */
function conflictDetailsOf(t) {
  const p = t && t.install && t.install.plan;
  return (p && p.conflictDetails) || null;
}

/**
 * 已安装页顶部：「正在下载 / 安装」的实时条 —— 不用切页也能看到进度。
 *
 * ⚠️ **「待确认」不能混在「正在处理」里**：它是**等用户操作**的状态，
 * 给它配一个转圈的进度条，用户会以为程序卡死了（实测就是这么报上来的）。
 * 所以拆成两类：真正在跑的（转圈 + 进度条）和等确认的（说明 + 「去处理」按钮）。
 */
function liveStrip() {
  const all = state.downloads || [];
  const busy = all.filter(t => DL_BUSY.has(t.status));
  // ⚠️ 这里**刻意只显示「正在跑」的任务**（2026-10-14 用户要求）：
  //    「待确认 / 安装失败但包还在」这类**等用户操作**的任务不再列在已安装页 ——
  //    同一批任务在下载页已经有完整列表（带原因、带「一键安装 / 去处理」按钮），
  //    两个页面各列一遍，用户反而要在两处来回找、不知道该以哪个为准。
  //    已安装页的实时条只保留「不用切页也能看到进度」这一个价值。
  //    → 原因解释逻辑没丢，搬到了下载页（见 `taskWhy()` / `dlItem()`）。
  if (!busy.length) return '';

  const row = (t) => {
    const meta = t.meta || {};
    const st = DL_STATUS[t.status] || { t: t.status, c: 'run' };
    const label = esc(meta.name || ('Mod #' + (meta.modId || '?')));
    const pct = t.progress && t.progress.percent;
    const bar = pct == null
      ? '<div class="prog ind"><i></i></div>'
      : `<div class="prog"><i style="width:${pct}%"></i></div>`;
    return `<div class="li" data-live="${esc(t.id)}">
      <b>${label}</b>
      <span class="dl-st ${st.c}">${esc(st.t)}</span>
      ${bar}
      <span class="pct">${pct == null ? '' : pct + '%'}</span>
    </div>`;
  };

  return `
  <div class="live">
    <h4><span class="spin"></span> 正在处理 ${busy.length} 项</h4>
    ${busy.map(row).join('')}
  </div>`;
}

/**
 * 游戏目录写不进去时的顶部告警条。
 *
 * 数据来自 `game:inspect` 的 `writable`（主进程真的去写了一个临时文件试探）。
 * 与其让用户在「下载 → 安装」这一步看到一句裸 EPERM，不如一进页面就说清楚。
 */
function gameWriteBanner() {
  const w = state.game && state.game.writable;
  if (!w || w.ok) return '';
  return `<div class="callout" style="border-color:rgba(248,81,73,.45);background:rgba(248,81,73,.07)">
    <div class="hint" style="color:var(--red);line-height:1.75">⚠️ ${esc(w.message || '')}</div>
  </div>`;
}

/* ---------------- 已安装页：筛选 / 多选 / 批量操作 ---------------- */

/**
 * 启用状态筛选（单选）。`v` 是写进 `state.instFilters.state` 的值，空串 = 全部。
 *
 * 为什么不复用浏览页那套 chip：浏览页筛的是 Nexus 分类，这里筛的是**本地状态**
 * （装了但关掉的、根本没登记的），语义完全不同，混在一套里两边的“全部”会打架。
 */
const INST_STATE_FILTERS = [
  { v: '', label: '全部' },
  { v: 'on', label: '已启用' },
  { v: 'off', label: '已关闭' },
  { v: 'partial', label: '部分启用' },
  { v: 'unreg', label: '未登记' },
  { v: 'linked', label: '已关联' }
];

/**
 * 「有 bug」标记的筛选（2026-11-10 用户要求：
 * 「顶部筛选也加入对bug mod的筛选，提供不包含bug标记mod的功能」）。
 *
 * 和上面那排「启用状态」是**两回事**，所以单独一组按钮、可以叠加：
 *   - 状态那排是单选（一个 Mod 不可能既已启用又已关闭）；
 *   - 「有 bug」是独立的开关（用户可能想「只看有 bug 的」来清理，也可能想
 *     「不含 bug」来挑能装的），跟关键词、状态、类型都能同时生效。
 */
const INST_BUG_FILTERS = [
  { v: 'only', label: '有 bug', title: '只看标记过「有 bug」的 Mod' },
  { v: 'none', label: '不含 bug', title: '把标记过「有 bug」的 Mod 藏起来' }
];

/** 这个分组是不是被用户标过「有 bug」（没 modId 的本地文件永远不算） */
function installedIsBug(g) {
  const ids = state.bugIds;
  if (!g || !g.modId || !ids || typeof ids.has !== 'function') return false;
  return ids.has(String(g.modId));
}

/**
 * 一个分组是否命中当前筛选（纯函数）。
 * 关键词同时匹配**卡片名 / Mod ID / 作者** —— 用户手上通常只记得其中一个。
 */
function installedGroupMatches(g) {
  const f = state.instFilters || {};
  if (f.q) {
    const q = String(f.q).trim().toLowerCase();
    if (q) {
      const meta = g.meta || {};
      const src = meta.source || {};
      // 除了卡片名 / Mod ID / 作者，还把**磁盘上的文件名**算进来 —— 用户经常只记得
      // 「那个 .pak 叫什么」或者包里带着 `[nx4102]` 这样的标识，光搜卡片名搜不到。
      const extra = [];
      for (const m of g.items || []) {
        for (const v of [m.name, m.rel, m.file, m.tag ? 'nx' + m.tag : '']) {
          if (v) extra.push(String(v));
        }
      }
      // 只用 `g.kind` 这个原始值：这个函数被探针整段抠出来单跑（见 instbatch-test），
      // 不引用外部的 KIND_LABEL，免得复制出去就抛 ReferenceError。
      if (g.kind) extra.push(g.kind);
      const hay = [
        g.name || '',
        g.modId ? String(g.modId) : '',
        g.modId ? '#' + g.modId : '',
        meta.author || src.author || '',
        meta.name || src.modName || '',
        extra.join(' ')
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  const s = f.state || '';
  if (s === 'on' && !(g.enabled && !g.partial)) return false;
  if (s === 'off' && g.enabled) return false;
  if (s === 'partial' && !g.partial) return false;
  // 「未登记」不含内置组件：UE4SS 自带的脚本本来就没有 Nexus 来源，混进来只会碍事
  if (s === 'unreg' && (g.registered || g.builtin)) return false;
  if (s === 'linked' && !(g.linked && !g.registered)) return false;
  // 「有 bug」这组可以跟状态叠加：only = 只看标过的，none = 把标过的藏掉。
  // 这里刻意不调用 installedIsBug()：本函数会被探针整段抠出去单跑，外部引用会 ReferenceError。
  const bf = f.bug || '';
  if (bf) {
    const ids = state.bugIds;
    const isBug = !!(g.modId && ids && typeof ids.has === 'function' && ids.has(String(g.modId)));
    if (bf === 'only' && !isBug) return false;
    if (bf === 'none' && isBug) return false;
  }
  if (f.kind && g.kind !== f.kind) return false;
  return true;
}

/** 类型下拉的选项：取当前列表里真实出现过的类型，避免列一堆 0 个的条目 */
function installedKindOptions() {
  const seen = [];
  for (const g of state.installedGroups || []) {
    if (g.kind && !seen.includes(g.kind)) seen.push(g.kind);
  }
  return seen.map(k => ({ v: k, label: KIND_LABEL[k] || k }));
}

function installedFilterRowHtml() {
  const f = state.instFilters || { q: '', state: '', kind: '', bug: '' };
  const chips = INST_STATE_FILTERS.map(s =>
    `<button data-istate="${esc(s.v)}" class="${(f.state || '') === s.v ? 'on' : ''}">${esc(s.label)}</button>`
  ).join('');
  const bugCount = (state.installedGroups || []).filter(installedIsBug).length;
  const bf = f.bug || '';
  const bugChips = INST_BUG_FILTERS.map(s =>
    `<button data-ibug="${esc(s.v)}" class="bugtool${bf === s.v ? ' on' : ''}" title="${esc(s.title)}">${esc(s.label)}${s.v === 'only' && bugCount ? `（${bugCount}）` : ''}</button>`
  ).join('');
  const kinds = [{ v: '', label: '全部类型' }].concat(installedKindOptions()).map(o =>
    `<option value="${esc(o.v)}"${(f.kind || '') === o.v ? ' selected' : ''}>${esc(o.label)}</option>`
  ).join('');
  return `<div class="sortgrp ifilter">
    <div class="search" id="instSearchBox"><input id="instSearch" type="search" placeholder="搜索已安装的 Mod（名字 / Mod ID / 作者）" value="${esc(f.q || '')}"></div>
    <div class="tabs" id="instState">${chips}</div>
    <div class="tabs" id="instBug">${bugChips}</div>
    <select id="instKind" title="按类型筛选">${kinds}</select>
  </div>`;
}

/** 多选那一排按钮：只在多选模式里出现，按钮上的数字跟着勾选数走 */
function installedBatchRowHtml() {
  const on = state.gsel.on;
  const n = state.gsel.ids.size;
  const keys = gselVisibleKeys();
  const allOn = keys.length > 0 && keys.every(k => state.gsel.ids.has(k));
  const cnt = `（${n}）`;   // 数字恒显示（0 也显示）：形状键只有一种，翻译不必为「无数字」再备一套
  const dis = n ? '' : ' disabled';
  return `<div class="sortgrp" id="instBatch">
    <button class="btn sm${on ? ' on' : ''}" data-gbatch-mode="1">${on ? '完成' : '多选'}</button>
    ${on ? `<button class="btn sm" data-gbatch-all="1">${allOn ? '取消全选' : '全选'}</button>` : ''}
    ${on ? `<button class="btn sm" data-gbatch-on="1"${dis}>批量启用${cnt}</button>` : ''}
    ${on ? `<button class="btn sm" data-gbatch-off="1"${dis}>批量关闭${cnt}</button>` : ''}
    ${on ? `<button class="btn sm d" data-gbatch-del="1"${dis}>批量删除${cnt}</button>` : ''}
  </div>`;
}

/** 当前可见（筛选之后）的分组键 —— 全选 / 「是否已全选」都以它为准 */
function gselVisibleKeys() {
  return (state.installedShown || []).map(g => g.key);
}

function gselSelected() {
  return (state.installedGroups || []).filter(g => state.gsel.ids.has(g.key));
}

/** 勾选一个分组（手动勾选不影响「全选」语义 —— 这里没有跨批次追加，不需要 all 标记） */
function gselToggle(key) {
  if (state.gsel.ids.has(key)) state.gsel.ids.delete(key); else state.gsel.ids.add(key);
  gselSyncCard(key);
  gselUpdateBar();
}

/** 已安装页多选：Shift 连选 / Ctrl 单张 —— 与浏览页同一套语义（用户 2026-11-10） */
function gselClick(key, e) {
  const k = String(key);
  if (e && e.shiftKey && gselRangeTo(k, !!(e.ctrlKey || e.metaKey))) return;
  gselToggle(k);
  state.gsel.anchor = k;
}

/** 已安装页当前屏幕上的分组键（连选按看到的顺序） */
function gselOrderKeys() {
  return Array.from(document.querySelectorAll('#installedArea .card[data-gid]'))
    .map(c => c.dataset.gid);
}

function gselRangeTo(key, additive) {
  const keys = gselOrderKeys();
  const to = keys.indexOf(String(key));
  if (to < 0) return false;
  const at = keys.indexOf(String(state.gsel.anchor || ''));
  if (at < 0) {
    gselToggle(key);
    state.gsel.anchor = String(key);
    return true;
  }
  if (!additive) state.gsel.ids.clear();
  const a = Math.min(at, to);
  const b = Math.max(at, to);
  for (let i = a; i <= b; i++) state.gsel.ids.add(keys[i]);
  gselSyncAll();
  gselUpdateBar();
  return true;
}

/** 全选 / 取消全选：只作用于**当前筛选出来的**那些卡片 */
function gselSelectAll() {
  const keys = gselVisibleKeys();
  if (!keys.length) return;
  const allOn = keys.every(k => state.gsel.ids.has(k));
  if (allOn) state.gsel.ids.clear();
  else for (const k of keys) state.gsel.ids.add(k);
  state.gsel.anchor = null;   // 全选后锚点消失
  gselSyncAll();
  gselUpdateBar();
}

function gselCardOf(key) {
  return document.querySelector(`#installedArea .card[data-gid="${cssEsc(key)}"]`);
}

/** 单张卡片的勾选外观（不重画卡片：重画会让封面重新解码、滚动位置跳） */
function gselSyncCard(key) {
  const card = gselCardOf(key);
  if (!card) return;
  const on = state.gsel.ids.has(key);
  card.classList.toggle('sel', on);
  const ck = card.querySelector('.ck');
  if (ck) ck.classList.toggle('on', on);
}

function gselSyncAll() {
  for (const card of $$('#installedArea .card')) {
    const key = card.dataset.gid;
    if (!key) continue;
    const on = state.gsel.ids.has(key);
    card.classList.toggle('sel', on);
    const ck = card.querySelector('.ck');
    if (ck) ck.classList.toggle('on', on);
  }
}

/** 进入 / 退出多选模式（退出时清空勾选）；封面上的复选框由 body.sel 控制显隐 */
function gselSetMode(on) {
  state.gsel.on = !!on;
  if (!state.gsel.on) { state.gsel.ids.clear(); state.gsel.anchor = null; }
  syncSelBodyClass();
  gselSyncAll();
  gselUpdateBar();
}

/** 两个页面共用 body 上的 `sel` 类 —— 谁进多选模式谁点亮，都退出才熄灭 */
function syncSelBodyClass() {
  document.body.classList.toggle('sel', !!(state.sel.on || state.gsel.on));
}

/** 只重画多选那一排按钮（文案 / 数字 / 显隐都跟着勾选数变） */
function gselUpdateBar() {
  const host = document.querySelector('#installedArea #instBatch');
  if (!host) return;
  const box = document.createElement('div');
  box.innerHTML = installedBatchRowHtml();
  const next = box.firstElementChild;
  if (next) host.replaceWith(next);
}

/**
 * 批量启用 / 关闭选中的 Mod。
 *
 * 逐文件调 `mods:setEnabled`（主进程就是这么工作的：pak 改后缀、脚本改 mods.txt），
 * 已经在目标状态的文件直接跳过 —— 470 个文件全发一遍请求既慢又会让日志刷屏。
 * 前置组件不吃开关（主进程会抛「前置组件不支持禁用」），这里先剔掉。
 */
async function gselBatchToggle(target, groupsArg) {
  if (state.gsel.busy) return;
  const groups = Array.isArray(groupsArg) ? groupsArg : gselSelected();
  if (!groups.length) { toast('先勾选要处理的 Mod'); return; }
  state.gsel.busy = true;
  let mods = 0, failed = 0;
  // 把「为什么没改成功」带出来 —— 只报个数的话用户无从下手
  // （2026-11-10 用户报「批量关闭有一部分出错」，界面上只有一句「有 N 个文件没能改过来」）。
  const failedWhy = [];
  try {
    for (const g of groups) {
      let touched = false;
      for (const m of (g.items || [])) {
        if (m.kind === 'prereq') continue;
        if (!!m.enabled === !!target) continue;
        try {
          await call(window.api.mods.setEnabled(m.id, !!target), { silent: true });
          touched = true;
        } catch (e) {
          failed++;
          if (failedWhy.length < 3) failedWhy.push(`${g.name || m.name || m.id}${e && e.message ? '（' + e.message + '）' : ''}`);
        }
      }
      if (touched) mods++;
    }
  } finally {
    state.gsel.busy = false;
  }
  toast(target ? `已启用 ${mods} 个 Mod` : `已关闭 ${mods} 个 Mod`, failed ? 'err' : 'ok');
  if (failed) toast(`有 ${failed} 个文件没能改过来`, 'err');
  // 光报个数没用 —— 把前几个失败原因带出来（用户 2026-11-10 报「批量关闭有一部分出错」时，
  // 界面上只有一句「有 N 个文件没能改过来」，完全看不出是哪个 mod、为什么）。
  if (failed && failedWhy.length) toast('没改成功的原因：' + failedWhy.join('；'), 'err');
  state.gsel.ids.clear();
  await refreshAll();
}

/**
 * 批量删除选中的 Mod。
 *
 * 走的是和单张卡片「卸载」完全一样的通路（`mods:uninstall { purge:false }`）：
 * 文件被移动到 `data\backup\uninstalled\`，不是真的抹掉，后悔还能捡回来。
 * 内置组件（UE4SS 自带脚本）跳过 —— 删了没法恢复。
 */
async function gselBatchUninstall(groupsArg) {
  if (state.gsel.busy) return;
  const groups = Array.isArray(groupsArg) ? groupsArg : gselSelected();
  if (!groups.length) { toast('先勾选要处理的 Mod'); return; }
  const usable = groups.filter(g => !g.builtin);
  const skippedBuiltin = groups.length - usable.length;
  if (!usable.length) { toast('内置组件不能卸载，请取消勾选后再试'); return; }
  const items = usable.flatMap(g => (g.items || []).filter(m => m.kind !== 'prereq'));
  if (!items.length) return;
  const files = items.flatMap(m => m.files || []);
  const okDel = confirm(
    `确定删除这 ${usable.length} 个 Mod 吗？\n\n` +
    `将移除 ${items.length} 个已装文件（共 ${files.length} 个文件）：\n` +
    files.slice(0, 8).map(f => '  · ' + f.name).join('\n') +
    (files.length > 8 ? `\n  … 等共 ${files.length} 个` : '') +
    (skippedBuiltin ? `\n\n另有 ${skippedBuiltin} 个是内置组件，不会动。` : '') +
    `\n\n文件不会直接删除，而是移动到：\n  data\\backup\\uninstalled\\\n可以手动找回。`
  );
  if (!okDel) return;
  state.gsel.busy = true;
  let done = 0, failed = 0;
  try {
    for (const m of items) {
      try {
        await call(window.api.mods.uninstall(m.id, { purge: false }), { silent: true });
        done++;
      } catch { failed++; }   // 单条失败不中断，最后统一报数
    }
  } finally {
    state.gsel.busy = false;
  }
  toast(`已删除 ${done} 个 Mod`, failed ? 'err' : 'ok');
  if (failed) toast(`有 ${failed} 个文件没能删掉`, 'err');
  state.gsel.ids.clear();
  await refreshAll();
}

function renderInstalled() {
  const area = $('#installedArea');
  if (!state.game || !state.game.found) {
    state.installedGroups = [];
    area.innerHTML = emptyNoGame();
    return;
  }
  if (!state.installed.length) {
    state.installedGroups = [];
    area.innerHTML = liveStrip() + gameWriteBanner() + `
      <div class="empty">
        <h3>还没有检测到任何 Mod</h3>
        <p>已安装的 Pak 模组会出现在 <code>SB\\Content\\Paks\\~Mods\\</code>，脚本模组会出现在
        <code>SB\\Binaries\\Win64\\ue4ss\\Mods\\</code>。去「浏览 Mod」页挑一个试试。</p>
        <button class="btn p" onclick="switchPage('p-browse')">去浏览 Mod</button>
      </div>`;
    return;
  }
  // UE4SS 自带的脚本模组默认折叠，避免淹没用户真正安装的 Mod
  const builtinScripts = state.installed.filter(m => m.builtin && m.kind === 'script');
  const visible = state.showBuiltin
    ? state.installed
    : state.installed.filter(m => !(m.builtin && m.kind === 'script'));

  // 先把「同一个 Nexus Mod 的多个文件」并成一张卡，再排序。
  // 用户 2026-10-14：合并显示 + 默认按安装时间倒序 + 可切换排序。
  state.installedGroups = groupInstalled(visible);
  // ⚠️ 筛选**不在这里**做（见 applyInstSearch）：一行卡片是一个 Mod，不是磁盘上的
  // 一个文件，所以「未登记 / 已关联 / 已启用」这些判断都按整组算，但筛选结果只切
  // 卡片 class，不重建 DOM。排序仍作用在全部分组上 —— 筛选只决定谁可见，不改相对顺序。
  const sorted = state.installedGroups
    .slice()
    .sort((a, b) => compareInstalled(a, b, state.installedSort, state.installedSortDir));

  // 排序条：选中的那个按钮带一枚方向箭头（↑ 正序 / ↓ 倒序），右侧那颗按钮专门翻转方向。
  // 再点一次**当前排序名**也能翻转 —— 表格表头的习惯，顺手。
  const desc = state.installedSortDir === 'desc';
  const arrow = desc ? '↓' : '↑';
  const sortBar = `<div class="sortgrp">
    <div class="tabs" id="instSort" title="排序方式">
      ${INSTALLED_SORTS.map(s => {
        const on = state.installedSort === s.value;
        // ⚠️ 箭头必须放在**独立元素**里：i18n 按文本节点整串查表，
        // 写成 `${label}${arrow}` 会拼成「安装时间 ↓」，表里没这条 → 整串不翻译。
        return `<button data-isort="${esc(s.value)}" class="${on ? 'on' : ''}" title="${
          esc(s.title)
        }">${esc(s.label)}${on ? `<span class="dir">${arrow}</span>` : ''}</button>`;
      }).join('')}
    </div>
    <button class="btn sm" data-isortdir="1" title="切换正序 / 倒序（也可以再点一次排序名）"><span class="dir">${
      arrow
    }</span><span>${desc ? '倒序' : '正序'}</span></button>
  </div>`;

  const toggleRow = builtinScripts.length
    ? `<button class="btn sm" data-showbuiltin="1">${
        state.showBuiltin ? '隐藏' : '显示'
      } UE4SS 自带的 ${builtinScripts.length} 个内置脚本模组</button>`
    : '';

  // 筛选结果为空时的提示块**始终渲染**（默认 hidden），由 applyInstSearch 显隐。
  // 早期版本是「筛空了就整块重画成空态」，那样每敲一个字都可能重建 DOM。
  area.innerHTML = liveStrip()
    + gameWriteBanner()
    + `<div class="ibar">${installedFilterRowHtml()}${sortBar}${installedBatchRowHtml()}${toggleRow}</div>`
    + `<div class="grid">${sorted.map(installedCard).join('')}</div>`
    + `<div class="empty" id="instEmpty" hidden>
        <h3>没有符合筛选条件的 Mod</h3>
        <p>换个关键词，或者把筛选清掉看看。</p>
        <button class="btn sm" data-iclear="1">清空筛选</button>
      </div>`;

  // 重画后把勾选外观补上（筛选切换不会清空选择，勾过的卡片回来还是勾着的）
  gselSyncAll();
  gselUpdateBar();

  // 计数口径：**合并后的卡片数**（= Mod 数），不是磁盘上的条目数。
  // 否则「侧栏 258 / 列表 240 张卡」这种对不上的数字会让人以为是漏显示了。
  applyInstSearch();
}

/**
 * 就地应用筛选（关键词 / 状态 / 类型）：只给卡片切 `inst-hid`，不重建 DOM。
 *
 * 为什么不重画：已安装页动辄四五百张卡，`area.innerHTML = …` 重建一次要一秒上下，
 * 而**输入框本身就在被重建的那棵子树里** —— 用户敲第二个字时输入框已经换了新节点，
 * 焦点和光标一起丢，表现就是「已安装页不支持文字搜索」。这里改成纯 class 切换：
 * 输入框、封面、滚动位置全都不动，打字跟手，勾选外观也不用再同步回来。
 */
function applyInstSearch() {
  const byKey = new Map((state.installedGroups || []).map(g => [g.key, g]));
  const shown = [];
  let enabled = 0;
  for (const card of $$('#installedArea .card[data-gid]')) {
    const g = byKey.get(card.dataset.gid);
    const hit = !!(g && installedGroupMatches(g));
    card.classList.toggle('inst-hid', !hit);
    if (hit) {
      shown.push(g);
      if (g.enabled && !g.partial) enabled++;
    }
  }
  // 全选 / 「是否已全选」以**可见项**为准（gselVisibleKeys 读这个）
  state.installedShown = shown;
  const empty = $('#instEmpty');
  if (empty) empty.hidden = shown.length > 0;
  const total = (state.installedGroups || []).length;
  // 有筛选时显示「筛选自 N 项」，免得人以为 Mod 丢了。
  $('#sub').textContent = `共 ${shown.length} 项 · ${enabled} 个已启用${
    shown.length !== total ? `（筛选自 ${total} 项）` : ''
  }`;
  gselUpdateBar();
  syncInstalledNav();
}

/** 翻转已安装页的排序方向并重画（点方向按钮、或再点一次当前排序名都走这里） */
function toggleInstalledSortDir() {
  state.installedSortDir = state.installedSortDir === 'desc' ? 'asc' : 'desc';
  renderInstalled();
  saveFilters();
}

/**
 * 侧栏「已安装 Mod」计数 —— 与列表**同一口径**（合并后的 Mod 数，不计 UE4SS 内置脚本）。
 * 每次都从 `state.installed` 现算，不受「显示/隐藏内置脚本」开关影响。
 */
function syncInstalledNav() {
  const el = $('#navCountInstalled');
  if (!el) return;
  const gs = groupInstalled(state.installed).filter(g => !g.builtin);
  el.textContent = gs.length;
}

function emptyNoGame() {
  const cands = (state.game && state.game.candidates) || [];
  return `
    <div class="empty">
      <h3>没有找到剑星游戏目录</h3>
      <p>需要指向包含 <code>SB\\Binaries\\Win64\\SB-Win64-Shipping.exe</code> 的目录。
      ${cands.length ? '下面是自动探测到的候选路径：' : '请在「设置」里手动填写。'}</p>
      ${cands.length ? `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:14px">
        ${cands.map(c => `<button class="btn sm" data-setroot="${esc(c)}">使用 ${esc(c)}</button>`).join('')}
      </div>` : ''}
      <button class="btn p" onclick="switchPage('p-settings')">去设置游戏目录</button>
    </div>`;
}

/* ---------------- 已安装详情抽屉 ---------------- */

/**
 * 「原压缩包」区块 —— 用户要求：
 * 「提供 library 中的原压缩包的链接，点击后直接在资源管理器中定位压缩包」。
 *
 * 三种情况都要**如实说**，不能给一个点了没反应的链接：
 *   1. 还在 `data/library/` 里        → 文件名 + 「在资源管理器中定位」
 *   2. 还在、但不在 library（手动导入）→ 同样给定位按钮，但注明「不在内置库」
 *   3. 已经不在磁盘上了               → 按钮置灰，把原路径写出来（用户自己去找/重下）
 *
 * 路径来自主进程 `scanner.archiveInfo()`（每次扫描都重新 stat），
 * 所以这里拿到的 `exists` 是**当下**的真实情况。
 */
function archiveBlockHtml(m) {
  const a = m && m.archive;
  if (!a) {
    return `<div class="lbl">原压缩包</div>
      <div class="txt" style="color:var(--dim2)">没有安装包记录（这是磁盘上扫描到的模组，不是本程序装的）。</div>`;
  }
  const btn = a.exists
    ? `<button class="btn sm" data-reveal-path="${esc(a.path)}" title="在资源管理器中定位：${esc(a.path)}">在资源管理器中定位</button>`
    : `<button class="btn sm" disabled title="文件已不在：${esc(a.path)}">文件已不在</button>`;
  const note = a.exists
    ? (a.inLibrary
      ? `来自内置库 <code>data/library/</code> · ${fmtSize(a.size)}`
      : `不在内置库 <code>data/library/</code> 里（当时是手动导入的）· ${fmtSize(a.size)}`)
    : `文件已不在这个位置（可能被删除或移动了）：${esc(a.path)}`;
  return `<div class="lbl">原压缩包</div>
    <div class="urlbox">
      <span class="arcnm${a.exists ? '' : ' gone'}" title="${esc(a.path)}">${esc(a.name)}</span>
      ${btn}
    </div>
    <div class="txt" style="color:var(--dim2);font-size:11.5px;margin-top:6px">${note}</div>`;
}

/** pak mod 的附属文件后缀：`.pak` 本体之外还有 `.ucas` / `.utoc` 两个索引，展示时挑 `.pak` */
const FILE_AUX_EXT = /\.(ucas|utoc)$/i;

/**
 * 「已安装的文件」每行显示的**名字** —— 必须是磁盘上的实际文件名。
 *
 * 为什么不能用 `it.name`：`scanner.js` 里 pak 组的 `name` 被注册表的 `reg.name`
 * （Nexus 上的 Mod 名）覆盖了 —— 同一个 Mod 装了**两个不同文件**时，两行会显示成
 * 同一个 Nexus 名，用户根本分不清哪行是哪个（2026-10-14 用户截图：
 * 「多组文件的名称一致，无法区分，要根据实际的文件名显示」）。
 * 实际文件名一直在 `it.files[].name` 里（如 `Captain EVE (CNS compatible).pak`）。
 *
 * 前置组件（`kind === 'prereq'`）例外：它不是「用户装的包」，没有多文件重名问题，
 * 而 `files[0].name` 是 `dwmapi.dll` 这种零件名 —— 显示「UE4SS」才有意义。
 */
function installedFileName(it) {
  if (!it) return '';
  if (it.kind === 'prereq') return it.name || '';
  const files = ((it.files) || []).filter(f => f && f.name);
  if (!files.length) return it.name || '';
  // ⚠️ 禁用状态下的磁盘文件名是 `X.pak.disabled` —— 必须先剥掉尾巴再判扩展名，
  // 否则 `.pak$` 匹配不上、反而可能挑中 `X.ucas.disabled` 当主文件。
  const bare = f => String(f.name).replace(/\.disabled$/i, '');
  const main = files.find(f => /\.pak$/i.test(bare(f)))
    || files.find(f => !FILE_AUX_EXT.test(bare(f)))
    || files[0];
  // script mod 的 `files[0].name` 是目录名（结尾带 `/`），去掉更顺眼；
  // 也**不带** `.disabled` —— 那行的「已禁用」标记已经说清楚了，不必再占字符。
  return bare(main).replace(/\/+$/, '');
}

/**
 * 「已安装的文件」逐条列表 —— 一个 Nexus Mod 装了多个文件时才真正有用。
 *
 * 用户 2026-10-14：「多个同 mod id 的不同模组文件合并显示…点击单个 mod，
 * 可以看到不同模组文件」，并在追问里选了「**抽屉里逐文件可操作**」。
 *
 * 所以这里不是只读清单：每行右侧两个按钮（启用/禁用、卸载）都带
 * `data-iid`（= 那一条 installed 项自己的 id），主进程的
 * `mods:setEnabled` / `mods:uninstall` 本来就是**按单条 id** 定位的
 * （重新扫描后 `list.find(m => m.id === id)`），所以逐文件操作不需要改主进程。
 *
 * ⚠️ 前置组件（`kind === 'prereq'`）不给开关和卸载：`setEnabled` 会直接抛
 *    「前置组件不支持禁用」，`uninstall` 对没有回滚清单的前置也会拒绝。
 *    与其给两个点了就报错的按钮，不如如实说明。
 */
function installedFilesHtml(g) {
  const items = (g && g.items) || [];
  if (!items.length) return '';

  const rows = items.map(it => {
    const src = (it.meta && it.meta.source) || {};
    const fileId = src.fileId ? String(src.fileId) : '';
    const ver = (it.meta && it.meta.version) || src.version || '';
    const shown = installedFileName(it);
    const sub = [
      KIND_LABEL[it.kind] || it.kind,
      ver ? verText(ver) : '',
      fileId ? ('文件 ' + fileId) : '',
      fmtSize(it.size),
      it.mtime ? fmtDate(it.mtime) : ''
    ].filter(Boolean).join(' · ');

    const st = it.enabled
      ? '<span class="dl-st ok">已启用</span>'
      : '<span class="dl-st dim">已禁用</span>';

    const acts = it.kind === 'prereq'
      ? `<span class="fli-note">前置组件，不可单独禁用或卸载</span>`
      : `<button class="btn sm" data-iid="${esc(it.id)}" data-iact="toggle" title="${
          it.enabled ? '把这个文件重命名为 .disabled' : '去掉 .disabled 后缀恢复启用'
        }">${it.enabled ? '禁用' : '启用'}</button>
         <button class="btn sm d" data-iid="${esc(it.id)}" data-iact="uninstall" title="移除这个文件（移到 data\\backup\\uninstalled\\，可找回）">卸载</button>`;

    return `<div class="fli${it.enabled ? '' : ' off'}">
      <div class="fli-main">
        <div class="fli-name" data-i18n-skip title="${esc(shown)}">${esc(shown)} ${st}</div>
        <div class="fli-sub">${esc(sub)}</div>
      </div>
      <div class="fli-act">${acts}</div>
    </div>`;
  }).join('');

  const head = items.length > 1
    ? `已安装的文件（${items.length} 个，可逐个操作）`
    : '已安装的文件';

  return `<div class="lbl">${head}</div>
    <div class="flist">
      ${rows}
      ${g.location ? `<div class="fli-sub" style="margin-top:6px">位置：${esc(g.location)}</div>` : ''}
    </div>`;
}

/**
 * 已安装 Mod 的详情抽屉。
 *
 * 参数是**组对象**（`groupInstalled()` 的产出）：一个 Mod 装了多个文件时，
 * 「文件清单」升级成「已安装的文件」逐条列表，每条能单独启用 / 禁用 / 卸载
 * （用户 2026-10-14：「合并显示…点击单个 mod，可以看到不同模组文件」）。
 * 组对象与单个 installed 项**同形**，所以下面沿用 `m` 这个名字，改动最小。
 */
function openInstalledDrawer(g) {
  const m = g;
  const meta = m.meta || {};
  const src = meta.source || {};
  const imgs = cachedImagesOf(meta);
  const img = meta.image || '';
  const srcModId = Number(g.modId || src.modId || meta.modId || 0) || 0;
  // 来源网址：安装时记下的优先，其次链接记录里的，最后按 Mod ID 拼一个 Nexus 页面。
  // 三条都试不出来（连 modId 都没有）才算「未知来源」。
  const srcUrlRecorded = String(meta.url || meta.sourceUrl || (m.link && m.link.url) || '');
  const srcUrl = srcUrlRecorded || (srcModId ? `https://www.nexusmods.com/stellarblade/mods/${srcModId}` : '');
  const srcUrlGuessed = !srcUrlRecorded && !!srcModId;
  state.drawer = { open: true, kind: 'installed', mod: m, lang: 'zh', translated: null, translating: false, files: [] };

  $('#dTitle').textContent = m.name;
  $('#dSub').textContent = [meta.nameZh, verText(meta.version), meta.author].filter(Boolean).join(' · ')
    || KIND_LABEL[m.kind] || '';

  // 关联出来的条目没有 meta.summary（那栏是管理器安装时才写的），
  // 但「批量解析」把 Nexus 的简介存在 meta.source.summary 里，这里一并取用。
  const desc = meta.description || meta.summary || src.summary || '';
  const zhText = meta.descriptionZh || meta.summaryZh || '';

  $('#dBody').innerHTML = `
    <div id="galleryBox">${imgs.length
      ? imageGrid(imgs)
      : (img ? `<img class="hero" src="${esc(img)}" alt="" onerror="this.style.display='none'">` : '')}</div>
    <div class="lbl">说明</div>
    ${desc || zhText ? `
      <div class="langsw">
        <button class="${state.drawer.lang === 'zh' ? 'on' : ''}" data-lang="zh" title="翻译成中文后显示在这里">中文</button>
        <button class="${state.drawer.lang === 'en' ? 'on' : ''}" data-lang="en" title="Nexus 上的原文（无论英文中文）">English</button>
      </div>
      <div class="txt" id="descBox">${renderDesc(m, desc, zhText)}</div>`
      : `<div class="txt" style="color:var(--dim2)">该 Mod 没有登记说明文字。${m.registered || m.linked ? '' : '（这是磁盘上扫描到的模组，尚未通过管理器安装，因此没有来源信息）'}</div>`}

    <div class="lbl">来源</div>
    ${srcUrl
      ? `<div class="urlbox">
           <a href="#" class="srclink" data-openurl="${esc(srcUrl)}" title="在浏览器里打开这个 Mod 的 Nexus 页面">${esc(srcUrl)}</a>
           <button class="btn sm" data-openurl="${esc(srcUrl)}">打开</button>
         </div>
         ${srcUrlGuessed
           ? '<div class="txt" style="color:var(--dim2)">这个地址是按 Mod ID 拼出来的 Nexus 页面（安装时没记下原网址）。</div>'
           : ''}
         ${m.linked
           ? (m.link && m.link.matchedBy === 'tag'
             ? '<div class="txt" style="color:var(--dim2)">上面这个来源来自文件名里的标识 —— 安装时就写在名字上了，不是按名字猜的。</div>'
             : '<div class="txt" style="color:var(--dim2)">上面这个来源是「批量解析」按名字比对出来的，文件本身不是通过管理器安装的 —— 如果对错了，点下面的「解除关联」即可。</div>')
           : ''}`
      : `<div class="txt" style="color:var(--dim2)">未知来源（非管理器安装，也没有 Mod ID 可以拼 Nexus 地址）</div>`}

    <div class="lbl">信息</div>
    <div class="kv"><span>类型</span><span>${KIND_LABEL[m.kind] || m.kind}${m.builtin ? '（内置）' : ''}</span></div>
    ${srcModId ? `<div class="kv"><span>Mod ID</span><span>#${srcModId}${src.fileId
      ? `<span style="color:var(--dim2)"> · 文件 ${esc(String(src.fileId))}</span>` : ''}</span></div>` : ''}
    <div class="kv"><span>状态</span><span style="color:${m.enabled ? 'var(--ok)' : 'var(--dim)'}">${
      g.partial ? '部分启用' : (m.enabled ? '已启用' : '已禁用')
    }</span></div>
    <div class="kv"><span>位置</span><span>${esc(m.location)}</span></div>
    <div class="kv"><span>文件数</span><span>${m.fileCount}</span></div>
    <div class="kv"><span>占用</span><span>${fmtSize(m.size)}</span></div>
    <div class="kv"><span>修改时间</span><span>${fmtDate(m.mtime)}</span></div>
    ${g.enabledAt ? `<div class="kv"><span>开启时间</span><span data-i18n-skip>${esc(fmtWhen(g.enabledAt))}${g.enabledAtGuess ? '（按安装时间推算）' : ''}</span></div>` : ''}
    <div class="kv"><span>登记状态</span><span>${m.registered
      ? '已登记（含来源信息）'
      : (m.linked ? '未登记 · 已关联 Nexus 来源' : '未登记（磁盘扫描发现）')}</span></div>

    ${archiveBlockHtml(m)}

    ${installedFilesHtml(g)}
  `;

  // 底部按钮作用于**整组**（这个 Mod 装的全部文件）。
  // 单个文件的操作在上面 `installedFilesHtml()` 的每一行里。
  const n = (g.items || []).length;
  const multi = n > 1;
  const footToggle = g.partial ? '全部启用' : (g.enabled ? '全部禁用' : '全部启用');
  $('#dFoot').innerHTML = `
    <button class="btn" data-reveal="${esc(m.id)}">打开所在文件夹</button>
    ${srcUrl
      ? `<button class="btn" data-openurl="${esc(srcUrl)}" title="在浏览器里打开这个 Mod 的 Nexus 页面">🌐 打开 Mod 网页</button>`
      : ''}
    ${m.archive && m.archive.exists
      ? `<button class="btn" data-reveal-path="${esc(m.archive.path)}" title="在资源管理器中定位原压缩包：${esc(m.archive.path)}">📦 定位原压缩包</button>`
      : ''}
    ${m.linked
      ? `<button class="btn" data-gunlink="${esc(g.key)}" title="只忘掉「它是 Nexus 上的哪个 Mod」，磁盘文件一个都不动">解除关联</button>`
      : ''}
    ${m.kind !== 'prereq' ? `
      <button class="btn" data-gtoggle="${esc(g.key)}" title="${multi
        ? '作用于这个 Mod 已安装的全部 ' + n + ' 个文件' : '重命名文件以启用 / 禁用'}">${
        multi ? footToggle : (m.enabled ? '禁用' : '启用')}</button>
      <button class="btn d" data-guninstall="${esc(g.key)}" title="${
        multi ? '逐个移除这 ' + n + ' 个文件' : '移除这个文件'
      }">${multi ? '卸载这个 Mod' : '卸载'}</button>` : ''}
    ${srcModId ? `<button class="btn bug" data-gbug="${esc(g.key)}" title="${
      state.bugIds.has(String(srcModId))
        ? '点一下取消标记（之后批量安装不会再提示）'
        : '打个记号：这个 Mod 装了会出问题。浏览页照常显示，批量安装前会先问你跳过它'
    }">${state.bugIds.has(String(srcModId)) ? '⚠ 已标有 bug' : '⚠ 标为有 bug'}</button>` : ''}
    ${srcModId ? `<button class="btn ver${state.verifiedIds.has(String(srcModId)) ? ' on' : ''}" data-gver="${esc(g.key)}" title="${
      state.verifiedIds.has(String(srcModId))
        ? '点一下取消「已验证」标记'
        : '我实测过它能用：打上「已验证」，之后在 Mod 库里能直接筛出来'
    }">${state.verifiedIds.has(String(srcModId)) ? '✓ 已验证' : '✓ 标为已验证'}</button>` : ''}
  `;

  showDrawer();

  // 没缓存过图集的老条目：按需去 Nexus 补一次（有 modId 才做，抓不到就保持原样）
  if (srcModId && !imgs.length) fillGallery(srcModId);
}

function renderDesc(m, desc, zhText) {
  if (state.drawer.lang === 'zh') {
    if (zhText) return `<p>${esc(zhText)}</p>`;
    // 没有译文也别空着：先把原文摆出来，翻译提示照旧保留在下面
    const orig = (m.meta && m.meta.descriptionHtml) || (desc ? `<p>${esc(desc)}</p>` : '');
    return (orig || '<p style="color:var(--dim2)">无原文说明</p>')
      + '<p style="color:var(--dim2)">尚未翻译。</p>'
      + '<button class="btn sm" data-translate="1">翻译成中文</button>';
  }
  if (m.meta && m.meta.descriptionHtml) return m.meta.descriptionHtml;
  return desc ? `<p>${esc(desc)}</p>` : '<p style="color:var(--dim2)">无原文说明</p>';
}

/** 翻译提示原文 —— 只在这一处出现，改动口径不用翻遍代码 */
const DESC_TRANSLATE_HINT = '点下方按钮把说明翻译成中文（结果会缓存，只翻一次）。';

/**
 * 「原文说明」—— Nexus 给的是什么语言就显示什么语言（英文 / 中文都可能），
 * 打开抽屉默认就能看到，不用先点翻译。
 */
function originalDescHtml(d) {
  const m = (d && d.mod) || {};
  const meta = (d && d.kind === 'installed') ? (m.meta || {}) : m;
  if (meta.descriptionHtml) return meta.descriptionHtml;
  const text = meta.descriptionText || meta.description || meta.summary || '';
  if (!text) return '';
  return `<p>${esc(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
}

/** 「中文」这一屏：有译文就显示译文；没有就把原文摆出来，翻译提示保留在下面 */
function zhDescHtml(d) {
  if (d && d.translated) {
    return `<p>${esc(d.translated).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
  }
  const orig = originalDescHtml(d);
  return (orig || '<p style="color:var(--dim2)">该 Mod 没有说明文字。</p>')
    + `<p style="color:var(--dim2)">${DESC_TRANSLATE_HINT}</p>`
    + '<button class="btn sm" data-translate="1">翻译成中文</button>';
}

/** 抽屉说明区整体内容（按当前语言页 + 抽屉类型） */
function descBoxHtml(d) {
  if (!d) return '';
  if (d.kind === 'installed') {
    const meta = (d.mod && d.mod.meta) || {};
    return renderDesc(d.mod, meta.description || meta.summary || '', meta.descriptionZh || meta.summaryZh || '');
  }
  return d.lang === 'en'
    ? (originalDescHtml(d) || '<p style="color:var(--dim2)">无说明</p>')
    : zhDescHtml(d);
}

/* ---------------- 浏览 Mod ---------------- */

/** 每页拉多少个（也是「只看未安装」时自动续翻要凑满的一屏量） */
const BROWSE_PAGE = 24;

/**
 * 浏览页卡片上的「本地状态」呈现。
 * 状态由主进程按 Nexus modId 判定（见 src/main/localState.js），
 * 这里只负责文案与按钮动作。
 */
const LOCAL_UI = {
  installed: { badge: '✓ 已安装', cls: 'ok', btn: '已安装', act: 'installed' },
  installing: { badge: '● 安装中', cls: 'busy', btn: '安装中…', act: 'busy' },
  pending: { badge: '↓ 已下载', cls: 'dl', btn: '安装到游戏', act: 'install' },
  downloading: { badge: '● 下载中', cls: 'busy', btn: '查看进度', act: 'download' }
};

/**
 * 卡片底部那对 👍 / 👎（纯图标，无文字）。
 *
 * 用户 2026-10-14：「mod 图标上增加喜欢按钮，与不喜欢对应，不显示文字，
 * 只显示两个图标，大拇指向上，大拇指向下」。
 *
 * 同日追加：「喜欢和不喜欢按钮下移，与下载按钮放在一起，操作类的按钮尽量集中」
 * —— 原来绝对定位贴在封面右下角，现移到 `.meta` 行右端、与「下载 / 已安装」
 * 按钮同处一个 `.acts` 容器，所有操作类按钮集中在一处，也不再压住封面图。
 *
 * 用内联 SVG 而不是 emoji：emoji（👍👎）在 Windows 上是**彩色**的，
 * 点亮与未点亮几乎看不出区别；`currentColor` 让图标跟随 `on` 类变色，状态一目了然。
 */
const ICON_THUMB_UP = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
  '<path fill="currentColor" d="M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.58 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
const ICON_THUMB_DOWN = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
  '<path fill="currentColor" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.58-6.59c.37-.36.59-.86.59-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>';

function voteHtml(n) {
  const liked = state.browse.liked.has(String(n.modId));
  const blocked = state.browse.blocked.has(String(n.modId));
  return `<div class="vote">
    <button class="vbtn up${liked ? ' on' : ''}" ${
      liked ? `data-unlike="${n.modId}"` : `data-like="${n.modId}"`
    } title="${liked ? '取消喜欢' : '喜欢 —— 可以用「只看喜欢」筛出来，列表里也会排在前面'}">${ICON_THUMB_UP}</button>
    <button class="vbtn down${blocked ? ' on' : ''}" ${
      blocked ? `data-undislike="${n.modId}"` : `data-dislike="${n.modId}"`
    } title="${blocked ? '移出黑名单，之后会重新显示' : '不喜欢 —— 加入黑名单，之后不再显示，也不会出现在下载队列里'}">${ICON_THUMB_DOWN}</button>
  </div>`;
}

/* ---------------- 批量解析：本地 Mod ↔ Nexus 关联 ---------------- */

/**
 * 复核界面用到的临时状态（只活在内存里，关掉弹窗即丢弃）。
 *
 * 为什么要有「复核」这一步：330 条未登记 Mod 里必然有猜错的，直接写进关联
 * 会让用户看到错误的封面/作者而毫不知情。所以流程是
 * 解析（只算不写） → 用户过一眼、改几条 → 应用（才落盘）。
 */
const linkerUI = {
  rows: [],
  stats: null,
  catalog: null,
  phase: '',                 // '' | 'catalog' | 'match' | 'done'
  progress: { done: 0, total: 0, loaded: 0, catTotal: 0, fromCache: false },
  filter: 'all',
  search: null,              // { localId, query, results, busy }
  offProgress: null,
  running: false
};

/** 置信度 → 中文标签（也给 CSS 类名用，取值固定 high/medium/low/none） */
const LINK_CONF_LABEL = { high: '高置信', medium: '中置信', low: '低置信', none: '未匹配' };

function linkConfOf(r) {
  return (r.best && r.best.confidence) || 'none';
}

/** 进度条：解析过程中显示在弹窗顶部 */
function linkerProgressHtml() {
  const p = linkerUI.progress;
  if (linkerUI.phase === 'catalog') {
    const pct = p.catTotal ? Math.round((p.loaded / p.catTotal) * 100) : 0;
    return `<div class="lprog">
      <div class="lbar"><i style="width:${pct}%"></i></div>
      <div class="ltxt">正在获取 Nexus Mod 目录 ${fmtNum(p.loaded)} / ${p.catTotal ? fmtNum(p.catTotal) : '…'}（首次约 1 分钟，之后 7 天内复用缓存）</div>
    </div>`;
  }
  if (linkerUI.phase === 'match') {
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return `<div class="lprog">
      <div class="lbar"><i style="width:${pct}%"></i></div>
      <div class="ltxt">正在比对本地 Mod ${fmtNum(p.done)} / ${fmtNum(p.total)}</div>
    </div>`;
  }
  return '';
}

/** 结果汇总一行 */
function linkerSummaryHtml() {
  const s = linkerUI.stats || { high: 0, medium: 0, low: 0, none: 0 };
  const total = linkerUI.rows.length;
  if (!total) {
    return '<div class="txt" style="color:var(--dim2)">没有需要解析的 Mod —— 扫描到的每一条都已经有来源信息了。</div>';
  }
  const tabs = [
    ['all', '全部', total],
    ['high', '高置信', s.high],
    ['medium', '中置信', s.medium],
    ['low', '低置信', s.low],
    ['none', '未匹配', s.none]
  ];
  return `<div class="lsummary">
    <div class="txt">共 ${total} 条待解析 · <b style="color:var(--ok)">高置信 ${s.high}</b> · 中置信 ${s.medium} · 低置信 ${s.low} · 未匹配 ${s.none}</div>
    <div class="ltabs">${tabs.map(([k, label, n]) =>
      `<button class="ltab${linkerUI.filter === k ? ' on' : ''}" data-lfilter="${k}">${label} ${n}</button>`).join('')}</div>
    <div class="txt" style="color:var(--dim2)">默认只勾选「高置信」。逐条看过再应用 —— 名字里带代号的往往没有可靠信号，宁可留空。</div>
  </div>`;
}

/** 单行：本地名字 + 候选下拉框 */
function linkerRowHtml(r) {
  const sel = r.sel || null;              // 当前选中（复核过程中改过的）
  const chosen = sel && sel.modId ? String(sel.modId) : '';
  const opts = [];
  if (sel && sel.modId && !(r.candidates || []).some(c => Number(c.modId) === Number(sel.modId))) {
    opts.push(`<option value="${esc(String(sel.modId))}" selected>#${esc(String(sel.modId))} ${esc(sel.name || '')}</option>`);
  }
  for (const c of r.candidates || []) {
    const on = String(c.modId) === chosen ? ' selected' : '';
    // 置信度和分数已经由左侧徽标给出，下拉里只留识别信息，避免同一行重复且撑宽菜单
    opts.push(`<option value="${esc(String(c.modId))}"${on}>#${esc(String(c.modId))} ${esc(c.name || '')}${
      c.author ? ' · ' + esc(c.author) : ''}</option>`);
  }
  opts.push(`<option value=""${chosen ? '' : ' selected'}>不关联（保持未登记）</option>`);
  opts.push('<option value="__search">搜索其他 Mod…</option>');

  const conf = linkConfOf(r);
  const on = (r.on === undefined ? conf === 'high' : r.on) && !!chosen;

  return `<div class="lrow" data-lid="${esc(r.localId)}">
    <input type="checkbox" data-lchk="${esc(r.localId)}"${on ? ' checked' : ''}>
    <div class="lname" data-i18n-skip title="${esc(r.localName)}">
      <div class="ln1">${esc(r.localName)}</div>
      <div class="ln2">${esc(r.kind || '')} · ${fmtSize(r.size || 0)} · ${r.fileCount || 0} 个文件${
        r.tagged ? ' · 文件名带标识' : ''}${r.thin ? ' · 名字太短' : ''}${r.ambiguous ? ' · 多个相近候选' : ''}</div>
    </div>
    <div class="lsel">
      <span class="lconf ${esc(conf)}">${esc(LINK_CONF_LABEL[conf] || conf)}</span>
      <select data-lsel="${esc(r.localId)}">${opts.join('')}</select>
    </div>
  </div>`;
}

function linkerListHtml() {
  const f = linkerUI.filter;
  const shown = (linkerUI.rows || []).filter(r => (f === 'all' ? true : linkConfOf(r) === f));
  if (!shown.length) return '<div class="txt" style="color:var(--dim2)">这个分组下没有条目。</div>';
  return `<div class="llist">${shown.map(linkerRowHtml).join('')}</div>`;
}

/** 手动搜索视图（给某一行的「搜索其他 Mod…」用） */
function linkerSearchHtml() {
  const s = linkerUI.search;
  if (!s) return '';
  const row = linkerUI.rows.find(r => r.localId === s.localId);
  const res = (s.results || []).map(c => `
    <div class="lhit">
      <div class="lname" data-i18n-skip>
        <div class="ln1">${esc(c.name)}</div>
        <div class="ln2">#${esc(String(c.modId))}${c.author ? ' · ' + esc(c.author) : ''}${
          c.version ? ' · ' + esc(c.version) : ''} · ${fmtNum(c.downloads || 0)} 下载</div>
      </div>
      <button class="btn sm p" data-lpick="${esc(s.localId)}|${esc(String(c.modId))}">选它</button>
    </div>`).join('');
  return `<div class="lsearch">
    <div class="txt">手动挑一个 Nexus Mod：</div>
    <div class="txt" data-i18n-skip style="color:var(--dim2)">${esc((row && row.localName) || '')}</div>
    <div class="urlbox">
      <input id="linkerQuery" value="${esc(s.query || '')}" placeholder="输入 Mod 名称里的几个词，回车搜索">
      <button class="btn" data-lgo="1">${s.busy ? '搜索中…' : '搜索'}</button>
    </div>
    <div class="lresults">${s.busy ? '<div class="txt" style="color:var(--dim2)">搜索中…</div>'
      : (s.results && s.results.length ? res
        : (s.searched ? '<div class="txt" style="color:var(--dim2)">没有搜到，换个词试试。</div>' : ''))}</div>
    <button class="btn sm" data-lback="1">返回列表</button>
  </div>`;
}

/** 弹窗正文：进度 → 结果 */
function linkerBodyHtml() {
  if (linkerUI.search) return linkerSearchHtml();
  if (linkerUI.phase === 'catalog' || linkerUI.phase === 'match') {
    return linkerProgressHtml() + '<div class="txt" style="color:var(--dim2)">解析过程只读不写：先取一份 Nexus 目录，再在本地逐条比对。中途可以取消。</div>';
  }
  return linkerSummaryHtml() + linkerListHtml();
}

function linkerFootHtml() {
  if (linkerUI.phase === 'catalog' || linkerUI.phase === 'match') {
    return '<button class="btn d" data-mbtn="lCancel">取消</button>';
  }
  if (!linkerUI.rows.length) {
    return '<button class="btn" data-mbtn="lRestart">重新解析</button><button class="btn p" data-mbtn="lClose">关闭</button>';
  }
  const n = linkerCheckedCount();
  return `<button class="btn" data-mbtn="lRestart">重新解析</button>
    <button class="btn p" data-mbtn="lApply"${n ? '' : ' disabled'}>应用选中 ${n} 条</button>
    <button class="btn" data-mbtn="lClose">关闭</button>`;
}

function linkerPaint() {
  const body = $('#mBody');
  if (body) body.innerHTML = linkerBodyHtml();
  const foot = $('#mFoot');
  if (foot) foot.innerHTML = linkerFootHtml();
}

function linkerCheckedCount() {
  return (linkerUI.rows || []).filter(r => r.on && r.sel && r.sel.modId).length;
}

/** 把 DOM 上的勾选 / 下拉选择同步回 rows（切换筛选、重绘之前必须先做） */
function linkerSyncFromDom() {
  for (const r of linkerUI.rows) {
    const cb = document.querySelector(`[data-lchk="${cssEsc(r.localId)}"]`);
    if (cb) r.on = !!cb.checked;
    const sel = document.querySelector(`[data-lsel="${cssEsc(r.localId)}"]`);
    if (sel) {
      const v = sel.value;
      if (v && v !== '__search') {
        const modId = Number(v);
        const hit = (r.candidates || []).find(c => Number(c.modId) === modId)
          || (r.sel && Number(r.sel.modId) === modId ? r.sel : null);
        if (hit) r.sel = { ...hit, modId };
      } else if (!v) {
        r.sel = null;
      }
    }
  }
}

/** CSS.escape 的兜底（老 Chromium 里没有，但 id 里可能有冒号） */
function cssEsc(s) {
  if (window.CSS && CSS.escape) return CSS.escape(String(s));
  return String(s).replace(/["\\]/g, '\\$&');
}

function closeLinkerModal() {
  if (linkerUI.offProgress) { try { linkerUI.offProgress(); } catch { /* ignore */ } }
  linkerUI.offProgress = null;
  linkerUI.running = false;
  linkerUI.search = null;
  closeModal();
}

/** 入口：顶栏「批量解析」 */
async function openLinkerModal() {
  linkerUI.rows = [];
  linkerUI.stats = null;
  linkerUI.phase = '';
  linkerUI.filter = 'all';
  linkerUI.search = null;
  linkerUI.progress = { done: 0, total: 0, loaded: 0, catTotal: 0, fromCache: false };

  openModal('批量解析', '<div class="txt" style="color:var(--dim2)">读取状态…</div>', [
    { id: 'lClose', label: '关闭' }
  ]);

  let st = null;
  try { st = await call(window.api.linker.state(), { silent: true }); } catch { st = null; }
  linkerUI.catalog = (st && st.catalog) || null;

  const cat = linkerUI.catalog;
  // 文案拆成几个节点：一个是固定句、数字和日期单独成段，
  // 这样多语言替换才不会卡在「句中夹日期」这种拼不出来的地方。
  const catLine = cat
    ? `<span>已有 Nexus 目录缓存：</span><b>${fmtNum(cat.count)}</b><span> 个 Mod，抓取时间 </span><span data-i18n-skip>${fmtDate(cat.fetchedAt)}</span>${
      cat.stale ? '<span>（已过期，会自动重抓）</span>' : ''}`
    : '还没有 Nexus 目录缓存 —— 第一次解析需要抓一遍全量目录（约 1 分钟），之后 7 天内都复用。';
  const linked = (st && st.count) || 0;

  $('#mBody').innerHTML = `
    <div class="lintro">
      <p>把手动放进 ~Mods 目录、程序没有记录过来源的 Mod，按名字与 Nexus 上的条目对上号，然后补上名字、作者、版本、封面和链接。文件一个都不动，也不会把它们登记成「管理器安装」。</p>
      <p style="color:var(--dim2)">${catLine}</p>
      ${linked ? `<p style="color:var(--dim2)">已经关联过 ${fmtNum(linked)} 条 —— 解析只会处理「还没关联」的，重复跑不会重复写。</p>` : ''}
    </div>`;
  $('#mFoot').innerHTML = `
    <button class="btn p" data-mbtn="lStart">开始解析</button>
    <button class="btn" data-mbtn="lClose">关闭</button>`;
}

/** 真正跑一次解析 */
async function runLinkerResolve(force = false) {
  if (linkerUI.running) return;
  linkerUI.running = true;
  linkerUI.phase = 'catalog';
  linkerUI.rows = [];
  linkerUI.stats = null;
  linkerUI.progress = { done: 0, total: 0, loaded: 0, catTotal: 0, fromCache: false };
  linkerPaint();

  if (linkerUI.offProgress) { try { linkerUI.offProgress(); } catch { /* ignore */ } }
  linkerUI.offProgress = window.api.linker.onProgress(p => {
    if (!p) return;
    if (p.phase === 'catalog') {
      linkerUI.phase = 'catalog';
      linkerUI.progress.loaded = p.loaded || 0;
      linkerUI.progress.catTotal = p.total || 0;
    } else if (p.phase === 'match') {
      linkerUI.phase = 'match';
      linkerUI.progress.done = p.done || 0;
      linkerUI.progress.total = p.total || 0;
    }
    // 进度事件很密（每 10 条一次），节流重绘到 200ms，别把界面顶住
    const now = Date.now();
    if (!linkerPaint._at || now - linkerPaint._at > 200) {
      linkerPaint._at = now;
      linkerPaint();
    }
  });

  let res = null;
  try {
    res = await call(window.api.linker.resolve({ force }), { silent: true });
  } catch (e) {
    linkerUI.phase = '';
    linkerUI.running = false;
    openModal('批量解析', `<div class="txt" style="color:var(--err)">解析失败：${esc(e.message)}</div>`, [
      { id: 'lClose', label: '关闭' }
    ]);
    return;
  }

  linkerUI.running = false;
  linkerUI.phase = 'done';

  if (res && res.cancelled) {
    linkerUI.phase = '';
    linkerUI.rows = [];
    linkerPaint();
    toast('已取消解析', 'warn');
    return;
  }

  // 排序：置信度高的在前，同档按分数、再按下载量
  const rank = { high: 0, medium: 1, low: 2, none: 3 };
  const results = ((res && res.results) || []).slice();
  results.sort((a, b) => {
    const ra = rank[linkConfOf(a)] ?? 3;
    const rb = rank[linkConfOf(b)] ?? 3;
    if (ra !== rb) return ra - rb;
    const sa = (a.best && a.best.score) || 0;
    const sb = (b.best && b.best.score) || 0;
    if (sb !== sa) return sb - sa;
    return String(a.localName).localeCompare(String(b.localName));
  });

  linkerUI.rows = results.map(r => ({
    ...r,
    on: linkConfOf(r) === 'high' && !!r.best,     // 默认只勾高置信
    sel: r.best ? { ...r.best } : null            // 当前选中（可在下拉框里改）
  }));
  linkerUI.stats = (res && res.stats) || null;
  linkerUI.catalog = (res && res.catalog) || linkerUI.catalog;
  linkerPaint();
}

/** 应用勾选的关联 */
async function applyLinkerChoices() {
  linkerSyncFromDom();
  const entries = [];
  for (const r of linkerUI.rows) {
    if (!r.on || !r.sel || !r.sel.modId) continue;
    entries.push({
      localId: r.localId,
      modId: Number(r.sel.modId),
      name: r.sel.name || '',
      pictureUrl: r.sel.pictureUrl || r.sel.image || '',
      confidence: r.best && Number(r.best.modId) === Number(r.sel.modId) ? r.best.confidence : 'manual',
      score: r.best && Number(r.best.modId) === Number(r.sel.modId) ? r.best.score : null,
      matchedBy: r.best && Number(r.best.modId) === Number(r.sel.modId)
        ? (r.tagged ? 'tag' : 'auto')
        : 'manual'
    });
  }
  if (!entries.length) { toast('没有勾选任何要关联的条目', 'warn'); return; }

  toast('正在写入关联并缓存封面…');
  try {
    const r = await call(window.api.linker.apply(entries));
    toast(`已关联 ${r.applied} 条`, 'ok');
    closeLinkerModal();
    await refreshAll();
  } catch { /* call 已经弹过错误提示 */ }
}

/** 手动搜索：为某一行找候选 */
async function runLinkerSearch(localId, query) {
  linkerUI.search = { localId, query: query || '', results: [], busy: true, searched: false };
  linkerPaint();
  try {
    const list = await call(window.api.linker.search(query, 30), { silent: true });
    linkerUI.search.results = list || [];
  } catch (e) {
    linkerUI.search.results = [];
    toast('搜索失败：' + e.message, 'err');
  }
  linkerUI.search.busy = false;
  linkerUI.search.searched = true;
  linkerPaint();
}

function browseCard(n) {
  const img = n.thumbnail || n.image;
  const st = n.local ? LOCAL_UI[n.local.state] : null;
  // 标过「有 bug」的 Mod 在在线列表里也要红着（免得手滑又下一遍）
  const isBug = installedIsBug(n);
  const isVer = !!(n.modId && state.verifiedIds && typeof state.verifiedIds.has === 'function' && state.verifiedIds.has(String(n.modId)));
  let action;
  if (!st) {
    action = `<button class="btn sm" data-dl-add="${n.modId}" title="加入下载队列（之后自动下载并安装）">⬇ 下载</button>`;
  } else if (st.act === 'install') {
    // 队列里的任务有 taskId，走「确认安装」；安装包库里的包没有任务，走 library:install
    // （2026-11-09：本地明明有包，卡片还显示「下载」，点一下又下一遍）
    action = n.local.taskId
      ? `<button class="btn sm p" data-local-install="${esc(n.local.taskId)}" title="安装包已在本地，直接安装">${st.btn}</button>`
      : `<button class="btn sm p" data-lib-install="${n.modId}" title="安装包已经在管理器里（不用再下一次），直接装进游戏目录">${st.btn}</button>`;
  } else if (st.act === 'installed') {
    action = `<button class="btn sm st-ok" data-goto-page="p-installed" title="已装到本地，去「已安装 Mod」看看">${st.btn}</button>`;
  } else if (st.act === 'download') {
    action = `<button class="btn sm" data-goto-page="p-download" title="去「下载」页看进度">${st.btn}</button>`;
  } else {
    action = `<button class="btn sm" disabled>${st.btn}</button>`;
  }

  return `
  <div class="card${state.sel.ids.has(String(n.modId)) ? ' sel' : ''}${isBug ? ' hasbug' : ''}" data-modid="${n.modId}">
    <div class="cover">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'无封面图'}))">`
        : `<div class="ph">无封面图</div>`}
      <div class="ck${state.sel.ids.has(String(n.modId)) ? ' on' : ''}" data-ck="${n.modId}">✓</div>
      ${st ? `<span class="lb ${st.cls}">${st.badge}</span>` : ''}
      ${isBug ? '<span class="tag bug" title="你标记过这个 Mod 有 bug —— 批量安装时会先问一句要不要跳过">⚠ 有 bug</span>' : ''}
      ${isVer ? '<span class="tag ver" title="我实测过它能用">✓ 已验证</span>' : ''}
      ${n.categoryZh ? `<span class="cat">${esc(n.categoryZh)}</span>` : ''}
      ${n.adult ? `<span class="tag" style="color:#E88;border-color:#5A2A28;background:rgba(217,83,79,.16)">成人内容</span>` : ''}
    </div>
    <div class="cbody">
      <h3 data-i18n-skip title="${esc(n.name)}">${esc(n.name)}</h3>
      <div class="zh" data-i18n-skip title="${esc(n.summary)}">${esc(n.summary || '—')}</div>
      <div class="meta">
        ${n.version ? `<span class="chip">v${esc(n.version)}</span>` : ''}
        ${n.author ? `<span>${esc(n.author)}</span>` : ''}
        <span>⬇ ${fmtNum(n.downloads)}</span>
        <span>♥ ${fmtNum(n.endorsements)}</span>
        <div class="acts">${voteHtml(n)}${action}</div>
      </div>
    </div>
  </div>`;
}

/* ---------------- 浏览页多选 / 批量下载 ---------------- */

/** 批量下载的并发度：文件列表只能逐个请求（Nexus 没有批量接口），4 路够快又不至于把接口打爆 */
const BATCH_CONCURRENCY = 4;

/**
 * 从文件列表里挑「第一个主文件」。
 * 后端已经按「primary → MAIN → UPDATE → …」排好序，这里再兜一层：
 * primary 标记优先 → categoryRaw=MAIN → 退回第一个（纯函数，便于离线钉死口径）。
 */
function pickPrimaryFile(files) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return null;
  return list.find(f => f.primary) || list.find(f => f.categoryRaw === 'MAIN') || list[0];
}

/** 批量入队结果的一句话汇总（纯函数） */
function batchSummary({ added = 0, dup = 0, failed = 0, skipped = 0, noFile = 0 } = {}) {
  const parts = [];
  if (added) parts.push(`已加入 ${added} 个到下载队列（默认下载各自主文件）`);
  if (dup) parts.push(`${dup} 个已在队列里`);
  if (skipped) parts.push(`${skipped} 个已安装已跳过`);
  if (noFile) parts.push(`${noFile} 个取不到文件列表（按整个 Mod 入队）`);
  if (failed) parts.push(`${failed} 个失败`);
  if (!parts.length) return '没有可加入的 Mod。';
  return parts.join('，') + '。' + (added
    ? (state.config && state.config.autoAuthorize === false
      ? '到「下载管理」页点「⚡ 全部自动授权」即可批量开始。'
      : '已自动开始授权下载，进度见「下载管理」页。')
    : '');
}

/** 勾选 / 取消一个 Mod（手动操作会取消「全选」语义，之后追加的卡片不再自动选中） */
function selToggle(modId) {
  const k = String(modId);
  if (state.sel.ids.has(k)) state.sel.ids.delete(k); else state.sel.ids.add(k);
  state.sel.all = false;
  selSyncCard(k);
  selUpdateBar();
  refreshDownloadedStats();
}

/**
 * 多选模式下一次点击卡片的行为（用户 2026-11-10：「多选开启时，支持 shift 和 ctrl 批量选中」）。
 *   · Shift+点击        = 从锚点连选到这张（资源管理器语义：先清掉旧选择）
 *   · Ctrl+Shift+点击   = 在已有选择上追加这一段
 *   · Ctrl+点击         = 只加减这一张，其它保持不动
 *   · 普通点击          = 勾选/取消，并把这张记为下一次 Shift 连选的锚点
 * 复选框（`.ck`）在卡片里，点它同样冒泡到这里，所以勾选框和卡片的行为一致。
 */
function selClick(modId, e) {
  const k = String(modId);
  if (e && e.shiftKey && selRangeTo(k, !!(e.ctrlKey || e.metaKey))) return;
  selToggle(k);
  state.sel.anchor = k;
}

/** 浏览列表**当前排在屏幕上**的 modId（连选必须按看到的顺序，不能按数据顺序） */
function selOrderIds() {
  return Array.from(document.querySelectorAll('#browseArea .card[data-modid]'))
    .map(c => String(c.dataset.modid));
}

/**
 * Shift 连选：把锚点到目标之间这一段整批选上。
 * 锚点不在当前列表里（换过筛选 / 换了排序 / 目标自己就是第一张）时退化成
 * 「只选这一张」—— 比莫名选中一大片好解释。
 */
function selRangeTo(modId, additive) {
  const ids = selOrderIds();
  const to = ids.indexOf(String(modId));
  if (to < 0) return false;
  const at = ids.indexOf(String(state.sel.anchor || ''));
  if (at < 0) {
    selToggle(modId);
    state.sel.anchor = String(modId);
    return true;
  }
  if (!additive) state.sel.ids.clear();
  const a = Math.min(at, to);
  const b = Math.max(at, to);
  for (let i = a; i <= b; i++) state.sel.ids.add(ids[i]);
  state.sel.all = false;
  selSyncAll();
  selUpdateBar();
  refreshDownloadedStats();
  return true;
}

/** 全选 / 取消全选「当前已加载」的 Mod；全选后新追加的卡片自动并入 */
function selSelectAll() {
  // 统一口径：本地档位用记录键（mod:<id> / lib:<id>），在线档位用 modId
  const keys = (typeof libSelectableKeys === 'function' && (state.lib.status || 'all') !== 'online')
    ? libSelectableKeys()
    : browseVisibleItems().map(m => String(m.modId));
  if (!keys.length) return;   // 还没加载出东西，没什么可选（也别把 all 置上）
  const allOn = keys.every(k => state.sel.ids.has(k));
  if (allOn) { state.sel.ids.clear(); state.sel.all = false; }
  else { for (const k of keys) state.sel.ids.add(k); state.sel.all = true; }
  state.sel.anchor = null;   // 全选后锚点消失：下一次 Shift 从新点的那张算起
  selSyncAll();
  selUpdateBar();
  refreshDownloadedStats();
}

/** 单个卡片的选中外观（不重画卡片 —— 整页重画会让封面重新解码、滚动位置跳） */
function selSyncCard(modId) {
  const card = document.querySelector(`#browseArea .card[data-modid="${modId}"]`);
  if (!card) return;
  const on = state.sel.ids.has(String(modId));
  card.classList.toggle('sel', on);
  const ck = card.querySelector('.ck');
  if (ck) ck.classList.toggle('on', on);
}

/** 当前列表所有卡片的选中外观 */
function selSyncAll() {
  for (const card of $$('#browseArea .card')) {
    // 本地记录卡（Mod 库）用 data-lkey，在线卡用 data-modid —— 两种都认
    const key = card.dataset.lkey || String(card.dataset.modid || '');
    const on = !!key && state.sel.ids.has(key);
    card.classList.toggle('sel', on);
    const ck = card.querySelector('.ck');
    if (ck) ck.classList.toggle('on', on);
  }
}

/** 列表重置（换筛选 / 排序 / 搜索）时清空选择：旧选择对应的 Mod 可能已经不在列表里了 */
function selClear() {
  state.sel.ids.clear();
  state.sel.all = false;
  state.sel.anchor = null;
  selSyncAll();
  selUpdateBar();
  refreshDownloadedStats();
}

/** 进入 / 退出多选模式（只切 body 上的类，卡片不用重画）；退出时清空选择 */
function selSetMode(on) {
  state.sel.on = !!on;
  syncSelBodyClass();
  if (!state.sel.on) { state.sel.ids.clear(); state.sel.all = false; state.sel.anchor = null; selSyncAll(); }
  selUpdateBar();
  refreshDownloadedStats();
}

/** 工具栏三个按钮的文案 / 显隐 / 计数 */
function selUpdateBar() {
  const mode = $('#btnBatchMode');
  const allBtn = $('#btnSelectAll');
  if (!mode) return;
  mode.textContent = state.sel.on ? '完成' : '多选';
  mode.classList.toggle('on', state.sel.on);
  const keys = (typeof libSelectableKeys === 'function') ? libSelectableKeys() : [];
  if (allBtn) {
    allBtn.style.display = state.sel.on ? '' : 'none';
    const allOn = keys.length > 0 && keys.every(k => state.sel.ids.has(k));
    allBtn.textContent = allOn ? '取消全选' : '全选';
  }
  // 五颗批量按钮按「选中的东西是什么」自动亮 / 灰（用户 2026-11-10：一套界面管三种状态）
  // 「启用」只数当前关着的，「禁用」只数当前开着的 —— 两颗按钮各自作用于「能被它改变」的那些。
  const btns = [
    { el: $('#btnBatchDownload'), pick: () => sel.online || [], verb: '下载' },
    { el: $('#btnBatchInstall'), pick: () => sel.downloaded || [], verb: '安装' },
    { el: $('#btnBatchOn'), pick: () => (sel.installed || []).filter(r => !r.enabled || r.partial), verb: '启用' },
    { el: $('#btnBatchOff'), pick: () => (sel.installed || []).filter(r => r.enabled || r.partial), verb: '禁用' },
    { el: $('#btnBatchUninstall'), pick: () => sel.installed || [], verb: '卸载' }
  ];
  let sel = { installed: [], downloaded: [], online: [] };
  try { sel = libSelectedRecords(); } catch (e) { /* 早期调用时还没有记录表 */ }
  // 批量标记那五颗（喜欢 / 不喜欢 / 有 bug / 已验证 / 未验证）：
  // 「全标过再点一下 = 取消」这件事得在按钮上看得出，所以全标过时按钮点亮、文案换成取消。
  {
    const wrap = $('#batchMarks');
    if (wrap) wrap.style.display = state.sel.on ? '' : 'none';
    const allSel = [...(sel.installed || []), ...(sel.downloaded || []), ...(sel.online || [])];
    const usable = allSel.filter(r => Number(r.modId) > 0);
    const MK = [
      { el: $('#btnBatchLike'), has: (r) => state.browse.liked.has(String(r.modId)), on: '取消喜欢', off: '👍 喜欢' },
      { el: $('#btnBatchDislike'), has: (r) => state.browse.blocked.has(String(r.modId)), on: '移出黑名单', off: '👎 不喜欢' },
      { el: $('#btnBatchBug'), has: (r) => state.bugIds.has(String(r.modId)), on: '取消「有 bug」', off: '⚠ 有 bug' },
      { el: $('#btnBatchVerify'), has: (r) => state.verifiedIds.has(String(r.modId)), on: '取消「已验证」', off: '✓ 已验证' },
      { el: $('#btnBatchUnverify'), has: (r) => !state.verifiedIds.has(String(r.modId)), on: '', off: '未验证' }
    ];
    for (const m of MK) {
      if (!m.el) continue;
      m.el.disabled = !usable.length;
      if (state.sel.busy) continue;
      const allHas = usable.length > 0 && usable.every(m.has);
      m.el.classList.toggle('on', allHas);
      if (!m.on) { m.el.textContent = usable.length ? `${m.off}（${usable.length}）` : m.off; continue; }
      m.el.textContent = allHas ? `${m.on}（${usable.length}）` : (usable.length ? `${m.off}（${usable.length}）` : m.off);
    }
  }
  for (const b of btns) {
    if (!b.el) continue;
    b.el.style.display = state.sel.on ? '' : 'none';
    if (state.sel.busy) continue;   // 跑批时文案由进度更新接管，别被覆盖
    const n = b.pick().length;
    b.el.textContent = n ? `${b.verb}（${n}）` : `批量${b.verb}`;
    b.el.disabled = !n;
  }
}

/**
 * 批量标记（用户 2026-11-10：「全选后要支持批量标记 喜欢 / 不喜欢 / bug / 已验证 / 未验证」）。
 *
 * 五个动作共用这一支：`kind` 决定写哪份记录，`force` 决定是「打上」还是「取消」。
 * 默认是**智能开关** —— 选中的这批如果已经全标过，再点一下就是全取消；
 * 否则全部打上。这样不用为了「取消」再摆五颗按钮出来。
 *
 * 标记只认 Nexus modId，所以没有 modId 的本地条目会被跳过并说明原因。
 */
async function libBatchMark(kind, force) {
  const KINDS = {
    like: {
      has: (r) => state.browse.liked.has(String(r.modId)),
      add: (id) => window.api.favorites.add(Number(id), {}),
      del: (id) => window.api.favorites.remove(Number(id)),
      reload: () => loadFavorites(),
      on: '已标记喜欢：%s 个', off: '已取消喜欢：%s 个'
    },
    dislike: {
      has: (r) => state.browse.blocked.has(String(r.modId)),
      add: (id) => window.api.blacklist.add(Number(id), {}),
      del: (id) => window.api.blacklist.remove(Number(id)),
      reload: () => loadBlacklist(),
      on: '已加入黑名单：%s 个', off: '已移出黑名单：%s 个'
    },
    bug: {
      has: (r) => state.bugIds.has(String(r.modId)),
      add: (id) => window.api.bugs.add(Number(id), {}),
      del: (id) => window.api.bugs.remove(Number(id)),
      reload: () => loadBugs(),
      on: '已标记「有 bug」：%s 个', off: '已取消「有 bug」：%s 个'
    },
    verified: {
      has: (r) => state.verifiedIds.has(String(r.modId)),
      add: (id) => window.api.verified.add(Number(id), {}),
      del: (id) => window.api.verified.remove(Number(id)),
      reload: () => loadVerified(),
      on: '已标记「已验证」：%s 个', off: '已取消「已验证」：%s 个'
    }
  };
  const K = KINDS[kind];
  if (!K) return;

  let recs = [];
  try { recs = libSelectedRecords(); } catch (e) { recs = []; }
  const all = [];
  for (const g of [recs.installed || [], recs.downloaded || [], recs.online || []]) all.push(...g);
  const usable = all.filter(r => Number(r.modId) > 0);
  if (!all.length) { toast('先勾选要标记的 Mod'); return; }
  if (!usable.length) { toast('选中的条目都没有 Nexus Mod ID，标不上（标记靠 Mod ID 认人）', 'warn'); return; }

  // 全标过 → 这一下是取消；否则是打上（force === false 时按「这批是不是已经全标了」决定）
  const allMarked = usable.every(r => K.has(r));
  const remove = force === true ? true : (force === false ? false : allMarked);
  let ok = 0;
  let bad = 0;
  // 成功一条就把内存集合同步改掉（与 likeMod/dislikeMod 同一套「先改界面、再落盘」的做法）——
  // 否则按钮上「全标过了吗」的判断要等下一轮 IPC 回来才对，用户会看到文案慢半拍。
  const set = kind === 'like' ? state.browse.liked
    : kind === 'dislike' ? state.browse.blocked
      : kind === 'bug' ? state.bugIds
        : state.verifiedIds;
  for (const r of usable) {
    const id = String(r.modId);
    try {
      await call(remove ? K.del(r.modId) : K.add(r.modId), { silent: true });
      if (remove) set.delete(id); else set.add(id);
      ok++;
    } catch (e) { bad++; }
  }
  renderBrowse();
  selUpdateBar();
  try { await K.reload(); } catch (e) { /* 状态刷新失败不该挡住提示 */ }
  renderBrowse();
  selUpdateBar();
  const msg = (remove ? K.off : K.on).replace('%s', String(ok));
  toast(bad ? msg + '（失败 ' + bad + ' 个）' : msg, bad ? 'warn' : 'ok');
}


/**
 * 批量加入下载队列：每个 Mod 默认下**第一个主文件**。
 *
 * 浏览列表的 payload 里没有文件信息（GraphQL 的 mods 查询不带 files），
 * 所以这里逐个 mod 拉一次文件列表（并发 4），挑出主文件把 fileId 钉进任务 ——
 * 之后 Nexus 安装助手只高亮那一行，用户不用自己在一堆按钮里挑。
 * 只入队、不弹授权窗口（批量开 N 个窗口是灾难），授权到下载页逐条点。
 */
async function batchDownload() {
  if (state.sel.busy) return;
  const picked = (state.browse.items || []).filter(m => state.sel.ids.has(String(m.modId)));
  if (!picked.length) { toast('先勾选要下载的 Mod'); return; }

  // 已安装的没必要再来一遍
  let installed = new Set();
  try { installed = await installedIdsOf(picked); } catch { /* 取不到就不跳过 */ }
  const todo = picked.filter(m => !installed.has(Number(m.modId)));
  const skipped = picked.length - todo.length;
  if (!todo.length) { toast(batchSummary({ skipped })); return; }

  const dl = $('#btnBatchDownload');
  state.sel.busy = true;
  if (dl) { dl.disabled = true; dl.textContent = `批量下载… 0/${todo.length}`; }

  const queue = todo.slice();
  const out = { added: 0, dup: 0, failed: 0, skipped, noFile: 0 };
  let done = 0;
  const worker = async () => {
    for (;;) {
      const m = queue.shift();
      if (!m) return;
      const modId = Number(m.modId);
      // 文件列表取不到不算致命：退回「按整个 Mod 入队」，安装助手会在页面上模糊匹配
      let files = [];
      try { files = await call(window.api.nexus.files(modId), { silent: true }); } catch { files = []; }
      const f = pickPrimaryFile(files);
      const meta = {
        game: 'stellarblade', modId,
        name: m.name || ('Mod #' + modId),
        author: m.author || '', version: m.version || '',
        summary: m.summary || '', image: m.image || '', pictureUrl: m.pictureUrl || '',
        images: m.images || (m.image ? [m.image] : []),
        sourceUrl: 'https://www.nexusmods.com/stellarblade/mods/' + modId
      };
      if (f) {
        meta.fileId = Number(f.fileId);
        meta.fileName = f.name || '';
        meta.fileVersion = f.version || '';
        meta.fileSize = f.sizeInBytes || 0;
      } else out.noFile++;
      try {
        const r = await call(window.api.download.enqueue(meta), { silent: true });
        if (r && r.duplicate) out.dup++; else out.added++;
      } catch { out.failed++; }
      done++;
      if (dl) dl.textContent = `批量下载… ${done}/${todo.length}`;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, todo.length) }, worker));
  } finally {
    state.sel.busy = false;
  }

  await refreshDownloads();
  state.sel.ids.clear(); state.sel.all = false; selSyncAll(); selUpdateBar();
  switchPage('p-download');
  toast(batchSummary(out), out.failed ? 'err' : 'ok');
}

function renderBrowseFilters() {
  const b = state.browse;
  const box = $('#browseFilters');
  const f = b.facets;
  if (!f) { box.innerHTML = ''; return; }

  const hasFilter = !!b.category || b.tags.length > 0;
  // 计数可能为 null（facets 降级）—— 那时不显示数字，但 chip 依然可点。
  const cnt = (n) => (typeof n === 'number' ? `<span class="n">${n.toLocaleString()}</span>` : '');

  // 分类：单选（含「全部」）。计数来自整个游戏，方便看出分布。
  const catChips = [{ value: '', zh: '全部', count: f.total }]
    .concat(f.categories)
    .map(c => {
      const on = (b.category || '') === c.value;
      const zero = c.value && c.count === 0 ? ' zero' : '';
      return `<button class="fc${on ? ' on' : ''}${zero}" data-cat="${esc(c.value)}">${esc(c.zh)}${cnt(c.count)}</button>`;
    }).join('');

  // 标签：多选（并集）。计数按当前分类算，已选分类时更贴近实际结果。
  const tagChips = f.tags.map(t => {
    const on = b.tags.includes(t.value);
    const zero = t.count === 0 ? ' zero' : '';
    return `<button class="fc${on ? ' on' : ''}${zero}" data-tag="${esc(t.value)}">${esc(t.zh)}${cnt(t.count)}</button>`;
  }).join('');

  box.innerHTML = `
    <div class="frow">
      <span class="fl">分类</span>
      <div class="fchips">${catChips}</div>
      ${hasFilter ? '<button class="fclear" id="btnClearFilter">清除筛选</button>' : ''}
    </div>
    <div class="frow">
      <span class="fl">标签</span>
      <div class="fchips">${tagChips}</div>
    </div>
    ${f.degraded ? '<div class="fnote">筛选器计数暂时取不到（网络问题），筛选本身仍可用</div>'
      : hasFilter ? '<div class="fnote">标签可多选，选多个时取并集</div>' : ''}`;
}

/**
 * 当前是否在做「前端本地筛选」—— 黑名单 / 只看未安装都要整页拉回来再剔。
 *
 * ⚠️ **三处必须共用这一个判据**（`shouldLoadMore` / `updateBrowseChrome` / `browseRest`），
 *    口径一旦分岔就会出现「按钮说还有 3000 个、其实早就加载完了」这种自相矛盾。
 *
 * ⚠️ 「只看黑名单」（`only`）**不算** —— 它走 `loadBlockedList()`，
 *    直接渲染本地记录，不翻页，也就没有「还没翻过的量」这个概念。
 */
function isLocalFiltering(b = state.browse) {
  if (b.blockMode === 'only') return false;
  return !!b.onlyUninstalled || (b.blockMode === 'hide' && b.blocked.size > 0);
}

/**
 * 滚到底部该不该续加载（阈值 420px 就开始预取，别等用户看到底）。
 * 抽成纯函数是为了可离线断言 —— 边界条件（刚好到阈值/全部加载完/正在加载）容易被改错。
 *
 * ⚠️ 前端本地筛选开着时 `b.items.length >= b.total` **永远不成立**（items 是
 *    服务端结果剔掉一部分后的子集），终止只能靠 `b.done`（服务端没货了）。
 */
function shouldLoadMore(scrollTop, clientHeight, scrollHeight, b) {
  if (!b || b.loading || !b.items.length || b.done) return false;
  if (!isLocalFiltering(b) && b.items.length >= b.total) return false;
  return scrollTop + clientHeight >= scrollHeight - 420;
}

/** 统计行 + 「加载更多」按钮的文案/显隐（增量追加时也走这里，不重画列表） */
function updateBrowseChrome() {
  // Mod 库的本地档位由 renderLibMerged() 自己写统计行：在线那一页抓回来的时候只当「补数据」，
  // 别把「共 366 个 Mod · 已安装 117 · 已下载 207」覆盖成在线那套「已加载 N 个 · 分类「服装」」（2026-11-10 实测到过）。
  if ((state.lib.status || 'all') !== 'online') return;
  const b = state.browse;
  const stats = $('#browseStats');
  const btn = $('#btnLoadMore');
  if (!b.items.length) {
    if (stats) stats.innerHTML = `共 <b>0</b> 个 Mod${filterSummary()}`;
    if (btn) btn.style.display = 'none';
    return;
  }
  if (stats) {
    stats.innerHTML = `共 <b>${b.total.toLocaleString()}</b> 个 Mod · 已加载 ${b.items.length} 个` +
      filterSummary() +
      (b.search ? ` · 关键词「${esc(b.search)}」` : '') +
      adultSummary();
  }
  if (btn) {
    const more = !b.done && (isLocalFiltering(b) ? b.offset < b.total : b.items.length < b.total);
    btn.style.display = more ? '' : 'none';
    btn.disabled = !!b.loading;
    btn.textContent = b.loading
      ? '加载中…'
      : (more ? `加载更多（还有 ${browseRest(b).toLocaleString()} 个）` : '加载更多');
  }
}

/**
 * 「加载更多（还有 N 个）」里的 N。
 * 开着前端本地筛选时，items 只是服务端结果剔掉一部分后的子集，
 * 用 `total - items.length` 会虚高（把跳过的也算成待看），
 * 所以改成「还没翻过的量」—— 偏移是按服务端算的。
 */
function browseRest(b) {
  const seen = isLocalFiltering(b) ? b.offset : b.items.length;
  return Math.max(0, (b.total || 0) - seen);
}

/**
 * 当前浏览页「看得见的东西」。
 * 平常是 Nexus 拉回来的 items；打开「已下载」筛选时换成本地安装包清单
 * （`state.library.items`，只有 modId，但它才是「下好了没装」的真相）。
 * 全选 / 计数都走这里，两套清单共用同一个多选状态。
 */
function browseVisibleItems() {
  if (state.browse.onlyDownloaded) return libVisibleItems((state.library && state.library.items) || []);
  return state.browse.items || [];
}

/**
 * 「已下载」清单的本地筛选：关键词 + 黑名单（隐藏模式）。
 *
 * 为什么单独一份而不是复用 `applyLocalFilter`：那份是对 Nexus 返回的在线条目做的
 * （判断「装没装」要再查一次注册表），而这里的条目本来就来自本地安装包清单，
 * 已经天然是「下好了、但当前游戏目录里没有」的那批 —— 两个筛选可以同时开着，
 * 同时开着时口径仍然一致（交集 = 已下载 且 未安装），不用再算一遍。
 *
 * 用户 2026-11-10：「已下载与未安装可以同时选中，筛选出已下载但是还没有安装的 mod」。
 */
function libVisibleItems(list) {
  const b = state.browse;
  let kept = list || [];
  const q = String(b.search || '').trim().toLowerCase();
  if (q) {
    kept = kept.filter(it => {
      const meta = libMetaFor(it.modId) || it.info || {};
      const hay = [
        it.name, it.filename, meta.name, meta.author, meta.summary,
        '#' + it.modId, String(it.modId)
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  if (b.blockMode === 'hide' && b.blocked.size) {
    kept = kept.filter(it => !b.blocked.has(String(it.modId)));
  }
  return kept;
}

/**
 * 两个筛选按钮的高亮同步（三处调用：点筛选、从下载页跳过来、刷新后）。
 *
 * 2026-11-10 起「已下载」与「只显示未安装」**不再互斥**：用户要的是「已下载但没装」
 * 这个交集，两个都点亮才说明白自己在看什么。所以这里只各自反映自己的开关状态。
 */
function syncOnlyTabs() {
  const b = state.browse;
  $$('#newOnlyTabs button').forEach(x => {
    if (x.hasAttribute('data-onlydl')) x.classList.toggle('on', !!b.onlyDownloaded);
    else x.classList.toggle('on', !!b.onlyUninstalled);
  });
}

/**
 * 「已下载」筛选的统计行（勾选变化时只重写这一行，不重画卡片）。
 *
 * `count` 是**筛选后**的条数，`total` 是筛选前的条数 —— 两个都开着时才看得出
 * 「关键词/黑名单剔掉了多少」，否则用户会以为清单里的包凭空少了。
 */
function downloadedStatsHtml(count, listed, total) {
  const b = state.browse;
  const scope = (typeof total === 'number' && total !== count)
    ? ` · 已下载 共 ${fmtNum(total)} 个`
    : '';
  const both = b.onlyUninstalled ? '（「已下载」+「未安装」同时开着）' : '';
  return `已下载但没装 <b>${fmtNum(count)}</b> 个${scope}${both} · 已列出 ${fmtNum(listed)} 个 · 选中 <b>${fmtNum(state.sel.ids.size)}</b> 个` +
    (state.sel.on ? '（勾选后点右上「批量安装」）' : '（点「多选」后勾卡片，可批量安装）');
}

function refreshDownloadedStats() {
  if (!state.browse.onlyDownloaded) return;
  const stats = $(`#browseStats`);
  if (!stats) return;
  const all = (state.library && state.library.items) || [];
  const items = libVisibleItems(all);
  const listed = Math.min(items.length, state.libShown || 12);
  stats.innerHTML = downloadedStatsHtml(items.length, listed, all.length);
}

/**
 * 「已下载」筛选：把管理器里下好但没装进当前游戏目录的安装包，
 * 按浏览页同一套卡片列出来（封面 / 标题 / 作者 / 摘要 / 版本 / 大小），
 * 多选后右上角「批量安装」一次性排进安装队列。
 */
function renderBrowseDownloaded() {
  const area = $('#browseArea');
  const stats = $('#browseStats');
  const more = $('#btnLoadMore');
  if (more) more.style.display = 'none';
  if (!state.library) {
    area.innerHTML = `<div class="grid">${Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('')}</div>`;
    if (stats) stats.innerHTML = '正在盘点管理器里的安装包…';
    return;
  }
  const all = (state.library && state.library.items) || [];
  const items = libVisibleItems(all);
  if (!items.length) {
    // 分两种「空」：本来就没有下载包，还是筛选把现有的都剔掉了 —— 提示不能混
    const filtered = all.length > 0;
    area.innerHTML = filtered
      ? `<div class="empty">
          <h3>这条件下没有已下载但没装的 Mod</h3>
          <p>已下载的有 ${fmtNum(all.length)} 个，但都被关键词或黑名单筛掉了。清掉筛选再看看。</p>
        </div>`
      : `<div class="empty">
          <h3>没有已下载但没装的 Mod</h3>
          <p>管理器里的安装包都已经装进当前游戏目录了。再点一次「已下载」回到在线列表。</p>
        </div>`;
    if (stats) stats.innerHTML = downloadedStatsHtml(0, 0, all.length);
    selSyncAll();
    selUpdateBar();
    return;
  }
  const shown = items.slice(0, state.libShown || 12);
  const rest = items.length - shown.length;
  area.innerHTML = `<div class="grid">${shown.map(it => libCardHtml(it, { selectable: true, hideDetail: true })).join('')}</div>` +
    (rest > 0 ? `<div class="lib-more"><button class="btn sm" data-lib-more="1">显示更多（还有 ${fmtNum(rest)} 个）</button></div>` : '');
  if (stats) stats.innerHTML = downloadedStatsHtml(items.length, shown.length, all.length);
  selSyncAll();
  selUpdateBar();
  ensureLibMeta();
}

/* ---------------- Mod 库：浏览 / 已下载 / 已安装 合成同一批记录 ---------------- */
/*
 * 用户 2026-11-10 定案：三个页面的功能大量重复（卡片、搜索、筛选、多选、抽屉各有一套），
 * 合成一个「Mod 库」——左侧只留一个入口，在线 / 已下载 / 已安装 用顶部状态筛选区分。
 *
 * 设计要点：
 *   · 一条「记录」= 一个 Mod，主键是 Nexus modId（没有 modId 的磁盘条目用 one:<id>）。
 *   · 状态是**算出来的**，不落盘：已安装（启用 / 禁用 / 部分）> 已下载 > 在线；
 *     下载队列里有活动任务时再加一档 busy（下载中）。
 *   · 用户标记（👍 / 👎 / ⚠有 bug）本来就是按 modId 存的，与文件无关 ——
 *     所以删掉文件、删掉安装包都不影响它们（用户明确要求）。
 *   · 'online' 那一档仍然走原来的 Nexus 分页引擎（分类 / 标签 / 成人 / 加载更多都在），
 *     其余档位直接在本地记录里筛，零网络请求。
 */

/** 状态 chip（互斥单选） */
const LIB_STATUS_CHIPS = [
  { v: 'all', label: '全部' },
  { v: 'online', label: '在线' },
  { v: 'downloaded', label: '已下载' },
  { v: 'installed', label: '已安装' },
  { v: 'enabled', label: '已启用' },
  { v: 'disabled', label: '已禁用' },
  { v: 'partial', label: '部分启用' },
  { v: 'unreg', label: '未登记' },
  { v: 'linked', label: '已关联' }
];

/** 标记 chip（可叠加，与状态同时生效） */
/* 我的标记（用户自己打的）：三态循环。
 * 2026-11-11 用户要求：「不感兴趣」「有 bug」这种负面标签要能**排除**掉，
 * 也要能**只看它们**（好集中删 / 取消标记）——所以每颗都是 任意 → 排除 → 只看 → 任意。
 * 正面标签（喜欢 / 已验证）顺序反过来：任意 → 只看 → 排除 → 任意。 */
const LIB_MARK_CHIPS = [
  { k: 'liked', label: '👍 喜欢', neg: false },
  { k: 'blocked', label: '👎 不感兴趣', neg: true },
  { k: 'bug', label: '⚠ 有 bug', neg: true, tone: 'bad' },
  { k: 'verified', label: '✓ 已验证', neg: false, tone: 'ver' }
];

/** 记录的状态徽标 */
const LIB_BADGE = {
  busy: { t: '● 下载中', c: 'busy' },
  enabled: { t: '✓ 已启用', c: 'ok' },
  disabled: { t: '⏸ 已禁用', c: 'off' },
  partial: { t: '◐ 部分启用', c: 'part' },
  installed: { t: '✓ 已安装', c: 'ok' },
  downloaded: { t: '↓ 已下载', c: 'dl' },
  online: { t: '在线', c: '' }
};

/** 标记集合取哪个（liked / blocked / bug） */
function libMarkSet(k) {
  if (k === 'liked') return state.browse.liked;
  if (k === 'blocked') return state.browse.blocked;
  if (k === 'bug') return state.bugIds;
  if (k === 'verified') return state.verifiedIds;
  return null;
}

/** 这条记录有没有某个标记（没有 modId 的磁盘条目一律没有） */
function libHasMark(rec, k) {
  if (!rec || !rec.modId) return false;
  // 「排除」不在这里表达：它由 state.lib.marks[k] === 'ex' 在 libFilterRecords 里处理
  const s = libMarkSet(k);
  return !!(s && typeof s.has === 'function' && s.has(String(rec.modId)));
}

/** 派生状态：不存储、实时算 */
function libStateOf(rec) {
  if (!rec) return 'online';
  const t = rec.task;
  const busyList = ['queued', 'resolving', 'downloading', 'analyzing', 'installing'];
  if (t && busyList.indexOf(String(t.status)) >= 0) return 'busy';
  if (rec.kind === 'installed') return rec.partial ? 'partial' : (rec.enabled ? 'enabled' : 'disabled');
  if (rec.kind === 'downloaded') return 'downloaded';
  return 'online';
}

/** 本地类型（服装 / CNS 换装 / 前置 / 脚本 / 内置 / 其他）—— 没有 Nexus 分类时也能筛 */
function libTypeOf(rec) {
  const text = [rec.name, rec.filename, rec.summary].filter(Boolean).join(' ').toLowerCase();
  const files = (rec.items || []).map(m => String(m.rel || m.file || '')).join(' ').toLowerCase();
  if (text.indexOf('cns') >= 0 || files.indexOf('dekcns') >= 0) return 'cns';
  if (rec.groupKind === 'prereq') return 'prereq';
  if (rec.groupKind === 'script') return 'script';
  if (rec.builtin) return 'builtin';
  if (rec.kind === 'online') return 'online';
  return 'outfit';
}

/**
 * 拼出全部记录。
 * 顺序有讲究：先已安装、再已下载、最后在线 —— 同一个 modId 只留第一条（本地优先），
 * 在线那条只把「下载量 / 点赞数 / 分类」补进来，不会盖掉本地的体积、文件数、开关状态。
 */
/** 本地档案里的「分类 / 点赞 / 更新时间」：modId → 档案（整页只取一次，纯本地） */
function libInfoOf(modId) {
  const id = Number(modId) || 0;
  if (!id) return null;
  if (!state.libInfo) state.libInfo = new Map();
  return state.libInfo.get(String(id)) || null;
}

/**
 * 给已安装 / 已下载的记录补基本信息。
 * 走主进程的 info:local —— 只读本地档案与 Nexus 目录缓存，绝不联网。
 */
function libPrefetchInfo(recs) {
  if (!state.libInfo) state.libInfo = new Map();
  if (!state.libInfoAsked) state.libInfoAsked = new Set();
  const want = [];
  for (const r of (recs || [])) {
    const id = Number(r.modId) || 0;
    if (!id) continue;
    if (r.category || libInfoOf(id)) continue;
    const k = String(id);
    if (state.libInfoAsked.has(k)) continue;
    state.libInfoAsked.add(k);
    want.push(id);
    if (want.length >= 120) break;
  }
  if (!want.length) return;
  call(window.api.info.local(want), { silent: true }).then(map => {
    if (!map) return;
    let got = 0;
    for (const k of Object.keys(map)) {
      if (!map[k]) continue;
      state.libInfo.set(String(k), map[k]);
      got++;
    }
    if (got && (state.lib.status || 'all') !== 'online') renderBrowse();
  }).catch(() => {});
}

function buildLibRecords() {
  const out = [];
  const byMod = new Map();
  const taskOf = (modId) => (state.downloads || []).find(t => Number(t.modId) === Number(modId)) || null;

  // ① 已安装（磁盘上装着的；分组键 mod:<modId> / one:<磁盘 id>）
  for (const g of (state.installedGroups || [])) {
    const modId = Number(g.modId) || 0;
    const info = modId ? libInfoOf(modId) : null;
    const rec = {
      key: g.key,
      kind: 'installed',
      modId,
      name: g.name,
      author: g.author,
      version: g.version,
      image: g.image,
      summary: g.zh,
      category: (info && (info.categoryZh || info.category)) || '',
      adult: !!(info && info.adult),
      downloads: (info && Number(info.downloads)) || 0,
      endorsements: (info && Number(info.endorsements)) || 0,
      updatedAt: (info && info.updatedAt) || '',
      link: g.link || null,
      size: g.size,
      files: g.fileCount,
      enabled: !!g.enabled,
      partial: !!g.partial,
      enabledAt: g.enabledAt || '',
      enabledAtGuess: !!g.enabledAtGuess,
      installedAt: g.mtime || '',
      groupKind: g.kind,
      builtin: !!g.builtin,
      items: g.items || [],
      group: g,
      task: modId ? taskOf(modId) : null
    };
    out.push(rec);
    if (modId) byMod.set(modId, rec);
  }

  // ② 已下载的安装包（管理器里下好、但当前游戏目录里没装的）
  for (const it of ((state.library && state.library.items) || [])) {
    const modId = Number(it.modId) || 0;
    if (!modId || byMod.has(modId)) continue;
    const meta = (typeof libMetaFor === 'function' ? libMetaFor(modId) : null) || it.info || {};
    const rec = {
      key: 'lib:' + modId,
      kind: 'downloaded',
      modId,
      name: meta.name || it.name || ('#' + modId),
      author: meta.author || '',
      version: meta.version || it.version || '',
      image: meta.coverLocal || meta.image || (typeof coverForMod === 'function' ? coverForMod(modId) : ''),
      summary: meta.summary || '',
      category: (meta.categoryZh || meta.category)
        || ((libInfoOf(modId) || {}).categoryZh) || ((libInfoOf(modId) || {}).category) || '',
      adult: !!(meta.adult || (libInfoOf(modId) || {}).adult),
      downloads: Number(meta.downloads || (libInfoOf(modId) || {}).downloads) || 0,
      endorsements: Number(meta.endorsements || (libInfoOf(modId) || {}).endorsements) || 0,
      updatedAt: meta.updatedAt || (libInfoOf(modId) || {}).updatedAt || '',
      link: null,
      size: it.size,
      filename: it.filename,
      archivePath: it.archivePath,
      lib: it,
      task: taskOf(modId)
    };
    out.push(rec);
    byMod.set(modId, rec);
  }

  // ③ 在线（Nexus 已加载到的那些）
  for (const n of (state.browse.items || [])) {
    const modId = Number(n.modId) || 0;
    if (!modId) continue;
    const prev = byMod.get(modId);
    if (prev) { prev.online = n; continue; }   // 本地已有：只补在线信息，不改状态
    const rec = {
      key: String(modId),
      kind: 'online',
      modId,
      name: n.name,
      author: n.author,
      version: n.version,
      image: n.thumbnail || n.image,
      summary: n.summary,
      downloads: n.downloads,
      endorsements: n.endorsements,
      adult: n.adult,
      category: n.category || '',
      categoryZh: n.categoryZh || '',
      updatedAt: n.updatedAt || '',
      online: n,
      task: taskOf(modId)
    };
    out.push(rec);
    byMod.set(modId, rec);
  }
  return out;
}

/** 关键词命中（名字 / 作者 / Mod ID / 版本 / 文件名 / 摘要） */
function libRecordMatches(rec, q) {
  if (!q) return true;
  const meta = rec.modId ? (typeof libMetaFor === 'function' ? libMetaFor(rec.modId) : null) : null;
  const hay = [
    rec.name, rec.author, rec.summary, rec.version, rec.filename,
    rec.modId ? '#' + rec.modId : '',
    meta ? meta.name : '', meta ? meta.author : '', meta ? meta.summary : ''
  ].concat((rec.items || []).map(m => m.rel || m.file || ''))
    .filter(Boolean).join(' ').toLowerCase();
  return hay.indexOf(q) >= 0;
}

/**
 * 成人内容那三档在合并态是「筛选」的一部分，不是「排序」的一部分 ——
 * 2026-11-11 用户指出它夹在排序行里、和下面的分类/标签不像一伙的。
 * 在线档位仍然用顶部那条 #adultTabs（Nexus 的分页要它），合并态这里出同款 chip。
 */
function libAdultChips(recs) {
  const mode = state.browse.adultMode || 'all';
  const total = (recs || []).length;
  const adultN = (recs || []).filter((r) => r && r.adult).length;
  const cnt = (n) => '<span class="n">' + Number(n).toLocaleString() + '</span>';
  const chip = (v, label, n) => '<button class="fc' + (mode === v ? ' on' : '') + '" data-adult="' + v + '">' + label + cnt(n) + '</button>';
  return chip('hide', '隐藏成人内容', Math.max(0, total - adultN))
    + chip('all', '全部内容', total)
    + chip('only', '只显示成人内容', adultN);
}

/** 按当前状态 / 标记 / 类型 / 关键词筛记录（纯计算，不碰 DOM） */
function libFilterRecords(recs) {
  const st = state.lib.status || 'all';
  const marks = state.lib.marks || {};
  // 顶栏搜索框与老「已安装」搜索框共用一个关键词（用户在 Mod 库里只有一个搜索框）
  const q = String(state.browse.search || state.instFilters.q || '').trim().toLowerCase();
  const hideBlocked = state.browse.blockMode === 'hide';

  // 分类筛选：在线档位记的是 Nexus facets 的英文 value，本地记录是档案里的中文名，
  // 两套词表不能直接比 —— 先翻译，翻不出且一条都匹配不上就当作没选分类。
  // 上次会话带回来的分类只对「在线」档位生效：合并档位要等用户自己点过分类 chip（catSet），
  // 否则一进 Mod 库就被旧分类筛成几十个，看起来像「少了很多 Mod」。
  const catRaw = String((st === 'online' || state.lib.catSet) ? (state.browse.category || '') : '');
  const catZh = (function () {
    if (!catRaw) return '';
    const f = state.browse.facets;
    if (f && Array.isArray(f.categories)) {
      const hit = f.categories.find(c => String(c.value) === catRaw);
      if (hit && hit.zh) return String(hit.zh);
    }
    return catRaw;
  })();
  const catOk = (rec) => {
    const v = String(rec.categoryZh || rec.category || '');
    return v === catZh || v === catRaw;
  };
  const catActive = !!catRaw && (recs || []).some(catOk);

  return (recs || []).filter(rec => {
    const s = libStateOf(rec);
    if (st === 'online') { if (rec.kind !== 'online' && !rec.online) return false; }
    else if (st === 'downloaded') { if (rec.kind !== 'downloaded') return false; }
    else if (st === 'installed') { if (rec.kind !== 'installed') return false; }
    else if (st === 'enabled') { if (s !== 'enabled') return false; }
    else if (st === 'disabled') { if (s !== 'disabled') return false; }
    else if (st === 'partial') { if (s !== 'partial') return false; }
    else if (st === 'unreg') { if (rec.modId) return false; }
    else if (st === 'linked') { if (!rec.link) return false; }

    // 我的标记：四类各自三态（'' 任意 / 'in' 只看有 / 'ex' 排除掉有）
    for (const k of ['liked', 'blocked', 'bug', 'verified']) {
      const mode = marks[k] || '';
      if (!mode) continue;
      const has = libHasMark(rec, k);
      if (mode === 'in' && !has) return false;
      if (mode === 'ex' && has) return false;
    }
    // 黑名单默认不显示（老行为）；用户主动「只看不感兴趣」时当然要显示出来
    if (hideBlocked && marks.blocked !== 'in' && libHasMark(rec, 'blocked')) return false;

    // 分类（本地记录靠 Nexus 档案补，补不到就不参与分类筛）
    if (catActive && !catOk(rec)) return false;
    // 成人内容三档
    const am = state.browse.adultMode || 'all';
    if (am === 'hide' && rec.adult) return false;
    if (am === 'only' && !rec.adult) return false;
    // 标签（本地记录一般没有标签数据，没数据就不参与这层筛选）
    const tags = Array.isArray(state.browse.tags) ? state.browse.tags : [];
    if (tags.length && Array.isArray(rec.tags) && rec.tags.length
      && !tags.some(t => rec.tags.indexOf(t) >= 0)) return false;
    // UE4SS 自带脚本：默认藏起来（和老「已安装」页的开关同一个口径）
    if (!state.showBuiltin && rec.builtin) return false;
    if (!libRecordMatches(rec, q)) return false;   // 不命中就剔掉
    return true;
  });
}

/** 状态 chip 后面的计数（各档有多少条） */
function libStatusCounts(recs) {
  const c = { all: recs.length, online: 0, downloaded: 0, installed: 0, enabled: 0, disabled: 0, partial: 0, unreg: 0, linked: 0 };
  for (const rec of recs) {
    const s = libStateOf(rec);
    if (rec.kind === 'installed') c.installed++;
    else if (rec.kind === 'downloaded') c.downloaded++;
    else if (rec.kind === 'online' || rec.online) c.online++;
    if (s === 'enabled') c.enabled++;
    else if (s === 'disabled') c.disabled++;
    else if (s === 'partial') c.partial++;
    if (!rec.modId) c.unreg++;
    else if (rec.link) c.linked++;
  }
  return c;
}

/** 画顶部状态行（chip + 类型下拉 + 标记 chip） */
function paintLibHead(recs) {
  { const s = $('#libSort'); if (s) s.style.display = ''; }
  // 顶部这几组控件（在线排序 / 成人范围 / 打开 Nexus）合并后仍然留着，
  // 选中态在这里统一同步 —— 老浏览页那套只在自己的渲染路径里同步。
  $$('#sortTabs button').forEach(x => x.classList.toggle('on', x.dataset.sort === (state.browse.sort || 'downloads')));
  $$('#adultTabs button').forEach(x => x.classList.toggle('on', x.dataset.adult === (state.browse.adultMode || 'all')));
  { const bs = $('#libBuiltin'); if (bs) bs.classList.toggle('on', !!state.showBuiltin); }
  const counts = libStatusCounts(recs || []);
  const st = state.lib.status || 'all';
  const box = $('#libStatus');
  if (box) {
    box.innerHTML = LIB_STATUS_CHIPS.map(c => {
      const n = counts[c.v];
      const num = typeof n === 'number' && c.v !== 'all' ? `<span class="dir">${fmtNum(n)}</span>` : '';
      return `<button data-libst="${c.v}" class="${st === c.v ? 'on' : ''}">${c.label}${num}</button>`;
    }).join('');
  }
  const marks = $('#libMarks');
  if (marks) {
    const cur = state.lib.marks || {};
    const n = (recs || []).filter(r => libHasMark(r, 'bug')).length;   // 仅用于占位提示，见下
    void n;
    marks.innerHTML = LIB_MARK_CHIPS.map(ch => {
      const mode = cur[ch.k] || '';
      const hit = (recs || []).filter(r => libHasMark(r, ch.k)).length;
      const cnt = mode === 'ex' ? (recs || []).length - hit : hit;
      const tone = ch.tone ? ` tone-${ch.tone}` : '';
      const cls = mode === 'in' ? ' on' : (mode === 'ex' ? ' ex' : '');
      const flag = mode === 'in' ? '只看' : (mode === 'ex' ? '排除' : '任意');
      const tip = `${ch.label}：现在是「${flag}」—— 再点一下切到${mode === '' ? (ch.neg ? '排除' : '只看') : (mode === (ch.neg ? 'ex' : 'in') ? (ch.neg ? '只看' : '排除') : '任意')}`;
      return `<button data-libmk="${ch.k}" class="${cls.trim()}${tone}" title="${tip}">${ch.label}<span class="dir">${flag} ${fmtNum(cnt)}</span></button>`;
    }).join('');
  }
}

/** 一条本地记录的卡片（在线记录仍用 browseCard，两套复用同一批 CSS 类） */
// Mod 库的排序方式（0.5.3）。默认档位不动：状态优先、组内保持原顺序；
// 「开启时间」是排查崩溃时最常用的 —— 新开的 Mod 最可疑。
const LIB_SORTS = [
  { value: '', label: '默认', title: '按状态分组，保持原来的顺序' },
  { value: 'on-desc', label: '开启时间 ↓', title: '最近开启的排最前 —— 崩了先看它' },
  { value: 'on-asc', label: '开启时间 ↑', title: '最早开启的排最前' },
  { value: 'inst-desc', label: '安装时间 ↓', title: '最近装的排最前' },
  { value: 'name', label: '名称', title: '按名称排' }
];

/** 按 `state.lib.sort` 排一下；没有时间戳的记录始终排在后面（不参与比较） */
function applyLibSort(recs) {
  const mode = state.lib.sort || '';
  // 在线排序（下载最多 / 最多点赞 / 最新发布 / 最近更新）在合并档位里按本地拿到的
  // 同一批字段排：Nexus 分页只加载了一部分，但至少保证「看得见的那批」顺序正确。
  const online = state.browse.sort || 'downloads';
  const byOnline = !mode && (online === 'downloads' || online === 'endorsements'
    || online === 'newest' || online === 'updated');
  if (!mode && !byOnline) return recs;
  const out = recs.slice();
  const timeOf = (r) => (mode.startsWith('on') ? r.enabledAt : (r.installedAt || r.enabledAt)) || '';
  const dir = mode.endsWith('desc') ? -1 : 1;
  out.sort((a, b) => {
    if (mode === 'name') {
      const x = String(a.name || '').toLowerCase();
      const y = String(b.name || '').toLowerCase();
      return x < y ? -1 : (x > y ? 1 : 0);
    }
    if (byOnline) {
      if (online === 'downloads' || online === 'endorsements') {
        const fa = Number(a[online]) || 0;
        const fb = Number(b[online]) || 0;
        if (!fa && !fb) return 0;
        if (!fa) return 1;      // 没数字的沉底
        if (!fb) return -1;
        return fb - fa;
      }
      const ua = a.updatedAt || '';
      const ub = b.updatedAt || '';
      if (!ua && !ub) return 0;
      if (!ua) return 1;
      if (!ub) return -1;
      return ua < ub ? 1 : (ua > ub ? -1 : 0);   // 新的在前
    }
    const ta = timeOf(a), tb = timeOf(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;          // 没时间的沉底
    if (!tb) return -1;
    return ta < tb ? -dir : (ta > tb ? dir : 0);
  });
  return out;
}

function libCard(rec) {
  const s = libStateOf(rec);
  const b = LIB_BADGE[s] || LIB_BADGE.online;
  const key = rec.key;
  const selOn = state.sel.ids.has(key);
  const isBug = libHasMark(rec, 'bug');
  const isVer = libHasMark(rec, 'verified');
  const isLiked = libHasMark(rec, 'liked');
  const isBlocked = libHasMark(rec, 'blocked');
  const img = rec.image || (rec.modId && typeof coverForMod === 'function' ? coverForMod(rec.modId) : '');

  /* 2026-11-11 用户要求「卡片上的信息各说一次，别重复显示、别挤在一起」：
   * 封面右上角**只留状态徽标**（在线/已下载/已安装…），
   * 标记、类型、文件数统一排到信息区第一行（.ctags），
   * 第二行是纯数字/文字元信息（.meta），最后一行放按钮（.acts）。
   * 以前 bug/已验证 在封面角标和元信息里各出现一次，就是用户说的「标签显示了两次」。 */
  const typeZh = ({ cns: 'CNS 换装', prereq: '前置', script: '脚本', builtin: '内置', outfit: '服装', online: '在线' })[libTypeOf(rec)] || '';
  const tags = [
    isBlocked ? '<span class="tag bad" title="你点过「不感兴趣」（黑名单）">👎 不感兴趣</span>' : '',
    isBug ? '<span class="tag bug" title="你标记过这个 Mod 有 bug —— 批量安装时会先问一句要不要跳过">⚠ 有 bug</span>' : '',
    isVer ? '<span class="tag ver" title="我实测过它能用">✓ 已验证</span>' : '',
    isLiked ? '<span class="tag like" title="你点过喜欢">👍 喜欢</span>' : '',
    typeZh ? `<span class="tag" title="类型">${typeZh}</span>` : '',
    (rec.kind === 'installed' && rec.files) ? `<span class="tag nfile" title="这个 Mod 装了 ${rec.files} 个文件">${rec.files} 个文件</span>` : ''
  ].filter(Boolean).join('');

  // 元信息：只用「·」分隔的纯文字，不再套 chip，避免一行里三四种边框互相挤
  const metaBits = [];
  if (rec.modId) metaBits.push(`#${rec.modId}`);
  if (rec.version) metaBits.push(esc(verText(rec.version)));
  if (rec.author) metaBits.push(esc(rec.author));
  if (typeof rec.size === 'number') metaBits.push(fmtSize(rec.size));
  if (rec.kind === 'online') metaBits.push(`⬇ ${fmtNum(rec.downloads)} · ♥ ${fmtNum(rec.endorsements)}`);
  if (rec.enabledAt) metaBits.push(`开启于 ${esc(fmtWhen(rec.enabledAt))}`);
  const meta = metaBits.map((t, i) => (i ? '<span class="sep">·</span>' : '') + `<span>${t}</span>`).join('');

  // 动作：按状态给主按钮，其余塞进次按钮（都能在抽屉里找到更全的）
  let acts = '';
  if (rec.kind === 'installed') {
    acts = `<button class="btn sm" data-lopen="${esc(key)}" title="看文件、来源和逐文件开关">详情</button>`;
  } else if (rec.kind === 'downloaded') {
    acts = `<button class="btn sm p" data-lib-install="${rec.modId}" title="安装包已经在管理器里（不用再下一次），直接装进游戏目录">安装</button>`
      + `<button class="btn sm" data-libreveal="${rec.modId}" title="在资源管理器里定位这个安装包">定位</button>`
      + `<button class="btn sm d" data-libdel="${rec.modId}" title="只删安装包，不动用户标记（喜欢 / 不感兴趣 / 有 bug）">删包</button>`;
  } else {
    acts = `<button class="btn sm" data-dl-add="${rec.modId}" title="加入下载队列（之后自动下载并安装）">⬇ 下载</button>`;
  }
  // 「已验证」那颗按钮：只有认得出 Nexus modId 的条目才标得上（标记靠 modId 认人）
  const verBtn = rec.modId
    ? `<button class="btn sm ver${isVer ? ' on' : ''}" data-libver="${rec.modId}" title="${isVer ? '点一下取消「已验证」标记' : '我实测过它能用 —— 打上「已验证」，之后可以按这个筛'}">${isVer ? '✓ 已验证' : '标记'}</button>`
    : '';
  if (verBtn) acts += verBtn;
  const vote = rec.modId ? voteHtml({ modId: rec.modId }) : '';
  const sw = rec.kind === 'installed' && rec.groupKind !== 'prereq'
    ? `<button class="sw${rec.enabled ? '' : ' off'}${rec.partial ? ' part' : ''}" data-gtoggle="${esc(key)}" title="${rec.partial ? '部分文件已启用 —— 点击全部启用' : (rec.enabled ? '点击禁用' : '点击启用')}"></button>`
    : '';

  return `
  <div class="card${selOn ? ' sel' : ''}${isBug ? ' hasbug' : ''}${rec.kind === 'installed' && !rec.enabled ? ' off' : ''}" data-lkey="${esc(key)}"${rec.modId ? ` data-modid="${rec.modId}"` : ''}>
    <div class="cover">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'无封面图'}))">`
        : `<div class="ph">${rec.kind === 'installed' ? '本地文件<br>无封面图' : '无封面图'}</div>`}
      <div class="ck${selOn ? ' on' : ''}" data-lck="${esc(key)}">✓</div>
      <span class="lb ${b.c}">${b.t}</span>
    </div>
    <div class="cbody">
      <h3 data-i18n-skip title="${esc(rec.name)}">${esc(rec.name)}</h3>
      <div class="zh" data-i18n-skip title="${esc(rec.summary || '')}">${esc(rec.summary || (rec.kind === 'installed' ? '本地已安装' : '—'))}</div>
      ${tags ? `<div class="ctags">${tags}</div>` : ''}
      <div class="meta" data-i18n-skip>${meta}</div>
      <div class="acts">${vote}${acts}</div>
    </div>
  </div>`;
}

/** 统一渲染（状态 === 'online' 时仍走原来的 Nexus 分页路径，见 renderBrowse） */
/**
 * 合并档位的分类筛选条。
 * 老浏览页的分类 chips 来自 Nexus 的 facets（只覆盖在线那批），合并后要按「当前全部记录」
 * 重算 —— 已安装 / 已下载的分类靠 Nexus 档案补（见 libPrefetchInfo）。
 */
function renderLibFilters(recs) {
  const box = $('#browseFilters');
  if (!box) return;
  const cur = String(state.browse.category || '');
  const catMap = new Map();
  for (const r of (recs || [])) {
    const zh = String(r.categoryZh || r.category || '').trim();
    if (!zh) continue;
    catMap.set(zh, (catMap.get(zh) || 0) + 1);
  }
  if (!catMap.size) {
    box.innerHTML = '<div class="frow"><span class="fl">分类</span><div class="fchips"><span class="fnote" style="margin:0">本地记录的分类要等 Nexus 信息补全后才出现</span></div>'
      + '<span class="fl sep">成人</span><div class="fchips">' + libAdultChips(recs) + '</div></div>';
    return;
  }
  const cnt = (n) => '<span class="n">' + Number(n).toLocaleString() + '</span>';
  const list = [{ value: '', zh: '全部', count: (recs || []).length }]
    .concat([...catMap.entries()].sort((x, y) => y[1] - x[1])
      .map(([zh, n]) => ({ value: zh, zh, count: n })));
  const chips = list.map(c => '<button class="fc' + (cur === c.value ? ' on' : '')
    + '" data-cat="' + esc(c.value) + '">' + esc(c.zh) + cnt(c.count) + '</button>').join('');
  box.innerHTML = '<div class="frow"><span class="fl">分类</span>'
    + '<div class="fchips">' + chips + '</div>'
    + (cur ? '<button class="fclear" id="btnClearFilter">清除筛选</button>' : '')
    + '<span class="fl sep">成人</span><div class="fchips">' + libAdultChips(recs) + '</div>'
    + '</div>';
}

// 2026-11-11：顶部改成「筛选 / 排序 / 操作」三块（写在 index.html 里，不再搬节点），
// 每块一行、不换行横向滚动 —— 之前五行 254px 的挤法用户说像「控件叠在一起」。
function renderLibMerged() {
  // 合并态的成人档在筛选区（libAdultRow），顶部这条只在在线档位用
  { const ad = $('#adultTabs'); if (ad) ad.style.display = 'none'; }
  const area = $('#browseArea');
  if (!area) return;
  // 这两份数据以前都是别的页面顺手准备好的（已安装页 / 下载页）；
  // Mod 库现在是首页，第一次进来得自己备齐，否则只剩「在线」那一条来源。
  if ((!state.installedGroups || !state.installedGroups.length) && state.game && state.game.found) {
    try { renderInstalled(); } catch (e) { console.warn('[Mod 库] 预取已安装分组失败', e); }
  }
  if (!state.library && !state.libLibAsked) {
    state.libLibAsked = true;
    if (typeof refreshLibrary === 'function') {
      refreshLibrary().then(() => { if ((state.lib.status || 'all') !== 'online') renderBrowse(); }).catch(() => {});
    }
  }
  const recs = buildLibRecords();
  state.libRecords = recs;
  const shown = applyLibSort(libFilterRecords(recs));
  state.libShownRecords = shown;
  paintLibHead(recs);
  renderLibFilters(recs);
  libPrefetchInfo(recs);

  const stats = $('#browseStats');
  const more = $('#btnLoadMore');
  const st = state.lib.status || 'all';
  if (stats) {
    const parts = [`共 <b>${fmtNum(shown.length)}</b> 个 Mod`];
    const c = libStatusCounts(recs);
    parts.push(`已安装 ${fmtNum(c.installed)} · 已下载 ${fmtNum(c.downloaded)} · 在线 ${fmtNum(c.online)}`);
    if (shown.length !== recs.length) parts.push(`（筛选自 ${fmtNum(recs.length)} 个）`);
    const q = String(state.browse.search || state.instFilters.q || '').trim();
    if (q) parts.push(`关键词「${esc(q)}」`);
    stats.innerHTML = parts.join(' · ');
  }
  if (more) {
    // 在线那一档才需要「加载更多」；本地档位是本地全量，没有翻页
    const need = st === 'online' && !state.browse.done;
    more.style.display = need ? '' : 'none';
    if (need) {
      more.disabled = !!state.browse.loading;
      more.textContent = state.browse.loading ? '加载中…' : `加载更多（还有 ${fmtNum(browseRest(state.browse))} 个）`;
    }
  }

  if (!shown.length) {
    const why = recs.length ? '没有符合当前筛选的 Mod —— 换个状态 / 类型，或者把标记筛选关掉' : '还没加载到任何 Mod';
    area.innerHTML = `<div class="grid"><div class="empty">${why}</div></div>`;
  } else {
    const cards = shown.map(r => (r.kind === 'online' ? browseCard(r.online || r) : libCard(r))).join('');
    area.innerHTML = `<div class="grid">${cards}</div>`;
  }
  selUpdateBar();
}

/** 切状态（导航「已安装 Mod」的老入口也走它） */
function setLibStatus(v, opts = {}) {
  const val = LIB_STATUS_CHIPS.some(c => c.v === v) ? v : 'all';
  if (state.lib.status === val && !opts.force) return;
  state.lib.status = val;
  // 「只看未安装 / 已下载」这两颗老开关会跟新状态打架，切状态时一并清掉
  state.browse.onlyUninstalled = false;
  state.browse.onlyDownloaded = false;
  if (!opts.silent) {
    if (val === 'online' && !state.browse.items.length && !state.browse.loading) loadBrowse(true);
    else renderBrowse();
  }
}

/** 标记筛选开 / 关 */
/**
 * 切换某个 Mod 的「已验证」标记（用户 2026-11-10：实测好用的可以标为已验证）。
 * 与「有 bug」同一套存法（主进程 verified.json，键只有 Nexus modId），
 * 所以删掉 Mod 文件也不会丢标记 —— 那条数据跟文件无关。
 */
async function toggleVerified(modId, name) {
  const id = Number(modId) || 0;
  if (!id) { toast('这个条目没有 Nexus Mod ID，没法标记（标记靠 Mod ID 认人）', 'warn'); return; }
  const on = state.verifiedIds.has(String(id));
  try {
    if (on) await call(window.api.verified.remove(id));
    else await call(window.api.verified.add(id, { name: name || '' }));
  } catch { return; /* call() 已提示 */ }
  await loadVerified();
  toast(on ? `已取消「已验证」标记${name ? '：' + name : ''}` : `已标记为已验证${name ? '：' + name : ''} —— 之后可以按「已验证」筛`, 'ok');
  renderBrowse();
}

/** 已安装抽屉底部那颗「标为已验证」（与「有 bug」并排） */
async function doVerifyToggleGroup(key) {
  const g = groupOf(key);
  if (!g) return;
  const meta = g.meta || {};
  const src = meta.source || {};
  const modId = Number(g.modId || src.modId || meta.modId || 0) || 0;
  await toggleVerified(modId, g.name);
  reopenInstalledDrawer(key);
}

/**
 * 我的标记：三态循环。
 * 负面标记（不感兴趣、有 bug）：任意 → 排除 → 只看 → 任意（第一下先把它们藏起来，
 * 正常浏览不碍眼；想看时再点一下变成「只看」，方便一次挑出来删掉或取消标记）。
 * 正面标记（喜欢、已验证）：任意 → 只看 → 排除 → 任意。
 */
function toggleLibMark(k) {
  if (!state.lib.marks) state.lib.marks = { liked: '', blocked: '', bug: '', verified: '' };
  const neg = !!(LIB_MARK_CHIPS.find(c => c.k === k) || {}).neg;
  const cur = state.lib.marks[k] || '';
  const order = neg ? ['', 'ex', 'in'] : ['', 'in', 'ex'];
  state.lib.marks[k] = order[(order.indexOf(cur) + 1) % order.length];
  renderBrowse();
}

/** 多选：按记录键（mod:<id> / lib:<id> / 在线就是 modId 字符串） */
/**
 * 多选态点卡片：Shift = 选中一段（按当前列表顺序），Ctrl/Cmd = 追加，普通点 = 反选自己。
 * 合并列表里既有本地记录（data-lkey）也有在线卡，所以顺序表也按同一个键取。
 */
function libClickSelect(key, e) {
  const k = String(key);
  if (e && e.shiftKey) { libRangeTo(k, !!(e.ctrlKey || e.metaKey)); return; }
  state.libAnchor = k;
  libToggleSelect(k);
}

/** 当前列表里可选的键，按屏幕上看到的顺序（Shift 连选靠它算区间） */
function libOrderKeys() {
  const recs = (state.libShownRecords && state.libShownRecords.length) ? state.libShownRecords : [];
  return recs.map(r => (r.kind === 'online' ? String(r.modId) : r.key));
}

/** 把卡片的勾选外观跟 state.sel.ids 对齐（Shift 一次选一片时用） */
function libSyncCards() {
  document.querySelectorAll('#browseArea .card').forEach(c => {
    const k = String(c.getAttribute('data-lkey') || c.getAttribute('data-modid') || '');
    const on = state.sel.ids.has(k);
    c.classList.toggle('sel', on);
    const box = c.querySelector('.ck');
    if (box) box.classList.toggle('on', on);
  });
}

/** Shift 连选：从上次点的锚点到这一张，整段选中（additive=true 时不清空原有选择） */
function libRangeTo(key, additive) {
  const order = libOrderKeys();
  const to = order.indexOf(String(key));
  if (to < 0) return;
  const at = order.indexOf(String(state.libAnchor || ''));
  if (at < 0) { state.libAnchor = String(key); libToggleSelect(key); return; }
  if (!additive) state.sel.ids.clear();
  const a = Math.min(at, to), b = Math.max(at, to);
  for (let i = a; i <= b; i++) state.sel.ids.add(order[i]);
  state.sel.all = false;
  libSyncCards();
  selUpdateBar();
}

function libToggleSelect(key) {
  const k = String(key);
  if (state.sel.ids.has(k)) state.sel.ids.delete(k); else state.sel.ids.add(k);
  state.sel.all = false;
  const cards = document.querySelectorAll('#browseArea .card');
  cards.forEach(c => {
    const ck = c.getAttribute('data-lkey') || c.getAttribute('data-modid') || '';
    if (String(ck) !== k) return;
    const on = state.sel.ids.has(k);
    c.classList.toggle('sel', on);
    const box = c.querySelector('.ck');
    if (box) box.classList.toggle('on', on);
  });
  selUpdateBar();
}

/** 打开一条记录的详情：装着 → 已安装抽屉；有 modId → Nexus 抽屉 */
function libOpenRecord(key) {
  const rec = (state.libRecords || []).find(r => r.key === key);
  if (!rec) return;
  if (rec.kind === 'installed' && rec.group) { openInstalledDrawer(rec.group); return; }
  if (rec.modId) { openNexusDrawer(Number(rec.modId)); return; }
  toast('这条没有 Nexus Mod ID，先用「批量解析」把它对上号');
}

/** 全选口径：本地档位用记录键，在线档位用 modId */
function libSelectableKeys() {
  if (state.lib.status === 'online') return (state.browse.items || []).map(n => String(n.modId));
  const recs = (state.libShownRecords && state.libShownRecords.length) ? state.libShownRecords : [];
  return recs.map(r => (r.kind === 'online' ? String(r.modId) : r.key));
}

/** 当前选中的记录（按种类分开，批量按钮据此决定能不能点） */
function libSelectedRecords() {
  const ids = state.sel.ids;
  const out = { installed: [], downloaded: [], online: [] };
  for (const rec of (state.libRecords || [])) {
    const key = rec.kind === 'online' ? String(rec.modId) : rec.key;
    if (!ids.has(key)) continue;
    if (rec.kind === 'installed') out.installed.push(rec);
    else if (rec.kind === 'downloaded') out.downloaded.push(rec);
    else out.online.push(rec);
  }
  return out;
}

/** 批量安装选中的安装包（把选择集换成 modId 交给老的 libBatchInstall） */
async function libBatchInstallSel() {
  const sel = libSelectedRecords();
  const items = (state.library && state.library.items) || [];
  const ids = new Set(sel.downloaded.map(r => String(r.modId)));
  if (!ids.size) { toast('先勾选「已下载」的包（状态切到「已下载」最好挑）'); return; }
  const picked = items.filter(it => ids.has(String(it.modId)));
  await libBatchInstall(picked);
}

/** 批量启用 / 禁用选中的已安装 Mod */
async function libBatchToggleSel(target) {
  const sel = libSelectedRecords();
  if (!sel.installed.length) { toast('先勾选「已安装」的 Mod'); return; }
  await gselBatchToggle(!!target, sel.installed.map(r => r.group));
}

/** 批量卸载选中的已安装 Mod */
async function libBatchUninstallSel() {
  const sel = libSelectedRecords();
  if (!sel.installed.length) { toast('先勾选「已安装」的 Mod'); return; }
  await gselBatchUninstall(sel.installed.map(r => r.group));
}

function renderBrowse() {
  // 统一 Mod 库（2026-11-10）：除「只看在线」这一档，其余都由本地记录渲染 —— 零网络请求。
  // 在线那一档继续走原来的 Nexus 分页引擎（分类 / 标签 / 成人 / 加载更多都在）。
  if ((state.lib.status || 'all') !== 'online') { renderLibMerged(); return; }
  // 「开启时间 / 安装时间」是本地记录的排序；在线档位用的是 Nexus 的排序标签，
  // 两个下拉同时出现会让人不知道该用哪个 —— 在线时把本地这个藏起来。
  { const s = $('#libSort'); if (s) s.style.display = 'none'; }
  { const ad = $('#adultTabs'); if (ad) ad.style.display = ''; }
  const b = state.browse;
  const area = $('#browseArea');
  renderBrowseFilters();
  if (b.onlyDownloaded) {
    renderBrowseDownloaded();
    return;
  }
  if (b.loading && !b.items.length) {
    area.innerHTML = `<div class="grid">${Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('')}</div>`;
    $('#browseStats').textContent = '正在从 Nexus 拉取…';
    $('#btnLoadMore').style.display = 'none';
    return;
  }
  if (!b.items.length) {
    const title = b.onlyLiked ? '还没有点过喜欢的 Mod'
      : (b.blockMode === 'only' ? '黑名单是空的' : '没有结果');
    const hint = b.onlyLiked ? '点卡片上的 👍 就会收在这里。'
      : (b.blockMode === 'only' ? '点卡片上的 👎 就会加到这里。'
      : (b.search ? '换个关键词试试。'
      : (b.category || b.tags.length || b.onlyUninstalled) ? '当前筛选条件下没有 Mod，试试放宽条件。'
      : '暂时拿不到数据，请检查网络。'));
    area.innerHTML = `<div class="empty">
      <h3>${title}</h3>
      <p>${hint}</p>
    </div>`;
    updateBrowseChrome();
    return;
  }
  // 追加过程中不动已有 DOM（只更新 chrome），否则所有封面重新解码、列表会闪
  if (!b.loading || !$('#browseArea .grid')) {
    area.innerHTML = `<div class="grid">${b.items.map(browseCard).join('')}</div>`;
  }
  updateBrowseChrome();
}

/** 统计行里显示当前成人内容范围 */
function adultSummary() {
  const m = state.browse.adultMode;
  if (m === 'hide') return ' · <span style="color:var(--dim)">已隐藏成人内容</span>';
  if (m === 'only') return ' · <span style="color:var(--accent)">仅显示成人内容</span>';
  return '';
}

/** 给统计行拼一段「当前筛选了什么」的说明 */
function filterSummary() {
  const b = state.browse;
  const parts = [];
  if (b.category) {
    const c = (b.facets && b.facets.categories || []).find(x => x.value === b.category);
    parts.push('分类「' + esc(c ? c.zh : b.category) + '」');
  }
  if (b.tags.length) {
    const all = (b.facets && b.facets.tags) || [];
    const zh = b.tags.map(t => {
      const hit = all.find(x => x.value === t);
      return esc(hit ? hit.zh : t);
    });
    parts.push('标签「' + zh.join(' / ') + '」');
  }
  if (b.onlyUninstalled) parts.push('只看未安装');
  if (b.onlyLiked) parts.push('只看喜欢');
  if (b.blockMode === 'only') parts.push('只看黑名单');
  else if (b.blockMode === 'hide' && b.blocked.size) parts.push(`已隐藏黑名单（共 ${b.blocked.size} 个）`);
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

/**
 * 这批 mod 里「已安装」的 modId 集合（「只显示未安装」筛选用）。
 *
 * 本地状态判定在主进程（`localState.js`），Nexus 没有这个筛选条件 ——
 * 只能整页拉回来再剔。取不到状态就返回空集合：**宁可少筛，也不能把没装的 mod 藏掉**。
 */
async function installedIdsOf(items) {
  const ids = items.map(m => Number(m.modId)).filter(Boolean);
  if (!ids.length) return new Set();
  try {
    const map = await call(window.api.nexus.localState(ids), { silent: true });
    const out = new Set();
    for (const k of Object.keys(map || {})) {
      if (map[k] && map[k].state === 'installed') out.add(Number(k));
    }
    return out;
  } catch { return new Set(); }
}

/**
 * 前端本地筛选：**黑名单（默认隐藏）** + 只看未安装 + **喜欢的排前面**。
 *
 * 前两者都要「整页拉回来再剔」（Nexus 没有这两个筛选条件），所以合成一处 ——
 * 分开写会让 `loadBrowse` 的续翻条件算错（见 `isLocalFiltering` 的说明）。
 *
 * ⚠️ 「喜欢的排前面」的作用范围**只是本次传入的这一批**（= 一页）：
 *    Nexus 是 24 条一页的游标分页，本地没有全量列表，不可能把第 5 页的
 *    一个喜欢项提到第 1 页去。所以口径如实写成「本页内喜欢的置顶」，
 *    别在文案里承诺「所有喜欢的都在最上面」（那是做不到的）。
 *    用稳定排序（V8 的 `Array.sort` 稳定）—— 同组内保持 Nexus 的原有排序。
 */
async function applyLocalFilter(items) {
  const b = state.browse;
  let kept = items;
  if (b.onlyUninstalled) {
    const installed = await installedIdsOf(items);
    kept = kept.filter(m => !installed.has(Number(m.modId)));
  }
  if (b.blockMode === 'hide' && b.blocked.size) {
    kept = kept.filter(m => !b.blocked.has(String(m.modId)));
  }
  if (b.liked.size) {
    const rank = (m) => (b.liked.has(String(m.modId)) ? 0 : 1);
    kept = kept.slice().sort((x, y) => rank(x) - rank(y));
  }
  return kept;
}

/**
 * 本地记录列表视图：「只看黑名单」（👎）与「只看喜欢」（👍）**共用**这一条路径。
 *
 * 都**不走 Nexus 分页**，直接渲染本地记录（`blacklist.json` / `favorites.json`）。
 *
 * 为什么不复用 `loadBrowse` 的筛选：黑名单 / 喜欢通常只有几条到几十条，
 * 而 Nexus 有 3000+ 个 mod，靠「翻页 + 过滤」要翻遍全站才凑得出来
 * （一次 24 个，翻 20 页也才 480 个）—— 用户点「只看黑名单」等半分钟还看不到东西。
 * 本地记录里存了 name/author/thumbnail，零网络请求，秒开。
 *
 * @param {'blocked'|'liked'} kind 看哪份记录
 */
async function loadLocalList(reset, kind) {
  const b = state.browse;
  const isLiked = kind === 'liked';
  const gen = (b.gen = (b.gen || 0) + 1);
  const stale = () => b.gen !== gen;
  b.loading = true;
  if (reset) {
    b.items = []; b.offset = 0;
    pageScroll.delete('p-browse');
    const el = $('#body');
    if (el) el.scrollTop = 0;
    selClear();
  }
  updateBrowseChrome();
  renderBrowse();
  try {
    let list = await call(isLiked ? window.api.favorites.list() : window.api.blacklist.list());
    if (stale()) return;
    // 本地视图里也支持搜索框 —— 本地按名字过滤（服务端筛选在这里没有意义）
    if (b.search) {
      const q = b.search.toLowerCase();
      list = (list || []).filter(x => String((x && x.name) || '').toLowerCase().includes(q));
    }
    b.items = (list || []).map(x => ({
      modId: x.modId,
      name: x.name || ('Mod #' + x.modId),
      author: x.author || '',
      thumbnail: x.thumbnail || '',
      summary: x.at
        ? ((isLiked ? '喜欢于 ' : '加入黑名单于 ') + String(x.at).slice(0, 10))
        : (isLiked ? '已加入喜欢' : '已加入黑名单'),
      blocked: !isLiked,
      liked: isLiked
    }));
    b.total = b.items.length;
    b.offset = b.items.length;
    b.done = true;   // 本地列表一次给全，没有「加载更多」
  } catch (e) {
    if (stale()) return;
    b.items = []; b.total = 0; b.done = true;
    // ⚠️ 报错句写成**两条完整字面量**，不要用 `读取${kind}失败：` 拼 ——
    //    拼出来的两个静态片段（`读取` / `失败：`）在 i18n 里是独立词条，
    //    译文会拼成「Read喜欢列表失败：」这种中英混排（实测踩过）。
    $('#browseStats').innerHTML = `<span style="color:var(--red)">${
      isLiked ? '读取喜欢列表失败：' : '读取黑名单失败：'
    }${esc(e.message)}</span>`;
  } finally {
    if (stale()) return;
    b.loading = false;
    renderBrowse();
  }
}

/** 同步顶部黑名单 tabs 的选中态 */
function updateBlockTabs() {
  const mode = state.browse.blockMode;
  $$('#blockTabs button').forEach(x => x.classList.toggle('on', x.dataset.block === mode));
}

/** 拉一次黑名单集合（启动时 / 拉黑 / 移出后维护） */
async function loadBlacklist() {
  try {
    const ids = await call(window.api.blacklist.ids(), { silent: true });
    state.browse.blocked = new Set((ids || []).map(String));
  } catch { /* 取不到就当没有黑名单 —— 宁可多显示，也不能凭空把 mod 藏掉 */ }
  updateBlockTabs();
}

/** 拉一次「喜欢」集合（启动时 / 喜欢 / 取消后维护） */
async function loadFavorites() {
  try {
    const ids = await call(window.api.favorites.ids(), { silent: true });
    state.browse.liked = new Set((ids || []).map(String));
  } catch { /* 取不到就当没有 —— 宁可少置顶，也不能凭空把 mod 藏掉 */ }
  updateLikeTabs();
}

/**
 * 拉一次「有 bug」标记集合。取不到就当**没有**：标记的用途是「提醒 / 默认跳过」，
 * 万一读失败把整批安装都拦下来（还找不到原因），比漏一次提醒更糟。
 */
async function loadBugs() {
  try {
    const ids = await call(window.api.bugs.ids(), { silent: true });
    state.bugIds = new Set((ids || []).map(String));
  } catch { /* 同上：静默当作没有标记 */ }
}

/** 「已验证」标记：主进程 verified.json 里的 modId 列表，渲染层只用 Set */
async function loadVerified() {
  try {
    const ids = await call(window.api.verified.ids(), { silent: true });
    state.verifiedIds = new Set((ids || []).map(String));
  } catch { /* 静默当作没有标记 */ }
}

/** 同步顶部「只看喜欢」按钮的选中态 */
function updateLikeTabs() {
  const on = !!state.browse.onlyLiked;
  $$('#likeTabs button').forEach(x => x.classList.toggle('on', on));
}

/* ---------------- 记住上次的筛选条件 ----------------
 *
 * 用户 2026-10-14：「设置里面增加一个选项，保存最后一次的筛选条件，不用每次都重新筛选；
 * 已安装的 mod 也是同样道理」。
 *
 * 开关在设置页（`config.rememberFilters`，默认开）。存的只有**筛选条件**：
 *   · 浏览页：排序 / 成人内容 / 只显示未安装 / 黑名单模式 / 只看喜欢 / 分类 / 标签
 *   · 已安装页：排序、是否显示 UE4SS 内置脚本
 * **不含搜索词** —— 那是临时查询，下次打开还留着上次的关键词只会让人以为列表坏了；
 * 也不含滚动位置（翻到一半的位置没有回忆价值）。
 */

/**
 * ⚠️ 首次拿到配置、把上次的筛选套回来之前，**一律不许落盘**。
 *
 * 启动时 `switchPage('p-browse')` 会先用默认筛选拉一轮列表，`loadBrowse(true)`
 * 又会顺手调 `saveFilters()` —— 350ms 防抖之后就把**默认值**写进配置，
 * 正好把上次存的筛选覆盖掉，功能会整个失效。所以这里加一道闸门。
 */
let filtersReady = false;
/** 「套用上次筛选」整个进程只做一次 —— `refreshAll()` 会被反复调用（手动刷新、装完后…） */
let filtersApplied = false;

/** 浏览页排序的合法取值（与 index.html 里的 data-sort 一一对应） */
const BROWSE_SORT_VALUES = ['downloads', 'endorsements', 'newest', 'updated'];
const ADULT_MODES = ['hide', 'all', 'only'];
const BLOCK_MODES = ['hide', 'all', 'only'];

/** 当前浏览页的筛选快照（纯函数，便于离线钉死口径） */
function browseFilterSnapshot(b) {
  const s = b || state.browse;
  return {
    sort: s.sort,
    adultMode: s.adultMode,
    onlyUninstalled: !!s.onlyUninstalled,
    blockMode: s.blockMode,
    onlyLiked: !!s.onlyLiked,
    category: s.category || '',
    tags: Array.isArray(s.tags) ? s.tags.slice() : []
  };
}

let saveFiltersTimer = null;

/**
 * 把当前筛选写回配置。开关关掉时直接跳过（不保存）。
 * 连续点几下（比如连点几个标签）只落盘一次 —— 防抖 350ms。
 */
function saveFilters() {
  if (!filtersReady) return;   // 启动恢复还没跑完，此时的状态是默认值，写下去等于把上次的筛选抹掉
  if (!state.config || state.config.rememberFilters === false) return;
  clearTimeout(saveFiltersTimer);
  saveFiltersTimer = setTimeout(() => {
    const last = {
      browse: browseFilterSnapshot(),
      installedSort: state.installedSort,
      installedSortDir: state.installedSortDir,
      showBuiltin: !!state.showBuiltin
    };
    call(window.api.config.set({ lastFilters: last }), { silent: true }).catch(() => {});
  }, 350);
}

/**
 * 启动时把上次存的筛选套回 state，并同步按钮高亮。
 *
 * 只认**合法值**：配置被手工改坏、或某个取值以后改了名，一律退回默认 ——
 * 宁可少恢复一项，也不能把界面搞成一个空列表（用户会以为 mod 没了）。
 * 返回是否真的恢复过（调用方据此决定要不要重画已安装页）。
 */
function applyLastFilters() {
  const c = state.config || {};
  if (c.rememberFilters === false) return false;
  const last = c.lastFilters;
  if (!last || typeof last !== 'object') return false;

  const b = state.browse;
  const bf = last.browse;
  if (bf && typeof bf === 'object') {
    if (BROWSE_SORT_VALUES.includes(bf.sort)) b.sort = bf.sort;
    if (ADULT_MODES.includes(bf.adultMode)) b.adultMode = bf.adultMode;
    if (BLOCK_MODES.includes(bf.blockMode)) b.blockMode = bf.blockMode;
    b.onlyUninstalled = !!bf.onlyUninstalled;
    b.onlyLiked = !!bf.onlyLiked;
    b.category = typeof bf.category === 'string' ? bf.category : '';
    b.tags = Array.isArray(bf.tags) ? bf.tags.filter(x => typeof x === 'string') : [];
    // 「只看喜欢」与「只看黑名单」互斥 —— 存档里两个都为真时留「喜欢」
    if (b.onlyLiked && b.blockMode === 'only') b.blockMode = 'hide';
  }
  if (INSTALLED_SORTS.some(s => s.value === last.installedSort)) {
    state.installedSort = last.installedSort;
  }
  // 方向：存了合法值就用存的；缺（0.2.7 及更早的快照没有这个字段）或非法 →
  // 退回**该排序方式自己的默认方向**，不能沿用上一个排序的方向（否则从「安装时间 ↓」
  // 升级过来，改成「名称」会变成 Z→A，看着像坏了）。
  state.installedSortDir = (
    SORT_DIRS.includes(last.installedSortDir) && INSTALLED_SORTS.some(s => s.value === last.installedSort)
  ) ? last.installedSortDir : sortDefaultDir(state.installedSort);
  if (typeof last.showBuiltin === 'boolean') state.showBuiltin = last.showBuiltin;
  return true;
}

/** 把 state 里的筛选同步到浏览页顶部那几组按钮（它们是静态 HTML，默认态写死在 index.html） */
function syncBrowseFilterUI() {
  const b = state.browse;
  $$('#sortTabs button').forEach(x => x.classList.toggle('on', x.dataset.sort === b.sort));
  $$('#adultTabs button').forEach(x => x.classList.toggle('on', x.dataset.adult === b.adultMode));
  $$('#newOnlyTabs button').forEach(x => x.classList.toggle('on', !!b.onlyUninstalled));
  updateBlockTabs();
  updateLikeTabs();
}

/** 就地摘掉一张卡片（调用方决定要不要同步 `b.items`） */
function removeBrowseCard(modId) {
  const card = document.querySelector(`.card[data-modid="${modId}"]`);
  if (card) card.remove();
}

/** 就地重画一张卡片（状态变了但不想整页重画 —— 整页重画会让封面重新解码、滚动位置跳） */
function replaceBrowseCard(item) {
  if (!item) return;
  const card = document.querySelector(`.card[data-modid="${item.modId}"]`);
  if (!card) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = browseCard(item);
  card.replaceWith(wrap.firstElementChild);
}

/**
 * 「🚫 不喜欢」→ 立刻加入黑名单。
 *
 * 用户要求「立刻加入」，所以界面**不等落盘**：先改内存集合、摘掉卡片，
 * IPC 异步写盘。写盘失败只提示、不回滚 —— 把卡片闪回来只会让人更困惑。
 */
async function dislikeMod(modId) {
  const b = state.browse;
  const id = String(modId);
  if (b.blocked.has(id)) return;
  const item = (b.items || []).find(x => String(x.modId) === id) || null;
  b.blocked.add(id);
  updateBlockTabs();

  if (b.blockMode === 'only' || b.onlyLiked) {
    // 「只看黑名单」/「只看喜欢」里点的 → 卡片留在原地，按钮换成「移出黑名单」
    // （卡片的数据来源是本地记录，跟黑名单的显示模式无关，摘掉反而像误触）
    replaceBrowseCard(item);
  } else {
    removeBrowseCard(id);
    if (b.blockMode === 'hide') {
      // 隐藏模式下这张卡片本来就不该在 → 从数据里也剔掉，统计行才对得上
      b.items = b.items.filter(x => String(x.modId) !== id);
      updateBrowseChrome();
    }
    selUpdateBar();
  }

  try {
    await call(window.api.blacklist.add(Number(id), item
      ? { name: item.name, author: item.author, thumbnail: item.thumbnail || item.image || null }
      : {}), { silent: true });
    toast('已加入黑名单，不再显示', 'ok');
  } catch (e) {
    toast('加入黑名单失败：' + e.message, 'err');
  }
}

/** 「♻ 移出黑名单」→ 立刻恢复显示 */
async function undislikeMod(modId) {
  const b = state.browse;
  const id = String(modId);
  b.blocked.delete(id);
  updateBlockTabs();

  if (b.blockMode === 'only' && !b.onlyLiked) {
    // 「只看黑名单」里移出 → 这张卡片该从当前视图消失
    removeBrowseCard(id);
    b.items = b.items.filter(x => String(x.modId) !== id);
    b.total = b.items.length;
    updateBrowseChrome();
    selUpdateBar();
  } else {
    replaceBrowseCard((b.items || []).find(x => String(x.modId) === id) || null);
  }

  try {
    await call(window.api.blacklist.remove(Number(id)), { silent: true });
    toast('已移出黑名单', 'ok');
  } catch (e) {
    toast('移出黑名单失败：' + e.message, 'err');
  }
}

/**
 * 「👍 喜欢」→ 立刻记下并点亮图标。
 *
 * 与 `dislikeMod()` **同一套做法**：界面不等落盘（先改内存集合、就地重画这张卡），
 * IPC 异步写盘，失败只提示不回滚 —— 把图标闪回去只会让人以为自己没点中。
 *
 * ⚠️ 与「不喜欢」最大的不同：**喜欢不隐藏任何东西**。卡片留在原地、不进不出，
 *    只是图标点亮 + 之后可以在「只看喜欢」里筛出来、在本页里排到前面。
 */
async function likeMod(modId) {
  const b = state.browse;
  const id = String(modId);
  if (b.liked.has(id)) return;
  const item = (b.items || []).find(x => String(x.modId) === id) || null;
  b.liked.add(id);
  replaceBrowseCard(item);
  try {
    await call(window.api.favorites.add(Number(id), item
      ? { name: item.name, author: item.author, thumbnail: item.thumbnail || item.image || null }
      : {}), { silent: true });
    toast('已加入喜欢', 'ok');
  } catch (e) {
    toast('加入喜欢失败：' + e.message, 'err');
  }
}

/** 「👍 再点一次」→ 取消喜欢（在「只看喜欢」视图里点就是把卡片从这里移出去） */
async function unlikeMod(modId) {
  const b = state.browse;
  const id = String(modId);
  b.liked.delete(id);
  if (b.onlyLiked) {
    removeBrowseCard(id);
    b.items = b.items.filter(x => String(x.modId) !== id);
    b.total = b.items.length;
    updateBrowseChrome();
    selUpdateBar();
  } else {
    replaceBrowseCard((b.items || []).find(x => String(x.modId) === id) || null);
  }
  try {
    await call(window.api.favorites.remove(Number(id)), { silent: true });
    toast('已取消喜欢', 'ok');
  } catch (e) {
    toast('取消喜欢失败：' + e.message, 'err');
  }
}

async function loadBrowse(reset) {
  const b = state.browse;
  // 「只看喜欢」/「只看黑名单」都走本地记录，不碰 Nexus（见 `loadLocalList` 的说明）
  if (b.onlyLiked) return loadLocalList(reset, 'liked');
  if (b.blockMode === 'only') return loadLocalList(reset, 'blocked');
  // 代际令牌：reset（换筛选/排序/搜索）要能**抢占**正在飞的追加请求，
  // 否则「加载更多」途中点筛选会被静默忽略，旧页数据还会混进新结果。
  // 追加请求撞车仍然直接忽略（有请求在飞就够了）。
  if (b.loading && !reset) return;
  const gen = (b.gen = (b.gen || 0) + 1);
  const stale = () => b.gen !== gen;
  b.loading = true;
  if (reset) {
    b.items = []; b.offset = 0; b.done = false;
    // 筛选/排序/搜索变了，旧的滚动位置作废 —— 回到第一页并置顶
    pageScroll.delete('p-browse');
    const el = $('#body');
    if (el) el.scrollTop = 0;
    selClear();   // 旧选择对应的 Mod 可能已经不在列表里了
    // 所有筛选入口（排序 / 成人内容 / 未安装 / 黑名单 / 喜欢 / 分类 / 标签）最终都会
    // 走到这里，所以「记住筛选」只需在这一处挂钩，不用改 8 个点击处理。
    saveFilters();
  }
  const before = b.items.length;
  updateBrowseChrome();   // 按钮立刻变「加载中…」
  renderBrowse();
  // 分类计数按整个游戏算（不随筛选变），标签计数随分类变 —— 所以只在分类变化时重取。
  // 成人内容范围（三态）也会改变计数，必须一起纳入判定，否则会出现
  // 「筛选器说 3063、列表只有 1772」的自相矛盾。
  const facetKey = b.category + '|' + b.adultMode;
  const needFacets = !b.facets || b.facets.__key !== facetKey;
  // 计数请求只发一次（复用同一个 promise，循环里每轮都 await 它）
  const facetsP = needFacets
    ? call(window.api.nexus.facets({ category: b.category, adultMode: b.adultMode }))
    : Promise.resolve(null);
  // 🔴 `b.offset` 必须按**服务端**推进（`+= page.items.length`），不能用 `b.items.length`：
  //    「只看未安装」会剔掉一部分，用 items 长度当偏移会把同一页反复请求，还会重复追加。
  let guard = 0;
  try {
    for (;;) {
      const [page, facets] = await Promise.all([
        call(window.api.nexus.list({
          sort: b.sort, search: b.search, offset: b.offset, count: BROWSE_PAGE,
          adultMode: b.adultMode, category: b.category, tags: b.tags
        })),
        facetsP
      ]);
      if (stale()) return;   // 已被更新的 reset 抢占，别把旧页数据混进来
      // 降级（计数取不到）的结果**不写 __key** —— 否则一次网络抖动会让计数永久消失，
      // 下次加载还会重试。但也不能整个丢掉，否则第一次就失败时筛选器根本不出现。
      if (facets) {
        if (!facets.degraded) { facets.__key = facetKey; b.facets = facets; }
        else if (!b.facets) { b.facets = facets; }
      }
      b.total = page.total;
      const kept = await applyLocalFilter(page.items);
      b.items = b.items.concat(kept);
      b.offset += page.items.length;
      b.done = page.items.length < BROWSE_PAGE;
      // 剔完不满一屏就自动往后翻 —— 否则用户对着半屏空白，还得自己滚一下才补上
      if (!isLocalFiltering(b) || b.done || b.items.length - before >= BROWSE_PAGE) break;
      // 兜底：极端情况（这一片 mod 几乎全都装过）不能把整个站翻完
      if (++guard >= 20) { b.done = true; break; }
      updateBrowseChrome();   // 续翻期间按钮保持「加载中…」
    }
  } catch (e) {
    if (stale()) return;
    if (!b.items.length) $('#browseStats').innerHTML = `<span style="color:var(--red)">加载失败：${esc(e.message)}</span>`;
    else toast('加载更多失败：' + e.message);   // 已有列表在眼前，别把人踹回空态
  } finally {
    if (stale()) return;   // 旧请求的收尾一律跳过（loading 属于新请求）
    b.loading = false;
    // 追加模式：只把新卡片接到 .grid 末尾，别整页重画（否则图片重新解码、滚动位置跳）
    if (!reset && before > 0 && b.items.length > before) {
      const grid = $('#browseArea .grid');
      if (grid) {
        // 「全选」状态下新追加的卡片自动并入选择（用户意图是「全都要」）
        if (state.sel.all) for (let i = before; i < b.items.length; i++) state.sel.ids.add(String(b.items[i].modId));
        for (let i = before; i < b.items.length; i++) {
          const div = document.createElement('div');
          div.innerHTML = browseCard(b.items[i]);
          grid.appendChild(div.firstElementChild);
        }
        updateBrowseChrome();
        selUpdateBar();
      } else {
        renderBrowse();
      }
    } else {
      renderBrowse();
    }
  }
}

/**
 * 只刷新当前列表里各卡片的「本地状态」，不重新拉页面数据。
 * 装完一个 mod 后用它局部更新 —— 整页重载会丢滚动位置、白跑一次网络请求。
 */
async function refreshCardStates() {
  const b = state.browse;
  const items = b.items || [];
  const ids = items.map(m => Number(m.modId)).filter(Boolean);
  if (!ids.length) return;

  let map = {};
  try { map = await call(window.api.nexus.localState(ids), { silent: true }); }
  catch { return; }  // 状态是增强信息，取不到就别动界面

  let changed = false;
  const dirty = [];
  for (const m of items) {
    const next = map[String(m.modId)] || null;
    const prev = m.local || null;
    if ((next && next.state) !== (prev && prev.state)) { m.local = next; changed = true; dirty.push(m); }
  }
  // 只换变化的卡片：整页 renderBrowse() 会让所有封面重新解码，滚动位置跟着跳
  if (changed) {
    for (const m of dirty) {
      // 「只看未安装」开着：刚装好的 mod 该从列表里消失，而不是顶着「已安装」
      // 继续留在「只看未安装」的筛选结果里（筛选口径与显示内容自相矛盾）。
      if (b.onlyUninstalled && m.local && m.local.state === 'installed') {
        const card = document.querySelector(`.card[data-modid="${m.modId}"]`);
        if (card) card.remove();
        b.items = b.items.filter(x => Number(x.modId) !== Number(m.modId));
        updateBrowseChrome();
        continue;
      }
      const card = document.querySelector(`.card[data-modid="${m.modId}"]`);
      if (card) { const wrap = document.createElement('div'); wrap.innerHTML = browseCard(m); card.replaceWith(wrap.firstElementChild); }
    }
  }
}

/**
 * 节流版的卡片状态刷新。
 * 一次下载会连续经过 resolving→downloading→downloaded→analyzing→installing→installed
 * 好几个状态，每个都刷一次太浪费 —— 合并到 400ms 窗口内只跑一次。
 */
let cardStateTimer = null;
function scheduleCardStateRefresh() {
  if (cardStateTimer) return;
  cardStateTimer = setTimeout(() => {
    cardStateTimer = null;
    refreshCardStates().catch(() => {});
    const dm = state.drawer && state.drawer.mod;
    if (dm && $('#drawer') && $('#drawer').classList.contains('on')) {
      applyDrawerLocalState(dm.modId).catch(() => {});
    }
  }, 400);
}

async function openNexusDrawer(modId) {
  state.drawer = { open: true, kind: 'nexus', mod: null, lang: 'zh', translated: null, translating: false, files: [], localKey: null };
  $('#dTitle').textContent = '加载中…';
  $('#dSub').textContent = 'Mod #' + modId;
  $('#dBody').innerHTML = '<div class="txt" style="color:var(--dim2)">正在从 Nexus 获取详情…</div>';
  $('#dFoot').innerHTML = '';
  showDrawer();

  try {
    const m = await call(window.api.nexus.detail(modId));
    state.drawer.mod = m;
    $('#dTitle').textContent = m.name;
    $('#dSub').textContent = [m.version ? 'v' + m.version : '', m.author, m.category].filter(Boolean).join(' · ');
    // 🔴 内容顺序（2026-10-14 用户要求）：
    // 「文件信息、操作按钮都放到顶部，尽量不滚动就能点；图片依然在最顶端，然后说文件信息」。
    // 所以图集永远第一个，紧接着就是**文件信息 + 操作按钮**，说明 / 来源 / 信息这些
    // 「看过一次就不用再看」的元数据一律往下排。
    //
    // ⚠️ 操作按钮不再是底部固定栏（`#dFoot`）——「下载主文件」是最高频的动作，
    //    放在要滚到底才看得见的地方不合理。改挂 `#dActions`（内容区顶部）。
    //    `#dFoot` 在这个抽屉里清空（CSS `.dfoot:empty` 不占位），
    //    其余两个抽屉（已安装 / 下载详情）仍在底部用它。
    $('#dBody').innerHTML = `
      <div id="galleryBox">${m.image ? `<img class="hero" src="${esc(m.image)}" alt="" onerror="this.style.display='none'">` : ''}</div>

      <div class="lbl">文件</div>
      <div id="filesBox" class="txt nxfiles" style="color:var(--dim2)">正在获取文件列表…</div>
      <div id="dActions" class="dactrow"></div>

      <div class="lbl">说明</div>
      <div class="langsw">
        <button class="${state.drawer.lang === 'zh' ? 'on' : ''}" data-lang="zh" title="翻译成中文后显示在这里">中文</button>
        <button class="${state.drawer.lang === 'en' ? 'on' : ''}" data-lang="en" title="Nexus 上的原文（无论英文中文）">English</button>
      </div>
      <div class="txt" id="descBox">${descBoxHtml(state.drawer)}</div>

      <div class="lbl">来源</div>
      <div class="urlbox"><span style="flex:1">${esc(m.url)}</span><button class="btn sm" data-openurl="${esc(m.url)}">打开</button></div>

      <div class="lbl">信息</div>
      <div class="kv"><span>本地状态</span><span id="drawerLocalRow" style="color:var(--dim2)">检查中…</span></div>
      <div class="kv"><span>Mod ID</span><span>${m.modId}</span></div>
      <div class="kv"><span>作者</span><span>${esc(m.author || '—')}</span></div>
      <div class="kv"><span>版本</span><span>${esc(m.version || '—')}</span></div>
      <div class="kv"><span>分类</span><span>${esc(m.category || '—')}</span></div>
      <div class="kv"><span>下载量</span><span>${m.downloads.toLocaleString()}</span></div>
      <div class="kv"><span>点赞数</span><span>${m.endorsements.toLocaleString()}</span></div>
      <div class="kv"><span>发布时间</span><span>${fmtDate(m.createdAt)}</span></div>
      <div class="kv"><span>更新时间</span><span>${fmtDate(m.updatedAt)}</span></div>
    `;
    $('#dFoot').innerHTML = '';                       // 这个抽屉不用底部栏
    // 详情页也要有 👍 / 👎（用户 2026-11-10：「已下载的 mod 只要能与 nexus 关联上，
    // 也要有点赞和不喜欢的按钮；详情页也要有」）。放在操作行最前面，与卡片上的位置一致；
    // 这里 mod 一定来自 Nexus 列表，所以一定有 modId，不用判断。
    // 本地已经有安装包时，给一颗「装进游戏」—— 省掉「加入下载队列」再等一遍下载。
    const libOne = libItemOf(m.modId);
    $('#dActions').innerHTML = `
      ${voteHtml(m)}
      <button class="btn" data-openurl="${esc(m.url)}">在浏览器打开</button>
      <button class="btn" data-gallery="${m.modId}">刷新图集</button>
      <button class="btn" data-install="${m.modId}">手动安装</button>
      ${libOne ? `<button class="btn" data-lib-install="${m.modId}" title="管理器里已经有这份安装包（${esc(libOne.filename)}），直接装进当前游戏目录">装进游戏</button>` : ''}
      ${m.modId ? `<button class="btn ver${state.verifiedIds.has(String(m.modId)) ? ' on' : ''}" data-libver="${m.modId}" data-vername="${esc(m.name || '')}" title="${state.verifiedIds.has(String(m.modId)) ? '点一下取消「已验证」标记' : '我实测过它能用 —— 打上「已验证」'}">${state.verifiedIds.has(String(m.modId)) ? '✓ 已验证' : '✓ 标为已验证'}</button>` : ''}
      <button class="btn p" data-dl-add="${m.modId}">⬇ 加入下载队列</button>
    `;
    loadFiles(m.modId);
    fillGallery(m.modId);
    applyDrawerLocalState(m.modId);
  } catch (e) {
    $('#dTitle').textContent = '加载失败';
    $('#dBody').innerHTML = `<div class="callout err">${esc(e.message)}</div>`;
  }
}

/**
 * 详情抽屉里补上「本地状态」。
 * 列表接口不带这个信息（缓存层要保持干净），所以单独查一次。
 * 查完要确认抽屉还开着、且还是同一个 mod —— 否则用户已经关掉或换了。
 */
async function applyDrawerLocalState(modId) {
  let local = null;
  try {
    const map = await call(window.api.nexus.localState([Number(modId)]), { silent: true });
    local = map[String(modId)] || null;
  } catch { return; }

  const cur = state.drawer && state.drawer.mod;
  if (!cur || Number(cur.modId) !== Number(modId)) return;

  const st = local ? LOCAL_UI[local.state] : null;

  const row = $('#drawerLocalRow');
  if (row) {
    row.innerHTML = st
      ? `<span style="color:var(--${st.cls === 'ok' ? 'ok' : st.cls === 'dl' ? 'blue' : 'accent'})">${st.badge}</span>`
      : '<span style="color:var(--dim2)">未安装</span>';
  }

  // 底部按钮只在状态**真的变了**时重写 —— 否则下载过程中的每次状态变化
  // 都会把按钮刷掉，用户刚好点上去就落空。
  const key = st ? st.act : 'none';
  if (state.drawer.localKey === key) return;
  state.drawer.localKey = key;

  // ⚠️ 操作按钮所在容器**按抽屉类型分**：浏览页 Mod 详情把它们放在内容区顶部
  //    （`#dActions`，图片下方 —— 不滚动就能点），已安装 / 下载详情仍在底部固定栏。
  const foot = state.drawer.kind === 'nexus' ? $('#dActions') : $('#dFoot');
  if (!foot || !st) return;
  // 👍 / 👎 跟着一起重写：这一段会把整个操作行换掉（按本地状态只留「打开 / 装进游戏 / 去下载页」），
  // 用户 2026-11-10 要求详情页也要有点赞和不喜欢 —— 不带上就会被下面几行覆盖掉。
  const vote = state.drawer.kind === 'nexus' ? voteHtml(cur) : '';
  const openBtn = `${vote}<button class="btn" data-openurl="${esc(cur.url)}">在浏览器打开</button>`;
  if (st.act === 'install') {
    // 库里的包没有 taskId，走 library:install（否则按钮点了没反应）
    foot.innerHTML = openBtn + (local.taskId
      ? `<button class="btn p" data-local-install="${esc(local.taskId)}">${st.btn}</button>`
      : `<button class="btn p" data-lib-install="${cur.modId}">${st.btn}</button>`);
  } else if (st.act === 'installed') {
    foot.innerHTML = openBtn + `<button class="btn st-ok" data-goto-page="p-installed">${st.btn}</button>`;
  } else if (st.act === 'download') {
    foot.innerHTML = openBtn + `<button class="btn" data-goto-page="p-download">${st.btn}</button>`;
  }
  // busy（下载中 / 安装中）保持原按钮，别让用户以为能重复触发
}

async function loadFiles(modId) {
  try {
    const files = await call(window.api.nexus.files(modId));
    state.drawer.files = files;
    renderFiles(false, modId);
  } catch (e) {
    const box = $('#filesBox');
    if (box) box.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
  }
}

function renderFiles(showArchived, modId) {
  const box = $('#filesBox');
  if (!box) return;
  const all = state.drawer.files || [];
  if (!all.length) { box.textContent = '没有文件信息'; return; }

  // 安装包库没加载过就拿不到「本地有没有这个包」，这里顺手补一次再重画（只补一次，失败就算了）。
  const listModIdIsLib = Number(modId) > 0;
  if (listModIdIsLib && !state.library && !state.drawer.libAsked && typeof refreshLibrary === 'function') {
    state.drawer.libAsked = true;
    refreshLibrary()
      .then(() => {
        if (state.drawer && state.drawer.mod && Number(state.drawer.mod.modId) === Number(modId)) renderFiles(showArchived, modId);
      })
      .catch(() => {});
  }

  const archivedCount = all.filter(f => f.categoryRaw === 'ARCHIVED' || f.categoryRaw === 'OLD_VERSION').length;
  const list = showArchived ? all : all.filter(f => f.categoryRaw !== 'ARCHIVED' && f.categoryRaw !== 'OLD_VERSION');

  /**
   * 本地已经有这个 Mod 的安装包时，文件行不该再让人「下载」（用户 2026-11-10：
   * 「对于已下载的详情页面要显示为安装到游戏」）——下过的再下一次纯属浪费流量，
   * 装完还得再走一遍安装流程。
   *
   * 为什么按「整包」而不是按文件：安装包库的条目里没有 fileId（见 localLibrary.parseArchiveName，
   * 文件名只带 modId 与版本），所以说不清「这个包是哪个文件的」。因此只在版本对得上的
   * 文件行上换成「安装到游戏」，版本不一样的仍保留「⬇ 下载」，让用户还能换版本。
   */
  const libOne = (listModIdIsLib && typeof libItemOf === 'function') ? libItemOf(modId) : null;
  const libVer = libOne ? String(libOne.version || '').replace(/^v/i, '') : '';
  const sameVer = f => !!libVer && String(f.version || '').replace(/^v/i, '') === libVer;
  const rowBtn = f => ((libOne && (sameVer(f) || list.length === 1))
    ? `<button class="btn sm" style="margin-left:auto" data-lib-install="${esc(modId)}"
          title="管理器里已经有这个 Mod 的安装包（${esc(libOne.filename)}），直接装进游戏 —— 不用再下一次">安装到游戏</button>`
    : `<button class="btn sm p" style="margin-left:auto" data-dl-file="${f.fileId}"
          title="只下载这个文件：${esc(f.name)}（v${esc(f.version)}）">⬇ 下载</button>`);
  const libHint = libOne
    ? `<div style="color:var(--ok);font-size:11px;margin-bottom:8px;line-height:1.6">管理器里已经有这个 Mod 的安装包（${esc(libOne.filename)}），不用再下一次 —— 版本对得上的文件可以直接「安装到游戏」。</div>`
    : '';

  box.innerHTML = libHint + list.map(f => `
    <div style="border-bottom:1px dashed #262B33;padding:8px 0">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
        ${f.primary ? '<span class="chip" style="color:var(--ok);border-color:rgba(63,185,80,.4)">主文件</span>' : ''}
        <span class="chip">${esc(f.category)}</span>
        <b style="color:var(--text);font-size:12px">${esc(f.name)}</b>
        <span style="color:var(--dim2);font-size:11px">v${esc(f.version)} · ${fmtSize(f.sizeInBytes)}</span>
        ${rowBtn(f)}
      </div>
      ${f.description ? `<div style="color:var(--dim2);font-size:11px;margin-top:4px;line-height:1.6">${esc(f.description).slice(0, 200)}</div>` : ''}
    </div>`).join('') +
    (archivedCount && !showArchived
      ? `<button class="btn sm" style="margin-top:10px" data-showarchived="1">显示 ${archivedCount} 个已归档/旧版本文件</button>`
      : '');

  // 底部那颗「加入下载队列」在文件列表到位后改口径：多文件 mod 直接对准
  // 主文件，用户不用再到 Nexus 页面上从一堆按钮里挑。
  // ⚠️ 它可能在内容区顶部（#dActions，浏览页 Mod 详情）或底部固定栏（#dFoot，其余抽屉）。
  const main = list.find(f => f.primary) || list[0];
  const footBtn = document.querySelector('#dActions [data-dl-add], #dFoot [data-dl-add]');
  if (main && footBtn && state.drawer.mod && Number(state.drawer.mod.modId) === Number(modId)) {
    if (libOne) {
      // 本地已有整包 —— 别再把按钮写成「下载主文件」，那会把人引回下载队列。
      footBtn.innerHTML = '安装到游戏';
      footBtn.title = '管理器里已经有这个 Mod 的安装包（' + libOne.filename + '），直接装进游戏';
      footBtn.removeAttribute('data-dl-add');
      footBtn.dataset.libInstall = String(modId);
      footBtn.className = 'btn p';
    } else {
      footBtn.innerHTML = '⬇ 下载主文件';
      footBtn.title = main.name + '（v' + main.version + '）';
    }
  }
}

async function doTranslate() {
  const d = state.drawer;
  if (d.translating) return;
  d.translating = true;

  const box = $('#descBox');
  const summary = d.kind === 'nexus' ? (d.mod.summary || '')
    : ((d.mod.meta && d.mod.meta.summary) || '');
  const source = d.kind === 'nexus'
    ? (d.mod.descriptionText || summary)
    : ((d.mod.meta && (d.mod.meta.description || d.mod.meta.summary)) || '');
  if (!source) { d.translating = false; if (box) box.innerHTML = '<div class="callout err">没有可翻译的文本</div>'; return; }

  const unsub = window.api.translate.onProgress(({ done, total }) => {
    const b = $('#descBox');
    if (b && d.translating) {
      b.innerHTML = `<div style="color:var(--dim2)"><span class="spin"></span> 正在翻译… ${done}/${total} 段</div>`;
    }
  });

  if (box) box.innerHTML = '<div style="color:var(--dim2)"><span class="spin"></span> 正在翻译…</div>';

  try {
    // 先翻摘要（短，秒出），让用户马上看到内容
    let head = '';
    if (summary && summary !== source) {
      try {
        const rs = await call(window.api.translate.text(summary, state.config.targetLang || 'zh-CN'), { silent: true });
        head = rs.text;
        if (box) box.innerHTML = `<p><b>${esc(head)}</b></p><div style="color:var(--dim2)"><span class="spin"></span> 正在翻译完整说明…</div>`;
      } catch { /* 摘要翻译失败不阻塞 */ }
    }

    const r = await call(window.api.translate.text(source, state.config.targetLang || 'zh-CN'));
    d.translated = r.text;
    const body = esc(r.text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    if (box) box.innerHTML = (head ? `<p><b>${esc(head)}</b></p>` : '') + `<p>${body}</p>`;
    toast(r.cached ? '已使用缓存译文' : '翻译完成', 'ok');
  } catch (e) {
    if (box) box.innerHTML = `<div class="callout err">翻译失败：${esc(e.message)}</div>`;
  } finally {
    unsub();
    d.translating = false;
  }
}

/* ---------------- 前置组件 ---------------- */

function renderPrereq() {
  const g = state.game;
  const area = $('#prereqArea');
  if (!g || !g.found) { area.innerHTML = emptyNoGame(); return; }

  const u = g.ue4ss, c = g.cns;
  // ATOOL 也是可选前置（P0 新增）—— 用 `|| {}` 兜底：老版本主进程回来的
  // inspect() 没有这个字段，硬取会在渲染时抛错、整页白掉。
  const a = g.atool || { markers: [], note: null, installed: false, partial: false };
  const u4 = state.ue4ssInfo || null;
  const u4Latest = u4 && u4.tag ? u4.tag : null;
  const u4Same = !!(u4Latest && u.installed && state.ue4ssInstalledTag && state.ue4ssInstalledTag === u4Latest);

  area.innerHTML = `
    <div class="pre">
      <div class="pre-h">
        <div class="ic">🧩</div>
        <div>
          <h3>UE4SS（Mod 加载器本体）</h3>
          <p>脚本注入运行时 · Chrisr0/RE-UE4SS · 剑星专用分支 · <b>走 GitHub 直下，不需要在网页上点任何东西</b></p>
        </div>
        <span class="st ${u.installed ? 'ok' : 'no'}">${u.installed ? '已安装' : '未安装'}</span>
      </div>
      <div class="row">dwmapi.dll <code>${esc(g.root)}\\SB\\Binaries\\Win64\\dwmapi.dll</code> ${u.dll ? '✓' : '✗'}</div>
      <div class="row">ue4ss 运行时 <code>${esc(g.root)}\\SB\\Binaries\\Win64\\ue4ss\\</code> ${u.installed ? '✓' : '✗'}</div>
      <div class="row">核心文件大小 <code>${fmtSize(u.coreSize)}</code> · 写入时间 <code>${fmtDate(u.mtime)}</code></div>
      <div class="row">最新版本 <code id="ue4ssLatest">${u4Latest ? esc(u4Latest) : (state.ue4ssInfoLoading ? '查询中…' : '未查询')}</code>${
        u4 && u4.asset ? ` · <code>${esc(u4.asset.name)}</code> · ${fmtSize(u4.asset.size)}` : ''}${
        u4Same ? ' · <span style="color:var(--green)">已是最新</span>' : ''}</div>
      <div class="row" style="border-top:none">
        <button class="btn sm p" id="ue4ssInstall" title="直接从 GitHub Release 下载并安装，全程不需要你在网页上点任何按钮">
          ${u.installed ? '重装 / 更新 UE4SS' : '一键安装 UE4SS'}
        </button>
        <button class="btn sm" id="ue4ssReleases">打开发布页</button>
        <button class="btn sm" data-openpath="${esc(u.path)}">打开目录</button>
      </div>
      <div class="hint" style="margin-top:8px;font-size:11px;color:var(--dim2)">
        UE4SS 不在 Nexus 上，只能从 GitHub 拿。点「一键安装」后本程序会自己下载最新 Release
        并解压到 <code>SB\\Binaries\\Win64\\</code>（覆盖前自动备份）。
        若网络连不上 GitHub，程序会提示你到发布页手动下载 —— 下载目录监听会自动导入。
      </div>
    </div>

    <div class="pre">
      <div class="pre-h">
        <div class="ic">👗</div>
        <div>
          <h3>Custom Nanosuit System（CNS）</h3>
          <p>服装/外观系统框架 · 绝大多数服装 Mod 的前置 · Nexus #1496</p>
        </div>
        <span class="st ${c.installed ? 'ok' : (c.partial ? 'mid' : 'no')}">${
          c.installed ? '已安装' : (c.partial ? '安装不完整' : '未安装')}</span>
      </div>
      <div class="lbl">判定依据 · 特征文件</div>
      ${(c.markers || []).map(m => `<div class="row">${m.exists ? '✓' : '✗'} ${esc(m.what)} <code>${esc(m.label)}</code>${
        m.exists && m.isDir ? ` · ${m.fileCount} 个文件` : ''}</div>`).join('')}
      ${(c.companions || []).length
        ? `<div class="row">IoStore 伴生文件 <code>${esc(c.companions.join(' · '))}</code></div>` : ''}
      <div class="row">目标路径 <code>${esc(g.root)}\\SB\\</code>（Binaries\\ + Content\\ 合并进游戏目录）</div>
      <div class="row">来源 <code>https://www.nexusmods.com/stellarblade/mods/1496</code> · 主文件 v2.2</div>
      ${c.note ? `<div class="callout warn">${esc(c.note)}</div>` : ''}
      ${u.installed ? '' : `<div class="callout err">需要先安装 UE4SS —— CNS 是 UE4SS 脚本模组，没有加载器装了也不会生效</div>`}
      <div class="row" style="border-top:none">
        <button class="btn sm p" id="cnsInstall" ${u.installed ? '' : 'disabled'}
          title="${u.installed ? '打开 Nexus 安装助手，把该点的下载按钮高亮出来' : '请先安装 UE4SS'}">
          ${c.installed ? '重装 / 更新 CNS' : '一键安装 CNS'}
        </button>
        <button class="btn sm" data-openurl="https://www.nexusmods.com/stellarblade/mods/1496?tab=files">打开 Nexus 下载页</button>
        <button class="btn sm" id="cnsPickLocal">从本地压缩包安装…</button>
      </div>
      <div class="hint" style="margin-top:8px;font-size:11px;color:var(--dim2)">
        一键安装会打开内嵌 Nexus 窗口：<b>第 1 步</b>点高亮的 <b>Manual download</b> →
        <b>第 2 步</b>点下一页高亮的 <b>Slow download</b>。下载由本程序接管，完成后自动开始安装。
      </div>
    </div>

    <div class="pre">
      <div class="pre-h">
        <div class="ic">💃</div>
        <div>
          <h3>Animation Tool（ATOOL）</h3>
          <p>姿势 / 表情 / 自定义动画加载框架 · 大量舞蹈与动画 Mod 的前置 · Nexus #1662</p>
        </div>
        <span class="st ${a.installed ? 'ok' : (a.partial ? 'mid' : 'no')}">${
          a.installed ? '已安装' : (a.partial ? '安装不完整' : '未安装')}</span>
      </div>
      <div class="lbl">判定依据 · 特征文件</div>
      ${(a.markers || []).map(m => `<div class="row">${m.exists ? '✓' : '✗'} ${esc(m.what)} <code>${esc(m.label)}</code>${
        m.exists && m.isDir ? ` · ${m.fileCount} 个文件` : ''}</div>`).join('')}
      <div class="row">目标路径 <code>${esc(g.root)}\\SB\\Content\\Paks\\LogicMods\\</code>（不是 ~Mods —— 两者是互不相通的加载机制）</div>
      <div class="row">来源 <code>https://www.nexusmods.com/stellarblade/mods/1662</code> · 主文件 v6.1（默认键位 / k2 / k3 三版互斥，只能装一个）</div>
      ${a.note ? `<div class="callout warn">${esc(a.note)}</div>` : ''}
      ${u.installed ? '' : '<div class="callout err">需要先安装 UE4SS —— ATOOL 是 UE4SS 蓝图模组（Logic Mod），没有加载器装了也不会生效</div>'}
      <div class="row" style="border-top:none">
        <button class="btn sm p" id="atoolInstall" ${u.installed ? '' : 'disabled'}
          title="${u.installed ? '打开 Nexus 安装助手，把该点的下载按钮高亮出来' : '请先安装 UE4SS'}">
          ${a.installed ? '重装 / 更新 ATOOL' : '一键安装 ATOOL'}
        </button>
        <button class="btn sm" data-openurl="https://www.nexusmods.com/stellarblade/mods/1662?tab=files">打开 Nexus 下载页</button>
        <button class="btn sm" id="atoolPickLocal">从本地压缩包安装…</button>
      </div>
      <div class="hint" style="margin-top:8px;font-size:11px;color:var(--dim2)">
        一键安装流程与 CNS 相同：先点高亮的 Manual download，再点下一页的 Slow download，下载由本程序接管。
      </div>
      <div class="hint" style="margin-top:4px;font-size:11px;color:var(--dim2)">
        ATOOL 本体落在 LogicMods；动画 Mod 是普通 pak，仍然装到 ~Mods。外置音频需要手工放进 LogicMods\\HD-ATOOL_P\\audio\\（文件名 = 动画编号，如 33.wav）。
      </div>
    </div>

    <div class="pre">
      <div class="pre-h">
        <div class="ic">📁</div>
        <div>
          <h3>Mod 落点目录</h3>
          <p>UE4 引擎加载 Mod 的标准位置</p>
        </div>
        <span class="st ${g.modsDir.exists ? 'ok' : 'mid'}">${g.modsDir.exists ? '已就绪' : '不存在'}</span>
      </div>
      <div class="row">~Mods <code>${esc(g.modsDir.path)}</code> ${g.modsDir.exists ? `✓ ${g.modsDir.fileCount} 个文件` : '✗'}</div>
      <div class="row">LogicMods <code>${esc((g.logicModsDir || {}).path || '')}</code> ${
        (g.logicModsDir && g.logicModsDir.exists) ? `✓ ${g.logicModsDir.fileCount} 个文件` : '✗（蓝图模组 / CNS / ATOOL 的落点）'}</div>
      <div class="row">脚本 Mods <code>${esc(g.root)}\\SB\\Binaries\\Win64\\ue4ss\\Mods\\</code></div>
      <div class="row" style="border-top:none">
        ${g.modsDir.exists ? '' : '<button class="btn sm p" data-mkmods="1">创建 ~Mods 目录</button>'}
        ${(g.logicModsDir && g.logicModsDir.exists) ? '' : '<button class="btn sm" data-mklogicmods="1">创建 LogicMods 目录</button>'}
        <button class="btn sm" data-openpath="${esc(g.modsDir.path)}">打开目录</button>
      </div>
    </div>

    <div class="pre">
      <div class="pre-h">
        <div class="ic">🎮</div>
        <div>
          <h3>游戏本体</h3>
          <p>${g.engine.iostore ? 'Unreal Engine 4 · IoStore 打包' : 'Unreal Engine 4'}</p>
        </div>
        <span class="st ok">已识别</span>
      </div>
      <div class="row">启动器 <code>${esc(g.exe.path)}</code></div>
      <div class="row">Paks 目录 <code>${esc(g.paks.path)}</code> · ${g.engine.paksCount} 个包文件</div>
      <div class="row" style="border-top:none">
        <button class="btn sm" data-reveal-path="${esc(g.exe.path)}">定位启动器</button>
      </div>
    </div>
  `;
}

/* ---------------- 前置组件：一键安装 ---------------- */

/** 拉取前置组件清单（含依赖检查结果），缓存到 state */
async function refreshPrereqs() {
  try { state.prereqs = (await call(window.api.prereq.list(), { silent: true })) || []; }
  catch { state.prereqs = []; }
  return state.prereqs;
}

/**
 * 一键安装前置组件。
 *
 * ⚠️ 这里必须打开内嵌的 Nexus「安装助手」窗口，而不是直接下载 ——
 *    Nexus 的免费下载**必须由用户在网页上点一次按钮**，绕不过去
 *    （绕它就得抓网页或过人机验证，两者都不做）。
 *    助手窗口会把该点的按钮**高亮出来**，并接管下载：
 *      第 1 步 Manual download → 第 2 步 Slow download
 *    下完自动进入安装流程，用户全程只点两下。
 */
async function installPrereq(key) {
  if (state.prereqBusy) { toast('正在处理，请稍等', 'err'); return null; }
  state.prereqBusy = key;
  try {
    const r = await call(window.api.prereq.install(key), { silent: true });
    toast('安装助手已打开 · 按窗口顶部的提示点高亮的按钮，下载会自动接管');
    return r;
  } catch (e) {
    toast(e.message, 'err');
    return null;
  } finally {
    state.prereqBusy = null;
  }
}

/** 助手窗口里的下载进度 —— 在主界面顶部给一条进度提示，别让用户干等 */
function onPrereqDownloadProgress(p) {
  if (!p) return;
  if (p.failed) { toast('下载中断：' + (p.filename || '') + '（' + (p.state || '') + '）', 'err'); return; }
  if (state.prereqBusy) {
    toast('正在下载 ' + (p.filename || '安装包') + ' … ' + (p.percent || 0) + '%');
  }
}

/* ---------------- 前置组件：UE4SS 一键安装（GitHub 直下） ---------------- */

/**
 * 查一次 UE4SS 最新 Release。
 *
 * 这是唯一一个**完全不需要用户去网页点按钮**的前置组件 —— 因为它走 GitHub，
 * 不像 Nexus 那样必须由用户点一次「Mod Manager Download」才签发下载授权。
 */
async function refreshUe4ssInfo(force) {
  state.ue4ssInfoLoading = true;
  try {
    const r = await call(window.api.prereq.ue4ssInfo(!!force), { silent: true });
    state.ue4ssInfo = r || null;
  } catch (e) {
    state.ue4ssInfo = null;
    state.ue4ssInfoError = e.message;
  } finally {
    state.ue4ssInfoLoading = false;
  }
  return state.ue4ssInfo;
}

/** 一键安装 / 更新 UE4SS */
async function installUe4ss() {
  if (state.prereqBusy) { toast('正在处理，请稍等', 'err'); return null; }
  state.prereqBusy = 'ue4ss';
  toast('正在从 GitHub 获取 UE4SS 最新版本…');
  try {
    const r = await call(window.api.prereq.installUe4ss(), { silent: true });
    state.ue4ssInstalledTag = r.tag;
    toast('UE4SS ' + r.tag + ' 已下载（' + fmtSize(r.size) + '），正在安装…', 'ok');
    switchPage('p-download');
    await refreshDownloads();
    return r;
  } catch (e) {
    toast(e.message, 'err');
    // 失败时给一条明确的退路：手动下载 + 下载目录监听自动导入
    const rel = await refreshUe4ssInfo(true).catch(() => null);
    if (rel) toast('也可以到发布页手动下载 —— 下载目录监听会自动导入', 'err');
    return null;
  } finally {
    state.prereqBusy = null;
  }
}

/** UE4SS 下载进度（主进程直下，不经过内嵌浏览器） */
function onUe4ssProgress(p) {
  if (!p) return;
  if (p.stage === 'release') { toast('正在查询 UE4SS 最新版本…'); return; }
  if (p.stage === 'download') {
    if (!state.prereqBusy) return;
    const pct = p.percent == null ? '' : ' ' + p.percent + '%';
    toast('正在下载 UE4SS' + pct + (p.source && p.source !== 'asset-api' ? '（通道：' + p.source + '）' : ''));
  }
}

/**
 * 助手窗口把安装包下载完了 → 直接进安装流程。
 *
 * 这是「Manual download → Slow download」这条路的终点：
 * 文件已经落在 data/tmp 下，接着复用现成的「分析 → 安装」链路。
 * 前置组件（CNS 这类）走的是**自动安装** —— 用户已经在网页上点了两下，
 * 不该再让他回来点第三次。覆盖风险由安装器的自动备份兜底。
 */
async function onPrereqDownloaded(info) {
  if (!info || !info.path) return;
  state.prereqBusy = null;
  toast('下载完成：' + (info.filename || '') + ' · ' + fmtSize(info.size) + '，开始安装…', 'ok');
  await openInstallDrawer(info.path, info.meta || {}, { auto: true });
}

/** 找出这个 Nexus modId 对应哪个前置组件（用于把「安装到本地」路由到一键安装） */
function prereqByModId(modId) {
  const id = Number(modId);
  return (state.prereqs || []).find(p => Number(p.modId) === id) || null;
}

/* ---------------- 下载管理 ---------------- */

const DL_STATUS = {
  awaiting_authorization: { t: '等待授权', c: 'wait' },
  queued: { t: '排队中', c: 'wait' },
  resolving: { t: '获取链接', c: 'run' },
  downloading: { t: '下载中', c: 'run' },
  downloaded: { t: '已下载', c: 'rev' },
  analyzing: { t: '识别结构', c: 'run' },
  needs_review: { t: '待确认', c: 'rev' },
  installing: { t: '安装中', c: 'run' },
  installed: { t: '已安装', c: 'ok' },
  failed: { t: '失败', c: 'err' },
  cancelled: { t: '已取消', c: 'wait' },
  interrupted: { t: '已中断', c: 'err' },
  // 用户主动暂停（2026-10-14 新增）：与「已中断」分开显示 ——
  // 中断是意外，暂停是用户自己的动作，文案该不一样，按钮也不同（暂停给「继续」）。
  paused: { t: '已暂停', c: 'wait' }
};

const DL_ACTIVE = new Set([
  'awaiting_authorization', 'queued', 'resolving', 'downloading',
  'downloaded', 'analyzing', 'needs_review', 'installing'
]);

const DL_BUSY = new Set(['queued', 'resolving', 'downloading', 'analyzing', 'installing']);

/** 「还能接着下」的状态：中断 / 下载失败 / 用户暂停，且手上**没有**安装包 */
const DL_RESUMABLE = new Set(['interrupted', 'failed', 'paused']);

function dlStatusMeta(t) { return DL_STATUS[t.status] || { t: t.status, c: 'wait' }; }

/**
 * 一条下载任务的按钮组。
 *
 * ## 2026-10-14 的用户要求
 *
 * 「每个 mod 可以暂停，取消，继续下载，彻底删除等操作」——
 * 所以这里按**状态**给出对应的动作，而不是只给一个「取消」：
 *
 *   下载中 / 排队中  → ⏸ 暂停 · 取  消
 *   已暂停           → ▶ 继续 · 取  消 · 彻底删除
 *   失败 / 已中断     → ↻ 重试 · 打开文件夹 · 彻底删除
 *   已下载           → 安  装 · 打开文件夹 · 彻底删除
 *   已安装           → 重新安装 · 打开文件夹 · 彻底删除
 *   待确认           → ⚡ 一键安装 · 选择内容 · 打开文件夹 · 彻底删除
 *   等待授权         → ⚡ 自动授权 · 手  动 · 彻底删除
 *
 * 「彻底删除」放最后、用危险色：它清掉记录 + 安装包 + 半截下载 + 缓存图
 * （**不动游戏目录**，卸载归「已安装 Mod」页管），是个不该被误点的动作。
 */
function dlActionsHtml(t) {
  const meta = t.meta || {};
  const plan = (t.install && t.install.plan) || null;
  const a = [];

  // 「彻底删除」是整个按钮组的**收尾动作**，每个状态都能用
  const purgeBtn = `<button class="btn d sm" data-dl-purge="${esc(t.id)}" title="删掉这条记录 + 本地安装包 + 半截下载 + 缓存图（游戏里已安装的文件不受影响）">🗑 彻底删除</button>`;

  if (t.status === 'awaiting_authorization') {
    // 主按钮 = 自动授权（免点击，直接问 Nexus 要授权）。
    // 「手动」保留为降级通路：作者只开了手动下载、或撞上 Cloudflare 时还得靠它。
    a.push(`<button class="btn p sm" data-dl-autoauth="${esc(t.id)}" title="用已登录的 Nexus 会话直接取得下载授权，不用打开网页">⚡ 自动授权</button>`);
    a.push(`<button class="btn sm" data-dl-auth="${esc(t.id)}" title="打开 Nexus 页面，由你点一下下载按钮（自动授权失败时用）">手动</button>`);
    a.push(purgeBtn);
  } else if (DL_BUSY.has(t.status)) {
    // 正在跑 → 暂停（保留已下载的部分）或取消（丢弃）
    a.push(`<button class="btn sm" data-dl-pause="${esc(t.id)}" title="停下，但已下载的部分会留着 —— 之后点「继续」接着下，不重跑流量">⏸ 暂停</button>`);
    a.push(`<button class="btn d sm" data-dl-cancel="${esc(t.id)}" title="取消这条任务，并清掉已经下载的部分">取消</button>`);
  } else if (t.status === 'paused') {
    a.push(`<button class="btn p sm" data-dl-start="${esc(t.id)}" title="从断点接着下载">▶ 继续</button>`);
    a.push(`<button class="btn sm" data-dl-cancel="${esc(t.id)}">取消</button>`);
    a.push(purgeBtn);
  } else if (t.status === 'needs_review') {
    // 「作者的工程源文件」这类包**装到哪儿都不会生效** ——
    // 给它「确认安装」是个死胡同（点下去只会再弹一次说明），主按钮换成「彻底删除」。
    if (plan && plan.diagnosis) {
      a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
      a.push(purgeBtn);
    } else {
      // ⚡ 一键安装：按「每组第一套 + 互不相关的全选」直接装，不用点开对话框。
      //    用户 2026-10-14：「不要手工一个一个确认」。
      //    老任务的 plan 可能还没有 `defaultPick`（后加字段）→ 那时退回「确认安装」，
      //    点开对话框手动选（`download:confirmDefault` 那边也会先重算一次 plan）。
      const hasDefault = Array.isArray(plan && plan.defaultPick) && plan.defaultPick.length > 0;
      const optCount = Array.isArray(plan && plan.options) ? plan.options.length : 0;
      if (hasDefault) {
        a.push(`<button class="btn p sm" data-dl-confirmdefault="${esc(t.id)}" title="${
          plan.hasConflicts
            ? '按默认选择直接安装：每组取第一套，互不相关的全部装上'
            : '这个包里几套内容互不覆盖，直接全部安装'
        }">⚡ 一键安装</button>`);
      } else {
        a.push(`<button class="btn p sm" data-dl-confirm="${esc(t.id)}">确认安装</button>`);
      }
      // 「选择内容」= 打开那个可逐套勾选的对话框（想改默认组合时用）
      if (optCount) a.push(`<button class="btn sm" data-dl-confirm="${esc(t.id)}" title="打开对话框，自己挑要装哪几套">选择内容</button>`);
      a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
      a.push(purgeBtn);
    }
  } else if (t.status === 'downloaded') {
    a.push(`<button class="btn p sm" data-dl-start="${esc(t.id)}">安装</button>`);
    a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
    a.push(purgeBtn);
  } else if (t.status === 'installed') {
    a.push(`<button class="btn sm" data-dl-start="${esc(t.id)}">重新安装</button>`);
    a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
    a.push(purgeBtn);
  } else {
    // 失败 / 已中断 / 已取消 分两种：**安装**失败（安装包还在，问题出在结构/落点）
    // 和**下载**失败。前者该走「去处理」（会先刷新结构分析、必要时弹变体选择框），
    // 后者才该重新下载 —— 一律给「重试」会让安装失败的任务点了没反应（实测踩过）。
    if (t.archivePath) a.push(`<button class="btn p sm" data-dl-confirm="${esc(t.id)}">去处理</button>`);
    else a.push(`<button class="btn p sm" data-dl-start="${esc(t.id)}" title="重新排队下载；有断点的话会接着下">↻ 重试</button>`);
    if (t.archivePath) a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
    a.push(purgeBtn);
  }
  if (meta.sourceUrl) a.push(`<button class="btn sm" data-openurl="${esc(meta.sourceUrl)}">来源</button>`);
  return a.join('');
}

function dlItem(t) {
  const meta = t.meta || {};
  const st = dlStatusMeta(t);
  const imgs = Array.isArray(meta.images) ? meta.images.filter(x => x && x.localUrl) : [];
  const cover = (imgs[0] && imgs[0].localUrl) || meta.image || meta.pictureUrl || '';
  const pct = t.progress && t.progress.percent;
  const size = t.size || meta.fileSize || 0;
  const cls = ['dl-item'];
  if (DL_BUSY.has(t.status)) cls.push('busy');
  if (t.status === 'failed') cls.push('err');

  let progress = '';
  if (t.status === 'downloading') {
    progress = pct == null
      ? '<div class="prog ind"><i></i></div>'
      : `<div class="prog"><i style="width:${pct}%"></i></div>`;
  } else if (t.status === 'installing') {
    progress = '<div class="prog ind"><i></i></div>';
  }

  // 「装过但现在游戏里找不到」的任务：主进程对齐状态时把原因写在 install.missingReason，
  // 比 `error` 温和（包还在，装回去就行），所以也走蓝字说明而不是红字。
  const reason = (t.install && (t.install.reason || t.install.missingReason)) || '';

  return `
  <div class="${cls.join(' ')}" data-dlid="${esc(t.id)}">
    <div class="dl-thumb" data-dl-open="${esc(t.id)}" title="查看封面与预览图">
      ${cover ? `<img src="${esc(cover)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'无封面'}))">`
        : `<div class="ph">${esc(meta.modId ? ('Mod #' + meta.modId) : '安装包')}</div>`}
      ${imgs.length > 1 ? `<span class="n">${imgs.length} 图</span>` : ''}
    </div>
    <div class="dl-main">
      <h4 title="${esc(meta.name || '')}">${esc(meta.name || ('Mod #' + (meta.modId || '?')))}</h4>
      <div class="dl-sub">
        <span class="dl-st ${st.c}">${esc(st.t)}</span>
        ${meta.version ? `<span class="chip">v${esc(meta.version)}</span>` : ''}
        ${meta.fileName ? `<span class="chip" title="${esc(meta.fileName)}">${esc(clip(meta.fileName, 26))}</span>` : ''}
        ${meta.author ? `<span>${esc(meta.author)}</span>` : ''}
        ${size ? `<span>${fmtSize(size)}</span>` : ''}
        ${t.status === 'installed' && t.install && t.install.targetLabel ? `<span>→ ${esc(t.install.targetLabel)}</span>` : ''}
        <span>${esc(relTime(t.createdAt))}</span>
      </div>
      ${progress}
      ${(() => {
        // 待确认时用 `taskWhy()` 给出**具体**原因（「包里有 3 套内容，其中 1 组是同一件东西…」），
        // 比 `install.reason` 那句泛泛的描述有用。failed 不重复走它 —— 下面已经有红字错误。
        const why = t.status === 'needs_review' ? (taskWhy(t) || reason) : reason;
        return why ? `<div class="dl-sub" style="color:var(--blue)">${esc(why)}</div>` : '';
      })()}
      ${(() => {
        // 「有 N 个文件会被覆盖」这种时候，用户要能**点开看清单**（谁的东西被盖了）
        const cd = conflictDetailsOf(t);
        if (!cd || !cd.total) return '';
        return `<div class="dl-sub">
          <button class="lnk" data-dl-conflicts="${esc(t.id)}">查看会被覆盖的 ${cd.total} 个文件明细</button>
        </div>`;      })()}
      ${t.error ? `<div class="dl-err">${esc(t.error)}</div>` : ''}
    </div>
    <div class="dl-acts">${dlActionsHtml(t)}</div>
  </div>`;
}

function renderDownload() {
  const area = $('#downloadArea');
  if (!area) return;
  const tasks = state.downloads || [];
  const s = state.downloadStats || {};

  if (!tasks.length) {
    area.innerHTML = `<div class="empty">
      <h3>下载队列是空的</h3>
      <p>去「浏览 Mod」挑一个，点卡片上的「⬇ 下载」就会加到这里的队列。<br>
      队列会自动完成 <b>下载 → 结构识别 → 安装</b>，装完的 Mod 会出现在「已安装 Mod」页。<br>
      <span style="color:var(--dim2)">说明：免费 Nexus 账号需要你在网页上点一次「Mod Manager Download」完成授权，
      之后的一切（下载 / 排队 / 安装 / 封面缓存）都自动完成。</span></p>
      <button class="btn p" onclick="switchPage('p-browse')">去浏览 Mod</button>
    </div>`
      // 队列空着也要把「管理器里的安装包」列出来 —— 用户清过已完成记录 / 换过游戏目录之后，
      // 「下好了没装」的包就只剩 library 这一个来源了，不能跟着空态一起被吞掉。
      + libraryBoxHtml();
    $('#sub').textContent = '共 0 项';
    return;
  }

  const sorted = [...tasks].sort((a, b) => {
    const ra = DL_ACTIVE.has(a.status) ? 0 : 1;
    const rb = DL_ACTIVE.has(b.status) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  const doneCount = tasks.filter(t => t.status === 'installed' || t.status === 'cancelled').length;
  const reviewCount = tasks.filter(t => t.status === 'needs_review').length;
  const waitAuthCount = tasks.filter(t => t.status === 'awaiting_authorization').length;
  // 「还能接着下」的任务：中断 / 下载失败 / **用户暂停**，且手上**没有**安装包。
  // 用户要求（2026-10-14）：「任务中断后支持全部恢复继续下载」——
  // 十几条任务一条条点「重试」是折磨，给一个一键恢复。
  // ⚠️ 排除有 `archivePath` 的：那种是**安装**失败，包已经下好了，
  //     重新下载纯属白跑流量，该走「去处理」。
  const resumeCount = tasks.filter(t =>
    DL_RESUMABLE.has(t.status) && !t.archivePath
  ).length;
  // 正在跑的任务 —— 「⏸ 全部停止」要停的就是这些（与主进程的 PAUSABLE 口径一致）
  const busyCount = tasks.filter(t => DL_BUSY.has(t.status)).length;
  const pausedCount = tasks.filter(t => t.status === 'paused').length;
  // 「待确认」里能一键装的：有默认选择集、且不是「工程源文件」这类**结论性**诊断
  const autoConfirmCount = tasks.filter(t => {
    if (t.status !== 'needs_review') return false;
    const plan = t.install && t.install.plan;
    if (!plan || plan.diagnosis) return false;
    return Array.isArray(plan.defaultPick) && plan.defaultPick.length > 0;
  }).length;
  // 「进行中」和「待处理」必须分开算 ——
  // 主进程的 `stats.active` 是「所有非终态」，把「待确认 / 等待授权」也含进去了。
  // 那两类是**在等你操作**（不该显示成正在跑，见 SKILL 铁律 42），口径混着显示会误导。
  const needYouCount = reviewCount + waitAuthCount;
  const runningCount = Math.max(0, (s.active || 0) - needYouCount);
  // 「已下载但没装进游戏」的：包还在 data/library 里，点一下就能装。
  // 换过游戏目录、或用户手动删过文件之后，这里会重新冒出来（主进程会按磁盘对齐状态）。
  const downloadedCount = tasks.filter(t => t.status === 'downloaded').length;
  const noRoot = !state.game || !state.game.found;

  area.innerHTML = `
    <div class="dl-bar">
      <span class="stat">共 <b>${tasks.length}</b> 项</span>
      ${runningCount ? `<span class="stat">进行中 <b>${runningCount}</b></span>` : ''}
      ${pausedCount ? `<span class="stat">已暂停 <b>${pausedCount}</b></span>` : ''}
      ${needYouCount ? `<span class="stat" style="color:var(--accent)">待处理 <b style="color:var(--accent)">${needYouCount}</b></span>` : ''}
      ${downloadedCount ? `<span class="stat" style="color:var(--accent)">待安装 <b style="color:var(--accent)">${downloadedCount}</b></span>` : ''}
      ${libraryCount() ? `<span class="stat" style="color:var(--accent)">可本地装 <b style="color:var(--accent)">${fmtNum(libraryCount())}</b></span>` : ''}
      <span class="stat">已安装 <b>${s.installed || 0}</b></span>
      ${s.failed ? `<span class="stat" style="color:var(--red)">失败 <b style="color:var(--red)">${s.failed}</b></span>` : ''}
      <div class="spacer"></div>
      ${busyCount ? `<button class="btn sm" data-dl-pauseall="1" title="把正在下载的任务全部停下；已下载的部分会保留，随时能点「全部恢复」接着下">⏸ 全部停止（${busyCount}）</button>` : ''}
      ${resumeCount ? `<button class="btn p sm" data-dl-resumeall="1" title="把所有中断 / 暂停 / 下载失败的任务一次性重新排队：已经下过的部分会接着下，不用从头再来">↻ 全部恢复（${resumeCount}）</button>` : ''}
      ${downloadedCount && !noRoot ? `<button class="btn p sm" data-dl-installall="1" title="安装包都在管理器目录里，逐个装进当前游戏目录（换过游戏目录也可以用）">⬇ 全部安装（${downloadedCount}）</button>` : ''}
      ${autoConfirmCount ? `<button class="btn p sm" data-dl-confirmall="1" title="把所有「待确认」的包按默认选择直接安装（每组第一套；互不相关的内容全部装上）—— 不用逐个点开">⚡ 一键安装全部（${autoConfirmCount}）</button>` : ''}
      ${waitAuthCount ? `<button class="btn p sm" data-dl-autoauthall="1" title="用已登录的 Nexus 会话逐个取得下载授权，不用再逐条去网页点下载按钮">⚡ 全部自动授权（${waitAuthCount}）</button>` : ''}
      ${reviewCount ? `<button class="btn sm" data-dl-refreshplans="1" title="安装规则升级后，之前识别不了的包可能已经能认出来了">重新识别${reviewCount ? `（${reviewCount}）` : ''}</button>` : ''}
      ${doneCount ? `<button class="btn sm" data-dl-cleardone="1">清理已完成记录（${doneCount}）</button>` : ''}
    </div>
    ${downloadedCount && noRoot
      ? `<div class="callout" style="margin:0 0 10px"><span>有 ${fmtNum(downloadedCount)} 个 Mod 已经下载好了（安装包存在管理器目录里），但还没设置游戏目录 —— 设置好之后回到这一页就能直接装进去。</span><button class="btn sm" data-goto-page="p-settings">去设置游戏目录</button></div>`
      : ''}
    <div class="dl-list">${sorted.map(dlItem).join('')}</div>
    ${libraryBoxHtml()}`;
  $('#sub').textContent = runningCount
    ? `${runningCount} 项进行中` + (needYouCount ? ` · ${needYouCount} 项待处理` : '')
    : (needYouCount ? `${needYouCount} 项待处理` : `共 ${tasks.length} 项`);
}

/** 重算所有「待确认」任务的安装方案（主进程会重跑一遍结构识别） */
async function dlRefreshPlans() {
  try {
    const r = await call(window.api.download.refreshPlans(), { silent: true });
    await refreshDownloads();
    if (r && r.revived) toast(`重新识别完成：${r.revived} 个包现在能装了`, 'ok');
    else toast('重新识别完成，这几个包还是认不出来（可点「打开文件夹」看结构）');
  } catch (e) { toast(e.message, 'err'); }
}

function dlFind(id) {
  return (state.downloads || []).find(x => x.id === String(id)) || null;
}

async function refreshDownloads() {
  try {
    const d = await call(window.api.download.list(), { silent: true });
    state.downloads = (d && d.tasks) || [];
    state.downloadStats = (d && d.stats) || {};
  } catch { /* 忽略 */ }
  // 装完 / 卸载完之后「哪些包还能装」会变，顺手重新盘点一次
  await refreshLibrary();
  renderDownload();
  renderSidebar();
  const inst = $('#p-installed');
  if (inst && inst.classList.contains('on')) renderInstalled();
}

/**
 * 加入下载队列。
 *
 * 默认顺手打开 Nexus 安装助手（高亮该 mod 的下载按钮）—— 用户只需要在那**一个**
 * 高亮按钮上点一次，剩下的下载 / 排队 / 安装全自动。这是免费账号下能做到的极限。
 */
/**
 * 入队 + 开始下载。
 *
 * 🔴 **默认不弹浏览器窗口，直接下载**（2026-10-13 用户要求）：
 * 先走「免点击自动授权」—— 用已登录会话直接问 Nexus 站内下载弹层端点拿 nxm 链接，
 * 全程静默；只有这条路走不通（登录态失效 / 撞 Cloudflare / 用户在设置里关掉了自动授权）
 * 才降级到「打开安装助手浏览器窗口，让用户点一下高亮按钮」。
 *
 * 为什么不是「一上来就弹窗口」：免费账号的下载授权**确实**需要一次点击，
 * 但那一下点的是网页按钮；程序自己调同一个端点就能替用户省掉这一步（38/38 实测命中）。
 * 用户要的是「点下载就完事」，那就先把静默通路走到底。
 */
async function dlEnqueue(meta, { authorize = true, goto = true } = {}) {
  let r;
  try { r = await call(window.api.download.enqueue(meta), { silent: true }); }
  catch (e) { toast(e.message, 'err'); return null; }

  await refreshDownloads();
  // `goto:false` —— 浏览页点下载**不跳走**（2026-10-14 用户要求：「点击下载不切换到
  // 下载页面，直接后台加入下载，只在当前 mod 上显示状态」）。留在原列表，让卡片自己
  // 变成「● 下载中 / 查看进度」；用户真想看细节，卡片上那个按钮就是入口。
  // 批量下载仍传默认值 true —— 一次下十几个，用户本来就想看整队进度。
  if (goto) switchPage('p-download');
  else scheduleCardStateRefresh();

  if (r && r.duplicate) { toast('这个 Mod 已经在下载队列里了'); return r; }

  if (authorize && r && r.task) {
    const auto = !(state.config && state.config.autoAuthorize === false);
    if (auto) {
      try {
        const a = await call(window.api.download.autoAuthorize(r.task.id), { silent: true });
        if (a && a.ok) {
          toast('已开始下载：' + ((meta && meta.name) || '这个 Mod'), 'ok');
          return r;
        }
      } catch { /* 落到下面的降级通路 */ }
    }
    // 降级：打开安装助手窗口，用户点一下高亮的下载按钮
    try {
      await call(window.api.download.authorize(r.task.id), { silent: true });
      toast(auto
        ? '已打开 Nexus 安装助手 · 点一下高亮的下载按钮即可'
        : '已打开 Nexus 页面 · 点一下高亮的下载按钮，之后全自动', 'ok');
    } catch (e) {
      toast('打不开授权页：' + e.message + ' · 可在下载页点「⚡ 自动授权」或「手动」重试', 'err');
    }
  } else {
    toast('已加入下载队列');
  }
  return r;
}

async function dlAuthorize(id) {
  try {
    await call(window.api.download.authorize(id), { silent: true });
    toast('已打开 Nexus 页面 · 点一下高亮的下载按钮');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------- 自动授权（免点击） ---------------- */

/** 批量自动授权是否在跑（避免重复触发 + 挡住按钮重复点） */
let autoAuthRunning = false;

/**
 * 单条自动授权。
 * 失败时主进程已经把原因写进任务的 `error`，这里再 toast 一句人话。
 */
async function dlAutoAuthorize(id) {
  const btn = document.querySelector(`[data-dl-autoauth="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '授权中…'; }
  try {
    const r = await call(window.api.download.autoAuthorize(id), { silent: true });
    if (r && r.ok) toast('已取得下载授权，开始下载');
    else toast((r && r.reason) || '自动授权失败', 'err');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ 自动授权'; }
    await refreshDownloads();
  }
}

/**
 * 一键把队列里所有「等待授权」的任务都授权掉。
 *
 * 主进程那边是**串行 + 节流**的，可能要跑几十秒 —— 这里用按钮文案当进度条，
 * 并订阅 `download:autoauth` 实时更新，避免用户以为程序卡住了。
 */
async function dlAutoAuthorizeAll() {
  if (autoAuthRunning) { toast('已经在自动授权了，稍等…'); return; }
  autoAuthRunning = true;
  const btn = document.querySelector('[data-dl-autoauthall]');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '自动授权中…'; }

  try {
    const r = await call(window.api.download.autoAuthorizeAll({}), { silent: true });
    if (!r) return;
    const parts = [`成功 ${r.ok}/${r.total}`];
    if (r.failed) parts.push(`失败 ${r.failed}`);
    if (r.skipped) parts.push(`跳过 ${r.skipped}`);
    if (r.stopped) {
      parts.push(r.stopCode === 'not_logged_in' ? '（Nexus 未登录，已停下）' : '（被 Cloudflare 拦住，已停下）');
      if (r.remaining) parts.push(`还剩 ${r.remaining} 条可稍后重试`);
    }
    toast('自动授权：' + parts.join('，'), r.ok ? 'ok' : 'err');
    return r;
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    autoAuthRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = label || '⚡ 全部自动授权'; }
    await refreshDownloads();
  }
}

/** 批量授权的实时进度 → 按钮文案 */
function onAutoAuthProgress(p) {
  if (!p || !p.total) return;
  const btn = document.querySelector('[data-dl-autoauthall]');
  if (btn && autoAuthRunning) btn.textContent = `授权中 ${p.done}/${p.total}…`;
}

/** 「全部恢复」是否在跑（挡住重复点） */
let resumeAllRunning = false;

/** 「全部安装」是否在跑（挡住重复点）—— 与上面分开，两者可以不同时进行 */
let installAllRunning = false;

/**
 * 「全部恢复」——把中断 / 下载失败的任务一次性重新排队，**从断点接着下**。
 *
 * 用户要求（2026-10-14）：「任务中断后支持全部恢复继续下载」。
 * 下载引擎把半截文件留在 `data/library/.dl-<modId>-<fileId>.part`，
 * 恢复时会带 `Range` 头从已有字节继续（服务器不支持 Range 就自动从头下）。
 *
 * 两段流水线：
 *   ① 逐个 `download.start(id)` —— 有授权就直接接着下
 *   ② 程序重启过的话内存里的授权 key 早没了，任务会翻回「等待授权」，
 *      这时**顺手接一次批量自动授权**，用户不用再点一下
 */
async function dlResumeAll() {
  if (resumeAllRunning) { toast('正在恢复中，稍等…'); return null; }
  resumeAllRunning = true;
  const label = (document.querySelector('[data-dl-resumeall]') || {}).textContent || '';
  const setBtn = (txt, disabled) => {
    const b = document.querySelector('[data-dl-resumeall]');
    if (b) { b.textContent = txt; b.disabled = !!disabled; }
  };
  setBtn('恢复中…', true);

  try {
    const ids = (state.downloads || [])
      // ⚠️ 必须与 `renderDownload` 里算 `resumeCount` 的口径**完全一致**，
      //    否则会出现「按钮写着（3）但点下去只恢复了 1 条」——
      //    用户暂停的任务正是最该被恢复的那批（那是他主动停下的）。
      .filter(t => DL_RESUMABLE.has(t.status) && !t.archivePath)
      .map(t => t.id);
    if (!ids.length) { toast('没有需要恢复的任务'); return null; }

    let ok = 0, failed = 0;
    for (let i = 0; i < ids.length; i++) {
      setBtn(`恢复中 ${i + 1}/${ids.length}…`, true);
      try { await call(window.api.download.start(ids[i]), { silent: true }); ok++; }
      catch { failed++; }
    }
    await refreshDownloads();

    const needAuth = (state.downloads || []).filter(t => t.status === 'awaiting_authorization').length;
    if (needAuth) {
      toast(`已恢复 ${ok} 项 · ${needAuth} 项要重新授权，正在自动授权…`, 'ok');
      await dlAutoAuthorizeAll();
    } else {
      toast(`已恢复 ${ok} 项${failed ? `，${failed} 项没能启动` : ''}`, failed ? 'err' : 'ok');
    }
    return { ok, failed };
  } catch (e) {
    toast(e.message, 'err');
    return null;
  } finally {
    resumeAllRunning = false;
    await refreshDownloads();
    setBtn(label || '↻ 全部恢复', false);
  }
}

async function dlStart(id) {
  try { await call(window.api.download.start(id), { silent: true }); await refreshDownloads(); }
  catch (e) { toast(e.message, 'err'); }
}

/**
 * 把「已下载但没装」的任务一次性装进当前游戏目录。
 *
 * 用途：换过游戏目录、或用户手动删过游戏里的文件之后，安装包还躺在
 * `data/library/` 里 —— 一条条点「安装」太费手，这里一把装完。
 * 串行跑：安装要写游戏目录，并发装容易互相覆盖同一个 pak。
 */
async function dlInstallAll() {
  if (installAllRunning) { toast('正在安装中，稍等…'); return null; }
  installAllRunning = true;
  const setBtn = (txt, disabled) => {
    const b = document.querySelector('[data-dl-installall]');
    if (b) { b.textContent = txt; b.disabled = !!disabled; }
  };
  setBtn('安装中…', true);
  try {
    const ids = (state.downloads || []).filter(t => t.status === 'downloaded').map(t => t.id);
    if (!ids.length) { toast('没有待安装的任务'); return null; }
    let ok = 0, failed = 0;
    for (let i = 0; i < ids.length; i++) {
      setBtn(`安装中 ${i + 1}/${ids.length}…`, true);
      try { await call(window.api.download.start(ids[i]), { silent: true }); ok++; }
      catch { failed++; }
    }
    await refreshDownloads();
    toast(failed
      ? `已安装 ${fmtNum(ok)} 项，${fmtNum(failed)} 项没能装上（在列表里逐个看原因）`
      : `已安装 ${fmtNum(ok)} 项`, failed ? 'err' : 'ok');
    return { ok, failed };
  } catch (e) {
    toast(e.message, 'err');
    return null;
  } finally {
    installAllRunning = false;
    await refreshDownloads();
    setBtn('⬇ 全部安装', false);
  }
}

/* ---------------- 管理器自带的安装包（data/library） ----------------
 *
 * 「下好了没装」有两份来源，以前只做了第一份：
 *   1. 下载队列里 `status === 'downloaded'` 的任务；
 *   2. 包本身 —— 安装包一直在管理器目录的 `data/library` 里（0.3.4 起这个目录
 *      **不跟着游戏走**），队列被「清理已完成记录」清空、或者换了游戏目录之后，
 *      第 1 份就空了，可包还在。
 *
 * 用户 2026-11-07 反馈「这套功能没看到」，真实原因就是这个：他清过队列（0 项），
 * 而 `renderDownload()` 在「队列空」时直接早退去画空态，把「待安装」整块吞掉了。
 * 现在改成：主进程 `library:list` 直接看磁盘（谁的文件不在当前游戏目录就算可装），
 * 页面无论队列空不空都把这份清单列出来。
 */

let libInstallRunning = false;

async function refreshLibrary() {
  try {
    state.library = await call(window.api.download.library(), { silent: true });
  } catch {
    state.library = null;
  }
  return state.library;
}

function libraryCount() {  return (state.library && state.library.installable) || 0;
}

/** 从当前清单里按 modId 找一条（「定位」「删除」按钮要拿它的 archivePath） */
function libItemOf(modId) {
  const items = (state.library && state.library.items) || [];
  return items.find(x => String(x.modId) === String(modId)) || null;
}

/**
 * 取一个 modId 的展示信息（名字/作者/摘要/版本/封面）。
 * 顺序：先看已经问到的缓存 → 再看下载队列里的任务 meta（不联网、当场就有）
 * → 都没有就返回 null，由 `ensureLibMeta()` 回头去 Nexus 补。
 */
function libMetaFor(modId) {
  const id = String(modId);
  if (state.libMeta && state.libMeta.has(id)) return state.libMeta.get(id);
  const t = (state.downloads || []).find(x => x.meta && String(x.meta.modId) === id);
  if (t && t.meta) {
    const m = t.meta;
    if (m.name || m.author || m.summary || m.image) {
      return {
        name: m.name || '',
        author: m.author || '',
        summary: m.summary || '',
        version: m.version || '',
        image: m.image || m.pictureUrl || ''
      };
    }
  }
  return null;
}

let libMetaBusy = false;

/**
 * 补齐卡片要显示的信息。
 * 磁盘上的包只留得下 modId/版本/大小，封面和作者必须问 Nexus；
 * 一次只问前面几张卡（6 个），问完重绘一次，避免一上来 300 个包把接口打爆。
 * 问不到的也进 `libMetaTried`，这样不会每次重绘都再问一遍。
 */
async function ensureLibMeta() {
  if (libMetaBusy) return;
  if (!state.library || !state.library.items || !state.library.items.length) return;
  const api = (window.api && window.api.info) || null;
  if (!api || typeof api.local !== 'function') return;
  if (!state.libMeta) state.libMeta = new Map();
  if (!state.libMetaTried) state.libMetaTried = new Set();
  const shown = state.library.items.slice(0, state.libShown || 12).filter(it => Number(it.modId));
  const miss = shown
    .map(it => Number(it.modId))
    .filter(id => !state.libMeta.has(String(id)));
  if (!miss.length) return;
  libMetaBusy = true;
  let got = 0;
  const adopt = (obj) => {
    for (const [id, r] of Object.entries(obj || {})) {
      if (!r) continue;
      state.libMeta.set(String(id), {
        name: r.name || '',
        author: r.author || '',
        summary: r.summary || '',
        version: r.version || '',
        image: r.coverLocal || r.pictureUrl || r.image || ''
      });
      got++;
    }
  };
  try {
    /*
     * ① 先问本地档案（档案 → Nexus 目录缓存）——一个网络请求都不发。
     *    绝大多数包在这一步就有名字、作者、版本和封面了。
     */
    try { adopt(await call(api.local(miss), { silent: true })); } catch { /* 本地读失败就往下走 */ }

    /*
     * ② 本地真没有的，才一次补 6 条。主进程补到就落盘（含封面），
     *    所以下一次打开列表这一步也不会再发请求。
     */
    const still = miss
      .filter(id => !state.libMeta.has(String(id)) && !state.libMetaTried.has(String(id)))
      .slice(0, 6);
    if (still.length && typeof api.fill === 'function') {
      for (const id of still) state.libMetaTried.add(String(id));
      try { adopt(await call(api.fill(still), { silent: true })); } catch { /* 没网 / 没 API Key 就按文件名显示 */ }
    }
  } finally {
    libMetaBusy = false;
  }
  // 补到东西就重画一次 —— 卡片可能长在下载页，也可能长在「浏览 Mod → 已下载」里。
  if (got) {
    if (state.browse.onlyDownloaded) renderBrowse();
    else renderDownload();
  }
}

/**
 * 一张「管理器自带的安装包」卡片 —— 版式照抄浏览页（封面 + 标题 + 摘要 + 信息行 + 动作）。
 * `opts.selectable`：放进浏览页的「已下载」筛选时带勾选框（复用浏览页那套多选）；
 * `opts.hideDetail`：卡片本身点一下就是打开详情抽屉，就不用再放一颗「详情」按钮。
 */
function libCardHtml(it, opts) {
  const o = opts || {};
  const selected = !!o.selectable && state.sel.ids.has(String(it.modId));
  const meta = libMetaFor(it.modId) || it.info || {};
  const title = meta.name || it.name;
  const ver = it.version || meta.version || '';
  const ext = (String(it.filename).match(/\.([a-z0-9]{1,5})$/i) || [null, ''])[1].toUpperCase();
  const img = meta.coverLocal || meta.image || coverForMod(it.modId) || '';
  const summary = meta.summary || it.filename;
  return `
  <div class="card${selected ? ' sel' : ''}" data-modid="${it.modId}" data-libcard="${it.modId}">
    <div class="cover">
      ${img
        ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'无封面图'}))">`
        : `<div class="ph">本地安装包<br>${esc(ext || '压缩包')}</div>`}
      ${ext ? `<span class="tag">${esc(ext)}</span>` : ''}
      <span class="lb dl">安装包</span>
      ${o.selectable ? `<div class="ck${selected ? ' on' : ''}" data-ck="${it.modId}">✓</div>` : ''}
    </div>
    <div class="cbody">
      <h3 data-i18n-skip title="${esc(title)}">${esc(title)}</h3>
      <div class="zh" data-i18n-skip title="${esc(summary)}">${esc(summary)}</div>
      <div class="meta">
        <span class="chip">#${it.modId}</span>
        ${ver ? `<span class="chip">v${esc(ver)}</span>` : ''}
        ${meta.author ? `<span data-i18n-skip title="作者">${esc(clip(meta.author, 14))}</span>` : ''}
        <span>${fmtSize(it.size)}</span>
        <div class="acts">
          ${it.modId ? voteHtml(it) : ''}
          ${o.hideDetail ? '' : `<button class="btn sm" data-libdetail="${it.modId}" title="看这个 Mod 在 Nexus 上的详情">详情</button>`}
          <button class="btn sm" data-libreveal="${it.modId}" title="在资源管理器里定位这份安装包">定位</button>
          <button class="btn sm d" data-libdel="${it.modId}" title="从管理器里删掉这份安装包（不影响已经装进游戏的文件）">删除</button>
          <button class="btn sm p" data-lib-install="${it.modId}" title="把这份安装包装进当前游戏目录">装进游戏</button>
        </div>
      </div>
    </div>
  </div>`;
}

function libraryBoxHtml() {
  const n = libraryCount();
  if (!n) return '';
  return `<div class="lib-hint">
    <span>管理器里还有 <b>${fmtNum(n)}</b> 个安装包没有装进当前游戏目录（包一直在管理器目录里，不会跟着游戏走）。</span>
    <button class="btn sm" data-lib-goto="1" title="打开「浏览 Mod」页的「已下载」筛选，可以多选批量安装">到「已下载」里批量安装</button>
  </div>`;
}

async function libInstallOne(it) {
  await call(window.api.download.installFromLibrary(it.archivePath, {
    modId: it.modId, name: it.name, version: it.version
  }), { silent: true });
}

/** 装单个：把 library 里的这个包重新装进当前游戏目录 */
/**
 * 「有 bug」标记的挂起上下文（弹窗里的三个按钮各自 resolve 同一个 Promise）。
 * 只在一处用，所以是个模块级单例而不是 state 字段。
 */
let bugSkipCtx = null;

/**
 * 安装前查一遍「有 bug」标记：命中了就先问一句要不要跳过（用户 2026-11-09）。
 *
 * @param {Array} items 打算装的安装包 / 任务（要有 `modId`，`name` 用来显示）
 * @returns {Promise<Array|null>} 真正要装的那批；用户取消返回 `null`
 *
 * 之所以返回**列表**而不是布尔：批量安装中途剔除几个包是最自然的表意，
 * 调用方拿到就能直接 `for (const it of list)`，不用再各自过滤一遍。
 */
function confirmBugMarked(items) {
  const list = items || [];
  const bad = list.filter(it => it && it.modId && state.bugIds.has(String(it.modId)));
  if (!bad.length) return Promise.resolve(list);
  const names = bad.slice(0, 5).map(it => it.name || ('#' + it.modId)).join('、')
    + (bad.length > 5 ? ` 等 ${bad.length} 个` : '');
  return new Promise(resolve => {
    bugSkipCtx = {
      onSkip: () => resolve(list.filter(it => !bad.includes(it))),
      onAll: () => resolve(list),
      onCancel: () => resolve(null)
    };
    openModal('这批里有标过「有 bug」的 Mod', `
      <div class="callout warn">
        里面这 ${bad.length} 个你之前标记过「有 bug」—— 装进去可能影响游戏：
        <div style="margin-top:6px">${esc(names)}</div>
      </div>
      <div class="callout" style="color:var(--dim2)">
        标记只是提醒，不会拦你。想改主意可以在「已安装 Mod」里点开那个 Mod，取消标记。
      </div>
    `, [
      { id: 'bugSkipAll', label: `全部跳过这 ${bad.length} 个`, primary: true },
      { id: 'bugKeepAll', label: '仍然全部安装' },
      { id: 'bugCancel', label: '取消' }
    ]);
  });
}

async function libInstall(modId) {
  const find = () => ((state.library && state.library.items) || []).find(x => String(x.modId) === String(modId));
  let it = find();
  // 从浏览页点进来的：可能还没进过「下载」页，清单是空的 —— 现拉一次
  if (!it) { await refreshLibrary(); it = find(); }
  if (!it) { toast('安装包不在本地了（可能被删了），重新下载一次吧', 'warn'); return; }
  // 单个安装也问一句：标过「有 bug」的包，别手滑又装进去
  const ok = await confirmBugMarked([it]);
  if (!ok || !ok.length) return;
  try {
    await libInstallOne(it);
    toast('已加入安装队列');
    await refreshDownloads();
    await refreshLibrary();
    await refreshCardStates();   // 浏览页那张卡的「安装」立刻变成「安装中」
    // 在「已下载」筛选里点的，就重画浏览页（装进去的那张会从清单里消失）
    if (state.browse.onlyDownloaded) renderBrowse(); else renderDownload();
  } catch (e) { toast(e.message, 'err'); }
}

/**
 * 「已下载」筛选里的批量安装：把勾选的安装包串行排进安装队列。
 * 串行是刻意的 —— 同时装有可能会抢同一个游戏目录、冲突提示也会挤在一起。
 */
let libBatchRunning = false;

async function libBatchInstall(pickedArg) {
  if (libBatchRunning) { toast('正在安装中，稍等…'); return; }
  const items = (state.library && state.library.items) || [];
  // pickedArg：Mod 库统一选择集传进来的批次；不传就按老的「勾选的 modId」自己挑
  const picked = Array.isArray(pickedArg) ? pickedArg : items.filter(it => state.sel.ids.has(String(it.modId)));
  if (!picked.length) { toast('先勾选要安装的包'); return; }
  // 先问「有 bug」标记（放在 running 标志之前 —— 用户取消时不该把按钮锁死）
  const list = await confirmBugMarked(picked);
  if (!list) return;
  if (!list.length) { toast('勾选的包都标过「有 bug」，已全部跳过', 'warn'); return; }
  libBatchRunning = true;
  const btn = $('#btnBatchDownload');
  const keepLabel = btn ? btn.textContent : '';
  try {
    let ok = 0, failed = 0;
    for (let i = 0; i < list.length; i++) {
      if (btn) { btn.disabled = true; btn.textContent = `安装中 ${i + 1}/${list.length}…`; }
      try { await libInstallOne(list[i]); ok++; } catch { failed++; }
    }
    state.sel.ids.clear();
    state.sel.all = false;
    await refreshDownloads();
    await refreshLibrary();
    renderBrowse();
    toast(failed
      ? `已开始安装 ${fmtNum(ok)} 个包，${fmtNum(failed)} 个没能开始（在下载页看原因）`
      : `已开始安装 ${fmtNum(ok)} 个包`, failed ? 'err' : 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    libBatchRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = keepLabel; }
    selUpdateBar();
  }
}

/** 全部装：串行一个个来（同时装会抢同一个游戏目录） */
async function libInstallAll() {
  if (libInstallRunning) { toast('正在安装中，稍等…'); return; }
  const all = (state.library && state.library.items) || [];
  if (!all.length) { toast('没有待安装的任务'); return; }
  // 先问「有 bug」标记（放在 running 标志之前 —— 用户取消时不该把按钮锁死）
  const list = await confirmBugMarked(all);
  if (!list) return;
  if (!list.length) { toast('待安装的包都标过「有 bug」，已全部跳过', 'warn'); return; }
  libInstallRunning = true;
  const setBtn = (txt, disabled) => {
    const b = document.querySelector('[data-lib-installall]');
    if (b) { b.textContent = txt; b.disabled = !!disabled; }
  };
  setBtn('安装中…', true);
  try {
    const items = list;
    let ok = 0, failed = 0;
    for (let i = 0; i < items.length; i++) {
      setBtn(`安装中 ${i + 1}/${items.length}…`, true);
      try { await libInstallOne(items[i]); ok++; } catch { failed++; }
    }
    await refreshDownloads();
    await refreshLibrary();
    if (state.browse.onlyDownloaded) renderBrowse(); else renderDownload();
    toast(failed
      ? `已开始安装 ${fmtNum(ok)} 个包，${fmtNum(failed)} 个没能开始（在下载页看原因）`
      : `已开始安装 ${fmtNum(ok)} 个包`, failed ? 'err' : 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    libInstallRunning = false;
  }
}

async function dlCancel(id) {
  try { await call(window.api.download.cancel(id), { silent: true }); toast('已取消'); await refreshDownloads(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ---------------- 暂停 / 继续 / 全部停止 ---------------- */

/**
 * ⏸ 暂停一条。
 *
 * 与「取消」的区别（用户 2026-10-14 要求两种都要有）：
 *   暂停 → 半截文件留着，点「继续」从断点接着下
 *   取消 → 半截文件清掉，这条任务到此为止
 */
async function dlPause(id) {
  const btn = document.querySelector(`[data-dl-pause="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '暂停中…'; }
  try {
    await call(window.api.download.pause(id), { silent: true });
    toast('已暂停（已下载的部分已保留，点「继续」接着下）');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    await refreshDownloads();
  }
}

/** 「⏸ 全部停止」是否在跑（挡住重复点） */
let pauseAllRunning = false;

/**
 * ⏸ 全部停止 —— 把正在下载的任务一次性暂停。
 *
 * 口径是**暂停**不是取消：半截文件全都留着，之后点「全部恢复」接着下。
 * （这条口径是问过用户的：他选的是「暂停，保留进度」。）
 */
async function dlPauseAll() {
  if (pauseAllRunning) { toast('正在停止中，稍等…'); return null; }
  pauseAllRunning = true;
  const btn = document.querySelector('[data-dl-pauseall]');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '停止中…'; }
  try {
    const r = await call(window.api.download.pauseAll(), { silent: true });
    const n = (r && r.total) || 0;
    toast(n ? `已停止 ${n} 项（进度已保留，可点「全部恢复」接着下）` : '没有正在下载的任务');
    return r;
  } catch (e) {
    toast(e.message, 'err');
    return null;
  } finally {
    pauseAllRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = label || '⏸ 全部停止'; }
    await refreshDownloads();
  }
}

/* ---------------- 一键安装（默认选择） ---------------- */

/**
 * ⚡ 一键安装（单条）—— 按「每组第一套 + 互不相关的全选」直接装。
 *
 * 用户 2026-10-14：「有多个文件时每组冲突的 mod 都默认选中第一个文件；
 * 不要手工一个一个确认」。想改组合仍可点旁边的「选择内容」打开对话框。
 */
async function dlConfirmDefault(id) {
  const btn = document.querySelector(`[data-dl-confirmdefault="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '安装中…'; }
  try {
    await call(window.api.download.confirmDefault(id), { silent: true });
    toast('开始安装…');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    await refreshDownloads();
  }
}

/** 「⚡ 一键安装全部」是否在跑 */
let confirmAllRunning = false;

/**
 * ⚡ 一键安装全部 —— 把所有「待确认」的包按默认选择一次装掉。
 *
 * 主进程那边是**串行 + 节流**的（每条都要解压分析，一口气并发会把磁盘打满），
 * 所以用按钮文案当进度条 + `download:confirmprogress` 实时更新，
 * 避免用户以为程序卡住了。
 */
async function dlConfirmAll() {
  if (confirmAllRunning) { toast('正在一键安装中，稍等…'); return null; }
  confirmAllRunning = true;
  const btn = document.querySelector('[data-dl-confirmall]');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '安装中…'; }
  try {
    const r = await call(window.api.download.confirmAllDefault({}), { silent: true });
    if (!r) return null;
    const parts = [`处理 ${r.total} 项`];
    if (r.failed) parts.push(`失败 ${r.failed}`);
    const still = (state.downloads || []).filter(t => t.status === 'needs_review').length;
    if (still) parts.push(`仍有 ${still} 项需要你挑内容`);
    toast('一键安装：' + parts.join('，'), r.failed ? 'err' : 'ok');
    return r;
  } catch (e) {
    toast(e.message, 'err');
    return null;
  } finally {
    confirmAllRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = label || '⚡ 一键安装全部'; }
    await refreshDownloads();
  }
}

/** 批量一键安装的实时进度 → 按钮文案 */
function onConfirmProgress(p) {
  if (!p || !p.total) return;
  const btn = document.querySelector('[data-dl-confirmall]');
  if (btn && confirmAllRunning) btn.textContent = `安装中 ${p.done}/${p.total}…`;
}

/* ---------------- 彻底删除 ---------------- */

/** 「彻底删除」确认框对应的任务 id（点确认时要用） */
let purgeTaskId = null;

/**
 * 🗑 彻底删除（**带二次确认**）。
 *
 * 清掉记录 + 本地安装包 + 半截下载 + 缓存图；**不动游戏目录**（口径已确认）。
 * 它比「移除」更彻底，且不可撤销，所以必须问一次，并且把「已安装」这种
 * 最容易误会的场景单独写清楚：删了记录不等于卸载。
 */
function dlPurge(id) {
  const t = dlFind(id);
  if (!t) return;
  const meta = t.meta || {};
  const name = meta.name || ('Mod #' + (meta.modId || '?'));
  purgeTaskId = t.id;

  const installed = t.status === 'installed' || !!(t.install && t.install.registryId);
  // ⚠️ 这里的句子刻意**不嵌 `<b>` 标签**：i18n 是按 DOM 文本节点查表的，
  //    中间插标签会把一句话切成 `会清掉这些` / `本地` / `内容：` 三段，
  //    整句就再也查不到字典了（老文案踩过这个坑）。
  openModal('彻底删除「' + name + '」？', `
    <p>会清掉这些本地内容：</p>
    <ul style="margin:8px 0 0 18px;line-height:2">
      <li>下载队列里的这条记录</li>
      <li>本地安装包：${t.archivePath ? `<code>${esc(clip(t.filename || '安装包', 40))}</code>` : '这条没有'}</li>
      <li>没下完的半截文件</li>
      <li>缓存的封面与预览图</li>
    </ul>
    ${installed ? `<div class="callout warn" style="margin-top:10px">
      彻底删除不会动游戏目录里的文件 —— 想卸载请到「已安装 Mod」页点「卸载」（那里会把被它覆盖的原始文件还原回去）。
    </div>` : ''}
  `, [
    { label: '取消', id: 'pCancel' },
    { label: '彻底删除', id: 'pPurge', primary: true, danger: true }
  ]);
}

async function dlPurgeConfirmed() {
  const id = purgeTaskId;
  purgeTaskId = null;
  closeModal();
  if (!id) return;
  try {
    const r = await call(window.api.download.purge(id), { silent: true });
    await refreshDownloads();
    if (r && r.ok) {
      const bits = [];
      if (r.archive) bits.push('安装包');
      if (r.parts && r.parts.length) bits.push(`半截文件 ${r.parts.length} 个`);
      if (r.images) bits.push('缓存图');
      toast('已彻底删除' + (bits.length ? '（' + bits.join('、') + '）' : ''));
    } else {
      toast('删除失败', 'err');
    }
  } catch (e) { toast(e.message, 'err'); }
}

async function dlConfirm(id) {
  const t = dlFind(id);
  let plan = t && t.install && t.install.plan;

  // ⚠️ 任务**失败过**就先重新分析一次。
  //
  //    失败任务手上那份 plan 可能是上一次「选了一套变体」分析出来的（`ok:true`），
  //    直接走 confirmInstall 会**不传 pickDir 重跑一遍**必然失败的分析，
  //    状态从「失败」翻回「待确认」——用户点了按钮却什么都没发生（实测踩过）。
  //    先刷新拿到「需要选一套」的结论，下面就能一步弹出选择框。
  if (t && t.status === 'failed') {
    try {
      const fresh = await call(window.api.download.plan(id), { silent: true });
      if (fresh) plan = fresh;
    } catch { /* 拿不到就用手上的 plan 继续判 */ }
  }

  // 常规路径：结构能识别（或待确认的原因是覆盖冲突 / 缺 CNS 之类）
  if (!plan || !plan.needsTargetPick) return doConfirmInstall(id);

  // 结构识别不了（典型：多选一变体包）→ 必须先让用户挑一套。
  // 直接 confirmInstall 会再跑一遍**必然失败**的分析，任务又回到「待确认」，
  // 界面看起来就是卡死不动（实测踩过）。
  //
  // ⚠️ 老任务存的 plan 可能没有 `options` / `exclusiveGroups`（都是后加的字段）。
  //    缺 `options` → 会弹出没有候选项的空框；
  //    缺 `exclusiveGroups` → 会把互斥的几套**全部预选**，提交后被主进程打回来重选。
  //    两种情况都先重新分析一次拿全字段。
  //    注意判据是「**字段不存在**」而不是「数组为空」—— `[]` 是有意义的
  //    （mod 3970 那三套互不相关，`[]` 表示全都能装）。
  if (!(plan.options || []).length || !Array.isArray(plan.exclusiveGroups)) {
    try {
      const fresh = await call(window.api.download.plan(id), { silent: true });
      if (fresh) plan = fresh;
    } catch { /* 拿不到就用手上的，下面走「手动处理」分支 */ }
  }
  if (plan.ok) return doConfirmInstall(id);   // 重新分析后能识别了，直接装
  openVariantPicker(t, plan);
}

/** 走常规的「确认安装」（不带 pickDir） */
async function doConfirmInstall(id) {
  try {
    await call(window.api.download.confirmInstall(id, { onConflict: 'overwrite' }), { silent: true });
    toast('开始安装…');
    await refreshDownloads();
  } catch (e) { toast(e.message, 'err'); }
}

/**
 * 「这个包里有好几套内容，选要装哪些」对话框。
 *
 * 触发条件：`analyze()` 返回 `needsTargetPick`（结构识别不出来），
 * 最常见的是**多选一变体包** —— 同一件衣服的几套配色各占一个子目录，
 * 装多套会互相覆盖，只能选一套。
 *
 * 🔴 但**不总是「选一套」**（2026-10-13 实测 mod 3970「Nv_pu_CNS」）：
 * 那包里三个子目录是三个**互不相关**的 mod（主 mod + 皮肤 + 中文字体），
 * 全都要装。所以这里做成**多选**：用户自己决定装几套。
 * 真选了互相覆盖的两套时，主进程会明确报「有同名文件」并让你重选（不会静默装歪）。
 */
function openVariantPicker(t, plan) {
  const opts = Array.isArray(plan.options) ? plan.options : [];
  const meta = (t && t.meta) || {};
  const name = meta.name || ('Mod #' + (meta.modId || '?'));
  state.modalTask = t ? t.id : null;   // 「打开文件夹」按钮要用

  // 🔴 **按互斥组默认预选**（2026-10-13）：
  //
  // 之前进来是「一个都没选」，用户必须自己判断「哪几套会互相覆盖」——
  // 而这件事主进程已经算得明明白白（`plan.exclusiveGroups`）。
  // 现在：**每个互斥组预选第一套，不在任何组里的全选**。
  //
  // 于是常见情况变成「点开 → 已经选好了 → 直接点安装」：
  //   - mod 1430（A~G 七套配色，同一资产）→ 预选 A
  //   - mod 3970（主 mod + 皮肤 + 字体，互不相关）→ 三套全选
  //   - mod 437（ID77117×6 + ID77127 + ID77137×2）→ 预选 A + V2_A + V3_A
  //
  // 这只是**默认值**，用户随时能改 —— 而「一个都没选」时用户只能猜。
  const groups = Array.isArray(plan.exclusiveGroups) ? plan.exclusiveGroups : [];
  state.pick = new Set();
  // dir → 同组的所有 dir。点某一套时把同组其它套取消掉（组内单选），
  // 免得用户选了两套变体、提交后才被主进程打回来重选。
  state.pickGroups = new Map();
  const grouped = new Set();
  for (const g of groups) {
    if (!Array.isArray(g) || !g.length) continue;
    state.pick.add(g[0]);
    for (const d of g) { grouped.add(d); state.pickGroups.set(d, g); }
  }
  for (const o of opts) if (!grouped.has(o.dir)) state.pick.add(o.dir);

  if (!opts.length) {
    const pakCount = Number(plan && plan.pakCount) || 0;
    const shown = (Array.isArray(plan && plan.entries) ? plan.entries : []).slice(0, 8);
    // 「不是游戏 Mod」是一句**结论**，不是「没见过这种结构」——
    // 两者要分开说：前者该直接删掉记录，后者才值得去找目录、翻 Nexus 说明。
    const diag = (plan && plan.diagnosis) || '';
    const why = diag
      ? esc(diag) + '。'
      : pakCount
        ? `包里有 <b>${pakCount}</b> 个 <code>.pak</code> / <code>.ucas</code> / <code>.utoc</code>，
           但目录结构和已知的 mod 布局都不一样 —— 很可能是个新形式的包。`
        : '包里没有 <code>.pak</code> 文件。';
    openModal(diag ? '这个包不是游戏 Mod' : '这个包需要手动处理', `
      <p>「${esc(name)}」${diag ? '' : '的结构没法自动识别，'}${why}</p>
      ${shown.length ? `
        <div class="lbl">包里的内容（前 ${shown.length} 项，共 ${Number(plan && plan.fileCount) || shown.length} 个）</div>
        <div class="filelist">${shown.map(p => esc(p)).join('<br>')}</div>` : ''}
      <div class="callout" style="margin-top:10px">
        ${diag
          ? '这类文件是作者做 mod 用的原料，游戏读不到。点「移除」删掉这条记录（会连同安装包一起删）即可，不用手动指定目录。'
          : '点「打开文件夹」自己确认结构，或手动指定要把哪些文件装到哪；也可以回 Nexus 页面看这个 mod 的安装说明。'}
      </div>`, diag
      ? [{ label: '知道了', id: 'vCancel', primary: true }]
      : [{ label: '打开文件夹', id: 'vReveal' }, { label: '知道了', id: 'vCancel', primary: true }]);
    return;
  }

  // dir → 互斥组序号（1 起）。同一序号 = 同一件东西的不同版本，只能选一个。
  const groupNo = new Map();
  groups.forEach((g, i) => { for (const d of (g || [])) groupNo.set(d, i + 1); });
  const nGroups = groups.length;

  const body = `
    <p style="color:var(--dim);margin-bottom:10px">
      「${esc(name)}」里有 <b>${opts.length}</b> 套内容，各自放在独立的子目录里。
      ${nGroups
        ? `其中 <b>${nGroups}</b> 组是<b>同一件东西的不同版本</b>（组内会互相覆盖，只能选一套），已为你每组预选了一套。`
        : '这几套互不相关，可以一起装。'}
      点一下可以改选。
    </p>
    ${plan.reason ? `<div class="callout" style="margin-bottom:10px">${esc(plan.reason)}</div>` : ''}
    <div class="vlist" id="vList">
      ${opts.map(o => {
        const gno = groupNo.get(o.dir);
        // 副标题：所属分组 + 资产 ID。资产 ID 相同 = 同一件东西的不同版本。
        const sub = [o.group, o.key].filter(Boolean).join(' · ');
        return `
        <button class="vopt" data-pick="${esc(o.dir)}" data-pick-task="${esc(t.id)}" aria-pressed="false">
          <span class="vc" data-vc="${esc(o.dir)}"></span>
          <span class="vl">
            <b>${gno ? `<em class="vg">第 ${gno} 组 · 只能选一套</em>` : ''}${esc(o.label)}</b>
            ${sub ? `<i>${esc(sub)}</i>` : ''}
          </span>
          <span class="vr">${o.files} 个文件 · ${fmtSize(o.size)}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="callout" style="margin-top:10px">
      选中的内容会装到 <code>~Mods</code>；没选中的不会安装。想换，回到「下载」页重新点「确认安装」即可。
    </div>`;
  openModal('选择要安装哪些内容', body, [
    { label: '取消', id: 'vCancel' },
    { label: '安装选中的（0）', id: 'vInstall', primary: true }
  ]);
  syncPickBar();
  loadVariantCovers(t, opts);
}

/**
 * 给对话框里的每套内容补上**预览图**。
 *
 * 实测 mod 1430「BP Cooling suit」：包里 7 个目录 + 7 张同名 jpg，
 * 不看图完全不知道 A~G 哪套是什么颜色 —— 用户只能瞎点。
 * 图是从压缩包里**按需解出**的（只解那几张，不全解），主进程侧有缓存。
 *
 * 失败/没图（mod 1378 / 2595 就没有）→ 什么都不做，列表照旧能用。
 */
async function loadVariantCovers(t, opts) {
  if (!t || !t.id) return;
  const archivePath = t.archivePath
    || (state.install && state.install.plan && state.install.plan.archivePath);
  if (!archivePath || !window.api.install.variantCovers) return;
  const dirs = (opts || []).map(o => o.dir).filter(Boolean);
  if (!dirs.length) return;

  let map = {};
  try { map = (await window.api.install.variantCovers(archivePath, dirs)) || {}; }
  catch { return; }

  // 图回来时对话框可能已经关了 / 换任务了 —— 那就别往里塞
  if (!state.modalTask || state.modalTask !== t.id) return;
  if (!$('#vList')) return;

  // 用 dataset 比对，不拼选择器 —— 目录名里带 `(` `)` 之类的字符（真实形态：
  // `Planet Diving Suit (7th)_A`），拼进 `[data-vc="..."]` 要靠 CSS 转义才安全，
  // 而直接比字符串没有这个问题。
  for (const box of $$('#vList .vc')) {
    const url = map[box.dataset.vc];
    if (!url) continue;
    box.classList.add('has');
    box.innerHTML = `<img src="${esc(url)}" alt="" loading="lazy"
      onerror="this.parentNode.classList.remove('has');this.parentNode.innerHTML=''">`;
  }
}

/** 勾选状态变了：同步按钮文字与选中样式 */
function syncPickBar() {
  const n = state.pick ? state.pick.size : 0;
  $$('#vList .vopt').forEach(b => {
    const on = state.pick.has(b.dataset.pick);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const btn = $('#mFoot [data-mbtn="vInstall"]');
  if (btn) {
    btn.textContent = n ? `安装选中的（${n}）` : '请选择要装的内容';
    btn.disabled = !n;
  }
}

/** 选定内容后真正开始安装（dirs 可以有多套） */
async function installWithPick(taskId, pickDirs) {
  const dirs = (Array.isArray(pickDirs) ? pickDirs : (pickDirs ? [pickDirs] : [])).filter(Boolean);
  if (!dirs.length) { toast('请先选择要安装的内容', 'err'); return; }
  try {
    await call(window.api.download.confirmInstall(taskId, { onConflict: 'overwrite', pickDirs: dirs }), { silent: true });
    toast('开始安装…');
    await refreshDownloads();
  } catch (e) { toast(e.message, 'err'); }
}

async function dlRemove(id) {
  const t = dlFind(id);
  const keepArchive = t && t.status === 'installed';
  try {
    await call(window.api.download.remove(id, { deleteArchive: !keepArchive }), { silent: true });
    await refreshDownloads();
    toast(keepArchive ? '已删除记录（安装包保留）' : '已移除');
  } catch (e) { toast(e.message, 'err'); }
}

async function dlReveal(id) {
  try { await call(window.api.download.reveal(id), { silent: true }); }
  catch (e) { toast(e.message, 'err'); }
}

async function dlClearDone() {
  const done = (state.downloads || []).filter(t => t.status === 'installed' || t.status === 'cancelled');
  if (!done.length) return;
  for (const t of done) {
    try { await call(window.api.download.remove(t.id, { deleteArchive: false }), { silent: true }); } catch { /* 忽略 */ }
  }
  await refreshDownloads();
  toast('已清理 ' + done.length + ' 条记录');
}

/** 下载任务的详情抽屉：本地缓存的封面 + 尽量多的预览图 */
function openDownloadDrawer(id) {
  const t = dlFind(id);
  if (!t) return;
  const meta = t.meta || {};
  const st = dlStatusMeta(t);
  const imgs = (Array.isArray(meta.images) ? meta.images : []).filter(x => x && x.localUrl);

  state.drawer = { open: true, kind: 'download', mod: t, lang: 'zh', translated: null, translating: false, files: [] };
  $('#dTitle').textContent = meta.name || ('Mod #' + (meta.modId || '?'));
  $('#dSub').textContent = [meta.version ? 'v' + meta.version : '', meta.author, st.t].filter(Boolean).join(' · ');

  const gallery = imgs.length
    ? `<div class="lbl">预览图 · ${imgs.length} 张（已缓存到本地）</div>${imageGrid(imgs)}`
    : (meta.pictureUrl ? `<img class="hero" src="${esc(meta.pictureUrl)}" alt="">` : '<div class="txt" style="color:var(--dim2)">还没有缓存到图片</div>');

  // 「会被覆盖的文件」—— 用户明确要求：要列出来、要能看出是谁的东西、点击能定位
  const cd = conflictDetailsOf(t);
  const cdHtml = (cd && cd.total)
    ? `<div class="lbl" id="dlConflicts">会被覆盖的文件 · ${cd.total} 个${
        cd.sameSizeCount ? `（其中 ${cd.sameSizeCount} 个与现有文件大小相同，基本是同一个文件）` : ''
      }</div>
      <div class="callout" style="margin-bottom:8px">
        安装前会先把这些文件<b>备份</b>下来，卸载或还原时能还回去。
        点任意一行可在<b>资源管理器</b>中定位到它。
      </div>
      ${conflictListHtml(cd, { incoming: meta })}
      <div style="height:10px"></div>`
    : '';

  // 已经装完的：说明「实际覆盖了多少」—— 用的是真实备份条数，不是预测
  const installedOverwrite = (t.status === 'installed' && t.install && t.install.overwrittenCount)
    ? `<div class="callout" style="margin-bottom:8px">安装时覆盖了 <b>${t.install.overwrittenCount}</b> 个已存在的文件（已备份，卸载时会还原）。</div>`
    : '';

  $('#dBody').innerHTML = `
    <div id="galleryBox">${gallery}</div>
    <div class="lbl">状态</div>
    <div class="kv"><span>当前</span><span><span class="dl-st ${st.c}">${esc(st.t)}</span></span></div>
    ${t.error ? `<div class="callout err">${esc(t.error)}</div>` : ''}
    ${installedOverwrite}
    ${cdHtml}
    ${meta.summary ? `<div class="lbl">说明</div><div class="txt">${esc(meta.summary)}</div>` : ''}
    <div class="lbl">信息</div>
    <div class="kv"><span>Mod ID</span><span>${esc(meta.modId || '—')}</span></div>
    <div class="kv"><span>文件 ID</span><span>${esc(meta.fileId || '—')}</span></div>
    <div class="kv"><span>作者</span><span>${esc(meta.author || '—')}</span></div>
    <div class="kv"><span>版本</span><span>${esc(meta.version || '—')}</span></div>
    <div class="kv"><span>安装包</span><span>${esc(t.filename || '—')}</span></div>
    <div class="kv"><span>大小</span><span>${t.size ? fmtSize(t.size) : '—'}</span></div>
    <div class="kv"><span>加入时间</span><span>${esc(fmtDate(t.createdAt))}</span></div>
    ${t.install && t.install.targetLabel ? `<div class="kv"><span>安装到</span><span>${esc(t.install.targetLabel)}</span></div>` : ''}
    ${meta.sourceUrl ? `<div class="lbl">来源</div><div class="urlbox"><span style="flex:1">${esc(meta.sourceUrl)}</span><button class="btn sm" data-openurl="${esc(meta.sourceUrl)}">打开</button></div>` : ''}
  `;
  $('#dFoot').innerHTML = dlActionsHtml(t)
    + (meta.modId ? `<button class="btn" data-gallery="${esc(meta.modId)}">刷新图集</button>` : '');
  showDrawer();
}

/** 队列整体变化（新增 / 状态变更 / 删除）→ 全量重绘 */
function onDownloadChanged(info) {
  if (!info) return;
  const prev = state.downloads || [];
  state.downloads = info.tasks || [];
  state.downloadStats = info.stats || {};

  /**
   * 🔴 只换了进度、状态一个没变 → **绝不能整页重画**。
   *
   * 实测故障（2026-11-07 用户报「有下载进度时筛选按钮会失灵，一闪一闪的」）：
   * 进度事件曾经走的是 `download:changed`，于是已安装页每来一次进度就
   * `area.innerHTML = …` 重建一遍 —— 卡片里的 `<img>` 全部重新加载（闪），
   * 而且用户按下与松开鼠标之间节点被换掉，click 根本不派发（按钮「失灵」）。
   *
   * 现在主进程把纯进度分流到 `download:progress`（见 downloadQueue），这里再兜一层保险：
   * 状态签名没变就只增量刷新顶部实时条，其余 DOM 一个节点都不动。
   */
  if (dlStatusSig(prev) === dlStatusSig(state.downloads)) {
    renderLiveStrip();
    return;
  }

  renderDownload();
  renderSidebar();
  const inst = $('#p-installed');
  if (inst && inst.classList.contains('on')) renderInstalled();
  // 浏览页卡片上的「已安装 / 已下载」标记也跟着变
  scheduleCardStateRefresh();

  // 有任务刚变成「已安装」→ 重拉已安装列表（让新 mod 和封面出现）
  const justInstalled = info.task && info.task.status === 'installed' &&
    !prev.some(t => t.id === info.task.id && t.status === 'installed');
  if (justInstalled) {
    toast('已安装：' + ((info.task.meta && info.task.meta.name) || ('Mod #' + (info.task.meta && info.task.meta.modId))), 'ok');
    refreshAll().catch(() => {});
  }
  const justFailed = info.task && info.task.status === 'failed' &&
    !prev.some(t => t.id === info.task.id && t.status === 'failed');
  if (justFailed) toast('下载/安装失败：' + (info.task.error || ''), 'err');
}

/** 「任务 id + 状态」拼成的指纹：只有它变了才值得整页重画 */
function dlStatusSig(tasks) {
  return (tasks || []).map(t => String(t.id) + ':' + String(t.status)).join('|');
}

/**
 * 只刷新已安装页顶部的实时条（`.live`），不碰下面的工具栏与卡片网格。
 *
 * 已安装页的实时条是整块 `innerHTML` 里的一段，所以要做成「就地替换那一个节点」：
 * 有就换内容、没有就插到最前面、没有任务可显示就摘掉。
 */
function renderLiveStrip() {
  const area = $('#installedArea');
  if (!area) return;
  const html = liveStrip();
  const cur = area.querySelector(':scope > .live');
  if (!html) {
    if (cur) cur.remove();
    return;
  }
  if (cur) {
    cur.outerHTML = html;
    return;
  }
  area.insertAdjacentHTML('afterbegin', html);
}

/** 细粒度进度 → 只改那一根进度条，不整体重绘（否则每个分片都重排一次 DOM） */
function onDownloadProgress(p) {
  if (!p || !p.id) return;
  const t = dlFind(p.id);
  if (!t) return;
  t.progress = { ...(t.progress || {}), ...p };
  const row = document.querySelector(`.dl-item[data-dlid="${(window.CSS && CSS.escape) ? CSS.escape(String(p.id)) : String(p.id)}"]`);
  if (row) {
    const bar = row.querySelector('.prog');
    if (bar && typeof p.percent === 'number') {
      bar.classList.remove('ind');
      const fill = bar.querySelector('i');
      if (fill) fill.style.width = p.percent + '%';
    }
  }
  // 已安装页顶部的实时条也同步一下
  const inst = $('#p-installed');
  if (inst && inst.classList.contains('on')) {
    const live = inst.querySelector('.live');
    if (live) {
      const pctEl = live.querySelector(`.li[data-live="${p.id}"] .pct`);
      if (pctEl && typeof p.percent === 'number') pctEl.textContent = p.percent + '%';
    }
  }
}

/* ---------------- 设置 ---------------- */

function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return '刚刚确认';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前确认';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前确认';
  return Math.floor(s / 86400) + ' 天前确认';
}

/**
 * 顶栏的 Nexus 账号按钮：**已登录就显示「头像 + 账号名」**，未登录显示「Nexus 账号」。
 *
 * 头像 URL 来自登录判定脚本（`nexusAuth.SCRIPT_VERIFY_ANY` 的 `avatar`）——
 * 某些判定路径拿不到（比如只有 `Welcome back` 那条），那时退化成**首字母方块**，
 * 不留破图。图片加载失败也走同一条退化路径。
 *
 * 放在 `renderAuthLine()` 里调用：所有更新登录状态的地方都会顺手刷顶栏，
 * 不用去改六处 `state.auth = ...`。
 */
function renderTopAccount() {
  const btn = $('#btnNexusAccount');
  if (!btn) return;
  const a = state.auth;
  if (a && a.loggedIn) {
    const name = String(a.user || '').trim() || 'Nexus 账号';
    // 首字母经 dataset 传给 onerror（内联脚本里再嵌引号会被解析器吃掉）
    const initial = name.slice(0, 1).toUpperCase();
    const face = a.avatar
      ? `<img class="acct-av" src="${esc(a.avatar)}" alt="" data-ini="${esc(initial)}" referrerpolicy="no-referrer"`
        + ` onerror="var s=document.createElement('span');s.className='acct-av ph';s.textContent=this.dataset.ini||'?';this.replaceWith(s)">`
      : `<span class="acct-av ph">${esc(initial)}</span>`;
    btn.classList.add('acct');
    btn.innerHTML = `${face}<span class="acct-nm">${esc(name)}</span>`;
    btn.title = `已登录 Nexus：${name}（点这里看账号设置 / 退出登录）`;
  } else {
    btn.classList.remove('acct');
    btn.textContent = 'Nexus 账号';
    btn.title = a ? '未登录 · 点这里去登录' : '正在检测登录状态…';
  }
}

function renderAuthLine() {
  renderTopAccount();   // 顶栏账号按钮（任何页面都要 —— 所以放在 #authLine 的 return 之前）
  const el = $('#authLine');
  if (!el) return;
  const a = state.auth;
  if (!a) { el.innerHTML = '<span style="color:var(--dim)">检测中…</span>'; return; }
  if (a.loggedIn) {
    const when = relTime(a.verifiedAt);
    el.innerHTML = `<span style="color:var(--ok)">● 已登录${a.user ? '：' + esc(a.user) : ''}</span>
      <span style="color:var(--dim2);font-size:11px">（会话已保存 · ${a.cookieCount} 个 Cookie${when ? ' · ' + when : ''}）</span>`;
  } else {
    el.innerHTML = `<span style="color:var(--red)">● 未登录</span>
      <span style="color:var(--dim2);font-size:11px">下载功能需要登录</span>`;
  }
}

/* ---------------- 崩溃诊断 ---------------- */

/**
 * 结论等级 → 文案与颜色。等级由主进程 `crashLog.buildReport()` 给出：
 * high（有硬证据）/ mid（有强线索）/ low（只能靠对撞）/ none（没现场或没线索）。
 */
const CRASH_LEVELS = {
  high: { text: '高度可疑', color: 'var(--red)' },
  mid: { text: '比较可疑', color: 'var(--accent)' },
  low: { text: '证据不足，按步骤对撞', color: 'var(--blue)' },
  none: { text: '暂无结论', color: 'var(--dim2)' }
};

/** 崩溃阶段 → 人话（SecondsSinceStart 是引擎自己数的启动秒数） */
function crashPhaseText(phase) {
  if (phase === 'startup') return '启动期（≤2 秒）';
  if (phase === 'loading') return '加载期（2–60 秒）';
  if (phase === 'runtime') return '运行中';
  if (phase === 'assert') return '断言失败';
  return '未知';
}

/**
 * 把分析结论里的轻标记渲染成 HTML。
 * 结论文本是主进程写的（`**重点**` 与反引号路径），这里只做最小转换 ——
 * 逃生在前面做掉，插进去的只有 `<b>` / `<code>` 两种标签。
 */
function crashMd(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * 打开一段原文（崩溃快照 / UE4SS.log）。
 * 结论终究是推断，所以每条结论旁边都要能点开现场自己核对。
 */
async function openCrashSource(kind, file, title) {
  $('#dTitle').textContent = title || '原始日志';
  $('#dSub').textContent = '加载中…';
  $('#dBody').innerHTML = '<div class="txt" style="color:var(--dim2)"><span class="spin"></span> 正在读取…</div>';
  $('#dFoot').innerHTML = '<button class="btn" id="crashLocate">在资源管理器中定位</button>' +
    '<button class="btn" id="crashDrawerClose">关闭</button>';
  showDrawer();

  let d = null;
  try { d = await call(window.api.crash.read(kind, file, 256 * 1024), { silent: true }); }
  catch (e) {
    $('#dSub').textContent = '读取失败';
    $('#dBody').innerHTML = `<div class="callout err">${esc(e.message)}</div>`;
    return;
  }
  const text = (d && d.text) || '';
  const name = String(file || '').split(/[\\/]/).pop();
  $('#dSub').textContent = [name, d && d.size ? fmtSize(d.size) : ''].filter(Boolean).join(' · ');
  $('#dBody').innerHTML = `
    <div class="urlbox"><span style="flex:1">${esc(file || '')}</span></div>
    ${d && d.truncated ? '<div class="callout warn">文件很长，这里只显示末尾一部分。</div>' : ''}
    <div class="lbl">内容</div>
    <pre style="max-height:460px;overflow:auto;white-space:pre-wrap;word-break:break-all;font:11px/1.55 Consolas,'Courier New',monospace;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px;margin:0;color:var(--dim)">${esc(text) || '(空文件)'}</pre>`;
  $('#crashLocate') && $('#crashLocate').addEventListener('click', () => window.api.crash.openFile(file));
  $('#crashDrawerClose') && $('#crashDrawerClose').addEventListener('click', () => hideDrawer());
}

/** 诊断页的按钮（每次重绘都要重绑，所以单独一个函数） */
function bindCrashButtons(root) {
  root.querySelectorAll('[data-crash]').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.crash;
    if (act === 'reload') renderCrash({ force: true });
    else if (act === 'openDir') window.api.crash.openDir();
  }));
  root.querySelectorAll('[data-crashread]').forEach(b => b.addEventListener('click', () => {
    const file = b.dataset.crashread;
    const isCrash = /\\Crashes\\/i.test(file);
    openCrashSource(isCrash ? 'crash' : 'ue4ss', file, isCrash ? '崩溃快照' : 'UE4SS 日志');
  }));
}

/** 把 state.crash.report 画成一页 */
function paintCrash() {
  const area = $('#crashArea');
  if (!area) return;
  const st = state.crash;

  if (!state.game || !state.game.found) { area.innerHTML = emptyNoGame(); return; }

  if (st.loading) {
    area.innerHTML = `<div class="empty"><h3><span class="spin"></span> 正在读日志…</h3>
      <p>要读 <code>ue4ss\\UE4SS.log</code> 和 <code>%LOCALAPPDATA%\\SB\\Saved\\Crashes</code> 里的崩溃快照，稍等一下。</p></div>`;
    return;
  }
  if (!st.report) {
    area.innerHTML = `<div class="crashbar"><button class="btn p" data-crash="reload">开始分析</button></div>
      <div class="${st.error ? 'callout err' : 'callout'}">${esc(st.error || '还没分析过。')}</div>`;
    bindCrashButtons(area);
    return;
  }

  const rep = st.report;
  const a = rep.analysis || {};
  const vd = a.verdict || {};
  const lv = CRASH_LEVELS[vd.level] || CRASH_LEVELS.none;
  const stats = rep.stats || {};
  const ue = rep.ue4ss || {};
  const env = rep.env || {};
  const h = [];

  /* 操作按钮放在**最上面并吸顶**（`.crashbar`）。
     这页的分析结论、嫌疑 Mod、日志概览加起来能滚好几屏，按钮如果留在页底，
     每次想「重新分析 / 看日志 / 打开崩溃目录」都得先滚到底 —— 用户反馈「操作按钮放顶部，
     滚动也不消失」。吸顶的写法与 `.bhead` 同一套路，`.body` 有 16px padding 需要负 margin 抵消。 */
  h.push(`<div class="crashbar">
    <button class="btn p" data-crash="reload">重新分析</button>
    ${env.ue4ssLog ? `<button class="btn" data-crashread="${esc(env.ue4ssLog)}">看 UE4SS.log</button>` : ''}
    <button class="btn" data-crash="openDir">打开崩溃目录</button>
    <span class="crashbar-at">分析于 ${esc(fmtDate(rep.generatedAt))}</span>
  </div>`);

  /* 结论 */
  h.push(`<div class="crash-verdict" style="--c:${lv.color}">
    <i class="dot"></i>
    <div style="min-width:0;flex:1">
      <div class="vl">${esc(lv.text)}</div>
      <h3>${esc(vd.headline || '—')}</h3>
      <p>${esc(vd.detail || '')}</p>
    </div>
  </div>`);

  /* 崩溃统计 */
  const excTop = Object.entries(stats.exceptions || {}).sort((x, y) => y[1] - x[1])[0];
  h.push(`<div class="crash-stats">
    <div><b>${stats.total || 0}</b>崩溃记录</div>
    <div><b>${stats.startup || 0}</b>启动期 ≤2 秒</div>
    <div><b>${stats.loading || 0}</b>加载期</div>
    <div><b>${stats.runtime || 0}</b>运行中</div>
    <div><b>${stats.lastAt ? esc(fmtDate(stats.lastAt)) : '—'}</b>最近一次</div>
    <div><b style="font-size:11.5px">${esc(excTop ? excTop[0] : '—')}</b>主要异常</div>
  </div>`);

  /* 排除步骤 */
  const steps = a.steps || [];
  if (steps.length) {
    h.push('<div class="lbl">按这个顺序排除</div><ol class="steps">' +
      steps.map(s => `<li>${crashMd(s)}</li>`).join('') + '</ol>');
  }

  /* 嫌疑 Mod */
  const sus = (a.suspects || []).filter(s => s.score > 0);
  h.push('<div class="lbl">嫌疑 Mod</div>');
  if (!sus.length) {
    h.push('<div class="callout">没有单个 Mod 拿到分数 —— 证据只到「启动期正在加载」这一层，' +
      '照上面的顺序移文件对撞，比继续看日志更快。</div>');
  } else {
    const max = Math.max(...sus.map(s => s.score || 0), 1);
    h.push(sus.map(s => {
      const kindText = s.kind === 'bp' ? '蓝图 Mod' : (s.kind === 'pak' ? 'pak 文件' : 'Mod');
      const where = s.location ? ` · ${esc(s.location)}` : '';
      return `<div class="sus">
        <div class="sus-h"><b>${esc(s.name || '—')}</b>
          <span class="tag gray">${esc(kindText)}${where}</span>
          <span class="sus-score">${s.score} 分</span></div>
        <div class="sus-bar"><i style="width:${Math.round((s.score || 0) / max * 100)}%"></i></div>
        ${(s.reasons || []).map(r => `<div class="sus-r">· ${esc(r)}</div>`).join('')}
        ${(s.files || []).length ? `<div class="sus-f">${s.files.slice(0, 8).map(f => `<code>${esc(f)}</code>`).join(' ')}</div>` : ''}
      </div>`;
    }).join(''));
  }

  /* 发现 */
  const fnd = a.findings || [];
  if (fnd.length) {
    h.push('<div class="lbl">发现</div>');
    for (const f of fnd) {
      const cls = f.level === 'error' ? 'callout err' : (f.level === 'warn' ? 'callout warn' : 'callout');
      h.push(`<div class="${cls}" style="margin-top:8px"><b>${esc(f.title)}</b><br>${
        crashMd(f.detail || '').replace(/\n/g, '<br>')}</div>`);
    }
  }

  /* 加载器与日志概况 */
  const kv = (k, v) => `<div class="crash-kv"><span>${esc(k)}</span><span>${v || '—'}</span></div>`;
  const chips = (arr) => (arr || []).map(n => `<code>${esc(n)}</code>`).join(' ');
  h.push('<div class="lbl">加载器与日志</div>');
  h.push(kv('UE4SS', esc(ue.version || '未检测到') + (ue.gitSha ? ' · ' + esc(ue.gitSha) : '')));
  h.push(kv('本次启动', ue.firstAt ? esc(ue.firstAt) : '—'));
  h.push(kv('最后输出', ue.lastAt ? esc(ue.lastAt) : '—'));
  h.push(kv('最后一行', ue.lastLine ? `<code>${esc(ue.lastLine)}</code>` : '—'));
  h.push(kv('挂载进度', ue.lastLoadingMod
    ? `正在加载 <code>${esc(ue.lastLoadingMod)}</code>`
    : (ue.eventLoopStarted ? '已进入事件循环（启动流程走完）' : '—')));
  h.push(kv('蓝图 Mod', (ue.bpMods || []).length ? chips(ue.bpMods) : '—'));
  h.push(kv('C++ Mod', (ue.startedCpp || []).length ? chips(ue.startedCpp) : '—'));
  h.push(kv('Lua Mod', (ue.startedLua || []).length ? chips(ue.startedLua) : '—'));
  h.push(kv('已禁用', (ue.disabled || []).length ? chips(ue.disabled) : '—'));
  if ((ue.errors || []).length) h.push(kv('日志报错', chips(ue.errors.slice(0, 4))));

  /* 崩溃记录 */
  const crashes = (rep.crashes || []).slice(0, 12);
  if (crashes.length) {
    h.push('<div class="lbl">崩溃记录（最近 ' + crashes.length + ' 次）</div>');
    for (const c of crashes) {
      h.push(`<div class="crash-row">
        <span class="t">${esc(fmtDate(c.at))}</span>
        <span class="ph">${esc(crashPhaseText(c.phase))}</span>
        <span class="th">${esc((c.crashedThread && c.crashedThread.name) || '—')}</span>
        <span style="color:var(--dim2)">${esc(c.exception || '')} ${esc(c.address || '')}</span>
        ${c.xml ? `<button class="btn sm" data-crashread="${esc(c.xml)}">原文</button>` : ''}
      </div>`);
    }
  }

  area.innerHTML = h.join('');
  bindCrashButtons(area);

  // 侧栏计数：有多少次崩溃现场（0 就不显示徽章）
  const badge = $('#navCountCrash');
  if (badge) {
    const n = stats.total || 0;
    badge.textContent = n;
    badge.style.display = n ? '' : 'none';
  }
}

/**
 * 进「崩溃诊断」页时调用：没有结果就现分析一份。
 * 这里**不在启动时预跑** —— 要读 UE4SS.log 尾部 + 解析 20 份崩溃快照，没必要每次开程序都干。
 */
async function renderCrash(opts = {}) {
  const area = $('#crashArea');
  if (!area) return;
  if (!state.game || !state.game.found) { area.innerHTML = emptyNoGame(); return; }
  const force = !!opts.force;
  if (force || (!state.crash.report && !state.crash.loading)) {
    state.crash.loading = true;
    paintCrash();
    try {
      const d = await call(window.api.crash.report(), { silent: true });
      if (d && d.report) {
        state.crash.report = d.report;
        state.crash.error = '';
        state.crash.at = Date.now();
      } else {
        state.crash.report = null;
        state.crash.error = (d && d.reason) || '没能读到日志或崩溃快照。';
      }
    } catch (e) {
      state.crash.report = null;
      state.crash.error = '分析失败：' + e.message;
    }
    state.crash.loading = false;
  }
  paintCrash();
}

/**
 * 设置页「显示语言」下拉的选项。
 *
 * · 语言名一律用它**自己的写法**（native）：Deutsch 就写 Deutsch，别翻成「德语」——
 *   用户在这种界面里找的是自己认得出的那串字，不是别人对他的称呼。
 *   所以那些 option 打 `data-i18n-skip`，DOM 翻译器不碰它们。
 * · 「跟随系统」反过来，要跟着界面语言走，就不打 skip，交给 DOM 翻译器查表。
 *
 * 兜底：i18n.js 没加载时退化成一个只有简体中文的下拉，不至于把设置页整塌。
 */
function uiLangOptions() {
  if (!window.I18N) return '<option value="zh-CN">简体中文</option>';
  const cur = window.I18N.getLang();
  const rows = [`<option value="auto"${cur === 'auto' ? ' selected' : ''}>跟随系统</option>`];
  for (const l of window.I18N.list()) {
    rows.push(`<option value="${esc(l.code)}"${cur === l.code ? ' selected' : ''}` +
      ` data-i18n-skip>${esc(l.native)}</option>`);
  }
  return rows.join('');
}

function renderSettings() {
  const c = state.config || {};
  const g = state.game || {};
  const w = state.watch || {};
  $('#settingsArea').innerHTML = `
    <div class="frm">
      <h3>界面语言</h3>
      <div class="f">
        <label>显示语言</label>
        <select id="setUiLang" style="flex:none;min-width:180px">
          ${uiLangOptions()}
        </select>
        <div class="hint">切换后立即生效</div>
      </div>
    </div>

    <div class="frm">
      <h3>浏览与筛选</h3>
      <div class="f">
        <label>记住筛选条件</label>
        <select id="setRememberFilters" style="flex:none;min-width:210px">
          <option value="1" ${c.rememberFilters !== false ? 'selected' : ''}>记住（下次启动自动套用）</option>
          <option value="0" ${c.rememberFilters === false ? 'selected' : ''}>不记住（每次都用默认筛选）</option>
        </select>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          记住浏览页与「已安装」页的筛选条件（排序、成人内容、只看未安装、黑名单、只看喜欢、分类、标签、内置脚本开关），下次启动自动套用。
        </div>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">搜索关键词不记 —— 那是临时查询，留着上次的词只会让人以为列表坏了。</div>
      </div>
    </div>

    <div class="frm">
      <h3>游戏</h3>
      <div class="f">
        <label>游戏目录</label>
        <input type="text" id="setGameRoot" value="${esc(c.gameRoot || '')}">
        <button class="btn sm" id="btnSaveRoot">保存并校验</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">必须是包含 <code>SB\\Binaries\\Win64\\SB-Win64-Shipping.exe</code> 的目录。
        ${g.found ? `当前识别：${esc(g.root)}` : '<span style="color:var(--red)">当前未识别到有效目录</span>'}</div>
      </div>
      ${g.found && g.writable && !g.writable.ok
        ? `<div class="f"><label></label><div class="hint" style="color:var(--red);line-height:1.75">⚠️ ${esc(g.writable.message || '')}</div></div>`
        : ''}
      <div class="f">
        <label>游戏版本</label>
        <div class="hint" id="setGameVer" style="line-height:1.7">${gameVerText(g)}</div>
      </div>
      <div class="f">
        <label></label>
        <button class="btn sm" id="btnDetect">自动探测</button>
      </div>
      <div class="f">
        <label></label>
        <button class="btn sm" id="btnOpenGameRoot">打开游戏目录</button>
        <button class="btn sm" id="btnOpenModsDir">打开 Mod 目录</button>
      </div>
    </div>

    <div class="frm">
      <h3>已安装记录（跟着游戏走）</h3>
      <div class="f">
        <label>账本</label>
        <span id="ledgerLine" style="font-size:12px;color:var(--dim)">读取中…</span>
      </div>
      <div class="f">
        <label>数据文件</label>
        <span id="dataHomeLine" style="font-size:12px;color:var(--dim)">读取中…</span>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">配置与账本都跟着游戏走：存在游戏根目录的 .sbmod 里（config.json、mods.json、mod-links.json、blacklist.json、favorites.json 等），整个游戏文件夹搬走（换盘 / 换机器）后它们跟着一起走。图片缓存、Nexus 目录缓存和下载的压缩包体积大，留在管理器自己的数据目录里。第一次识别到一个游戏目录时会立刻把当前数据写进去，之后每次改动都会同步。</div>
      </div>
      <div class="f">
        <label></label>
        <button class="btn sm" id="btnLedgerCheck">检查并修复路径</button>
        <button class="btn sm" id="btnLedgerExport">写入账本到游戏目录</button>
        <button class="btn sm" id="btnLedgerImport">从账本恢复</button>
        <button class="btn sm" id="btnReconcile" title="拿磁盘的实际文件比一遍：手动删掉的 mod 会从已安装列表里退场，直接改过扩展名的会按磁盘纠正开关">核对磁盘</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint" id="reconcileLine">启动时会自动核对一次：账本里记着、但游戏目录里文件已经不在的 Mod 会自动移除（不会删你别的文件）。</div>
      </div>
    </div>

    <div class="frm">
      <h3>安装包目录</h3>
      <div class="f">
        <label>目录</label>
        <span id="libDirLine" style="font-size:12px;color:var(--dim)">读取中…</span>
      </div>
      <div class="f">
        <label>里面的包</label>
        <span id="libStatLine" style="font-size:12px;color:var(--dim)"></span>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">下载好的压缩包都放在这里，删除、重装都从这儿取。默认在管理器自己的数据目录下；包攒在别的盘（比如 D 盘的仓库目录）就可以点「更改目录」指过去 —— 指完之后启动时会读那个目录。换过游戏目录时，这里没装过的包还能在「下载」页重装。</div>
      </div>
      <div class="f">
        <label></label>
        <button class="btn sm" id="btnLibChoose">更改目录…</button>
        <button class="btn sm" id="btnLibOpen">打开目录</button>
        <button class="btn sm" id="btnLibReset">恢复默认</button>
      </div>
    </div>

    <div class="frm">
      <h3>Nexus 账号</h3>
      <div class="f">
        <label>登录状态</label>
        <span id="authLine" style="font-size:12px;color:var(--dim)">检测中…</span>
        <div class="spacer"></div>
        <button class="btn sm p" id="btnNexusLogin">登录 Nexus</button>
        <button class="btn sm" id="btnNexusVerify">刷新状态</button>
        <button class="btn sm" id="btnNexusLogout">退出登录</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          点「登录 Nexus」会打开一个内置浏览器窗口，在那里登录即可。
          如果 Cloudflare 人机验证报错（内置浏览器被识别为非标准浏览器时会发生），
          改走下面的备用通路：
          <button class="btn sm" id="btnBrowserLogin" style="margin-top:6px">用系统浏览器登录</button>
          <br><br>
          在系统浏览器里登录 Nexus → 打开
          <a href="#" data-openurl="https://www.nexusmods.com/settings/api-keys" style="color:var(--blue)">账号设置 → API Keys</a>
          → 复制 Personal API Key → 粘到下面并保存。
          浏览与下载链接解析都靠这个 Key，不依赖内置浏览器。
          <br><br>
          登录状态保存在独立会话里，重启程序后依然有效，后续下载复用同一会话。
        </div>
      </div>

      <h3 style="margin-top:18px">个人 API Key<span style="font-weight:400;font-size:12px;color:var(--dim2)">（可选）</span></h3>
      <div class="f">
        <label>API Key</label>
        <input type="password" id="setApiKey" value="${esc(c.nexusApiKey || '')}" placeholder="可留空">
        <button class="btn sm" id="btnSaveKey">保存</button>
        <button class="btn sm" id="btnFetchKey">登录后自动获取</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          <b>登录之后浏览与下载都不需要 Key</b>，这一项可以不填。
          填了能获得更高的接口配额。<br><br>
          Nexus 已改版：个人 Key 不再直接显示，需要先去
          <a href="#" data-openurl="https://www.nexusmods.com/settings/api-keys" style="color:var(--blue)">账号设置 → API Keys</a>
          页面<b>最底部</b>的「Personal API Key」处点一次 <b>Request Api Key</b> 生成，
          之后点「登录后自动获取」就能自动读取。
        </div>
      </div>
    </div>

    <div class="frm">
      <h3>下载</h3>
      <div class="f">
        <label>下载授权</label>
        <select id="setAutoAuth" style="flex:none;min-width:190px">
          <option value="1" ${c.autoAuthorize !== false ? 'selected' : ''}>自动（加入队列即下载）</option>
          <option value="0" ${c.autoAuthorize === false ? 'selected' : ''}>手动（每条点一次授权）</option>
        </select>
        <div class="hint">
          自动模式下，加入下载队列的 Mod 会用你<b>已登录的 Nexus 会话</b>直接取得下载授权并开始下载，
          不用再逐条去 Nexus 网页点下载按钮。<br>
          授权链接由 Nexus 为本账号签发、一次性、有时效；本程序不伪造 key、不绕过人机验证
          （遇到 Cloudflare 会冷却后重试，连续多次都被拦才停下并退回手动授权）。
        </div>
      </div>
      <div class="f">
        <label>nxm:// 接管</label>
        <span id="nxmProtoLine" style="font-size:12px;color:var(--dim)">检测中…</span>
        <div class="spacer"></div>
        <button class="btn sm p" id="btnNxmRegister">注册为默认处理器</button>
        <button class="btn sm" id="btnNxmUnregister">取消注册</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          注册后，在 Nexus 网页点文件的 <b>Mod Manager Download</b> 按钮，
          系统会自动调起本管理器并带上一次性下载授权。<b>免费账号同样可用</b> ——
          这是 Nexus 官方为第三方管理器提供的通路。<br><br>
          授权 key 由 Nexus 在点击时签发、一次性、有时效；过期后重新点一次按钮即可。
        </div>
      </div>
      <div class="f">
        <label>粘贴链接安装</label>
        <input type="text" id="setNxmUrl" placeholder="nxm://stellarblade/mods/... 或 https://www.nexusmods.com/stellarblade/mods/...">
        <button class="btn sm p" id="btnNxmParse">解析并安装</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          也支持粘贴 Nexus 的 Mod 页面地址。网页地址里不含下载授权，
          本程序会先带你到 Nexus 的 Files 页，点一次 <b>Mod Manager Download</b> 即可自动接续。
        </div>
      </div>
      <div class="f">
        <label>本地压缩包安装</label>
        <button class="btn sm p" id="btnLocalInstall">选择压缩包…</button>
        <div class="hint">支持 <code>.zip</code> / <code>.7z</code> / <code>.rar</code>，自动识别包类型并解压到对应目录</div>
      </div>
      <div class="f">
        <label>解压工具</label>
        <span id="instToolLine" style="font-size:12px;color:var(--dim)">检测中…</span>
        <div class="spacer"></div>
        <button class="btn sm" id="btnInstToolRefresh">重新检测</button>
      </div>
      <div class="f">
        <label>手动下载</label>
        <div class="hint">
          在 Nexus 网页点 <b>Manual download</b> 下到本地的包，直接用上面的
          <b>选择压缩包…</b> 安装，不用手动解压。<br>
          更省事的做法：打开下面的<b>下载目录监听</b> —— 下到「下载」文件夹就会自动导入。
        </div>
      </div>
    </div>

    <div class="frm">
      <h3>下载目录监听<span style="font-weight:400;font-size:12px;color:var(--dim2)">（手动下载的兜底）</span></h3>
      <div class="f">
        <label>监听开关</label>
        <select id="setWatchEnabled" style="flex:none;min-width:130px">
          <option value="1" ${w.enabled ? 'selected' : ''}>开启</option>
          <option value="0" ${w.enabled ? '' : 'selected'}>关闭</option>
        </select>
        <select id="setWatchAuto" style="flex:none;min-width:170px">
          <option value="1" ${w.autoInstall ? 'selected' : ''}>识别出来源就自动安装</option>
          <option value="0" ${w.autoInstall ? '' : 'selected'}>只导入，等我在下载页确认</option>
        </select>
        <div class="spacer"></div>
        <button class="btn sm" id="btnWatchScan">立即扫描</button>
        <button class="btn sm" id="btnWatchIgnore">忽略现有文件</button>
      </div>
      <div class="f">
        <label>监听目录</label>
        <div class="hint" id="watchDirsLine">读取中…</div>
        <button class="btn sm" id="btnWatchAddDir">添加目录…</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          盯着上面这些目录，一出现 <code>.zip</code> / <code>.7z</code> / <code>.rar</code>
          就自动导入下载队列。<br>
          文件名是 Nexus 手动下载的标准格式（<code>ModName-1234-1-0-1791651882264.zip</code>）
          时会自动回 Nexus 补全名称与封面，并按上面的策略安装；
          识别不出来源的包只会进队列<b>等你确认</b>，不会乱装。<br>
          还没下完的临时文件（<code>.part</code> / <code>.crdownload</code>）会自动跳过。
          <span id="watchStateLine" style="display:block;margin-top:6px;color:var(--dim2)"></span>
        </div>
      </div>
      <div class="f">
        <label>GitHub 镜像</label>
        <input type="text" id="setGithubMirror" value="${esc(c.githubMirror || '')}" placeholder="留空 = 只用官方通路（推荐）">
        <button class="btn sm" id="btnSaveMirror">保存</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          UE4SS 一键安装要从 GitHub 下载。<b>默认只用官方通路</b>（资产 API + 直链），
          不内置任何第三方镜像 —— 那等于把二进制交给中间人。<br>
          只有当官方通路连不上时，才考虑填一个可信的加速前缀，例如
          <code>https://ghfast.top/</code>（会拼成 <code>前缀 + 原始 GitHub 地址</code>）。
        </div>
      </div>
    </div>

    <div class="frm">
      <h3>翻译</h3>
      <div class="f">
        <label>翻译后端</label>
        <select id="setBackend">
          <option value="mymemory" ${c.translateBackend === 'mymemory' ? 'selected' : ''}>MyMemory（免费 · 无需 Key）</option>
        </select>
      </div>
      <div class="f">
        <label>目标语言</label>
        <select id="setLang" style="flex:none;min-width:130px">
          <option value="zh-CN" ${c.targetLang === 'zh-CN' ? 'selected' : ''}>简体中文</option>
          <option value="zh-TW" ${c.targetLang === 'zh-TW' ? 'selected' : ''}>繁體中文</option>
        </select>
        <div class="hint">原文始终保留，详情页可随时切回英文</div>
      </div>
      <div class="f">
        <label>翻译缓存</label>
        <div class="hint" id="transStats">统计中…</div>
        <button class="btn sm" id="btnClearTrans">清空缓存</button>
      </div>
    </div>

    <div class="frm">
      <h3>存储</h3>
      <div class="f">
        <label>数据目录</label>
        <input type="text" id="setDataDir" value="${esc(state.dataDir || '')}" readonly>
        <i class="tag gray" id="ddTag">默认位置</i>
        <button class="btn sm" id="btnOpenData">打开</button>
        <button class="btn sm" id="btnChangeData">更改位置…</button>
        <button class="btn sm" id="btnRestoreData" hidden>恢复默认</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint" id="ddHint">数据目录可以改到别的盘（下载缓存与安装包会占用较多空间）。改完需要重启程序才生效。</div>
      </div>
      <div class="f">
        <label>接口缓存</label>
        <div class="hint">浏览结果的本地缓存，10 分钟后自动失效</div>
        <button class="btn sm" id="btnClearNexus">清空</button>
      </div>
      <div class="f">
        <label>配置</label>
        <button class="btn sm d" id="btnResetCfg">恢复默认设置</button>
      </div>
    </div>

    <div class="frm">
      <h3>运行日志</h3>
      <div class="f">
        <label>日志文件</label>
        <div class="hint" id="logLine">读取中…</div>
        <button class="btn sm p" id="btnViewLog">查看日志</button>
        <button class="btn sm" id="btnOpenLogDir">打开目录</button>
      </div>
      <div class="f">
        <label></label>
        <div class="hint">
          本程序是桌面应用，<b>没有终端</b> —— 出问题时日志是唯一能回溯的东西。
          安装、下载、安装助手窗口的操作与报错都会记进去，保留最近 7 天。<br>
          反馈问题时把日志里最后几十行贴出来，能省掉大半排查时间。
        </div>
      </div>
    </div>
  `;

  renderAuthLine();
  refreshNxmStatus();
  refreshInstallTools();
  refreshLogLine();
  refreshWatchLine();
  refreshDataDirLine();
  refreshDataHomeLine();
  refreshLedgerBox();
  refreshLibDirBox();

  window.api.translate.stats().then(r => {
    const el = $('#transStats');
    if (el && r.ok) el.textContent = `已缓存 ${r.data.entries} 条译文`;
  });
}

/* ---------------- 数据目录（可换位置 + 一键搬运） ----------------
 *
 * 用户诉求：「数据位置可以在设置中设置，如果已有数据提供一键搬运到新位置」。
 *
 * 为什么要能改：`cache/` + `library/` + `backup/` 加起来能到几十 GB，
 * C 盘紧张的人必须能挪走。
 *
 * 实现上**不是热切换** —— `paths.js` 的 DATA / CACHE / LIBRARY 是模块加载时算好的，
 * store / logger / imageCache 等模块各自也取过一次，热切换等于重建整条链路。
 * 所以流程是：选目录 → 看目标里有没有旧数据 → 决定旧数据怎么处理 → 搬运 + 改写路径
 * → 写「指针文件」→ **提示重启**。
 */

/** 待确认的搬运上下文（`{ from, to }`），由模态框按钮消费 */
let ddPending = null;

/** 路径比较：Windows 下大小写不敏感，末尾斜杠与分隔符混用都算同一个 */
function samePath(a, b) {
  const n = (s) => String(s || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  return !!a && !!b && n(a) === n(b);
}

/** 设置页「数据目录」那行的标记与提示（由主进程的 `data:info` 驱动） */
async function refreshDataDirLine() {
  const inp = $('#setDataDir');
  if (!inp) return;
  let info;
  try { info = await call(window.api.data.info(), { silent: true }); }
  catch { return; }
  state.dataInfo = info;
  state.dataDir = info.current;
  inp.value = info.current || '';

  const tag = $('#ddTag');
  const hint = $('#ddHint');
  const restore = $('#btnRestoreData');
  const custom = info.source === 'custom';
  if (tag) {
    tag.textContent = custom ? '自定义位置' : '默认位置';
    tag.className = 'tag ' + (custom ? 'other' : 'gray');
  }
  if (restore) restore.hidden = !custom;
  if (!hint) return;

  // 顺序有讲究：先报「配置的目录用不了」，再报「改了还没重启」，最后才是常规说明
  if (info.reason === 'unusable') {
    hint.innerHTML =
      '<span style="color:var(--accent)">设置的数据目录现在用不了（磁盘未连接或没有权限），' +
      '已暂时回落到默认位置。恢复可用后重启程序即可切回。</span><br>' +
      '目标：<code data-i18n-skip>' + esc(info.configured || '') + '</code>';
  } else if (!samePath(info.current, info.next)) {
    hint.innerHTML =
      '新位置已设置好，重启程序后生效。<br>' +
      '新位置：<code data-i18n-skip>' + esc(info.next || '') + '</code>';
    if (tag) { tag.textContent = '待重启生效'; tag.className = 'tag other'; }
  } else {
    hint.textContent = '数据目录可以改到别的盘（下载缓存与安装包会占用较多空间）。改完需要重启程序才生效。';
  }
}

/**
 * 「更改位置…」向导：选目录 → 探目标 → 问旧数据怎么办 → 搬运 → 重启。
 */
async function changeDataDir() {
  let info = state.dataInfo;
  if (!info) {
    try { info = await call(window.api.data.info(), { silent: true }); } catch { return; }
  }
  let dir;
  try { dir = await call(window.api.data.choose({ defaultPath: info.current }), { silent: true }); }
  catch { return; }
  if (!dir) return;                                   // 用户取消
  if (samePath(dir, info.current)) { toast('这个目录就是当前的数据目录'); return; }

  let target;
  try { target = await call(window.api.data.inspect(dir), { silent: true }); }
  catch { return; }

  ddPending = { from: info.current, to: dir, restore: false };

  // 目标里已经有数据 → 先把「同名文件怎么办」问清楚，别默默混在一起
  if (target && target.hasData) {
    openModal('目标目录里已经有数据', `
      <div class="hint" style="margin-bottom:6px">这个目录里已经有一份数据了：</div>
      <div style="margin:4px 0"><code data-i18n-skip>${esc(dir)}</code></div>
      <div class="hint">这个目录里已经有 ${target.files} 个文件了</div>
      <div class="hint"><span>约</span> <span data-i18n-skip>${fmtSize(target.bytes)}</span></div>`, [
      { id: 'ddOver', label: '覆盖目标里的同名文件', primary: true },
      { id: 'ddKeep', label: '同名文件保留目标那份' },
      { id: 'ddUse', label: '不搬，直接用那个位置的数据' },
      { id: 'ddCancel', label: '取消' }
    ]);
    return;
  }

  // 目标空的 → 问要不要把现有数据搬过去；两边都没数据就直接切
  let src;
  try { src = await call(window.api.data.inspect(info.current), { silent: true }); }
  catch { src = null; }
  if (!src || !src.hasData) {
    await applyDataDir(dir);
    return;
  }
  openModal('把现有数据搬到新目录吗？', `
    <div class="hint">当前数据有 ${src.files} 个文件，要搬到新位置吗？</div>
    <div class="hint"><span>约</span> <span data-i18n-skip>${fmtSize(src.bytes)}</span></div>
    <div style="margin:4px 0"><code data-i18n-skip>${esc(dir)}</code></div>`, [
    { id: 'ddMove', label: '移动（推荐，搬完删掉旧目录）', primary: true },
    { id: 'ddCopy', label: '复制（旧目录保留一份）' },
    { id: 'ddUse', label: '不搬，直接用那个位置的数据' },
    { id: 'ddCancel', label: '取消' }
  ]);
}

/** 「恢复默认」：默认位置就是 `paths.DEFAULT_DATA` */
async function restoreDataDir() {
  const info = state.dataInfo || {};
  if (!info.default) return;
  let src;
  try { src = await call(window.api.data.inspect(info.current), { silent: true }); }
  catch { src = null; }
  if (!src || !src.hasData) { await applyDataDir(''); return; }
  ddPending = { from: info.current, to: info.default, restore: true };
  openModal('恢复到默认位置', `
    <div class="hint">当前数据有 ${src.files} 个文件，要搬回默认位置吗？</div>
    <div class="hint"><span>约</span> <span data-i18n-skip>${fmtSize(src.bytes)}</span></div>
    <div style="margin:4px 0">默认位置：<code data-i18n-skip>${esc(info.default)}</code></div>`, [
    { id: 'ddMove', label: '移动（推荐，搬完删掉旧目录）', primary: true },
    { id: 'ddCopy', label: '复制（旧目录保留一份）' },
    { id: 'ddUse', label: '不搬，直接用那个位置的数据' },
    { id: 'ddCancel', label: '取消' }
  ]);
}

/** 只写指针文件、立刻提示重启（没有数据要搬时走这条） */
async function applyDataDir(dir) {
  ddPending = null;
  let r;
  try { r = await window.api.data.setDir(dir || ''); }
  catch { return; }
  if (!r || r.ok === false) { toast((r && r.error) || '设置失败', 'err'); return; }
  if (!r.data.changed) {
    toast('数据目录没有变化');
    await refreshDataDirLine();
    return;
  }
  askDataRelaunch(r.data.dir || '');
}

/** 搬运 + 进度框 + 完成后提示重启 */
async function runDataMigrate(mode, overwrite) {
  const p = ddPending;
  ddPending = null;
  if (!p) { closeModal(); return; }

  let off = null;
  try {
    off = window.api.data.onProgress((x) => {
      const bar = $('#ddProgBar');
      const txt = $('#ddProg');
      const nm = $('#ddProgName');
      if (!bar || !txt) return;
      const total = x.total || 0;
      bar.style.width = (total ? Math.round((x.done / total) * 100) : 5) + '%';
      txt.textContent = x.phase === 'rewrite' ? '正在改写路径引用…'
        : x.phase === 'done' ? '收尾…' : '正在搬运…';
      if (nm) nm.textContent = x.name || '';
    });
  } catch { off = null; }

  openModal('正在搬运数据…', `
    <div class="hint" id="ddProg">正在准备…</div>
    <div style="margin:4px 0"><code data-i18n-skip id="ddProgName"></code></div>
    <div style="height:6px;background:var(--panel3);border-radius:3px;overflow:hidden;margin-top:8px">
      <div id="ddProgBar" style="height:100%;width:0;background:var(--accent);transition:width .2s"></div>
    </div>
    <div class="hint" style="margin-top:8px">搬运期间请不要关闭程序。</div>`, []);

  let r;
  try { r = await window.api.data.migrate(p.from, p.to, { mode, overwrite }); }
  catch (e) { r = { ok: false, error: e && e.message }; }
  if (off) off();

  if (!r || r.ok === false) {
    closeModal();
    toast((r && r.error) || '搬运失败', 'err');
    return;
  }
  const d = r.data;
  openModal('需要重启', `
    <div class="hint" style="margin-bottom:8px">数据已经搬到新位置，重启程序后生效。</div>
    <div style="margin:6px 0">新位置：<code data-i18n-skip>${esc(d.dir || '')}</code></div>
    <div class="hint">搬运了 ${d.copied || 0} 个文件，跳过 ${d.skipped || 0} 个已存在的</div>
    ${d.rewritten ? `<div class="hint">改写了 ${d.rewritten} 处路径引用</div>` : ''}`, [
    { id: 'ddRelaunch', label: '立即重启', primary: true },
    { id: 'ddLater', label: '稍后自己重启' }
  ]);
}

/** 弹「需要重启」，并让用户选什么时候重启 */
function askDataRelaunch(dir) {
  openModal('需要重启', `
    <div class="hint" style="margin-bottom:8px">数据目录已经改好，重启程序后生效。</div>
    <div style="margin:6px 0">新位置：<code data-i18n-skip>${esc(dir || '')}</code></div>`, [
    { id: 'ddRelaunch', label: '立即重启', primary: true },
    { id: 'ddLater', label: '稍后自己重启' }
  ]);
}

/* ---------------- 下载目录监听 ---------------- */

/** 设置页「监听目录 / 运行状态」两行摘要 */
async function refreshWatchLine() {
  const dirsEl = $('#watchDirsLine');
  const stEl = $('#watchStateLine');
  if (!dirsEl && !stEl) return;
  try {
    const s = await call(window.api.watch.status(), { silent: true });
    state.watch = { ...(state.watch || {}), ...s };
    const dirs = s.dirs || [];
    if (dirsEl) {
      dirsEl.innerHTML = dirs.length
        ? dirs.map(d => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
             <code style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(d)}</code>
             <button class="btn sm" data-watchrm="${esc(d)}">移除</button></div>`).join('')
        : '<span style="color:var(--dim2)">还没有监听目录（默认应指向系统「下载」文件夹）</span>';
    }
    if (stEl) {
      stEl.textContent = (s.running ? '监听中' : '未监听') +
        ` · 已记录 ${s.seen || 0} 个文件` +
        (s.enabled ? '' : ' · 开关已关闭');
    }
  } catch { /* 忽略 */ }
}

/**
 * 下载目录里发现了新的 mod 压缩包（主进程已自动导入队列）。
 * 这里只负责告诉用户「发生了什么、去哪看」。
 */
async function onWatchFound(info) {
  if (!info) return;
  const label = info.name || info.file || '压缩包';
  if (info.auto) {
    toast('下载目录发现 ' + label + '，已自动导入并开始安装');
  } else {
    toast('下载目录发现 ' + label + '，已导入队列 —— 去下载页确认后安装', 'ok');
  }
  await refreshDownloads();
  // 不强制切页：用户可能正在浏览，打断体验不好。只在下载页可见时刷新即可。
  renderSidebar();
}

/* ---------------- 运行日志 ---------------- */

/** 设置页那行「日志文件」摘要 */
async function refreshLogLine() {
  const el = $('#logLine');
  if (!el) return;
  try {
    const info = await call(window.api.log.info(), { silent: true });
    const cur = (info.files || [])[0];
    el.innerHTML = cur
      ? `<code>${esc(cur.name)}</code> · ${fmtSize(cur.size)} · 保留最近 ${info.keepDays} 天`
      : '还没有日志文件（下次启动会创建）';
  } catch {
    el.textContent = '读取失败';
  }
}

/**
 * 日志查看器。
 * 直接读文件尾部若干行 —— 日志可能有几 MB，整份塞进界面会卡。
 */
async function openLogViewer() {
  $('#dTitle').textContent = '运行日志';
  $('#dSub').textContent = '加载中…';
  $('#dBody').innerHTML = `<div class="txt" style="color:var(--dim2)"><span class="spin"></span> 正在读取日志…</div>`;
  $('#dFoot').innerHTML = `<button class="btn" id="instClose">关闭</button>`;
  showDrawer();

  let info = null, t = null;
  try {
    info = await call(window.api.log.info(), { silent: true });
    t = await call(window.api.log.tail(600), { silent: true });
  } catch (e) {
    $('#dSub').textContent = '读取失败';
    $('#dBody').innerHTML = `<div class="callout err">${esc(e.message)}</div>`;
    return;
  }

  const file = (info && info.file) || '';
  $('#dSub').textContent = (t && t.total ? t.total + ' 行' : file) || '';

  const errCount = (t.lines || []).filter(l => /\[(ERROR|FATAL|EVENT)\]/.test(l)).length;

  $('#dBody').innerHTML = `
    <div class="callout">
      应用没有终端 —— 出问题时日志是唯一的回溯线索。安装 / 下载 / 安装助手窗口的
      操作与报错都在这里，保留最近 ${info ? info.keepDays : 7} 天。
    </div>
    <div class="lbl">文件</div>
    <div class="urlbox"><span style="flex:1">${esc(file)}</span>
      <button class="btn sm" id="logOpenFile">打开</button>
      <button class="btn sm" id="logOpenDir">目录</button></div>
    ${info && (info.files || []).length > 1
      ? `<div class="lbl">历史日志</div><div class="filelist">${
          info.files.slice(1, 8).map(f => esc(f.name) + ' · ' + fmtSize(f.size)).join('<br>')}</div>`
      : ''}
    <div class="lbl">末尾 ${t.lines.length} 行${
      t.truncated ? `（共 ${t.total} 行，只显示末尾）` : ''}${
      errCount ? ` · 含 ${errCount} 条 ERROR/FATAL/EVENT` : ''}</div>
    <pre id="logPre" style="max-height:430px;overflow:auto;white-space:pre-wrap;word-break:break-all;font:11px/1.55 Consolas,'Courier New',monospace;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px;margin:0;color:var(--dim)">${
      esc(t.lines.join('\n')) || '(空)'}</pre>
  `;

  // 滚到末尾 —— 最关心的永远是最后发生的事
  const pre = $('#logPre');
  if (pre) pre.scrollTop = pre.scrollHeight;

  $('#logOpenFile') && $('#logOpenFile').addEventListener('click', () => window.api.log.open(file));
  $('#logOpenDir') && $('#logOpenDir').addEventListener('click', () => window.api.log.openDir());
}

async function refreshAuthStatus() {
  try {
    const a = await call(window.api.nexus.authStatus(), { silent: true });
    state.auth = a;
    renderAuthLine();
    return a;
  } catch { return null; }
}

/* ---------------- 抽屉通用 ---------------- */

/**
 * 抽屉 + 遮罩的开关。
 *
 * 🔴 遮罩（`#drawerMask`）必须和抽屉**同步**开关 —— 用户要求
 * 「详情页面打开后，点击空白的地方自动关闭」。抽屉是右侧滑入的，
 * 不给一层可点的空白区，用户只能找右上角那个 ✕。
 *
 * ⚠️ 所有地方都要走这两个函数，不要单独 `classList.add/remove('on')` ——
 * 漏一处就会出现「抽屉关了、遮罩还在」，整个界面被一层透明的布盖住点不动。
 */
function showDrawer() {
  $('#drawer').classList.add('on');
  const m = $('#drawerMask');
  if (m) m.classList.add('on');
}
function hideDrawer() {
  $('#drawer').classList.remove('on');
  const m = $('#drawerMask');
  if (m) m.classList.remove('on');
}

function closeDrawer() {
  if (state.nxm.downloading) { toast('正在下载，请先点「取消下载」', 'err'); return; }
  if (state.install.running) { toast('正在安装，请等它完成', 'err'); return; }
  hideDrawer();
  state.drawer = { open: false, kind: null, mod: null, lang: 'zh', translated: null, translating: false };
  state.nxm = { open: false, info: null, prep: null, downloading: false, downloaded: null };
  state.install = { open: false, archivePath: null, meta: null, plan: null, running: false, manualTarget: null, result: null };
}

/* ---------------- nxm:// 下载接管 ---------------- */

/** 拼出该 Mod 的 Nexus 网页地址（用于引导用户去点 Mod Manager Download） */
function nxmSourceUrl(info) {
  return 'https://www.nexusmods.com/' + (info.game || 'stellarblade') + '/mods/' + info.modId +
    (info.fileId ? '?tab=files&file_id=' + info.fileId : '?tab=files');
}

/**
 * 打开「安装确认」抽屉。
 * info 可以来自：nxm:// 协议调起 / 粘贴链接 / 浏览页的「安装到本地」。
 * 带 key+expires 的链接能直接换到下载直链；网页地址则引导用户去点官方按钮。
 */
async function openNxmDrawer(info) {
  if (!info || !info.modId) { toast('无效的安装链接', 'err'); return; }

  state.nxm = { open: true, info, prep: null, downloading: false, gallery: null };
  $('#dTitle').textContent = '准备安装…';
  $('#dSub').textContent = 'Nexus Mod #' + info.modId + (info.fileId ? ' · 文件 #' + info.fileId : '');
  $('#dBody').innerHTML = `<div class="txt" style="color:var(--dim2)"><span class="spin"></span> 正在向 Nexus 核对 Mod 与文件信息…</div>`;
  $('#dFoot').innerHTML = `<button class="btn" id="nxmClose">关闭</button>`;
  showDrawer();

  try {
    const prep = await call(window.api.nxm.prepare({ raw: info.raw || null, ...info }), { silent: true });
    if (!state.nxm.open) return;           // 用户已经关掉了
    state.nxm.prep = prep;
    renderNxmDrawer();
    loadNxmGallery(info.modId);
  } catch (e) {
    if (!state.nxm.open) return;
    $('#dTitle').textContent = '安装准备失败';
    $('#dBody').innerHTML = `<div class="callout err">${esc(e.message)}</div>`;
    $('#dFoot').innerHTML = `<button class="btn" id="nxmClose">关闭</button>`;
  }
}

/**
 * 安装确认抽屉里的图集：只抓一次（渲染会随进度反复触发，不能每次都抓）。
 * `state.nxm.gallery === null` 表示「还没抓过」。
 */
async function loadNxmGallery(modId) {
  if (state.nxm.gallery) return;
  state.nxm.gallery = [];                    // 占位，避免并发重复抓
  let imgs = [];
  try { imgs = await call(window.api.modImages(modId, null), { silent: true }); } catch { imgs = []; }
  state.nxm.gallery = imgs || [];
  // 抽屉还开着、还是同一个 mod 才重绘
  if (state.nxm.open && state.nxm.info && Number(state.nxm.info.modId) === Number(modId)) renderNxmDrawer();
}

function renderNxmDrawer() {
  const { info, prep } = state.nxm;
  const m = (prep && prep.mod) || {};
  const f = (prep && prep.file) || null;
  const links = (prep && prep.links) || [];
  const err = prep && prep.linkError;
  const src = m.url || nxmSourceUrl(info);
  const gallery = (state.nxm.gallery || []).filter(x => x && x.localUrl);

  $('#dTitle').textContent = m.name || ('Nexus Mod #' + info.modId);
  $('#dSub').textContent = [m.author, m.version ? 'v' + m.version : '', 'Nexus #' + info.modId].filter(Boolean).join(' · ');

  $('#dBody').innerHTML = `
    <div id="galleryBox">${gallery.length
      ? `<div class="lbl">图集 · ${gallery.length} 张</div>${imageGrid(gallery)}`
      : (m.pictureUrl ? `<img class="hero" src="${esc(m.pictureUrl)}" alt="" onerror="this.style.display='none'">` : '')}</div>

    <div class="lbl">将要安装</div>
    <div class="kv"><span>Mod</span><span>${esc(m.name || '未知（Nexus 未返回该 Mod）')}</span></div>
    <div class="kv"><span>作者</span><span>${esc(m.author || '—')}</span></div>
    <div class="kv"><span>文件</span><span>${f ? esc(f.name) : '未指定（将由授权链接决定）'}</span></div>
    <div class="kv"><span>文件版本</span><span>${f ? esc(f.version || '—') : '—'}</span></div>
    <div class="kv"><span>文件大小</span><span>${f ? fmtSize(f.sizeInBytes) : '—'}</span></div>
    <div class="kv"><span>文件分类</span><span>${f ? esc(f.category || '—') : '—'}</span></div>
    <div class="kv"><span>下载量</span><span>${Number(m.downloads || 0).toLocaleString()}</span></div>

    <div class="lbl">来源</div>
    <div class="urlbox"><span style="flex:1">${esc(src)}</span>
      <button class="btn sm" data-openurl="${esc(src)}">打开</button></div>

    ${err
      ? `<div class="callout err">${esc(err)}</div>
         <div class="callout warn">
           <b>怎么继续：</b>在 Nexus 网页上打开该 Mod 的 <b>Files</b> 页，
           点对应文件的 <b>Mod Manager Download</b>（不要点 Manual download），
           系统会自动调起本程序并带上一次性下载授权，届时这里就能直接开始下载。
         </div>`
      : `<div class="callout">
           已拿到下载授权，可选的下载地址 ${links.length} 个，将使用第 1 个。
           授权由 Nexus 签发、一次性且有时效，若失败请回网页重新点一次按钮。
         </div>`}
  `;

  $('#dFoot').innerHTML = `
    <button class="btn" id="nxmClose">取消</button>
    <button class="btn" data-openurl="${esc(src)}">去 Nexus 下载页</button>
    <button class="btn p" id="nxmStart" ${links.length ? '' : 'disabled'}
      ${links.length ? '' : 'title="缺少下载授权，请先在 Nexus 网页点「Mod Manager Download」"'}>
      开始下载${f && f.sizeInBytes ? '（' + fmtSize(f.sizeInBytes) + '）' : ''}
    </button>
  `;
}

async function startNxmDownload() {
  const { info, prep } = state.nxm;
  if (!prep || !prep.links.length) { toast('缺少下载授权，无法开始', 'err'); return; }
  if (state.nxm.downloading) return;

  state.nxm.downloading = true;
  $('#dFoot').innerHTML = `<button class="btn d" id="nxmAbort">取消下载</button>`;
  renderNxmProgress(prep.file);

  try {
    const r = await call(window.api.nxm.start({ raw: info.raw || null, ...info, linkIndex: 0 }), { silent: true });
    state.nxm.downloading = false;
    renderNxmDone(r, info);
    toast('下载完成：' + (r.filename || '安装包'), 'ok');
  } catch (e) {
    state.nxm.downloading = false;
    $('#dBody').innerHTML = `
      <div class="callout err">下载失败：${esc(e.message)}</div>
      <div class="callout warn">
        <b>备选通路（手动下载）：</b>在 Nexus 网页点 <b>Manual download</b> 把包下到本地，
        再把文件放进 <code>SB\\Content\\Paks\\~Mods\\</code>，本程序刷新后会自动扫描到。
        下载目录监听与自动导入将在下一版接入。
      </div>
    `;
    $('#dFoot').innerHTML = `<button class="btn" id="nxmClose">关闭</button>
      <button class="btn" data-openurl="${esc(nxmSourceUrl(info))}">去 Nexus 下载页</button>`;
  }
}

/** 下载中的抽屉主体（进度条 + 文件信息） */
function renderNxmProgress(f) {
  $('#dTitle').textContent = '正在下载…';
  $('#dBody').innerHTML = `
    <div class="lbl">下载中</div>
    <div class="txt" id="nxmProgTxt" style="color:var(--dim)"><span class="spin"></span> 正在连接 Nexus 下载服务器…</div>
    <div class="prog ind" id="nxmProg"><i></i></div>
    <div class="txt" id="nxmProgMeta" style="color:var(--dim2);font-size:11px"></div>
    <div class="lbl">文件</div>
    <div class="kv"><span>名称</span><span>${esc((f && f.name) || '—')}</span></div>
    <div class="kv"><span>大小</span><span>${f ? fmtSize(f.sizeInBytes) : '未知'}</span></div>
    <div class="callout">下载完成后文件先落在暂存目录，自动安装将在下一版接入。</div>
  `;
}

function renderNxmDone(r, info) {
  const m = (state.nxm.prep && state.nxm.prep.mod) || {};
  const f = (state.nxm.prep && state.nxm.prep.file) || null;

  // 记下来给「安装到游戏」用
  state.nxm.downloaded = {
    path: r.path,
    meta: {
      modId: info.modId,
      fileId: info.fileId,
      name: m.name || ('Nexus #' + info.modId),
      author: m.author || null,
      version: (f && f.version) || m.version || null,
      url: m.url || null,
      pictureUrl: m.pictureUrl || null
    }
  };

  $('#dTitle').textContent = '下载完成';
  $('#dSub').textContent = (r.filename || '安装包') + ' · ' + fmtSize(r.size);
  $('#dBody').innerHTML = `
    <div class="callout" style="background:rgba(63,185,80,.09);border-color:rgba(63,185,80,.32);color:#9BE0A6">
      ✓ 已下载 ${esc(r.filename || '安装包')} · ${fmtSize(r.size)}
    </div>

    <div class="lbl">暂存位置</div>
    <div class="urlbox"><span style="flex:1">${esc(r.path)}</span>
      <button class="btn sm" data-reveal-path="${esc(r.path)}">打开所在目录</button></div>

    <div class="lbl">信息</div>
    <div class="kv"><span>Mod</span><span>${esc(m.name || ('Nexus #' + info.modId))}</span></div>
    <div class="kv"><span>Mod ID</span><span>${info.modId}</span></div>
    <div class="kv"><span>文件 ID</span><span>${info.fileId || '—'}</span></div>

    <div class="callout">
      点「安装到游戏」会自动识别包类型（Pak / 脚本 / 框架），
      并解压到对应目录，装完立刻出现在「已安装 Mod」里。
    </div>
  `;
  $('#dFoot').innerHTML = `
    <button class="btn" id="nxmClose">关闭</button>
    <button class="btn" data-openurl="${esc(m.url || nxmSourceUrl(info))}">查看 Mod 页面</button>
    <button class="btn p" id="nxmInstall">安装到游戏</button>
  `;
}

/* ---------------- 安装（压缩包 → 游戏目录） ---------------- */

/**
 * 打开安装确认抽屉。
 * archivePath 可以是刚下载的暂存包，也可以是用户挑的本地压缩包。
 *
 * @param {object} [opts] `{ auto: true }` —— 分析通过后**立刻开始安装**，
 *        不再等用户点确认。用于「一键安装前置组件」：用户已经在 Nexus 网页上
 *        点过两次了，再让他回来点第三次没有意义。覆盖风险由安装器的自动备份兜底。
 */
async function openInstallDrawer(archivePath, meta, opts = {}) {
  if (!archivePath) { toast('没有可安装的压缩包', 'err'); return; }

  state.install = {
    open: true, archivePath, meta: meta || {},
    plan: null, running: false, manualTarget: opts.manualTarget || null,
    pickDir: opts.pickDir || '', pickDirs: opts.pickDirs || null, result: null
  };

  $('#dTitle').textContent = '正在分析安装包…';
  $('#dSub').textContent = archivePath;
  $('#dBody').innerHTML = `<div class="txt" style="color:var(--dim2)"><span class="spin"></span> 正在读取压缩包结构…</div>`;
  $('#dFoot').innerHTML = `<button class="btn" id="instClose">取消</button>`;
  showDrawer();

  try {
    const plan = await call(window.api.install.analyze(archivePath, meta || {}, {}), { silent: true });
    if (!state.install.open) return;
    state.install.plan = plan;
    renderInstallPlan();
    if (opts.auto && plan.ok) await runInstall();
  } catch (e) {
    if (!state.install.open) return;
    $('#dTitle').textContent = '分析失败';
    $('#dBody').innerHTML = `<div class="callout err">${esc(e.message)}</div>`;
    $('#dFoot').innerHTML = `<button class="btn" id="instClose">关闭</button>`;
  }
}

function renderInstallPlan() {
  const st = state.install;
  const p = st.plan;
  const name = st.meta.name || p.archivePath.split(/[\\/]/).pop();

  $('#dTitle').textContent = '确认安装';
  $('#dSub').textContent = name;

  if (!p.ok) {
    // 结构不认识 —— 让用户手选落点
    $('#dBody').innerHTML = `
      <div class="callout warn">${esc(p.warnings[p.warnings.length - 1] || '无法识别压缩包结构')}</div>
      <div class="lbl">包内文件（前 ${Math.min(p.entries.length, 40)} 项，共 ${p.fileCount} 个 · ${fmtSize(p.totalBytes)}）</div>
      <div class="filelist" style="max-height:260px;overflow:auto">${p.entries.slice(0, 40).map(x => esc(x)).join('<br>')}</div>
      <div class="lbl">安装到</div>
      <div class="urlbox"><span style="flex:1">${st.manualTarget ? esc(st.manualTarget) : '（还没选）'}</span>
        <button class="btn sm" id="instPick">选择目录…</button></div>
      <div class="callout">选好目录后会<b>保持包内相对结构</b>原样展开，不做任何猜测。</div>
    `;
    $('#dFoot').innerHTML = `
      <button class="btn" id="instClose">取消</button>
      <button class="btn p" id="instRun" ${st.manualTarget ? '' : 'disabled'}>装到所选目录</button>
    `;
    return;
  }

  const conflictLine = p.conflictCount
    ? `<div class="callout warn">目标位置已有 <b>${p.conflictCount}</b> 个同名文件，继续安装会<b>覆盖</b>它们。
         <div style="margin-top:6px;font-size:11px;color:var(--dim2)">下面列出来的是具体是哪几个、原来是谁的；点一行可在资源管理器中定位。</div>
       </div>`
    : '';
  // ⚠️ 这里必须显式把「要装进去的那份」的 meta 传下去（st.meta）——
  //    对比框右侧（新 Mod 的封面 / 版本 / 作者 / 文件）全靠它。不传的话
  //    就只能显示「Mod #? / 版本 — / 作者 —」，用户会以为对比功能坏了。
  const conflictList = conflictListHtml(p.conflictDetails, { incoming: st.meta || {} });

  // 「软覆盖」：同名且**大小完全一致** —— 极可能就是同一个文件（很多 CNS 服装 mod
  // 都自带同一个底座 pak）。不算冲突、不拦自动安装，但要说一句，
  // 否则用户看到「覆盖 0 个」会以为一个文件都不会被动。
  const softLine = p.softOverwriteCount
    ? `<div class="callout">有 <b>${p.softOverwriteCount}</b> 个文件与游戏里现有的<b>同名且大小完全一致</b>，
         应该是同一个文件（常见于多个 CNS 服装 mod 共用的底座）。会直接覆盖，覆盖前同样自动备份。</div>`
    : '';

  // 服装 Mod 的依赖提示：装了 CNS 才生效。
  // 不拦着不让装（文件本身无害，只是游戏里不显示），但必须说清楚，
  // 否则用户会以为「装了没效果 = 这个 mod 坏了」。
  const cnsOk = !!(state.game && state.game.found && state.game.cns && state.game.cns.installed);
  const cnsLine = (p.requiresCns && !cnsOk)
    ? `<div class="callout err">
         <b>这是服装 Mod，需要先安装 CNS 才会生效。</b><br>
         识别依据：${esc(p.requiresCnsReason || '包内包含 CNS 服装数据')}。<br>
         当前没有检测到 CNS —— 现在装下去，文件会落进
         <code>~Mods\\CustomNanosuitSystem\\</code>，但游戏里不会显示。
         <div style="margin-top:8px"><button class="btn sm p" id="instGoCns">先去装 CNS</button></div>
       </div>`
    : (p.requiresCns
      ? `<div class="callout" style="background:rgba(63,185,80,.09);border-color:rgba(63,185,80,.32);color:#9BE0A6">✓ 这是服装 Mod，CNS 已就绪。</div>`
      : '');

  const ue4ssLine = p.prereqKey === 'ue4ss'
    ? `<div class="callout warn">这是 <b>UE4SS 加载器本体</b>：会覆盖 <code>SB\\Binaries\\Win64\\</code> 下的现有文件（覆盖前自动备份，卸载可还原）。</div>`
    : '';

  const warnLine = p.warnings.length
    ? `<div class="lbl">提示</div><div class="filelist">${p.warnings.slice(0, 8).map(w => esc(w)).join('<br>')}</div>`
    : '';

  $('#dBody').innerHTML = `
    <div class="callout" style="background:rgba(63,185,80,.09);border-color:rgba(63,185,80,.32);color:#9BE0A6">
      ✓ 识别为 <b>${esc(p.kindLabel)}</b>：${esc(p.reason)}
    </div>

    <div class="lbl">将安装到</div>
    <div class="urlbox"><span style="flex:1">${esc(p.target)}</span>
      <button class="btn sm" data-openpath="${esc(p.target)}">打开</button></div>
    <div class="kv"><span>落点</span><span>${esc(p.targetLabel)}</span></div>

    <div class="lbl">内容</div>
    <div class="kv"><span>文件数</span><span>${p.fileCount} 个</span></div>
    <div class="kv"><span>解压后大小</span><span>${fmtSize(p.totalBytes)}</span></div>
    ${p.strippedPrefix ? `<div class="kv"><span>剥离前缀</span><span>${esc(p.strippedPrefix)}\\</span></div>` : ''}
    <div class="kv"><span>来源</span><span>${esc(name)}</span></div>

    ${ue4ssLine}
    ${cnsLine}
    ${conflictLine}
    ${conflictList}
    ${softLine}

    <div class="lbl">文件预览（前 ${Math.min(p.preview.length, 25)} 项）</div>
    <div class="filelist" style="max-height:200px;overflow:auto">${p.preview.slice(0, 25).map(x => esc(x)).join('<br>')}${
      p.fileCount > 25 ? `<br>… 等共 ${p.fileCount} 个` : ''}</div>

    ${warnLine}
  `;

  $('#dFoot').innerHTML = `
    <button class="btn" id="instClose">取消</button>
    <button class="btn" data-openpath="${esc(p.target)}">打开目标目录</button>
    <button class="btn p" id="instRun">装到游戏${p.conflictCount ? '（覆盖 ' + p.conflictCount + ' 个）' : ''}</button>
  `;
}

async function runInstall() {
  const st = state.install;
  if (!st.plan || st.running) return;

  st.running = true;
  $('#dTitle').textContent = '正在安装…';
  $('#dFoot').innerHTML = '';
  $('#dBody').innerHTML = `
    <div class="lbl">安装中</div>
    <div class="txt" id="instProgTxt" style="color:var(--dim)"><span class="spin"></span> 正在解压…</div>
    <div class="prog ind" id="instProg"><i></i></div>
    <div class="txt" id="instProgMeta" style="color:var(--dim2);font-size:11px"></div>
    <div class="callout">解压到临时目录后再复制到游戏目录，中途不会污染游戏文件。</div>
  `;

  try {
    const r = await call(window.api.install.run({
      archivePath: st.archivePath,
      meta: st.meta,
      manualTarget: st.manualTarget || undefined,
      // 🔴 变体选择必须一起带过去 —— 主进程 runInstall 会**重新分析**一遍结构，
      //    漏传 pickDir/pickDirs 会让变体包在第二步失败（实测 mod 2595/1378/437 全挂在这）
      pickDir: st.pickDir || undefined,
      pickDirs: st.pickDirs || undefined,
      onConflict: 'overwrite'
    }), { silent: true });
    st.running = false;
    st.result = r;
    renderInstallDone(r);
    toast('已安装：' + (st.meta.name || r.kindLabel), 'ok');
    await refreshAll();
  } catch (e) {
    st.running = false;
    $('#dTitle').textContent = '安装失败';
    $('#dBody').innerHTML = `
      <div class="callout err">${esc(e.message)}</div>
      <div class="callout warn">
        也可以手动安装：把压缩包解压后，把 <code>.pak</code> / <code>.ucas</code> / <code>.utoc</code>
        放进 <code>SB\\Content\\Paks\\~Mods\\</code>，刷新后会自动出现在列表里。
      </div>
    `;
    $('#dFoot').innerHTML = `<button class="btn" id="instClose">关闭</button>`;
  }
}

function renderInstallDone(r) {
  const st = state.install;
  const m = st.meta || {};
  $('#dTitle').textContent = '安装完成';
  $('#dSub').textContent = (m.name || r.kindLabel) + ' · ' + r.written + ' 个文件';
  $('#dBody').innerHTML = `
    <div class="callout" style="background:rgba(63,185,80,.09);border-color:rgba(63,185,80,.32);color:#9BE0A6">
      ✓ 已写入 ${r.written} 个文件${r.skipped ? '，跳过 ' + r.skipped + ' 个' : ''}
    </div>
    <div class="kv"><span>类型</span><span>${esc(r.kindLabel)}</span></div>
    <div class="kv"><span>落点</span><span>${esc(r.targetLabel)}</span></div>
    <div class="lbl">安装位置</div>
    <div class="urlbox"><span style="flex:1">${esc(r.target)}</span>
      <button class="btn sm" data-openpath="${esc(r.target)}">打开</button></div>
    <div class="lbl">写入的文件（前 20 项）</div>
    <div class="filelist" style="max-height:200px;overflow:auto">${
      r.manifest.slice(0, 20).map(f => esc(f.rel)).join('<br>')}${
      r.manifest.length > 20 ? `<br>… 等共 ${r.manifest.length} 个` : ''}</div>
    ${r.backedCount
      ? `<div class="callout" style="background:rgba(210,153,34,.10);border-color:rgba(210,153,34,.35)">
           <b>已备份 ${r.backedCount} 个被覆盖的原文件</b> —— 卸载时会自动还原。
           ${r.backupFailed ? `<br><span style="color:var(--danger)">有 ${r.backupFailed} 个备份失败，请留意。</span>` : ''}
           <div class="urlbox" style="margin-top:6px"><span style="flex:1">${esc(r.backupDir || '')}</span>
             <button class="btn sm" data-openpath="${esc(r.backupDir || '')}">打开</button></div>
         </div>`
      : ''}
    <div class="callout">已登记到本地注册表，可以在「已安装 Mod」里启停或卸载（卸载会先备份）。</div>
  `;
  $('#dFoot').innerHTML = `
    <button class="btn" id="instClose">完成</button>
    <button class="btn p" id="instGoList">去已安装列表看看</button>
  `;
}

/** 安装进度推送 */
function onInstallProgress(p) {
  if (!state.install || !state.install.running || !p) return;
  const bar = $('#instProg');
  if (!bar) return;
  const fill = bar.querySelector('i');
  const txt = $('#instProgTxt');
  const meta = $('#instProgMeta');

  if (p.stage === 'extract') {
    if (txt) txt.innerHTML = '<span class="spin"></span> 正在解压安装包…';
    if (fill) fill.style.width = '100%';
  } else if (p.stage === 'copy') {
    bar.classList.remove('ind');
    if (fill) fill.style.width = p.percent + '%';
    if (txt) txt.innerHTML = `正在复制到游戏目录… <b style="color:var(--text)">${p.percent}%</b>`;
    if (meta) meta.textContent = p.done + ' / ' + p.total + ' 个文件';
  } else if (p.stage === 'backup') {
    if (txt) txt.innerHTML = '<span class="spin"></span> 正在备份被覆盖的原文件…';
    if (meta) meta.textContent = p.done + ' 个 · ' + (p.file || '');
  }
}

/** 下载进度推送（常驻订阅，只在下载中生效） */
function bindNxmProgress() {
  window.api.nxm.onProgress(onNxmProgress);
}

/** 收到一条进度推送时的渲染（抽出来便于单测/自动化验证） */
function onNxmProgress(p) {
  if (!state.nxm || !state.nxm.downloading || !p) return;
  const bar = $('#nxmProg');
  if (!bar) return;
  const fill = bar.querySelector('i');
  const txt = $('#nxmProgTxt');
  const meta = $('#nxmProgMeta');

  if (p.stage === 'download') {
    const known = p.percent != null;
    bar.classList.toggle('ind', !known);
    if (fill) fill.style.width = (known ? p.percent : 34) + '%';
    if (txt) txt.innerHTML = known
      ? `正在下载… <b style="color:var(--text)">${p.percent}%</b>`
      : '<span class="spin"></span> 正在下载…（服务器未提供总大小）';
    if (meta) meta.textContent = fmtSize(p.received) + (p.total ? ' / ' + fmtSize(p.total) : '');
  } else if (p.stage === 'downloaded') {
    bar.classList.remove('ind');
    if (fill) fill.style.width = '100%';
    if (txt) txt.innerHTML = '下载完成，正在收尾…';
  }
}

async function refreshNxmStatus() {
  try {
    const r = await call(window.api.nxm.status(), { silent: true });
    state.nxmStatus = r;
    const el = $('#nxmProtoLine');
    if (!el) return;
    el.innerHTML = r.registered
      ? `<span style="color:var(--ok)">● 已注册</span>
         <span style="color:var(--dim2);font-size:11px">网页上点「Mod Manager Download」会自动调起本程序</span>`
      : `<span style="color:var(--accent)">● 未注册</span>
         <span style="color:var(--dim2);font-size:11px">注册后才能在网页上点按钮直接下载</span>`;
  } catch { /* 静默 */ }
}

async function refreshInstallTools() {
  try {
    const r = await call(window.api.install.tools(), { silent: true });
    state.installTools = r;
    const el = $('#instToolLine');
    if (!el) return;
    el.innerHTML = r.available
      ? `<span style="color:var(--ok)">● ${esc(r.label)}</span>
         <span style="color:var(--dim2);font-size:11px">${esc(r.exe)}</span>`
      : `<span style="color:var(--red)">● 未找到</span>
         <span style="color:var(--dim2);font-size:11px">安装 7-Zip 后才能自动解压</span>`;
  } catch { /* 静默 */ }
}

/** 粘贴链接 → 解析 → 打开安装确认抽屉 */
async function parseAndInstall(url) {
  const s = String(url || '').trim();
  if (!s) { toast('请先粘贴链接', 'err'); return false; }
  try {
    const info = await call(window.api.nxm.parse(s), { silent: true });
    closeModal();
    await openNxmDrawer(info);
    return true;
  } catch (e) {
    toast(e.message, 'err');
    return false;
  }
}

function openImportModal() {
  openModal('导入 Mod', `
    <div style="color:var(--dim);margin-bottom:8px">粘贴 Nexus 的 Mod 页面地址，或 <code>nxm://</code> 链接：</div>
    <textarea id="impUrl" placeholder="https://www.nexusmods.com/stellarblade/mods/1496&#10;或 nxm://stellarblade/mods/1496/files/13020?key=...&amp;expires=..."></textarea>
    <div class="callout" style="margin-top:12px">
      带 <code>nxm://</code> 的链接自带下载授权，可直接下载；普通网页地址会先带你到
      Nexus 的 Files 页，点一次 <b>Mod Manager Download</b> 即可自动接续。
    </div>
    <div class="callout" style="margin-top:8px">
      已经有压缩包了？点下面的「选择本地压缩包」，支持 <code>.zip</code> / <code>.7z</code> / <code>.rar</code>。
      程序会自动识别是 Pak 模组、脚本模组还是框架包，并解压到对应目录。
    </div>
  `, [
    { label: '取消', id: 'impCancel' },
    { label: '选择本地压缩包', id: 'impPick' },
    { label: '解析并继续', id: 'impGo', primary: true }
  ]);
  setTimeout(() => { const t = $('#impUrl'); if (t) t.focus(); }, 30);
}

/** 选一个本地压缩包 → 直接进安装确认 */
async function pickLocalArchive() {
  try {
    const file = await call(window.api.install.pickArchive(), { silent: true });
    if (!file) return;
    closeModal();
    const base = file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    await openInstallDrawer(file, { name: base });
  } catch { /* 已提示 */ }
}

/* ---------------- 事件 ---------------- */

function bindEvents() {
  $$('.nav-i').forEach(n => n.addEventListener('click', () => switchPage(n.dataset.p)));
  $('#dClose').addEventListener('click', closeDrawer);
  // 点抽屉外的空白处也关（用户 2026-10-13：详情页面打开后，点击空白的地方自动关闭）。
  // 遮罩 z-index 39 在抽屉(40)之下、弹窗(60)之下，所以弹窗开着时点不到它。
  const dm = $('#drawerMask');
  if (dm) dm.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    // 批量解析的搜索框：回车就搜
    if (e.key === 'Enter' && e.target && e.target.id === 'linkerQuery') {
      const q = e.target.value && e.target.value.trim();
      if (q && linkerUI.search) runLinkerSearch(linkerUI.search.localId, q);
      return;
    }
    if (e.key !== 'Escape') return;
    if ($('#modal').classList.contains('on')) closeLinkerModal();
    else closeDrawer();
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeLinkerModal(); });

  $('#btnRefresh').addEventListener('click', () => refreshAll(true));

  // 顶栏「启动游戏」：直接拉起游戏主程序，不等它退出
  $('#btnLaunch').addEventListener('click', async () => {
    const btn = $('#btnLaunch');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const r = await call(window.api.game.launch());
      toast('正在启动游戏…', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      syncLaunchBtn();
    }
  });

  $('#btnNexusAccount').addEventListener('click', () => {
    switchPage('p-settings');
    setTimeout(() => { const el = $('#authLine'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  });

  $('#btnImport').addEventListener('click', () => {
    openImportModal();
  });

  // 批量解析：把手工放进去的 Mod 与 Nexus 对上号（用户 2026-11-06）
  const btnL = $('#btnLinker');
  if (btnL) btnL.addEventListener('click', () => openLinkerModal());

  $('#btnOpenSite').addEventListener('click', () => {
    window.api.openExternal('https://www.nexusmods.com/stellarblade/mods/');
  });

  // 成人内容三态：隐藏成人 / 全部内容 / 只显示成人
  // 2026-11-11：合并态的这三档变成筛选区里的一行（libAdultRow），节点是每次重画新建的 ——
  // 所以不能再往 #adultTabs 上挂监听，改成文档级委托（data-adult 只在这两处出现）。
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-adult]');
    if (!b) return;
    const mode = b.dataset.adult;
    if (state.browse.adultMode === mode) return; // 已选中，不重复拉
    state.browse.adultMode = mode;
    // 注意用 $（$ 是单元素，没有 forEach）—— 这里再踩一次就会「状态改了但界面不重画」
    $$('#adultTabs button, #browseFilters button[data-adult]').forEach(x => x.classList.toggle('on', x.dataset.adult === mode));
    // 合并档位（在线以外）是本地记录，就地重画即可；在线档位才需要回 Nexus 重拉
    if ((state.lib.status || 'all') !== 'online') { renderBrowse(); return; }
    loadBrowse(true);
  });

  // 只看未安装（本地判定，Nexus 没这个筛选条件）—— 开/关都要重新拉
  const elNewOnly = $('#newOnlyTabs');
  if (elNewOnly) elNewOnly.addEventListener('click', async (e) => {
    // 「已下载」：本地安装包清单（不走 Nexus 分页），可多选批量安装
    if (e.target.closest('button[data-onlydl]')) {
      state.browse.onlyDownloaded = !state.browse.onlyDownloaded;
      // 2026-11-10：不再清掉「未安装」。两个筛选可以同时开，
      // 同时开着的口径就是「已下载 且 没装」—— 也正是「已下载」清单本来的内容，
      // 所以这里只是把高亮点亮，不动另一个开关。
      syncOnlyTabs();
      selClear();
      if (state.browse.onlyDownloaded) await refreshLibrary();
      renderBrowse();
      return;
    }
    const b = e.target.closest('button[data-onlynew]');
    if (!b) return;
    state.browse.onlyUninstalled = !state.browse.onlyUninstalled;
    syncOnlyTabs();
    selClear();
    // 「已下载」视图开着时，这个开关也是本地清单上的筛选，不用回 Nexus 重拉
    if (state.browse.onlyDownloaded) { renderBrowse(); return; }
    loadBrowse(true);
  });

  // 黑名单三态：隐藏（默认）/ 显示全部 / 只看黑名单
  const elBlockTabs = $('#blockTabs');
  if (elBlockTabs) elBlockTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-block]');
    if (!btn) return;
    const mode = btn.dataset.block;
    if (state.browse.blockMode === mode) return;
    // 「只看喜欢」与「只看黑名单」是两个互斥的本地视图，同时开没有意义
    // （一个列表里不可能既只留喜欢的、又只留拉黑的）—— 点一个就把另一个关掉。
    if (mode === 'only' && state.browse.onlyLiked) {
      state.browse.onlyLiked = false;
      updateLikeTabs();
    }
    state.browse.blockMode = mode;
    updateBlockTabs();
    loadBrowse(true);
  });

  // 只看喜欢（纯本地记录，秒开，不请求 Nexus）
  const elLikeTabs = $('#likeTabs');
  if (elLikeTabs) elLikeTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-onlyliked]');
    if (!btn) return;
    const next = !state.browse.onlyLiked;
    state.browse.onlyLiked = next;
    if (next && state.browse.blockMode === 'only') {
      state.browse.blockMode = 'hide';
      updateBlockTabs();
    }
    updateLikeTabs();
    loadBrowse(true);
  });

  $('#btnLoadMore').addEventListener('click', () => {
    if (state.browse.loading) return;
    loadBrowse(false);
  });

  // 多选 / 全选 / 批量下载（默认下载各 Mod 的第一个主文件）
  $('#btnBatchMode').addEventListener('click', () => selSetMode(!state.sel.on));
  $('#btnSelectAll').addEventListener('click', () => selSelectAll());
  $('#btnBatchDownload').addEventListener('click', () => { batchDownload().catch(() => {}); });
  // Mod 库（2026-11-10）新增的四颗批量按钮：按选中项的状态自动亮/灰（见 selUpdateBar）
  $('#btnBatchInstall').addEventListener('click', () => { libBatchInstallSel().catch(() => {}); });
  $('#btnBatchOn').addEventListener('click', () => { libBatchToggleSel(true).catch(() => {}); });
  $('#btnBatchOff').addEventListener('click', () => { libBatchToggleSel(false).catch(() => {}); });
  $('#btnBatchUninstall').addEventListener('click', () => { libBatchUninstallSel().catch(() => {}); });
  // 类型下拉：本地判定，不联网
    // 排序下拉（0.5.3）：放在类型筛选旁边，切换即重排，不需要重新拉列表
    const libSortSel = $('#libSort');
    // 批量标记（0.5.4）：智能开关，全标过再点就是取消；「未验证」是明确取消已验证
    const bindMark = (id, kind, force) => {
      const el = $('#' + id);
      if (el) el.addEventListener('click', () => { libBatchMark(kind, force); });
    };
    bindMark('btnBatchLike', 'like');
    bindMark('btnBatchDislike', 'dislike');
    bindMark('btnBatchBug', 'bug');
    bindMark('btnBatchVerify', 'verified');
    bindMark('btnBatchUnverify', 'verified', true);
    if (libSortSel) {
      libSortSel.value = state.lib.sort || '';
      libSortSel.addEventListener('change', () => { state.lib.sort = libSortSel.value || ''; renderBrowse(); });
    }

  // 浏览页：滚到底部自动加载下一页（阈值 420px 提前预取，滚动更顺）。
  // 「加载更多」按钮保留作兜底 —— 键盘翻页、终端里没有平滑滚动的场景照样能加载。
  let scrollTick = false;
  $('#body').addEventListener('scroll', () => {
    if (!$('#p-browse').classList.contains('on')) return;
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      const b = state.browse;
      const el = $('#body');
      if (!el) return;
      if (shouldLoadMore(el.scrollTop, el.clientHeight, el.scrollHeight, b)) loadBrowse(false);
    });
  }, { passive: true });

  // 分类（单选）/ 标签（多选）筛选 —— 事件委托，chips 是动态重绘的
  $('#browseFilters').addEventListener('click', e => {
    const b = state.browse;
    const clear = e.target.closest('#btnClearFilter');
    const merged = (state.lib.status || 'all') !== 'online';
    if (clear) {
      b.category = '';
      b.tags = [];
      state.lib.catSet = false;
      if (merged) { renderBrowse(); return; }
      loadBrowse(true);
      return;
    }
    const cat = e.target.closest('button[data-cat]');
    if (cat) {
      b.category = cat.dataset.cat || '';
      state.lib.catSet = true;
      if (merged) { renderBrowse(); return; }
      loadBrowse(true);
      return;
    }
    const tag = e.target.closest('button[data-tag]');
    if (tag) {
      const v = tag.dataset.tag;
      b.tags = b.tags.includes(v) ? b.tags.filter(x => x !== v) : b.tags.concat(v);
      if (merged) { renderBrowse(); return; }
      loadBrowse(true);
    }
  });

  $('#sortTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-sort]');
    if (!b) return;
    $$('#sortTabs button').forEach(x => x.classList.toggle('on', x === b));
    state.browse.sort = b.dataset.sort;
    // 合并档位：按本地记录里同一批字段排（applyLibSort 认这四个键）
    if ((state.lib.status || 'all') !== 'online') { renderBrowse(); return; }
    loadBrowse(true);
  });

  let searchTimer = null;
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.browse.search = e.target.value.trim();
      // Mod 库的本地档位（已下载 / 已安装 / 带标记）没必要去 Nexus 再拉一遍，就地筛
      if ((state.lib.status || 'all') !== 'online') { renderBrowse(); return; }
      loadBrowse(true);
    }, 450);
  });

  // 已安装页的关键词筛选：输入框是每次重画时现生成的，所以用委托。
  // 但**输入过程中绝不重画**，只调 applyInstSearch() 就地切 class —— 早期版本是
  // 「防抖 220ms 后 renderInstalled()、再把焦点和光标还回去」，在四五百张卡的规模下
  // 重画要一秒上下，焦点还回去时用户已经在打下一个字了，实测体验就是「像是只能输
  // 一个字符 / 搜索框不好使」。改成就地过滤后输入框节点稳如磐石，也不用补光标。
  document.addEventListener('input', e => {
    if (!e.target || e.target.id !== 'instSearch') return;
    state.instFilters.q = e.target.value;
    applyInstSearch();
  });

  // 全局委托
  document.addEventListener('click', async (e) => {
    const t = e.target;

    // 已安装页多选模式：点卡片（含封面、开关、标签）一律当「勾选 / 取消勾选」。
    // ⚠️ 必须排在最前面 —— 后面 `data-gtoggle` 的分支比 `.card` 兜底还早，
    //    不抢在它前面的话，多选模式里点开关会把 Mod 关掉而不是选中它。
    if (state.gsel.on) {
      const card = t.closest('.card[data-gid]');
      if (card) { gselClick(card.dataset.gid, e); return; }
    }

    const setroot = t.closest('[data-setroot]');
    if (setroot) { await doSetRoot(setroot.dataset.setroot); return; }

    const openurl = t.closest('[data-openurl]');
    if (openurl) { e.preventDefault(); window.api.openExternal(openurl.dataset.openurl); return; }

    // 🔴 「对比」必须排在 data-reveal-path **之前**：整行都带 data-reveal-path
    //    （点行就是定位），不抢先的话点「对比」只会弹资源管理器。
    const cmpBtn = t.closest('[data-cmp]');
    if (cmpBtn) {
      e.stopPropagation();
      await openCmpModal(Number(cmpBtn.dataset.cmp), cmpBtn.dataset.cmpName || '', {
        version: cmpBtn.dataset.cmpVer || '',
        author: cmpBtn.dataset.cmpAuthor || '',
        pictureUrl: cmpBtn.dataset.cmpPic || ''
      });
      return;
    }

    const openpath = t.closest('[data-openpath]');
    if (openpath) { window.api.openPath(openpath.dataset.openpath); return; }

    const revealp = t.closest('[data-reveal-path]');
    if (revealp) { window.api.revealPath(revealp.dataset.revealPath); return; }

    const mkmods = t.closest('[data-mkmods]');
    if (mkmods) {
      try { await call(window.api.game.ensureModsDir()); toast('已创建 ~Mods 目录', 'ok'); await refreshAll(); }
      catch { /* 已提示 */ }
      return;
    }

    const mklogic = t.closest('[data-mklogicmods]');
    if (mklogic) {
      try { await call(window.api.game.ensureLogicModsDir()); toast('已创建 LogicMods 目录', 'ok'); await refreshAll(); }
      catch { /* 已提示 */ }
      return;
    }

    if (t.closest('#cnsInstall')) { await installPrereq('cns'); return; }
    if (t.closest('#atoolInstall')) { await installPrereq('atool'); return; }

    // UE4SS：走 GitHub 直下，不需要用户在任何网页上点按钮
    if (t.closest('#ue4ssInstall')) { await installUe4ss(); return; }
    if (t.closest('#ue4ssReleases')) {
      try { await call(window.api.prereq.openReleases(), { silent: true }); } catch { /* 已提示 */ }
      return;
    }

    // 下载目录监听：移除某个监听目录
    const watchrm = t.closest('[data-watchrm]');
    if (watchrm) {
      try {
        await call(window.api.watch.removeDir(watchrm.dataset.watchrm), { silent: true });
        await refreshWatchLine();
        toast('已移除监听目录');
      } catch { /* 已提示 */ }
      return;
    }

    // CNS 的备用入口：用户已经自己下好了压缩包（Manual download），直接选文件装
    if (t.closest('#cnsPickLocal')) {
      try {
        const p = await call(window.api.install.pickArchive(), { silent: true });
        if (p) await openInstallDrawer(p, { name: 'CustomNanosuitSystem', modId: 1496, isPrereq: true }, { auto: true });
      } catch { /* 已提示 */ }
      return;
    }

    // ATOOL 的备用入口（同上）。落到 LogicMods 由安装器的结构规则负责，这里不用额外指定落点。
    if (t.closest('#atoolPickLocal')) {
      try {
        const p = await call(window.api.install.pickArchive(), { silent: true });
        if (p) await openInstallDrawer(p, { name: 'Animation Tool (ATOOL)', modId: 1662, isPrereq: true }, { auto: true });
      } catch { /* 已提示 */ }
      return;
    }

    const nexusBtn = t.closest('[data-nexus]');
    if (nexusBtn) { openNexusDrawer(Number(nexusBtn.dataset.nexus)); return; }

    // 刷新图集：强制重抓（默认 7 天缓存，点这个就绕过）
    const galBtn = t.closest('[data-gallery]');
    if (galBtn) { await fillGallery(Number(galBtn.dataset.gallery), { force: true }); return; }

    const trans = t.closest('[data-translate]');
    if (trans) { doTranslate(); return; }

    const arch = t.closest('[data-showarchived]');
    if (arch) { renderFiles(true, state.drawer.mod && state.drawer.mod.modId); return; }

    // ---- 已安装页：多选 / 批量启用·关闭·删除（用户 2026-11-07 要求「与查看在线 mod 一致」）----
    const gmode = t.closest('[data-gbatch-mode]');
    if (gmode) { gselSetMode(!state.gsel.on); return; }

    const gall = t.closest('[data-gbatch-all]');
    if (gall) { gselSelectAll(); return; }

    const gon = t.closest('[data-gbatch-on]');
    if (gon) { await gselBatchToggle(true); return; }

    const goff = t.closest('[data-gbatch-off]');
    if (goff) { await gselBatchToggle(false); return; }

    const gdel = t.closest('[data-gbatch-del]');
    if (gdel) { await gselBatchUninstall(); return; }

    // 「有 bug」这组：only / none 互斥，再点一次回到「不筛」
    const ibug = t.closest('[data-ibug]');
    if (ibug) {
      const v = ibug.dataset.ibug || '';
      state.instFilters.bug = (state.instFilters.bug || '') === v ? '' : v;
      renderInstalled();
      return;
    }

    // 启用状态筛选（chip）；再点一次当前项就是取消筛选
    const istate = t.closest('[data-istate]');
    if (istate) {
      const v = istate.dataset.istate || '';
      state.instFilters.state = (state.instFilters.state || '') === v ? '' : v;
      renderInstalled();
      return;
    }

    // 筛选结果为空时那颗「清空筛选」
    const iclear = t.closest('[data-iclear]');
    if (iclear) {
      state.instFilters = { q: '', state: '', kind: '', bug: '' };
      renderInstalled();
      return;
    }

    const sb = t.closest('[data-showbuiltin]');
    if (sb) {
      state.showBuiltin = !state.showBuiltin;
      renderInstalled();
      saveFilters();   // 「是否显示 UE4SS 内置脚本」也算筛选条件（用户明确要求「已安装的同样道理」）
      return;
    }

    // 排序方向翻转（右侧那颗「↑ 正序 / ↓ 倒序」）
    const idir = t.closest('[data-isortdir]');
    if (idir) { toggleInstalledSortDir(); return; }

    // 已安装页排序切换（默认「安装时间」倒序）
    const isort = t.closest('[data-isort]');
    if (isort) {
      const v = isort.dataset.isort || 'time';
      // 点**已经选中的**那个排序名 = 翻转正序 / 倒序（表格表头的习惯）；
      // 点别的 = 换排序方式，方向回到它自己的默认值。
      if (v === state.installedSort) {
        toggleInstalledSortDir();
      } else {
        state.installedSort = v;
        state.installedSortDir = sortDefaultDir(v);
        renderInstalled();
        saveFilters();
      }
      return;
    }

    const lang = t.closest('[data-lang]');
    if (lang) {
      state.drawer.lang = lang.dataset.lang;
      $$('.langsw button').forEach(b => b.classList.toggle('on', b === lang));
      const d = state.drawer;
      if (d.kind === 'installed') {
        const meta = d.mod.meta || {};
        $('#descBox').innerHTML = renderDesc(d.mod, meta.description || meta.summary || '', meta.descriptionZh || meta.summaryZh || '');
      } else if (d.mod) {
        $('#descBox').innerHTML = descBoxHtml(d);
      }
      return;
    }

    const install = t.closest('[data-install]');
    if (install) {
      const modId = Number(install.dataset.install);
      // 前置组件（如 CNS）走一键安装 —— 会打开安装助手并高亮下载按钮。
      // 走原来的「无授权网页地址」路径必然失败（网页地址不带 key/expires）。
      const pq = prereqByModId(modId);
      if (pq && pq.canAutoInstall) { await installPrereq(pq.key); return; }
      openNxmDrawer({
        raw: 'https://www.nexusmods.com/stellarblade/mods/' + modId,
        game: 'stellarblade', modId, fileId: null,
        key: null, expires: null, userId: null
      });
      return;
    }

    // 整组开关（合并卡片上的那个小开关 / 抽屉底部 —— 一个 Mod 装了多个文件时作用于全部）
    const gtg = t.closest('[data-gtoggle]');
    if (gtg) { e.stopPropagation(); await doToggleGroup(gtg.dataset.gtoggle); return; }

    // 卸载整组（抽屉底部「卸载这个 Mod」）
    const gu2 = t.closest('[data-guninstall]');
    if (gu2) { await doUninstallGroup(gu2.dataset.guninstall); return; }

    // 「有 bug」标记（抽屉底部，卸载旁边）
    const gbug = t.closest('[data-gbug]');
    if (gbug) { await doBugToggleGroup(gbug.dataset.gbug); return; }

    // 解除关联（抽屉底部）—— 只删关联记录，文件一个都不动
    const gul = t.closest('[data-gunlink]');
    if (gul) { await doUnlinkGroup(gul.dataset.gunlink); return; }

    // ---- 批量解析弹窗内部交互 ----
    const lfilter = t.closest('[data-lfilter]');
    if (lfilter) {
      linkerSyncFromDom();
      linkerUI.filter = lfilter.dataset.lfilter;
      linkerPaint();
      return;
    }
    const lback = t.closest('[data-lback]');
    if (lback) { linkerUI.search = null; linkerPaint(); return; }
    const lgo = t.closest('[data-lgo]');
    if (lgo) {
      const q = $('#linkerQuery') && $('#linkerQuery').value;
      if (q && q.trim()) await runLinkerSearch(linkerUI.search.localId, q.trim());
      return;
    }
    const lpick = t.closest('[data-lpick]');
    if (lpick) {
      const [localId, modIdRaw] = String(lpick.dataset.lpick).split('|');
      const modId = Number(modIdRaw);
      const hit = ((linkerUI.search && linkerUI.search.results) || []).find(c => Number(c.modId) === modId);
      const row = linkerUI.rows.find(r => r.localId === localId);
      if (row && hit) {
        row.sel = { ...hit, modId };
        row.on = true;
        row.matchedByManual = true;
      }
      linkerUI.search = null;
      linkerPaint();
      return;
    }

    // 抽屉里「已安装的文件」每行的 启用/禁用、卸载 —— 只作用于**这一个文件**
    const iidBtn = t.closest('[data-iid]');
    if (iidBtn) {
      e.stopPropagation();
      const iid = iidBtn.dataset.iid;
      const act = iidBtn.dataset.iact;
      const it = (state.installed || []).find(x => x.id === iid);
      if (act === 'toggle' && it) {
        try {
          await call(window.api.mods.setEnabled(iid, !it.enabled));
          toast(it.enabled ? '已禁用（文件重命名为 .disabled）' : '已启用', 'ok');
          await refreshAll();
          reopenInstalledDrawer();
        } catch { /* 已提示 */ }
      } else if (act === 'uninstall') {
        await doUninstall(iid, { keepDrawer: true });
      }
      return;
    }

    const tg = t.closest('[data-toggle]');
    if (tg) { e.stopPropagation(); await doToggle(tg.dataset.toggle); return; }

    const tg2 = t.closest('[data-toggle2]');
    if (tg2) { await doToggle(tg2.dataset.toggle2); closeDrawer(); return; }

    const rev = t.closest('[data-reveal]');
    if (rev) { try { await call(window.api.mods.reveal(rev.dataset.reveal)); } catch { /* 已提示 */ } return; }

    const un = t.closest('[data-uninstall]');
    if (un) { await doUninstall(un.dataset.uninstall); return; }

    /* ---- 浏览页卡片的本地状态 ---- */
    // 「选择要安装哪些内容」—— 多选一变体包。**点一下是勾选，不是直接装**：
    // 因为有些包里几套内容是互不相关的（主 mod + 皮肤 + 字体），要能一起装。
    const pick = t.closest('[data-pick]');
    if (pick) {
      const dir = pick.dataset.pick;
      if (dir) {
        if (!state.pick) state.pick = new Set();
        if (state.pick.has(dir)) {
          state.pick.delete(dir);
        } else {
          // 同一件东西的不同版本互斥 → 选中一个就自动取消同组其它（单选）
          const mates = state.pickGroups && state.pickGroups.get(dir);
          if (mates) for (const m of mates) if (m !== dir) state.pick.delete(m);
          state.pick.add(dir);
        }
        syncPickBar();
      }
      return;
    }

    // 跳页（已安装 / 下载）
    const gotoPage = t.closest('[data-goto-page]');
    if (gotoPage) { switchPage(gotoPage.dataset.gotoPage); return; }

    // 「已下载」→ 直接确认安装（安装包已在本地，不用再去下载页点一遍）
    const localInstall = t.closest('[data-local-install]');
    if (localInstall) {
      const taskId = localInstall.dataset.localInstall;
      if (taskId) {
        localInstall.disabled = true;
        await dlConfirm(taskId);
        await refreshCardStates();
      }
      return;
    }

    /* ---- 下载队列 ---- */
    // 文件列表里「每个文件后面那颗下载按钮」：直接把 fileId 钉死，
    // 之后 Nexus 安装助手只高亮该文件那一行，不会让用户在一堆按钮里挑。
    const dlFile = t.closest('[data-dl-file]');
    if (dlFile) {
      const d = state.drawer;
      const m = (d && d.mod) || {};
      const fileId = Number(dlFile.dataset.dlFile);
      const f = ((d && d.files) || []).find(x => Number(x.fileId) === fileId) || {};
      await dlEnqueue({
        game: 'stellarblade', modId: Number(m.modId), fileId,
        name: m.name || ('Mod #' + (m.modId || '')),
        fileName: f.name || '', fileVersion: f.version || '', fileSize: f.sizeInBytes || 0,
        author: m.author || '', version: m.version || '',
        summary: m.summary || '', image: m.image || '', pictureUrl: m.pictureUrl || '',
        images: m.images || (m.image ? [m.image] : []),
        sourceUrl: 'https://www.nexusmods.com/stellarblade/mods/' + (m.modId || '')
      }, { goto: false });
      return;
    }
    // 黑名单：「不喜欢」立刻拉黑 / 「移出黑名单」立刻恢复（都要抢在 .card 之前处理）
    const dislike = t.closest('[data-dislike]');
    if (dislike) { await dislikeMod(dislike.dataset.dislike); return; }

    const undislike = t.closest('[data-undislike]');
    if (undislike) { await undislikeMod(undislike.dataset.undislike); return; }

    // 「喜欢」👍 —— 与 👎 同一位置（卡片底部 `.acts`，紧挨下载按钮）、同为一对开关。
    // 同样必须抢在 `.card` 之前 return：否则点图标会连带打开 Mod 详情抽屉。
    const like = t.closest('[data-like]');
    if (like) { await likeMod(like.dataset.like); return; }

    const unlike = t.closest('[data-unlike]');
    if (unlike) { await unlikeMod(unlike.dataset.unlike); return; }

    const dlAdd = t.closest('[data-dl-add]');
    if (dlAdd) {
      const modId = Number(dlAdd.dataset.dlAdd);
      const d = state.drawer;
      const inDrawer = d && d.mod && Number(d.mod.modId) === modId;
      const n = (state.browse.items || []).find(x => Number(x.modId) === modId) || (inDrawer ? d.mod : {});
      const meta = {
        game: 'stellarblade', modId,
        name: n.name || ('Mod #' + modId),
        author: n.author || '', version: n.version || '',
        summary: n.summary || '', image: n.image || '', pictureUrl: n.pictureUrl || '',
        images: n.images || (n.image ? [n.image] : []),
        sourceUrl: 'https://www.nexusmods.com/stellarblade/mods/' + modId
      };
      // 抽屉里已经拿到文件列表 → 顺手钉上主文件，省掉「到页面上再挑一次」
      if (inDrawer && (d.files || []).length) {
        const f = d.files.find(x => x.primary) || d.files[0];
        meta.fileId = Number(f.fileId);
        meta.fileName = f.name || '';
        meta.fileVersion = f.version || '';
        meta.fileSize = f.sizeInBytes || 0;
      }
      await dlEnqueue(meta, { goto: false });
      return;
    }
    const dlAutoAuth = t.closest('[data-dl-autoauth]');
    if (dlAutoAuth) { await dlAutoAuthorize(dlAutoAuth.dataset.dlAutoauth); return; }
    if (t.closest('[data-dl-resumeall]')) { await dlResumeAll(); return; }
    if (t.closest('[data-dl-autoauthall]')) { await dlAutoAuthorizeAll(); return; }
    // 2026-10-14 新增：全部停止 / 一键安装全部
    if (t.closest('[data-dl-pauseall]')) { await dlPauseAll(); return; }
    if (t.closest('[data-dl-confirmall]')) { await dlConfirmAll(); return; }
    // 2026-11-07：已下载但没装（换过游戏目录 / 用户删过文件后重新出现的那批）
    if (t.closest('[data-dl-installall]')) { await dlInstallAll(); return; }
  // 管理器自带安装包（data/library）—— 队列空着也能装
  if (t.closest('[data-lib-installall]')) { await libInstallAll(); return; }
  const libOne = t.closest('[data-lib-install]');
  if (libOne) { await libInstall(libOne.dataset.libInstall); return; }
  // 卡片上的「显示更多」与「详情」（详情直接开 Nexus 抽屉，和浏览页一模一样）
  if (t.closest('[data-lib-more]')) { state.libShown = (state.libShown || 12) + 12; renderBrowse(); return; }
  const libDetail = t.closest('[data-libdetail]');
  if (libDetail) { openNexusDrawer(libDetail.dataset.libdetail); return; }
  // 「定位」：在资源管理器里把那份安装包选中（只在管理器目录里，不会乱开别的地方）
  const libReveal = t.closest('[data-libreveal]');
  if (libReveal) {
    const it = libItemOf(libReveal.dataset.libreveal);
    if (!it) { toast('这个安装包已经不在清单里了，刷新一下看看'); return; }
    try { await call(window.api.revealPath(it.archivePath), { silent: true }); }
    catch (e) { toast(e.message, 'err'); }
    return;
  }
  // 「删除」：只删管理器里的安装包文件，不动已装进游戏的内容
  const libDel = t.closest('[data-libdel]');
  if (libDel) {
    const it = libItemOf(libDel.dataset.libdel);
    if (!it) { toast('这个安装包已经不在清单里了，刷新一下看看'); return; }
    const name = it.name || it.filename;
    if (!confirm(`要从管理器里删掉这个安装包吗？\n\n${name}\n${fmtSize(it.size)}\n\n只删管理器里的这一份安装包，已经装进游戏的文件不受影响。`)) return;
    try {
      await call(window.api.download.removeArchive(it.archivePath));
      await refreshLibrary();
      await refreshDownloads();
      if (state.browse.onlyDownloaded) renderBrowse(); else renderDownload();
      toast('已删除安装包：' + fmtSize(it.size), 'ok');
    } catch (e) { toast(e.message, 'err'); }
    return;
  }
  // 下载页那条提示：跳到「浏览 Mod」并把「已下载」筛选打开
  if (t.closest('[data-lib-goto]')) {
    state.browse.onlyDownloaded = true;
    state.browse.onlyUninstalled = false;
    switchPage('p-browse');
    syncOnlyTabs();
    await refreshLibrary();
    renderBrowse();
    return;
  }
    const dlAuth = t.closest('[data-dl-auth]');
    if (dlAuth) { await dlAuthorize(dlAuth.dataset.dlAuth); return; }
    const dlStartBtn = t.closest('[data-dl-start]');
    if (dlStartBtn) { await dlStart(dlStartBtn.dataset.dlStart); return; }
    const dlCancelBtn = t.closest('[data-dl-cancel]');
    if (dlCancelBtn) { await dlCancel(dlCancelBtn.dataset.dlCancel); return; }
    const dlPauseBtn = t.closest('[data-dl-pause]');
    if (dlPauseBtn) { await dlPause(dlPauseBtn.dataset.dlPause); return; }
    const dlConfirmDefaultBtn = t.closest('[data-dl-confirmdefault]');
    if (dlConfirmDefaultBtn) { await dlConfirmDefault(dlConfirmDefaultBtn.dataset.dlConfirmdefault); return; }
    const dlConfirmBtn = t.closest('[data-dl-confirm]');
    if (dlConfirmBtn) { await dlConfirm(dlConfirmBtn.dataset.dlConfirm); return; }
    const dlPurgeBtn = t.closest('[data-dl-purge]');
    if (dlPurgeBtn) { dlPurge(dlPurgeBtn.dataset.dlPurge); return; }
    const dlRemoveBtn = t.closest('[data-dl-remove]');
    if (dlRemoveBtn) { await dlRemove(dlRemoveBtn.dataset.dlRemove); return; }
    const dlRevealBtn = t.closest('[data-dl-reveal]');
    if (dlRevealBtn) { await dlReveal(dlRevealBtn.dataset.dlReveal); return; }
    const dlOpen = t.closest('[data-dl-open]');
    if (dlOpen) { openDownloadDrawer(dlOpen.dataset.dlOpen); return; }
    // 「查看会被覆盖的 N 个文件明细」→ 打开抽屉并滚到那一段
    const dlCf = t.closest('[data-dl-conflicts]');
    if (dlCf) {
      openDownloadDrawer(dlCf.dataset.dlConflicts);
      const box = $('#dlConflicts');
      if (box) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    // Mod 库：顶部状态 chip / 标记 chip（用户 2026-11-10：一套界面管三种状态）
    const libSt = t.closest('[data-libst]');
    if (libSt) { setLibStatus(libSt.dataset.libst); return; }
    const libMk = t.closest('[data-libmk]');
    if (libMk) { toggleLibMark(libMk.dataset.libmk); return; }
    // UE4SS 自带脚本的显示开关（与原「已安装」页那颗 data-showbuiltin 同一个 state）
    if (t.closest('[data-libbuiltin]')) {
      state.showBuiltin = !state.showBuiltin;
      try { window.api.config.set({ showBuiltin: !!state.showBuiltin }); } catch (err) { /* 存不上不影响本次 */ }
      renderBrowse();
      return;
    }
    // 「已验证」开关（卡片、Nexus 抽屉、已安装抽屉都用同一颗）
    const libVer = t.closest('[data-libver]');
    if (libVer) { e.stopPropagation(); await toggleVerified(libVer.dataset.libver, libVer.dataset.vername || ''); return; }
    const gver = t.closest('[data-gver]');
    if (gver) { e.stopPropagation(); await doVerifyToggleGroup(gver.dataset.gver); return; }
    if (t.closest('[data-dl-cleardone]')) { await dlClearDone(); return; }
    if (t.closest('[data-dl-refreshplans]')) { await dlRefreshPlans(); return; }

    const card = t.closest('.card');
    if (card) {
      const lkey = card.dataset.lkey || '';
      // 多选模式：点卡片 = 勾选/取消，不弹详情抽屉（要下载的那颗按钮仍单独生效）
      if (state.sel.on) {
        if (lkey) { libClickSelect(lkey, e); return; }
        if (card.dataset.modid) { selClick(card.dataset.modid, e); return; }
        return;
      }
      if (lkey) { libOpenRecord(lkey); return; }
      if (card.dataset.modid) openNexusDrawer(Number(card.dataset.modid));
      else if (card.dataset.gid) {
        // 已安装页：一张卡 = 一个 Mod（同 Mod ID 的多个文件已合并），点开看它装了哪几个文件
        const g = groupOf(card.dataset.gid);
        if (g) openInstalledDrawer(g);
      }
      return;
    }
  });

  // nxm 安装抽屉 / 安装抽屉 / 模态框
  document.addEventListener('click', async (e) => {
    const mb = e.target.closest('[data-mbtn]');
    if (mb) {
      const id = mb.dataset.mbtn;
      if (id === 'impCancel' || id === 'vCancel') closeModal();
      else if (id === 'pCancel') { purgeTaskId = null; closeModal(); }
      else if (id === 'pPurge') await dlPurgeConfirmed();
      else if (id === 'cmpClose') closeModal();
      else if (id === 'cmpGo') {
        // 「查看被替换的文件」→ 滚回下载卡片，把冲突明细露出来
        const taskId = state.modalTask;
        closeModal();
        if (taskId) {
          await refreshDownloads();
          const safeId = (window.CSS && CSS.escape) ? CSS.escape(String(taskId)) : String(taskId);
          const card = document.querySelector(`.dl-item[data-dlid="${safeId}"] [data-dl-conflicts]`);
          if (card) {
            card.scrollIntoView({ block: 'center' });
            toast('卡片上「查看会被覆盖的 N 个文件明细」就是这些，点任意一行可定位');
          }
        }
      }
      else if (id === 'vInstall') {
        const taskId = state.modalTask;
        const dirs = [...(state.pick || [])];
        closeModal();
        if (taskId && dirs.length) await installWithPick(taskId, dirs);
      }
      else if (id === 'impGo') await parseAndInstall($('#impUrl') && $('#impUrl').value);

      // ---- 「有 bug」标记的安装前提示 ----
      else if (id === 'bugSkipAll' || id === 'bugKeepAll' || id === 'bugCancel') {
        const c = bugSkipCtx;
        bugSkipCtx = null;
        closeModal();
        if (c) {
          if (id === 'bugSkipAll') c.onSkip();
          else if (id === 'bugKeepAll') c.onAll();
          else c.onCancel();
        }
      }

      // ---- 数据目录搬运向导 ----
      else if (id === 'ddCancel') { ddPending = null; closeModal(); }
      else if (id === 'ddMove') await runDataMigrate('move', false);
      else if (id === 'ddCopy') await runDataMigrate('copy', false);
      else if (id === 'ddOver') await runDataMigrate('move', true);
      else if (id === 'ddKeep') await runDataMigrate('copy', false);
      else if (id === 'ddUse') {
        // ⚠️ 「不搬」在两个向导里含义不同：
        //    更改位置 = 换成用户刚选的那个目录；恢复默认 = 回到默认目录（指针文件删掉）。
        const p = ddPending || {};
        ddPending = null;
        closeModal();
        await applyDataDir(p.restore ? '' : p.to);
      }
      else if (id === 'ddRelaunch') { closeModal(); window.api.data.relaunch(); }
      else if (id === 'ddLater') { closeModal(); await refreshDataDirLine(); }
      else if (id === 'impPick') await pickLocalArchive();
      else if (id === 'vReveal') { if (state.modalTask) await dlReveal(state.modalTask); closeModal(); }

      // ---- 批量解析 ----
      else if (id === 'lStart') await runLinkerResolve(false);
      else if (id === 'lRestart') await runLinkerResolve(false);
      else if (id === 'lCancel') {
        try { await window.api.linker.cancel(); } catch { /* 已经结束就别管 */ }
      }
      else if (id === 'lApply') await applyLinkerChoices();
      else if (id === 'lClose') closeLinkerModal();
      // ---- 已安装记录搬移 ----
      else if (id === 'rlGo') await applyRelocationNow();
      else if (id === 'rlClose') closeModal();
      return;
    }
    if (e.target.id === 'nxmClose') { closeDrawer(); return; }
    if (e.target.id === 'nxmStart') { await startNxmDownload(); return; }
    if (e.target.id === 'nxmAbort') {
      try { await window.api.nxm.cancel(); toast('已请求取消，正在清理临时文件…'); } catch { /* 已提示 */ }
      return;
    }

    // ---- 安装抽屉 ----
    if (e.target.id === 'nxmInstall') {
      const d = state.nxm.downloaded;
      if (!d) { toast('没有可安装的安装包', 'err'); return; }
      await openInstallDrawer(d.path, d.meta);
      return;
    }
    if (e.target.id === 'instClose') { closeDrawer(); return; }
    if (e.target.id === 'instRun') { await runInstall(); return; }
    if (e.target.id === 'instPick') {
      try {
        const dir = await call(window.api.install.pickTarget(), { silent: true });
        if (!dir) return;
        state.install.manualTarget = dir;
        renderInstallPlan();
      } catch { /* 已提示 */ }
      return;
    }
    if (e.target.id === 'instGoList') {
      closeDrawer();
      switchPage('p-installed');
      return;
    }
    if (e.target.id === 'instGoCns') {
      closeDrawer();
      switchPage('p-prereq');
      toast('先把 CNS 装好，再回来装这个服装 Mod');
      return;
    }
  });

  // 设置页的按钮
  document.addEventListener('click', async (e) => {
    if (e.target.id === 'btnSaveRoot') {
      const v = $('#setGameRoot').value.trim();
      await doSetRoot(v);
    } else if (e.target.id === 'btnDetect') {
      try {
        const r = await call(window.api.game.detect());
        if (!r.candidates.length) toast('没有探测到剑星目录，请手动填写', 'err');
        else toast('探测到：' + r.candidates.join('  |  '));
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnOpenGameRoot') {
      // 成功不弹提示：资源管理器自己就是反馈；失败由 call() 把主进程的人话弹出来
      try { await call(window.api.game.openRoot()); } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnOpenModsDir') {
      try { await call(window.api.game.openModsDir()); } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnLedgerCheck') {
      await checkRelocation();
    } else if (e.target.id === 'btnLedgerExport') {
      try {
        const r = await call(window.api.game.ledgerExport());
        toast(`已写入游戏目录：${fmtNum(r.count)} 条`, 'ok');
        refreshLedgerBox();
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnLedgerImport') {
      try {
        const r = await call(window.api.game.ledgerImport());
        toast(r.added ? `从账本恢复 ${fmtNum(r.added)} 条` : '账本里没有新记录', 'ok');
        refreshLedgerBox();
        await refreshAll();
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnReconcile') {
      const btn = e.target;
      btn.disabled = true;
      try {
        const r = await call(window.api.mods.reconcile());
        const line = $('#reconcileLine');
        const changed = !!(r.dropped || r.trimmed || r.flagged);
        if (line) {
          line.textContent = changed
            ? `按磁盘核对：移除 ${fmtNum(r.dropped)} 条、裁剪 ${fmtNum(r.trimmed)} 条、纠正开关 ${fmtNum(r.flagged)} 条`
            : `账本与磁盘一致（${fmtNum(r.kept)} 条）`;
        }
        if (changed) {
          toast(`按磁盘核对：移除 ${fmtNum(r.dropped)} 条、裁剪 ${fmtNum(r.trimmed)} 条、纠正开关 ${fmtNum(r.flagged)} 条`, r.dropped ? 'err' : 'ok');
          await refreshAll();
        } else {
          toast(`账本与磁盘一致（${fmtNum(r.kept)} 条）`, 'ok');
        }
        refreshLedgerBox();
      } catch { /* 已提示 */ } finally { btn.disabled = false; }
    } else if (e.target.id === 'btnLibChoose') {
      try {
        const dir = await call(window.api.download.libraryChoose({ defaultPath: (state.libDir && state.libDir.dir) || '' }));
        if (!dir) return;
        const r = await call(window.api.download.librarySetDir(dir));
        toast('安装包目录已改为：' + r.dir + '\n重启管理器后生效', 'ok');
        refreshLibDirBox();
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnLibOpen') {
      try {
        const d = state.libDir && state.libDir.dir;
        if (!d) { toast('还读不到安装包目录', 'err'); return; }
        await call(window.api.openPath(d));
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnLibReset') {
      if (!confirm('把安装包目录恢复成默认（管理器数据目录下的 library）？\n\n已经下载的包不会删，只是不再看那个自定义目录。')) return;
      try {
        const r = await call(window.api.download.librarySetDir(''));
        toast('已恢复默认：' + r.dir + '\n重启管理器后生效', 'ok');
        refreshLibDirBox();
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnSaveKey') {
      try {
        await call(window.api.config.set({ nexusApiKey: $('#setApiKey').value.trim() }));
        toast('已保存 API Key', 'ok');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnClearTrans') {
      try { await call(window.api.translate.clear()); toast('翻译缓存已清空', 'ok'); renderSettings(); } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnClearNexus') {
      try { await call(window.api.nexus.clearCache()); toast('接口缓存已清空', 'ok'); } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnNexusLogin') {
      try {
        await call(window.api.nexus.login());
        toast('已打开登录窗口，登录完成后会自动识别');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnBrowserLogin') {
      try {
        await call(window.api.openExternal('https://users.nexusmods.com/auth/sign_in'));
        toast('已用系统浏览器打开 Nexus 登录页，登录后可获取 API Key', 'ok');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnNexusVerify') {
      toast('正在确认登录状态…');
      try {
        const r = await call(window.api.nexus.authVerify());
        if (r.ok) {
          state.auth = await call(window.api.nexus.authStatus(), { silent: true });
          renderAuthLine();
          toast('已登录' + (r.user ? '：' + r.user : ''), 'ok');
        } else {
          state.auth = await call(window.api.nexus.authStatus(), { silent: true });
          renderAuthLine();
          toast('未登录：' + (r.reason || '请在登录窗口中完成登录'), 'err');
        }
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnNexusLogout') {
      if (!confirm('确定退出 Nexus 登录吗？\n\n将清空管理器内保存的登录会话（不影响你浏览器里的登录）。')) return;
      try {
        await call(window.api.nexus.logout());
        state.auth = await call(window.api.nexus.authStatus(), { silent: true });
        renderAuthLine();
        toast('已退出登录', 'ok');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnFetchKey') {
      toast('正在从账号页读取 API Key…');
      try {
        const r = await call(window.api.nexus.fetchApiKey());
        if (r.ok) {
          state.config = await call(window.api.config.get(), { silent: true });
          const inp = $('#setApiKey');
          if (inp) inp.value = r.key;
          toast('已自动填入 API Key，记得点「保存」', 'ok');
        } else {
          toast('没读到：' + (r.reason || '请手动复制'), 'err');
        }
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnNxmRegister') {
      try {
        const r = await call(window.api.nxm.register());
        await refreshNxmStatus();
        toast(r.registered ? '已注册 nxm:// 处理器，网页上点按钮即可调起本程序' : '注册失败，请检查系统权限', r.registered ? 'ok' : 'err');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnNxmUnregister') {
      try {
        await call(window.api.nxm.unregister());
        await refreshNxmStatus();
        toast('已取消 nxm:// 注册', 'ok');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnNxmParse') {
      await parseAndInstall($('#setNxmUrl') && $('#setNxmUrl').value);
    } else if (e.target.id === 'btnLocalInstall') {
      await pickLocalArchive();
    } else if (e.target.id === 'btnInstToolRefresh') {
      await refreshInstallTools();
      const t = state.installTools;
      toast(t && t.available ? '解压工具可用：' + t.label : '没找到可用的解压工具，请安装 7-Zip', t && t.available ? 'ok' : 'err');
    } else if (e.target.id === 'btnOpenData') {
      window.api.openPath(state.dataDir);
    } else if (e.target.id === 'btnChangeData') {
      await changeDataDir();
    } else if (e.target.id === 'btnRestoreData') {
      await restoreDataDir();
    } else if (e.target.id === 'btnViewLog') {
      await openLogViewer();
    } else if (e.target.id === 'btnOpenLogDir') {
      window.api.log.openDir();
    } else if (e.target.id === 'btnResetCfg') {
      try { state.config = await call(window.api.config.reset()); toast('已恢复默认设置', 'ok'); renderSettings(); } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnWatchScan') {
      try {
        const r = await call(window.api.watch.scanNow(), { silent: true });
        toast(r.found ? `扫描到 ${r.found} 个新压缩包，已导入下载队列` : '没有发现新的压缩包', r.found ? 'ok' : '');
        await refreshWatchLine();
        await refreshDownloads();
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnWatchIgnore') {
      try {
        const r = await call(window.api.watch.ignoreExisting(), { silent: true });
        toast(`已把 ${r.ignored} 个现有压缩包记为「已见」，不再提示`, 'ok');
        await refreshWatchLine();
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnWatchAddDir') {
      try {
        const r = await call(window.api.watch.addDir(), { silent: true });
        if (r) { await refreshWatchLine(); toast('已添加监听目录', 'ok'); }
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'btnSaveMirror') {
      try {
        const mv = $('#setGithubMirror') ? $('#setGithubMirror').value : '';
        await call(window.api.watch.set({ mirror: mv }), { silent: true });
        state.config = await call(window.api.config.get(), { silent: true });
        toast('镜像前缀已保存', 'ok');
      } catch { /* 已提示 */ }
    }  });

  document.addEventListener('change', async (e) => {
    // 批量解析复核表里的勾选框 —— 只刷新底部计数，不重绘列表（省得刚点的框闪一下）
    const lchkEl = e.target.closest && e.target.closest('[data-lchk]');
    if (lchkEl) {
      const row = linkerUI.rows.find(r => r.localId === lchkEl.dataset.lchk);
      if (row) row.on = !!lchkEl.checked;
      const foot = $('#mFoot');
      if (foot) foot.innerHTML = linkerFootHtml();
      return;
    }

    // 批量解析复核表里的候选下拉框（含「搜索其他 Mod…」那一项）
    const lselEl = e.target.closest && e.target.closest('[data-lsel]');
    if (lselEl) {
      const localId = lselEl.dataset.lsel;
      const row = linkerUI.rows.find(r => r.localId === localId);
      if (lselEl.value === '__search') {
        // 先把当前勾选状态存下来，再切到搜索视图
        linkerSyncFromDom();
        lselEl.value = row && row.sel && row.sel.modId ? String(row.sel.modId) : '';
        linkerUI.search = { localId, query: (row && row.localName) || '', results: [], busy: false, searched: false };
        linkerPaint();
        // 打开就能直接搜：名字里的编号/后缀基本没用，先用清洗过的本地名试一次
        runLinkerSearch(localId, (row && row.normalized) || (row && row.localName) || '');
        return;
      }
      if (row) {
        const modId = Number(lselEl.value);
        if (!modId) { row.sel = null; row.on = false; }
        else {
          const hit = (row.candidates || []).find(c => Number(c.modId) === modId)
            || (row.sel && Number(row.sel.modId) === modId ? row.sel : null);
          row.sel = hit ? { ...hit, modId } : { modId, name: '', pictureUrl: '' };
        }
      }
      linkerPaint();
      return;
    }

    // 已安装页的类型筛选（下拉框）—— 值变化就重画，勾选保持不动
    if (e.target.id === 'instKind') {
      state.instFilters.kind = e.target.value || '';
      renderInstalled();
      return;
    }

    if (e.target.id === 'setUiLang') {
      // 界面语言：不走 IPC，纯前端的事（存 localStorage，下次启动自己读）。
      // 重刷交给 main() 里注册的 onChange —— 一处收口，别的地方调 setLang 也生效。
      if (!window.I18N) return;
      window.I18N.setLang(e.target.value);
      toast(window.I18N.t('切换后立即生效'), 'ok');
    } else if (e.target.id === 'setLang') {
      try { state.config = await call(window.api.config.set({ targetLang: e.target.value })); toast('已切换目标语言', 'ok'); } catch { /* 已提示 */ }
    } else if (e.target.id === 'setAutoAuth') {
      try {
        const on = e.target.value === '1';
        state.config = await call(window.api.config.set({ autoAuthorize: on }));
        toast(on ? '已开启自动授权：新任务加入队列即下载' : '已改为手动授权：每条任务需点一次「自动授权」', 'ok');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'setBackend') {
      try { state.config = await call(window.api.config.set({ translateBackend: e.target.value })); } catch { /* 已提示 */ }
    } else if (e.target.id === 'setRememberFilters') {
      // 「记住筛选条件」：只管开关，不删已存的快照 ——
      // 关掉 = 下次启动不再套用、之后也不再保存；再打开时上次的记录还在。
      try {
        const on = e.target.value === '1';
        state.config = await call(window.api.config.set({ rememberFilters: on }));
        toast(on ? '已开启：下次启动自动套用上次的筛选条件' : '已关闭：每次启动都用默认筛选', 'ok');
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'setWatchEnabled') {
      try {
        const on = e.target.value === '1';
        await call(window.api.watch.set({ enabled: on }), { silent: true });
        state.watch = { ...(state.watch || {}), enabled: on };
        toast(on ? '已开启下载目录监听' : '已关闭下载目录监听', 'ok');
        await refreshWatchLine();
      } catch { /* 已提示 */ }
    } else if (e.target.id === 'setWatchAuto') {
      try {
        const on = e.target.value === '1';
        await call(window.api.watch.set({ autoInstall: on }), { silent: true });
        state.watch = { ...(state.watch || {}), autoInstall: on };
        toast(on ? '监听到的包会自动安装（有覆盖冲突时仍会停下来问你）' : '监听到的包只导入，等你在下载页确认', 'ok');
      } catch { /* 已提示 */ }
    }
  });
}

async function doSetRoot(root) {
  try {
    const g = await call(window.api.game.setRoot(root));
    const rl = g && g.relocation;
    if (g) delete g.relocation;
    state.game = g;
    state.config = await call(window.api.config.get());
    await refreshAll();
    toast('游戏目录已设置', 'ok');
    if (rl && (rl.applied || rl.imported)) {
      const parts = [];
      if (rl.imported) parts.push(`从游戏目录账本恢复 ${fmtNum(rl.imported)} 条`);
      if (rl.applied) parts.push(`对齐 ${fmtNum(rl.applied)} 条已安装记录`);
      toast('账本已跟随新目录：' + parts.join('，'), 'ok');
    }
  } catch { /* 已提示 */ }
}

/* ---------------- 已安装记录（账本 + 搬移修复） ----------------
 *
 * 用户的真实场景：把整个游戏文件夹从 `D:\games\Star Blade` 挪到 `c:\Star Blade`。
 * 打开管理器时 `app:bootstrap` 已经自动对齐过一轮，这里的按钮是留给
 * 「自动没敢动」的情况 —— 比如新位置只拷了一半文件，那几条得人来判断。
 */

/**
 * 「数据文件在哪」—— 配置/账本现在跟着游戏走，得让用户看得见到底落在哪。
 * 两种情况：已经切到游戏目录（source='game'）；或者本会话还在管理器目录、
 * 下次启动才会切过去（第一次识别到游戏目录的那一次）。
 */
function refreshDataHomeLine() {
  const el = $('#dataHomeLine');
  if (!el) return;
  const h = state.dataHome || {};
  const dir = String(h.dataDir || '');
  if (!dir) { el.textContent = '还没设置游戏目录'; return; }
  const label = h.source === 'game'
    ? '游戏目录（跟着游戏走）：'
    : '暂存在管理器目录，下次启动会切换到游戏目录：';
  el.innerHTML = esc(label) + `<span data-i18n-skip style="font-family:ui-monospace,Consolas,monospace">${esc(dir)}</span>`;
}

/* ---------------- 安装包目录 ---------------- */
/**
 * 显示「安装包目录」，并说清楚里面有几百个包、其中多少还能装。
 *
 * 用户遇到过的困惑：打包版默认目录是 `%APPDATA%\剑星 Mod 管理器\data\library`，
 * 而他攒包的目录是别的盘 —— 界面上没有任何地方写着「我在看哪个目录」，
 * 于是看起来就像「识别不到」。这里把路径和盘点的数字直接摆出来。
 */
async function refreshLibDirBox() {
  const dirLine = $('#libDirLine');
  const statLine = $('#libStatLine');
  if (!dirLine || !statLine) return;
  try {
    const d = await call(window.api.download.libraryInfo(), { silent: true });
    state.libDir = d;
    const isCustom = !!(d.configured && d.configured === d.dir);
    dirLine.innerHTML = `<span data-i18n-skip style="font-family:ui-monospace,Consolas,monospace">${esc(d.dir || '')}</span>`;
    dirLine.innerHTML += isCustom
      ? ' <span class="tag">自定义</span>'
      : ' <span class="tag">默认</span>';
    if (!d.exists) {
      statLine.textContent = '这个目录不存在（点「恢复默认」或换个目录）';
      return;
    }
    const mb = d.size ? fmtSize(d.size) : '0 B';
    statLine.textContent = `${fmtNum(d.total)} 个包 · ${mb} · 其中 ${fmtNum(d.installable)} 个还没装进当前游戏目录`;
  } catch (e) {
    dirLine.textContent = '读取失败：' + (e && e.message ? e.message : '');
    statLine.textContent = '';
  }
}

async function refreshLedgerBox() {
  const line = $('#ledgerLine');
  if (!line) return;
  try {
    const d = await call(window.api.game.ledger());
    state.ledger = d;
    if (!d.root) { line.textContent = '还没设置游戏目录'; return; }
    if (!d.exists) {
      line.textContent = `管理器里 ${fmtNum(d.registryCount)} 条 · 游戏目录里还没有账本`;
      return;
    }
    const when = d.writtenAt ? ` <span data-i18n-skip>（${esc(fmtDate(d.writtenAt))}）</span>` : '';
    line.innerHTML = esc(`管理器里 ${fmtNum(d.registryCount)} 条 · 游戏目录里 ${fmtNum(d.count)} 条`) + when
      + (d.sameRoot ? '' : ' <span style="color:var(--accent)">游戏目录与账本记录的不一致</span>');
  } catch (e) {
    line.textContent = '读取失败：' + (e.message || e);
  }
}

/** 试算搬移：能对上的给出条数，对不上的列出来（绝不静默改） */
async function checkRelocation() {
  try {
    const p = await call(window.api.game.relocate());
    if (!p.total) { toast('还没有安装记录', 'ok'); return; }
    if (!p.fixable && !p.missing) { toast('所有记录都指向当前游戏目录（无需修复）', 'ok'); return; }
    const head = p.fixable
      ? `<p>可以把 ${fmtNum(p.fixable)} 条记录从旧目录改到当前目录（涉及 ${fmtNum(p.files)} 个文件，已逐个核对文件确实存在）。</p>`
      : '<p>没有可自动对齐的记录。</p>';
    const paths = p.oldRoot
      ? `<p class="txt">旧目录：<code>${esc(p.oldRoot)}</code><br>当前目录：<code>${esc(p.newRoot)}</code></p>`
      : '';
    const miss = p.missing
      ? `<p class="txt" style="color:var(--accent)">另有 ${fmtNum(p.missing)} 条找不到对应文件（可能没拷全），这些保持原样不动。</p>`
      : '';
    openModal('检查已安装记录', `<div class="lintro">${head}${paths}${miss}</div>`, [
      { id: 'rlGo', label: `修复 ${fmtNum(p.fixable)} 条`, primary: !!p.fixable },
      { id: 'rlClose', label: '关闭' }
    ]);
  } catch { /* 已提示 */ }
}

async function applyRelocationNow() {
  try {
    const r = await call(window.api.game.relocateApply());
    closeModal();
    toast(r.applied ? `已对齐 ${fmtNum(r.applied)} 条记录（文件未改动）` : '没有需要修改的记录', 'ok');
    await refreshAll();
  } catch { /* 已提示 */ }
}

async function doToggle(id) {
  const m = state.installed.find(x => x.id === id);
  if (!m) return;
  try {
    await call(window.api.mods.setEnabled(id, !m.enabled));
    toast(m.enabled ? '已禁用（文件重命名为 .disabled）' : '已启用', 'ok');
    await refreshAll();
  } catch { /* 已提示 */ }
}

/**
 * 合并卡片上那颗小开关 / 抽屉底部那颗「全部启用·全部禁用」——
 * 作用于**这个 Mod 当前已安装的全部文件**。
 *
 * 三态语义（与 `installedCard()` 里那个 `sw` 的 `part` 类对应）：
 *   · 全部禁用（`enabled=false, partial=false`）→ 全部启用
 *   · 部分启用（`partial=true`）              → 全部启用（补齐剩下的）
 *   · 全部启用（`enabled=true, partial=false`）→ 全部禁用
 * 所以判定必须是 `g.partial || !g.enabled`，**不能只写 `!g.enabled`** ——
 * 部分启用时 `enabled` 已经是 true，会错成「全部禁用」，而按钮的 tooltip
 * 明写着「点击全部启用」，点了做反事最难排查。
 */
async function doToggleGroup(key) {
  const g = groupOf(key);
  if (!g) return;
  // 前置组件不吃开关（主进程会抛「前置组件不支持禁用」）
  const items = (g.items || []).filter(m => m.kind !== 'prereq');
  if (!items.length) return;
  const target = g.partial || !g.enabled;
  try {
    for (const m of items) {
      if (!!m.enabled !== target) await call(window.api.mods.setEnabled(m.id, target));
    }
    toast(target ? `已启用 ${items.length} 个文件` : `已禁用 ${items.length} 个文件`, 'ok');
    await refreshAll();
  } catch { /* call() 已提示 */ }
  reopenInstalledDrawer(key);
}

/**
 * 切换「这个 Mod 有 bug」标记（用户 2026-11-09：卸载旁边加一颗按钮，
 * 「用于标记有问题的 mod 避免再次安装时影响游戏」）。
 *
 * 这**不是**黑名单：黑名单是「不想再看见」，浏览页直接隐藏；
 * 有 bug 标记是「它也许哪天能修好，我还会看它，但别再装进游戏」——
 * 所以浏览页照常显示，只在**安装路径**上拦一道（批量安装先问一句）。
 *
 * 认人只靠 Nexus modId（标记要在游戏目录里跟着走，不能存 pak 名 ——
 * 用户换了文件名 / 重装一次就对不上了）。
 */
async function doBugToggleGroup(key) {
  const g = groupOf(key);
  if (!g) return;
  const meta = g.meta || {};
  const src = meta.source || {};
  const modId = Number(g.modId || src.modId || meta.modId || 0) || 0;
  if (!modId) {
    toast('这个 Mod 没有 Nexus Mod ID，没法标记（标记靠 Mod ID 认人）', 'warn');
    return;
  }
  const on = state.bugIds.has(String(modId));
  try {
    if (on) await call(window.api.bugs.remove(modId));
    else await call(window.api.bugs.add(modId, { name: g.name }));
  } catch { return; /* call() 已经提示过了 */ }
  await loadBugs();
  toast(on
    ? `已取消「有 bug」标记：${g.name}`
    : `已标记有 bug：${g.name} —— 批量安装前会先问你要不要跳过`, on ? 'ok' : 'warn');
  await refreshAll();
  reopenInstalledDrawer(key);
}

/** 逐个卸载整个 Mod —— 组里每一文件各调一次 `mods:uninstall`（主进程按单条 id 定位） */
async function doUninstallGroup(key) {
  const g = groupOf(key);
  if (!g) return;
  const items = (g.items || []).filter(m => m.kind !== 'prereq');
  if (!items.length) return;
  const files = items.flatMap(m => m.files || []);
  const n = items.length;
  const okDel = confirm(
    `确定卸载「${g.name}」吗？\n\n` +
    (n > 1 ? `这个 Mod 装了 ${n} 个文件。` : '') +
    `将被移除的文件（${files.length} 个）：\n` +
    files.slice(0, 8).map(f => '  · ' + f.name).join('\n') +
    (files.length > 8 ? `\n  … 等共 ${files.length} 个` : '') +
    `\n\n文件不会直接删除，而是移动到：\n  data\\backup\\uninstalled\\\n可以手动找回。`
  );
  if (!okDel) return;
  let restored = [];
  let failed = 0;
  for (const m of items) {
    try {
      const r = await call(window.api.mods.uninstall(m.id, { purge: false }));
      if (r && r.restored) restored = restored.concat(r.restored);
    } catch { failed++; }   // 单条失败不中断，最后统一报数
  }
  const extra = restored.length ? `，并还原了 ${restored.length} 个被覆盖的原文件` : '';
  // ⚠️ 两条 toast 各自**单独成形**（别把成败拼进同一句）：
  //    「已卸载 2 / 3 个文件，有 1 个失败」这种多数字混拼在 i18n 里
  //    只能靠形状键整句登记，语序一变就拼不回去。拆开各自成句最省事。
  if (failed) toast(`已卸载 ${n - failed} / ${n} 个文件，有 ${failed} 个失败`, 'err');
  else toast(`已卸载 ${n} 个文件${extra}，文件已备份到 data\\backup\\uninstalled\\`, 'ok');
  closeDrawer();
  await refreshAll();
}

/**
 * 解除整组关联（抽屉底部「解除关联」）。
 *
 * 只删 `data/mod-links.json` 里对应的记录，磁盘文件一个都不动 ——
 * 解完之后这条 Mod 回到「未登记」，卡片上的封面/作者随之消失，仅此而已。
 */
async function doUnlinkGroup(key) {
  const g = groupOf(key);
  if (!g) return;
  const ids = (g.items || []).map(m => m.id).filter(Boolean);
  if (!ids.length) return;
  const okUn = confirm(
    `解除「${g.name}」与 Nexus 的关联吗？\n\n` +
    '只忘掉「它是 Nexus 上的哪个 Mod」，磁盘上的文件不会被改动，也不会卸载。\n' +
    '下次批量解析时它还会被重新比对。'
  );
  if (!okUn) return;
  let removed = 0;
  for (const id of ids) {
    try {
      const r = await call(window.api.linker.unlink(id), { silent: true });
      removed += (r && r.removed) || 0;
    } catch { /* 单条失败不中断 */ }
  }
  closeDrawer();
  toast(removed ? `已解除 ${removed} 条关联（文件未改动）` : '没有找到可解除的关联', removed ? 'ok' : 'warn');
  await refreshAll();
}

/**
 * 逐文件操作之后，如果抽屉还开在同一组上就**重建**它，
 * 让按钮文案（启用/禁用）、状态行、文件条数立刻反映新状态。
 * 组已经不存在（最后一个文件被卸掉）就顺手关上。
 */
function reopenInstalledDrawer(key) {
  const d = state.drawer;
  if (!d || !d.open || d.kind !== 'installed') return;
  const want = key || (d.mod && d.mod.key);
  const g = want ? groupOf(want) : null;
  if (g) openInstalledDrawer(g); else closeDrawer();
}

/**
 * 卸载一条 installed 记录。
 * `keepDrawer`：逐文件卸载时用 —— 关掉再重开会让用户「点着点着抽屉没了」，
 * 所以此时不关抽屉；全部卸完 `reopenInstalledDrawer()` 会自己收尾。
 */
async function doUninstall(id, { keepDrawer = false } = {}) {
  const m = state.installed.find(x => x.id === id);
  if (!m) return;
  const okDel = confirm(
    `确定卸载「${m.name}」吗？\n\n` +
    `将被移除的文件（${m.fileCount} 个）：\n` +
    m.files.slice(0, 8).map(f => '  · ' + f.name).join('\n') +
    (m.files.length > 8 ? `\n  … 等共 ${m.files.length} 个` : '') +
    `\n\n文件不会直接删除，而是移动到：\n  data\\backup\\uninstalled\\\n可以手动找回。`
  );
  if (!okDel) return;
  try {
    const r = await call(window.api.mods.uninstall(id, { purge: false }));
    const extra = (r.restored && r.restored.length)
      ? `，并还原了 ${r.restored.length} 个被覆盖的原文件` : '';
    toast(`已卸载${extra}，文件已备份到 ${r.backupDir}`, 'ok');
    if (!keepDrawer) closeDrawer();
    await refreshAll();
    if (keepDrawer) reopenInstalledDrawer();
  } catch { /* 已提示 */ }
}

/* ---------------- 刷新 ---------------- */

/** 顶栏「启动游戏」按钮的可用状态：没游戏目录就置灰并说明原因 */
function syncLaunchBtn() {
  const btn = $('#btnLaunch');
  if (!btn) return;
  const ok = !!(state.game && state.game.found);
  btn.disabled = !ok;
  // 版本号不放 title 里：i18n 会重写 title 属性，写进去也留不住；顶栏有专门那枚 chip
  btn.title = ok
    ? '直接启动游戏（不走 Steam，绿色版 / Steam / Epic 都行）'
    : '还没设置游戏目录，先到设置里选一下';
}

/** 顶栏按钮右边那枚小版本号：没有版本就整块藏起来，不留一个空壳 */
function syncGameVerChip(ver) {
  const el = $('#gameVer');
  if (!el) return;
  const v = String(ver || '');
  el.textContent = v ? 'v' + v : '';
  el.style.display = v ? '' : 'none';
}

async function refreshAll(showToast) {
  try {
    const data = await call(window.api.bootstrap());
    state.config = data.config;
    state.game = data.game;
    state.installed = data.installed;
    state.auth = data.auth;
    state.dataDir = data.dataDir;
    state.downloads = data.downloads || [];
    state.downloadStats = data.downloadStats || {};
    if (data.watch) state.watch = data.watch;
    state.relocation = data.relocation || null;
  state.dataHome = data.dataHome || null;
    syncLaunchBtn();
    $('#verLine').textContent = 'v' + data.version + (data.packaged ? '' : ' · dev');
    // 启动后第一次拿到配置：把上次的筛选条件套回来（设置页开关关掉时 `applyLastFilters()` 自己返回）。
    // 只做一次 —— 之后 refreshAll 再被调用（手动刷新 / 装完 Mod）都不会重套，
    // 否则用户刚刚改的筛选会被一个刷新按钮顶回去。
    // 放在 renderInstalled() 之前，是为了让已安装页那一趟就按恢复后的排序与开关来画。
    if (!filtersApplied) {
      filtersApplied = true;
      const before = JSON.stringify(browseFilterSnapshot());
      applyLastFilters();
      syncBrowseFilterUI();
      filtersReady = true;   // 恢复完成，此后才允许 saveFilters 落盘
      // 首屏的 switchPage 可能已经用默认筛选拉过一轮了，筛选真的变了才重拉
      // 合并档位（Mod 库）用的是本地记录，恢复筛选后就地重画即可；只有在线档位才回 Nexus 重拉
      if (before !== JSON.stringify(browseFilterSnapshot())) {
        if ((state.lib.status || 'all') !== 'online') renderBrowse(); else loadBrowse(true);
      }
    }
    await refreshPrereqs();
    // 「管理器里还有哪些包装得进去」要在画下载页之前取到手（队列空着时那一页就靠它）
    await refreshLibrary();
    renderSidebar();
    renderInstalled();
    renderDownload();
    renderPrereq();
    renderSettings();
    if (showToast) toast('已刷新', 'ok');
    // 搬移过游戏目录 → 启动时已经静默对齐，这里只把结果说出来（否则用户会以为记录丢了）
    const rl = data.relocation;
    if (rl && (rl.applied || rl.imported)) {
      const parts = [];
      if (rl.imported) parts.push(`从游戏目录账本恢复 ${fmtNum(rl.imported)} 条`);
      if (rl.applied) parts.push(`对齐 ${fmtNum(rl.applied)} 条已安装记录`);
      toast('检测到游戏目录搬移：' + parts.join('，'), 'ok');
    }
    // 账本与磁盘对不上（用户手动删了文件）→ 说一声，别让记录无声消失
    const rc = data.reconciled;
    if (rc && (rc.dropped || rc.trimmed || rc.flagged)) {
      toast(`按磁盘核对：移除 ${fmtNum(rc.dropped)} 条、裁剪 ${fmtNum(rc.trimmed)} 条、纠正开关 ${fmtNum(rc.flagged)} 条`, rc.dropped ? 'err' : 'ok');
    }
  } catch (e) {
    toast('初始化失败：' + e.message, 'err');
  }
}

/* ---------------- 启动 ---------------- */

window.switchPage = switchPage;
window.openNexusDrawer = openNexusDrawer;
window.openNxmDrawer = openNxmDrawer;
window.openImportModal = openImportModal;
window.openInstallDrawer = openInstallDrawer;
window.doTranslate = doTranslate;
window.__state = state;
// 供自动化验证使用
window.__nxmRenderProgress = renderNxmProgress;
window.__nxmPushProgress = onNxmProgress;
window.__nxmRenderDone = renderNxmDone;
window.__installRenderPlan = renderInstallPlan;
window.__installPushProgress = onInstallProgress;
window.__installPrereq = installPrereq;
window.__refreshPrereqs = refreshPrereqs;
window.__installUe4ss = installUe4ss;
window.__refreshUe4ssInfo = refreshUe4ssInfo;
window.__openLogViewer = openLogViewer;
window.__renderCrash = renderCrash;
window.__crashState = () => state.crash;
window.__prereqDownloaded = onPrereqDownloaded;
window.__refreshWatchLine = refreshWatchLine;
window.__watchFound = onWatchFound;
// 下载管理（自动化验证用）
window.renderDownload = renderDownload;
window.__dlEnqueue = dlEnqueue;
window.__downloadsChanged = onDownloadChanged;
window.__downloadProgress = onDownloadProgress;
window.__openDownloadDrawer = openDownloadDrawer;
window.__dlActions = {
  dlAuthorize, dlAutoAuthorize, dlAutoAuthorizeAll,
  dlStart, dlCancel, dlConfirm, dlRemove, dlReveal, dlClearDone, refreshDownloads,
  // 变体/多选对话框（自动化验证用）
  openVariantPicker, syncPickBar, installWithPick
};
// 浏览页多选 / 批量下载（自动化验证用）
window.__batch = { batchDownload, selToggle, selClick, selRangeTo, selOrderIds, selSelectAll, selClear, selSetMode, selUpdateBar, pickPrimaryFile, batchSummary };
window.__gsel = { gselToggle, gselClick, gselRangeTo, gselOrderKeys, gselSelectAll, gselSetMode, gselSyncAll };
// 整体刷新（重拉 bootstrap + 重绘所有页面）—— 自动化验证用：
// 脚本直接调 IPC 改了磁盘状态之后，得让界面跟上，截图才反映真实情况
window.__refreshAll = refreshAll;

(async function main() {
  // ---------------- 多语言 ----------------
  // 顺序有讲究：**先挂观察器，再整体翻一遍**。
  //   1. observe() 盯住 body —— 界面是 innerHTML 整块重画的风格，没有它就是
  //      「刷新一次列表，翻译全丢」；
  //   2. apply() 立刻处理 index.html 里写死的静态结构（导航、标题、按钮），
  //      这些节点不会再有 mutation 事件，不主动翻就永远停在中文字面量上。
  // 放在 bindEvents() 之前，是为了保证首屏渲染出来的东西已经在观察范围内。
  if (window.I18N) {
    window.I18N.observe();
    window.I18N.apply();
    // 语言一变就全量重刷（节点原值都在，等价于「从中文重新翻一遍」）
    window.I18N.onChange(() => window.I18N.refresh());
  }

  bindEvents();
  selUpdateBar();   // 多选工具栏初始态（按钮文案/显隐）
  bindNxmProgress();
  window.api.install.onProgress(onInstallProgress);

  // 下载队列：状态变化全量刷新，细粒度进度只改进度条
  window.api.download.onChanged(onDownloadChanged);
  window.api.download.onProgress(onDownloadProgress);
  window.api.download.onAutoAuth(onAutoAuthProgress);
  // 批量「一键安装」的进度（2026-10-14）
  if (window.api.download.onConfirmProgress) window.api.download.onConfirmProgress(onConfirmProgress);

  // 登录窗口里检测到登录成功 → 主界面同步状态
  window.api.nexus.onAuthChanged(async (info) => {
    await refreshAuthStatus();
    if (info && info.loggedIn) {
      toast('Nexus 登录成功' + (info.apiKeySaved ? '，API Key 已自动保存' : ''), 'ok');
      if (info.apiKeySaved) state.config = await call(window.api.config.get(), { silent: true });
    }
  });

  // 程序运行中收到 nxm:// 链接（用户在 Nexus 网页点了 Mod Manager Download）
  //
  // 注意：**主进程已经直接接管了**（下载队列会自己跑起来），这里只负责把界面
  // 切到下载页让用户看到进度 —— 不再弹「确认安装」抽屉等用户点第二次。
  window.api.nxm.onIncoming(async (info) => {
    if (!info) return;
    toast('已接管 Nexus 下载：Mod #' + info.modId + '，正在自动下载…');
    switchPage('p-download');
    await refreshDownloads();
  });

  // 安装助手窗口关掉了（可能中途放弃）→ 刷新一次，保持状态一致
  window.api.prereq.onAssistantClosed(() => { refreshAll().catch(() => {}); });

  // 助手窗口里走「Manual download → Slow download」时，主进程接管下载并推进度
  window.api.prereq.onDownloadProgress(onPrereqDownloadProgress);

  // 下载完成 → 自动进入安装流程（前置组件不再需要用户点第三次）
  window.api.prereq.onDownloaded((info) => { onPrereqDownloaded(info).catch(() => {}); });

  // UE4SS 一键安装：主进程直接下 GitHub（不经过内嵌浏览器）
  window.api.prereq.onUe4ssProgress(onUe4ssProgress);

  // 下载目录监听：发现新的 mod 压缩包并已自动导入队列 → 提示一下
  window.api.watch.onFound((info) => { onWatchFound(info).catch(() => {}); });

  // 黑名单要**先拿到** —— 否则首屏会把用户已经拉黑的 mod 又显示一遍（等于白拉黑）
  await loadBlacklist();
  // 「喜欢」同理：要先拿到，首屏的卡片才能画成已经点亮的 👍（否则点一下才变）
  await loadFavorites();
  // 「有 bug」标记也要先拿到：卡片角标与批量安装的提示都靠它
  await loadBugs();
  // 「已验证」标记同样要先拿到：卡片标签与顶部筛选都靠它
  await loadVerified();

  await refreshAll();

  // 2026-11-11：首屏固定在「Mod 库」。以前 index.html 里 #p-installed 带着 .on，
  // 冷启动先显示老「已安装」页，点一下导航才正确 —— 用户截图里那个「界面不对」就是它。
  switchPage('p-browse');

  // 冷启动时窗口还没建好就收到的 nxm:// 链接，主动取一次（避免事件竞态）。
  // 主进程在这个 handler 里也已经把它接进下载队列了。
  try {
    const pending = await call(window.api.nxm.takePending(), { silent: true });
    if (pending) {
      toast('已接管 Nexus 下载：Mod #' + pending.modId + '，正在自动下载…');
      switchPage('p-download');
      await refreshDownloads();
    }
  } catch { /* 静默 */ }
})();
