'use strict';
const https = require('https');
const { bbcodeToHtml, bbcodeToText } = require('./bbcode');

/**
 * Nexus Mods 数据客户端。
 *
 * 说明：走 api.nexusmods.com 的官方 v2 GraphQL 接口。
 * 实测该接口在未登录状态下即可读取公开的 mod 元数据（名称/说明/图片/文件列表），
 * 因此"浏览 mod"功能开箱可用，不强制要求 API Key。
 * 若用户在设置里填了个人 API Key，会带上 apikey 头以获得更高的配额。
 *
 * 刻意不抓取网页：网页有 Cloudflare 人机验证，且抓取违反服务条款。
 */

const HOST = 'api.nexusmods.com';
const GRAPHQL_PATH = '/v2/graphql';
const USER_AGENT = 'StarBladeModManager/0.1 (Windows; Node)';

const GAME_DOMAIN = 'stellarblade';
const GAME_ID = 7804; // stellarblade，实测自 API

function collectModImages(mod, description = '') {
  const values = [mod.pictureUrl, mod.thumbnailLargeUrl, mod.thumbnailUrl];
  const bbcodeImages = String(description || '').matchAll(/\[img\]([\s\S]*?)\[\/img\]/gi);
  for (const match of bbcodeImages) values.push(match[1]);

  const seen = new Set();
  const images = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
      if (!seen.has(parsed.href)) {
        seen.add(parsed.href);
        images.push(parsed.href);
      }
    } catch {}
  }
  return images;
}

const MOD_FIELDS = `
  modId name summary version author
  pictureUrl thumbnailUrl thumbnailLargeUrl
  downloads endorsements category adultContent
  createdAt updatedAt
`;

const SORTS = {
  downloads: 'downloads',
  endorsements: 'endorsements',
  newest: 'createdAt',
  updated: 'updatedAt'
};

/**
 * 剑星在 Nexus 上的官方分类。
 *
 * 实测（2026-10）：剑星总共只有这 5 个分类，而且**完备覆盖**——
 * 各分类 mod 数相加正好等于全部 mod 数（1742+332+575+224+190 = 3063），
 * 即每个 mod 必属其一，筛选不会漏。
 *
 * 注意：`categories(gameId)` 返回的是另一套东西（Total Overhaul / Themed /
 * Vanilla Plus / Essentials / Miscellaneous，全是跨游戏的通用分类），
 * 和 mod 上 `category` 字段的取值**不是一回事**，别拿它做筛选。
 */
const CATEGORIES = [
  { value: 'Outfits', zh: '服装' },
  { value: 'Gameplay', zh: '玩法' },
  { value: 'Miscellaneous', zh: '杂项' },
  { value: 'User Interface', zh: '界面' },
  { value: 'Visuals', zh: '视觉' }
];

/**
 * 剑星 mod 实际在用的标签。
 *
 * 注意：`tags(gameId)` 只返回 23 个**全局**标签（Wabbajack Compatible /
 * PS4 / Xbox / Fallout Collectionathon 这些，剑星基本没人用），
 * 剑星真正在用的是 legacy 标签，过滤接口 `tag:{value:"..."}` 接受它们，
 * 但 `tags()` 查不出来 —— 所以这里手工固化，数量用别名批量请求实时取。
 *
 * 列表按 mod 数取前 9（>=50 个），并剔除了与分类重名的 Gameplay / User Interface。
 */
const TAGS = [
  { value: 'Sexualised', zh: '性感化' },
  { value: 'Character Preset', zh: '角色预设' },
  { value: 'Pornographic', zh: '色情' },
  { value: 'Models/Meshes', zh: '模型网格' },
  { value: 'Replacer', zh: '替换' },
  { value: 'Textures', zh: '材质' },
  { value: 'Quality of Life', zh: '体验优化' },
  { value: 'English', zh: '英文' },
  { value: 'Utilities for Players', zh: '玩家工具' }
];

const CATEGORY_ZH = Object.fromEntries(CATEGORIES.map(c => [c.value, c.zh]));

/** 过滤值要拼进 GraphQL 字符串字面量，先把引号和反斜杠摘掉 */
function sanitizeValue(v) {
  return String(v == null ? '' : v).replace(/["\\]/g, '').trim();
}

/**
 * 成人内容过滤三态。
 *   hide → 只显示非成人（`adultContent:{value:false}`）
 *   all  → 不过滤，成人与非成人全显示
 *   only → 只显示成人（`adultContent:{value:true}`）
 *
 * 实测（2026-10）剑星：全部 3063 = 非成人 1772 + 成人 1291，三态自洽。
 */
const ADULT_MODES = ['hide', 'all', 'only'];

function normalizeAdultMode(mode) {
  return ADULT_MODES.includes(mode) ? mode : 'all';
}

/**
 * 构造 mods 查询的 filter 片段。纯函数，抽出来是为了能离线钉死语法。
 *
 * 两个坑（都实测踩过）：
 *   1. 同一对象里不能重复写 `tag` 字段 —— GraphQL 不允许重复键，
 *      多选必须走嵌套 `filter:[...]`。
 *   2. `op` 作用于**同层所有字段**：把 op:OR 写在顶层会把 gameDomainName
 *      也一起 OR 掉（实测返回 123651 = 全站 mod，而不是剑星的 3063）。
 *      所以 OR 必须关进嵌套层：外层保持默认 AND，内层显式 OR。
 */
function buildModsFilter({ search = '', category = '', tags = [], adultMode = 'all' } = {}) {
  const filters = [`gameDomainName:{value:"${GAME_DOMAIN}"}`];

  if (search && search.trim()) {
    filters.push(`name:{value:"${sanitizeValue(search)}", op:WILDCARD}`);
  }

  const cat = sanitizeValue(category);
  if (cat) filters.push(`categoryName:{value:"${cat}"}`);

  const tagList = (Array.isArray(tags) ? tags : []).map(sanitizeValue).filter(Boolean);
  if (tagList.length === 1) {
    filters.push(`tag:{value:"${tagList[0]}"}`);
  } else if (tagList.length > 1) {
    filters.push(`filter:[{op:OR, filter:[${tagList.map(t => `{tag:{value:"${t}"}}`).join(',')}]}]`);
  }

  const mode = normalizeAdultMode(adultMode);
  if (mode === 'hide') filters.push('adultContent:{value:false}');
  else if (mode === 'only') filters.push('adultContent:{value:true}');
  // 'all' → 不加任何 adultContent 条件

  return { filters, cat, tagList, adultMode: mode };
}

/** 极简内存缓存（带 TTL），避免频繁打接口 */
function makeCache(ttlMs) {
  const m = new Map();
  return {
    get(k) {
      const v = m.get(k);
      if (!v) return null;
      if (Date.now() - v.t > ttlMs) { m.delete(k); return null; }
      return v.d;
    },
    set(k, d) { m.set(k, { t: Date.now(), d }); },
    clear() { m.clear(); },
    size: () => m.size
  };
}

function createNexus({ getApiKey, timeout = 20000 } = {}) {
  const cache = makeCache(10 * 60 * 1000);

  function request(query, { cacheKey, ttl } = {}) {
    if (cacheKey) {
      const hit = cache.get(cacheKey);
      if (hit) return Promise.resolve(hit);
    }
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ query });
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
        'User-Agent': USER_AGENT
      };
      const key = getApiKey && getApiKey();
      if (key) headers['apikey'] = key;

      const req = https.request({ hostname: HOST, path: GRAPHQL_PATH, method: 'POST', headers }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          let json;
          try { json = JSON.parse(d); }
          catch { return reject(new Error(`Nexus 返回了非 JSON 内容（HTTP ${res.statusCode}）`)); }

          if (json.errors && json.errors.length) {
            const msg = json.errors.map(e => e.message).join('; ');
            return reject(new Error('Nexus API 错误：' + msg));
          }
          const data = json.data;
          if (cacheKey) cache.set(cacheKey, data);
          resolve(data);
        });
      });
      req.on('error', e => reject(new Error('网络请求失败：' + e.message)));
      req.setTimeout(timeout, () => { req.destroy(new Error('请求超时')); });
      req.write(body);
      req.end();
    });
  }

  /** 列表 / 搜索 */
  async function listMods({ sort = 'downloads', search = '', offset = 0, count = 24, adultMode = 'all', category = '', tags = [] } = {}) {
    const { filters, cat, tagList, adultMode: mode } = buildModsFilter({ search, category, tags, adultMode });

    const sortField = SORTS[sort] || SORTS.downloads;
    const q = `{
      mods(
        filter:{${filters.join(', ')}},
        sort:[{${sortField}:{direction:DESC}}],
        offset:${offset}, count:${count}
      ) { totalCount nodesCount nodes { ${MOD_FIELDS} } }
    }`;

    const key = `list:${sort}:${search}:${offset}:${count}:${mode}:${cat}:${tagList.join('|')}`;
    const data = await request(q, { cacheKey: key });
    const page = data.mods || {};
    return {
      total: page.totalCount || 0,
      offset,
      count,
      items: (page.nodes || []).map(normalizeMod)
    };
  }

  /**
   * 筛选器计数（分类 / 标签各有多少个 mod）。
   *
   * 用 GraphQL 别名把 N 个查询压进**一次**请求，避免逐个打接口。
   * 分类计数按「整个游戏」算（这样能看出分布）；标签计数按**当前分类**算
   * （已选分类时更贴近实际会看到的结果）。
   */
  async function getFacets({ category = '', adultMode = 'all' } = {}) {
    const cat = sanitizeValue(category);
    const mode = normalizeAdultMode(adultMode);

    // 分类计数：不带分类条件（要看整个游戏的分布）
    const catAliases = CATEGORIES.map((c, i) => {
      const { filters } = buildModsFilter({ category: c.value, adultMode: mode });
      return `c${i}: mods(filter:{${filters.join(', ')}}, count:1){ totalCount }`;
    });

    // 标签计数：带上当前已选分类（这样计数贴近实际会看到的结果）
    const tagAliases = TAGS.map((t, i) => {
      const { filters } = buildModsFilter({ category: cat, tags: [t.value], adultMode: mode });
      return `t${i}: mods(filter:{${filters.join(', ')}}, count:1){ totalCount }`;
    });

    // ⚠️ 计数必须和列表用同一套开关，否则会出现「筛选器说 3063、列表只有 1772」的自相矛盾。
    const { filters: allFilters } = buildModsFilter({ adultMode: mode });
    const q = `{
      all: mods(filter:{${allFilters.join(', ')}}, count:1){ totalCount }
      ${catAliases.join('\n      ')}
      ${tagAliases.join('\n      ')}
    }`;

    const data = await request(q, { cacheKey: `facets:${cat}:${mode}` }).catch(() => null);
    const num = (node) => (node && Number(node.totalCount)) || 0;
    // facets 只是「增强」（chip 上那个数字）。取不到时**不要抛** ——
    // 否则筛选器会整个消失，用户连点都点不了。降级成「没有计数但可点」。
    return {
      degraded: !data,
      total: data ? num(data.all) : null,
      categories: CATEGORIES.map((c, i) => ({ ...c, count: data ? num(data['c' + i]) : null })),
      tags: TAGS.map((t, i) => ({ ...t, count: data ? num(data['t' + i]) : null }))
    };
  }

  /** 单个 mod 详情（含说明） */
  async function getMod(modId) {
    const q = `{
      mod(modId:${Number(modId)}, gameId:${GAME_ID}) {
        ${MOD_FIELDS}
        description
      }
    }`;
    const data = await request(q, { cacheKey: `mod:${modId}` });
    if (!data.mod) throw new Error('未找到该 Mod');
    const m = normalizeMod(data.mod, data.mod.description || '');
    m.description = data.mod.description || '';
    m.descriptionHtml = bbcodeToHtml(m.description);
    m.descriptionText = bbcodeToText(m.description);
    m.url = `https://www.nexusmods.com/${GAME_DOMAIN}/mods/${m.modId}`;
    return m;
  }

  /** 文件列表 */
  const FILE_CATEGORY_ZH = {
    MAIN: '主文件', UPDATE: '更新', OPTIONAL: '可选文件',
    OLD_VERSION: '旧版本', MISCELLANEOUS: '杂项',
    REMOVED: '已移除', ARCHIVED: '已归档'
  };

  async function getModFiles(modId) {
    const q = `{
      modFiles(modId:${Number(modId)}, gameId:${GAME_ID}) {
        name fileId version size description categoryId category primary date
      }
    }`;
    const data = await request(q, { cacheKey: `files:${modId}` });
    const list = (data.modFiles || []).map(f => {
      const cat = String(f.category || '').toUpperCase();
      return {
        fileId: f.fileId,
        name: f.name,
        version: f.version,
        size: f.size,
        sizeInBytes: Number(f.size) || 0,
        description: f.description || '',
        categoryId: f.categoryId,
        categoryRaw: cat,
        category: FILE_CATEGORY_ZH[cat] || (cat ? cat : '其他'),
        primary: !!f.primary,
        date: f.date ? (typeof f.date === 'object' && f.date.timestamp ? f.date.timestamp : f.date) : null
      };
    });

    // 排序：主文件优先 → 可选/更新 → 已归档垫底；同组内版本新的在前
    const rank = (f) => (f.primary ? 0 : ({ MAIN: 0, UPDATE: 1, OPTIONAL: 2, MISCELLANEOUS: 3, OLD_VERSION: 4, ARCHIVED: 5 }[f.categoryRaw] ?? 4));
    list.sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r) return r;
      return String(b.version).localeCompare(String(a.version), undefined, { numeric: true });
    });
    return list;
  }

  function normalizeMod(n, description = '') {
    return {
      modId: n.modId,
      images: collectModImages(n, description),
      name: n.name || ('Mod #' + n.modId),
      summary: n.summary || '',
      version: n.version || '',
      author: n.author || '',
      image: n.pictureUrl || n.thumbnailLargeUrl || n.thumbnailUrl || '',
      pictureUrl: n.pictureUrl || '',
      thumbnail: n.thumbnailUrl || n.pictureUrl || '',
      downloads: n.downloads || 0,
      endorsements: n.endorsements || 0,
      category: n.category || '',
      categoryZh: CATEGORY_ZH[n.category] || n.category || '未分类',
      adult: !!n.adultContent,
      createdAt: n.createdAt || null,
      updatedAt: n.updatedAt || null,
      url: `https://www.nexusmods.com/${GAME_DOMAIN}/mods/${n.modId}`
    };
  }

  return { listMods, getFacets, getMod, getModFiles, clearCache: () => cache.clear(), GAME_DOMAIN, GAME_ID };
}

/**
 * 从文件列表里挑「第一个主文件」—— 与渲染层 `src/renderer/app.js` 的 `pickPrimaryFile` **同口径**。
 *
 * `getModFiles` 已经按「primary → MAIN → UPDATE → …」排好序，这里再兜一层是为了：
 *   · 让**主进程**也能独立挑（自动授权前现场补 fileId 要用，见 ipc.js `autoAuthorizeTask`）；
 *   · 保证主进程与渲染层挑出来的**永远是同一个文件**，不会出现「卡片上写 A、实际下 B」。
 */
function pickPrimaryFile(files) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return null;
  return list.find(f => f.primary) || list.find(f => f.categoryRaw === 'MAIN') || list[0];
}

module.exports = { createNexus, buildModsFilter, ADULT_MODES, GAME_DOMAIN, GAME_ID, SORTS, CATEGORIES, TAGS, collectModImages, pickPrimaryFile };
