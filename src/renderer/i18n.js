/* ---------------- 多语言（i18n）核心 + DOM 翻译器 ----------------
 *
 * ## 设计：中文原文即 key，翻译发生在 **DOM 层**
 *
 * 上一轮试过「把源码里的 `'中文'` 机械改写成 `t('中文')`」，结果在正则字面量上翻车：
 *
 *     .replace(/"/g, '&quot;')
 *                ^ 这个引号被当成了字符串开头
 * 状态机一路吃到下一个引号，把 4357 行的 app.js 改成了 914 行的语法废料。
 *
 * 所以这一版**一个字都不改 app.js**：界面照旧用中文渲染，渲染完再由本模块
 * 遍历 DOM，把文本节点和 `title`/`placeholder` 里的中文查表换成目标语言。
 *
 * 好处：
 *   · 零侵入 —— 业务代码不知道 i18n 的存在，不可能被改坏
 *   · 天然覆盖动态内容 —— mutation 观察器盯着新增节点，$('#toast').textContent = '已取消'
 *     这种也照样翻译
 *   · **字典里没有的就不动** —— Mod 名字、作者名、文件路径原样保留，不会被瞎翻
 *
 * 代价：像 `共 ${n} 个 Mod` 这种拼出来的句子在 DOM 里是三个文本节点
 * （`共 ` / `3` / ` 个 Mod`），只能逐段翻译，语序会有点硬。
 * 这类高频统计行单独在字典里给了完整句子的写法兜底。
 *
 * ## 语言包
 *
 * `locales/<code>.js`，一个文件一件事：
 *     I18N.register('en-US', { '下载管理': 'Downloads', … });
 * 用 `<script>` 引入而不是 fetch：界面 CSP 是 `script-src 'self'`，
 * 脚本文件最省事，也不会被 file:// 的 fetch 限制咬到。
 */

(function (global) {
  'use strict';

  /** 支持的语言。native = 该语言自己的写法（下拉框里显示这个） */
  const LANGS = [
    { code: 'zh-CN', native: '简体中文', english: 'Simplified Chinese' },
    { code: 'zh-TW', native: '繁體中文', english: 'Traditional Chinese' },
    { code: 'en-US', native: 'English', english: 'English' },
    { code: 'ja-JP', native: '日本語', english: 'Japanese' },
    { code: 'ko-KR', native: '한국어', english: 'Korean' },
    { code: 'ru-RU', native: 'Русский', english: 'Russian' },
    { code: 'de-DE', native: 'Deutsch', english: 'German' },
    { code: 'fr-FR', native: 'Français', english: 'French' },
    { code: 'es-ES', native: 'Español', english: 'Spanish' },
    { code: 'pt-BR', native: 'Português (Brasil)', english: 'Brazilian Portuguese' },
    { code: 'it-IT', native: 'Italiano', english: 'Italian' },
    { code: 'pl-PL', native: 'Polski', english: 'Polish' },
    { code: 'tr-TR', native: 'Türkçe', english: 'Turkish' },
    { code: 'th-TH', native: 'ไทย', english: 'Thai' }
  ];

  const DICTS = Object.create(null);
  /**
   * 片段缓存：code → [[key, value], …]，按 key 长度降序。
   * 声明放在最前面 —— `register()` 里会 `delete` 它，
   * 而 `const` 有 TDZ，晚声明的话初始化期间调用 register 会炸。
   */
  const fragCache = Object.create(null);
  /** 'auto' = 跟随系统；否则是上面某个 code */
  let current = 'auto';
  /** 语言变更时的回调（渲染层用它重画一遍界面） */
  const listeners = [];

  const store = {
    get(key) { try { return global.localStorage && global.localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { if (global.localStorage) global.localStorage.setItem(key, val); } catch { /* 隐私模式 */ } }
  };

  function register(code, dict) {
    if (!code || !dict) return;
    DICTS[code] = Object.assign(Object.create(null), DICTS[code] || null, dict);
    // 片段缓存是按字典算出来的，字典变了就得让它重新算
    if (typeof fragCache !== 'undefined') delete fragCache[code];
  }

  function has(code) { return !!DICTS[code]; }
  function size(code) { return DICTS[code] ? Object.keys(DICTS[code]).length : 0; }

  /** 系统语言 → 我们支持的 code（'zh' → 'zh-CN'，'en' → 'en-US'，取不到就 null） */
  function systemLang() {
    const nav = global.navigator || {};
    const raw = nav.language || (nav.languages && nav.languages[0]) || '';
    const lc = String(raw).toLowerCase();
    if (!lc) return null;
    if (lc.startsWith('zh')) return /tw|hk|mo|hant/.test(lc) ? 'zh-TW' : 'zh-CN';
    if (lc.startsWith('ja')) return 'ja-JP';
    if (lc.startsWith('ko')) return 'ko-KR';
    if (lc.startsWith('de')) return 'de-DE';
    if (lc.startsWith('fr')) return 'fr-FR';
    if (lc.startsWith('es')) return 'es-ES';
    if (lc.startsWith('pt')) return 'pt-BR';
    if (lc.startsWith('it')) return 'it-IT';
    if (lc.startsWith('pl')) return 'pl-PL';
    if (lc.startsWith('tr')) return 'tr-TR';
    if (lc.startsWith('th')) return 'th-TH';
    if (lc.startsWith('en')) return 'en-US';
    if (lc.startsWith('ru')) return 'ru-RU';
    return null;
  }

  /** 实际生效的语言（'auto' 时按系统推断，兜底中文） */
  function effective() {
    if (current !== 'auto') return current;
    return systemLang() || 'zh-CN';
  }

  /* ---------------- 查表 ---------------- */

  /* ---------------- 分段兜底 ----------------
   *
   * 界面里大量文案是模板串拼出来的：`${n} 项待处理`。innerHTML 一解析，
   * 数字和文字就合并成**一个**文本节点「23 项待处理」，
   * 而字典里只有静态片段「项待处理」—— 整串查表必然落空。
   * 实测英文界面上残留的几十处中文，九成都是这么来的。
   *
   * 兜底分三层，安全性从高到低，前一层没命中才走下一层：
   *   ① 整串查表
   *   ② 从**两头**剥掉噪声（装饰符号 / 数字 / 括号）**再整串查表**
   *   ③ 用较长的字典片段做子串替换
   *
   * ② 之所以安全，是因为它要求「剥完之后剩下的部分**正好等于**某个字典 key」，
   *    而且剥掉的部分只能是非词字符 —— 前缀后缀原样拼回去，语序不会动。
   * ③ 是模糊匹配，所以额外要求「结果里不再有中文」：
   *    宁可在个别句子上留着中文，也不要吐出
   *    「已缓存 230 cached translations」这种半吊子。
   */

  /** 装饰性前缀不给白名单，改成通用规则：**只要不是汉字、假名、谚文、拉丁字母，就都算噪声**。
   *  白名单一开始只列了 ⬇ ✓ ↻，结果 `♥ 1.3 万`、`🚫 不喜欢`、`↓ 已下载` 全漏了 ——
   *  emoji 几千个，列不完。 */
  const WORD_CH = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;   // 汉字 / 假名 / 谚文
  const LATIN_CH = /[A-Za-z_]/;

  /**
   * 片段替换的准入门槛。两字词（安装 / 下载 / 已安装）看着无害，
   * 但 Mod 名里太容易撞上（"伊芙替换装"），所以只认三字及以上的片段。
   */
  const MIN_FRAGMENT = 3;

  /** 是否还含汉字 / 日文假名（片段替换后的验收标准） */
  function hasCJK(s) { return /[\u4e00-\u9fff\u3040-\u30ff]/.test(s); }

  /**
   * 译文本身就带汉字 / 假名的语言。
   *
   * 片段替换的验收标准是「结果里不能再有中文」—— 这条对它们**不成立**：
   * 繁体中文的译文当然是汉字，日文也照用汉字。若照搬这条规则，
   * zh-TW / ja-JP 的片段通路会 100% 失效，用户看到的是**简体原文**
   * （比"译得不够干净"糟糕得多）。所以这两种语言只要求「确实替换过」。
   *
   * 其余 11 种语言保持严格验收 —— 宁可留一句中文，也不要吐出
   * 「已缓存 230 cached translations」这种半吊子。
   */
  const HAN_NATIVE = new Set(['zh-TW', 'ja-JP']);

  /* ---------- 数字模板（句中夹数字的长句） ---------- */

  /**
   * 模板占位符：`%s`。
   *
   * DOM 方案最大的短板就是**句中夹数字**：
   *   `显示 UE4SS 自带的 10 个内置脚本模组`
   * 拆成片段是 `显示 UE4SS 自带的` + ` 个内置脚本模组`，两段都在字典里，
   * 但替换完还剩一个数字卡在中间 —— 结果是「Show UE4SS's 10 built-in…」，
   * 语序由译文决定，硬拼必然不通顺（日语要把数字放前面、俄语要变格）。
   *
   * 所以给这类句子单独一条通路：字典里用 `%s` 标记数字位，
   * 匹配时 `%s` 通配任意数字串，命中后把**实际数字原样回填**进译文。
   *   key   `显示 UE4SS 自带的 %s 个内置脚本模组`
   *   value `显示 UE4SS 内置的 %s 个脚本` → en: `Show UE4SS's %s built-in scripts`
   *   DOM   `显示 UE4SS 自带的 10 个内置脚本模组` → `Show UE4SS's 10 built-in scripts`
   *
   * 数字串的定义：1 个数字起，允许夹千分位逗号 / 小数点 / 数字间空格
   * （`3,027`、`100.7`、`1 234` 都要一次吃完，"7 天" 这种则只吃 `7`）。
   */
  const SHAPE_TOKEN = '%s';
  const NUM_RUN = String.raw`(\d[\d,.\s]*\d|\d)`;

  function numRunRe() { return new RegExp(NUM_RUN, 'g'); }

  /** 把 `%s` 形状键编成正则：其余部分全部转义，`%s` 换成数字捕获组 */
  function shapeToRe(key) {
    const parts = key.split(SHAPE_TOKEN);
    const body = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(NUM_RUN);
    return new RegExp(body, 'g');
  }

  /** 把捕获到的数字按顺序回填进译文里的 `%s` */
  function fillShape(value, nums) {
    let i = 0;
    return value.replace(/%s/g, () => (i < nums.length ? nums[i++] : ''));
  }

  /**
   * code → [{ key, re, value }, …]，**按 key 长度降序统一排序**。
   *
   * 形状片段（含 `%s`）与普通片段放进**同一条表**里按长度排 ——
   * 这点很关键：`个 Mod · 已加载 %s 个 · 已隐藏黑名单（共 %s 个）` 里
   * 前 10 个字正好是另一条普通片段 `个 Mod · 已加载`。若先跑普通片段，
   * 形状键就被切碎、再也匹配不上。按长度排序天然让更具体的形状先动手。
   *
   * `re` 只给形状片段编；普通片段用 `indexOf` + `split/join`（比正则快且不涉及转义）。
   */
  function fragments(code) {
    if (fragCache[code]) return fragCache[code];
    const dict = DICTS[code];
    const list = [];
    if (dict) {
      for (const k of Object.keys(dict)) {
        const v = dict[k];
        if (k.length < MIN_FRAGMENT || !hasCJK(k) || typeof v !== 'string' || !v) continue;
        list.push(k.indexOf(SHAPE_TOKEN) >= 0
          ? { key: k, re: shapeToRe(k), value: v }
          : { key: k, re: null, value: v });
      }
    }
    list.sort((a, b) => b.key.length - a.key.length);
    fragCache[code] = list;
    return list;
  }

  /**
   * 可剥字符 = 空白 / 数字 / 任意非「词字符」的符号。
   * 词字符（汉字、假名、谚文、拉丁字母）一旦出现就必须停下 ——
   * 这条硬边界保证剥掉的永远只是装饰，词核心不会被动。
   */
  function isPeelable(ch) {
    if (/\s/.test(ch) || /\d/.test(ch)) return true;
    return !WORD_CH.test(ch) && !LATIN_CH.test(ch);
  }

  /**
   * 量级单位**不能**当词换。
   * `78.3 万` 剥成「万」再换成英文，量级会错 10 倍 ——
   * 数值单位由 `compact()` 按语言整体格式化，这一层不掺和。
   */
  const UNIT_WORDS = new Set(['万', '萬', '亿', '億', '千', '百']);

  /**
   * 从**两头**剥装饰：
   *   · 左边：空白 → 数字（含千分位、小数点）→ 装饰符号
   *   · 右边：装饰符号 → 数字 → 括号（吃掉 `（17）` 这种计数尾缀）
   * 每剥一层就查一次表，命中即返回「剥掉的前缀 + 译文 + 剥掉的后缀」。
   *
   *   '23 项待处理'      → 前缀 '23 '         + '项待处理' 的译文
   *   '✓ 723 个文件'     → 前缀 '✓ 723 '      + '个文件'   的译文
   *   '⬇ 安装'           → 前缀 '⬇ '          + '安装'      的译文
   *   '↻ 全部恢复（17）'  → 前缀 '↻ ' + '全部恢复' 的译文 + 后缀 '（17）'
   *   '5 图'             → 前缀 '5 '          + '图'        的译文（单字计数单位）
   *   '⬇ 78.3 万'        → 剥出的是量级单位「万」→ 拒绝（见 UNIT_WORDS）
   *
   * 单字也放行：`5 图`、`23 个` 这类计数行在界面里很常见，而剩下的那个字
   * 正好是字典 key 时（剥掉的全是数字和符号）语序不可能乱。
   * 因为只剥数字和符号、词核心必须**整串**命中字典，拼回去的句子语序不会动。
   */
  function peelAndLookup(core, dict) {
    // 能剥掉的命中词 = 字典里有这条，且不是量级单位
    const okHit = (v, word) => typeof v === 'string' && v && !UNIT_WORDS.has(word);

    // 一路剥到「第一个词字符」为止，这一步不查表 —— 剥得越干净，词核心越可能是真词条
    let iEnd = 0;
    while (iEnd < core.length && isPeelable(core[iEnd])) iEnd++;

    // 从剥得**最干净**的那一层往回退着查。
    // 为什么不是从少到多：源码 `清理已完成记录（${n}）` 会被抽成 `清理已完成记录（`
    // 这种带左括号的残片，它比真词条 `清理已完成记录` 长 ——
    // 先命中残片就会吐出 `Clear finished records (55）` 半边半角的鬼东西。
    for (let i = iEnd; i >= 0; i--) {
      const rest = core.slice(i);
      if (!rest) continue;

      const hit = dict[rest];
      if (okHit(hit, rest)) return core.slice(0, i) + hit;

      // 尾部同样：先剥到不能再剥，再从最干净的一层往回退
      let j = rest.length;
      while (j > 1 && isPeelable(rest[j - 1])) j--;
      for (; j < rest.length; j++) {
        const body = rest.slice(0, j);
        if (!body) continue;
        const hit2 = dict[body];
        if (okHit(hit2, body)) return core.slice(0, i) + hit2 + rest.slice(j);
      }
    }
    return null;
  }

  /**
   * 用字典片段做子串替换；只有「结果里没有中文残留」才认。
   *
   * 单次遍历、按 key 长度降序 —— 普通片段走字面替换，形状片段（`%s`）
   * 走正则并把捕获到的数字回填。顺序由长度决定（见 `fragments()`），
   * 保证更具体的形状键不会被它自己的前缀片段抢先切走。
   */
  function replaceFragments(core, code) {
    const list = fragments(code);
    if (!list.length) return null;
    let out = core, changed = false;

    for (const { key, re, value } of list) {
      if (re) {
        re.lastIndex = 0;
        if (!re.test(out)) continue;
        re.lastIndex = 0;
        // ⚠️ 回调参数的形状是 [整段匹配, ...捕获组, offset, 原串] ——
        //    开头那个「整段匹配」要丢掉，否则第一个 %s 会被回填成整句。
        out = out.replace(re, (...args) => fillShape(value, args.slice(1, args.length - 2)));
        changed = true;
      } else if (out.indexOf(key) >= 0) {
        out = out.split(key).join(value);
        changed = true;
      }
    }

    if (!changed) return null;
    // 汉字母语的语言（zh-TW / ja-JP）只看「换没换过」，见 HAN_NATIVE
    if (HAN_NATIVE.has(code)) return out;
    return hasCJK(out) ? null : out;
  }

  /**
   * 翻译一段**已经是成品文本**的内容（DOM 文本节点 / title 属性值）。
   *
   * · 保留首尾空白：` 个 Mod` 与 `个 Mod` 查的是同一条，但空格得还回去
   *   （它和相邻的 `<b>3</b>` 拼在一起，吃掉空格会变成 `3个 Mod`）
   * · 中文（zh-CN）时**原样返回**——原文就是中文，不需要"翻译"
   */
  function lookup(text) {
    if (!text) return text;

    const code = effective();
    if (code === 'zh-CN') return text;          // 原文就是中文，不需要"翻译"
    const dict = DICTS[code];
    if (!dict) return text;

    // 一个文本节点里可能夹着「换行 + 源码缩进」，那是排版产物，不是内容：
    //   `，这一项可以不填。\n          填了能获得更高的接口配额。`
    // DOM 里这是**一个**节点，而字典按行拆成两条 → 整串查必然落空。
    // 所以先按行切开逐段翻，换行和缩进原样拼回去，显示效果不变。
    if (/[\r\n]/.test(text)) {
      const parts = text.split(/([^\S\n]*\r?\n[^\S\n]*)/);   // 捕获组 = 分隔符
      let changed = false;
      const out = parts.map((p, i) => {
        if (i % 2 === 1) return p;          // 奇数下标是分隔符
        const r = lookup(p);
        if (r !== p) changed = true;
        return r;
      }).join('');
      return changed ? out : text;
    }

    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (!m) return text;
    const core = m[2];
    if (!core) return text;

    // ① 整串
    const exact = dict[core];
    if (typeof exact === 'string' && exact) return m[1] + exact + m[3];

    // ② 剥噪声后再整串
    const peeled = peelAndLookup(core, dict);
    if (peeled != null) return m[1] + peeled + m[3];

    // ③ 长片段子串替换
    const seg = replaceFragments(core, code);
    if (seg != null) return m[1] + seg + m[3];

    return text;
  }

  /**
   * 代码里直接拼串时用的 `t()`。
   * DOM 方案下大部分场景用不到它（界面文案会被 DOM 翻译器接走），
   * 但导出/日志/report 这类**不经过 DOM** 的地方仍然需要它。
   */
  function t(key, vars) {
    if (key == null) return '';
    let s = String(key);
    const code = effective();
    if (code !== 'zh-CN') {
      const d = DICTS[code];
      if (d) { const hit = d[s]; if (typeof hit === 'string' && hit) s = hit; }
    }
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  function label(code) { const h = LANGS.find(l => l.code === code); return h ? h.native : code; }
  function english(code) { const h = LANGS.find(l => l.code === code); return h ? h.english : code; }
  function list() { return LANGS.slice(); }
  function isSupported(code) { return LANGS.some(l => l.code === code); }

  /**
   * 数字按当前语言格式化（当地人看当地格式）。
   *
   * ⚠️ 空值必须先挡掉：`Intl.NumberFormat().format(null)` 是 `0`，
   *    界面上会凭空冒出一个 0。缺数据就该是空的，不是零。
   */
  function num(n) {
    if (n == null || n === '') return '';
    if (typeof n !== 'number' && isNaN(Number(n))) return String(n);
    try { return new Intl.NumberFormat(effective()).format(n); } catch { return String(n); }
  }

  /**
   * 大数字的「紧凑记法」：13000 → 中文「1.3万」/ 英文「13K」/ 韩文「1.3만」。
   *
   * 为什么不用字典：量级词（万 / 億 / тыс.）在句子里是**代码拼**出来的
   * （`(n/10000).toFixed(1) + ' 万'`），DOM 里它和数字粘成一个文本节点；
   * 而片段替换有「单字不换」的保护，`万` 这种一个字根本进不了字典。
   * 交给 Intl 最省事，14 种语言一套搞定。
   */
  function compact(n) {
    if (n == null || n === '') return '';
    const v = Number(n);
    if (!isFinite(v)) return String(n);
    try {
      return new Intl.NumberFormat(effective(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
    } catch { return String(n); }
  }

  /**
   * 日期按当前语言格式化。
   *
   * ⚠️ 同样的坑：`new Date(null)` 是合法的 **1970-01-01**，不会进 NaN 分支，
   *    于是空值会显示成「1970年1月1日」。所以 null/空串要单独挡在前面。
   */
  function date(v) {
    if (v == null || v === '') return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    try { return new Intl.DateTimeFormat(effective(), { dateStyle: 'medium' }).format(d); }
    catch { return d.toISOString().slice(0, 10); }
  }

  function setLang(code) {
    const next = (isSupported(code) || code === 'auto') ? code : 'auto';
    if (next === current) return current;
    current = next;
    store.set('i18n.lang', current);
    for (const fn of listeners) { try { fn(current, effective()); } catch { /* 单个监听器出错不拖垮整体 */ } }
    return current;
  }
  function getLang() { return current; }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ---------------- DOM 翻译器 ---------------- */

  /** node → 它的**原始中文**。切换语言时要靠它回滚，否则英文翻译不回中文 */
  const originals = new Map();
  /** 已经翻译过、不必再碰的节点（会话内缓存，省掉重复查表） */
  const done = new WeakSet();

  /** 这些容器里的东西不是给人读的，别动 */
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);
  /** 这些属性可能含中文，也要翻 */
  const ATTRS = ['title', 'placeholder', 'alt', 'aria-label'];

  function skipEl(el) {
    if (!el) return true;
    if (el.nodeType !== 1) return false;
    if (SKIP_TAGS.has(el.tagName)) return true;
    // 显式豁免：动态数据（Mod 名 / 作者 / 路径）区域可以打这个标记
    return el.hasAttribute && el.hasAttribute('data-i18n-skip');
  }

  function translateTextNode(node) {
    const el = node.parentElement;
    if (el && (SKIP_TAGS.has(el.tagName) || el.closest('[data-i18n-skip]'))) return;
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    const orig = originals.get(node);
    const next = lookup(orig);
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translateAttrs(el) {
    if (skipEl(el)) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const key = a + '\u0000' + a;
      let map = originals.get(el);
      if (!map || typeof map !== 'object') { map = Object.create(null); originals.set(el, map); }
      if (map[a] === undefined) map[a] = el.getAttribute(a);
      const next = lookup(map[a]);
      if (el.getAttribute(a) !== next) el.setAttribute(a, next);
    }
  }

  /**
   * 把一棵子树翻成目标语言。幂等：重复调用不会二次翻译
   * （原文存在 `originals` 里，每次都是「从中文重算」，不是「在译文上再翻」）。
   */
  function apply(root) {
    const r = root || (global.document && global.document.body);
    if (!r || !global.document) return 0;
    let n = 0;
    const walk = (el) => {
      if (el.nodeType === 3) { translateTextNode(el); n++; return; }
      if (el.nodeType !== 1) return;
      if (SKIP_TAGS.has(el.tagName)) return;
      translateAttrs(el);
      if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return;
      for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
    };
    if (r.nodeType === 1 || r.nodeType === 3) walk(r);
    // 文档标题
    if (global.document.title) {
      const key = '\u0000title';
      if (!originals.has(key)) originals.set(key, global.document.title);
      const next = lookup(originals.get(key));
      if (global.document.title !== next) global.document.title = next;
    }
    // html lang 属性（影响字体回退与断词）
    try { global.document.documentElement.lang = effective(); } catch { /* 忽略 */ }
    return n;
  }

  /** 语言一变 → 全量重刷（节点原值都在，等价于"从中文重新翻一遍"） */
  function refresh() { return apply(global.document && global.document.body); }

  /**
   * 盯住 DOM 变化，自动翻译新增/改动的节点。
   *
   * 界面是 innerHTML 整块重画的风格，所以观察器是主力 —— 没有它，
   * 每次刷新列表翻译就全丢了。
   */
  function observe(target) {
    const doc = global.document;
    if (!doc || typeof MutationObserver === 'undefined') return null;
    const host = target || doc.body;
    if (!host) return null;

    let queued = false;
    const flush = () => {
      queued = false;
      apply(host);
    };
    const mo = new MutationObserver((records) => {
      // 合并到一帧：整页重画会一口气抛几百条记录，逐条处理纯属浪费
      if (queued) return;
      queued = true;
      (global.requestAnimationFrame || global.setTimeout)(flush, 16);
    });
    mo.observe(host, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
    return mo;
  }

  const api = {
    LANGS, register, has, size, t, lookup, num, compact, date,
    setLang, getLang, onChange, effective, systemLang,
    label, english, list, isSupported,
    apply, refresh, observe,
    _originals: originals
  };

  // 1) 先读 localStorage（用户上次选的）
  const saved = store.get('i18n.lang');
  if (saved && (saved === 'auto' || isSupported(saved))) current = saved;

  global.I18N = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
