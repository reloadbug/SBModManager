'use strict';
/**
 * 第三十三轮：新增 8 条 i18n 文案（设置页「浏览与筛选」＋ 记住筛选的进度提示）。
 *
 * 做法与 `_i18n-add-30.js` 相同：键表（`_probe/i18n-keys.json`）与 13 个语言包
 * **完全同序**，先在键表里按码点排序算出插入位，再在同一个索引对应的那一行前面插。
 *
 * ⚠️ 本轮是**多条**新增，必须**从后往前插**：
 * 若新键 A 排在新键 B 前面，先插 A 时「A 的下一条」正好是还没进包的 B，
 * 锚点找不到；倒过来先插 B，A 的锚点就是刚插好的 B，一定命中。
 *
 * 用法：node _probe/_i18n-add-33.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS_FILE = path.join(ROOT, '_probe', 'i18n-keys.json');
const LOCALES = path.join(ROOT, 'src', 'renderer', 'locales');

const NEW = [
  {
    key: '浏览与筛选',
    t: {
      'en-US': 'Browse & Filters',
      'zh-TW': '瀏覽與篩選',
      'ja-JP': '閲覧とフィルター',
      'ko-KR': '탐색 및 필터',
      'de-DE': 'Durchsuchen & Filter',
      'es-ES': 'Explorar y filtros',
      'fr-FR': 'Parcourir et filtres',
      'it-IT': 'Sfoglia e filtri',
      'pl-PL': 'Przeglądanie i filtry',
      'pt-BR': 'Explorar e filtros',
      'ru-RU': 'Просмотр и фильтры',
      'th-TH': 'เรียกดูและตัวกรอง',
      'tr-TR': 'Göz atma ve filtreler'
    }
  },
  {
    key: '记住筛选条件',
    t: {
      'en-US': 'Remember filters',
      'zh-TW': '記住篩選條件',
      'ja-JP': 'フィルター条件を記憶',
      'ko-KR': '필터 조건 기억',
      'de-DE': 'Filter merken',
      'es-ES': 'Recordar filtros',
      'fr-FR': 'Mémoriser les filtres',
      'it-IT': 'Ricorda i filtri',
      'pl-PL': 'Zapamiętuj filtry',
      'pt-BR': 'Lembrar filtros',
      'ru-RU': 'Запоминать фильтры',
      'th-TH': 'จำตัวกรอง',
      'tr-TR': 'Filtreleri hatırla'
    }
  },
  {
    key: '记住（下次启动自动套用）',
    t: {
      'en-US': 'Remember (apply automatically on next launch)',
      'zh-TW': '記住（下次啟動自動套用）',
      'ja-JP': '記憶する（次回起動時に自動適用）',
      'ko-KR': '기억(다음 실행 시 자동 적용)',
      'de-DE': 'Merken (beim nächsten Start automatisch anwenden)',
      'es-ES': 'Recordar (aplicar automáticamente al iniciar)',
      'fr-FR': 'Mémoriser (appliquer automatiquement au prochain démarrage)',
      'it-IT': 'Ricorda (applica automaticamente al prossimo avvio)',
      'pl-PL': 'Zapamiętuj (stosuj automatycznie przy następnym uruchomieniu)',
      'pt-BR': 'Lembrar (aplicar automaticamente na próxima inicialização)',
      'ru-RU': 'Запоминать (применять при следующем запуске)',
      'th-TH': 'จำ (ใช้โดยอัตโนมัติเมื่อเปิดครั้งถัดไป)',
      'tr-TR': 'Hatırla (sonraki açılışta otomatik uygula)'
    }
  },
  {
    key: '不记住（每次都用默认筛选）',
    t: {
      'en-US': "Don't remember (always use default filters)",
      'zh-TW': '不記住（每次都用預設篩選）',
      'ja-JP': '記憶しない（毎回デフォルトのフィルターを使用）',
      'ko-KR': '기억 안 함(항상 기본 필터 사용)',
      'de-DE': 'Nicht merken (immer Standardfilter verwenden)',
      'es-ES': 'No recordar (usar siempre los filtros predeterminados)',
      'fr-FR': 'Ne pas mémoriser (toujours utiliser les filtres par défaut)',
      'it-IT': 'Non ricordare (usa sempre i filtri predefiniti)',
      'pl-PL': 'Nie zapamiętuj (zawsze używaj domyślnych filtrów)',
      'pt-BR': 'Não lembrar (usar sempre os filtros padrão)',
      'ru-RU': 'Не запоминать (всегда стандартные фильтры)',
      'th-TH': 'ไม่จำ (ใช้ตัวกรองเริ่มต้นทุกครั้ง)',
      'tr-TR': 'Hatırlama (her zaman varsayılan filtreleri kullan)'
    }
  },
  {
    key: '记住浏览页与「已安装」页的筛选条件（排序、成人内容、只看未安装、黑名单、只看喜欢、分类、标签、内置脚本开关），下次启动自动套用。',
    t: {
      'en-US': 'Remembers the filters on the Browse page and the "Installed" page (sort, adult content, uninstalled only, blacklist, liked only, category, tags, built-in script toggle) and applies them again on the next launch.',
      'zh-TW': '記住瀏覽頁與「已安裝」頁的篩選條件（排序、成人內容、只看未安裝、黑名單、只看喜歡、分類、標籤、內建腳本開關），下次啟動自動套用。',
      'ja-JP': '閲覧ページと「インストール済み」ページのフィルター条件（並び順、成人向けコンテンツ、未インストールのみ、ブラックリスト、いいねのみ、カテゴリ、タグ、内蔵スクリプトの表示）を記憶し、次回起動時に自動で適用します。',
      'ko-KR': '탐색 페이지와 "설치됨" 페이지의 필터 조건(정렬, 성인 콘텐츠, 미설치만, 블랙리스트, 좋아요만, 카테고리, 태그, 내장 스크립트 표시)을 기억해 다음 실행 시 자동으로 적용합니다.',
      'de-DE': 'Merkt sich die Filter auf der Seite „Durchsuchen“ und „Installiert“ (Sortierung, Erwachseneninhalte, nur nicht installierte, Blacklist, nur Favoriten, Kategorie, Tags, Anzeige der eingebauten Skripte) und wendet sie beim nächsten Start automatisch an.',
      'es-ES': 'Recuerda los filtros de las páginas «Explorar» e «Instalados» (orden, contenido para adultos, solo no instalados, lista negra, solo favoritos, categoría, etiquetas, scripts integrados) y los aplica automáticamente al iniciar.',
      'fr-FR': 'Mémorise les filtres des pages « Parcourir » et « Installés » (tri, contenu pour adultes, non installés uniquement, liste noire, favoris uniquement, catégorie, étiquettes, scripts intégrés) et les applique automatiquement au prochain démarrage.',
      'it-IT': 'Ricorda i filtri delle pagine "Sfoglia" e "Installati" (ordinamento, contenuti per adulti, solo non installati, blacklist, solo preferiti, categoria, tag, script integrati) e li applica automaticamente al prossimo avvio.',
      'pl-PL': 'Zapamiętuje filtry na stronie „Przeglądaj” i „Zainstalowane” (sortowanie, treści dla dorosłych, tylko niezainstalowane, czarna lista, tylko polubione, kategoria, tagi, skrypty wbudowane) i stosuje je automatycznie przy następnym uruchomieniu.',
      'pt-BR': 'Lembra os filtros das páginas "Explorar" e "Instalados" (ordenação, conteúdo adulto, apenas não instalados, lista de bloqueio, apenas favoritos, categoria, tags, scripts internos) e os aplica automaticamente na próxima inicialização.',
      'ru-RU': 'Запоминает фильтры на страницах «Обзор» и «Установленные» (сортировка, контент для взрослых, только неустановленные, чёрный список, только избранное, категория, теги, встроенные скрипты) и применяет их при следующем запуске.',
      'th-TH': 'จำตัวกรองในหน้าเรียกดูและหน้า "ติดตั้งแล้ว" (การเรียงลำดับ เนื้อหาผู้ใหญ่ เฉพาะที่ยังไม่ติดตั้ง บัญชีดำ เฉพาะที่ชอบ หมวดหมู่ แท็ก สวิตช์สคริปต์ในตัว) แล้วใช้โดยอัตโนมัติเมื่อเปิดครั้งถัดไป',
      'tr-TR': 'Göz atma ve "Kurulu" sayfalarındaki filtreleri (sıralama, yetişkin içerik, yalnızca kurulu olmayanlar, kara liste, yalnızca beğenilenler, kategori, etiketler, yerleşik betik anahtarı) hatırlar ve sonraki açılışta otomatik uygular.'
    }
  },
  {
    key: '搜索关键词不记 —— 那是临时查询，留着上次的词只会让人以为列表坏了。',
    t: {
      'en-US': "Search keywords are not remembered — that's a temporary query, and keeping the previous term would make the list look broken.",
      'zh-TW': '搜尋關鍵字不記 —— 那是臨時查詢，留著上次的字詞只會讓人以為列表壞了。',
      'ja-JP': '検索キーワードは記憶しません —— 一時的な検索なので、前回の語が残っているとリストが壊れたように見えるだけです。',
      'ko-KR': '검색어는 기억하지 않습니다 —— 임시 검색이므로 지난번 단어가 남아 있으면 목록이 고장 난 것처럼 보일 뿐입니다.',
      'de-DE': 'Suchbegriffe werden nicht gemerkt — das ist eine einmalige Abfrage; bleibt der alte Begriff stehen, wirkt die Liste kaputt.',
      'es-ES': 'Las palabras de búsqueda no se recuerdan — es una consulta temporal; dejar el término anterior solo haría parecer que la lista está rota.',
      'fr-FR': "Les mots-clés de recherche ne sont pas mémorisés — c'est une requête ponctuelle ; garder le terme précédent donnerait l'impression que la liste est cassée.",
      'it-IT': 'Le parole chiave di ricerca non vengono ricordate — è una query temporanea; mantenere il termine precedente farebbe sembrare l\'elenco rotto.',
      'pl-PL': 'Słowa wyszukiwania nie są zapamiętywane — to jednorazowe zapytanie; pozostawienie poprzedniego hasła sprawiłoby wrażenie, że lista jest zepsuta.',
      'pt-BR': 'Os termos de busca não são lembrados — é uma consulta temporária; manter o termo anterior só faria a lista parecer quebrada.',
      'ru-RU': 'Поисковые запросы не запоминаются — это временный запрос, и оставленное слово создаст впечатление, что список сломан.',
      'th-TH': 'ไม่จำคำค้นหา —— เป็นการค้นหาเฉพาะครั้ง การคงคำเดิมไว้จะทำให้ดูเหมือนรายการเสีย',
      'tr-TR': 'Arama sözcükleri hatırlanmaz — bu geçici bir sorgudur; önceki terimin kalması listenin bozuk olduğu izlenimi verir.'
    }
  },
  {
    key: '已开启：下次启动自动套用上次的筛选条件',
    t: {
      'en-US': 'Enabled: your filters will be applied automatically on the next launch',
      'zh-TW': '已開啟：下次啟動自動套用上次的篩選條件',
      'ja-JP': 'オン：次回起動時に前回のフィルター条件を自動適用します',
      'ko-KR': '켜짐: 다음 실행 시 지난번 필터 조건이 자동 적용됩니다',
      'de-DE': 'Aktiviert: Beim nächsten Start werden die letzten Filter automatisch angewendet',
      'es-ES': 'Activado: tus filtros se aplicarán automáticamente al iniciar',
      'fr-FR': 'Activé : vos filtres seront appliqués automatiquement au prochain démarrage',
      'it-IT': 'Attivato: i filtri verranno applicati automaticamente al prossimo avvio',
      'pl-PL': 'Włączone: przy następnym uruchomieniu filtry zostaną zastosowane automatycznie',
      'pt-BR': 'Ativado: seus filtros serão aplicados automaticamente na próxima inicialização',
      'ru-RU': 'Включено: при следующем запуске фильтры применятся автоматически',
      'th-TH': 'เปิดแล้ว: ตัวกรองจะถูกใช้โดยอัตโนมัติเมื่อเปิดครั้งถัดไป',
      'tr-TR': 'Açık: filtreler sonraki açılışta otomatik uygulanacak'
    }
  },
  {
    key: '已关闭：每次启动都用默认筛选',
    t: {
      'en-US': 'Disabled: every launch starts with the default filters',
      'zh-TW': '已關閉：每次啟動都用預設篩選',
      'ja-JP': 'オフ：起動のたびにデフォルトのフィルターになります',
      'ko-KR': '꺼짐: 실행할 때마다 기본 필터로 시작합니다',
      'de-DE': 'Deaktiviert: jeder Start verwendet die Standardfilter',
      'es-ES': 'Desactivado: cada inicio usa los filtros predeterminados',
      'fr-FR': 'Désactivé : chaque démarrage utilise les filtres par défaut',
      'it-IT': 'Disattivato: ogni avvio usa i filtri predefiniti',
      'pl-PL': 'Wyłączone: każde uruchomienie używa domyślnych filtrów',
      'pt-BR': 'Desativado: cada inicialização usa os filtros padrão',
      'ru-RU': 'Отключено: при каждом запуске используются стандартные фильтры',
      'th-TH': 'ปิดแล้ว: ทุกครั้งที่เปิดจะใช้ตัวกรองเริ่มต้น',
      'tr-TR': 'Kapalı: her açılışta varsayılan filtreler kullanılır'
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
