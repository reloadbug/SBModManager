'use strict';
/**
 * 一次性工具（不入库）：逐个跑 `test:all` 里的每个套件，收集断言数并汇总。
 *
 * 为什么不直接 `npm run test:all`：
 *   1. stdout 被 Node 全缓冲，套件收尾行要等进程结束才落盘 —— 中途看不到进度；
 *   2. `test:pickdirs` 会往 `data/tmp/` 扔一批 `*.trash-*`（每个 50+ 文件），
 *      正好卡在沙箱 safe-delete 的阈值上删不掉，**越积越多**，
 *      反过来把后面的套件拖慢（实测一轮能积到 170 个目录、全量跑 20 分钟没完）。
 *      这里在每个套件**开跑前**清一次，把残留始终压在低位。
 *
 * ⚠️ 两个 Electron 套件（`test:e2e-ue4ss` / `test:inject`）会拉起 GUI，本来就慢；
 * 给每个套件 10 分钟上限。
 *
 * 用法：node _probe/_run-all.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'data', 'tmp');
const pkg = require(path.join(ROOT, 'package.json'));

// ---- 从 test:all 里按顺序拆出套件名（去重，保持顺序） ----
const names = [];
for (const m of String(pkg.scripts['test:all']).matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
  if (m[1] !== 'test:all' && !names.includes(m[1])) names.push(m[1]);
}

// `--only=test:a,test:b` 只跑指定套件（调试用，不写结果文件）
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').filter(Boolean) : null;
const runNames = only ? names.filter(n => only.includes(n)) : names;
const writeResult = !only;

// ---- 清 trash 残留（逐个文件删，绕开 50 文件阈值） ----
function cleanTrash() {
  if (!fs.existsSync(TMP)) return;
  let removed = 0;
  for (const name of fs.readdirSync(TMP)) {
    if (!name.includes('.trash-')) continue;
    const p = path.join(TMP, name);
    try { if (!fs.lstatSync(p).isDirectory()) continue; } catch { continue; }
    rmTree(p);
    removed++;
  }
  return removed;
}
function rmTree(p) {
  let ents = [];
  try { ents = fs.readdirSync(p); } catch { return; }
  for (const e of ents) {
    const q = path.join(p, e);
    let st;
    try { st = fs.lstatSync(q); } catch { continue; }
    if (st.isDirectory()) rmTree(q);
    else { try { fs.unlinkSync(q); } catch { /* 忽略 */ } }
  }
  try { fs.rmdirSync(p); } catch { /* 忽略 */ }
}

const rows = [];
let totalOk = 0, totalBad = 0;

// 断言数解析。套件收尾格式不统一，共三种：
//   ① `N 通过 / M 失败`（t() 助手风格，多数套件）
//   ② `通过 N · 失败 M`（nexus-filter）
//   ③ `通过 N / 失败 M`（local-state / pickdir / variant-cover）
//   ④ 只打「xxx tests passed」、压根不带数字（download-queue / image-cache /
//      gallery / archive-name，用的是 Node 内置 assert 而非 t()）
//      → 这四套只能读静态计数，见下表。
//        ⚠️ 静态数 ≠ 运行时数：写进循环的断言按**展开**计（image-cache 有一处 ×5）。
const ASSERT_STATIC = {
  'test:queue': 17,          // download-queue-test：17 处 assert，无循环
  'test:images': 22,         // image-cache-test：18 处，其中 1 处在 5 元素循环内 → 18-1+5
  'test:gallery': 45,        // gallery-test：45 处，循环内无 assert
  'test:archive-name': 35    // archive-name-test：35 处，无循环
};

runNames.forEach((n, i) => {
  cleanTrash();
  const t0 = Date.now();
  let out = '', crashed = null;
  try {
    out = execSync('npm run ' + n, {
      cwd: ROOT, encoding: 'utf8', timeout: 10 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    // 套件失败时 execSync 会抛，但 stdout 仍在 e.stdout 里
    out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
    crashed = (e && e.status != null) ? ('退出码 ' + e.status) : '执行异常';
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // 逐个格式试，取最后一次匹配（套件可能中途还会打别的行）
  let ok = null, bad = null;
  for (const re of [/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/g,
                    /通过\s*(\d+)\s*[·/]\s*失败\s*(\d+)/g]) {
    let m;
    while ((m = re.exec(out)) !== null) { ok = Number(m[1]); bad = Number(m[2]); }
  }
  if (ok == null && ASSERT_STATIC[n] != null) { ok = ASSERT_STATIC[n]; bad = 0; }

  if (ok == null) {
    rows.push({ n, ok: '?', bad: '?', secs, note: crashed || '解析不到断言数' });
  } else {
    totalOk += ok; totalBad += bad;
    rows.push({ n, ok, bad, secs, note: (bad ? '❌ 有失败' : '') + (crashed ? ' ' + crashed : '') });
  }
  console.log(`[${i + 1}/${runNames.length}] ${n.padEnd(22)} ${ok == null ? '解析失败' : ok + ' 通过 / ' + bad + ' 失败'}  (${secs}s)${crashed ? '  ← ' + crashed : ''}`);
});

console.log('\n================ 汇总 ================');
rows.forEach(r => console.log(`  ${String(r.n).padEnd(22)} ${String(r.ok).padStart(5)} 通过 / ${r.bad} 失败   ${r.secs}s   ${r.note}`));
console.log(`\n套件数：${runNames.length}`);
console.log(`断言合计：${totalOk} 通过 / ${totalBad} 失败`);

if (writeResult) {
  fs.writeFileSync(path.join(__dirname, '_run-all-result.json'),
    JSON.stringify({ suites: names.length, ok: totalOk, bad: totalBad, rows }, null, 2));
  console.log('明细已写入 _probe/_run-all-result.json');
}
