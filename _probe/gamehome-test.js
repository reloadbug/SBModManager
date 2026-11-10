'use strict';
/**
 * 「数据跟着游戏走」离线断言套件。
 *
 * 覆盖四块：
 *   A. `paths` 的判定 —— `<游戏根>\.sbmod` 认不认、镜像路径怎么算（纯函数 + 真临时目录）
 *   B. `gameHome.seed()` —— 第一次识别到游戏目录时把状态铺进去，**已存在的不覆盖**
 *   C. `gameHome.mirror()` + `store.setMirror()` —— 写盘时同步一份，且失败不影响主写入
 *   D. 接线断言 —— ipc / paths / store / app.js / 文档是否真的按设计改了
 *
 * 用法：node _probe/gamehome-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const paths = require('../src/main/paths');
const gameHome = require('../src/main/gameHome');
const store = require('../src/main/store');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); return; }
    fail++; fails.push(label + ' → ' + r);
    console.log('  ✗ ' + label + '  → ' + r);
  } catch (e) {
    fail++; fails.push(label + ' → ' + e.message);
    console.log('  ✗ ' + label + '  → ' + e.message);
  }
}
function eq(a, b, label) {
  t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));
}
function ok(v, label) { t(label, () => (v ? true : '假值')); }

const SRC = path.join(__dirname, '..', 'src', 'main');
const readSrc = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

/* ---------------- 夹具 ---------------- */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-gamehome-'));
const GAME = path.join(TMP, 'Star Blade');
const DATA = path.join(TMP, 'manager-data');
function reset() {
  fs.rmSync(GAME, { recursive: true, force: true });
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(GAME, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
}
reset();

function writeState(dir, name, obj) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2), 'utf8');
}
function readState(dir, name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; }
}

/* ---------------- A. paths 的判定 ---------------- */

console.log('\n[A] <游戏根>\\.sbmod 的识别');

eq(paths.GAME_HOME_DIR, '.sbmod', '数据目录名是 .sbmod');
eq(path.basename(paths.gameHomeOf(GAME)), '.sbmod', 'gameHomeOf 拼出 .sbmod');
eq(path.basename(paths.gameHomeConfigOf(GAME)), 'config.json', 'gameHomeConfigOf 指向 config.json');
eq(paths.gameHomeOf(''), '', '空游戏根 → 空路径');
eq(paths.gameHomeConfigOf(''), '', '空游戏根 → 空 config 路径');

t('没有 config.json 时 gameHomeReady=false', () => (paths.gameHomeReady(GAME) === false ? true : '误判为已就绪'));
t('相对路径一律不认', () => (paths.gameHomeReady('.') === false ? true : '相对路径被当成游戏根'));

fs.mkdirSync(paths.gameHomeOf(GAME), { recursive: true });
writeState(paths.gameHomeOf(GAME), 'config.json', { gameRoot: GAME });
t('有 config.json 时 gameHomeReady=true', () => (paths.gameHomeReady(GAME) === true ? true : '没认出来'));

t('STATE_NAMES 覆盖 10 个状态文件（含 bugs.json / verified.json —— 用户标记跟着游戏走）', () => {
  const want = ['config.json', 'mods.json', 'mod-links.json', 'blacklist.json', 'favorites.json', 'downloads.json', 'watch-seen.json', 'ledger.json', 'bugs.json', 'verified.json'];
  const miss = want.filter(n => !paths.STATE_NAMES.includes(n));
  return miss.length ? ('缺 ' + miss.join(',')) : true;
});
t('verifiedFile 指向 <数据目录>/verified.json（和 bugsFile 同一条路）', () => (
  /[\\/]verified\.json$/.test(paths.verifiedFile) || ('不对：' + paths.verifiedFile)
));
t('缓存文件名不在 STATE_NAMES 里', () => (
  !paths.STATE_NAMES.includes('nexus-catalog.json') && !paths.STATE_NAMES.includes('translate.json')
    ? true : '把缓存也当成状态文件了'));
t('homeMirrorOf 只认状态文件（缓存返回空串）', () => {
  const r = paths.homeMirrorOf(path.join(DATA, 'nexus-catalog.json'));
  return r === '' ? true : '缓存被镜像了：' + r;
});
t('info() 形状正确', () => {
  const i = gameHome.info();
  const keys = ['dataDir', 'appData', 'source', 'gameRoot', 'gameHome', 'gameHomeReady', 'isGameHome'];
  const miss = keys.filter(k => !(k in i));
  return miss.length ? ('缺 ' + miss.join(',')) : true;
});

/* ---------------- B. seed() ---------------- */

console.log('\n[B] 第一次识别到游戏目录：把状态铺进去');

reset();
writeState(DATA, 'config.json', { gameRoot: GAME, nexusApiKey: 'k' });
writeState(DATA, 'mods.json', { version: 1, mods: [{ id: 'nexus:1:2' }] });
writeState(DATA, 'mod-links.json', { version: 1, links: {} });
fs.writeFileSync(path.join(DATA, 'nexus-catalog.json'), '{"big":true}', 'utf8');

const r1 = gameHome.seed(GAME, DATA);
t('copied 里有 config/mods/mod-links', () => (
  ['config.json', 'mods.json', 'mod-links.json'].every(n => r1.copied.includes(n))
    ? true : JSON.stringify(r1.copied)));
t('没把缓存搬过去', () => (
  r1.copied.includes('nexus-catalog.json') ? '缓存被搬了' : true));
t('目标目录里内容一致', () => {
  const c = readState(paths.gameHomeOf(GAME), 'config.json');
  return c && c.nexusApiKey === 'k' ? true : JSON.stringify(c);
});
t('没有的源文件记在 skipped 里', () => (
  r1.skipped.includes('favorites.json') ? true : JSON.stringify(r1.skipped)));
eq(r1.failed.length, 0, 'seed 无失败项');

// 幂等 + 不覆盖：改游戏目录里那份，再 seed 一次，不能把它盖回去
writeState(paths.gameHomeOf(GAME), 'config.json', { gameRoot: GAME, nexusApiKey: 'NEWER' });
const r2 = gameHome.seed(GAME, DATA);
t('第二次 seed 不再复制已存在的文件', () => (
  r2.copied.includes('config.json') ? '把游戏目录里的新配置覆盖了' : true));
t('游戏目录里那份仍然是新的', () => {
  const c = readState(paths.gameHomeOf(GAME), 'config.json');
  return c && c.nexusApiKey === 'NEWER' ? true : JSON.stringify(c);
});

// 源目录就是游戏目录（已经切过去了）→ 全都 skip，不自我复制
const r3 = gameHome.seed(GAME, paths.gameHomeOf(GAME));
eq(r3.copied.length, 0, '源与目标是同一目录时什么都不复制');

t('空游戏根不炸', () => {
  const r = gameHome.seed('', DATA);
  return r && r.copied.length === 0 ? true : '异常返回';
});

/* ---------------- C. mirror() + store.setMirror() ---------------- */

console.log('\n[C] 每次写盘镜像一份到游戏目录');

const tmpFile = path.join(DATA, 'mods.json');
writeState(DATA, 'mods.json', { version: 1, mods: [] });
const m = gameHome.mirror(GAME, tmpFile, { version: 1, mods: [{ id: 'x' }] });
t('state 文件会被镜像（返回目标路径）', () => (
  m && path.resolve(m) === path.resolve(path.join(paths.gameHomeOf(GAME), 'mods.json'))
    ? true : String(m)));
t('镜像内容与写入内容一致', () => {
  const j = readState(paths.gameHomeOf(GAME), 'mods.json');
  return j && j.mods && j.mods[0] && j.mods[0].id === 'x' ? true : JSON.stringify(j);
});
eq(gameHome.mirror(GAME, path.join(DATA, 'nexus-catalog.json'), {}), '', '缓存文件不镜像');
eq(gameHome.mirror(GAME, path.join(paths.gameHomeOf(GAME), 'mods.json'), {}), '', '目标与源同一文件时跳过');
eq(gameHome.mirror('', tmpFile, {}), '', '没有游戏目录时跳过');

// store 钩子：装上 mirror 后 writeJson 会回调；回调抛错不能影响主写入
let called = null;
store.setMirror((file, data) => { called = { file, data }; });
const hooked = path.join(DATA, 'blacklist.json');
store.writeJson(hooked, { ids: [1, 2] });
t('writeJson 触发镜像钩子', () => (
  called && path.resolve(called.file) === path.resolve(hooked) && called.data.ids.length === 2
    ? true : JSON.stringify(called)));
t('钩子收到的就是落盘内容', () => {
  const j = readState(DATA, 'blacklist.json');
  return j && j.ids && j.ids[1] === 2 ? true : JSON.stringify(j);
});

store.setMirror(() => { throw new Error('镜像炸了'); });
t('镜像抛错不影响主写入', () => {
  store.writeJson(path.join(DATA, 'favorites.json'), { ids: [9] });
  const j = readState(DATA, 'favorites.json');
  return j && j.ids[0] === 9 ? true : JSON.stringify(j);
});
store.setMirror(null);
t('setMirror(null) 之后不再回调', () => {
  called = null;
  store.writeJson(path.join(DATA, 'favorites.json'), { ids: [10] });
  return called === null ? true : '仍然回调了';
});
t('setMirror 只接受函数', () => {
  store.setMirror('not-a-function');
  called = null;
  store.writeJson(path.join(DATA, 'favorites.json'), { ids: [11] });
  return called === null ? true : '非函数也被装上了';
});

/* ---------------- D. 接线断言 ---------------- */

console.log('\n[D] 接线');

const ipcSrc = readSrc('ipc.js');
const pathsSrc = readSrc('paths.js');
const storeSrc = readSrc('store.js');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const docSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', '架构设计.md'), 'utf8');
const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8'));
const keySet = new Set(Array.isArray(keys) ? keys : Object.keys(keys));

ok(/require\('\.\/gameHome'\)/.test(ipcSrc), 'ipc 引用 gameHome');
ok(/const \{ readJson, writeJson, setMirror \} = require\('\.\/store'\)/.test(ipcSrc), 'ipc 拿到 setMirror');
ok(/initGameHome\(\)/.test(ipcSrc), 'init() 里调用了 initGameHome()');
ok(/gameHome\.seed\(r, paths\.DATA\)/.test(ipcSrc), 'initGameHome 用 seed 铺数据');
ok(/paths\.setGameRootHint\(r\)/.test(ipcSrc), 'initGameHome 记下游戏目录');
ok(/setMirror\(\(file, data\) => gameHome\.mirror\(r, file, data\)\)/.test(ipcSrc), 'initGameHome 挂镜像钩子');
ok(/const home = initGameHome\(root\)/.test(ipcSrc), 'game:setRoot 也铺一遍（换目录即跟随）');
ok(/dataHome: gameHome\.info\(\)/.test(ipcSrc), 'bootstrap 带 dataHome');
ok(/gameHome: gameHome\.info\(\)/.test(ipcSrc), 'data:info 带 gameHome');

ok(/const APP_DATA = DATA/.test(pathsSrc), 'paths 区分 APP_DATA 与 DATA');
ok(/const CACHE = path\.join\(APP_DATA, 'cache'\)/.test(pathsSrc), '缓存跟着 APP_DATA');
// 0.4.0 起安装包目录可单独指定（指针里的 libraryDir），默认值仍然是 APP_DATA/library：
// 这里断言「默认值跟着 APP_DATA，且能被 libraryDir 覆盖」，而不是死盯 LIBRARY 的拼法。
ok(/const DEFAULT_LIBRARY = path\.join\(APP_DATA, 'library'\)/.test(pathsSrc), '安装包目录默认跟着 APP_DATA');
ok(/const LIBRARY = LIBRARY_CONFIGURED && canUseDir\(LIBRARY_CONFIGURED\) \? LIBRARY_CONFIGURED : DEFAULT_LIBRARY/
  .test(pathsSrc), 'LIBRARY 可被 libraryDir 覆盖，否则回落默认');
ok(/DATA_SOURCE = 'game'/.test(pathsSrc), '支持 game 数据源');
ok(/function homeMirrorOf/.test(pathsSrc), 'paths 暴露 homeMirrorOf');
ok(/function setGameRootHint/.test(pathsSrc), 'paths 暴露 setGameRootHint');
ok(/function readPointer/.test(pathsSrc), 'paths 暴露 readPointer');
ok(/\{ \.\.\.cur, dataDir: norm \}/.test(pathsSrc), 'setDataDir 保留 gameRoot（不把指针洗掉）');
ok(/delete cur\.dataDir/.test(pathsSrc), '恢复默认只删 dataDir、保留 gameRoot');

ok(/function setMirror/.test(storeSrc), 'store 暴露 setMirror');
ok(/if \(mirrorFn\) \{/.test(storeSrc), 'writeJson 里挂钩子');
ok(/try \{ mirrorFn\(file, data\); \} catch/.test(storeSrc), '镜像失败不影响主写入');
ok(/module\.exports = \{ readJson, writeJson, createConfigStore, setMirror, DEFAULT_CONFIG \}/.test(storeSrc), 'setMirror 已导出');

ok(/id="dataHomeLine"/.test(appSrc), '设置页有数据文件那一行');
ok(/function refreshDataHomeLine/.test(appSrc), 'app.js 有 refreshDataHomeLine');
ok(/state\.dataHome = data\.dataHome/.test(appSrc), 'refreshAll 记住 dataHome');
ok(/refreshDataHomeLine\(\);/.test(appSrc), 'renderSettings 调用了它');
ok(/游戏目录（跟着游戏走）/.test(appSrc), '已切到游戏目录时的文案');
ok(/暂存在管理器目录，下次启动会切换到游戏目录/.test(appSrc), '还没切换时的文案');

ok(keySet.has('游戏目录（跟着游戏走）：'), 'i18n 有「游戏目录（跟着游戏走）」');
ok(keySet.has('暂存在管理器目录，下次启动会切换到游戏目录：'), 'i18n 有「暂存…」');
ok([...keySet].some(k => k.startsWith('配置与账本跟着游戏走')), 'i18n 有说明长句');

ok(/gameHome\.js/.test(docSrc), '架构文档写了 gameHome.js');

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) {
  console.log('失败项：');
  for (const f of fails) console.log('  · ' + f);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(fail ? 1 : 0);
