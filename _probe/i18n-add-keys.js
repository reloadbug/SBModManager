/* ---------------- 给语言包补词条 ----------------
 *
 * 分两批：
 *   ① 界面语言下拉的 4 条（本轮新增功能自带）
 *   ② 首轮抽取漏掉的独立文案 —— 主要是 **Nexus 分类名**（浏览页筛选条要用）
 *      和几个没被抽到的标签。它们不在 keys.json 里，所以整串查表必然落空，
 *      补进来之后就能精确命中。
 *
 * keys.json 与 13 个语言包一起改，保证两边永远一一对应。
 * 幂等：已有的词条不会重复插入，可以反复跑。
 *
 *   node _probe/i18n-add-keys.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES = path.join(ROOT, 'src/renderer/locales');
const KEYS_FILE = path.join(__dirname, 'i18n-keys.json');

/** 13 种目标语言的顺序，写表时少打字 */
const CODES = ['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU', 'de-DE',
  'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL', 'tr-TR', 'th-TH'];

/**
 * 词条表：[中文原文, [zh-TW, en-US, ja-JP, ko-KR, ru-RU, de-DE,
 *                       fr-FR, es-ES, pt-BR, it-IT, pl-PL, tr-TR, th-TH]]
 */
const TABLE = [
  // ---------- ① 界面语言下拉 ----------
  ['界面语言', ['介面語言', 'Interface language', '表示言語', '인터페이스 언어', 'Язык интерфейса',
    'Oberflächensprache', "Langue de l'interface", 'Idioma de la interfaz',
    'Idioma da interface', "Lingua dell'interfaccia", 'Język interfejsu', 'Arayüz dili', 'ภาษาของอินเทอร์เฟซ']],
  ['显示语言', ['顯示語言', 'Display language', '表示言語', '표시 언어', 'Язык отображения',
    'Anzeigesprache', "Langue d'affichage", 'Idioma de visualización',
    'Idioma de exibição', 'Lingua di visualizzazione', 'Język wyświetlania', 'Görüntüleme dili', 'ภาษาที่แสดง']],
  ['跟随系统', ['跟隨系統', 'Follow system', 'システムに従う', '시스템 설정 따르기', 'Как в системе',
    'Systemeinstellung folgen', 'Suivre le système', 'Seguir el sistema',
    'Seguir o sistema', 'Segui il sistema', 'Zgodnie z systemem', 'Sistemi izle', 'ตามระบบ']],
  ['切换后立即生效', ['切換後立即生效', 'Takes effect immediately', '切り替えるとすぐに反映されます',
    '전환 즉시 적용됩니다', 'Применяется сразу', 'Wirkt sofort', 'Prend effet immédiatement',
    'Se aplica de inmediato', 'Aplica-se imediatamente', 'Ha effetto immediato',
    'Działa natychmiast', 'Anında etkili olur', 'มีผลทันที']],

  // ---------- ② Nexus 分类名（浏览页筛选条） ----------
  ['服装', ['服裝', 'Outfits', '衣装', '의상', 'Одежда', 'Outfits', 'Tenues', 'Atuendos',
    'Roupas', 'Abbigliamento', 'Stroje', 'Kıyafetler', 'ชุด']],
  ['玩法', ['玩法', 'Gameplay', 'ゲームプレイ', '게임플레이', 'Геймплей', 'Gameplay',
    'Gameplay', 'Jugabilidad', 'Jogabilidade', 'Gameplay', 'Rozgrywka', 'Oynanış', 'การเล่นเกม']],
  ['杂项', ['雜項', 'Miscellaneous', 'その他', '기타', 'Разное', 'Sonstiges', 'Divers',
    'Varios', 'Diversos', 'Varie', 'Różne', 'Çeşitli', 'อื่นๆ']],
  ['界面', ['介面', 'UI', 'UI', 'UI', 'Интерфейс', 'UI', 'Interface', 'Interfaz',
    'Interface', 'Interfaccia', 'Interfejs', 'Arayüz', 'UI']],
  ['视觉', ['視覺', 'Visuals', 'ビジュアル', '비주얼', 'Визуал', 'Visuell', 'Visuel',
    'Visual', 'Visual', 'Visuale', 'Wizualne', 'Görsel', 'ภาพ']],
  ['性感化', ['性感化', 'Sexualized', 'セクシー', '성적 표현', 'Сексуализация', 'Sexualisiert',
    'Sexualisé', 'Sexualizado', 'Sexualizado', 'Sessualizzato', 'Seksualizacja',
    'Cinselleştirme', 'ทางเพศ']],
  ['角色预设', ['角色預設', 'Character Presets', 'キャラプリセット', '캐릭터 프리셋',
    'Пресеты персонажей', 'Charakter-Presets', 'Préréglages de personnage',
    'Presets de personaje', 'Presets de personagem', 'Preset personaggio',
    'Presety postaci', 'Karakter ön ayarları', 'พรีเซ็ตตัวละคร']],
  ['色情', ['色情', 'Adult', '成人向け', '성인', 'Порно', 'Pornografie', 'Pornographique',
    'Pornografía', 'Pornografia', 'Pornografico', 'Pornografia', 'Pornografik', 'สื่อลามก']],
  ['模型网格', ['模型網格', 'Model Meshes', 'モデルメッシュ', '모델 메시', 'Модели', 'Modelle',
    'Modèles 3D', 'Mallas de modelo', 'Malhas de modelo', 'Mesh modello',
    'Siatki modeli', 'Model ağları', 'โมเดล']],
  ['替换', ['替換', 'Replacers', '置き換え', '교체', 'Замена', 'Ersetzungen',
    'Remplacements', 'Reemplazos', 'Substituições', 'Sostituzioni', 'Zamienniki',
    'Değiştirmeler', 'แทนที่']],
  ['材质', ['材質', 'Textures', 'テクスチャ', '텍스처', 'Текстуры', 'Texturen', 'Textures',
    'Texturas', 'Texturas', 'Texture', 'Tekstury', 'Dokular', 'พื้นผิว']],
  ['体验优化', ['體驗最佳化', 'Quality of Life', '快適性向上', '편의성', 'Удобство', 'Komfort',
    'Confort de jeu', 'Calidad de vida', 'Qualidade de vida', 'Qualità della vita',
    'Udogodnienia', 'Kullanım kolaylığı', 'คุณภาพชีวิต']],
  ['英文', ['英文', 'English', '英語', '영어', 'Английский', 'Englisch', 'Anglais',
    'Inglés', 'Inglês', 'Inglese', 'Angielski', 'İngilizce', 'อังกฤษ']],
  ['玩家工具', ['玩家工具', 'Player Tools', 'プレイヤーツール', '플레이어 도구',
    'Инструменты игрока', 'Spieler-Tools', 'Outils de joueur', 'Herramientas de jugador',
    'Ferramentas de jogador', 'Strumenti giocatore', 'Narzędzia gracza',
    'Oyuncu araçları', 'เครื่องมือผู้เล่น']],

  // ---------- ③ 首轮没抽到的独立标签 ----------
  ['个人 API Key', ['個人 API Key', 'Personal API Key', '個人用 API Key', '개인 API Key',
    'Персональный API Key', 'Persönlicher API Key', 'Clé API personnelle', 'API Key personal',
    'API Key pessoal', 'API Key personale', 'Osobisty API Key', 'Kişisel API Key',
    'API Key ส่วนตัว']],
  ['（可选）', ['（選填）', '(optional)', '（任意）', '(선택)', '(необязательно)', '(optional)',
    '(facultatif)', '(opcional)', '(opcional)', '(facoltativo)', '(opcjonalne)',
    '(isteğe bağlı)', '(ไม่บังคับ)']],
  ['可留空', ['可留空', 'Can be left empty', '空欄可', '비워 둬도 됩니다',
    'Можно оставить пустым', 'Kann leer bleiben', 'Peut rester vide',
    'Puede dejarse vacío', 'Pode ficar em branco', 'Può restare vuoto',
    'Można zostawić puste', 'Boş bırakılabilir', 'เว้นว่างได้']],
  ['已就绪', ['已就緒', 'Ready', '準備完了', '준비됨', 'Готово', 'Bereit', 'Prêt', 'Listo',
    'Pronto', 'Pronto', 'Gotowe', 'Hazır', 'พร้อม']],
  ['待处理', ['待處理', 'Pending', '保留中', '대기 중', 'В ожидании', 'Ausstehend',
    'En attente', 'Pendiente', 'Pendente', 'In attesa', 'Oczekujące', 'Beklemede',
    'รอดำเนินการ']],
  ['不喜欢', ['不喜歡', 'Not interested', '興味なし', '관심 없음', 'Не интересно',
    'Nicht interessiert', 'Pas intéressé', 'No me interesa', 'Não me interessa',
    'Non mi interessa', 'Nie interesuje mnie', 'İlgilenmiyorum', 'ไม่สนใจ']],
  ['成人内容', ['成人內容', 'Adult content', '成人向けコンテンツ', '성인 콘텐츠',
    'Контент для взрослых', 'Inhalte für Erwachsene', 'Contenu adulte',
    'Contenido adulto', 'Conteúdo adulto', 'Contenuti per adulti',
    'Treści dla dorosłych', 'Yetişkin içeriği', 'เนื้อหาผู้ใหญ่']],
  ['点击禁用', ['點擊停用', 'Click to disable', 'クリックで無効化', '클릭하여 비활성화',
    'Нажмите, чтобы отключить', 'Zum Deaktivieren klicken', 'Cliquer pour désactiver',
    'Clic para desactivar', 'Clique para desativar', 'Clicca per disattivare',
    'Kliknij, aby wyłączyć', 'Devre dışı bırakmak için tıkla', 'คลิกเพื่อปิดใช้งาน']],
  ['查看封面与预览图', ['檢視封面與預覽圖', 'View cover and previews', 'カバーとプレビューを表示',
    '커버 및 미리보기 보기', 'Открыть обложку и превью', 'Cover und Vorschaubilder ansehen',
    'Voir la couverture et les aperçus', 'Ver portada y vistas previas', 'Ver capa e prévias',
    'Vedi copertina e anteprime', 'Zobacz okładkę i podglądy', 'Kapak ve önizlemeleri gör',
    'ดูปกและภาพตัวอย่าง']],
  ['重新识别', ['重新辨識', 'Re-analyze', '再解析', '다시 분석', 'Переанализировать',
    'Neu analysieren', 'Réanalyser', 'Reanalizar', 'Reanalisar', 'Rianalizza',
    'Analizuj ponownie', 'Yeniden analiz et', 'วิเคราะห์ใหม่']],

  // ---------- ④ 带计数尾缀的按钮 / 兜底文案 ----------
  // 源码里是 `↻ 全部恢复（${n}）`、`⬇ 点击启用` 这种，抽取器只拿到带括号的残片，
  // 靠「剥掉尾部（数字）」才能整串命中，所以词条要按**纯文字**补。
  ['全部恢复', ['全部恢復', 'Resume all', 'すべて再開', '모두 재개', 'Возобновить все',
    'Alle fortsetzen', 'Tout reprendre', 'Reanudar todo', 'Retomar tudo',
    'Riprendi tutto', 'Wznów wszystko', 'Tümünü sürdür', 'ดำเนินการต่อทั้งหมด']],
  ['全部自动授权', ['全部自動授權', 'Authorize all', 'すべて自動承認', '모두 자동 승인',
    'Авторизовать все', 'Alle autorisieren', 'Tout autoriser', 'Autorizar todo',
    'Autorizar tudo', 'Autorizza tutto', 'Autoryzuj wszystko', 'Tümünü yetkilendir',
    'อนุญาตทั้งหมด']],
  ['清理已完成记录', ['清理已完成記錄', 'Clear finished', '完了済みを消去', '완료 기록 정리',
    'Очистить завершённые', 'Erledigte entfernen', 'Effacer les terminés',
    'Limpiar completados', 'Limpar concluídos', 'Pulisci completati',
    'Wyczyść ukończone', 'Tamamlananları temizle', 'ล้างรายการที่เสร็จ']],
  ['无封面图', ['無封面圖', 'No cover image', 'カバー画像なし', '커버 이미지 없음',
    'Нет обложки', 'Kein Cover', 'Pas de couverture', 'Sin portada', 'Sem capa',
    'Nessuna copertina', 'Brak okładki', 'Kapak yok', 'ไม่มีภาพปก']],
  ['点击启用', ['點擊啟用', 'Click to enable', 'クリックで有効化', '클릭하여 활성화',
    'Нажмите, чтобы включить', 'Zum Aktivieren klicken', 'Cliquer pour activer',
    'Clic para activar', 'Clique para ativar', 'Clicca per attivare',
    'Kliknij, aby włączyć', 'Etkinleştirmek için tıkla', 'คลิกเพื่อเปิดใช้งาน']]
];

/**
 * 「只有键、没有预置译文」的补充词条。
 *
 * 这批文案来自**主进程**（`src/main/*.js`）—— 抽取器只扫 `src/renderer/app.js`
 * 与 `index.html`，所以主进程拼出来、再经 IPC 送到界面上的文案一条都抓不到。
 * 它们不像 TABLE 那样需要在这里写死 13 种译文（译文走 `_trans/` + `_sync-packs.js`
 * 那条正常流程），所以单独放一个数组，只声明「这些键必须留在 keys.json 里」。
 *
 * `%s` = **数字占位符**（见 `src/renderer/i18n.js` 的「数字模板」一节）：
 * 模板串里 `${n}` 与周围文字在 DOM 里属于**同一个文本节点**，
 * 但 `n` 是运行时数据、没法当 key 的字面量，所以用 `%s` 通配数字串，
 * 命中后把实际数字原样回填进译文。
 */
const EXTRA = [
  // ── 安装落点说明（installer.js / game.js）──
  'CNS 主体 pak',
  'CNS 脚本入口',
  '服装 / 外观数据',
  '~Mods（Pak 模组目录）',
  '游戏根目录',
  '包含 SB\\ 目录，按游戏根目录结构原样落盘',
  '包含 ~Mods\\ 目录',
  '全部是 .pak / .ucas / .utoc，直接放进 ~Mods',
  'CNS 服装数据（pak + .dekcns / .dekani）全部原样放进 ~Mods',
  'CNS 外观数据文件（.dekcns / .dekani），放进 ~Mods',
  '压缩包不完整（下载被中断，或文件被截断）—— 请重新下载这个文件',
  // ── 队列 / 授权报错（ipc.js / downloadQueue.js）──
  '这条任务缺少 Mod ID / 文件 ID，无法自动授权（可点「手动」）。',
  '管理器上次退出时任务未完成；请重新授权或重试。',
  // ── 句中夹数字的模板串（形状键）──
  '显示 UE4SS 自带的 %s 个内置脚本模组',
  '隐藏 UE4SS 自带的 %s 个内置脚本模组',
  '个 Mod · 已加载 %s 个 · 已隐藏黑名单（共 %s 个）',
  '加载更多（还有 %s 个）',
  '· 保留最近 %s 天',
  '共 %s 项 · %s 个已启用',
  '包里有 %s 套内容，需要你选要装哪些（互不相关的可以一起装）',
  '这个包里按目录分了 %s 套内容，需要你选要装哪些。',
  '读取压缩包失败（退出码 %s）：压缩包不完整（下载被中断，或文件被截断）—— 请重新下载这个文件',
  // 界面把超过 40 字的落点说明截成 38 字 + `…`（app.js 的 `whyText`），
  // 截断后的形态也自成一条 —— 不补的话下载列表里这条永远是中文。
  'CNS 服装数据（pak + .dekcns / .dekani）全部原样放…'
];

/** 展平成 { key, t: {code: …} } 的结构 */
const NEW = TABLE.map(([key, vals]) => {
  if (vals.length !== CODES.length) {
    throw new Error(`词条「${key}」有 ${vals.length} 个译文，但语言有 ${CODES.length} 种`);
  }
  const t = {};
  CODES.forEach((c, i) => { t[c] = vals[i]; });
  return { key, t };
});

/** JS 单引号字符串转义 */
function jsq(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function apply() {
/* ---------- 1) keys.json ---------- */
const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
let added = 0;
for (const n of NEW) {
  if (!keys.includes(n.key)) { keys.push(n.key); added++; }
}
fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 1) + '\n', 'utf8');
console.log(`keys.json: 新增 ${added} 条，现共 ${keys.length} 条`);

/* ---------- 2) 各语言包 ---------- */
/*
 * 结尾长这样：`…最后一条',\n  });\n})();\n`
 * ⚠️ 末尾那个逗号**可能是已有的**（脚本上一轮补过，或者生成语言包时就带），
 *    所以正则要把它一起吃掉再统一补一个 —— 否则第二次插入会写出 `,,`，
 *    整个语言包直接 SyntaxError。踩过一次。
 */
const TAIL = /,?\s*\n  \}\);\n\}\)\(\);\s*$/;

let total = 0;
for (const code of CODES) {
  const file = path.join(LOCALES, code + '.js');
  if (!fs.existsSync(file)) { console.log(`  跳过 ${code}（文件不存在）`); continue; }

  let src = fs.readFileSync(file, 'utf8');
  const need = NEW.filter(n => !src.includes(`'${jsq(n.key)}':`));
  if (!need.length) { console.log(`  ${code}: 已是最新`); continue; }

  if (!TAIL.test(src)) { console.log(`  ✗ ${code}: 结尾格式不匹配，未改动`); continue; }

  const lines = need.map(n => `    '${jsq(n.key)}': '${jsq(n.t[code])}',`).join('\n');
  // 上一行末尾补逗号 + 追加新行
  src = src.replace(TAIL, `,\n${lines}\n  });\n})();\n`);
  fs.writeFileSync(file, src, 'utf8');
  total += need.length;
  console.log(`  ${code}: 补了 ${need.length} 条`);
}

console.log(`\n语言包合计补入 ${total} 条。跑一次 node _probe/i18n-check-pack.js --all 验证。`);
}

/*
 * 这张 TABLE 是**手工维护的补充词条**，不在 app.js 源码里，抽取器扫不到
 * （Nexus 分类名来自运行时数据、语言下拉是功能自带的文案……）。
 * 所以导出出去，`_rebuild-keys.js` 重建 keys.json 时要把它并进去 ——
 * 否则每次重跑抽取都会把这些词条"洗掉"。
 */
module.exports = { TABLE, CODES, NEW, EXTRA };

if (require.main === module) apply();
