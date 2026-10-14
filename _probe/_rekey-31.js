'use strict';
/**
 * 第三十一轮（UI 追加）：改 2 条 i18n 文案 —— 👍/👎 从「封面右下角」挪到「卡片上」。
 *
 * 与「新增一条」不同，这里是**改键**（原文即 key）：
 *   旧：「在卡片右下角点 👍 就会收在这里。」/「…👎 就会加到这里。」
 *   新：「点卡片上的 👍 就会收在这里。」/「点卡片上的 👎 就会加到这里。」
 *
 * 改键会让它在码点排序里的位置变化，所以：先就地替换两条 → 重算排序 permutation
 * → 用**同一个 permutation** 重排 13 个语言包的数据行（保持键表与包严格同序）。
 *
 * 用法：node _probe/_rekey-31.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS_FILE = path.join(ROOT, '_probe', 'i18n-keys.json');
const LOCALES = path.join(ROOT, 'src', 'renderer', 'locales');

const OLD_A = '在卡片右下角点 👍 就会收在这里。';
const OLD_B = '在卡片右下角点 👎 就会加到这里。';
const NEW_A = '点卡片上的 👍 就会收在这里。';
const NEW_B = '点卡片上的 👎 就会加到这里。';

/** 新译文（13 个语言包）—— 都去掉了「右下角 / bottom-right / 右下」这类位置说法 */
const T = {
  'de-DE': ['Klicke auf der Karte auf 👍 — der Mod sammelt sich hier.', 'Klicke auf der Karte auf 👎 — der Mod wird hier hinzugefügt.'],
  'en-US': ['Click 👍 on a card and it will be collected here.', 'Click 👎 on a card and it will be added here.'],
  'es-ES': ['Pulsa 👍 en una tarjeta y se recopilará aquí.', 'Pulsa 👎 en una tarjeta y se añadirá aquí.'],
  'fr-FR': ['Cliquez sur 👍 sur une fiche : le mod sera rassemblé ici.', 'Cliquez sur 👎 sur une fiche : le mod sera ajouté ici.'],
  'it-IT': ['Premi 👍 su una scheda e la mod verrà raccolta qui.', 'Premi 👎 su una scheda e la mod verrà aggiunta qui.'],
  'ja-JP': ['カードの 👍 を押すとここに集まります。', 'カードの 👎 を押すとここに追加されます。'],
  'ko-KR': ['카드의 👍를 누르면 여기에 모입니다.', '카드의 👎를 누르면 여기에 추가됩니다.'],
  'pl-PL': ['Kliknij 👍 na karcie, a mod trafi tutaj.', 'Kliknij 👎 na karcie, a mod zostanie tu dodany.'],
  'pt-BR': ['Clique em 👍 no cartão e ele será reunido aqui.', 'Clique em 👎 no cartão e ele será adicionado aqui.'],
  'ru-RU': ['Нажмите 👍 на карточке — мод появится здесь.', 'Нажмите 👎 на карточке — мод попадёт сюда.'],
  'th-TH': ['คลิก 👍 บนการ์ด แล้วจะถูกเก็บไว้ที่นี่', 'คลิก 👎 บนการ์ด แล้วจะถูกเพิ่มไว้ที่นี่'],
  'tr-TR': ['Karttaki 👍 simgesine tıklayın, burada toplanır.', 'Karttaki 👎 simgesine tıklayın, buraya eklenir.'],
  'zh-TW': ['點卡片上的 👍 就會收在這裡。', '點卡片上的 👎 就會加到這裡。']
};

const jsStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const render = (arr) => '[\n' + arr.map(k => ' ' + JSON.stringify(k)).join(',\n') + '\n]\n';

// —— 0) 读键表并自检回写格式（先用未改动的副本）——
const rawKeys = fs.readFileSync(KEYS_FILE, 'utf8');
const keysBefore = JSON.parse(rawKeys);
if (render(keysBefore) !== rawKeys) throw new Error('keys.json 的回写格式与原文不一致，先对齐格式再改');

const idxA = keysBefore.indexOf(OLD_A);
const idxB = keysBefore.indexOf(OLD_B);
if (idxA < 0 || idxB < 0) throw new Error(`键表里找不到旧键（A=${idxA}, B=${idxB}）`);
if (keysBefore.includes(NEW_A) || keysBefore.includes(NEW_B)) { console.log('新键已存在，先退出（幂等）'); process.exit(0); }

// —— 1) 就地替换，再算排序 permutation ——
const keys = keysBefore.slice();
keys[idxA] = NEW_A;
keys[idxB] = NEW_B;

const pairs = keys.map((k, i) => ({ k, i }));
pairs.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
const sortedKeys = pairs.map(p => p.k);
const order = pairs.map(p => p.i);           // 新顺序 -> 旧索引

fs.writeFileSync(KEYS_FILE, render(sortedKeys), 'utf8');
console.log(`键表：就地改第 ${idxA} / ${idxB} 条，并按码点重排（共 ${sortedKeys.length} 条）`);

// —— 2) 语言包：同样的索引改 key+value，再用同一 permutation 重排 ——
const LINE_RE = /^(\s*)('(?:[^'\\]|\\.)*')[\s]*:[\s]*('(?:[^'\\]|\\.)*')(,?)\s*$/;

const files = fs.readdirSync(LOCALES).filter(f => f.endsWith('.js')).sort();
let done = 0;

for (const f of files) {
  const code = f.replace(/\.js$/, '');
  const file = path.join(LOCALES, f);
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  const dataIdx = [];
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_RE);
    if (m) { dataIdx.push(i); rows.push({ indent: m[1], key: m[2], val: m[3], comma: m[4] }); }
  }

  if (rows.length !== sortedKeys.length) {
    throw new Error(`${f}: 数据行 ${rows.length} 条，与键表 ${sortedKeys.length} 条不一致`);
  }
  // 同序自检：旧键必须正好落在 idxA / idxB 两行上
  if (rows[idxA].key !== jsStr(OLD_A) || rows[idxB].key !== jsStr(OLD_B)) {
    throw new Error(`${f}: 第 ${idxA}/${idxB} 行的键与预期不符 —— ` +
      `${rows[idxA].key.slice(0, 24)} / ${rows[idxB].key.slice(0, 24)}`);
  }
  const t = T[code];
  if (!t) throw new Error(`${f}: 没有准备新译文`);

  rows[idxA] = { ...rows[idxA], key: jsStr(NEW_A), val: jsStr(t[0]) };
  rows[idxB] = { ...rows[idxB], key: jsStr(NEW_B), val: jsStr(t[1]) };

  const reordered = order.map(i => rows[i]);
  for (let j = 0; j < dataIdx.length; j++) {
    const p = reordered[j];
    lines[dataIdx[j]] = p.indent + p.key + ': ' + p.val + p.comma;
  }
  fs.writeFileSync(file, lines.join(eol), 'utf8');
  done++;
}

console.log(`语言包：${done} 个已更新并重排`);
