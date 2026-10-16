'use strict';
/* 实测：本轮新增的下载页文案能否被 i18n 的 DOM 翻译器正确命中。
 *
 * 直接 require 渲染层的 `i18n.js`（UMD，Node 下挂 globalThis），
 * 再把 13 个语言包喂给它的 register()，然后调 lookup() 模拟 DOM 文本节点。
 *
 *   node _probe/i18n-lookup-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const I18N = require(path.join(ROOT, 'src/renderer/i18n.js'));

/** 把某个语言包灌进 I18N */
function loadPack(code) {
  const file = path.join(ROOT, 'src/renderer/locales', code + '.js');
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { window: { I18N: { register: (c, d) => I18N.register(c, d) } } };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(src, sandbox, { filename: code + '.js' });
}

/** 用例：[原始 DOM 文本, { code: 期望译文 }] */
const CASES = [
  // —— 吸顶工具条的三个批量按钮（DOM 里是单个文本节点，数字在括号内）——
  // ⚠️ 计数尾缀 `（3）` 是**原样拼回**的：`lookup()` 的第 ② 级会把两头的
  //    数字/括号剥掉、拿剩下的词核心查表，再「剥掉的前缀 + 译文 + 剥掉的后缀」拼回去。
  //    所以英文下全角括号不会变半角 —— 这是既有取舍（`↻ 全部恢复（17）` 也一样），
  //    想改就得动 i18n 核心的剥离逻辑，收益太小，这里按实际行为断言。
  ['⏸ 全部停止（3）', { 'en-US': '⏸ Stop all（3）', 'ja-JP': '⏸ すべて停止（3）' }],
  ['⚡ 一键安装全部（2）', { 'en-US': '⚡ Install all（2）' }],
  ['🔄 全部恢复（4）', {}],            // 旧文案，回归用（无期望值 = 只要求不含中文）

  // —— 单卡按钮 ——
  ['⏸ 暂停', { 'en-US': '⏸ Pause', 'ko-KR': '⏸ 일시정지' }],
  ['▶ 继续', { 'en-US': '▶ Resume' }],
  ['🗑 彻底删除', { 'en-US': '🗑 Delete permanently' }],
  ['⚡ 一键安装', { 'en-US': '⚡ Quick install' }],
  ['选择内容', { 'en-US': 'Choose content' }],

  // —— 形状键：数字夹在词中间 ——
  ['处理 3 项', { 'en-US': 'Processed 3 items', 'de-DE': '3 Aufgaben verarbeitet' }],
  ['仍有 2 项需要你挑内容', { 'en-US': 'Still 2 need you to pick content' }],
  ['正在处理 1 项', { 'en-US': 'Processing 1 tasks' }],
  ['已停止 4 项（进度已保留，可点「全部恢复」接着下）',
    { 'en-US': 'Stopped 4 tasks (progress kept — click "Resume all" to continue)' }],
  ['失败 1', { 'en-US': 'Failed 1' }],
  ['包里有 3 套内容，其中 2 组是同一件东西的不同版本 —— 已按「每组第一套」替你选好，点「一键安装」即可（想改就点「选择内容」）',
    { 'en-US': 'There are 3 sets of content, of which 2 groups are different versions of the same thing — the first set of each group is already picked for you, just click "Quick install" (click "Choose content" to change)' }],
  ['包里有 2 套内容，互不相关 —— 点「一键安装」全部装上',
    { 'en-US': 'There are 2 sets of content, unrelated — click "Quick install" to install them all' }],

  // —— toast ——
  ['一键安装：处理 3 项，失败 1，仍有 2 项需要你挑内容', {}],
  ['已暂停（已下载的部分已保留，点「继续」接着下）', { 'en-US': 'Paused (the downloaded part is kept — click "Resume" to continue)' }],
  ['没有正在下载的任务', { 'en-US': 'No downloads in progress' }],
  ['已彻底删除', { 'en-US': 'Permanently deleted' }],

  // —— 有 Mod 名夹在中间（那段翻不了是已知取舍，只要求不崩）——
  ['彻底删除「Cyberpunk 2077」？', {}],

  // —— 主进程送上来的错误文案 ——
  // ⚠️ 注意是「没有来源 Mod ID」而不是「缺少 Mod ID / 文件 ID（可点「手动」）」——
  //    后者是上一轮拆文案时**废弃**的笼统键（`autoauth-fileid-test.js` 有断言盯着它，
  //    见 `i18n-add-keys.js` 里 EXTRA 的那段注释）。拿废弃键当用例会一直红。
  ['这条任务没有来源 Mod ID，无法自动授权（可点「手动」）。',
    { 'en-US': 'This task has no source Mod ID, so it cannot be authorized automatically (click "Manual").' }],
  ['这个 Mod 在 Nexus 上没有可下载的文件，无法自动授权（可点「手动」）。', {}],
  ['取不到这个 Mod 的文件列表（网络或接口问题），稍后再试或点「手动」。', {}],

  // —— 自动授权失败原因（humanize）——
  ['Nexus 未登录（或登录已失效）。到「Nexus 账号」里登录一次即可。',
    { 'en-US': 'Not signed in to Nexus (or the session expired). Sign in once from "Nexus Account".' }],
  ['这条任务缺少 Mod ID / 文件 ID，无法自动授权。',
    { 'en-US': 'This task is missing the Mod ID / file ID, so it cannot be authorized automatically.' }],
  // 运行时错误码夹在括号里（不是数字，形状键吃不下）→ 靠前后两段片段各换一次
  ['连不上 Nexus（Error: net::ERR_CONNECTION_TIMED_OUT），稍后再试或点「手动授权」。',
    { 'en-US': 'Can\'t reach Nexus (Error: net::ERR_CONNECTION_TIMED_OUT). Try again later or click "Manual authorize".' }],
  ['这个文件没有「Mod Manager Download」链接（作者只开了手动下载），请点「手动授权」。', {}],

  // —— 覆盖清单顶部的「⇄ 对比」入口（0.2.9）——
  // 按钮文案**故意拆成三个文本节点**（见 `conflictListHtml`）：
  //   ① `⇄ 对比`          → 整串命中字典
  //   ② `「Mod 名」`       → 包在 `data-i18n-skip` 里（Mod 名是动态数据，不许被片段替换啃）
  //   ③ `（3 个文件）`     → 靠字典里已有的「个文件」片段剥掉数字后翻
  // 若有谁把它们拼回「⇄ 与「X」对比（3 个文件）」一句，整串查不到、片段替换又因
  // 残留中文被拒 —— 非中文界面会整句留中文。下面三条就是拦这个的。
  ['⇄ 对比', { 'en-US': '⇄ Compare', 'ja-JP': '⇄ 比較', 'ru-RU': '⇄ Сравнить', 'zh-TW': '⇄ 對比' }],
  ['（3 个文件）', { 'en-US': '（3 files）', 'ja-JP': '（3 個のファイル）' }],
  ['（10 个文件）', { 'en-US': '（10 files）' }],

  // —— 数据目录可改位置 + 一键搬运（第三十八轮）——
  // 设置页「存储」区块与搬运向导（选目录 → 探目标 → 问旧数据怎么办 → 搬运 → 重启）。
  ['默认位置', { 'en-US': 'Default location', 'ja-JP': '既定の場所', 'zh-TW': '預設位置' }],
  ['自定义位置', { 'en-US': 'Custom location', 'zh-TW': '自訂位置' }],
  ['待重启生效', { 'en-US': 'Pending restart' }],
  ['更改位置…', { 'en-US': 'Change location…' }],
  ['恢复默认', { 'en-US': 'Restore default', 'zh-TW': '恢復預設' }],
  // ⚠️ 「约」只有**一个字**：进不了片段表（i18n.js 的 MIN_FRAGMENT = 3），
  //    只能靠 `lookup()` 的**第 ① 级整串命中**来翻。这条用例就是拦「被 MIN_FRAGMENT 挡掉」
  //    的 —— 一旦有人在 lookup 里给整串分支也加上长度门槛，英文界面就会冒出个中文「约」。
  ['约', { 'en-US': 'approx.', 'de-DE': 'ca.', 'ru-RU': 'ок.' }],
  ['目标目录里已经有数据', { 'en-US': 'The target folder already has data' }],
  ['这个目录里已经有一份数据了：', { 'en-US': 'This folder already contains a copy of the data:' }],
  ['把现有数据搬到新目录吗？', { 'en-US': 'Move the existing data to the new folder?' }],
  ['恢复到默认位置', { 'en-US': 'Restore to the default location' }],
  ['不搬，直接用那个位置的数据', { 'en-US': 'Don’t copy — just use the data in that location' }],
  ['移动（推荐，搬完删掉旧目录）', { 'en-US': 'Move (recommended — deletes the old folder)' }],
  ['复制（旧目录保留一份）', { 'en-US': 'Copy (keeps a copy in the old folder)' }],
  ['需要重启', { 'en-US': 'Restart required' }],
  ['立即重启', { 'en-US': 'Restart now' }],
  ['稍后自己重启', { 'en-US': 'I’ll restart later' }],
  ['搬运失败', { 'en-US': 'Move failed' }],
  ['正在改写路径引用…', { 'en-US': 'Updating path references…' }],
  ['目标：', { 'en-US': 'Target:' }],
  ['新位置：', { 'en-US': 'New location:' }],
  // —— 形状键：数字夹在词中间，片段替换救不了 ——
  ['这个目录里已经有 1234 个文件了', { 'en-US': 'This folder already has 1234 files' }],
  ['当前数据有 1234 个文件，要搬到新位置吗？',
    { 'en-US': 'The current data has 1234 files. Move them to the new location?' }],
  ['当前数据有 1234 个文件，要搬回默认位置吗？',
    { 'en-US': 'The current data has 1234 files. Move them back to the default location?' }],
  // 两个数字位
  ['搬运了 1234 个文件，跳过 4 个已存在的', { 'en-US': 'Moved 1234 files, skipped 4 that already existed' }],
  ['改写了 12 处路径引用', { 'en-US': 'Rewrote 12 path references' }],
  // 主进程拒绝搬运时报的错（数字在句首，且句中有 `/`）
  ['还有 3 个下载 / 安装任务在跑，先暂停或等它跑完再搬数据',
    { 'en-US': '3 download / install tasks are still running — pause them or wait until they finish before moving the data' }],
  ['还有 3 个下载 / 安装任务在跑，先处理完再改数据位置',
    { 'en-US': '3 download / install tasks are still running — finish them before changing the data location' }]
];

const CODES = ['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU', 'de-DE',
  'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL', 'tr-TR', 'th-TH'];
for (const c of CODES) loadPack(c);

const HAN = new Set(['zh-TW', 'ja-JP']);
const CJK = /[\u4e00-\u9fff\u3040-\u30ff]/;

let pass = 0, fail = 0;
const failures = [];

for (const code of CODES) {
  I18N.setLang(code);
  for (const [text, expect] of CASES) {
    const got = I18N.lookup(text);
    const exp = expect[code];

    if (exp !== undefined) {
      if (got === exp) { pass++; } else {
        fail++; failures.push(`[${code}] ${JSON.stringify(text)}\n      期望 ${JSON.stringify(exp)}\n      实得 ${JSON.stringify(got)}`);
      }
      continue;
    }
    // 无期望值 → 宽松断言：非汉字语言不该再有汉字/假名残留
    if (HAN.has(code)) { pass++; continue; }
    if (CJK.test(got)) {
      fail++; failures.push(`[${code}] ${JSON.stringify(text)}\n      译文仍含中日韩文字：${JSON.stringify(got)}`);
    } else { pass++; }
  }
}

// zh-CN 原样返回
I18N.setLang('zh-CN');
let zhOk = 0;
for (const [text] of CASES) if (I18N.lookup(text) === text) zhOk++;
const zhBad = CASES.length - zhOk;

console.log(`i18n lookup 实测：${pass} 通过 / ${fail} 失败`);
console.log(`zh-CN 原样返回：${zhOk}/${CASES.length}${zhBad ? `（${zhBad} 条被改动）` : ''}`);
if (failures.length) {
  console.log('\n—— 失败明细 ——');
  for (const f of failures) console.log('  ✗ ' + f);
}
process.exit(fail || zhBad ? 1 : 0);
