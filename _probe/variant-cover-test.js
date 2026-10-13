'use strict';
/**
 * 变体预览图（`src/main/variantCover.js`）+ 压缩包**选择性解压**（`archive.extract(names)`）。
 *
 * 纯 Node：只用临时目录里的自制 zip，**不碰真实游戏目录、不碰用户 data/**。
 *
 * 背景（2026-10-13 用户报）：mod 1430「BP Cooling suit」包里 7 个目录各一套配色，
 * 另有 7 张**同名 jpg** —— 不看图根本不知道 A~G 哪套是什么颜色。
 * 所以选择框要显示缩略图；而为了拿 7 张图把 142MB 全解出来太浪费，
 * 于是 `archive.extract` 支持只解指定条目。
 *
 * 运行：`npm run test:variant-cover`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const archive = require('../src/main/archive');
const paths = require('../src/main/paths');
const variantCover = require('../src/main/variantCover');

const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const BASE = path.join(os.tmpdir(), 'sb-variant-cover-test');
const SRC = path.join(BASE, 'src');
const PKG = path.join(BASE, 'pkg');
const OUT = path.join(BASE, 'out');

let pass = 0, fail = 0;
const fails = [];

function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}

async function ta(label, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}

/** 造一个最小的合法 JPEG（只要 `FF D8 FF` 魔数 + 一些字节；不校验完整结构） */
function fakeJpeg(n = 64) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 0x41)]);
}

function mk(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(base, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
}

function zip(name, files) {
  const stage = path.join(SRC, name);
  fs.rmSync(stage, { recursive: true, force: true });
  mk(stage, files);
  const out = path.join(PKG, name + '.zip');
  fs.mkdirSync(PKG, { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx1', out, '.'], { cwd: stage, stdio: 'ignore' });
  return out;
}

const E = (p, size = 100) => ({ path: p, dir: false, size });

(async () => {
  console.log('解压工具: ' + JSON.stringify(archive.toolInfo()));
  console.log('');

  /* ---- 1. normalizeStem ---- */
  console.log('=== 1. 名字归一化 ===');
  t('大小写不敏感', () => variantCover.normalizeStem('Cooling Suit_A') === variantCover.normalizeStem('cooling suit_a') || '不等');
  t('下划线 / 连字符 / 空格等价（`Cooling suit_A` == `Cooling Suit_A`）', () =>
    variantCover.normalizeStem('Cooling suit_A') === variantCover.normalizeStem('Cooling Suit_A') || '不等');
  t('扩展名被剥掉', () => variantCover.normalizeStem('A.jpg') === 'a' || variantCover.normalizeStem('A.jpg'));
  t('连字符也当分隔符', () =>
    variantCover.normalizeStem('cooling-suit-a') === variantCover.normalizeStem('Cooling Suit_A') || '不等');
  t('空值不抛', () => variantCover.normalizeStem(null) === '' || variantCover.normalizeStem(null));

  /* ---- 2. pickCover（纯函数） ---- */
  console.log('');
  console.log('=== 2. 目录 ↔ 图片配对 ===');
  {
    const entries = [
      E('Cooling suit_A/ID223699-Cooling suit_A_P.pak'),
      E('Cooling suit_A/ID223699-Cooling suit_A_P.ucas'),
      E('Cooling Suit_B/ID223699-Cooling Suit_B_P.pak'),
      E('Cooling Suit_A.jpg', 379000),
      E('Cooling Suit_B.jpg', 419000),
      E('Normal version Installation instructions.txt'),
      { path: 'Cooling suit_A', dir: true, size: 0 }
    ];
    const got = variantCover.pickCover(entries, ['Cooling suit_A', 'Cooling Suit_B']);
    t('两套都配到图', () => got.size === 2 ? true : got.size);
    t('`Cooling suit_A` ↔ `Cooling Suit_A.jpg`（大小写 + 空格差异不影响）', () =>
      got.get('Cooling suit_A') === 'Cooling Suit_A.jpg' ? true : got.get('Cooling suit_A'));
    t('`Cooling Suit_B` ↔ `Cooling Suit_B.jpg`', () =>
      got.get('Cooling Suit_B') === 'Cooling Suit_B.jpg' ? true : got.get('Cooling Suit_B'));

    // 目录**里面**的图优先
    const withInside = entries.concat([E('Cooling suit_A/cover.jpg', 900000)]);
    const got2 = variantCover.pickCover(withInside, ['Cooling suit_A']);
    t('目录内的图优先于根级同名图', () =>
      got2.get('Cooling suit_A') === 'Cooling suit_A/cover.jpg' ? true : got2.get('Cooling suit_A'));

    // 目录内多张 → 取最大
    const multi = entries.concat([
      E('Cooling suit_A/shot1.jpg', 100), E('Cooling suit_A/shot2.jpg', 500000)
    ]);
    const got3 = variantCover.pickCover(multi, ['Cooling suit_A']);
    t('目录内多张图 → 取最大那张', () =>
      got3.get('Cooling suit_A') === 'Cooling suit_A/shot2.jpg' ? true : got3.get('Cooling suit_A'));

    // 前缀兜底
    const prefixed = [E('Cooling Suit_A_preview.jpg', 100)];
    t('前缀兜底：`Cooling Suit_A_preview.jpg` ↔ `Cooling suit_A`', () =>
      variantCover.pickCover(prefixed, ['Cooling suit_A']).get('Cooling suit_A') === 'Cooling Suit_A_preview.jpg'
        ? true : '没配上');

    // 没有图
    t('包里没图 → 空 Map（不抛）', () => variantCover.pickCover(entries, ['Nopanties']).size === 0 ? true : '不该有');
    t('entries 为空 → 空 Map', () => variantCover.pickCover([], ['A']).size === 0 ? true : '不该有');
    t('entries 为 null → 空 Map', () => variantCover.pickCover(null, ['A']).size === 0 ? true : '不该有');
    t('dirs 为空 → 空 Map', () => variantCover.pickCover(entries, []).size === 0 ? true : '不该有');

    // 目录条目本身不能被当图片
    const onlyDir = [{ path: 'A.jpg', dir: true, size: 999 }];
    t('目录条目（dir:true）不会被当图片', () =>
      variantCover.pickCover(onlyDir, ['A']).size === 0 ? true : '把目录当图了');

    // 非图片扩展名不参与
    const nonImg = [E('Cooling suit_A.ini', 500)];
    t('非图片扩展名不参与配对', () =>
      variantCover.pickCover(nonImg, ['Cooling suit_A']).size === 0 ? true : '配上了非图片');
  }

  /* ---- 3. archive.extract(names)：选择性解压 ---- */
  console.log('');
  console.log('=== 3. 选择性解压（只解指定条目） ===');
  const SELECT_PKG = zip('select-pkg', {
    'Suit_A/ID1-A_P.pak': 'pakA',
    'Suit_A/ID1-A_P.ucas': 'ucasA',
    'Suit_B/ID1-B_P.pak': 'pakB',
    'Suit_A.jpg': fakeJpeg(4000),
    'Suit_B.jpg': fakeJpeg(5000),
    'readme.txt': 'hello'
  });
  {
    const out1 = path.join(OUT, 'sel-1');
    await ta('只解两个条目：不抛', async () => { await archive.extract(SELECT_PKG, out1, ['Suit_A.jpg', 'Suit_B.jpg']); return true; });
    t('只解出了这两张图（2 个文件）', () => {
      const got = fs.readdirSync(out1).filter(n => !n.startsWith('.'));
      return got.length === 2 ? true : JSON.stringify(got);
    });
    t('没把 pak 一起解出来', () =>
      !fs.existsSync(path.join(out1, 'Suit_A')) ? true : 'pak 目录被解出来了');
    t('图内容正确（JPEG 魔数）', () => {
      const b = fs.readFileSync(path.join(out1, 'Suit_A.jpg'));
      return (b[0] === 0xff && b[1] === 0xd8) ? true : '魔数 ' + b.slice(0, 2).toString('hex');
    });

    const out2 = path.join(OUT, 'sel-empty');
    await ta('传空数组 → 什么都不解（**不退回全解**）', async () => {
      await archive.extract(SELECT_PKG, out2, []);
      const got = fs.readdirSync(out2).filter(n => !n.startsWith('.'));
      return got.length === 0 ? true : '解出了 ' + JSON.stringify(got);
    });

    const out3 = path.join(OUT, 'sel-wild');
    await ta('名字里带 `*` → 被过滤掉，也不会退回全解', async () => {
      await archive.extract(SELECT_PKG, out3, ['*.jpg']);
      const got = fs.readdirSync(out3).filter(n => !n.startsWith('.'));
      return got.length === 0 ? true : '解出了 ' + JSON.stringify(got);
    });

    const out4 = path.join(OUT, 'sel-all');
    await ta('不传 names → 全解（老行为不变）', async () => {
      await archive.extract(SELECT_PKG, out4);
      return fs.existsSync(path.join(out4, 'Suit_A', 'ID1-A_P.pak')) &&
        fs.existsSync(path.join(out4, 'Suit_A.jpg'))
        ? true : '没全解';
    });
  }

  /* ---- 4. coversFor 端到端 ---- */
  console.log('');
  console.log('=== 4. coversFor（真实解压 + file:// 链接） ===');
  {
    const cov = await variantCover.coversFor(SELECT_PKG, ['Suit_A', 'Suit_B'], { cacheDir: path.join(OUT, 'c4') });
    t('两套都拿到链接', () => Object.keys(cov).length === 2 ? true : JSON.stringify(cov));
    t('链接是 file:// 形式', () => String(cov.Suit_A).startsWith('file://') ? true : cov.Suit_A);
    t('链接指向的文件真实存在', () => {
      const p = decodeURIComponent(cov.Suit_A.replace(/^file:\/\/\//, ''));
      return fs.existsSync(p) ? true : '不存在 ' + p;
    });
    t('图内容是有效 JPEG', () => {
      const p = decodeURIComponent(cov.Suit_B.replace(/^file:\/\/\//, ''));
      const b = fs.readFileSync(p);
      return (b[0] === 0xff && b[1] === 0xd8) ? true : '魔数不对';
    });

    // 第二次调用用**同一个 cacheDir** → 命中缓存，不该再解压一遍
    const cov2 = await variantCover.coversFor(SELECT_PKG, ['Suit_A', 'Suit_B'], { cacheDir: path.join(OUT, 'c4') });
    t('第二次调用走缓存（结果一致）', () => cov2.Suit_A === cov.Suit_A ? true : '不一致');

    await ta('包里没图 → 空对象（不抛）', async () => {
      const noImg = zip('noimg-pkg', { 'X/a_P.pak': 'x', 'Y/b_P.pak': 'y' });
      const r = await variantCover.coversFor(noImg, ['X', 'Y'], { cacheDir: path.join(OUT, 'c5') });
      return Object.keys(r).length === 0 ? true : JSON.stringify(r);
    });

    await ta('压缩包不存在 → 空对象（不抛）', async () => {
      const r = await variantCover.coversFor(path.join(BASE, 'nope.zip'), ['X'], { cacheDir: path.join(OUT, 'c8') });
      return Object.keys(r).length === 0 ? true : JSON.stringify(r);
    });

    await ta('dirs 为空 → 空对象', async () => {
      const r = await variantCover.coversFor(SELECT_PKG, [], { cacheDir: path.join(OUT, 'c6') });
      return Object.keys(r).length === 0 ? true : JSON.stringify(r);
    });

    await ta('archivePath 为 null → 空对象（不抛）', async () => {
      const r = await variantCover.coversFor(null, ['X'], { cacheDir: path.join(OUT, 'c7') });
      return Object.keys(r).length === 0 ? true : JSON.stringify(r);
    });

    t('缓存目录名带压缩包大小（同名不同包不会互相覆盖）', () =>
      /_[0-9a-z]+$/.test(variantCover.cacheDirFor(SELECT_PKG)) ? true : variantCover.cacheDirFor(SELECT_PKG));
  }

  /* ---- 5. 渲染层接线（源码级断言） ---- */
  console.log('');
  console.log('=== 5. 渲染层接线 ===');
  {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');
    const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf8');
    const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc.js'), 'utf8');

    t('preload 暴露了 variantCovers', () =>
      /variantCovers:\s*\(archivePath, dirs\)/.test(preload) ? true : '没暴露');
    t('主进程有 install:variantCovers 通道', () =>
      /handle\('install:variantCovers'/.test(ipc) ? true : '没有通道');
    t('通道**永不抛**（catch 后返回 {}）', () => {
      const i = ipc.indexOf("handle('install:variantCovers'");
      const seg = ipc.slice(i, i + 700);
      return /catch[\s\S]*return \{\}/.test(seg) ? true : '没有兜底';
    });
    t('选择框每项有图位 `<span class="vc">`', () =>
      /<span class="vc" data-vc=/.test(appJs) ? true : '没有图位');
    t('有 loadVariantCovers 拉图', () =>
      /async function loadVariantCovers/.test(appJs) ? true : '没有拉图函数');
    t('拉图后按 dataset 比对回填（不拼选择器）', () =>
      /for \(const box of \$\$\('#vList \.vc'\)\)/.test(appJs) ? true : '没有回填');
    t('对话框已关/换任务时不回填', () =>
      /state\.modalTask !== t\.id\) return/.test(appJs) ? true : '没有时序护栏');
    t('图加载失败时收起图位（不留破图）', () =>
      /onerror="this\.parentNode\.classList\.remove\('has'\)/.test(appJs) ? true : '没有 onerror');
    t('图位样式：有图才占位', () =>
      /\.vopt \.vc\{display:none/.test(css) && /\.vopt \.vc\.has\{display:block\}/.test(css)
        ? true : '样式不对');
    t('图位固定 72x72 + object-fit:cover', () =>
      /\.vopt \.vc\{[^}]*width:72px;height:72px/.test(css) && /object-fit:cover/.test(css) ? true : '尺寸不对');
  }

  /* ---- 6. 文案：有候选就不该说「结构无法识别」 ---- */
  console.log('');
  console.log('=== 6. 「结构无法识别」文案修正 ===');
  {
    const installer = require('../src/main/installer');
    const ROOT = path.join(BASE, 'fakeroot');
    fs.mkdirSync(path.join(ROOT, 'SB', 'Content', 'Paks'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'SB', 'Content', 'Paks', 'pakchunk0.pak'), 'base');

    // 与 mod 1430 同形态：7 个目录各一套 pak + 一张同名图 + 一份说明
    const files = { 'Normal version Installation instructions.txt': 'drag the folder into ~mods' };
    for (const L of ['A', 'B', 'C']) {
      files[`Cooling suit_${L}/ID223699-Cooling suit_${L}_P.pak`] = 'p';
      files[`Cooling suit_${L}/ID223699-Cooling suit_${L}_P.ucas`] = 'u';
      files[`Cooling Suit_${L}.jpg`] = fakeJpeg(200);
    }
    const vpkg = zip('variant-reason', files);
    const p = await installer.analyze(ROOT, vpkg, { name: 'variant-reason' });

    t('识别失败但仍给出 3 个候选', () =>
      (p.ok === false && (p.options || []).length === 3) ? true : 'options=' + (p.options || []).length);
    t('**有 reason**（不再让调用方兜底成「结构无法识别」）', () =>
      (typeof p.reason === 'string' && p.reason.includes('3 套')) ? true : 'reason=' + JSON.stringify(p.reason));
    t('reason 里不含「结构无法识别」字样', () =>
      !/结构无法/.test(p.reason || '') ? true : 'reason 还是那句误导文案');
    t('warnings 也不再说「结构与已知的 mod 布局都不匹配」', () =>
      !(p.warnings || []).some(w => /都不匹配/.test(w)) ? true : JSON.stringify(p.warnings));
    t('互斥分组把三套编成一组（同资产 ID223699）', () =>
      (p.exclusiveGroups || []).length === 1 && p.exclusiveGroups[0].length === 3
        ? true : JSON.stringify(p.exclusiveGroups));
    const cov = await variantCover.coversFor(vpkg, (p.options || []).map(o => o.dir),
      { cacheDir: path.join(OUT, 'cover-cache') });
    t('预览图 3/3 命中', () => Object.keys(cov).length === 3 ? true : JSON.stringify(Object.keys(cov)));
  }

  /* ---- 7. 测试不得污染真实数据目录 ---- */
  //
  // 与 `opts.backupDir` 同一个坑：`coversFor` 默认写到 `data/cache/variants`，
  // 测试不传 `cacheDir` 就会把**假 JPEG** 堆进用户真实缓存里。
  console.log('');
  console.log('=== 7. 测试未污染真实缓存目录 ===');
  {
    const real = path.join(paths.CACHE, 'variants');
    let names = [];
    try { names = fs.readdirSync(real); } catch { names = []; }
    const dirty = names.filter(n => /sb-variant|select-pkg|noimg-pkg|variant-reason|select-pkg|noimg/.test(n));
    t('data/cache/variants 里没有本套件的测试产物', () =>
      dirty.length === 0 ? true : '残留 ' + dirty.join(','));
  }

  // 收尾
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* 忽略 */ }

  console.log('\n' + '='.repeat(52));
  console.log(`  通过 ${pass} / 失败 ${fail}`);
  if (fails.length) { console.log('  失败项：'); fails.forEach(f => console.log('    · ' + f)); }
  console.log('='.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：' + e.message + '\n' + e.stack); process.exit(1); });
