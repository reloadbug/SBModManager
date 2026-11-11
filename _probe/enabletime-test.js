/* 0.5.3「按开启时间排序」探针
 *
 * 用户 2026-11-10 的要求：装了个 Mod 之后游戏开始崩，得能一眼看出
 * 「最近开的是哪几个」。所以要两件事：
 *   ① 每次启用 / 禁用都记下时间点（enabledAt / disabledAt）；
 *   ② Mod 库能按这个时间排序。
 *
 * 这里测三层：
 *   A. 注册表本身：patch 是合并写，时间戳不会把别的字段冲掉、也不会互相覆盖掉；
 *   B. 后端接线：安装即启用要记 enabledAt；setEnabled 两条写入口都要带 stamp；
 *      老数据用 installedAt 回填并打上 enabledAtGuess；
 *   C. 前端接线：分组带出时间、记录带出时间、按时间排序真的排得对、
 *      下拉与抽屉里有对应的入口、i18n 词条齐。
 *
 * 跑法：node _probe/enabletime-test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [ OK ] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

const ipcSrc = read('src/main/ipc.js');
const flowSrc = read('src/main/installFlow.js');
const appSrc = read('src/renderer/app.js');
const htmlSrc = read('src/renderer/index.html');

/* ---------------- A. 注册表：合并写 + 两个时间戳互不干扰 ---------------- */
section('A. 注册表合并写');
{
  const { createRegistry } = require(path.join(ROOT, 'src/main/registry.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmm-et-'));
  const file = path.join(dir, 'mods.json');
  const reg = createRegistry(file);
  reg.upsert({
    id: 'nexus:1:2',
    name: 'A',
    kind: 'pak',
    enabled: true,
    installedAt: '2026-11-01T00:00:00.000Z',
    manifest: [{ path: 'C:/x/a.pak', rel: 'SB/Content/Paks/~Mods/a.pak', size: 1 }]
  });

  reg.patch('nexus:1:2', { enabled: false, disabledAt: '2026-11-10T10:00:00.000Z' });
  let m = reg.get('nexus:1:2');
  ok('patch 写入 disabledAt', m && m.disabledAt === '2026-11-10T10:00:00.000Z');
  ok('patch 不冲掉 installedAt', m && m.installedAt === '2026-11-01T00:00:00.000Z');
  ok('patch 只改给到的字段（name 没动）', m && m.name === 'A');

  reg.patch('nexus:1:2', { enabled: true, enabledAt: '2026-11-10T11:00:00.000Z' });
  m = reg.get('nexus:1:2');
  ok('再启用写入 enabledAt', m && m.enabledAt === '2026-11-10T11:00:00.000Z');
  ok('不冲掉上次的 disabledAt', m && m.disabledAt === '2026-11-10T10:00:00.000Z');
  ok('enabled 翻回 true', m && m.enabled === true);

  // 时间戳能比较（排序靠字符串比较就够，全是 ISO）
  ok('ISO 时间戳可直接比较大小', '2026-11-10T10:00:00.000Z' < '2026-11-10T11:00:00.000Z');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------------- B. 后端接线 ---------------- */
section('B. 后端：安装与开关都记时间');
{
  ok('installFlow 在 enabled: true 之后写 enabledAt',
    /enabled: true,\r?\n(\s*\/\/[^\n]*\r?\n)*\s*enabledAt: new Date\(\)\.toISOString\(\),/.test(flowSrc));

  ok('setEnabled 里算出 stamp（启用 / 禁用两支）',
    ipcSrc.includes('const stamp = enabled ? { enabledAt: nowIso } : { disabledAt: nowIso };'));
  ok('nowIso 先取一次（两支用同一个时刻）',
    ipcSrc.includes('const nowIso = new Date().toISOString();'));
  ok('改名分支的 patch 带上 stamp',
    ipcSrc.includes('registry.patch(id, { enabled, ...stamp, manifest: nextManifest });'));
  ok('兜底分支的 patch 带上 stamp',
    ipcSrc.includes('registry.patch(id, { enabled, ...stamp });'));
  ok('兜底分支不再用 registry.setEnabled（那个只改 enabled）',
    !ipcSrc.includes('registry.setEnabled(id, enabled);'));

  ok('有 backfillEnabledAt 函数', ipcSrc.includes('function backfillEnabledAt()'));
  ok('init() 里调用回填', ipcSrc.includes('backfillEnabledAt();'));
  ok('回填只用 installedAt 补缺的 enabledAt',
    ipcSrc.includes('if (!m || !m.enabled || m.enabledAt) continue;')
    && ipcSrc.includes("const at = m.installedAt || '';"));
  ok('回填打上 enabledAtGuess（界面据此说明是推算的）',
    ipcSrc.includes('patch: { enabledAt: at, enabledAtGuess: true }'));
  ok('回填一次写盘（patchMany，不是逐条）', ipcSrc.includes('registry.patchMany(pairs);'));
  ok('回填写日志', ipcSrc.includes("logger.event('mods:backfillEnabledAt'"));
}

/* ---------------- C. 前端接线 ---------------- */
section('C. 前端：带出时间 / 排序 / 入口');
{
  ok('groupEnabledAt 取组内最晚的启用时刻',
    appSrc.includes('function groupEnabledAt(items)')
    && appSrc.includes("const at = String((m.meta && m.meta.enabledAt) || '');"));
  ok('groupInstalled 把 enabledAt 挂到分组上',
    appSrc.includes('enabledAt: groupEnabledAt(items),'));
  ok('分组也带出「是否推算」标记',
    appSrc.includes('enabledAtGuess: items.some(m => m.meta && m.meta.enabledAtGuess === true)'));
  ok('buildLibRecords 透传 enabledAt / installedAt',
    appSrc.includes("enabledAt: g.enabledAt || '',")
    && appSrc.includes('enabledAtGuess: !!g.enabledAtGuess,')
    && appSrc.includes("installedAt: g.mtime || '',"));

  ok('有 LIB_SORTS 且含开启时间两档',
    appSrc.includes('const LIB_SORTS = [')
    && appSrc.includes("value: 'on-desc'")
    && appSrc.includes("value: 'on-asc'")
    && appSrc.includes("value: 'inst-desc'"));
  ok('renderLibMerged 走 applyLibSort',
    appSrc.includes('const shown = applyLibSort(libFilterRecords(recs));'));
  ok('state.lib 带 sort 字段',
    /kind: '', sort: '', catSet: false }/.test(appSrc));
  ok('排序下拉有 change 绑定',
    appSrc.includes("const libSortSel = $('#libSort');")
    && appSrc.includes("libSortSel.addEventListener('change'"));
  ok('在线档位把本地排序藏起来（那边用 Nexus 的排序标签）',
    appSrc.includes("const s = $('#libSort'); if (s) s.style.display = 'none';"));

  ok('卡片上显示开启时间',
    appSrc.includes('开启于 ${esc(fmtWhen(rec.enabledAt))}'));
  ok('抽屉信息里有一行「开启时间」',
    appSrc.includes('<span>开启时间</span>'));
  ok('推算出来的时间会说明「按安装时间推算」',
    appSrc.includes('按安装时间推算'));

  ok('index.html 有 #libSort 下拉', htmlSrc.includes('id="libSort"'));
  ok('下拉里 5 个选项齐全',
    htmlSrc.includes('<option value="">默认</option>')
    && htmlSrc.includes('<option value="on-desc">开启时间 ↓</option>')
    && htmlSrc.includes('<option value="on-asc">开启时间 ↑</option>')
    && htmlSrc.includes('<option value="inst-desc">安装时间 ↓</option>')
    && htmlSrc.includes('<option value="name">名称</option>'));
}

/* ---------------- D. 排序真的排得对（把函数抠出来单跑） ---------------- */
section('D. applyLibSort 行为');
{
  const s = appSrc.indexOf('function applyLibSort(');
  if (s < 0) throw new Error('没找到 applyLibSort');
  // 找到函数结尾：从函数头往下配平花括号
  let depth = 0;
  let end = -1;
  for (let i = s; i < appSrc.length; i++) {
    const c = appSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const src = appSrc.slice(s, end);
  const sandbox = { state: { lib: { sort: '' }, browse: { sort: '' } } };
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;this.__apply = applyLibSort;', sandbox);
  const apply = sandbox.__apply;

  const recs = [
    { key: 'a', name: 'Charlie', enabledAt: '2026-11-01T00:00:00.000Z', installedAt: '2026-11-01T00:00:00.000Z' },
    { key: 'b', name: 'alpha', enabledAt: '2026-11-09T00:00:00.000Z', installedAt: '2026-11-02T00:00:00.000Z' },
    { key: 'c', name: 'Bravo', enabledAt: '', installedAt: '' },                       // 没有时间
    { key: 'd', name: 'delta', enabledAt: '2026-11-05T00:00:00.000Z', installedAt: '2026-11-08T00:00:00.000Z' }
  ];

  ok('默认档不动顺序', apply(recs).map(r => r.key).join('') === 'abcd');
  // 合并态默认跟着顶部在线排序 chip 走（实测本机是「下载最多」），所以默认档也会排一次、返回副本。
  ok('默认档跟着在线排序排一次（返回副本，不动原数组）', apply(recs) !== recs && recs.map(r => r.key).join('') === 'abcd');

  sandbox.state.lib.sort = 'on-desc';
  ok('开启时间 ↓：最近的在前，没时间的沉底',
    apply(recs).map(r => r.key).join('') === 'bdac');

  sandbox.state.lib.sort = 'on-asc';
  ok('开启时间 ↑：最早的在前，没时间的仍在最后',
    apply(recs).map(r => r.key).join('') === 'adbc');

  sandbox.state.lib.sort = 'inst-desc';
  ok('安装时间 ↓ 与开启时间不是一回事（d 比 b 装得晚）',
    apply(recs).map(r => r.key).join('') === 'dbac');

  sandbox.state.lib.sort = 'name';
  ok('名称：不区分大小写', apply(recs).map(r => r.key).join('') === 'bcad');

  sandbox.state.lib.sort = 'on-desc';
  ok('排序不改动入参数组', recs.map(r => r.key).join('') === 'abcd');
}

/* ---------------- E. i18n 词条 ---------------- */
section('E. i18n');
{
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8'));
  const keys = Array.isArray(raw) ? raw : Object.keys(raw);
  for (const w of ['开启时间', '开启时间 ↓', '开启时间 ↑', '安装时间 ↓', '（按安装时间推算）']) {
    ok('词条在册：' + w, keys.includes(w));
  }
  ok('总条数 = 1277', keys.length === 1277, '实际 ' + keys.length);
}

/* ---------------- 汇总 ---------------- */
console.log('\n---------------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) process.exitCode = 1;
