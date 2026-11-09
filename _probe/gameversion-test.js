/**
 * gameVersion 探针：合成一个 PE 文件，验证版本号读取 + 渲染层接线。
 *
 * 为什么不拿真游戏 exe 当夹具：不是每台机器都装了游戏。
 * 合成文件只有几 KB，但 PE 结构（DOS 头 / 可选头 / 数据目录 / 资源目录三层 / VS_VERSIONINFO）
 * 全按真的摆，所以能测到「结构认错就全错」那些地方。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const gv = require('../src/main/gameVersion');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('返回 false');
    pass++;
  } catch (e) {
    fail++;
    fails.push(label + ' → ' + (e && e.message));
  }
}
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${label}\n  实际 ${A}\n  期望 ${B}`);
}
function reset() { pass = 0; fail = 0; fails.length = 0; }

/* ---------------- 合成 PE ---------------- */

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const utf16z = s => Buffer.from(s + '\0', 'utf16le');
const pad4 = buf => { const r = buf.length % 4; return r ? Buffer.concat([buf, Buffer.alloc(4 - r)]) : buf; };

/** 一个 VS_VERSIONINFO 块（wLength 最后回填） */
function block(key, opts = {}) {
  const { valueLen = 0, type = 0, value = Buffer.alloc(0), children = [] } = opts;
  const k = utf16z(key);
  const start = (6 + k.length + 3) & ~3;
  const head = Buffer.alloc(start);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(valueLen, 2);
  head.writeUInt16LE(type, 4);
  k.copy(head, 6);
  const parts = [head, pad4(value), ...children];
  const total = pad4(Buffer.concat(parts));
  total.writeUInt16LE(total.length, 0);
  return total;
}

function fixedFileInfo(ms, ls) {
  const b = Buffer.alloc(52);
  b.writeUInt32LE(0xfeef04bd, 0);
  b.writeUInt32LE(0x00010000, 4);
  b.writeUInt32LE(ms, 8);
  b.writeUInt32LE(ls, 12);
  b.writeUInt32LE(ms, 16);
  b.writeUInt32LE(ls, 20);
  return b;
}

/** 版本资源块；fileVersion 传空就不写 FileVersion 字符串 */
function versionBlob({ fileVersion = '', productVersion = '', numeric = [1, 4, 1, 0] }) {
  const strs = [];
  if (fileVersion) strs.push(block('FileVersion', { valueLen: fileVersion.length + 1, type: 1, value: Buffer.from(fileVersion + '\0', 'utf16le') }));
  if (productVersion) strs.push(block('ProductVersion', { valueLen: productVersion.length + 1, type: 1, value: Buffer.from(productVersion + '\0', 'utf16le') }));
  const table = block('040904b0', { children: strs });
  const sfi = block('StringFileInfo', { children: [table] });
  const ms = ((numeric[0] & 0xffff) << 16) | (numeric[1] & 0xffff);
  const ls = ((numeric[2] & 0xffff) << 16) | (numeric[3] & 0xffff);
  return block('VS_VERSION_INFO', { valueLen: 52, type: 0, value: fixedFileInfo(ms, ls), children: [sfi] });
}

/**
 * 造一个最小可用的 PE：DOS 头 + PE 头（1 个 .rsrc 段，va=0x1000 / 文件偏移 0x400）
 * blob 为 null 时不写资源（用来测「exe 里没有版本资源」那条路）
 */
function makePe(blob) {
  const RAW_PTR = 0x400;
  const SEC_VA = 0x1000;
  const sec = Buffer.alloc(0x800);
  let resSize = 0;

  if (blob) {
    const blobOff = 0x500;                       // 资源目录之后（必须 >= RAW_PTR，否则算出的 RVA 落在段外）
    const blobRva = SEC_VA + (blobOff - RAW_PTR);
    // 目录头 + 三层
    sec.writeUInt16LE(0, 12);                    // NamedEntries
    sec.writeUInt16LE(1, 14);                    // IdEntries
    sec.writeUInt32LE(16, 16);                   // Name = RT_VERSION
    sec.writeUInt32LE((0x80000000 | 0x18) >>> 0, 20);    // 子目录
    sec.writeUInt16LE(1, 0x18 + 14);             // 第二层 1 个
    sec.writeUInt32LE(1, 0x18 + 16);
    sec.writeUInt32LE((0x80000000 | 0x30) >>> 0, 0x18 + 20);
    sec.writeUInt16LE(1, 0x30 + 14);             // 第三层 1 个（语言）
    sec.writeUInt32LE(0x409, 0x30 + 16);
    sec.writeUInt32LE(0x48, 0x30 + 20);          // 数据项
    sec.writeUInt32LE(blobRva, 0x48);            // OffsetToData
    sec.writeUInt32LE(blob.length, 0x4c);        // Size
    sec.writeUInt32LE(0x4b0, 0x50);              // CodePage
    blob.copy(sec, blobOff - RAW_PTR);   // 段内偏移 = 文件偏移 - 段起点
    resSize = 0x100 + blob.length;
  }

  const e_lfanew = 0x80;
  const optSize = 240;
  const dos = Buffer.alloc(0x40);
  dos.write('MZ', 0, 'latin1');
  dos.writeUInt32LE(e_lfanew, 0x3c);

  const pe = Buffer.alloc(24);
  pe.write('PE\0\0', 0, 'latin1');
  pe.writeUInt16LE(1, 6);          // NumberOfSections
  pe.writeUInt16LE(optSize, 20);   // SizeOfOptionalHeader

  const opt = Buffer.alloc(optSize);
  opt.writeUInt16LE(0x20b, 0);     // PE32+
  if (blob) {
    opt.writeUInt32LE(16, 108);    // NumberOfRvaAndSizes
    opt.writeUInt32LE(SEC_VA, 112 + 2 * 8);      // 资源表 RVA
    opt.writeUInt32LE(resSize, 112 + 2 * 8 + 4); // 资源表大小
  }

  const section = Buffer.alloc(40);
  section.write('.rsrc', 0, 'latin1');
  section.writeUInt32LE(0x800, 8);
  section.writeUInt32LE(SEC_VA, 12);
  section.writeUInt32LE(0x800, 16);
  section.writeUInt32LE(RAW_PTR, 20);

  const parts = [
    dos,
    Buffer.alloc(e_lfanew - dos.length),
    pe,
    opt,
    section,
    Buffer.alloc(RAW_PTR - (e_lfanew + pe.length + opt.length + section.length)),
    sec,
  ];
  return Buffer.concat(parts);
}

const TMP = path.join(os.tmpdir(), 'sb-gamever-test');
function writeExe(buf) {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, 'SB-Win64-Shipping.exe');
  fs.writeFileSync(p, buf);
  return p;
}

/* ---------------- [1] 直接解析版本块 ---------------- */

t('[1] 解析 FileVersion 字符串 + 数值', () => {
  const v = gv.parseVersionInfo(versionBlob({ fileVersion: '1.4.1', numeric: [1, 4, 1, 0] }));
  eq(v.numeric, '1.4.1', '数值版本');
  eq(v.string, '1.4.1', 'FileVersion 字符串');
  eq(gv.pickDisplay(v), '1.4.1', '展示值');
});

t('[1] 没有 FileVersion 时用 ProductVersion', () => {
  const v = gv.parseVersionInfo(versionBlob({ productVersion: '2.0.0' }));
  eq(v.string, '', 'FileVersion 空');
  eq(v.product, '2.0.0', 'ProductVersion');
  eq(gv.pickDisplay(v), '2.0.0', '展示值回落到产品版本');
});

t('[1] 两者都没有时用数值', () => {
  const v = gv.parseVersionInfo(versionBlob({ numeric: [1, 2, 3, 4] }));
  eq(gv.pickDisplay(v), '1.2.3.4', '展示值回落到数值');
});

t('[1] 尾部补 0 的段被去掉（1.000.000.0 → 1.000.000）', () => {
  const v = gv.parseVersionInfo(versionBlob({ numeric: [1, 0, 0, 0] }));
  eq(v.numeric, '1.0', '去掉尾部全 0 段后至少要留两段');
});

t('[1] 空 buffer / 垃圾数据 → null', () => {
  eq(gv.parseVersionInfo(Buffer.alloc(0)), null, '空 buffer');
  eq(gv.parseVersionInfo(Buffer.from('not a version resource at all', 'latin1')), null, '垃圾数据');
});

/* ---------------- [2] 读真文件 ---------------- */

t('[2] 读合成 exe 拿到版本', () => {
  const exe = writeExe(makePe(versionBlob({ fileVersion: '1.4.1' })));
  const v = gv.readExeVersion(exe);
  eq(v.display, '1.4.1', 'display');
  eq(v.numeric, '1.4.1', 'numeric');
});

t('[2] 没有资源段的 exe → noResource，而不是抛错', () => {
  const exe = writeExe(makePe(null));
  const v = gv.readExeVersion(exe);
  eq(v.display, '', 'display 空');
  eq(!!v.noResource, true, 'noResource 标记');
});

t('[2] 文件不存在 → null（不抛）', () => {
  eq(gv.readExeVersion(path.join(TMP, 'nope.exe')), null, '不存在返回 null');
});

t('[2] 不是 PE 的文件 → null', () => {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, 'fake.exe');
  fs.writeFileSync(p, 'MZ but nothing else');
  eq(gv.readExeVersion(p), null, '假 PE 返回 null');
});

/* ---------------- [3] detect 的四种说法 ---------------- */

t('[3] 没有游戏目录 → 还没设置游戏目录', () => {
  const r = gv.detect('', { noCache: true });
  eq(r.ok, false, 'ok');
  eq(r.reason, '还没设置游戏目录', 'reason');
});

t('[3] 目录里没有主程序 → 找不到游戏主程序', () => {
  const r = gv.detect(path.join(TMP, 'empty-root'), { noCache: true });
  eq(r.ok, false, 'ok');
  eq(r.reason, '找不到游戏主程序', 'reason');
});

t('[3] 合成游戏根 → ok + 版本号', () => {
  const root = path.join(TMP, 'Star Blade');
  const dir = path.join(root, 'SB', 'Binaries', 'Win64');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SB-Win64-Shipping.exe'), makePe(versionBlob({ fileVersion: '1.4.1' })));
  const r = gv.detect(root, { noCache: true });
  eq(r.ok, true, 'ok');
  eq(r.version, '1.4.1', 'version');
  eq(r.source, 'exe', 'source');
});

t('[3] 有 exe 但读不到版本 → 这个 exe 里读不到版本号', () => {
  const root = path.join(TMP, 'noroot-ver');
  const dir = path.join(root, 'SB', 'Binaries', 'Win64');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SB-Win64-Shipping.exe'), makePe(null));
  const r = gv.detect(root, { noCache: true });
  eq(r.ok, false, 'ok');
  eq(r.version, '', 'version 空');
  eq(r.reason, '这个 exe 里读不到版本号', 'reason');
});

t('[3] 缓存：同 mtime/size 不再读盘（第二次直接命中）', () => {
  const root = path.join(TMP, 'cached');
  const dir = path.join(root, 'SB', 'Binaries', 'Win64');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SB-Win64-Shipping.exe'), makePe(versionBlob({ fileVersion: '9.9.9' })));
  const a = gv.detect(root);
  fs.writeFileSync(path.join(dir, 'SB-Win64-Shipping.exe'), Buffer.alloc(8)); // 内容换成垃圾，但 mtime 变了
  const b = gv.detect(root, { noCache: true });
  eq(a.version, '9.9.9', '第一次');
  eq(b.ok, false, '不走缓存时应重新读盘（垃圾内容读不到）');
});

/* ---------------- [4] 接线静态断言 ---------------- */

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

t('[4] ipc 里引入并给出 version', () => {
  const src = read('src/main/ipc.js');
  if (!/const gameVersion = require\('\.\/gameVersion'\)/.test(src)) throw new Error('没引入 gameVersion');
  const at = src.indexOf('function inspectGame(');
  const seg = src.slice(at, at + 2200);
  if (!/gameVersion\.detect\(root\)/.test(seg)) throw new Error('inspectGame 没调 detect');
  if (!/found: false[^}]*version: \{ ok: false, version: '' \}/.test(seg)) throw new Error('无游戏分支没给空 version');
  if (!/return \{ found: true, \.\.\.info, layout, writable, version \}/.test(seg)) throw new Error('有游戏分支没带 version');
});

t('[4] 渲染层三个函数 + 侧栏/顶栏挂点', () => {
  const src = read('src/renderer/app.js');
  for (const f of ['function gameVerOf(', 'function gameVerText(', 'function syncGameVerChip(']) {
    if (!src.includes(f)) throw new Error('缺 ' + f);
  }
  if (!/syncGameVerChip\(ver\)/.test(src)) throw new Error('renderSidebar 没调 syncGameVerChip');
  if (!/\$\('#gameVer'\)/.test(src)) throw new Error('syncGameVerChip 没找 #gameVer');
  if (!src.includes('读自主程序版本信息')) throw new Error('缺「读自主程序版本信息」');
  if (!src.includes('游戏版本')) throw new Error('设置页缺「游戏版本」');
  if (!src.includes('${gameVerText(g)}')) throw new Error('设置页没渲染 gameVerText');
  if (!src.includes('id="setGameVer"')) throw new Error('设置页缺 #setGameVer 容器');
});

t('[4] index.html 顶栏版本号 chip', () => {
  const src = read('src/renderer/index.html');
  const at = src.indexOf('id="gameVer"');
  if (at < 0) throw new Error('缺 #gameVer');
  const seg = src.slice(Math.max(0, at - 400), at + 300);
  if (!/id="btnLaunch"/.test(seg)) throw new Error('chip 没挨着启动按钮');
  if (!/data-i18n-skip/.test(seg)) throw new Error('chip 没标 i18n-skip（版本号不该被翻译）');
});

t('[4] style.css 有 .verchip', () => {
  const src = read('src/renderer/style.css');
  if (!/\.verchip\s*\{/.test(src)) throw new Error('缺 .verchip 样式');
  if (!/font-family: Consolas/.test(src)) throw new Error('.verchip 没用等宽字体');
});

t('[4] i18n 4 条键落在 keys.json 与 13 个语言包', () => {
  const raw = require('../_probe/i18n-keys.json');
  const keys = Array.isArray(raw) ? raw : Object.keys(raw);
  const want = ['游戏版本', '读自主程序版本信息', '这个 exe 里读不到版本号', '找不到游戏主程序'];
  for (const w of want) if (!keys.includes(w)) throw new Error('keys.json 缺 ' + w);
  const CODES = ['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL', 'tr-TR', 'th-TH'];
  for (const c of CODES) {
    const pack = read('src/renderer/locales/' + c + '.js');
    for (const w of want) if (!pack.includes("'" + w + "'") && !pack.includes('"' + w + '"')) throw new Error(`${c} 缺 ${w}`);
  }
});

t('[4] 文档模块树补了 gameVersion.js', () => {
  const src = read('docs/架构设计.md');
  if (!src.includes('gameVersion.js')) throw new Error('docs 没写 gameVersion.js');
});

/* ---------------- [5] 真游戏（有就跑，没有就跳过） ---------------- */

t('[5] 真游戏目录（若有）能读出形如 x.y.z 的版本', () => {
  const root = 'c:\\Star Blade';
  if (!fs.existsSync(path.join(root, 'SB', 'Binaries', 'Win64', 'SB-Win64-Shipping.exe'))) return true; // 跳过
  const r = gv.detect(root, { noCache: true });
  eq(r.ok, true, 'ok');
  if (!/^\d+\.\d+/.test(r.version)) throw new Error('版本号形状不对：' + r.version);
});

/* ---------------- 收尾 ---------------- */

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清不掉无妨 */ }

console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
}
