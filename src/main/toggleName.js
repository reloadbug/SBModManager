/**
 * 「这个文件现在是开还是关」的**唯一判定口径**。
 *
 * 2026-11-10 用户连着报了三个看似不相干的毛病，根其实是同一处：
 *   1. 「批量关闭 mod 后有一部分出错，刷新也没有变化」——纯 CNS 换装包
 *      （manifest 里只有一个 `.dekcns.json`，没有 pak）在改名时被整条跳过。
 *   2. 「按磁盘核对：移除 0 条、裁剪 0 条、纠正开关 1 条」但「mod 依然无法禁用」
 *      ——关闭成功了，可核对时又不认这种关闭写法，反手把开关改回「已启用」。
 *   3. 「现在开启也不好使了」——只判断「以 .pak 结尾」的实现，遇上已经关掉的
 *      `x.pak.disabled` 就不认它是自己管的文件，于是一个受管文件都找不到，
 *      直接抛「找不到这个 Mod 的文件…没法启用」。
 *
 * 停用靠改文件名，而这类文件有两种写法：
 *
 *   pak 三件套（.pak/.ucas/.utoc）：直接加后缀
 *       x.pak      ⇄  x.pak.disabled
 *
 *   CNS / ATOOL 换装索引（`xxx.dekcns.json` / `xxx.dekani.json`，
 *   真实扩展名是 .json；老包还有裸 `.dekcns`）：**不能**加在最后面，原因是
 *   `ue4ss\Mods\DekCNS\Scripts\main.lua` 里写的是
 *       if string.find(fileName, "dekcns.json") then ... end
 *   这是**子串**匹配，而且它递归扫整个 ~Mods —— `x.dekcns.json.disabled`
 *   里照样含 "dekcns.json"，游戏还是会加载。只能把标记插到 .json 前面：
 *       x.dekcns.json  ⇄  x.dekcns.disabled.json
 *   这样文件名里再也没有 "dekcns.json" 这个子串，DekCNS 就扫不到它了。
 *
 * 于是「关了没有」有两种答案形态，任何地方只认一种写法都会出错。
 * 所以判定与改名规则都集中在这个文件里：
 *   - `setEnabled()`（src/main/ipc.js）用它决定改哪个名字；
 *   - `reconcile.plan()`（按磁盘核对）用它判断「文件在、但是关着的」；
 *   - `scanner.scanPaks()` 与 `crashLog.inventory()` 也用它归组。
 * 以前这几处各写一套正则，才出了上面那三个 bug。
 */

/** 可以整体加 `.disabled` 后缀的类型 */
const RENAMEABLE = /\.(pak|ucas|utoc)$/i;

/** CNS / ATOOL 换装索引：开着时的名字 */
const DATA_INDEX_ON = /\.(dekcns|dekani)(\.json)?$/i;

/** CNS / ATOOL 换装索引：关着时的名字 */
const DATA_INDEX_OFF = /\.(dekcns|dekani)(\.disabled\.json|\.disabled)$/i;

/**
 * 这个文件名代表「关着的 Mod」吗？（只问状态，不问类型）
 * @param {string} base 纯文件名（不带目录）
 */
function isDisabledName(base) {
  const s = String(base || '');
  if (DATA_INDEX_OFF.test(s)) return true;
  return /\.disabled$/i.test(s);
}

/**
 * 把「关着」的名字还原成「开着」的名字，用来认出同一个文件。
 * 认不出来的名字原样返回。
 * @param {string} base 纯文件名（不带目录）
 */
function stripDisabled(base) {
  const s = String(base || '');
  if (s.endsWith('.disabled.json')) return s.slice(0, -'.disabled.json'.length) + '.json';
  return s.replace(/\.disabled$/i, '');
}

/**
 * 同一个文件的「另一种写法」：开着 ⇄ 关着。认不出来返回空串。
 * 用在「注册表里记的名字和磁盘差一个开关后缀」的时候 —— 照样得能开关。
 * @param {string} base 纯文件名（不带目录）
 */
function counterpartName(base) {
  const s = String(base || '');
  if (DATA_INDEX_OFF.test(s)) {
    return s.endsWith('.disabled.json')
      ? s.slice(0, -'.disabled.json'.length) + '.json'
      : s.slice(0, -'.disabled'.length);
  }
  if (DATA_INDEX_ON.test(s)) {
    return /\.json$/i.test(s) ? s.replace(/\.json$/i, '.disabled.json') : s + '.disabled';
  }
  if (s.endsWith('.disabled')) {
    const bare = s.slice(0, -'.disabled'.length);
    return RENAMEABLE.test(bare) ? bare : '';
  }
  return RENAMEABLE.test(s) ? s + '.disabled' : '';
}

/**
 * 这个文件切到目标状态后该叫什么。
 * @param {string} base 纯文件名（不带目录）
 * @param {boolean} wantEnabled true=要启用，false=要停用
 * @returns {{managed:boolean, next:string|null}}
 *          managed=false 表示这个文件不归我们管（不该跟开关走）；
 *          next=null 表示「已经在目标状态，不用动」。
 */
function renameStep(base, wantEnabled) {
  const s = String(base || '');

  // ① CNS / ATOOL 换装索引（标记插在 .json 前面 / 裸 .dekcns 加在最后）
  if (DATA_INDEX_OFF.test(s)) {
    if (!wantEnabled) return { managed: true, next: null };
    if (s.endsWith('.disabled.json')) {
      return { managed: true, next: s.slice(0, -'.disabled.json'.length) + '.json' };
    }
    return { managed: true, next: s.slice(0, -'.disabled'.length) };
  }
  if (DATA_INDEX_ON.test(s)) {
    if (wantEnabled) return { managed: true, next: null };
    if (/\.json$/i.test(s)) return { managed: true, next: s.replace(/\.json$/i, '.disabled.json') };
    return { managed: true, next: s + '.disabled' };
  }

  // ② pak 三件套：加/去 .disabled 后缀。
  //    注意「关着的」名字不以后再缀结尾，必须先把后缀剥掉再判类型 ——
  //    否则已经关掉的 pak 会被当成「不归我管」，一个文件都找不到，就永远开不回来。
  if (s.endsWith('.disabled')) {
    const bare = s.slice(0, -'.disabled'.length);
    if (!RENAMEABLE.test(bare)) return { managed: false, next: null };
    return { managed: true, next: wantEnabled ? bare : null };
  }
  if (!RENAMEABLE.test(s)) return { managed: false, next: null };
  return { managed: true, next: wantEnabled ? null : s + '.disabled' };
}

module.exports = {
  RENAMEABLE,
  DATA_INDEX_ON,
  DATA_INDEX_OFF,
  isDisabledName,
  stripDisabled,
  counterpartName,
  renameStep
};
