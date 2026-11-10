'use strict';
/**
 * toggleName 探针 —— 「开/关」文件名规则的唯一口径（2026-11-10）
 *
 * 用户连报三次，都是同一处：
 *   · 批量关闭有一部分出错（CNS 换装包被跳过）
 *   · 「纠正开关 1 条」但 mod 依然无法禁用（核对时只认 .disabled 后缀 → 改回已启用）
 *   · 现在开启也不好使了（已关掉的 x.pak.disabled 不被认作受管文件 → 找不到文件）
 *
 * 这个文件盯住三件事：
 *   A. 四种写法（pak 开/关、CNS 索引开/关，含裸 .dekcns）都能正反改回来
 *   B. reconcile 按磁盘核对时，`.dekcns.disabled.json` 必须算「关着」
 *   C. ipc / reconcile / scanner / crashLog 四处都走同一套判定（不许再各写正则）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src/main/toggleName.js'));
const reconcile = require(path.join(ROOT, 'src/main/reconcile.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  →  ' + extra)); }
}
function eq(name, got, want) { ok(name, got === want, JSON.stringify(got) + ' ≠ ' + JSON.stringify(want)); }
function srcOf(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ================= A. 纯函数：四种写法都能正反改 ================= */
{
  eq('pak 开着 → 停用', T.renameStep('A_P.pak', false).next, 'A_P.pak.disabled');
  eq('pak 开着 + 要启用 = 不动', T.renameStep('A_P.pak', true).next, null);
  eq('pak 关着 → 启用', T.renameStep('A_P.pak.disabled', true).next, 'A_P.pak');
  eq('pak 关着 + 要停用 = 不动', T.renameStep('A_P.pak.disabled', false).next, null);
  ok('已关掉的 pak 仍算受管（这就是「开启不好使」的根）', T.renameStep('A_P.pak.disabled', true).managed === true);
  eq('ucas 同上', T.renameStep('A_P.ucas', false).next, 'A_P.ucas.disabled');
  eq('utoc 同上', T.renameStep('A_P.utoc.disabled', true).next, 'A_P.utoc');

  eq('CNS 索引开着 → 停用：标记插在 .json 前面', T.renameStep('x.dekcns.json', false).next, 'x.dekcns.disabled.json');
  ok('停用后的名字里不再含 dekcns.json 子串', T.renameStep('x.dekcns.json', false).next.indexOf('dekcns.json') < 0);
  eq('CNS 索引关着 → 启用', T.renameStep('x.dekcns.disabled.json', true).next, 'x.dekcns.json');
  eq('CNS 索引关着 + 要停用 = 不动', T.renameStep('x.dekcns.disabled.json', false).next, null);
  eq('dekani 同理', T.renameStep('y.dekani.json', false).next, 'y.dekani.disabled.json');
  eq('裸 .dekcns（老包）→ 停用', T.renameStep('z.dekcns', false).next, 'z.dekcns.disabled');
  eq('裸 .dekcns 关着 → 启用', T.renameStep('z.dekcns.disabled', true).next, 'z.dekcns');

  ok('enabled.txt 不归我们管', T.renameStep('enabled.txt', false).managed === false);
  ok('main.lua 不归我们管', T.renameStep('main.lua', false).managed === false);

  ok('isDisabledName 认 pak 关着', T.isDisabledName('a.pak.disabled') === true);
  ok('isDisabledName 认 CNS 索引关着', T.isDisabledName('a.dekcns.disabled.json') === true);
  ok('isDisabledName 不冤枉开着', T.isDisabledName('a.pak') === false && T.isDisabledName('a.dekcns.json') === false);
  ok('isDisabledName 不冤枉 txt', T.isDisabledName('enabled.txt') === false);

  eq('stripDisabled 还原 CNS 索引', T.stripDisabled('a.dekcns.disabled.json'), 'a.dekcns.json');
  eq('stripDisabled 还原 pak', T.stripDisabled('a.pak.disabled'), 'a.pak');
  eq('stripDisabled 原样返回', T.stripDisabled('a.pak'), 'a.pak');

  eq('counterpart：开着的 pak → 关着的名字', T.counterpartName('a.pak'), 'a.pak.disabled');
  eq('counterpart：关着的 pak → 开着的名字', T.counterpartName('a.pak.disabled'), 'a.pak');
  eq('counterpart：开着的 CNS 索引', T.counterpartName('a.dekcns.json'), 'a.dekcns.disabled.json');
  eq('counterpart：关着的 CNS 索引', T.counterpartName('a.dekcns.disabled.json'), 'a.dekcns.json');
  eq('counterpart：无关文件为空', T.counterpartName('enabled.txt'), '');
}

/* ================= B. reconcile 按磁盘核对，不许把「关着」改回「开着」 ================= */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmm-toggle-'));
  const write = (name) => { const p = path.join(dir, name); fs.writeFileSync(p, 'x'); return p; };

  const offJson = write('ModA.dekcns.disabled.json');
  const onJson = write('ModB.dekcns.json');
  const offPak = write('ModC_P.pak.disabled');

  const entries = [
    { id: 'a', name: 'A', enabled: true, manifest: [{ path: offJson, rel: 'ModA.dekcns.disabled.json', size: 1 }] },
    { id: 'b', name: 'B', enabled: true, manifest: [{ path: onJson, rel: 'ModB.dekcns.json', size: 1 }] },
    { id: 'c', name: 'C', enabled: false, manifest: [{ path: offPak, rel: 'ModC_P.pak.disabled', size: 1 }] }
  ];

  const report = reconcile.plan(entries);
  const flagged = (report.flag || []).map((f) => f.id + ':' + f.from + '>' + f.to);
  ok('A（磁盘关着、账本说开着）→ 纠正为关闭', flagged.includes('a:true>false'), flagged.join('|'));
  ok('B（磁盘开着、账本说开着）→ 不动', !flagged.some((x) => x.indexOf('b:') === 0), flagged.join('|'));
  ok('C（磁盘关着、账本也说关着）→ 不动', !flagged.some((x) => x.indexOf('c:') === 0), flagged.join('|'));
  ok('一条都没被误判成「文件丢了」', (report.drop || []).length === 0, JSON.stringify(report.drop));

  fs.rmSync(dir, { recursive: true, force: true });
}

/* ================= C. 接线：四处走同一套判定 ================= */
{
  const ipc = srcOf('src/main/ipc.js');
  const rec = srcOf('src/main/reconcile.js');
  const scan = srcOf('src/main/scanner.js');
  const crash = srcOf('src/main/crashLog.js');
  const mod = srcOf('src/main/toggleName.js');

  ok('ipc 引入 toggleName', /const toggleName = require\('\.\/toggleName'\);/.test(ipc));
  ok('ipc 的 renameStep 来自模块', /const renameStep = toggleName\.renameStep;/.test(ipc));
  ok('ipc 不再自己定义 RENAMEABLE/DATA_INDEX', !/const RENAMEABLE = /.test(ipc) && !/const DATA_INDEX_ON/.test(ipc));
  ok('ipc 会找「另一种写法」', /toggleName\.counterpartName\(/.test(ipc));
  ok('ipc 把修正记进 manifest', /const fixed = \[\];/.test(ipc) && /\.\.\.fixed, \.\.\.renames/.test(ipc));

  ok('reconcile 引入 toggleName', /require\('\.\/toggleName'\)/.test(rec));
  ok('reconcile 用 isDisabledName 判定', /toggleName\.isDisabledName\(/.test(rec));
  ok('reconcile 不再自己写 .disabled 正则', !/\/\\\.disabled\$\/i/.test(rec));

  ok('scanner 用 isDisabledName/stripDisabled', /toggleName\.isDisabledName\(/.test(scan) && /toggleName\.stripDisabled\(/.test(scan));
  ok('crashLog 用同一套判定', /toggleName\.isDisabledName\(/.test(crash) && /toggleName\.stripDisabled\(/.test(crash));
  ok('crashLog 认得裸 .dekcns', /\(dekcns\|dekani\)\(\\\.json\)\?\$/.test(crash) || /dekcns\|dekani/.test(crash));

  ok('模块注释写清「不能加 .disabled 后缀」的原因', /dekcns\.json/.test(mod) && /子串/.test(mod));
  ok('模块把「已关掉的 pak 也要认」写进注释', /永远开不回来|不被认作受管|开启不好使/.test(mod));
}

/* ================= D. 真账本抽查：每条都得有「受管文件」，否则永远开不了 ================= */
{
  const real = path.join('c:', 'Star Blade', '.sbmod', 'mods.json');
  if (fs.existsSync(real)) {
    let reg = {};
    try { reg = JSON.parse(fs.readFileSync(real, 'utf8')); } catch { reg = {}; }
    const list = Array.isArray(reg) ? reg : (reg.mods || []);
    const dead = [];
    for (const m of list) {
      if (!['pak', 'logicmod', 'cns'].includes(m.kind)) continue;
      const man = m.manifest || [];
      let found = 0;
      for (const x of man) {
        const p = String(x.path || '');
        if (!p || !fs.existsSync(p)) continue;
        if (T.renameStep(path.basename(p), false).managed) found++;
      }
      if (!found) dead.push(m.id);
    }
    ok('真账本里没有「一个受管文件都没有」的条目', dead.length === 0, dead.slice(0, 5).join(', '));
  } else {
    ok('真账本不存在（跳过抽查）', true);
  }
}

console.log('');
console.log(pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
