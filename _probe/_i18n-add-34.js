'use strict';
/**
 * 第三十四轮：新增 3 条 i18n 文案（已安装页的排序方向按钮）。
 *
 * 本轮新增：
 *   · 「正序」/「倒序」—— 方向按钮上的两个字（渲染在 `<span>` 里，独立文本节点）
 *   · 方向按钮的 title —— 「切换正序 / 倒序（也可以再点一次排序名）」
 *
 * 做法与 `_i18n-add-33.js` 相同：键表（`_probe/i18n-keys.json`）与 13 个语言包
 * **完全同序**，先在键表里按码点排序算出插入位，再在同一个索引对应的那一行前面插。
 * 多条新增必须**从后往前插**（靠后的新键先落位，前面那条的锚点才一定存在）。
 *
 * 用法：node _probe/_i18n-add-34.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS_FILE = path.join(ROOT, '_probe', 'i18n-keys.json');
const LOCALES = path.join(ROOT, 'src', 'renderer', 'locales');

const NEW = [
  {
    key: '正序',
    t: {
      'en-US': 'Ascending',
      'zh-TW': '正序',
      'ja-JP': '昇順',
      'ko-KR': '오름차순',
      'de-DE': 'Aufsteigend',
      'es-ES': 'Ascendente',
      'fr-FR': 'Croissant',
      'it-IT': 'Crescente',
      'pl-PL': 'Rosnąco',
      'pt-BR': 'Crescente',
      'ru-RU': 'По возрастанию',
      'th-TH': 'น้อยไปมาก',
      'tr-TR': 'Artan'
    }
  },
  {
    key: '倒序',
    t: {
      'en-US': 'Descending',
      'zh-TW': '倒序',
      'ja-JP': '降順',
      'ko-KR': '내림차순',
      'de-DE': 'Absteigend',
      'es-ES': 'Descendente',
      'fr-FR': 'Décroissant',
      'it-IT': 'Decrescente',
      'pl-PL': 'Malejąco',
      'pt-BR': 'Decrescente',
      'ru-RU': 'По убыванию',
      'th-TH': 'มากไปน้อย',
      'tr-TR': 'Azalan'
    }
  },
  {
    key: '切换正序 / 倒序（也可以再点一次排序名）',
    t: {
      'en-US': 'Toggle ascending / descending (or click the sort name again)',
      'zh-TW': '切換正序 / 倒序（也可以再點一次排序名）',
      'ja-JP': '昇順 / 降順を切り替え（並び順の名前をもう一度クリックしても可）',
      'ko-KR': '오름차순 / 내림차순 전환(정렬 이름을 다시 클릭해도 됩니다)',
      'de-DE': 'Auf-/absteigend umschalten (oder den Sortiernamen erneut anklicken)',
      'es-ES': 'Alternar ascendente / descendente (o vuelve a pulsar el nombre del orden)',
      'fr-FR': 'Basculer croissant / décroissant (ou recliquer sur le nom du tri)',
      'it-IT': "Alterna crescente / decrescente (oppure clicca di nuovo sul nome dell'ordinamento)",
      'pl-PL': 'Przełącz rosnąco / malejąco (możesz też kliknąć ponownie nazwę sortowania)',
      'pt-BR': 'Alternar crescente / decrescente (ou clique novamente no nome da ordenação)',
      'ru-RU': 'Переключить по возрастанию / убыванию (или нажмите название сортировки ещё раз)',
      'th-TH': 'สลับน้อยไปมาก / มากไปน้อย (หรือคลิกชื่อการเรียงลำดับอีกครั้ง)',
      'tr-TR': 'Artan / azalan arasında geçiş yap (sıralama adına yeniden tıklayabilirsiniz)'
    }
  }
];

/** JS 单引号字面量（与现有语言包同风格：内部单引号转义） */
const jsStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

let keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
const files = fs.readdirSync(LOCALES).filter(f => f.endsWith('.js')).sort();

// ⚠️ 从后往前插：靠后的新键先落位，前面那条新键的锚点才一定存在
const ordered = NEW.slice().sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

for (const item of ordered) {
  const k = item.key;
  if (keys.includes(k)) { console.log(`· 键表里已有「${k.slice(0, 10)}…」，跳过`); continue; }

  const sorted = keys.concat(k).sort();
  const idx = sorted.indexOf(k);
  const nextKey = sorted[idx + 1];   // 排在这一位、要往下挪一条的那个键（undefined = 新键排到最后）

  // 键表：插到 idx 位
  keys = keys.slice(0, idx).concat([k], keys.slice(idx));

  let done = 0;
  for (const f of files) {
    const code = f.replace(/\.js$/, '');
    const tr = item.t[code];
    if (!tr) { console.log(`  ⚠ 缺 ${code} 的译文`); continue; }
    const fp = path.join(LOCALES, f);
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    let anchor;
    if (nextKey === undefined) {
      anchor = lines.map((l, i) => (/^\s*\}\);\s*$/.test(l) ? i : -1)).filter(i => i >= 0).pop();
    } else {
      anchor = lines.findIndex(l => l.trimStart().startsWith(jsStr(nextKey) + ':'));
    }
    if (anchor === undefined || anchor < 0) { console.log(`  ⚠ ${f} 里找不到锚点`); continue; }
    lines.splice(anchor, 0, '    ' + jsStr(k) + ': ' + jsStr(tr) + ',');
    fs.writeFileSync(fp, lines.join('\n'), 'utf8');
    done++;
  }
  console.log(`+ 「${k.slice(0, 16)}…」插在键表第 ${idx} 位（其后是「${(nextKey || 'EOF').slice(0, 12)}…」），语言包 ${done}/${files.length}`);
}

fs.writeFileSync(KEYS_FILE, '[\n' + keys.map(x => ' ' + JSON.stringify(x)).join(',\n') + '\n]\n', 'utf8');
console.log(`\n键表共 ${keys.length} 条`);

// —— 自检：13 个语言包的键顺序必须与键表逐位一致 ——
let bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(path.join(LOCALES, f), 'utf8').split('\n');
  const got = [];
  for (const l of lines) {
    const m = /^\s*'((?:[^'\\]|\\.)*)':\s/.exec(l);
    if (m) got.push(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  if (got.length !== keys.length) { console.log(`  ✗ ${f}: ${got.length} 条 ≠ 键表 ${keys.length} 条`); bad++; continue; }
  const firstBad = got.findIndex((x, i) => x !== keys[i]);
  if (firstBad >= 0) { console.log(`  ✗ ${f}: 第 ${firstBad} 位错位（包「${got[firstBad].slice(0, 12)}」≠ 表「${keys[firstBad].slice(0, 12)}」）`); bad++; continue; }
  console.log(`  ✓ ${f}`);
}
console.log(bad ? `\n❌ ${bad} 个语言包不同序` : '\n✅ 13 个语言包与键表完全同序');
process.exit(bad ? 1 : 0);
