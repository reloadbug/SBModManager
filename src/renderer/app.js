'use strict';
/* 剑星 Mod 管理器 · 渲染层 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  config: null,
  game: null,
  installed: [],
  auth: null,
  prereq: null,
  prereqs: [],
  prereqBusy: null,
  showBuiltin: false,
  // 默认「全部内容」—— 不隐藏任何 mod（用户 2026-10-12 明确要求）
  // blocked = 点了「不喜欢」的 modId 集合（字符串）；blockMode = hide（默认不显示）/ all / only
  browse: { sort: 'downloads', search: '', offset: 0, items: [], total: 0, loading: false, done: false, adultMode: 'all', category: '', tags: [], facets: null, gen: 0, onlyUninstalled: false, blocked: new Set(), blockMode: 'hide' },
  // 浏览页多选 / 批量下载：ids 是 modId 字符串集合（跨滚动保留），
  // all = 「已全选当前列表」，之后追加加载的新卡片自动并入选择。
  sel: { on: false, all: false, busy: false, ids: new Set() },
  modalTask: null,   // 「选择要安装哪些内容」对话框对应的下载任务 id
  pick: new Set(),   // 该对话框里已勾选的候选目录（归档内相对路径）
  pickGroups: null,  // dir → 同组目录数组（同一件东西的不同版本，组内单选）
  drawer: { open: false, kind: null, mod: null, lang: 'zh', translated: null, translating: false, files: [] },
  nxm: { open: false, info: null, prep: null, downloading: false, downloaded: null },
  install: { open: false, archivePath: null, meta: null, plan: null, running: false, manualTarget: null, pickDir: '', pickDirs: null, result: null },
  downloads: [],
  downloadStats: {},
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
 * 「和已装的那个 Mod 做对比」—— 用户要求：
 * > 这种需要覆盖的要提供对比按钮，并列显示对应的已安装模组的信息，尤其是图片。
 *
 * 左右两栏并列，每栏给：封面/图集、名字、版本、作者、Mod ID、文件清单。
 *   · **左边（旧）**：已装着的那个 Mod —— 按 modId 从主进程拉图集（本地有缓存就是瞬时）
 *   · **右边（新）**：正要装进去的这个 —— 用任务 meta 里已有的图
 *
 * @param {number} oldModId 已装 Mod 的 Nexus modId
 * @param {string} [oldName] 显示名（主进程已经给了，省一次查询）
 */
async function openCmpModal(oldModId, oldName) {
  const st = state.modalTask || {};
  const meta = (state.cmpIncoming) || st.meta || {};
  const incomingImgs = (meta.images || []).filter(x => x && x.localUrl);

  const faceOf = (local) => local
    ? `<img class="cmp-face" src="${esc(local)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cmp-face ph',textContent:'封面加载失败'}))">`
    : `<div class="cmp-face ph">没有封面图</div>`;

  openModal('覆盖对比：已装的 vs 要装的', `
    <div class="cmpwrap cmpwrap">
      <div class="cmpgrid">
        <div class="cmpcol old">
          <h4>已装着（会被替换掉）</h4>
          <div class="cmp-body">
            <div id="cmpOldFace">${faceOf(meta.__oldCover || '')}</div>
            <div class="cmp-name">${esc(oldName || 'Mod #' + oldModId)}</div>
            <div class="cmp-kv"><b>Mod ID</b><span>#${esc(String(oldModId))}</span></div>
            <div class="cmp-files" id="cmpOldFiles"><span class="spin"></span> 正在读取已装 Mod 的文件清单…</div>
          </div>
        </div>
        <div class="cmpcol new">
          <h4>要装进去（新）</h4>
          <div class="cmp-body">
            ${faceOf(incomingImgs[0] ? incomingImgs[0].localUrl : (meta.image || meta.pictureUrl || ''))}
            <div class="cmp-name">${esc(meta.name || 'Mod #' + (meta.modId || '?'))}</div>
            <div class="cmp-kv"><b>Mod ID</b><span>#${esc(String(meta.modId || '?'))}</span></div>
            <div class="cmp-kv"><b>版本</b><span>${esc(verText(meta.version) || '—')}</span></div>
            <div class="cmp-kv"><b>作者</b><span>${esc(meta.author || '—')}</span></div>
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
    if (faceBox && !document.getElementById('modal').classList.contains('on') === false) {
      if (imgs.length) {
        faceBox.innerHTML = faceOf(imgs[0].localUrl)
          + (imgs.length > 1
            ? `<div class="lbl" style="margin-top:6px">图集 · ${imgs.length} 张</div>${imageGrid(imgs)}`
            : '');
      }
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
}

/* ---------------- 导航 ---------------- */

const TITLES = {
  'p-installed': ['已安装 Mod', ''],
  'p-browse': ['浏览 Mod', '数据来自 Nexus Mods 官方接口'],
  'p-download': ['下载管理', '队列会自动完成 下载 → 识别 → 安装'],
  'p-prereq': ['前置组件', 'Mod 加载器与框架'],
  'p-settings': ['设置', '路径 / 账号 / 翻译']
};

/** 各页离开时的滚动位置 —— 切回来直接恢复，不重置、不重新拉数据 */
const pageScroll = new Map();

function switchPage(id) {
  const cur = $('.page.on');
  const curId = cur && cur.id;
  if (curId && curId !== id) pageScroll.set(curId, $('#body').scrollTop);

  $$('.nav-i').forEach(n => n.classList.toggle('on', n.dataset.p === id));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === id));
  const [t, s] = TITLES[id] || ['', ''];
  $('#ttl').textContent = t;
  $('#sub').textContent = s;
  $('#searchBox').style.display = id === 'p-browse' ? 'flex' : 'none';
  $('#btnImport').style.display = (id === 'p-installed' || id === 'p-download') ? '' : 'none';
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
}

/* ---------------- 侧栏状态 ---------------- */

function renderSidebar() {
  const g = state.game;
  const ok = g && g.found;
  $('#gameDot').className = 'dot' + (ok ? '' : ' bad');
  $('#gameStat').textContent = ok ? '游戏已就绪' : '未找到游戏目录';
  $('#gamePath').textContent = ok
    ? `${g.root}\nUE4SS ${g.ue4ss.installed ? '✓' : '✗'} · CNS ${g.cns.installed ? '✓' : '✗'}`
    : (g && g.configured) || '—';
  $('#navCountInstalled').textContent = state.installed.filter(m => !m.builtin).length;

  const active = (state.downloads || []).filter(t => DL_ACTIVE.has(t.status)).length;
  const badge = $('#navCountDownload');
  badge.textContent = active;
  badge.style.display = active ? '' : 'none';
  badge.style.background = active ? 'rgba(232,163,61,.2)' : '';
  badge.style.color = active ? 'var(--accent)' : '';
}

/* ---------------- 已安装 Mod ---------------- */

const KIND_LABEL = { pak: 'Pak 模组', script: '脚本模组', prereq: '前置组件' };

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
 * 走主进程 `mod:images`：先抓 Nexus mod 页的图集（最多 5 张**不同**的图），
 * 抓不到再回落官方 API 的封面。结果已缓存在本地，下次打开是瞬时的。
 */
async function fillGallery(modId, { force = false } = {}) {
  const box = $('#galleryBox');
  if (!box) return;
  box.innerHTML = '<div class="txt" style="color:var(--dim2)"><span class="spin"></span> 正在获取该 Mod 的图集…</div>';
  let imgs = [];
  try {
    imgs = await call(window.api.modImages(modId, null, force ? { force: true } : undefined), { silent: true });
  } catch { imgs = []; }
  const box2 = $('#galleryBox');
  if (!box2) return;                       // 抽屉已关 / 内容已换，别再写
  box2.innerHTML = (imgs && imgs.length)
    ? `<div class="lbl">图集 · ${imgs.length} 张（已缓存到本地）</div>${imageGrid(imgs)}`
    : `<div class="lbl">图集</div><div class="txt" style="color:var(--dim2)">没能取到图集（可能被 Cloudflare 拦住，或该 Mod 没有额外图片）。</div>`;
}

function installedCard(m) {
  const meta = m.meta || {};
  const src = meta.source || {};
  const modId = src.modId || meta.modId || null;
  const img = coverForMod(modId) || meta.image || src.pictureUrl || '';
  const zh = meta.nameZh || meta.summaryZh || meta.summary || src.summary || '';
  const version = meta.version || src.version || '';
  const author = meta.author || src.author || '';
  const cover = img
    ? `<img src="${esc(img)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'图片加载失败'}))">`
    : `<div class="ph">${m.kind === 'prereq' ? '前置组件' : '本地文件<br>无封面图'}</div>`;
  const tagCls = m.kind === 'prereq' ? 'tag pre' : (m.kind === 'script' ? 'tag script' : 'tag');
  const tagTxt = m.builtin ? '内置' : (m.registered ? KIND_LABEL[m.kind] : '未登记');

  return `
  <div class="card${m.enabled ? '' : ' off'}" data-id="${esc(m.id)}">
    <div class="cover">
      ${cover}
      <span class="${tagCls}">${esc(tagTxt)}</span>
      ${m.kind === 'prereq' ? '' : `<button class="sw${m.enabled ? '' : ' off'}" data-toggle="${esc(m.id)}" title="${m.enabled ? '点击禁用' : '点击启用'}"></button>`}
    </div>
    <div class="cbody">
      <h3 data-i18n-skip title="${esc(m.name)}">${esc(m.name)}</h3>
      <div class="zh"${zh ? ' data-i18n-skip' : ''} title="${esc(zh)}">${esc(zh || (m.kind === 'prereq' ? 'Mod 运行依赖' : '本地已安装'))}</div>
      <div class="meta">
        ${modId ? `<span class="chip mid" title="Nexus Mod ID（Nexus 网址 /mods/ 后面那个数字）">#${esc(String(modId))}</span>` : ''}
        ${version ? `<span class="chip">${esc(verText(version))}</span>` : ''}
        ${author ? `<span>${esc(author)}</span>` : ''}
        <span>${fmtSize(m.size)}</span>
        <span>·</span>
        <span>${m.fileCount} 个文件</span>
      </div>
    </div>
  </div>`;
}

/** 「待处理」的原因 —— 一句话说清要用户做什么 */
function reviewWhy(t) {
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
    return n
      ? `包里有 ${n} 套内容${g ? `（其中 ${g} 组是同一件东西的不同版本，只能各选一套）` : ''}，点「确认安装」挑选`
      : '结构无法识别，需要手动指定安装位置';
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
    // 「对比」按钮：有登记者才给（不是 mod 装的没东西可对比）。
    // 有多个登记者时只挂第一个 non-self 的 modId —— 对比框是「新 vs 旧」，
    // 一次比一个；剩下几个在对比框里会列出来。没有 other 时退回 owners[0]（自己）。
    const cmpTarget = (others[0] || owners[0] || null);
    const cmpBtn = cmpTarget && cmpTarget.modId
      ? `<button class="cfl-btn cmp" data-cmp="${esc(String(cmpTarget.modId))}" data-cmp-name="${esc(cmpTarget.name || '')}"
           title="和「${esc(cmpTarget.name || '这个 Mod')}」做左右对比（图片 / 版本 / 作者 / 文件）">⇄ 对比</button>`
      : '';
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
          ${cmpBtn}
        </span>
      </div>`;
  }).join('');
  const more = d.items.length > limit
    ? `<div class="cfl-more">还有 ${d.items.length - limit} 个没显示（共 ${d.total} 个）</div>`
    : '';
  return `<div class="cflist">${rows}${more}</div>`;
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
  // 「需要你处理」的两种：结构没识别出来（待确认）、安装失败但包还在。
  // 它们都是**等用户操作**的，不是程序在跑 —— 混进 busy 里配个转圈进度条，
  // 用户会以为卡死了（实测就是这么报上来的）。
  const review = all.filter(t =>
    t.status === 'needs_review' || (t.status === 'failed' && t.archivePath));
  if (!busy.length && !review.length) return '';

  const title = [];
  if (busy.length) title.push(`正在处理 ${busy.length} 项`);
  if (review.length) title.push(`${review.length} 项待处理`);

  const row = (t, isReview) => {
    const meta = t.meta || {};
    const st = DL_STATUS[t.status] || { t: t.status, c: 'run' };
    const label = esc(meta.name || ('Mod #' + (meta.modId || '?')));

    if (isReview) {
      return `<div class="li rev" data-live="${esc(t.id)}">
        <b>${label}</b>
        <span class="dl-st ${st.c}">${esc(st.t)}</span>
        <span class="why">${esc(reviewWhy(t))}</span>
        <button class="btn p sm" data-dl-confirm="${esc(t.id)}">去处理</button>
      </div>`;
    }

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
    <h4>${busy.length ? '<span class="spin"></span> ' : ''}${title.join(' · ')}</h4>
    ${busy.map(t => row(t, false)).join('')}
    ${review.map(t => row(t, true)).join('')}
  </div>`;
}

function renderInstalled() {
  const area = $('#installedArea');
  if (!state.game || !state.game.found) {
    area.innerHTML = emptyNoGame();
    return;
  }
  if (!state.installed.length) {
    area.innerHTML = liveStrip() + `
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

  const sorted = [...visible].sort((a, b) => {
    const rank = { prereq: 0, pak: 1, script: 2 };
    const r = (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3);
    if (r) return r;
    return a.name.localeCompare(b.name);
  });

  const toggleRow = builtinScripts.length ? `
    <div style="margin-bottom:12px">
      <button class="btn sm" data-showbuiltin="1">
        ${state.showBuiltin ? '隐藏' : '显示'} UE4SS 自带的 ${builtinScripts.length} 个内置脚本模组
      </button>
    </div>` : '';

  area.innerHTML = liveStrip() + toggleRow + `<div class="grid">${sorted.map(installedCard).join('')}</div>`;
  $('#sub').textContent = `共 ${state.installed.length} 项 · ${state.installed.filter(m => m.enabled).length} 个已启用`;
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

function openInstalledDrawer(m) {
  const meta = m.meta || {};
  const src = meta.source || {};
  const imgs = cachedImagesOf(meta);
  const img = meta.image || '';
  const srcModId = Number(src.modId || meta.modId || 0) || 0;
  state.drawer = { open: true, kind: 'installed', mod: m, lang: 'zh', translated: null, translating: false, files: [] };

  $('#dTitle').textContent = m.name;
  $('#dSub').textContent = [meta.nameZh, verText(meta.version), meta.author].filter(Boolean).join(' · ')
    || KIND_LABEL[m.kind] || '';

  const desc = meta.description || meta.summary || '';
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
      : `<div class="txt" style="color:var(--dim2)">该 Mod 没有登记说明文字。${m.registered ? '' : '（这是磁盘上扫描到的模组，尚未通过管理器安装，因此没有来源信息）'}</div>`}

    <div class="lbl">来源</div>
    ${meta.url
      ? `<div class="urlbox"><span style="flex:1">${esc(meta.url)}</span><button class="btn sm" data-openurl="${esc(meta.url)}">打开</button></div>`
      : `<div class="txt" style="color:var(--dim2)">未知来源（非管理器安装）</div>`}

    <div class="lbl">信息</div>
    <div class="kv"><span>类型</span><span>${KIND_LABEL[m.kind] || m.kind}${m.builtin ? '（内置）' : ''}</span></div>
    ${srcModId ? `<div class="kv"><span>Mod ID</span><span>#${srcModId}${src.fileId
      ? `<span style="color:var(--dim2)"> · 文件 ${esc(String(src.fileId))}</span>` : ''}</span></div>` : ''}
    <div class="kv"><span>状态</span><span style="color:${m.enabled ? 'var(--ok)' : 'var(--dim)'}">${m.enabled ? '已启用' : '已禁用'}</span></div>
    <div class="kv"><span>位置</span><span>${esc(m.location)}</span></div>
    <div class="kv"><span>文件数</span><span>${m.fileCount}</span></div>
    <div class="kv"><span>占用</span><span>${fmtSize(m.size)}</span></div>
    <div class="kv"><span>修改时间</span><span>${fmtDate(m.mtime)}</span></div>
    <div class="kv"><span>登记状态</span><span>${m.registered ? '已登记（含来源信息）' : '未登记（磁盘扫描发现）'}</span></div>

    ${archiveBlockHtml(m)}

    <div class="lbl">文件清单</div>
    <div class="filelist">${m.files.map(f => esc(f.name)).join('<br>')}</div>
  `;

  $('#dFoot').innerHTML = `
    <button class="btn" data-reveal="${esc(m.id)}">打开所在文件夹</button>
    ${m.archive && m.archive.exists
      ? `<button class="btn" data-reveal-path="${esc(m.archive.path)}" title="在资源管理器中定位原压缩包：${esc(m.archive.path)}">📦 定位原压缩包</button>`
      : ''}
    ${m.kind !== 'prereq' ? `
      <button class="btn" data-toggle2="${esc(m.id)}">${m.enabled ? '禁用' : '启用'}</button>
      <button class="btn d" data-uninstall="${esc(m.id)}">卸载</button>` : ''}
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
  pending: { badge: '↓ 已下载', cls: 'dl', btn: '⬇ 安装', act: 'install' },
  downloading: { badge: '● 下载中', cls: 'busy', btn: '查看进度', act: 'download' }
};

function browseCard(n) {
  const img = n.thumbnail || n.image;
  const st = n.local ? LOCAL_UI[n.local.state] : null;
  // 「不喜欢」按钮：已在黑名单里就变成「移出黑名单」（「只看黑名单」视图里点得到）
  const isBlocked = state.browse.blocked.has(String(n.modId));
  const noBtn = isBlocked
    ? `<button class="btn sm no on" data-undislike="${n.modId}" title="移出黑名单，之后会重新显示">♻ 移出黑名单</button>`
    : `<button class="btn sm no" data-dislike="${n.modId}" title="加入黑名单，之后不再显示">🚫 不喜欢</button>`;
  let action;
  if (!st) {
    action = `<button class="btn sm" data-dl-add="${n.modId}" title="加入下载队列（之后自动下载并安装）">⬇ 下载</button>`;
  } else if (st.act === 'install') {
    action = `<button class="btn sm p" data-local-install="${esc(n.local.taskId)}" title="安装包已在本地，直接安装">${st.btn}</button>`;
  } else if (st.act === 'installed') {
    action = `<button class="btn sm st-ok" data-goto-page="p-installed" title="已装到本地，去「已安装 Mod」看看">${st.btn}</button>`;
  } else if (st.act === 'download') {
    action = `<button class="btn sm" data-goto-page="p-download" title="去「下载」页看进度">${st.btn}</button>`;
  } else {
    action = `<button class="btn sm" disabled>${st.btn}</button>`;
  }

  return `
  <div class="card${state.sel.ids.has(String(n.modId)) ? ' sel' : ''}" data-modid="${n.modId}">
    <div class="cover">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'无封面图'}))">`
        : `<div class="ph">无封面图</div>`}
      <div class="ck${state.sel.ids.has(String(n.modId)) ? ' on' : ''}" data-ck="${n.modId}">✓</div>
      ${st ? `<span class="lb ${st.cls}">${st.badge}</span>` : ''}
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
        ${action}
        ${noBtn}
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
}

/** 全选 / 取消全选「当前已加载」的 Mod；全选后新追加的卡片自动并入 */
function selSelectAll() {
  const items = state.browse.items || [];
  if (!items.length) return;   // 还没加载出东西，没什么可选（也别把 all 置上）
  const allOn = items.every(m => state.sel.ids.has(String(m.modId)));
  if (allOn) { state.sel.ids.clear(); state.sel.all = false; }
  else { for (const m of items) state.sel.ids.add(String(m.modId)); state.sel.all = true; }
  selSyncAll();
  selUpdateBar();
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
    const on = state.sel.ids.has(String(card.dataset.modid));
    card.classList.toggle('sel', on);
    const ck = card.querySelector('.ck');
    if (ck) ck.classList.toggle('on', on);
  }
}

/** 列表重置（换筛选 / 排序 / 搜索）时清空选择：旧选择对应的 Mod 可能已经不在列表里了 */
function selClear() {
  state.sel.ids.clear();
  state.sel.all = false;
  selSyncAll();
  selUpdateBar();
}

/** 进入 / 退出多选模式（只切 body 上的类，卡片不用重画）；退出时清空选择 */
function selSetMode(on) {
  state.sel.on = !!on;
  document.body.classList.toggle('sel', state.sel.on);
  if (!state.sel.on) { state.sel.ids.clear(); state.sel.all = false; selSyncAll(); }
  selUpdateBar();
}

/** 工具栏三个按钮的文案 / 显隐 / 计数 */
function selUpdateBar() {
  const mode = $('#btnBatchMode');
  const allBtn = $('#btnSelectAll');
  const dl = $('#btnBatchDownload');
  if (!mode) return;
  mode.textContent = state.sel.on ? '完成' : '多选';
  mode.classList.toggle('on', state.sel.on);
  if (allBtn) {
    allBtn.style.display = state.sel.on ? '' : 'none';
    const items = state.browse.items || [];
    const allOn = items.length > 0 && items.every(m => state.sel.ids.has(String(m.modId)));
    allBtn.textContent = allOn ? '取消全选' : '全选';
  }
  if (dl) {
    dl.style.display = state.sel.on ? '' : 'none';
    if (state.sel.busy) return;   // 跑批时文案由进度更新接管，别被覆盖
    const n = state.sel.ids.size;
    dl.textContent = n ? `批量下载（${n}）` : '批量下载';
    dl.disabled = !n;
  }
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

function renderBrowse() {
  const b = state.browse;
  const area = $('#browseArea');
  renderBrowseFilters();
  if (b.loading && !b.items.length) {
    area.innerHTML = `<div class="grid">${Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('')}</div>`;
    $('#browseStats').textContent = '正在从 Nexus 拉取…';
    $('#btnLoadMore').style.display = 'none';
    return;
  }
  if (!b.items.length) {
    area.innerHTML = `<div class="empty">
      <h3>${b.blockMode === 'only' ? '黑名单是空的' : '没有结果'}</h3>
      <p>${b.blockMode === 'only' ? '在卡片上点「🚫 不喜欢」就会加到这里。'
        : b.search ? '换个关键词试试。'
        : (b.category || b.tags.length || b.onlyUninstalled) ? '当前筛选条件下没有 Mod，试试放宽条件。'
        : '暂时拿不到数据，请检查网络。'}</p>
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
 * 前端本地筛选：**黑名单（默认隐藏）** + 只看未安装。
 *
 * 两者都要「整页拉回来再剔」（Nexus 没有这两个筛选条件），所以合成一处 ——
 * 分开写会让 `loadBrowse` 的续翻条件算错（见 `isLocalFiltering` 的说明）。
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
  return kept;
}

/**
 * 「只看黑名单」：**不走 Nexus 分页**，直接渲染本地黑名单记录。
 *
 * 为什么不复用 `loadBrowse` 的筛选：黑名单通常只有几条，而 Nexus 有 3000+ 个 mod，
 * 靠「翻页 + 过滤」要翻遍全站才凑得出来（一次 24 个，翻 20 页也才 480 个）——
 * 用户点「只看黑名单」等半分钟还看不到东西。本地记录里存了 name/author/thumbnail，
 * 零网络请求，秒开。
 */
async function loadBlockedList(reset) {
  const b = state.browse;
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
    let list = await call(window.api.blacklist.list());
    if (stale()) return;
    // 黑名单视图里也支持搜索框 —— 本地按名字过滤（服务端筛选在这里没有意义）
    if (b.search) {
      const q = b.search.toLowerCase();
      list = (list || []).filter(x => String((x && x.name) || '').toLowerCase().includes(q));
    }
    b.items = (list || []).map(x => ({
      modId: x.modId,
      name: x.name || ('Mod #' + x.modId),
      author: x.author || '',
      thumbnail: x.thumbnail || '',
      summary: x.at ? ('加入黑名单于 ' + String(x.at).slice(0, 10)) : '已加入黑名单',
      blocked: true
    }));
    b.total = b.items.length;
    b.offset = b.items.length;
    b.done = true;   // 本地列表一次给全，没有「加载更多」
  } catch (e) {
    if (stale()) return;
    b.items = []; b.total = 0; b.done = true;
    $('#browseStats').innerHTML = `<span style="color:var(--red)">读取黑名单失败：${esc(e.message)}</span>`;
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

  if (b.blockMode === 'only') {
    // 「只看黑名单」里点的 → 卡片留在原地，按钮换成「移出黑名单」
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

  if (b.blockMode === 'only') {
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

async function loadBrowse(reset) {
  const b = state.browse;
  // 「只看黑名单」走本地记录，不碰 Nexus（见 loadBlockedList 的说明）
  if (b.blockMode === 'only') return loadBlockedList(reset);
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
    $('#dBody').innerHTML = `
      <div id="galleryBox">${m.image ? `<img class="hero" src="${esc(m.image)}" alt="" onerror="this.style.display='none'">` : ''}</div>
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

      <div class="lbl">文件</div>
      <div id="filesBox" class="txt" style="color:var(--dim2)">正在获取文件列表…</div>
    `;
    $('#dFoot').innerHTML = `
      <button class="btn" data-openurl="${esc(m.url)}">在浏览器打开</button>
      <button class="btn" data-gallery="${m.modId}">刷新图集</button>
      <button class="btn" data-install="${m.modId}">手动安装</button>
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

  const foot = $('#dFoot');
  if (!foot || !st) return;
  const openBtn = `<button class="btn" data-openurl="${esc(cur.url)}">在浏览器打开</button>`;
  if (st.act === 'install') {
    foot.innerHTML = openBtn + `<button class="btn p" data-local-install="${esc(local.taskId)}">${st.btn}</button>`;
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

  const archivedCount = all.filter(f => f.categoryRaw === 'ARCHIVED' || f.categoryRaw === 'OLD_VERSION').length;
  const list = showArchived ? all : all.filter(f => f.categoryRaw !== 'ARCHIVED' && f.categoryRaw !== 'OLD_VERSION');

  box.innerHTML = list.map(f => `
    <div style="border-bottom:1px dashed #262B33;padding:8px 0">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
        ${f.primary ? '<span class="chip" style="color:var(--ok);border-color:rgba(63,185,80,.4)">主文件</span>' : ''}
        <span class="chip">${esc(f.category)}</span>
        <b style="color:var(--text);font-size:12px">${esc(f.name)}</b>
        <span style="color:var(--dim2);font-size:11px">v${esc(f.version)} · ${fmtSize(f.sizeInBytes)}</span>
        <button class="btn sm p" style="margin-left:auto" data-dl-file="${f.fileId}"
          title="只下载这个文件：${esc(f.name)}（v${esc(f.version)}）">⬇ 下载</button>
      </div>
      ${f.description ? `<div style="color:var(--dim2);font-size:11px;margin-top:4px;line-height:1.6">${esc(f.description).slice(0, 200)}</div>` : ''}
    </div>`).join('') +
    (archivedCount && !showArchived
      ? `<button class="btn sm" style="margin-top:10px" data-showarchived="1">显示 ${archivedCount} 个已归档/旧版本文件</button>`
      : '');

  // 底部那颗「加入下载队列」在文件列表到位后改口径：多文件 mod 直接对准
  // 主文件，用户不用再到 Nexus 页面上从一堆按钮里挑。
  const main = list.find(f => f.primary) || list[0];
  const footBtn = document.querySelector('#dFoot [data-dl-add]');
  if (main && footBtn && state.drawer.mod && Number(state.drawer.mod.modId) === Number(modId)) {
    footBtn.innerHTML = '⬇ 下载主文件';
    footBtn.title = main.name + '（v' + main.version + '）';
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
        <div class="ic">📁</div>
        <div>
          <h3>Mod 落点目录</h3>
          <p>UE4 引擎加载 Mod 的标准位置</p>
        </div>
        <span class="st ${g.modsDir.exists ? 'ok' : 'mid'}">${g.modsDir.exists ? '已就绪' : '不存在'}</span>
      </div>
      <div class="row">~Mods <code>${esc(g.modsDir.path)}</code> ${g.modsDir.exists ? `✓ ${g.modsDir.fileCount} 个文件` : '✗'}</div>
      <div class="row">脚本 Mods <code>${esc(g.root)}\\SB\\Binaries\\Win64\\ue4ss\\Mods\\</code></div>
      <div class="row" style="border-top:none">
        ${g.modsDir.exists ? '' : '<button class="btn sm p" data-mkmods="1">创建 ~Mods 目录</button>'}
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
  interrupted: { t: '已中断', c: 'err' }
};

const DL_ACTIVE = new Set([
  'awaiting_authorization', 'queued', 'resolving', 'downloading',
  'downloaded', 'analyzing', 'needs_review', 'installing'
]);

const DL_BUSY = new Set(['queued', 'resolving', 'downloading', 'analyzing', 'installing']);

function dlStatusMeta(t) { return DL_STATUS[t.status] || { t: t.status, c: 'wait' }; }

function dlActionsHtml(t) {
  const meta = t.meta || {};
  const a = [];
  if (t.status === 'awaiting_authorization') {
    // 主按钮 = 自动授权（免点击，直接问 Nexus 要授权）。
    // 「手动」保留为降级通路：作者只开了手动下载、或撞上 Cloudflare 时还得靠它。
    a.push(`<button class="btn p sm" data-dl-autoauth="${esc(t.id)}" title="用已登录的 Nexus 会话直接取得下载授权，不用打开网页">⚡ 自动授权</button>`);
    a.push(`<button class="btn sm" data-dl-auth="${esc(t.id)}" title="打开 Nexus 页面，由你点一下下载按钮（自动授权失败时用）">手动</button>`);
    a.push(`<button class="btn sm" data-dl-cancel="${esc(t.id)}">取消</button>`);
  } else if (DL_BUSY.has(t.status)) {
    a.push(`<button class="btn d sm" data-dl-cancel="${esc(t.id)}">取消</button>`);
  } else if (t.status === 'needs_review') {
    // 「作者的工程源文件」这类包**装到哪儿都不会生效** ——
    // 给它「确认安装」是个死胡同（点下去只会再弹一次说明），主按钮换成「移除」。
    const noInstall = !!(t.install && t.install.plan && t.install.plan.diagnosis);
    if (noInstall) {
      a.push(`<button class="btn d sm" data-dl-remove="${esc(t.id)}">移除</button>`);
      a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
    } else {
      a.push(`<button class="btn p sm" data-dl-confirm="${esc(t.id)}">确认安装</button>`);
      a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
      a.push(`<button class="btn d sm" data-dl-remove="${esc(t.id)}">移除</button>`);
    }
  } else if (t.status === 'downloaded') {
    a.push(`<button class="btn p sm" data-dl-start="${esc(t.id)}">安装</button>`);
    a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
    a.push(`<button class="btn d sm" data-dl-remove="${esc(t.id)}">移除</button>`);
  } else if (t.status === 'installed') {
    a.push(`<button class="btn sm" data-dl-start="${esc(t.id)}">重新安装</button>`);
    a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
    a.push(`<button class="btn sm" data-dl-remove="${esc(t.id)}">删除记录</button>`);
  } else {
    // 失败分两种：**安装**失败（安装包还在，问题出在结构/落点）和**下载**失败。
    // 前者该走「去处理」（会先刷新结构分析、必要时弹变体选择框），
    // 后者才该重新下载 —— 一律给「重试」会让安装失败的任务点了没反应（实测踩过）。
    if (t.archivePath) a.push(`<button class="btn p sm" data-dl-confirm="${esc(t.id)}">去处理</button>`);
    else a.push(`<button class="btn p sm" data-dl-start="${esc(t.id)}">重试</button>`);
    if (t.archivePath) a.push(`<button class="btn sm" data-dl-reveal="${esc(t.id)}">打开文件夹</button>`);
    a.push(`<button class="btn d sm" data-dl-remove="${esc(t.id)}">移除</button>`);
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

  const reason = t.install && t.install.reason ? t.install.reason : '';

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
      ${reason ? `<div class="dl-sub" style="color:var(--blue)">${esc(reason)}</div>` : ''}
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
    </div>`;
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
  // 「还能接着下」的任务：中断 / 下载失败，且手上**没有**安装包。
  // 用户要求（2026-10-14）：「任务中断后支持全部恢复继续下载」——
  // 十几条任务一条条点「重试」是折磨，给一个一键恢复。
  // ⚠️ 排除有 `archivePath` 的：那种是**安装**失败，包已经下好了，
  //     重新下载纯属白跑流量，该走「去处理」。
  const resumeCount = tasks.filter(t =>
    (t.status === 'interrupted' || t.status === 'failed') && !t.archivePath
  ).length;
  // 「进行中」和「待处理」必须分开算 ——
  // 主进程的 `stats.active` 是「所有非终态」，把「待确认 / 等待授权」也含进去了。
  // 那两类是**在等你操作**（不该显示成正在跑，见 SKILL 铁律 42），口径混着显示会误导。
  const needYouCount = reviewCount + waitAuthCount;
  const runningCount = Math.max(0, (s.active || 0) - needYouCount);

  area.innerHTML = `
    <div class="dl-bar">
      <span class="stat">共 <b>${tasks.length}</b> 项</span>
      ${runningCount ? `<span class="stat">进行中 <b>${runningCount}</b></span>` : ''}
      ${needYouCount ? `<span class="stat" style="color:var(--accent)">待处理 <b style="color:var(--accent)">${needYouCount}</b></span>` : ''}
      <span class="stat">已安装 <b>${s.installed || 0}</b></span>
      ${s.failed ? `<span class="stat" style="color:var(--red)">失败 <b style="color:var(--red)">${s.failed}</b></span>` : ''}
      <div class="spacer"></div>
      ${resumeCount ? `<button class="btn p sm" data-dl-resumeall="1" title="把所有中断 / 下载失败的任务一次性重新排队：已经下过的部分会接着下，不用从头再来">↻ 全部恢复（${resumeCount}）</button>` : ''}
      ${waitAuthCount ? `<button class="btn p sm" data-dl-autoauthall="1" title="用已登录的 Nexus 会话逐个取得下载授权，不用再逐条去网页点下载按钮">⚡ 全部自动授权（${waitAuthCount}）</button>` : ''}
      ${reviewCount ? `<button class="btn sm" data-dl-refreshplans="1" title="安装规则升级后，之前识别不了的包可能已经能认出来了">重新识别${reviewCount ? `（${reviewCount}）` : ''}</button>` : ''}
      ${doneCount ? `<button class="btn sm" data-dl-cleardone="1">清理已完成记录（${doneCount}）</button>` : ''}
    </div>
    <div class="dl-list">${sorted.map(dlItem).join('')}</div>`;
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
async function dlEnqueue(meta, { authorize = true } = {}) {
  let r;
  try { r = await call(window.api.download.enqueue(meta), { silent: true }); }
  catch (e) { toast(e.message, 'err'); return null; }

  await refreshDownloads();
  switchPage('p-download');

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
      .filter(t => (t.status === 'interrupted' || t.status === 'failed') && !t.archivePath)
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

async function dlCancel(id) {
  try { await call(window.api.download.cancel(id), { silent: true }); toast('已取消'); await refreshDownloads(); }
  catch (e) { toast(e.message, 'err'); }
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
      ${conflictListHtml(cd)}
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

/** 队列整体变化（新增 / 状态变更）→ 全量重绘 */
function onDownloadChanged(info) {
  if (!info) return;
  const prev = state.downloads || [];
  state.downloads = info.tasks || [];
  state.downloadStats = info.stats || {};

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
      <div class="f">
        <label></label>
        <button class="btn sm" id="btnDetect">自动探测</button>
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
        <button class="btn sm" id="btnOpenData">打开</button>
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

  window.api.translate.stats().then(r => {
    const el = $('#transStats');
    if (el && r.ok) el.textContent = `已缓存 ${r.data.entries} 条译文`;
  });
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
  const conflictList = conflictListHtml(p.conflictDetails);

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
    if (e.key !== 'Escape') return;
    if ($('#modal').classList.contains('on')) closeModal();
    else closeDrawer();
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

  $('#btnRefresh').addEventListener('click', () => refreshAll(true));

  $('#btnNexusAccount').addEventListener('click', () => {
    switchPage('p-settings');
    setTimeout(() => { const el = $('#authLine'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  });

  $('#btnImport').addEventListener('click', () => {
    openImportModal();
  });

  $('#btnOpenSite').addEventListener('click', () => {
    window.api.openExternal('https://www.nexusmods.com/stellarblade/mods/');
  });

  // 成人内容三态：隐藏成人 / 全部内容 / 只显示成人
  $('#adultTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-adult]');
    if (!b) return;
    const mode = b.dataset.adult;
    if (state.browse.adultMode === mode) return; // 已选中，不重复拉
    state.browse.adultMode = mode;
    $$('#adultTabs button').forEach(x => x.classList.toggle('on', x === b));
    loadBrowse(true);
  });

  // 只看未安装（本地判定，Nexus 没这个筛选条件）—— 开/关都要重新拉
  $('#newOnlyTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-onlynew]');
    if (!b) return;
    state.browse.onlyUninstalled = !state.browse.onlyUninstalled;
    $$('#newOnlyTabs button').forEach(x => x.classList.toggle('on', state.browse.onlyUninstalled));
    loadBrowse(true);
  });

  // 黑名单三态：隐藏（默认）/ 显示全部 / 只看黑名单
  $('#blockTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-block]');
    if (!btn) return;
    const mode = btn.dataset.block;
    if (state.browse.blockMode === mode) return;
    state.browse.blockMode = mode;
    updateBlockTabs();
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
    if (clear) {
      b.category = '';
      b.tags = [];
      loadBrowse(true);
      return;
    }
    const cat = e.target.closest('button[data-cat]');
    if (cat) {
      b.category = cat.dataset.cat || '';
      loadBrowse(true);
      return;
    }
    const tag = e.target.closest('button[data-tag]');
    if (tag) {
      const v = tag.dataset.tag;
      b.tags = b.tags.includes(v) ? b.tags.filter(x => x !== v) : b.tags.concat(v);
      loadBrowse(true);
    }
  });

  $('#sortTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-sort]');
    if (!b) return;
    $$('#sortTabs button').forEach(x => x.classList.toggle('on', x === b));
    state.browse.sort = b.dataset.sort;
    loadBrowse(true);
  });

  let searchTimer = null;
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.browse.search = e.target.value.trim();
      loadBrowse(true);
    }, 450);
  });

  // 全局委托
  document.addEventListener('click', async (e) => {
    const t = e.target;

    const setroot = t.closest('[data-setroot]');
    if (setroot) { await doSetRoot(setroot.dataset.setroot); return; }

    const openurl = t.closest('[data-openurl]');
    if (openurl) { e.preventDefault(); window.api.openExternal(openurl.dataset.openurl); return; }

    // 🔴 「对比」必须排在 data-reveal-path **之前**：整行都带 data-reveal-path
    //    （点行就是定位），不抢先的话点「对比」只会弹资源管理器。
    const cmpBtn = t.closest('[data-cmp]');
    if (cmpBtn) {
      e.stopPropagation();
      await openCmpModal(Number(cmpBtn.dataset.cmp), cmpBtn.dataset.cmpName || '');
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

    if (t.closest('#cnsInstall')) { await installPrereq('cns'); return; }

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

    const nexusBtn = t.closest('[data-nexus]');
    if (nexusBtn) { openNexusDrawer(Number(nexusBtn.dataset.nexus)); return; }

    // 刷新图集：强制重抓（默认 7 天缓存，点这个就绕过）
    const galBtn = t.closest('[data-gallery]');
    if (galBtn) { await fillGallery(Number(galBtn.dataset.gallery), { force: true }); return; }

    const trans = t.closest('[data-translate]');
    if (trans) { doTranslate(); return; }

    const arch = t.closest('[data-showarchived]');
    if (arch) { renderFiles(true, state.drawer.mod && state.drawer.mod.modId); return; }

    const sb = t.closest('[data-showbuiltin]');
    if (sb) { state.showBuiltin = !state.showBuiltin; renderInstalled(); return; }

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
      });
      return;
    }
    // 黑名单：「不喜欢」立刻拉黑 / 「移出黑名单」立刻恢复（都要抢在 .card 之前处理）
    const dislike = t.closest('[data-dislike]');
    if (dislike) { await dislikeMod(dislike.dataset.dislike); return; }

    const undislike = t.closest('[data-undislike]');
    if (undislike) { await undislikeMod(undislike.dataset.undislike); return; }

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
      await dlEnqueue(meta);
      return;
    }
    const dlAutoAuth = t.closest('[data-dl-autoauth]');
    if (dlAutoAuth) { await dlAutoAuthorize(dlAutoAuth.dataset.dlAutoauth); return; }
    if (t.closest('[data-dl-resumeall]')) { await dlResumeAll(); return; }
    if (t.closest('[data-dl-autoauthall]')) { await dlAutoAuthorizeAll(); return; }
    const dlAuth = t.closest('[data-dl-auth]');
    if (dlAuth) { await dlAuthorize(dlAuth.dataset.dlAuth); return; }
    const dlStartBtn = t.closest('[data-dl-start]');
    if (dlStartBtn) { await dlStart(dlStartBtn.dataset.dlStart); return; }
    const dlCancelBtn = t.closest('[data-dl-cancel]');
    if (dlCancelBtn) { await dlCancel(dlCancelBtn.dataset.dlCancel); return; }
    const dlConfirmBtn = t.closest('[data-dl-confirm]');
    if (dlConfirmBtn) { await dlConfirm(dlConfirmBtn.dataset.dlConfirm); return; }
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
    if (t.closest('[data-dl-cleardone]')) { await dlClearDone(); return; }
    if (t.closest('[data-dl-refreshplans]')) { await dlRefreshPlans(); return; }

    const card = t.closest('.card');
    if (card) {
      // 多选模式：点卡片 = 勾选/取消，不弹详情抽屉（要下载的那颗按钮仍单独生效）
      if (state.sel.on && card.dataset.modid) { selToggle(card.dataset.modid); return; }
      if (card.dataset.modid) openNexusDrawer(Number(card.dataset.modid));
      else if (card.dataset.id) {
        const m = state.installed.find(x => x.id === card.dataset.id);
        if (m) openInstalledDrawer(m);
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
      else if (id === 'impPick') await pickLocalArchive();
      else if (id === 'vReveal') { if (state.modalTask) await dlReveal(state.modalTask); closeModal(); }
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
    state.game = await call(window.api.game.setRoot(root));
    state.config = await call(window.api.config.get());
    await refreshAll();
    toast('游戏目录已设置', 'ok');
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

async function doUninstall(id) {
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
    closeDrawer();
    await refreshAll();
  } catch { /* 已提示 */ }
}

/* ---------------- 刷新 ---------------- */

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
    $('#verLine').textContent = 'v' + data.version + (data.packaged ? '' : ' · dev');
    await refreshPrereqs();
    renderSidebar();
    renderInstalled();
    renderDownload();
    renderPrereq();
    renderSettings();
    if (showToast) toast('已刷新', 'ok');
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
window.__batch = { batchDownload, selToggle, selSelectAll, selSetMode, selUpdateBar, pickPrimaryFile, batchSummary };
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

  await refreshAll();

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
