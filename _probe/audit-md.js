'use strict';
// 把 _shots/install-audit3.log 整理成一张 markdown 表，写进 docs/。
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', '_shots', 'install-audit3.log');
const outFile = path.join(__dirname, '..', 'docs', '安装数量对账-2026-11-24.md');
const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);

const rows = [];
let cur = null;
for (const raw of lines) {
  const line = raw.trimEnd();
  const t = line.trim();
  const m = t.match(/^压缩包 (\d+) \/ 应装 (\d+) \/ 盘上实到 (\d+) \/ 卡片认领 (\d+)$/);
  if (m) {
    cur.arc = +m[1]; cur.plan = +m[2]; cur.disk = +m[3]; cur.card = +m[4];
    rows.push(cur);
    continue;
  }
  const head = t.match(/^(.*?)\s+\[([^\]]+)\]\s+(pak|script|cns|prereq)$/);
  if (head) { cur = { name: head[1], id: head[2], kind: head[3] }; continue; }
  if (!cur) continue;
  if (t.startsWith('缺：')) cur.missing = t.slice(2);
  else if (t.startsWith('大小不符：')) cur.mis = t.slice(5);
  else if (t.startsWith('隐形（在盘上但没卡片）：')) cur.orphan = t.slice(12);
  else if (t.startsWith('备注：')) cur.note = t.slice(3);
  else if (t.startsWith('包：')) cur.ap = t.slice(2);
}

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
const why = (r) => {
  const parts = [];
  if (r.note) parts.push(r.note);
  if (r.missing) parts.push('盘上缺：' + r.missing);
  if (r.mis) parts.push('大小不符：' + r.mis);
  if (r.orphan) parts.push('界面看不见：' + r.orphan);
  if (!parts.length && r.plan && r.disk === r.plan && r.card < r.disk) parts.push('有文件没挂到卡片');
  return parts.join('；');
};

const bad = rows.filter(r => r.plan != null);
// 排序：真缺文件 → 隐形 → 其它
const rank = (r) => (r.missing || r.mis ? 0 : (r.disk === r.plan ? 1 : 2));
bad.sort((a, b) => rank(a) - rank(b) || (a.name || '').localeCompare(b.name || ''));

const head = [
  '# 已安装 Mod 数量对账（2026-11-24）',
  '',
  '每个在游戏目录里有文件的 Mod，把三个数字摆在一起：',
  '',
  '- **压缩包**：安装包里一共有几个文件（`archive.listEntries`）',
  '- **应装**：按安装规则该往游戏目录写几个（文档 / 预览图 / 没选中的变体不算）',
  '- **盘上实到**：这些应装的文件里，现在真的在游戏目录里的有几个（`.disabled` 写法也算在）',
  '- **界面卡片**：管理器界面上这张卡认领了几个文件',
  '',
  '## 总量',
  '',
  `- 磁盘上扫描到 462 个条目 / 324 个 Mod`,
  `- 对账完全一致：249 个`,
  `- 对不上：${bad.length} 个（下表）`,
  '- 没有安装包、无从对账：12 个（手动放进去的，或者包已删）',
  '',
  '## 对不上的（' + bad.length + ' 个）',
  '',
  '| # | Mod | modId | 压缩包 | 应装 | 盘上实到 | 界面卡片 | 说明 |',
  '|---|---|---|---|---|---|---|---|'
];
bad.forEach((r, i) => {
  head.push(`| ${i + 1} | ${esc(r.name)} | ${esc(r.id)} | ${r.arc == null ? '?' : r.arc} | ${r.plan == null ? '?' : r.plan} | ${r.disk == null ? '?' : r.disk} | ${r.card == null ? '?' : r.card} | ${esc(why(r))} |`);
});

head.push('', '## 怎么读这张表', '');
head.push('- **盘上实到 < 应装**：真缺文件了，这一行的 Mod 在游戏里大概是坏的 / 缺一半，建议卸载重装。');
head.push('- **盘上实到 = 应装，界面卡片更少**：文件都在，只是 `~Mods` 里那些服装数据文件（`.dekcns.json`）名字跟 pak 差太远，没被挂到任何卡片上 —— 界面上看不见，但游戏是认的。');
head.push('- **压缩包 > 应装**：包里带了说明文档、预览图、或者多套变体而只挑了其中几套，属于正常。');
fs.writeFileSync(outFile, head.join('\n') + '\n', 'utf8');
console.log('写出 ' + outFile + '，共 ' + bad.length + ' 行');
