'use strict';
/**
 * 解压工具报错「说人话」—— 用户 2026-10-13 截图里 mod 1763 的错误是
 *   「结构识别失败：7-Zip 26.03 (x64) : Copyright (c) 1999-2026 Igor Pavlov :
 *     2026-09-03 / Scanning the drive for archives: 1 file, 50692225 bytes …」
 * 一整段横幅，没有任何可行动作。真实原因是那个 49MB 的 zip **下载被截断**了
 * （7z 退出码 2 + `ERRORS: Unexpected end of archive`）。
 *
 * 本套件验 `explainToolError()` 的纯函数行为：
 *   · 截断 / CRC 坏 / 不是压缩包 / 文件不存在 → 各自的人话
 *   · 7z 横幅、扫描进度、`Listing archive` 等噪声**一律不许**出现在消息里
 *   · 长度有上限（别把几百 KB 的 stdout 再塞回界面）
 *
 * 运行：`npm run test:tool-error`
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { explainToolError, listEntries } = require('../src/main/archive');

let pass = 0, fail = 0;
function t(label, fn) {
  let r;
  try { r = fn(); } catch (e) { r = e.message; }
  if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
}
/** 造一个 err（模拟 execFile 回调的 err：code 是数字） */
function errOf(code) { const e = new Error('Command failed'); e.code = code; return e; }

async function main() {
// 真机抓来的 7z 输出（mod 1763，退出码 2）
const REAL_1763 = [
  '',
  '7-Zip 26.03 (x64) : Copyright (c) 1999-2026 Igor Pavlov : 2026-09-03',
  '',
  'Scanning the drive for archives:',
  '1 file, 50692225 bytes (49 MiB)',
  '',
  'Listing archive: D:\\AI game\\StarBladeModManager\\data\\library\\1763_Punk top retexture and short denim CNS_1.4.zip',
  '',
  '--',
  'Path = 1763_Punk top retexture and short denim CNS_1.4.zip',
  'Type = zip',
  'ERRORS:',
  'Unexpected end of archive',
  'Physical Size = 50692225',
  'Characteristics = Local',
  '',
  '----------',
  'Path = Punktop_cns_693.dekcns.json',
  'Folder = -',
  'Size = 686',
  '',
  'Errors: 1'
].join('\r\n');

console.log('\n[1] 真实抓包：49MB 的 zip 下载被截断（7z 退出码 2）');
{
  const msg = explainToolError(errOf(2), REAL_1763, '');
  console.log('    → ' + msg);
  t('点明「不完整 / 下载被中断」', () => /不完整/.test(msg) || msg);
  t('给出可行动作「重新下载」', () => /重新下载/.test(msg) || msg);
  t('不再出现 7z 横幅', () => !/7-Zip 26|Copyright \(c\)/.test(msg) || msg);
  t('不再出现扫描进度 / Listing', () => !/Scanning the drive|Listing archive/.test(msg) || msg);
  t('带上退出码（排查用）', () => /退出码 2/.test(msg) || msg);
  t('消息短（≤ 260 字）', () => msg.length <= 260 || '长度 ' + msg.length);
}

console.log('\n[2] 其它典型故障');
{
  const crc = explainToolError(errOf(2), [
    '7-Zip 26.03 (x64) : Copyright (c) 1999-2026 Igor Pavlov',
    'ERRORS:',
    'CRC Failed: X_P.pak',
    'Errors: 1'
  ].join('\n'), '');
  t('CRC 坏 → 「内容损坏」', () => /损坏|CRC/.test(crc) && !/Copyright/.test(crc) || crc);

  const notZip = explainToolError(errOf(2), '7-Zip 26.03 (x64)\nERRORS:\nCannot open file as archive [foo.zip]\nErrors: 1', '');
  t('不是压缩包 → 直说「不是受支持的压缩包」', () => /不是受支持的压缩包/.test(notZip) || notZip);

  const notTar = explainToolError(errOf(1), "tar: This does not look like a tar archive\ntar: Exiting with failure status", '');
  t('tar 误判 → 「不是 tar 压缩包」', () => /不是 tar/.test(notTar) || notTar);

  const missing = explainToolError(errOf(2), '', 'ERROR: D:\\x\\y.zip : 系统找不到指定的文件');
  t('文件不在 → 说「不存在或正在被占用」', () => /不存在|占用/.test(missing) || missing);

  const weird = explainToolError(errOf(1), '7-Zip 26.03 (x64) : Copyright (c) 1999-2026 Igor Pavlov\nERRORS:\nSomething odd happened\nErrors: 1', '');
  t('未知故障 → 保留 7z 自己那句话', () => /Something odd happened/.test(weird) && !/Copyright/.test(weird) || weird);

  const empty = explainToolError(errOf(127), '', '');
  t('什么都没有 → 兜底「解压工具执行失败」', () => /解压工具执行失败/.test(empty) || empty);

  const noCode = explainToolError(null, '7-Zip 26.03 (x64)\nERRORS:\nUnexpected end of archive', '');
  t('没有退出码也不崩', () => /不完整/.test(noCode) && !/退出码/.test(noCode) || noCode);

  const long = explainToolError(errOf(2), 'ERRORS:\n' + 'x'.repeat(5000), '');
  t('超长输出被截断', () => long.length <= 260 || '长度 ' + long.length);
}

console.log('\n[3] 真文件：listEntries 走的是同一条报错通路');
{
  const BASE = path.join(os.tmpdir(), 'sb-tool-error-test');
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* 沙箱守卫 */ }
  fs.mkdirSync(BASE, { recursive: true });
  fs.writeFileSync(path.join(BASE, 'a.txt'), 'hello');

  const good = path.join(BASE, 'good.zip');
  const bad = path.join(BASE, 'truncated.zip');
  const SZ = 'C:\\Program Files\\7-Zip\\7z.exe';
  // 🔴 沙箱会拦掉对 exe 的**同步** spawn（一律 EBUSY，和 electron.exe 一样）
  //    → 用异步 execFile 造包
  const zipIt = (out, file) => new Promise((res, rej) => {
    execFile(SZ, ['a', '-bso0', '-bsp0', out, file], { cwd: BASE }, (e) => (e ? rej(e) : res()));
  });
  if (fs.existsSync(SZ)) {
    try {
      await zipIt(good, path.join(BASE, 'a.txt'));
      const buf = fs.readFileSync(good);
      // 只留前一半：7z 认得这是 zip，但读不到中央目录 → 真实世界的「下载被截断」
      fs.writeFileSync(bad, buf.subarray(0, Math.floor(buf.length / 2)));
    } catch { /* 造不出包就跳过真文件用例 */ }
  }

  const run = async (p, label) => {
    let r;
    try { await listEntries(p); r = '竟然没报错'; }
    catch (e) { r = String(e.message); }
    t(label, () => (/不完整|重新下载|不存在/.test(r) && !/Copyright/.test(r)) ? true : r);
  };

  await run(path.join(BASE, 'nope.zip'), '不存在的 zip → 说清「压缩包不存在」');
  if (fs.existsSync(bad)) await run(bad, '截断的 zip → 「压缩包不完整，请重新下载」');
  else console.log('  · 本机没有 7-Zip，跳过真文件用例');
}

}

main().then(() => {
console.log(`\n合计：${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
});
