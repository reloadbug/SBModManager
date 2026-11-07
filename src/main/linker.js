'use strict';

/**
 * 本地 Mod ↔ Nexus Mod 关联（「批量解析」）。
 *
 * 场景：用户把游戏目录指到一份**别人装好的游戏**（或者自己早年手动丢进 `~Mods` 的一堆
 * pak），这些 mod 在注册表里没有记录 —— `localState.buildLocalIndex()` 只认
 * `meta.source.modId`，于是浏览页里全都显示成「未安装」，已安装页只有文件名、
 * 没有封面/作者/版本，条目也不能按 Mod 归组。
 *
 * 这个模块干的事：
 *   1. 把 Nexus 上**这个游戏的全部 mod**抓成一份本地目录（`cache/nexus-catalog.json`），
 *      一次 40 次请求、缓存 7 天 —— 比「每个本地 mod 搜一次」省得多，也不会撞配额；
 *   2. 拿磁盘上的名字（pak 基名 / 脚本目录名）跟目录里的名字做打分匹配，
 *      给出**候选 + 置信度**，而不是自作主张直接写死；
 *   3. 用户复核后把结果写进 `data/mod-links.json`，扫描时合并进条目，
 *      于是分组、封面、版本、Nexus 链接全部生效。
 *
 * ⚠️ 刻意**不做**的事：
 *   · 不抓网页、不猜 fileId（关联 ≠ 安装记录，`source.fileId` 一律留空）；
 *   · 不覆盖注册表里的真实记录 —— 有关联的条目只是「多知道了一个来源」，
 *     `registered` 仍然是 false，卸载/开关逻辑不受影响。
 */

const fs = require('fs');
const path = require('path');

const LINK_VERSION = 1;
const CATALOG_VERSION = 1;

/** 接口实测单页上限 80 条（要 100 也只回 80），翻页按这个步长走 */
const CATALOG_PAGE = 80;
/** 防御性上限：真出问题也不会无限翻页（80 × 60 = 4800 > 当前全量 3164） */
const CATALOG_MAX_PAGES = 60;
/** 目录缓存有效期：7 天。过期不算错，只是提示可以刷新 */
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 翻页之间的礼貌间隔，别把公开接口打崩 */
const PAGE_DELAY_MS = 120;

/* ------------------------------------------------------------------ *
 * 一、名字清洗
 * ------------------------------------------------------------------ */

/**
 * 噪声词：在「磁盘文件名」和「Nexus 标题」之间几乎不携带信息的词。
 *
 * 注意只放**确实没有区分度**的：`edit` / `version` / `fix` 这类是上传者的口头修饰
 * （`32A Daily Knitted Edit` 对的是 `Daily Knitted Dress`）；`cns` / `replacer`
 * 这些是**有意义**的（决定落点与玩法），必须留着 —— 它们靠 IDF 自然降权。
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'for', 'with', 'to', 'in', 'on',
  'mod', 'mods', 'pak', 'paks', 'file', 'files',
  'version', 'ver', 'update', 'updated', 'final', 'new', 'fix', 'fixed',
  'edit', 'edited', 'edition', 'variant', 'variants', 'optional', 'main',
  'by', 'from', 'at'
]);

/**
 * 包体后缀：清洗前先摘掉（`.dekcns` 是 CNS 的服装包后缀）。
 *
 * `.json` 是为了**注册表里的 manifest 相对路径**（`…/gutris1/6906-kunoichi-cns.dekcns.json`）
 * —— 那条通路进来的是「整条相对路径」，后缀层数是叠着的，所以下面要循环剥。
 */
const ARCHIVE_EXT = /\.(?:json|pak|ucas|utoc|dekcns|disabled|zip|7z|rar|bin)$/i;

/** 括号里的内容（作者名、变体说明）对匹配基本是噪声 */
const BRACKETS = /[（(\[【][^）)\]】]*[）)\]】]/g;

/**
 * camelCase / 连续大写边界 → 空格。
 *
 * `105EVEPinkBodysuit` 这种「编号 + 英文单词粘连」的写法在 pak 名里非常常见，
 * 不拆开就只有一个 token，跟 `Eve - Pink Bodysuit` 一个字都对不上。
 */
function splitCamelCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/**
 * 把磁盘上的名字压成「可比较的规范串」。
 *
 * 例：`32A Daily Knitted Edit-3214_P.pak` → `daily knitted`（编号、-3214、_P 全被摘掉）
 */
function normalizeName(raw) {
  let s = String(raw == null ? '' : raw);
  // 路径只剩最后一段：注册表里的 manifest 是「相对路径」，前面那些目录名
  // （`SB/Content/Paks/~mods/<作者>/`）对匹配没有任何帮助，反而会污染 token。
  const seg = s.split(/[\\/]+/).filter(Boolean).pop();
  if (seg) s = seg;
  s = splitCamelCase(s);
  // 后缀可能是叠着的（`.dekcns.json`），逐个剥
  for (let i = 0; i < 3 && ARCHIVE_EXT.test(s.trim()); i++) s = s.trim().replace(ARCHIVE_EXT, ' ');
  s = s.replace(BRACKETS, ' ');
  s = s.toLowerCase();
  s = s.replace(/[_\-+.,'’"`~!@#$%^&*={}<>?/\\|:;]+/g, ' ');
  const out = [];
  for (const t of s.split(/\s+/)) {
    if (!t) continue;
    if (STOPWORDS.has(t)) continue;
    // 纯数字 / 编号：`105`、`251225`、`41A`、`26B`、`A58`、`P635` 的 635…
    // ⚠️ 只摘「数字打头或单字母+数字」的短编号，`ff7`、`2b` 这种带含义的留着
    if (/^\d+$/.test(t)) continue;
    if (/^\d{1,5}[a-z]{1,2}$/.test(t)) continue;
    if (/^[a-z]\d{1,4}$/.test(t)) continue;
    /**
     * 单词后面直接粘着编号的（`whitepearl349`、`dress251225`）：把数字尾巴摘掉。
     *
     * 不摘的话 —— Nexus 上叫 `Whitepearl`、本地文件叫 `[songeda]whitepearl349`，
     * 两侧的 token 一个都对不上，明明是同一个人做的同一件衣服却匹配不到。
     * 只对「字母 ≥4 位」的词动手，`ff7`、`2b`、`v2` 这类短词保持原样。
     */
    let w = t;
    const tailStem = w.match(/^([a-z]{4,})\d+$/);
    if (tailStem) w = tailStem[1];
    const headStem = w.match(/^\d+([a-z]{4,})$/);
    if (headStem) w = headStem[1];
    if (STOPWORDS.has(w)) continue;
    if (w.length < 2) continue;
    out.push(w);
  }
  return out.join(' ');
}

/** 规范串 → token 数组（去重，保持顺序无关） */
function tokenize(normalized) {
  const set = new Set();
  for (const t of String(normalized || '').split(' ')) if (t) set.add(t);
  return [...set];
}

/* ------------------------------------------------------------------ *
 * 二、相似度打分
 * ------------------------------------------------------------------ */

/** 字符二元组 Dice 系数 —— 对拼写差异（单复数、空格、缩写）不敏感 */
function diceCoefficient(a, b) {
  const x = String(a || '').replace(/\s+/g, '');
  const y = String(b || '').replace(/\s+/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const grams = new Map();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n > 0) { hit++; grams.set(g, n - 1); }
  }
  return (2 * hit) / ((x.length - 1) + (y.length - 1));
}

/**
 * 倒排索引：token → 出现过的 mod 下标。
 *
 * 3164 个 mod 两两算相似度是 1000 万次比较，没必要 —— 只跟「至少共享一个 token」
 * 的候选比，几百个本地 mod 也能在几十毫秒内跑完。
 */
function buildIndex(mods) {
  const byToken = new Map();
  const df = new Map();
  const prepared = [];
  // modId → 下标：文件名里带 `[nx<modId>]` 的条目直接按 id 取，不用打分
  const byId = new Map();

  (Array.isArray(mods) ? mods : []).forEach((m, i) => {
    const norm = normalizeName(m && m.name);
    const tokens = tokenize(norm);
    prepared.push({ mod: m, norm, tokens, set: new Set(tokens) });
    const id = Number(m && m.modId);
    if (Number.isFinite(id) && id > 0 && !byId.has(id)) byId.set(id, i);
    for (const t of tokens) {
      df.set(t, (df.get(t) || 0) + 1);
      let list = byToken.get(t);
      if (!list) { list = []; byToken.set(t, list); }
      list.push(i);
    }
  });

  const total = prepared.length;
  const idf = (t) => Math.log((total + 1) / (1 + (df.get(t) || 0)));

  return { prepared, byToken, byId, df, idf, size: total };
}

/**
 * 打分：三个信号加权。
 *
 *   covLocal —— 本地名字里的 token 有多少**权重意义**上被候选盖住（主信号）
 *   covCand  —— 反过来，防止「本地叫 A、候选叫 A 的一长串全名」这种单边包含骗高分
 *   dice     —— 整串字符相似度，压住词序/拼写的差异
 *
 * 权重都用 IDF：`cns` / `eve` 这种到处都有的词几乎不加分，`undressable` / `monsoon`
 * 这种稀有词一分就是一分 —— 否则「所有带 CNS 的 mod」会互相乱配。
 */
function scoreCandidate(localNorm, localTokens, cand, index) {
  const { idf } = index;
  const candTokens = cand.tokens;
  if (!candTokens.length) return { score: 0, covLocal: 0, covCand: 0, dice: 0, shared: 0 };

  const sharedList = localTokens.filter(t => cand.set.has(t));
  const shared = sharedList.length;
  if (!shared) return { score: 0, covLocal: 0, covCand: 0, dice: 0, shared: 0 };

  let sumLocal = 0;
  let hitLocal = 0;
  for (const t of localTokens) {
    const w = idf(t);
    sumLocal += w;
    if (cand.set.has(t)) hitLocal += w;
  }

  let sumCand = 0;
  let hitCand = 0;
  for (const t of candTokens) {
    // 候选侧的权重也按 IDF 算，但把它自己的 token 计入 df 会让稀有词反而轻 ——
    // 用「本地是否命中」的二分权重更稳：命中 = 该 token 的 IDF，未命中 = 减半
    const w = idf(t);
    sumCand += w;
    if (localTokens.includes(t)) hitCand += w;
  }

  const covLocal = sumLocal > 0 ? hitLocal / sumLocal : 0;
  const covCand = sumCand > 0 ? hitCand / sumCand : 0;
  const dice = diceCoefficient(localNorm, cand.norm);

  let score = 0.62 * covLocal + 0.18 * covCand + 0.20 * dice;

  // 完全一致（清洗后同名）直接判满 —— 这是最常见的「pak 名就是 mod 名」
  if (localNorm && localNorm === cand.norm) score = 1;
  else if (localNorm.length >= 6 && cand.norm.includes(localNorm)) score = Math.min(0.95, score + 0.10);
  // 本地 token 全部命中（且不止一个）→ 大概率就是它
  if (covLocal === 1 && shared >= 2) score = Math.min(0.94, score + 0.05);

  return { score: Math.round(score * 1000) / 1000, covLocal, covCand, dice, shared };
}

/** 置信度分档（阈值对着真实数据调，见 `_probe/linker-test.js` 的固定用例） */
const HIGH = 0.78;
const MEDIUM = 0.56;
const LOW = 0.40;

function confidenceOf(score) {
  if (score >= HIGH) return 'high';
  if (score >= MEDIUM) return 'medium';
  if (score >= LOW) return 'low';
  return '';
}

/** 置信度降一档（`high → medium → low → ''`） */
function degrade(conf) {
  if (conf === 'high') return 'medium';
  if (conf === 'medium') return 'low';
  return conf === 'low' ? 'low' : '';
}

/** 候选对象（界面直接用这些字段渲染选中项） */
function toCandidate(mod, extra) {
  return Object.assign({
    modId: mod.modId,
    name: mod.name,
    author: mod.author || '',
    version: mod.version || '',
    image: mod.image || '',
    pictureUrl: mod.pictureUrl || '',
    summary: mod.summary || '',
    url: mod.url || '',
    downloads: mod.downloads || 0,
    endorsements: mod.endorsements || 0,
    adult: !!mod.adult
  }, extra || {});
}

/**
 * 「文件名里带标识」的直配：`名字 [nx2038].pak` → Nexus #2038。
 *
 * 这跟名字打分是**两种性质**的证据：打分是猜（最高 80% 准），这个是管理器安装时
 * 自己写进去的（用户 2026-11-07 的需求），只要号还在目录里就 100% 准。
 * 所以直接给 `confidence: 'high'`、`score: 1`、`matchedBy: 'tag'`，不走降档那一套。
 *
 * 目录里没有这个 modId（下架 / 缓存太旧 / 号写错了）时返回 best=null，
 * 由调用方退回名字打分 —— 有标识但目录查不到，总比直接放弃好。
 */
function tagMatch(item, index, tag) {
  const localId = String(item && item.id != null ? item.id : '');
  const localName = String(item && item.name != null ? item.name : '');
  const normalized = normalizeName(localName);
  const out = { localId, localName, normalized, best: null, candidates: [], ambiguous: false, thin: false, tagged: false };

  const id = Number(tag && tag.modId);
  if (!Number.isFinite(id) || id <= 0) return out;
  const idx = index && index.byId ? index.byId.get(id) : undefined;
  if (idx === undefined) return out;

  const cand = toCandidate(index.prepared[idx].mod, { score: 1, confidence: 'high', shared: 0, tagged: true, matchedBy: 'tag' });
  out.best = cand;
  out.candidates = [cand];
  out.tagged = true;
  return out;
}

/**
 * 给一个本地条目找候选。
 *
 * @param {{name:string, id:string, kind:string, tag?:{modId:number}, files?:Array}} item 扫描出来的条目
 * @param {object} index `buildIndex()` 的结果
 * @param {{limit?:number}} [options]
 * @returns {{ localId:string, localName:string, normalized:string, best:object|null, candidates:object[], tagged?:boolean }}
 */
function suggestFor(item, index, options = {}) {
  const limit = Math.max(1, Math.floor(Number(options.limit) || 6));
  const localName = String(item && item.name != null ? item.name : '');
  const normalized = normalizeName(localName);
  const localTokens = tokenize(normalized);
  const localId = String(item && item.id != null ? item.id : '');

  // 文件名的标识优先：管理器自己写的号，比任何名字相似度都可靠
  if (item && item.tag) {
    const exact = tagMatch(item, index, item.tag);
    if (exact.best) return exact;
  }

  const empty = { localId, localName, normalized, best: null, candidates: [], tagged: false };
  if (!normalized || !localTokens.length) return empty;

  // 候选集：共享任意一个 token 的 mod
  const seen = new Set();
  const candIdx = [];
  for (const t of localTokens) {
    for (const i of (index.byToken.get(t) || [])) {
      if (seen.has(i)) continue;
      seen.add(i);
      candIdx.push(i);
      if (candIdx.length > 4000) break;                // 极端兜底
    }
  }
  if (!candIdx.length) return empty;

  const scored = [];
  for (const i of candIdx) {
    const cand = index.prepared[i];
    const r = scoreCandidate(normalized, localTokens, cand, index);
    if (!r.shared || r.score < LOW) continue;
    scored.push(toCandidate(cand.mod, { score: r.score, confidence: confidenceOf(r.score), shared: r.shared }));
  }
  if (!scored.length) return empty;

  // 同分时用下载量兜底：用户装的大多数是流行 mod，别让冷门同名项抢位
  scored.sort((a, b) => (b.score - a.score) || (b.downloads - a.downloads));

  /**
   * 「说得清但挑不准」要降档。
   *
   * 实测样本：`41A Racer's High Edit-4114_P` 对上一堆 `Racer's High` 变体
   * （543 / 1817 / 2694 …），每个 token 都命中、分数都 0.9 上下 —— 这种时候
   * **最高分几乎等于掷骰子**，直接标「高置信」会让用户一键接受一堆错关联。
   * 判据：与前几名挤在 0.03 以内的对手达到 3 个，就降一档，界面上仍给出候选供手选。
   */
  const near = scored.filter(c => scored[0].score - c.score <= 0.03).length;
  const ambiguous = near >= 3;
  if (ambiguous) {
    for (const c of scored) c.confidence = degrade(c.confidence);
    scored[0].ambiguous = true;
  }

  /**
   * 名字太单薄（只有一个 token、还短）时同样降档。
   *
   * 实测样本：`santa_P.dekcns` 只剩一个 `santa`，对上了 `SantaEve`（0.907）——
   * 分数高只是因为字符像，语义上完全可能对错。这类一律不让「一键接受高置信」碰到。
   */
  const thin = localTokens.length < 2 && normalized.length < 6;
  if (thin) {
    for (const c of scored) c.confidence = degrade(c.confidence);
    scored[0].thin = true;
  }

  return {
    localId,
    localName,
    normalized,
    best: scored[0],
    candidates: scored.slice(0, limit),
    ambiguous,
    thin,
    tagged: false
  };
}

/** 一眼看去「可以自动接受」的结果：高置信，且第一名明显领先第二名 */
function isConfident(result) {
  if (!result || !result.best) return false;
  if (result.best.confidence !== 'high') return false;
  const second = result.candidates[1];
  if (!second) return true;
  return result.best.score - second.score >= 0.05;
}

/* ------------------------------------------------------------------ *
 * 三、Nexus 目录缓存
 * ------------------------------------------------------------------ */

function readJsonSafe(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 读目录缓存（不做网络请求）。
 * @returns {{ fetchedAt:number, mods:Array, stale:boolean }|null}
 */
function readCatalog(file) {
  const json = readJsonSafe(file, null);
  if (!json || json.version !== CATALOG_VERSION || !Array.isArray(json.mods) || !json.mods.length) return null;
  const fetchedAt = Number(json.fetchedAt) || 0;
  return { fetchedAt, mods: json.mods, stale: Date.now() - fetchedAt > CATALOG_TTL_MS };
}

/**
 * 抓全量目录（或复用未过期的缓存）。
 *
 * @param {{ file:string, nexus:object, force?:boolean, onProgress?:Function, shouldStop?:Function, pageDelay?:number }} opts
 */
async function loadCatalog(opts) {
  const { file, nexus, force = false, onProgress, shouldStop, pageDelay = PAGE_DELAY_MS } = opts || {};
  if (!nexus) throw new Error('缺少 Nexus 客户端');

  if (!force) {
    const hit = readCatalog(file);
    if (hit && !hit.stale) return { ...hit, fromCache: true };
  }

  const seen = new Map();
  let offset = 0;
  let total = 0;

  for (let page = 0; page < CATALOG_MAX_PAGES; page++) {
    if (shouldStop && shouldStop()) throw new Error('已取消');
    const res = await nexus.listMods({ sort: 'downloads', offset, count: CATALOG_PAGE, adultMode: 'all' });
    const items = Array.isArray(res && res.items) ? res.items : [];
    total = Number(res && res.total) || total;
    for (const m of items) if (m && m.modId != null) seen.set(Number(m.modId), m);
    offset += items.length;
    if (onProgress) {
      onProgress({
        phase: 'catalog',
        loaded: seen.size,
        total: total || seen.size,
        page: page + 1
      });
    }
    if (!items.length || (total && seen.size >= total)) break;
    if (!items.length || offset >= total) break;
    if (pageDelay) await sleep(pageDelay);
  }

  const mods = [...seen.values()].map(m => ({
    modId: Number(m.modId),
    name: m.name,
    summary: m.summary || '',
    version: m.version || '',
    author: m.author || '',
    image: m.image || m.pictureUrl || '',
    pictureUrl: m.pictureUrl || '',
    url: m.url || `https://www.nexusmods.com/stellarblade/mods/${m.modId}`,
    downloads: m.downloads || 0,
    endorsements: m.endorsements || 0,
    category: m.category || '',
    categoryZh: m.categoryZh || '',
    adult: !!m.adult,
    updatedAt: m.updatedAt || null
  }));
  if (!mods.length) throw new Error('没能从 Nexus 取到 mod 目录');

  const payload = { version: CATALOG_VERSION, fetchedAt: Date.now(), count: mods.length, mods };
  writeJsonAtomic(file, payload);
  return { fetchedAt: payload.fetchedAt, mods, stale: false, fromCache: false };
}

/* ------------------------------------------------------------------ *
 * 四、关联存储（data/mod-links.json）
 * ------------------------------------------------------------------ */

/**
 * 关联记录：**按本地条目 id 存**。
 *
 * 为什么用扫描出来的 id（`disk:paks:<基名>` / `disk:script:<目录名>`）当键：
 * 它在同一次磁盘布局下是**稳定且唯一**的，重启也不会变；而 pak 被装了又卸载、
 * 换了文件名的情形本来就该重新解析（见 `unlink`），不需要更复杂的指纹。
 */
function readLinks(file) {
  const json = readJsonSafe(file, null);
  if (!json || json.version !== LINK_VERSION || !json.links || typeof json.links !== 'object') {
    return { version: LINK_VERSION, links: {} };
  }
  return { version: LINK_VERSION, links: { ...json.links } };
}

function writeLinks(file, db) {
  writeJsonAtomic(file, { version: LINK_VERSION, links: db.links || {} });
}

/** 供扫描器合并用的只读视图：`links.get(id)` 语义跟 registry 一致 */
function linkReader(file) {
  const db = readLinks(file);
  return {
    get: (id) => db.links[id] || null,
    all: () => Object.entries(db.links).map(([localId, v]) => ({ localId, ...v })),
    count: () => Object.keys(db.links).length
  };
}

/** 把一条关联写进去（同一 localId 覆盖） */
function putLink(file, localId, link) {
  const db = readLinks(file);
  db.links[localId] = { ...link, localId, at: new Date().toISOString() };
  writeLinks(file, db);
  return db.links[localId];
}

function removeLink(file, localId) {
  const db = readLinks(file);
  if (!db.links[localId]) return false;
  delete db.links[localId];
  writeLinks(file, db);
  return true;
}

/** 清掉所有指向某个 Nexus mod 的关联（卸载该 mod 时顺手清理） */
function removeLinksByModId(file, modId) {
  const db = readLinks(file);
  let n = 0;
  for (const [localId, v] of Object.entries(db.links)) {
    if (Number(v && v.modId) === Number(modId)) { delete db.links[localId]; n++; }
  }
  if (n) writeLinks(file, db);
  return n;
}

/**
 * 把关联记录合并进扫描结果。
 *
 * 只在**没有注册表记录**的条目上生效（`registered === true` 的条目自带真实来源，
 * 不能被猜出来的关联覆盖）。合并后：
 *   · `meta.source.modId` 有了 → `localState` 认它是已安装，浏览页正确显示；
 *   · `meta.image` / `meta.pictureUrl` 有了 → 卡片有封面；
 *   · `meta.url` 有了 → 抽屉里能点回 Nexus 页面。
 */
function applyToScanned(items, reader) {
  if (!reader || !Array.isArray(items)) return items;
  for (const m of items) {
    if (!m || m.registered) continue;
    const link = reader.get(m.id);
    if (!link || !link.modId) continue;
    const meta = { ...(m.meta || {}) };
    meta.linked = true;
    meta.modId = Number(link.modId);
    meta.source = {
      modId: Number(link.modId),
      fileId: null,
      version: link.version || '',
      author: link.author || '',
      pictureUrl: link.pictureUrl || '',
      summary: link.summary || ''
    };
    if (link.name) meta.name = link.name;
    if (link.image) meta.image = link.image;
    if (link.url) meta.url = link.url;
    if (link.updatedAt) meta.updatedAt = link.updatedAt;
    m.meta = meta;
    m.linked = true;
    m.link = link;
    if (link.name) m.name = link.name;
  }
  return items;
}

module.exports = {
  LINK_VERSION,
  CATALOG_VERSION,
  CATALOG_PAGE,
  CATALOG_MAX_PAGES,
  CATALOG_TTL_MS,
  STOPWORDS,
  normalizeName,
  tokenize,
  diceCoefficient,
  buildIndex,
  scoreCandidate,
  confidenceOf,
  toCandidate,
  tagMatch,
  suggestFor,
  isConfident,
  readCatalog,
  loadCatalog,
  readLinks,
  writeLinks,
  linkReader,
  putLink,
  removeLink,
  removeLinksByModId,
  applyToScanned,
  HIGH,
  MEDIUM,
  LOW
};
