#!/usr/bin/env node
'use strict';
/**
 * 多选模式 Shift / Ctrl 批量选中 —— 端到端自检（用户 2026-11-10 要求
 * 「多选开启时，支持 shift 和 ctrl 批量选中」）。
 *
 * 做法：起真实 Electron 应用（--shot 骨架），把 _probe/multiselect-eval.js 注入渲染进程，
 * 在**真 DOM + 真 state** 上造卡片、调真函数，读真结果。断言全在注入脚本里，
 * 这里只负责起进程、抠 SHOT_EVAL 那行 JSON、汇总。
 *
 * 运行：npm run test:multiselect
 * 注意：不能带 ELECTRON_RUN_AS_NODE（那是跑纯 node 探针的模式，会把 electron 变成 node）。
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const EVAL = path.join(__dirname, 'multiselect-eval.js');
const SHOT = path.join(ROOT, '_shots', 'multiselect.png');

if (!fs.existsSync(ELECTRON)) {
  console.error('[FAIL] 找不到 ' + ELECTRON);
  process.exit(1);
}
fs.mkdirSync(path.dirname(SHOT), { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = [
  '.',
  '--shot=' + SHOT,
  '--shot-page=p-browse',
  '--shot-eval-file=' + EVAL,
  '--shot-delay=12000',
];

const r = spawnSync(ELECTRON, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
const outText = (r.stdout || '') + (r.stderr || '');

const line = outText.split(/\r?\n/).find(l => l.startsWith('SHOT_EVAL '));
if (!line) {
  console.error('[FAIL] 没拿到 SHOT_EVAL 结果');
  console.error(outText.split(/\r?\n/).filter(Boolean).slice(-25).join('\n'));
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(line.slice('SHOT_EVAL '.length));
} catch (e) {
  console.error('[FAIL] SHOT_EVAL 不是合法 JSON：' + e.message);
  console.error(line.slice(0, 500));
  process.exit(1);
}

let pass = 0;
let fail = 0;
for (const c of payload.checks || []) {
  if (c.ok) { pass++; console.log('  ✓ ' + c.name); }
  else {
    fail++;
    console.log('  ✗ ' + c.name + '  → 实际 ' + JSON.stringify(c.got) + '，期望 ' + JSON.stringify(c.want));
  }
}

console.log('\n截图：' + SHOT);
console.log(fail ? `\n结果：${pass} 通过 / ${fail} 失败` : `\n结果：全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
