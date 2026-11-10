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
    'Kliknij, aby włączyć', 'Etkinleştirmek için tıkla', 'คลิกเพื่อเปิดใช้งาน']],

  // ---------- ⑬ 批量解析（本地 Mod ↔ Nexus 关联） ----------
  ['批量解析', ['批次解析', 'Bulk match', '一括照合', '일괄 매칭', 'Массовое сопоставление',
    'Massenabgleich', 'Correspondance en masse', 'Emparejamiento masivo',
    'Correspondência em massa', 'Corrispondenza in blocco', 'Dopasowanie zbiorcze',
    'Toplu eşleştirme', 'จับคู่ทั้งชุด']],
  ['把手动放进 Mods 目录的 Mod 与 Nexus 上的条目对上号，自动补上名字、作者、版本和封面',
    ['把手動放進 Mods 目錄的 Mod 與 Nexus 上的項目對上號，自動補上名稱、作者、版本和封面',
      'Match mods you placed in the Mods folder by hand to Nexus entries, and fill in name, author, version and cover automatically',
      '手動で Mods フォルダに入れた Mod を Nexus の項目と照合し、名前・作者・バージョン・カバー画像を自動で補います',
      '직접 Mods 폴더에 넣은 모드를 Nexus 항목과 대조해 이름, 제작자, 버전, 커버를 자동으로 채웁니다',
      'Сопоставляет моды, вручную положенные в папку Mods, с записями на Nexus и заполняет имя, автора, версию и обложку',
      'Gleicht manuell in den Mods-Ordner gelegte Mods mit Nexus-Einträgen ab und ergänzt Name, Autor, Version und Cover',
      'Associe les mods placés à la main dans le dossier Mods aux entrées Nexus et complète nom, auteur, version et couverture',
      'Empareja los mods colocados a mano en la carpeta Mods con las entradas de Nexus y rellena nombre, autor, versión y carátula',
      'Associa mods colocados à mão na pasta Mods às entradas do Nexus e preenche nome, autor, versão e capa',
      'Abbina i mod inseriti a mano nella cartella Mods alle voci di Nexus e compila nome, autore, versione e copertina',
      'Dopasowuje mody wrzucone ręcznie do folderu Mods do wpisów na Nexusie i uzupełnia nazwę, autora, wersję i okładkę',
      'Elle Mods klasörüne atılan modları Nexus kayıtlarıyla eşleştirir; ad, yapımcı, sürüm ve kapak bilgisini doldurur',
      'จับคู่มอดที่วางในโฟลเดอร์ Mods ด้วยมือกับรายการบน Nexus และเติมชื่อ ผู้สร้าง เวอร์ชัน และภาพปกให้อัตโนมัติ']],
  ['已关联', ['已關聯', 'Linked', '照合済み', '연결됨', 'Связано', 'Verknüpft', 'Associé',
    'Vinculado', 'Vinculado', 'Collegato', 'Powiązane', 'Bağlandı', 'เชื่อมโยงแล้ว']],
  ['批量解析对上的 Nexus Mod：文件是自己放的，来源信息来自 Nexus',
    ['批次解析對上的 Nexus Mod：檔案是自己放的，來源資訊來自 Nexus',
      'Matched by bulk matching: you placed the files yourself, source info comes from Nexus',
      '一括照合で特定した Nexus Mod：ファイルは手動配置で、出典情報は Nexus 由来です',
      '일괄 매칭으로 찾은 Nexus 모드: 파일은 직접 넣은 것이고 출처 정보는 Nexus에서 가져왔습니다',
      'Сопоставлено массовой сверкой: файлы вы положили сами, сведения об источнике взяты с Nexus',
      'Durch Massenabgleich zugeordnet: Die Dateien hast du selbst abgelegt, die Quellenangaben stammen von Nexus',
      "Trouvé par correspondance en masse : les fichiers ont été placés par vous, les infos de source viennent de Nexus",
      'Emparejado por búsqueda masiva: los archivos los colocaste tú, la información de origen viene de Nexus',
      'Encontrado por correspondência em massa: os arquivos foram colocados por você, as informações de origem vêm do Nexus',
      'Trovato dalla corrispondenza in blocco: i file li hai inseriti tu, le informazioni sulla fonte vengono da Nexus',
      'Dopasowane zbiorczo: pliki wgrałeś samodzielnie, informacje o źródle pochodzą z Nexusa',
      "Toplu eşleştirmeyle bulundu: dosyaları kendin yerleştirdin, kaynak bilgisi Nexus'tan geliyor",
      'จับคู่โดยการจับคู่ทั้งชุด: คุณวางไฟล์เอง ข้อมูลแหล่งที่มาจาก Nexus']],
  ['上面这个来源是「批量解析」按名字比对出来的，文件本身不是通过管理器安装的 —— 如果对错了，点下面的「解除关联」即可。',
    ['上面這個來源是「批次解析」按名稱比對出來的，檔案本身不是透過管理器安裝的 —— 如果對錯了，點下面的「解除關聯」即可。',
      'This source was inferred by bulk matching on names; the files were not installed by the manager — if it is wrong, click “Unlink” below.',
      'この出典は「一括照合」が名前から推定したもので、ファイル自体はマネージャー経由でインストールされたものではありません —— 誤っている場合は下の「関連解除」を押してください。',
      "이 출처는 '일괄 매칭'이 이름을 비교해 추정한 것이며, 파일 자체는 관리자를 통해 설치된 것이 아닙니다 — 잘못되었다면 아래 '연결 해제'를 누르세요.",
      'Этот источник определён массовой сверкой по названиям; сами файлы установлены не менеджером — если это ошибка, нажмите «Отвязать» ниже.',
      'Diese Quelle wurde durch Massenabgleich über Namen ermittelt; die Dateien wurden nicht über den Manager installiert — falls falsch, klicke unten auf „Verknüpfung lösen“.',
      "Cette source a été déduite par correspondance sur les noms ; les fichiers n'ont pas été installés par le gestionnaire — si c'est faux, cliquez sur « Dissocier » ci-dessous.",
      'Esta fuente se dedujo por emparejamiento de nombres; los archivos no se instalaron con el gestor — si es incorrecto, pulsa «Desvincular» abajo.',
      'Esta origem foi deduzida por correspondência de nomes; os arquivos não foram instalados pelo gerenciador — se estiver errado, clique em “Desvincular” abaixo.',
      'Questa fonte è stata dedotta dal confronto dei nomi; i file non sono stati installati dal gestore — se è sbagliato, premi «Scollega» qui sotto.',
      'To źródło wywnioskowano przez dopasowanie nazw; pliki nie zostały zainstalowane przez menedżer — jeśli to błąd, kliknij „Odepnij“ poniżej.',
      'Bu kaynak ad karşılaştırmasıyla tahmin edildi; dosyalar yönetici üzerinden kurulmadı — yanlışsa aşağıdaki “Bağlantıyı kaldır”a bas.',
      'แหล่งที่มานี้คาดเดาจากการเทียบชื่อ ไฟล์ไม่ได้ติดตั้งผ่านตัวจัดการ — หากผิดให้กด “ยกเลิกการเชื่อมโยง” ด้านล่าง']],
  ['未登记 · 已关联 Nexus 来源',
    ['未登記 · 已關聯 Nexus 來源', 'Unregistered · linked to Nexus', '未登録 · Nexus 由来と照合済み',
      '미등록 · Nexus 출처 연결됨', 'Не зарегистрировано · связано с Nexus',
      'Nicht registriert · mit Nexus verknüpft', 'Non enregistré · associé à Nexus',
      'Sin registrar · vinculado a Nexus', 'Não registrado · vinculado ao Nexus',
      'Non registrato · collegato a Nexus', 'Niezarejestrowany · powiązany z Nexusem',
      'Kayıtlı değil · Nexus ile eşleşti', 'ยังไม่ลงทะเบียน · เชื่อมโยงกับ Nexus แล้ว']],
  ['解除关联', ['解除關聯', 'Unlink', '関連解除', '연결 해제', 'Отвязать',
    'Verknüpfung lösen', 'Dissocier', 'Desvincular', 'Desvincular', 'Scollega',
    'Odepnij', 'Bağlantıyı kaldır', 'ยกเลิกการเชื่อมโยง']],
  ['只忘掉「它是 Nexus 上的哪个 Mod」，磁盘文件一个都不动',
    ['只忘掉「它是 Nexus 上的哪個 Mod」，磁碟檔案一個都不動',
      'Just forget which Nexus mod it is; not a single file on disk is touched',
      '「Nexus のどの Mod か」を忘れるだけで、ディスク上のファイルは一切触りません',
      "'Nexus의 어떤 모드인지'만 잊을 뿐, 디스크의 파일은 전혀 건드리지 않습니다",
      'Просто забыть, какой это мод на Nexus; файлы на диске не изменяются',
      'Nur vergessen, welcher Nexus-Mod es ist; keine Datei auf der Festplatte wird angefasst',
      "Oublier simplement de quel mod Nexus il s'agit ; aucun fichier sur le disque n'est touché",
      'Solo olvida qué mod de Nexus es; no se toca ningún archivo del disco',
      'Apenas esquece qual mod do Nexus é; nenhum arquivo no disco é tocado',
      'Dimentica solo quale mod di Nexus sia; nessun file sul disco viene toccato',
      'Zapomina tylko, którym modem z Nexusa jest; żaden plik na dysku nie jest ruszany',
      'Sadece hangi Nexus modu olduğu unutulur; diskteki hiçbir dosyaya dokunulmaz',
      'แค่ลืมว่าเป็นมอดไหนบน Nexus ไฟล์บนดิสก์ไม่ถูกแตะต้องเลย']],
  ['高置信', ['高信度', 'High confidence', '高信頼', '신뢰도 높음', 'Высокая уверенность',
    'Hohe Sicherheit', 'Confiance élevée', 'Confianza alta', 'Confiança alta',
    'Affidabilità alta', 'Wysoka pewność', 'Yüksek güven', 'ความมั่นใจสูง']],
  ['中置信', ['中信度', 'Medium confidence', '中信頼', '신뢰도 보통', 'Средняя уверенность',
    'Mittlere Sicherheit', 'Confiance moyenne', 'Confianza media', 'Confiança média',
    'Affidabilità media', 'Średnia pewność', 'Orta güven', 'ความมั่นใจปานกลาง']],
  ['低置信', ['低信度', 'Low confidence', '低信頼', '신뢰도 낮음', 'Низкая уверенность',
    'Geringe Sicherheit', 'Faible confiance', 'Confianza baja', 'Confiança baixa',
    'Affidabilità bassa', 'Niska pewność', 'Düşük güven', 'ความมั่นใจต่ำ']],
  ['未匹配', ['未匹配', 'No match', '一致なし', '일치 없음', 'Нет совпадений',
    'Kein Treffer', 'Aucune correspondance', 'Sin coincidencias', 'Sem correspondência',
    'Nessuna corrispondenza', 'Brak dopasowania', 'Eşleşme yok', 'ไม่พบที่ตรงกัน']],
  ['正在获取 Nexus Mod 目录', ['正在取得 Nexus Mod 目錄', 'Fetching the Nexus mod catalog',
    'Nexus Mod 一覧を取得中', 'Nexus 모드 목록을 가져오는 중', 'Получение каталога модов Nexus',
    'Nexus-Mod-Katalog wird geladen', 'Récupération du catalogue de mods Nexus',
    'Obteniendo el catálogo de mods de Nexus', 'Obtendo o catálogo de mods do Nexus',
    'Recupero del catalogo mod di Nexus', 'Pobieranie katalogu modów Nexus',
    'Nexus mod kataloğu alınıyor', 'กำลังดึงรายการมอด Nexus']],
  ['（首次约 1 分钟，之后 7 天内复用缓存）',
    ['（首次約 1 分鐘，之後 7 天內重複使用快取）',
      '(about 1 minute the first time, then cached for 7 days)',
      '（初回は約 1 分、その後 7 日間はキャッシュを再利用）',
      '(처음 약 1분, 이후 7일 동안 캐시 재사용)',
      '(около 1 минуты в первый раз, затем кэш на 7 дней)',
      '(beim ersten Mal etwa 1 Minute, danach 7 Tage aus dem Cache)',
      '(environ 1 minute la première fois, puis en cache 7 jours)',
      '(unos 1 minuto la primera vez, luego se reutiliza la caché 7 días)',
      '(cerca de 1 minuto na primeira vez, depois reutiliza o cache por 7 dias)',
      '(circa 1 minuto la prima volta, poi cache per 7 giorni)',
      '(pierwszy raz około minuty, potem 7 dni z pamięci podręcznej)',
      '(ilk seferde yaklaşık 1 dakika, sonra 7 gün önbellekten)',
      '(ครั้งแรกประมาณ 1 นาที จากนั้นใช้แคช 7 วัน)']],
  ['正在比对本地 Mod', ['正在比對本地 Mod', 'Matching local mods', 'ローカル Mod を照合中',
    '로컬 모드 대조 중', 'Сверка локальных модов', 'Lokale Mods werden abgeglichen',
    'Comparaison des mods locaux', 'Comparando mods locales', 'Comparando mods locais',
    'Confronto dei mod locali', 'Porównywanie modów lokalnych', 'Yerel modlar karşılaştırılıyor',
    'กำลังเทียบมอดในเครื่อง']],
  ['没有需要解析的 Mod —— 扫描到的每一条都已经有来源信息了。',
    ['沒有需要解析的 Mod —— 掃描到的每一條都已經有來源資訊了。',
      'Nothing to match — every scanned item already has source info.',
      '照合が必要な Mod はありません —— スキャンした項目はすべて出典情報を持っています。',
      '매칭할 모드가 없습니다 — 스캔한 항목은 모두 출처 정보가 있습니다.',
      'Сопоставлять нечего — у всех найденных элементов уже есть сведения об источнике.',
      'Nichts abzugleichen — jeder gefundene Eintrag hat bereits Quellenangaben.',
      'Rien à associer — chaque élément analysé possède déjà des infos de source.',
      'Nada que emparejar: cada elemento escaneado ya tiene información de origen.',
      'Nada para associar — cada item verificado já tem informações de origem.',
      'Niente da abbinare: ogni elemento analizzato ha già le informazioni sulla fonte.',
      'Nie ma czego dopasowywać — każdy znaleziony element ma już informacje o źródle.',
      'Eşleştirilecek bir şey yok — taranan her öğenin kaynak bilgisi zaten var.',
      'ไม่มีมอดที่ต้องจับคู่ — ทุกรายการที่สแกนมีข้อมูลแหล่งที่มาแล้ว']],
  ['共 %s 条待解析 · ', ['共 %s 筆待解析 · ', '%s items to match · ', '%s 件が照合待ち · ',
    '%s개 매칭 대기 · ', '%s к сопоставлению · ', '%s Einträge abzugleichen · ',
    '%s éléments à associer · ', '%s elementos por emparejar · ', '%s itens a associar · ',
    '%s elementi da abbinare · ', '%s elementów do dopasowania · ', '%s öğe eşleştirilecek · ',
    '%s รายการรอจับคู่ · ']],
  ['默认只勾选「高置信」。逐条看过再应用 —— 名字里带代号的往往没有可靠信号，宁可留空。',
    ['預設只勾選「高信度」。逐條看過再套用 —— 名稱裡帶代號的往往沒有可靠訊號，寧可留空。',
      'Only high-confidence rows are checked by default. Review each one before applying — names made of codes rarely give a reliable signal, so leaving them empty is safer.',
      '既定では「高信頼」のみチェックされます。適用前に必ず目で確認を —— 型番だけの名前は手がかりが乏しいので、空のままにする方が安全です。',
      "기본적으로 '신뢰도 높음'만 선택됩니다. 적용 전에 하나씩 확인하세요 — 코드명만 있는 이름은 신호가 약하니 비워 두는 편이 좋습니다.",
      'По умолчанию отмечены только строки с высокой уверенностью. Просмотрите каждую перед применением — в названиях из кодов сигнала почти нет, лучше оставить пустыми.',
      'Standardmäßig sind nur Einträge mit hoher Sicherheit angehakt. Vor dem Anwenden jeden kurz prüfen — reine Codenamen liefern selten ein verlässliches Signal, lieber leer lassen.',
      "Seules les lignes à confiance élevée sont cochées par défaut. Vérifiez chacune avant d'appliquer — les noms composés de codes donnent rarement un signal fiable, mieux vaut laisser vide.",
      'Solo se marcan por defecto las filas de confianza alta. Revísalas antes de aplicar: los nombres con códigos rara vez dan una señal fiable, mejor dejarlos vacíos.',
      'Apenas as linhas de confiança alta vêm marcadas. Revise cada uma antes de aplicar — nomes com códigos raramente dão sinal confiável, melhor deixar vazio.',
      'Per impostazione predefinita sono spuntate solo le righe ad alta affidabilità. Controllale prima di applicare: i nomi fatti di codici raramente danno un segnale affidabile, meglio lasciarli vuoti.',
      'Domyślnie zaznaczone są tylko wiersze o wysokiej pewności. Przejrzyj je przed zastosowaniem — nazwy złożone z kodów rzadko dają wiarygodny sygnał, lepiej zostawić puste.',
      'Varsayılan olarak yalnızca yüksek güvenli satırlar işaretlidir. Uygulamadan önce her birini gözden geçir — kod adlarından oluşan isimler pek güvenilir sinyal vermez, boş bırakmak daha iyi.',
      'ค่าเริ่มต้นจะเลือกเฉพาะแถวที่ความมั่นใจสูง ตรวจดูทีละรายการก่อนใช้งาน — ชื่อที่เป็นรหัสมักไม่มีสัญญาณที่เชื่อถือได้ ปล่อยว่างไว้ดีกว่า']],
  ['不关联（保持未登记）', ['不關聯（保持未登記）', "Don't link (keep unregistered)",
    '関連付けない（未登録のまま）', '연결 안 함 (미등록 유지)', 'Не связывать (оставить незарегистрированным)',
    'Nicht verknüpfen (unregistriert lassen)', 'Ne pas associer (laisser non enregistré)',
    'No vincular (dejar sin registrar)', 'Não vincular (manter não registrado)',
    'Non collegare (lascia non registrato)', 'Nie wiąż (pozostaw niezarejestrowany)',
    'Bağlama (kayıtsız kalsın)', 'ไม่เชื่อมโยง (คงสถานะยังไม่ลงทะเบียน)']],
  ['搜索其他 Mod…', ['搜尋其他 Mod…', 'Search for another mod…', '別の Mod を検索…',
    '다른 모드 검색…', 'Найти другой мод…', 'Anderen Mod suchen…', 'Chercher un autre mod…',
    'Buscar otro mod…', 'Procurar outro mod…', 'Cerca un altro mod…', 'Szukaj innego moda…',
    'Başka mod ara…', 'ค้นหามอดอื่น…']],
  ['这个分组下没有条目。', ['這個分組下沒有項目。', 'No items in this group.',
    'このグループに項目はありません。', '이 그룹에 항목이 없습니다.',
    'В этой группе нет элементов.', 'Keine Einträge in dieser Gruppe.',
    'Aucun élément dans ce groupe.', 'No hay elementos en este grupo.',
    'Nenhum item neste grupo.', 'Nessun elemento in questo gruppo.',
    'Brak elementów w tej grupie.', 'Bu grupta öğe yok.', 'ไม่มีรายการในกลุ่มนี้']],
  ['手动挑一个 Nexus Mod：', ['手動挑一個 Nexus Mod：', 'Pick a Nexus mod by hand:',
    'Nexus Mod を手動で選ぶ：', 'Nexus 모드를 직접 선택:', 'Выберите мод Nexus вручную:',
    'Nexus-Mod manuell wählen:', 'Choisir un mod Nexus à la main :', 'Elige un mod de Nexus a mano:',
    'Escolha um mod do Nexus à mão:', 'Scegli un mod di Nexus a mano:',
    'Wybierz mod z Nexusa ręcznie:', 'Nexus modunu elle seç:', 'เลือกมอด Nexus ด้วยตัวเอง:']],
  ['输入 Mod 名称里的几个词，回车搜索',
    ['輸入 Mod 名稱裡的幾個詞，按 Enter 搜尋', 'Type a few words from the mod name, press Enter to search',
      'Mod 名の単語をいくつか入力し、Enter で検索', '모드 이름의 몇 단어를 입력하고 Enter로 검색',
      'Введите несколько слов из названия мода и нажмите Enter',
      'Ein paar Wörter aus dem Mod-Namen eingeben, Enter zum Suchen',
      'Saisissez quelques mots du nom du mod, Entrée pour chercher',
      'Escribe unas palabras del nombre del mod, Enter para buscar',
      'Digite algumas palavras do nome do mod, Enter para buscar',
      'Digita qualche parola del nome del mod, Invio per cercare',
      'Wpisz kilka słów z nazwy moda, Enter aby szukać',
      'Mod adından birkaç kelime yaz, aramak için Enter',
      'พิมพ์คำบางคำจากชื่อมอดแล้วกด Enter เพื่อค้นหา']],
  ['搜索中…', ['搜尋中…', 'Searching…', '検索中…', '검색 중…', 'Поиск…', 'Suche läuft…',
    'Recherche…', 'Buscando…', 'Procurando…', 'Ricerca in corso…', 'Szukanie…', 'Aranıyor…',
    'กำลังค้นหา…']],
  ['搜索', ['搜尋', 'Search', '検索', '검색', 'Поиск', 'Suchen', 'Rechercher', 'Buscar',
    'Procurar', 'Cerca', 'Szukaj', 'Ara', 'ค้นหา']],
  ['返回列表', ['返回列表', 'Back to list', '一覧に戻る', '목록으로', 'Назад к списку',
    'Zurück zur Liste', 'Retour à la liste', 'Volver a la lista', 'Voltar à lista',
    'Torna alla lista', 'Wróć do listy', 'Listeye dön', 'กลับไปที่รายการ']],
  ['选它', ['選它', 'Choose', 'これを選ぶ', '선택', 'Выбрать', 'Wählen', 'Choisir', 'Elegir',
    'Escolher', 'Scegli', 'Wybierz', 'Seç', 'เลือกอันนี้']],
  ['没有搜到，换个词试试。', ['沒有搜到，換個詞試試。', 'Nothing found — try another word.',
    '見つかりません。別の言葉で試してください。', '찾지 못했습니다. 다른 단어로 시도해 보세요.',
    'Ничего не найдено — попробуйте другое слово.', 'Nichts gefunden — versuche ein anderes Wort.',
    "Rien trouvé — essayez un autre mot.", 'No se encontró nada: prueba con otra palabra.',
    'Nada encontrado — tente outra palavra.', "Nessun risultato: prova un'altra parola.",
    'Nic nie znaleziono — spróbuj innego słowa.', 'Bulunamadı — başka bir kelime dene.',
    'ไม่พบ ลองใช้คำอื่น']],
  ['解析过程只读不写：先取一份 Nexus 目录，再在本地逐条比对。中途可以取消。',
    ['解析過程唯讀不寫：先取一份 Nexus 目錄，再在本機逐條比對。中途可以取消。',
      'Matching is read-only: it fetches a Nexus catalog, then compares locally item by item. You can cancel along the way.',
      '照合は読み取り専用です。まず Nexus の一覧を取得し、ローカルで 1 件ずつ比較します。途中で中止できます。',
      '매칭은 읽기 전용입니다. 먼저 Nexus 목록을 가져온 뒤 로컬에서 하나씩 비교합니다. 도중에 취소할 수 있습니다.',
      'Сопоставление только читает данные: сначала загружается каталог Nexus, затем идёт локальная сверка по одному. Можно отменить по ходу.',
      'Der Abgleich ist schreibgeschützt: erst wird der Nexus-Katalog geladen, dann lokal Eintrag für Eintrag verglichen. Abbruch jederzeit möglich.',
      'La correspondance est en lecture seule : elle récupère un catalogue Nexus, puis compare localement élément par élément. Annulable à tout moment.',
      'El emparejamiento es de solo lectura: descarga un catálogo de Nexus y compara localmente uno a uno. Puedes cancelar cuando quieras.',
      'A correspondência é somente leitura: busca um catálogo do Nexus e compara localmente item por item. Dá para cancelar no meio.',
      'La corrispondenza è in sola lettura: scarica un catalogo Nexus e confronta localmente uno per uno. Puoi annullare in qualsiasi momento.',
      'Dopasowanie tylko czyta dane: pobiera katalog Nexusa, potem porównuje lokalnie element po elemencie. Można przerwać w trakcie.',
      'Eşleştirme yalnızca okur: önce Nexus kataloğunu alır, sonra yerelde tek tek karşılaştırır. Yarıda iptal edebilirsin.',
      'การจับคู่อ่านข้อมูลเท่านั้น: ดึงรายการ Nexus มาก่อน แล้วเทียบในเครื่องทีละรายการ ยกเลิกได้ระหว่างทาง']],
  ['重新解析', ['重新解析', 'Run again', '再解析', '다시 분석', 'Повторить', 'Erneut abgleichen',
    'Relancer', 'Volver a analizar', 'Analisar de novo', 'Ripeti', 'Dopasuj ponownie',
    'Yeniden çözümle', 'วิเคราะห์ใหม่']],
  ['开始解析', ['開始解析', 'Start matching', '照合を開始', '매칭 시작', 'Начать сопоставление',
    'Abgleich starten', 'Lancer la correspondance', 'Empezar a emparejar',
    'Iniciar correspondência', 'Avvia la corrispondenza', 'Rozpocznij dopasowanie',
    'Eşleştirmeyi başlat', 'เริ่มจับคู่']],
  ['应用选中 %s 条', ['套用選取 %s 筆', 'Apply %s selected', '選択した %s 件を適用',
    '선택한 %s개 적용', 'Применить выбранные (%s)', '%s ausgewählte übernehmen',
    'Appliquer %s sélections', 'Aplicar %s seleccionados', 'Aplicar %s selecionados',
    'Applica %s selezionati', 'Zastosuj %s zaznaczonych', 'Seçili %s öğeyi uygula',
    'ใช้ %s รายการที่เลือก']],
  ['读取状态…', ['讀取狀態…', 'Reading state…', '状態を読み込み中…', '상태 읽는 중…',
    'Чтение состояния…', 'Status wird gelesen…', "Lecture de l'état…", 'Leyendo estado…',
    'Lendo estado…', 'Lettura dello stato…', 'Odczyt stanu…', 'Durum okunuyor…',
    'กำลังอ่านสถานะ…']],
  ['解析失败：', ['解析失敗：', 'Matching failed:', '照合に失敗：', '매칭 실패:',
    'Ошибка сопоставления:', 'Abgleich fehlgeschlagen:', 'Échec de la correspondance :',
    'Error al emparejar:', 'Falha na correspondência:', 'Corrispondenza non riuscita:',
    'Dopasowanie nie powiodło się:', 'Eşleştirme başarısız:', 'จับคู่ไม่สำเร็จ:']],
  ['已取消解析', ['已取消解析', 'Matching cancelled', '照合を中止しました', '매칭을 취소했습니다',
    'Сопоставление отменено', 'Abgleich abgebrochen', 'Correspondance annulée',
    'Emparejamiento cancelado', 'Correspondência cancelada', 'Corrispondenza annullata',
    'Dopasowanie anulowane', 'Eşleştirme iptal edildi', 'ยกเลิกการจับคู่แล้ว']],
  ['已经关联过 %s 条 —— 解析只会处理「还没关联」的，重复跑不会重复写。',
    ['已經關聯過 %s 筆 —— 解析只會處理「還沒關聯」的，重複執行不會重複寫入。',
      "%s items are already linked — matching only handles the unlinked ones, so running it again won't write twice.",
      'すでに %s 件が照合済みです —— 照合は「未照合」の項目だけを扱うので、再実行しても二重には書き込みません。',
      "이미 %s개가 연결되어 있습니다 — 매칭은 '연결되지 않은' 항목만 처리하므로 다시 실행해도 중복 기록되지 않습니다.",
      'Уже связано %s записей — сопоставление берёт только несвязанные, поэтому повторный запуск ничего не дублирует.',
      'Bereits %s Einträge verknüpft — der Abgleich behandelt nur noch nicht verknüpfte, ein erneuter Lauf schreibt nichts doppelt.',
      "Déjà %s éléments associés — la correspondance ne traite que les non associés, une nouvelle exécution n'écrira rien en double.",
      'Ya hay %s elementos vinculados: el emparejamiento solo trata los no vinculados, así que repetirlo no duplica nada.',
      'Já há %s itens vinculados — a correspondência só trata os não vinculados, então rodar de novo não grava em dobro.',
      'Già %s elementi collegati — la corrispondenza tratta solo quelli non collegati, quindi rieseguirla non duplica nulla.',
      'Już powiązano %s pozycji — dopasowanie zajmuje się tylko niepowiązanymi, więc ponowne uruchomienie nic nie zdubluje.',
      'Zaten %s öğe bağlı — eşleştirme yalnızca bağlı olmayanları işler, yeniden çalıştırmak çift kayıt yazmaz.',
      'เชื่อมโยงไปแล้ว %s รายการ — การจับคู่จะจัดการเฉพาะที่ยังไม่เชื่อมโยง รันซ้ำก็ไม่เขียนซ้ำ']],
  ['已有 Nexus 目录缓存：', ['已有 Nexus 目錄快取：', 'Nexus catalog cached:',
    'Nexus 一覧のキャッシュあり：', 'Nexus 목록 캐시 있음:', 'Каталог Nexus в кэше:',
    'Nexus-Katalog im Cache:', 'Catalogue Nexus en cache :', 'Catálogo de Nexus en caché:',
    'Catálogo do Nexus em cache:', 'Catalogo Nexus in cache:', 'Katalog Nexusa w pamięci:',
    'Nexus kataloğu önbellekte:', 'มีแคชรายการ Nexus แล้ว:']],
  ['个 Mod，抓取时间 ', ['個 Mod，取得時間 ', 'mods, fetched ', '個の Mod、取得日時 ',
    '개 모드, 가져온 시각 ', 'модов, получено ', 'Mods, geladen ', 'mods, récupéré le ',
    'mods, obtenido el ', 'mods, obtido em ', 'mod, recuperato il ', 'modów, pobrano ',
    'mod, alınma ', 'มอด ดึงเมื่อ ']],
  ['（已过期，会自动重抓）', ['（已過期，會自動重新抓取）', '(expired, will be refetched automatically)',
    '（期限切れのため自動で再取得します）', '(만료됨, 자동으로 다시 받습니다)',
    '(просрочен, будет загружен заново)', '(abgelaufen, wird automatisch neu geladen)',
    '(expiré, sera récupéré automatiquement)', '(caducado, se volverá a descargar)',
    '(expirado, será buscado de novo)', '(scaduto, verrà riscaricato)',
    '(wygasł, zostanie pobrany ponownie)', '(süresi geçti, yeniden alınacak)',
    '(หมดอายุ จะดึงใหม่ให้อัตโนมัติ)']],
  ['还没有 Nexus 目录缓存 —— 第一次解析需要抓一遍全量目录（约 1 分钟），之后 7 天内都复用。',
    ['還沒有 Nexus 目錄快取 —— 第一次解析需要抓一遍完整目錄（約 1 分鐘），之後 7 天內都重複使用。',
      'No Nexus catalog yet — the first run fetches the whole catalog (about 1 minute), then it is reused for 7 days.',
      'Nexus 一覧のキャッシュはまだありません —— 初回は全件取得に約 1 分かかり、その後 7 日間は再利用します。',
      '아직 Nexus 목록 캐시가 없습니다 — 처음에는 전체 목록을 받아야 하며(약 1분), 이후 7일 동안 재사용합니다.',
      'Каталога Nexus ещё нет — при первом запуске он загружается целиком (около 1 минуты), затем используется 7 дней.',
      'Noch kein Nexus-Katalog im Cache — der erste Lauf lädt den kompletten Katalog (etwa 1 Minute), danach wird er 7 Tage wiederverwendet.',
      'Pas encore de catalogue Nexus — le premier lancement télécharge tout le catalogue (environ 1 minute), puis il est réutilisé 7 jours.',
      'Aún no hay catálogo de Nexus: la primera vez se descarga completo (unos 1 minuto) y luego se reutiliza 7 días.',
      'Ainda não há catálogo do Nexus — a primeira execução baixa o catálogo inteiro (cerca de 1 minuto) e depois ele é reutilizado por 7 dias.',
      'Non c’è ancora un catalogo Nexus: la prima volta lo scarica tutto (circa 1 minuto), poi viene riusato per 7 giorni.',
      'Nie ma jeszcze katalogu Nexusa — pierwsze uruchomienie pobiera cały katalog (około minuty), potem jest używany przez 7 dni.',
      'Henüz Nexus kataloğu yok — ilk çalıştırma tüm kataloğu indirir (yaklaşık 1 dakika), sonra 7 gün boyunca yeniden kullanılır.',
      'ยังไม่มีแคชรายการ Nexus — ครั้งแรกจะดึงทั้งรายการ (ประมาณ 1 นาที) จากนั้นใช้ซ้ำได้ 7 วัน']],
  ['把手动放进 ~Mods 目录、程序没有记录过来源的 Mod，按名字与 Nexus 上的条目对上号，然后补上名字、作者、版本、封面和链接。文件一个都不动，也不会把它们登记成「管理器安装」。',
    ['把手動放進 ~Mods 目錄、程式沒有記錄過來源的 Mod，按名稱與 Nexus 上的項目對上號，然後補上名稱、作者、版本、封面和連結。檔案一個都不動，也不會把它們登記成「管理器安裝」。',
      'For mods you dropped into ~Mods yourself and the app has no source for, this matches them to Nexus entries by name and then fills in name, author, version, cover and link. Not a single file is touched, and they are not registered as installed by the manager.',
      '手動で ~Mods に入れ、アプリが出典を記録していない Mod を、名前から Nexus の項目と照合し、名前・作者・バージョン・カバー・リンクを補います。ファイルは一切変更せず、マネージャーによるインストールとしても登録しません。',
      '직접 ~Mods 폴더에 넣어 앱이 출처를 모르는 모드를 이름으로 Nexus 항목과 대조해 이름, 제작자, 버전, 커버, 링크를 채웁니다. 파일은 전혀 건드리지 않고 관리자 설치로 등록하지도 않습니다.',
      'Для модов, которые вы сами положили в ~Mods и у которых приложение не знает источника, они сопоставляются с записями Nexus по названию, после чего заполняются имя, автор, версия, обложка и ссылка. Файлы не меняются, и они не считаются установленными менеджером.',
      'Für Mods, die du selbst nach ~Mods gelegt hast und deren Quelle die App nicht kennt, werden sie über den Namen Nexus-Einträgen zugeordnet und Name, Autor, Version, Cover und Link ergänzt. Keine Datei wird verändert, und sie werden nicht als vom Manager installiert registriert.',
      "Pour les mods déposés à la main dans ~Mods dont l'app ne connaît pas la source, ils sont rapprochés des entrées Nexus par leur nom, puis nom, auteur, version, couverture et lien sont complétés. Aucun fichier n'est modifié et ils ne sont pas enregistrés comme installés par le gestionnaire.",
      'Para los mods que pusiste a mano en ~Mods y cuya fuente la app no conoce, se emparejan por nombre con las entradas de Nexus y se rellenan nombre, autor, versión, carátula y enlace. No se toca ningún archivo ni se registran como instalados por el gestor.',
      'Para mods que você colocou à mão em ~Mods e cuja origem o app não conhece, eles são associados por nome às entradas do Nexus e recebem nome, autor, versão, capa e link. Nenhum arquivo é alterado e eles não são registrados como instalados pelo gerenciador.',
      'Per i mod inseriti a mano in ~Mods di cui l’app non conosce la fonte, vengono abbinati per nome alle voci Nexus e completati con nome, autore, versione, copertina e link. Nessun file viene toccato e non vengono registrati come installati dal gestore.',
      'Mody wrzucone ręcznie do ~Mods, których źródła aplikacja nie zna, są dopasowywane po nazwie do wpisów Nexusa, a następnie uzupełniane o nazwę, autora, wersję, okładkę i link. Żaden plik nie jest zmieniany i nie są rejestrowane jako instalowane przez menedżer.',
      'Elle ~Mods klasörüne attığın ve uygulamanın kaynağını bilmediği modlar, ada göre Nexus kayıtlarıyla eşleştirilip ad, yapımcı, sürüm, kapak ve bağlantı bilgisi doldurulur. Hiçbir dosyaya dokunulmaz ve yönetici kurulumu olarak kaydedilmezler.',
      'สำหรับมอดที่คุณวางเองใน ~Mods และแอปไม่รู้แหล่งที่มา ระบบจะจับคู่กับรายการ Nexus ตามชื่อ แล้วเติมชื่อ ผู้สร้าง เวอร์ชัน ภาพปก และลิงก์ให้ ไม่มีการแตะไฟล์ใด ๆ และไม่ลงทะเบียนว่าเป็นการติดตั้งผ่านตัวจัดการ']],
  ['正在写入关联并缓存封面…', ['正在寫入關聯並快取封面…', 'Writing links and caching covers…',
    '関連を保存しカバーをキャッシュ中…', '연결을 저장하고 커버를 캐시하는 중…',
    'Сохранение связей и кэширование обложек…',
    'Verknüpfungen werden geschrieben, Cover zwischengespeichert…',
    'Enregistrement des associations et mise en cache des couvertures…',
    'Guardando vínculos y almacenando carátulas…', 'Gravando vínculos e armazenando capas…',
    'Salvataggio dei collegamenti e cache delle copertine…',
    'Zapisywanie powiązań i buforowanie okładek…',
    'Bağlantılar yazılıyor, kapaklar önbelleğe alınıyor…',
    'กำลังบันทึกการเชื่อมโยงและแคชภาพปก…']],
  ['已关联 %s 条', ['已關聯 %s 筆', 'Linked %s items', '%s 件を関連付けました', '%s개 연결했습니다',
    'Связано: %s', '%s verknüpft', '%s éléments associés', '%s elementos vinculados',
    '%s itens vinculados', '%s elementi collegati', 'Powiązano %s pozycji', '%s öğe bağlandı',
    'เชื่อมโยงแล้ว %s รายการ']],
  ['没有勾选任何要关联的条目', ['沒有勾選任何要關聯的項目', 'Nothing is checked to link',
    '関連付ける項目が選択されていません', '연결할 항목이 선택되지 않았습니다',
    'Ничего не отмечено для связывания', 'Es ist nichts zum Verknüpfen ausgewählt',
    "Aucun élément à associer n'est coché", 'No hay nada marcado para vincular',
    'Nada marcado para vincular', 'Nessun elemento selezionato da collegare',
    'Nie zaznaczono nic do powiązania', 'Bağlanacak öğe seçilmedi',
    'ยังไม่ได้เลือกสิ่งที่จะเชื่อมโยง']],
  ['搜索失败：', ['搜尋失敗：', 'Search failed:', '検索に失敗：', '검색 실패:',
    'Ошибка поиска:', 'Suche fehlgeschlagen:', 'Échec de la recherche :', 'Error de búsqueda:',
    'Falha na busca:', 'Ricerca non riuscita:', 'Wyszukiwanie nie powiodło się:',
    'Arama başarısız:', 'ค้นหาไม่สำเร็จ:']],
  ['已解除 %s 条关联（文件未改动）', ['已解除 %s 筆關聯（檔案未改動）',
    'Unlinked %s items (files untouched)', '%s 件の関連を解除しました（ファイルは未変更）',
    '%s개 연결을 해제했습니다 (파일은 그대로)', 'Связи сняты (%s), файлы не изменялись',
    '%s Verknüpfungen gelöst (Dateien unverändert)', '%s associations retirées (fichiers inchangés)',
    '%s vínculos eliminados (archivos intactos)', '%s vínculos removidos (arquivos intactos)',
    '%s collegamenti rimossi (file invariati)', 'Usunięto powiązania: %s (pliki bez zmian)',
    '%s bağlantı kaldırıldı (dosyalar değişmedi)',
    'ยกเลิกการเชื่อมโยง %s รายการแล้ว (ไฟล์ไม่ถูกแก้ไข)']],
  ['没有找到可解除的关联', ['沒有找到可解除的關聯', 'No links found to remove',
    '解除できる関連がありません', '해제할 연결이 없습니다', 'Связей для снятия не найдено',
    'Keine Verknüpfung zum Lösen gefunden', 'Aucune association à retirer',
    'No se encontraron vínculos que quitar', 'Nenhum vínculo para remover',
    'Nessun collegamento da rimuovere', 'Nie znaleziono powiązań do usunięcia',
    'Kaldırılacak bağlantı bulunamadı', 'ไม่พบการเชื่อมโยงที่ยกเลิกได้']],

  // ---- ⑭ 文件名里的 Nexus 标识（管理器安装时写进 pak 名，0.3.1） ----
  ['文件名带标识',
    ['檔名帶標識', 'Tagged in filename', 'ファイル名に識別子あり', '파일명에 식별자 있음',
      'Метка в имени файла', 'Kennung im Dateinamen', 'Identifiant dans le nom de fichier',
      'Identificador en el nombre', 'Identificador no nome do arquivo',
      'Identificatore nel nome file', 'Identyfikator w nazwie pliku',
      'Dosya adında kimlik var', 'มีรหัสในชื่อไฟล์']],
  ['上面这个来源来自文件名里的标识 —— 安装时就写在名字上了，不是按名字猜的。',
    ['上面這個來源來自檔名裡的標識 —— 安裝時就寫在名字上了，不是按名字猜的。',
      'This source comes from the tag in the filename — written at install time, not guessed from the name.',
      'この出典はファイル名の識別子によるものです — インストール時に書き込まれたもので、名前から推測したものではありません。',
      '이 출처는 파일명의 식별자에서 나온 것입니다 — 설치할 때 이름에 기록된 것이며, 이름으로 추측한 것이 아닙니다.',
      'Этот источник взят из метки в имени файла — она записана при установке, а не угадана по названию.',
      'Diese Quelle stammt aus der Kennung im Dateinamen — beim Installieren geschrieben, nicht aus dem Namen geraten.',
      'Cette source vient de l’identifiant dans le nom de fichier — écrit à l’installation, pas deviné d’après le nom.',
      'Esta fuente viene del identificador del nombre de archivo — escrito al instalar, no adivinado por el nombre.',
      'Esta origem vem do identificador no nome do arquivo — escrito na instalação, não adivinhado pelo nome.',
      'Questa origine viene dall’identificatore nel nome file — scritto all’installazione, non indovinato dal nome.',
      'To źródło pochodzi z identyfikatora w nazwie pliku — zapisanego przy instalacji, a nie zgadniętego z nazwy.',
      'Bu kaynak dosya adındaki kimlikten geliyor — kurulum sırasında yazıldı, addan tahmin edilmedi.',
      'แหล่งที่มานี้มาจากรหัสในชื่อไฟล์ — เขียนตอนติดตั้ง ไม่ได้เดาจากชื่อ']],

  // ---- ⑮ 游戏目录搬移 / 便携账本（0.3.3） ----
  ['已安装记录（跟着游戏走）',
    ['已安裝記錄（跟著遊戲走）', 'Installed records (follows the game)', 'インストール記録（ゲームに追従）',
      '설치 기록(게임을 따라감)', 'Записи об установке (следуют за игрой)', 'Installationsprotokoll (folgt dem Spiel)',
      'Enregistrements d’installation (suivent le jeu)', 'Registros de instalación (siguen al juego)',
      'Registros de instalação (seguem o jogo)', 'Record di installazione (seguono il gioco)',
      'Rekordy instalacji (podążają za grą)', 'Kurulum kayıtları (oyunu takip eder)',
      'บันทึกการติดตั้ง (ตามเกมไป)']],
  ['账本',
    ['帳本', 'Ledger', '台帳', '원장', 'Реестр', 'Register', 'Registre', 'Registro', 'Registro',
      'Registro', 'Rejestr', 'Kayıt defteri', 'บัญชี']],
  ['管理器会记两份账：一份在自己数据目录的 mods.json，另一份写在游戏根目录的 .sbmod\\ledger.json。整个游戏文件夹搬走（换盘 / 换机器）后账本跟着走，打开管理器会自动把路径对齐，不需要重新关联。',
    ['管理器會記兩份帳：一份在自己資料目錄的 mods.json，另一份寫在遊戲根目錄的 .sbmod\\ledger.json。整個遊戲資料夾搬走（換碟 / 換機器）後帳本跟著走，打開管理器會自動把路徑對齊，不需要重新關聯。',
      'The manager keeps two copies: one in its own data folder (mods.json), one in .sbmod\\ledger.json at the game root. Move the whole game folder (another drive or machine) and the ledger moves with it — on startup the manager realigns the paths automatically, no re-linking needed.',
      'マネージャーは二重に記録します。ひとつは自身のデータフォルダの mods.json、もうひとつはゲームのルートにある .sbmod\\ledger.json です。ゲームフォルダごと移動（別ドライブ・別 PC）しても台帳がついてくるので、起動時にパスが自動で揃い、関連付けのやり直しは不要です。',
      '관리 프로그램은 두 곳에 기록합니다. 하나는 자체 데이터 폴더의 mods.json, 다른 하나는 게임 루트의 .sbmod\\ledger.json 입니다. 게임 폴더를 통째로 옮겨도(다른 드라이브/다른 PC) 원장이 함께 따라오므로, 실행하면 경로가 자동으로 맞춰지고 다시 연결할 필요가 없습니다.',
      'Менеджер ведёт две копии: одну в своей папке данных (mods.json), другую в .sbmod\\ledger.json в корне игры. Перенесите всю папку игры (другой диск или компьютер) — реестр поедет вместе с ней, и при запуске пути выровняются автоматически, заново связывать ничего не нужно.',
      'Der Manager führt zwei Kopien: eine im eigenen Datenordner (mods.json), eine in .sbmod\\ledger.json im Spielstammverzeichnis. Wird der ganze Spielordner verschoben (anderes Laufwerk oder anderer PC), wandert das Register mit — beim Start werden die Pfade automatisch angeglichen, ein erneutes Verknüpfen ist nicht nötig.',
      'Le gestionnaire tient deux registres : un dans son dossier de données (mods.json), un dans .sbmod\\ledger.json à la racine du jeu. Déplacez tout le dossier du jeu (autre disque ou autre machine) et le registre suit : au démarrage les chemins sont réalignés automatiquement, sans rien relier à nouveau.',
      'El gestor guarda dos copias: una en su carpeta de datos (mods.json) y otra en .sbmod\\ledger.json en la raíz del juego. Si mueves toda la carpeta del juego (otro disco u otro equipo), el registro viaja con ella y al iniciar las rutas se realinean solas, sin volver a vincular nada.',
      'O gerenciador mantém duas cópias: uma na própria pasta de dados (mods.json) e outra em .sbmod\\ledger.json na raiz do jogo. Movendo a pasta do jogo inteira (outro disco ou outro PC), o registro vai junto e, ao iniciar, os caminhos são realinhados automaticamente, sem precisar vincular de novo.',
      'Il gestore tiene due copie: una nella propria cartella dati (mods.json), una in .sbmod\\ledger.json nella radice del gioco. Spostando l’intera cartella del gioco (altro disco o altro PC) il registro la segue: all’avvio i percorsi vengono riallineati da soli, senza dover ricollegare nulla.',
      'Menedżer prowadzi dwie kopie: jedną we własnym folderze danych (mods.json), drugą w .sbmod\\ledger.json w katalogu gry. Po przeniesieniu całego folderu gry (inny dysk lub komputer) rejestr wędruje razem z nim, a przy starcie ścieżki są wyrównywane automatycznie — bez ponownego powiązywania.',
      'Yönetici iki kayıt tutar: biri kendi veri klasöründe (mods.json), diğeri oyun kökünde .sbmod\\ledger.json. Tüm oyun klasörünü taşısanız da (başka disk veya bilgisayar) kayıt onunla gelir; açılışta yollar otomatik hizalanır, yeniden bağlamanız gerekmez.',
      'ตัวจัดการเก็บบันทึกสองชุด ชุดหนึ่งในโฟลเดอร์ข้อมูลของตัวเอง (mods.json) อีกชุดอยู่ที่ .sbmod\\ledger.json ในโฟลเดอร์เกม ย้ายโฟลเดอร์เกมทั้งก้อน (เปลี่ยนไดรฟ์/เครื่อง) บันทึกก็ตามไปด้วย เปิดโปรแกรมแล้วเส้นทางจะถูกจัดให้ตรงอัตโนมัติ ไม่ต้องเชื่อมใหม่']],
  ['检查并修复路径',
    ['檢查並修復路徑', 'Check and fix paths', 'パスを確認して修復', '경로 확인 및 수정',
      'Проверить и исправить пути', 'Pfade prüfen und reparieren', 'Vérifier et corriger les chemins',
      'Comprobar y corregir rutas', 'Verificar e corrigir caminhos', 'Controlla e correggi i percorsi',
      'Sprawdź i napraw ścieżki', 'Yolları denetle ve onar', 'ตรวจและแก้ไขเส้นทาง']],
  ['写入账本到游戏目录',
    ['寫入帳本到遊戲目錄', 'Write ledger to game folder', '台帳をゲームフォルダに書き込む',
      '원장을 게임 폴더에 쓰기', 'Записать реестр в папку игры', 'Register in den Spielordner schreiben',
      'Écrire le registre dans le dossier du jeu', 'Escribir registro en la carpeta del juego',
      'Gravar registro na pasta do jogo', 'Scrivi registro nella cartella del gioco',
      'Zapisz rejestr w folderze gry', 'Kaydı oyun klasörüne yaz', 'เขียนบันทึกลงโฟลเดอร์เกม']],
  ['从账本恢复',
    ['從帳本恢復', 'Restore from ledger', '台帳から復元', '원장에서 복원', 'Восстановить из реестра',
      'Aus Register wiederherstellen', 'Restaurer depuis le registre', 'Restaurar desde el registro',
      'Restaurar do registro', 'Ripristina dal registro', 'Przywróć z rejestru', 'Kayıttan geri yükle',
      'กู้คืนจากบันทึก']],
  ['还没设置游戏目录',
    ['還沒設定遊戲目錄', 'No game folder set yet', 'ゲームフォルダが未設定です',
      '게임 폴더가 아직 설정되지 않았습니다', 'Папка игры ещё не задана', 'Noch kein Spielordner festgelegt',
      'Aucun dossier de jeu défini', 'Aún no hay carpeta de juego', 'Pasta do jogo ainda não definida',
      'Cartella del gioco non ancora impostata', 'Nie ustawiono folderu gry',
      'Oyun klasörü henüz ayarlanmadı', 'ยังไม่ได้ตั้งค่าโฟลเดอร์เกม']],
  ['管理器里 %s 条 · 游戏目录里还没有账本',
    ['管理器裡 %s 條 · 遊戲目錄裡還沒有帳本', '%s records in the manager · no ledger in the game folder yet',
      'マネージャーに %s 件 · ゲームフォルダにはまだ台帳がありません',
      '관리 프로그램에 %s개 · 게임 폴더에는 아직 원장이 없습니다',
      'Записей в менеджере: %s · в папке игры реестра пока нет',
      '%s Einträge im Manager · im Spielordner noch kein Register',
      '%s enregistrements dans le gestionnaire · pas encore de registre dans le jeu',
      '%s registros en el gestor · aún no hay registro en el juego',
      '%s registros no gerenciador · ainda sem registro na pasta do jogo',
      '%s record nel gestore · nessun registro nella cartella del gioco',
      '%s rekordów w menedżerze · w folderze gry nie ma jeszcze rejestru',
      'Yöneticide %s kayıt · oyun klasöründe henüz kayıt yok',
      'ในตัวจัดการ %s รายการ · โฟลเดอร์เกมยังไม่มีบันทึก']],
  ['管理器里 %s 条 · 游戏目录里 %s 条',
    ['管理器裡 %s 條 · 遊戲目錄裡 %s 條', '%s records in the manager · %s in the game folder',
      'マネージャーに %s 件 · ゲームフォルダに %s 件', '관리 프로그램에 %s개 · 게임 폴더에 %s개',
      'Записей в менеджере: %s · в папке игры: %s', '%s Einträge im Manager · %s im Spielordner',
      '%s enregistrements dans le gestionnaire · %s dans le dossier du jeu',
      '%s registros en el gestor · %s en la carpeta del juego',
      '%s registros no gerenciador · %s na pasta do jogo',
      '%s record nel gestore · %s nella cartella del gioco',
      '%s rekordów w menedżerze · %s w folderze gry', 'Yöneticide %s kayıt · oyun klasöründe %s',
      'ในตัวจัดการ %s รายการ · ในโฟลเดอร์เกม %s']],
  ['游戏目录与账本记录的不一致',
    ['遊戲目錄與帳本記錄的不一致', 'Game folder differs from the ledger', 'ゲームフォルダと台帳の記録が一致しません',
      '게임 폴더와 원장 기록이 다릅니다', 'Папка игры не совпадает с записью в реестре',
      'Spielordner weicht vom Register ab', 'Le dossier du jeu diffère du registre',
      'La carpeta del juego no coincide con el registro', 'A pasta do jogo difere do registro',
      'La cartella del gioco non corrisponde al registro', 'Folder gry różni się od rejestru',
      'Oyun klasörü kayıtla uyuşmuyor', 'โฟลเดอร์เกมไม่ตรงกับบันทึก']],
  ['检查已安装记录',
    ['檢查已安裝記錄', 'Check installed records', 'インストール記録を確認', '설치 기록 확인',
      'Проверить записи об установке', 'Installationsprotokoll prüfen', 'Vérifier les enregistrements',
      'Comprobar registros de instalación', 'Verificar registros de instalação',
      'Controlla i record di installazione', 'Sprawdź rekordy instalacji',
      'Kurulum kayıtlarını denetle', 'ตรวจสอบบันทึกการติดตั้ง']],
  ['可以把 %s 条记录从旧目录改到当前目录（涉及 %s 个文件，已逐个核对文件确实存在）。',
    ['可以把 %s 條記錄從舊目錄改到目前目錄（涉及 %s 個檔案，已逐個核對檔案確實存在）。',
      '%s records can be moved from the old folder to the current one (%s files involved, each checked to exist).',
      '%s 件の記録を旧フォルダから現在のフォルダへ付け替えられます（%s 個のファイル、実在を一つずつ確認済み）。',
      '%s개 기록을 이전 폴더에서 현재 폴더로 바꿀 수 있습니다(파일 %s개, 하나씩 실제 존재 확인).',
      'Можно перенести записей: %s со старой папки в текущую (файлов: %s, каждый проверен на наличие).',
      '%s Einträge lassen sich vom alten in den aktuellen Ordner umziehen (%s Dateien, jede auf Vorhandensein geprüft).',
      '%s enregistrements peuvent passer de l’ancien dossier à l’actuel (%s fichiers concernés, tous vérifiés comme présents).',
      'Se pueden mover %s registros de la carpeta antigua a la actual (%s archivos implicados, comprobados uno a uno).',
      '%s registros podem ser movidos da pasta antiga para a atual (%s arquivos envolvidos, verificados um a um).',
      '%s record possono essere spostati dalla vecchia cartella a quella attuale (%s file coinvolti, verificati uno per uno).',
      'Można przenieść %s rekordów ze starego folderu do obecnego (%s plików, każdy sprawdzony pod kątem istnienia).',
      '%s kayıt eski klasörden geçerli klasöre taşınabilir (%s dosya, her biri var mı diye kontrol edildi).',
      'ย้ายได้ %s รายการจากโฟลเดอร์เดิมมาที่โฟลเดอร์ปัจจุบัน (เกี่ยวข้องกับ %s ไฟล์ ตรวจแล้วว่ามีอยู่จริงทีละไฟล์)']],
  ['没有可自动对齐的记录。',
    ['沒有可自動對齊的記錄。', 'No records can be realigned automatically.',
      '自動で付け替えできる記録はありません。', '자동으로 정렬할 기록이 없습니다.',
      'Нет записей для автоматического выравнивания.', 'Keine Einträge zum automatischen Angleichen.',
      'Aucun enregistrement à réaligner automatiquement.', 'No hay registros que realinear automáticamente.',
      'Nenhum registro para realinhar automaticamente.', 'Nessun record da riallineare automaticamente.',
      'Brak rekordów do automatycznego wyrównania.', 'Otomatik hizalanacak kayıt yok.',
      'ไม่มีรายการที่จัดให้ตรงอัตโนมัติได้']],
  ['旧目录：',
    ['舊目錄：', 'Old folder: ', '旧フォルダ：', '이전 폴더: ', 'Старая папка: ', 'Alter Ordner: ',
      'Ancien dossier : ', 'Carpeta antigua: ', 'Pasta antiga: ', 'Vecchia cartella: ', 'Stary folder: ',
      'Eski klasör: ', 'โฟลเดอร์เดิม:']],
  ['当前目录：',
    ['目前目錄：', 'Current folder: ', '現在のフォルダ：', '현재 폴더: ', 'Текущая папка: ', 'Aktueller Ordner: ',
      'Dossier actuel : ', 'Carpeta actual: ', 'Pasta atual: ', 'Cartella attuale: ', 'Bieżący folder: ',
      'Geçerli klasör: ', 'โฟลเดอร์ปัจจุบัน:']],
  ['另有 %s 条找不到对应文件（可能没拷全），这些保持原样不动。',
    ['另有 %s 條找不到對應檔案（可能沒拷全），這些保持原樣不動。',
      'Another %s have no matching files (maybe not fully copied); they are left untouched.',
      '別に %s 件は対応するファイルが見つかりません（コピー漏れの可能性）。これらはそのままにします。',
      '추가로 %s개는 해당 파일을 찾지 못했습니다(복사가 덜 됐을 수 있음). 이 항목은 그대로 둡니다.',
      'Ещё у %s записей не нашлось файлов (возможно, скопировано не полностью) — они остаются как есть.',
      'Bei weiteren %s fehlen die Dateien (vielleicht unvollständig kopiert); sie bleiben unverändert.',
      '%s autres n’ont pas de fichiers correspondants (copie peut-être incomplète) ; ils restent tels quels.',
      'Otros %s no tienen archivos correspondientes (quizá no se copió todo); se dejan intactos.',
      'Outros %s não têm arquivos correspondentes (talvez não tenha copiado tudo); ficam como estão.',
      'Altri %s non hanno file corrispondenti (forse copia incompleta); restano invariati.',
      'Kolejne %s nie mają pasujących plików (może skopiowano nie wszystko) — pozostają bez zmian.',
      '%s kayıt için dosya bulunamadı (tam kopyalanmamış olabilir); bunlara dokunulmaz.',
      'อีก %s รายการไม่พบไฟล์ที่ตรงกัน (อาจคัดลอกมาไม่ครบ) รายการเหล่านี้จะไม่ถูกแก้ไข']],
  ['修复 %s 条',
    ['修復 %s 條', 'Fix %s', '%s 件を修復', '%s개 수정', 'Исправить: %s', '%s reparieren', 'Corriger %s',
      'Corregir %s', 'Corrigir %s', 'Correggi %s', 'Napraw %s', '%s kaydı onar', 'แก้ไข %s รายการ']],
  ['检测到游戏目录搬移：',
    ['偵測到遊戲目錄搬移：', 'Game folder move detected: ', 'ゲームフォルダの移動を検出：',
      '게임 폴더 이동 감지: ', 'Обнаружен перенос папки игры: ', 'Spielordner verschoben erkannt: ',
      'Déplacement du dossier du jeu détecté : ', 'Carpeta del juego movida detectada: ',
      'Pasta do jogo movida detectada: ', 'Spostamento della cartella del gioco rilevato: ',
      'Wykryto przeniesienie folderu gry: ', 'Oyun klasörü taşınmış: ', 'ตรวจพบการย้ายโฟลเดอร์เกม:']],
  ['从游戏目录账本恢复 %s 条',
    ['從遊戲目錄帳本恢復 %s 條', '%s restored from the game folder ledger',
      'ゲームフォルダの台帳から %s 件復元', '게임 폴더 원장에서 %s개 복원',
      'Из реестра в папке игры восстановлено: %s',
      '%s aus dem Register im Spielordner wiederhergestellt',
      '%s restaurés depuis le registre du jeu', '%s restaurados desde el registro del juego',
      '%s restaurados do registro do jogo', '%s ripristinati dal registro del gioco',
      'Przywrócono %s z rejestru w folderze gry', 'Oyun klasörü kaydından %s geri yüklendi',
      'กู้คืน %s รายการจากบันทึกในโฟลเดอร์เกม']],
  ['对齐 %s 条已安装记录',
    ['對齊 %s 條已安裝記錄', '%s installed records realigned', '%s 件のインストール記録を整合',
      '설치 기록 %s개 정렬', 'Выровнено записей об установке: %s',
      '%s Installationsprotokolle angeglichen', '%s enregistrements réalignés',
      '%s registros realineados', '%s registros realinhados', '%s record riallineati',
      'Wyrównano %s rekordów instalacji', '%s kurulum kaydı hizalandı',
      'จัด %s รายการติดตั้งให้ตรงแล้ว']],
  ['已对齐 %s 条记录（文件未改动）',
    ['已對齊 %s 條記錄（檔案未改動）', 'Realigned %s records (files untouched)',
      '%s 件の記録を整合しました（ファイルは未変更）', '기록 %s개를 정렬했습니다(파일은 그대로)',
      'Выровнено записей: %s (файлы не изменялись)', '%s Einträge angeglichen (Dateien unverändert)',
      '%s enregistrements réalignés (fichiers inchangés)', '%s registros realineados (archivos intactos)',
      '%s registros realinhados (arquivos intactos)', '%s record riallineati (file intatti)',
      'Wyrównano %s rekordów (pliki bez zmian)', '%s kayıt hizalandı (dosyalara dokunulmadı)',
      'จัด %s รายการให้ตรงแล้ว (ไฟล์ไม่ถูกแก้ไข)']],
  ['没有需要修改的记录',
    ['沒有需要修改的記錄', 'No records need changes', '変更が必要な記録はありません', '수정할 기록이 없습니다',
      'Записей, требующих изменений, нет', 'Keine Einträge zu ändern', 'Aucun enregistrement à modifier',
      'No hay registros que cambiar', 'Nenhum registro a alterar', 'Nessun record da modificare',
      'Brak rekordów do zmiany', 'Değiştirilecek kayıt yok', 'ไม่มีรายการที่ต้องแก้ไข']],
  ['所有记录都指向当前游戏目录（无需修复）',
    ['所有記錄都指向目前遊戲目錄（無需修復）',
      'All records already point to the current game folder (nothing to fix)',
      'すべての記録が現在のゲームフォルダを指しています（修復不要）',
      '모든 기록이 현재 게임 폴더를 가리킵니다(수정 불필요)',
      'Все записи уже указывают на текущую папку игры (исправлять нечего)',
      'Alle Einträge zeigen bereits auf den aktuellen Spielordner (nichts zu reparieren)',
      'Tous les enregistrements pointent déjà vers le dossier actuel (rien à corriger)',
      'Todos los registros ya apuntan a la carpeta actual (nada que corregir)',
      'Todos os registros já apontam para a pasta atual (nada a corrigir)',
      'Tutti i record puntano già alla cartella attuale (niente da correggere)',
      'Wszystkie rekordy wskazują już bieżący folder gry (nic do naprawy)',
      'Tüm kayıtlar zaten geçerli oyun klasörünü gösteriyor (onarılacak bir şey yok)',
      'ทุกรายการชี้ไปที่โฟลเดอร์เกมปัจจุบันแล้ว (ไม่ต้องแก้ไข)']],
  ['还没有安装记录',
    ['還沒有安裝記錄', 'No install records yet', 'インストール記録がまだありません',
      '설치 기록이 아직 없습니다', 'Записей об установке пока нет', 'Noch keine Installationsprotokolle',
      'Aucun enregistrement d’installation', 'Aún no hay registros de instalación',
      'Ainda sem registros de instalação', 'Nessun record di installazione',
      'Brak rekordów instalacji', 'Henüz kurulum kaydı yok', 'ยังไม่มีบันทึกการติดตั้ง']],
  ['已写入游戏目录：%s 条',
    ['已寫入遊戲目錄：%s 條', 'Written to the game folder: %s', 'ゲームフォルダに書き込みました：%s 件',
      '게임 폴더에 기록했습니다: %s개', 'Записано в папку игры: %s',
      'In den Spielordner geschrieben: %s', 'Écrit dans le dossier du jeu : %s',
      'Escrito en la carpeta del juego: %s', 'Gravado na pasta do jogo: %s',
      'Scritto nella cartella del gioco: %s', 'Zapisano w folderze gry: %s',
      'Oyun klasörüne yazıldı: %s', 'เขียนลงโฟลเดอร์เกมแล้ว: %s รายการ']],
  ['账本里没有新记录',
    ['帳本裡沒有新記錄', 'No new records in the ledger', '台帳に新しい記録はありません',
      '원장에 새 기록이 없습니다', 'В реестре нет новых записей', 'Keine neuen Einträge im Register',
      'Aucun nouvel enregistrement dans le registre', 'No hay registros nuevos en el registro',
      'Nenhum registro novo no registro', 'Nessun nuovo record nel registro',
      'W rejestrze nie ma nowych rekordów', 'Kayıtta yeni kayıt yok', 'ไม่มีรายการใหม่ในบันทึก']],
  ['账本已跟随新目录：',
    ['帳本已跟隨新目錄：', 'The ledger followed to the new folder: ',
      '台帳は新しいフォルダに追従しました：', '원장이 새 폴더를 따라갔습니다: ',
      'Реестр переехал в новую папку: ', 'Register folgt dem neuen Ordner: ',
      'Le registre a suivi le nouveau dossier : ', 'El registro siguió a la nueva carpeta: ',
      'O registro acompanhou a nova pasta: ', 'Il registro ha seguito la nuova cartella: ',
      'Rejestr przeniósł się do nowego folderu: ', 'Kayıt yeni klasöre taşındı: ',
      'บันทึกตามไปยังโฟลเดอร์ใหม่แล้ว: ']],

  /* ⑯ 数据跟着游戏走（0.3.4）：设置页显示数据文件到底落在哪 */
  ['游戏目录（跟着游戏走）：',
    ['遊戲目錄（跟著遊戲走）：', 'Game folder (travels with the game): ',
      'ゲームフォルダ（ゲームと一緒に移動）：', '게임 폴더(게임과 함께 이동): ',
      'Папка игры (перемещается вместе с игрой): ', 'Spielordner (wandert mit dem Spiel mit): ',
      "Dossier du jeu (suit le jeu) : ", 'Carpeta del juego (viaja con el juego): ',
      'Pasta do jogo (acompanha o jogo): ', 'Cartella del gioco (segue il gioco): ',
      'Folder gry (wędruje razem z grą): ', 'Oyun klasörü (oyunla birlikte taşınır): ',
      'โฟลเดอร์เกม (ไปกับเกม): ']],
  ['暂存在管理器目录，下次启动会切换到游戏目录：',
    ['暫存在管理器目錄，下次啟動會切換到遊戲目錄：',
      'Temporarily in the manager data folder; switches to the game folder on next start: ',
      '一時的にマネージャーのデータフォルダに保存中。次回起動時にゲームフォルダへ切り替わります：',
      '현재 관리자 데이터 폴더에 임시 저장 중이며, 다음 시작 시 게임 폴더로 전환됩니다: ',
      'Временно в папке данных менеджера; при следующем запуске переключится на папку игры: ',
      'Vorläufig im Datenordner des Managers; beim nächsten Start wird in den Spielordner gewechselt: ',
      "Stocké temporairement dans le dossier de données du gestionnaire ; basculera vers le dossier du jeu au prochain démarrage : ",
      'Guardado temporalmente en la carpeta de datos del gestor; cambiará a la carpeta del juego en el próximo inicio: ',
      'Guardado temporariamente na pasta de dados do gerenciador; mudará para a pasta do jogo na próxima inicialização: ',
      'Salvato temporaneamente nella cartella dati del gestore; al prossimo avvio passerà alla cartella del gioco: ',
      'Tymczasowo w folderze danych menedżera; przy następnym uruchomieniu przełączy się na folder gry: ',
      'Geçici olarak yönetici veri klasöründe; sonraki başlatmada oyun klasörüne geçecek: ',
      'เก็บชั่วคราวในโฟลเดอร์ข้อมูลของผู้จัดการ จะสลับไปยังโฟลเดอร์เกมเมื่อเริ่มครั้งถัดไป: ']],
  ['配置与账本跟着游戏走，存在游戏根目录的 .sbmod 里；图片与下载缓存体积大，留在管理器自己的数据目录。第一次识别到游戏目录时会立刻把当前数据写进去，之后每次改动都会同步。',
    ['設定與帳本跟著遊戲走，存在遊戲根目錄的 .sbmod 裡；圖片與下載快取體積大，留在管理器自己的資料目錄。第一次辨識到遊戲目錄時會立刻把目前資料寫進去，之後每次變更都會同步。',
      'Config and records travel with the game and live in .sbmod in the game root; image and download caches are large, so they stay in the manager own data folder. The first time a game folder is recognized the current data is written there at once and kept in sync afterwards.',
      '設定と記録はゲームと一緒に移動し、ゲームのルートにある .sbmod に保存されます。画像とダウンロードのキャッシュはサイズが大きいため、マネージャー側のデータフォルダに残します。ゲームフォルダを初めて認識したときに現在のデータを書き込み、以後は変更のたびに同期します。',
      '설정과 기록은 게임과 함께 이동하며 게임 루트의 .sbmod에 저장됩니다. 이미지와 다운로드 캐시는 용량이 커서 관리자 자체 데이터 폴더에 남겨 둡니다. 게임 폴더를 처음 인식하면 현재 데이터를 즉시 기록하고 이후 변경될 때마다 동기화합니다.',
      'Настройки и учётные данные перемещаются вместе с игрой и хранятся в .sbmod в корне игры; кэш изображений и загрузок большой, поэтому остаётся в папке данных менеджера. При первом обнаружении папки игры текущие данные сразу записываются туда и далее синхронизируются.',
      'Konfiguration und Aufzeichnungen wandern mit dem Spiel mit und liegen in .sbmod im Spielstammverzeichnis; Bild- und Download-Caches sind groß und bleiben im Datenordner des Managers. Beim ersten Erkennen eines Spielordners werden die aktuellen Daten sofort dorthin geschrieben und danach synchron gehalten.',
      "La configuration et les registres suivent le jeu et résident dans .sbmod à la racine du jeu ; les caches d'images et de téléchargements, volumineux, restent dans le dossier de données du gestionnaire. À la première détection d'un dossier de jeu, les données actuelles y sont écrites puis synchronisées.",
      'La configuración y los registros viajan con el juego y se guardan en .sbmod en la raíz del juego; las cachés de imágenes y descargas son grandes y se quedan en la carpeta de datos del gestor. La primera vez que se detecta una carpeta de juego se escriben allí los datos actuales y luego se mantienen sincronizados.',
      'A configuração e os registros acompanham o jogo e ficam em .sbmod na raiz do jogo; os caches de imagens e downloads são grandes e permanecem na pasta de dados do gerenciador. Na primeira vez que uma pasta de jogo é reconhecida, os dados atuais são gravados nela e depois mantidos em sincronia.',
      'Configurazione e registri seguono il gioco e risiedono in .sbmod nella radice del gioco; le cache di immagini e download sono grandi e restano nella cartella dati del gestore. Al primo riconoscimento di una cartella di gioco i dati correnti vengono scritti lì e poi mantenuti sincronizzati.',
      'Konfiguracja i rejestry wędrują razem z grą i są przechowywane w .sbmod w katalogu głównym gry; pamięć podręczna obrazów i pobrań jest duża i pozostaje w folderze danych menedżera. Przy pierwszym rozpoznaniu folderu gry bieżące dane są od razu tam zapisywane i następnie synchronizowane.',
      'Yapılandırma ve kayıtlar oyunla birlikte taşınır ve oyun kökündeki .sbmod içinde tutulur; görsel ve indirme önbellekleri büyük olduğu için yöneticinin kendi veri klasöründe kalır. Bir oyun klasörü ilk kez tanındığında mevcut veriler hemen oraya yazılır ve sonrasında eşitlenir.',
      'การตั้งค่าและบันทึกจะไปกับเกมและเก็บไว้ใน .sbmod ที่รากของเกม ส่วนแคชรูปภาพและไฟล์ดาวน์โหลดมีขนาดใหญ่จึงเก็บไว้ในโฟลเดอร์ข้อมูลของผู้จัดการ เมื่อตรวจพบโฟลเดอร์เกมครั้งแรก ข้อมูลปัจจุบันจะถูกเขียนลงไปทันทีและซิงก์ต่อไป']],
  // ── 0.3.5：已安装页「多选 / 全选 / 筛选 / 批量启停删除」────────────────────────
  // 用户 2026-11-07：「已安装的mod也要支持全选多选筛选等功能，与查看在线mod一致」。
  // ⚠️ 带数字的一律登记成形状键：批量按钮上挂的是勾选数（`批量启用（12）`，即便 0 也带括号），
  //    副标题里还有两个数字（显示的卡片数 + 筛选前的总数），片段拼不出这两种语序。
  ['已关闭', ['已關閉', 'Disabled', '無効', '사용 안 함', 'Отключено', 'Deaktiviert', 'Désactivé', 'Desactivado', 'Desativado', 'Disattivato', 'Wyłączone', 'Kapalı', 'ปิดใช้งาน']],
  ['全部类型', ['全部類型', 'All types', 'すべての種類', '모든 유형', 'Все типы', 'Alle Typen', 'Tous les types', 'Todos los tipos', 'Todos os tipos', 'Tutti i tipi', 'Wszystkie typy', 'Tüm türler', 'ทุกประเภท']],
  ['搜索已安装的 Mod（名字 / Mod ID / 作者）', ['搜尋已安裝的 Mod（名稱 / Mod ID / 作者）', 'Search installed mods (name / Mod ID / author)', 'インストール済み Mod を検索（名前 / Mod ID / 作者）', '설치된 Mod 검색(이름 / Mod ID / 작성자)', 'Поиск установленных модов (название / Mod ID / автор)', 'Installierte Mods durchsuchen (Name / Mod ID / Autor)', "Rechercher les mods installés (nom / Mod ID / auteur)", 'Buscar mods instalados (nombre / Mod ID / autor)', 'Pesquisar mods instalados (nome / Mod ID / autor)', 'Cerca mod installati (nome / Mod ID / autore)', 'Szukaj zainstalowanych modów (nazwa / Mod ID / autor)', 'Yüklü modlarda ara (ad / Mod ID / yazar)', 'ค้นหา Mod ที่ติดตั้งแล้ว (ชื่อ / Mod ID / ผู้สร้าง)']],
  ['按类型筛选', ['依類型篩選', 'Filter by type', '種類で絞り込む', '유형별 필터', 'Фильтр по типу', 'Nach Typ filtern', 'Filtrer par type', 'Filtrar por tipo', 'Filtrar por tipo', 'Filtra per tipo', 'Filtruj według typu', 'Türe göre filtrele', 'กรองตามประเภท']],
  ['批量启用（%s）', ['批次啟用（%s）', 'Enable selected (%s)', 'まとめて有効化（%s）', '일괄 사용 (%s)', 'Включить выбранные (%s)', 'Ausgewählte aktivieren (%s)', 'Activer la sélection (%s)', 'Activar seleccionados (%s)', 'Ativar selecionados (%s)', 'Attiva selezionati (%s)', 'Włącz wybrane (%s)', 'Seçilenleri etkinleştir (%s)', 'เปิดใช้งานที่เลือก (%s)']],
  ['批量关闭（%s）', ['批次關閉（%s）', 'Disable selected (%s)', 'まとめて無効化（%s）', '일괄 해제 (%s)', 'Отключить выбранные (%s)', 'Ausgewählte deaktivieren (%s)', 'Désactiver la sélection (%s)', 'Desactivar seleccionados (%s)', 'Desativar selecionados (%s)', 'Disattiva selezionati (%s)', 'Wyłącz wybrane (%s)', 'Seçilenleri kapat (%s)', 'ปิดใช้งานที่เลือก (%s)']],
  ['批量删除（%s）', ['批次刪除（%s）', 'Delete selected (%s)', 'まとめて削除（%s）', '일괄 삭제 (%s)', 'Удалить выбранные (%s)', 'Ausgewählte löschen (%s)', 'Supprimer la sélection (%s)', 'Eliminar seleccionados (%s)', 'Excluir selecionados (%s)', 'Elimina selezionati (%s)', 'Usuń wybrane (%s)', 'Seçilenleri sil (%s)', 'ลบที่เลือก (%s)']],
  ['没有符合筛选条件的 Mod', ['沒有符合篩選條件的 Mod', 'No mods match the filter', '条件に合う Mod がありません', '필터에 맞는 Mod가 없습니다', 'Нет модов, подходящих под фильтр', 'Keine Mods entsprechen dem Filter', 'Aucun mod ne correspond au filtre', 'Ningún mod coincide con el filtro', 'Nenhum mod corresponde ao filtro', 'Nessun mod corrisponde al filtro', 'Żaden mod nie pasuje do filtra', 'Filtre uyan mod yok', 'ไม่มี Mod ที่ตรงกับตัวกรอง']],
  ['换个关键词，或者把筛选清掉看看。', ['換個關鍵字，或者把篩選清掉看看。', 'Try a different keyword, or clear the filter.', '別のキーワードを試すか、フィルターを解除してみてください。', '다른 검색어를 입력하거나 필터를 지워 보세요.', 'Попробуйте другое слово или сбросьте фильтр.', 'Anderes Stichwort versuchen oder den Filter zurücksetzen.', "Essayez un autre mot-clé ou effacez le filtre.", 'Prueba otra palabra clave o borra el filtro.', 'Tente outra palavra-chave ou limpe o filtro.', "Prova un'altra parola chiave o azzera il filtro.", 'Spróbuj innego słowa lub wyczyść filtr.', 'Başka bir anahtar kelime deneyin veya filtreyi temizleyin.', 'ลองคำค้นอื่น หรือล้างตัวกรอง']],
  ['清空筛选', ['清空篩選', 'Clear filter', 'フィルター解除', '필터 지우기', 'Сбросить фильтр', 'Filter zurücksetzen', 'Effacer le filtre', 'Borrar filtro', 'Limpar filtro', 'Azzera filtro', 'Wyczyść filtr', 'Filtreyi temizle', 'ล้างตัวกรอง']],
  ['共 %s 项 · 筛选自 %s 项', ['共 %s 項 · 篩選自 %s 項', '%s items · filtered from %s', '%s 件 · %s 件から絞り込み', '%s개 · %s개에서 필터됨', '%s шт. · отобрано из %s', '%s Einträge · aus %s gefiltert', '%s éléments · filtrés parmi %s', '%s elementos · filtrados de %s', '%s itens · filtrados de %s', '%s elementi · filtrati da %s', '%s pozycji · z %s', '%s öğe · %s içinden filtrelendi', '%s รายการ · กรองจาก %s']],
  ['共 %s 项 · %s 个已启用（筛选自 %s 项）', ['共 %s 項 · %s 個已啟用（篩選自 %s 項）', '%s items · %s enabled (filtered from %s)', '%s 件 · %s 件有効（%s 件から絞り込み）', '%s개 · %s개 사용 중(%s개에서 필터됨)', '%s шт. · включено %s (из %s)', '%s Einträge · %s aktiv (aus %s gefiltert)', '%s éléments · %s activés (filtrés parmi %s)', '%s elementos · %s habilitados (filtrados de %s)', '%s itens · %s ativos (filtrados de %s)', '%s elementi · %s attivi (filtrati da %s)', '%s pozycji · %s włączonych (z %s)', '%s öğe · %s etkin (%s içinden)', '%s รายการ · เปิดใช้งาน %s (กรองจาก %s)']],
  ['先勾选要处理的 Mod', ['先勾選要處理的 Mod', 'Select the mods to work on first', '先に処理する Mod を選んでください', '먼저 처리할 Mod를 선택하세요', 'Сначала отметьте нужные моды', 'Zuerst die Mods auswählen', "Sélectionnez d'abord les mods", 'Selecciona primero los mods', 'Selecione primeiro os mods', 'Seleziona prima i mod', 'Najpierw zaznacz mody', 'Önce işlem yapılacak modları seçin', 'เลือก Mod ที่จะจัดการก่อน']],
  ['内置组件不能卸载，请取消勾选后再试', ['內建元件不能卸載，請取消勾選後再試', "Built-in components can't be removed — uncheck them and try again", '内蔵コンポーネントは削除できません。選択を外してください', '내장 구성 요소는 제거할 수 없습니다. 선택을 해제하세요', 'Встроенные компоненты удалить нельзя — снимите отметку', 'Integrierte Komponenten können nicht entfernt werden — Auswahl aufheben', 'Les composants intégrés ne peuvent pas être supprimés — décochez-les', 'Los componentes integrados no se pueden quitar — desmárcalos', 'Componentes integrados não podem ser removidos — desmarque-os', 'I componenti integrati non possono essere rimossi — deselezionali', 'Komponentów wbudowanych nie można usunąć — odznacz je', 'Yerleşik bileşenler kaldırılamaz — seçimi kaldırın', 'ไม่สามารถลบองค์ประกอบในตัวได้ — ยกเลิกการเลือกแล้วลองใหม่']],
  ['已启用 %s 个 Mod', ['已啟用 %s 個 Mod', 'Enabled %s mods', '%s 個の Mod を有効化しました', 'Mod %s개를 사용하도록 설정했습니다', 'Включено модов: %s', '%s Mods aktiviert', '%s mods activés', '%s mods activados', '%s mods ativados', '%s mod attivati', 'Włączono mody: %s', '%s mod etkinleştirildi', 'เปิดใช้งาน %s Mod แล้ว']],
  ['已关闭 %s 个 Mod', ['已關閉 %s 個 Mod', 'Disabled %s mods', '%s 個の Mod を無効化しました', 'Mod %s개를 사용 안 함으로 설정했습니다', 'Отключено модов: %s', '%s Mods deaktiviert', '%s mods désactivés', '%s mods desactivados', '%s mods desativados', '%s mod disattivati', 'Wyłączono mody: %s', '%s mod kapatıldı', 'ปิดใช้งาน %s Mod แล้ว']],
  ['有 %s 个文件没能改过来', ['有 %s 個檔案沒能改過來', "%s files couldn't be changed", '%s 個のファイルを変更できませんでした', '파일 %s개를 변경하지 못했습니다', 'Не удалось изменить файлов: %s', '%s Dateien konnten nicht geändert werden', "%s fichiers n'ont pas pu être modifiés", 'No se pudieron cambiar %s archivos', 'Não foi possível alterar %s arquivos', 'Impossibile modificare %s file', 'Nie udało się zmienić plików: %s', '%s dosya değiştirilemedi', 'เปลี่ยนไฟล์ %s ไฟล์ไม่ได้']],
  ['已删除 %s 个 Mod', ['已刪除 %s 個 Mod', 'Deleted %s mods', '%s 個の Mod を削除しました', 'Mod %s개를 삭제했습니다', 'Удалено модов: %s', '%s Mods gelöscht', '%s mods supprimés', '%s mods eliminados', '%s mods excluídos', '%s mod eliminati', 'Usunięto mody: %s', '%s mod silindi', 'ลบ %s Mod แล้ว']],
  ['有 %s 个文件没能删掉', ['有 %s 個檔案沒能刪掉', "%s files couldn't be deleted", '%s 個のファイルを削除できませんでした', '파일 %s개를 삭제하지 못했습니다', 'Не удалось удалить файлов: %s', '%s Dateien konnten nicht gelöscht werden', "%s fichiers n'ont pas pu être supprimés", 'No se pudieron eliminar %s archivos', 'Não foi possível excluir %s arquivos', 'Impossibile eliminare %s file', 'Nie udało się usunąć plików: %s', '%s dosya silinemedi', 'ลบไฟล์ %s ไฟล์ไม่ได้']],

  // ── 0.3.6 · 账本与磁盘一致性 + 已下载未安装（2026-11-07）───────────────────
  // 用户要求：「如果用户自己手动删除了 mod 文件，要在启动后验证配置信息和实际的
  // mod 文件的一致性」「已下载的 mod 没有安装的要在下载页面里面显示出来」。
  ['按磁盘核对：移除 %s 条、裁剪 %s 条、纠正开关 %s 条', ['按磁碟核對：移除 %s 條、裁剪 %s 條、糾正開關 %s 條', 'Checked against disk: removed %s, trimmed %s, corrected %s toggles', 'ディスクと照合：%s 件を削除、%s 件を整理、%s 件のスイッチを修正', '디스크와 대조: %s개 제거, %s개 정리, %s개 스위치 수정', 'Сверка с диском: удалено %s, сокращено %s, исправлено переключателей %s', 'Mit Datenträger abgeglichen: %s entfernt, %s gekürzt, %s Schalter korrigiert', 'Vérification disque : %s supprimés, %s tronqués, %s interrupteurs corrigés', 'Comprobado con el disco: %s eliminados, %s recortados, %s interruptores corregidos', 'Verificado no disco: %s removidos, %s cortados, %s interruptores corrigidos', 'Verificato sul disco: %s rimossi, %s ridotti, %s interruttori corretti', 'Sprawdzono z dyskiem: usunięto %s, przycięto %s, poprawiono przełączników %s', 'Disk ile karşılaştırıldı: %s kaldırıldı, %s kırpıldı, %s anahtar düzeltildi', 'ตรวจเทียบกับดิสก์: ลบ %s รายการ ตัด %s รายการ แก้สวิตช์ %s รายการ']],
  ['账本与磁盘一致（%s 条）', ['帳本與磁碟一致（%s 條）', 'Ledger matches the disk (%s entries)', '台帳とディスクは一致しています（%s 件）', '장부와 디스크가 일치합니다(%s개)', 'Учёт совпадает с диском (записей: %s)', 'Bestand stimmt mit dem Datenträger überein (%s Einträge)', 'Le registre correspond au disque (%s entrées)', 'El registro coincide con el disco (%s entradas)', 'O registro confere com o disco (%s entradas)', 'Il registro corrisponde al disco (%s voci)', 'Rejestr zgadza się z dyskiem (%s wpisów)', 'Kayıtlar disk ile uyumlu (%s kayıt)', 'บันทึกตรงกับดิสก์ (%s รายการ)']],
  ['核对磁盘', ['核對磁碟', 'Check disk', 'ディスクと照合', '디스크 대조', 'Сверить с диском', 'Datenträger prüfen', 'Vérifier le disque', 'Comprobar disco', 'Verificar disco', 'Verifica disco', 'Sprawdź dysk', 'Diski denetle', 'ตรวจสอบดิสก์']],
  ['拿磁盘的实际文件比一遍：手动删掉的 mod 会从已安装列表里退场，直接改过扩展名的会按磁盘纠正开关', ['拿磁碟上的實際檔案比一遍：手動刪掉的 mod 會從已安裝列表裡退場，直接改過副檔名的會按磁碟糾正開關', 'Compares against the real files on disk: mods you deleted by hand drop out of the installed list, and renames done outside the manager get their toggle corrected', 'ディスク上の実ファイルと比較します：手で消した mod はインストール済み一覧から外れ、拡張子を直接変えたものはスイッチが修正されます', '디스크의 실제 파일과 비교합니다: 직접 삭제한 mod는 설치 목록에서 빠지고, 확장자를 직접 바꾼 것은 스위치가 수정됩니다', 'Сверяет с реальными файлами на диске: удалённые вручную моды исчезают из списка, а переименованные вручную получают исправленный переключатель', 'Vergleicht mit den echten Dateien auf dem Datenträger: manuell gelöschte Mods verschwinden aus der Liste, manuell umbenannte bekommen den Schalter korrigiert', "Compare avec les fichiers réels du disque : les mods supprimés à la main quittent la liste, et les renommages manuels corrigent l'interrupteur", 'Compara con los archivos reales del disco: los mods que borraste a mano salen de la lista y los renombrados a mano ven corregido su interruptor', 'Compara com os arquivos reais do disco: mods apagados à mão saem da lista e os renomeados à mão têm o interruptor corrigido', "Confronta con i file reali sul disco: i mod cancellati a mano escono dall'elenco e quelli rinominati a mano hanno l'interruttore corretto", 'Porównuje z rzeczywistymi plikami na dysku: ręcznie usunięte mody znikają z listy, a ręcznie zmienione nazwy powodują korektę przełącznika', 'Disk üzerindeki gerçek dosyalarla karşılaştırır: elle sildiğiniz modlar listeden çıkar, elle yeniden adlandırılanların anahtarı düzeltilir', 'เทียบกับไฟล์จริงบนดิสก์: mod ที่คุณลบเองจะหายจากรายการ และไฟล์ที่เปลี่ยนชื่อเองจะถูกแก้สวิตช์ให้ตรง']],
  ['启动时会自动核对一次：账本里记着、但游戏目录里文件已经不在的 Mod 会自动移除（不会删你别的文件）。', ['啟動時會自動核對一次：帳本裡記著、但遊戲目錄裡檔案已經不在的 Mod 會自動移除（不會刪你別的檔案）。', 'This runs once at startup: mods still in the ledger whose files are gone from the game folder are removed automatically (nothing else on your disk is touched).', '起動時に一度自動で照合します：台帳に残っていてもゲームフォルダにファイルが無い Mod は自動で削除されます（他のファイルは消しません）。', '시작할 때 한 번 자동으로 대조합니다: 장부에 남아 있어도 게임 폴더에 파일이 없는 mod는 자동으로 제거됩니다(다른 파일은 건드리지 않습니다).', 'Проверка выполняется при запуске: моды, которые есть в учёте, но чьих файлов нет в папке игры, удаляются автоматически (остальные файлы не трогаются).', 'Läuft einmal beim Start: Mods, die im Bestand stehen, deren Dateien aber im Spielordner fehlen, werden automatisch entfernt (andere Dateien bleiben unangetastet).', "Exécuté une fois au démarrage : les mods présents au registre dont les fichiers ont disparu du dossier du jeu sont retirés automatiquement (rien d'autre n'est touché).", 'Se ejecuta una vez al arrancar: los mods que siguen en el registro pero cuyos archivos ya no están en la carpeta del juego se eliminan automáticamente (no se toca nada más).', 'Roda uma vez na inicialização: mods que estão no registro mas cujos arquivos sumiram da pasta do jogo são removidos automaticamente (nada mais é tocado).', "Viene eseguito una volta all'avvio: i mod presenti nel registro i cui file non sono più nella cartella del gioco vengono rimossi automaticamente (nient'altro viene toccato).", 'Uruchamiane raz przy starcie: mody obecne w rejestrze, których plików nie ma już w folderze gry, są automatycznie usuwane (nic innego nie jest ruszane).', 'Açılışta bir kez çalışır: kayıtta duran ama dosyaları oyun klasöründe bulunmayan modlar otomatik kaldırılır (başka hiçbir şeye dokunulmaz).', 'ทำงานอัตโนมัติครั้งเดียวตอนเปิดโปรแกรม: mod ที่ยังอยู่ในบันทึกแต่ไฟล์หายไปจากโฟลเดอร์เกมจะถูกนำออกให้ (ไม่แตะไฟล์อื่นของคุณ)']],
  ['待安装', ['待安裝', 'To install', '未インストール', '설치 대기', 'К установке', 'Zu installieren', 'À installer', 'Por instalar', 'A instalar', 'Da installare', 'Do zainstalowania', 'Kurulacak', 'รอติดตั้ง']],
  ['⬇ 全部安装（%s）', ['⬇ 全部安裝（%s）', '⬇ Install all (%s)', '⬇ すべてインストール（%s）', '⬇ 모두 설치(%s)', '⬇ Установить все (%s)', '⬇ Alle installieren (%s)', '⬇ Tout installer (%s)', '⬇ Instalar todo (%s)', '⬇ Instalar tudo (%s)', '⬇ Installa tutto (%s)', '⬇ Zainstaluj wszystkie (%s)', '⬇ Tümünü kur (%s)', '⬇ ติดตั้งทั้งหมด (%s)']],
  ['⬇ 全部安装', ['⬇ 全部安裝', '⬇ Install all', '⬇ すべてインストール', '⬇ 모두 설치', '⬇ Установить все', '⬇ Alle installieren', '⬇ Tout installer', '⬇ Instalar todo', '⬇ Instalar tudo', '⬇ Installa tutto', '⬇ Zainstaluj wszystkie', '⬇ Tümünü kur', '⬇ ติดตั้งทั้งหมด']],
  ['安装包都在管理器目录里，逐个装进当前游戏目录（换过游戏目录也可以用）', ['安裝包都在管理器目錄裡，逐個裝進目前遊戲目錄（換過遊戲目錄也可以用）', "The archives all live in the manager's own folder — install them one by one into the current game folder (works after switching game folders too)", 'インストール元はすべてマネージャーのフォルダにあります — 現在のゲームフォルダへ順にインストールします（ゲームフォルダを変えた後でも使えます）', '설치 파일은 모두 관리자 폴더에 있습니다 — 현재 게임 폴더에 하나씩 설치합니다(게임 폴더를 바꾼 뒤에도 사용 가능)', 'Архивы лежат в папке менеджера — устанавливаются по одному в текущую папку игры (работает и после смены папки игры)', 'Die Archive liegen im Ordner des Managers — sie werden einzeln in den aktuellen Spielordner installiert (auch nach einem Ordnerwechsel)', 'Les archives sont dans le dossier du gestionnaire — installation une par une dans le dossier de jeu actuel (fonctionne après un changement de dossier)', 'Los archivos están en la carpeta del gestor: se instalan uno a uno en la carpeta actual del juego (también tras cambiar de carpeta)', 'Os arquivos ficam na pasta do gerenciador — são instalados um a um na pasta atual do jogo (funciona após trocar de pasta)', 'Gli archivi sono nella cartella del gestore: vengono installati uno alla volta nella cartella di gioco corrente (funziona anche dopo aver cambiato cartella)', 'Archiwa są w folderze menedżera — instalowane po kolei do bieżącego folderu gry (działa też po zmianie folderu)', 'Arşivler yöneticinin klasöründe — geçerli oyun klasörüne tek tek kurulur (oyun klasörünü değiştirdikten sonra da çalışır)', 'ไฟล์ติดตั้งอยู่ในโฟลเดอร์ของผู้จัดการ — ติดตั้งทีละรายการลงโฟลเดอร์เกมปัจจุบัน (ใช้ได้แม้เปลี่ยนโฟลเดอร์เกมแล้ว)']],
  ['有 %s 个 Mod 已经下载好了（安装包存在管理器目录里），但还没设置游戏目录 —— 设置好之后回到这一页就能直接装进去。', ['有 %s 個 Mod 已經下載好了（安裝包存在管理器目錄裡），但還沒設定遊戲目錄 —— 設定好之後回到這一頁就能直接裝進去。', "%s mods are downloaded and waiting (the archives live in the manager's folder), but no game folder is set yet — set one and come back to this page to install them.", '%s 個の Mod はダウンロード済みです（インストール元はマネージャーのフォルダ）。まだゲームフォルダが未設定なので、設定後にこのページへ戻ればそのままインストールできます。', 'Mod %s개가 이미 다운로드되어 있습니다(설치 파일은 관리자 폴더에 있음). 아직 게임 폴더가 설정되지 않았으니, 설정한 뒤 이 페이지로 돌아오면 바로 설치할 수 있습니다.', 'Модов скачано: %s (архивы в папке менеджера), но папка игры ещё не задана — задайте её и вернитесь на эту страницу, чтобы установить.', 'Mods heruntergeladen: %s (Archive liegen im Ordner des Managers), aber es ist noch kein Spielordner festgelegt — lege einen fest und komm zurück, um sie zu installieren.', "%s mods sont téléchargés (archives dans le dossier du gestionnaire), mais aucun dossier de jeu n'est défini — définissez-le puis revenez ici pour les installer.", 'Hay %s mods descargados (los archivos están en la carpeta del gestor), pero aún no hay carpeta de juego: configúrala y vuelve a esta página para instalarlos.', 'Há %s mods baixados (os arquivos estão na pasta do gerenciador), mas nenhuma pasta de jogo foi definida — defina uma e volte a esta página para instalá-los.', 'Ci sono %s mod scaricati (gli archivi sono nella cartella del gestore), ma nessuna cartella di gioco è impostata: impostala e torna qui per installarli.', 'Pobrano mody: %s (archiwa są w folderze menedżera), ale nie ustawiono folderu gry — ustaw go i wróć na tę stronę, aby je zainstalować.', '%s mod indirildi (arşivler yöneticinin klasöründe) ama henüz oyun klasörü ayarlanmadı — ayarlayıp bu sayfaya dönün, doğrudan kurabilirsiniz.', 'ดาวน์โหลดแล้ว %s mod (ไฟล์ติดตั้งอยู่ในโฟลเดอร์ของผู้จัดการ) แต่ยังไม่ได้ตั้งโฟลเดอร์เกม — ตั้งแล้วกลับมาที่หน้านี้เพื่อติดตั้งได้เลย']],
  ['去设置游戏目录', ['去設定遊戲目錄', 'Set game folder', 'ゲームフォルダを設定', '게임 폴더 설정', 'Указать папку игры', 'Spielordner festlegen', 'Définir le dossier de jeu', 'Configurar carpeta del juego', 'Definir pasta do jogo', 'Imposta cartella di gioco', 'Ustaw folder gry', 'Oyun klasörünü ayarla', 'ตั้งค่าโฟลเดอร์เกม']],
  ['安装中…', ['安裝中…', 'Installing…', 'インストール中…', '설치 중…', 'Установка…', 'Installation…', 'Installation…', 'Instalando…', 'Instalando…', 'Installazione…', 'Instalowanie…', 'Kuruluyor…', 'กำลังติดตั้ง…']],
  ['安装中 %s/%s…', ['安裝中 %s/%s…', 'Installing %s/%s…', 'インストール中 %s/%s…', '설치 중 %s/%s…', 'Установка %s/%s…', 'Installation %s/%s…', 'Installation %s/%s…', 'Instalando %s/%s…', 'Instalando %s/%s…', 'Installazione %s/%s…', 'Instalowanie %s/%s…', 'Kuruluyor %s/%s…', 'กำลังติดตั้ง %s/%s…']],
  ['没有待安装的任务', ['沒有待安裝的任務', 'Nothing waiting to be installed', 'インストール待ちのタスクはありません', '설치 대기 중인 작업이 없습니다', 'Нет задач, ожидающих установки', 'Keine Aufgaben zum Installieren', 'Aucune tâche à installer', 'No hay tareas pendientes de instalar', 'Nenhuma tarefa aguardando instalação', 'Nessuna attività da installare', 'Brak zadań do zainstalowania', 'Kurulmayı bekleyen görev yok', 'ไม่มีงานที่รอติดตั้ง']],
  ['已安装 %s 项', ['已安裝 %s 項', 'Installed %s items', '%s 件をインストールしました', '%s개를 설치했습니다', 'Установлено: %s', '%s installiert', '%s installés', '%s instalados', '%s instalados', '%s installati', 'Zainstalowano: %s', '%s öğe kuruldu', 'ติดตั้งแล้ว %s รายการ']],
  ['已安装 %s 项，%s 项没能装上（在列表里逐个看原因）', ['已安裝 %s 項，%s 項沒能裝上（在列表裡逐個看原因）', 'Installed %s, %s could not be installed (check each one in the list)', '%s 件をインストールしました。%s 件はインストールできませんでした（一覧で個別に理由を確認してください）', '%s개를 설치했습니다. %s개는 설치하지 못했습니다(목록에서 각각 이유를 확인하세요)', 'Установлено: %s, не удалось: %s (причина указана в списке)', '%s installiert, %s konnten nicht installiert werden (Grund in der Liste prüfen)', "%s installés, %s n'ont pas pu l'être (voir la raison dans la liste)", '%s instalados, %s no se pudieron instalar (mira el motivo en la lista)', '%s instalados, %s não puderam ser instalados (veja o motivo na lista)', "%s installati, %s non è stato possibile installarli (vedi il motivo nell'elenco)", 'Zainstalowano: %s, nie udało się: %s (sprawdź powód na liście)', '%s kuruldu, %s kurulamadı (nedenini listede görebilirsiniz)', 'ติดตั้งแล้ว %s รายการ อีก %s รายการติดตั้งไม่ได้ (ดูเหตุผลในรายการ)']],
  ['游戏里找不到这些文件了 —— 可能被手动删掉，或换过游戏目录（安装包还在，可以直接重装）', ['遊戲裡找不到這些檔案了 —— 可能被手動刪掉，或換過遊戲目錄（安裝包還在，可以直接重裝）', 'These files are no longer in the game folder — they may have been deleted by hand, or the game folder changed (the archive is still here, so you can reinstall)', 'ゲーム内にこれらのファイルが見つかりません — 手動で削除したか、ゲームフォルダが変わった可能性があります（インストール元は残っているので再インストールできます）', '게임에서 이 파일들을 찾을 수 없습니다 — 직접 삭제했거나 게임 폴더가 바뀌었을 수 있습니다(설치 파일이 남아 있어 다시 설치할 수 있습니다)', 'Этих файлов больше нет в папке игры — возможно, они удалены вручную или папка игры изменилась (архив на месте, можно переустановить)', 'Diese Dateien sind nicht mehr im Spielordner — evtl. manuell gelöscht oder der Spielordner hat sich geändert (das Archiv ist noch da, Neuinstallation möglich)', "Ces fichiers ne sont plus dans le dossier du jeu — supprimés à la main ou dossier de jeu modifié (l'archive est toujours là, réinstallation possible)", 'Estos archivos ya no están en la carpeta del juego: puede que los borraras a mano o que cambiara la carpeta (el archivo sigue aquí, puedes reinstalar)', 'Estes arquivos não estão mais na pasta do jogo — podem ter sido apagados à mão ou a pasta mudou (o arquivo continua aqui, dá para reinstalar)', "Questi file non sono più nella cartella del gioco: forse cancellati a mano o la cartella è cambiata (l'archivio c'è ancora, puoi reinstallare)", 'Tych plików nie ma już w folderze gry — mogły zostać usunięte ręcznie albo folder gry się zmienił (archiwum nadal jest, można zainstalować ponownie)', 'Bu dosyalar artık oyun klasöründe yok — elle silinmiş veya oyun klasörü değişmiş olabilir (arşiv duruyor, yeniden kurabilirsiniz)', 'ไม่พบไฟล์เหล่านี้ในเกมแล้ว — อาจถูกลบด้วยมือหรือเปลี่ยนโฟลเดอร์เกม (ไฟล์ติดตั้งยังอยู่ ติดตั้งใหม่ได้)']],
  ['游戏目录里找不到这些文件，本地也没留安装包（可以重新下载）', ['遊戲目錄裡找不到這些檔案，本機也沒留安裝包（可以重新下載）', 'These files are not in the game folder and no local archive is left (you can download again)', 'ゲームフォルダにこれらのファイルが無く、ローカルにもインストール元が残っていません（再ダウンロードできます）', '게임 폴더에 이 파일들이 없고 로컬에도 설치 파일이 없습니다(다시 다운로드할 수 있습니다)', 'В папке игры этих файлов нет, и локального архива тоже не осталось (можно скачать заново)', 'Diese Dateien fehlen im Spielordner und es liegt kein lokales Archiv mehr vor (erneut herunterladbar)', 'Ces fichiers manquent dans le dossier du jeu et aucune archive locale ne reste (téléchargement à refaire)', 'Estos archivos no están en la carpeta del juego y no queda archivo local (puedes descargarlo de nuevo)', 'Estes arquivos não estão na pasta do jogo e não há arquivo local (dá para baixar de novo)', 'Questi file non sono nella cartella del gioco e non resta alcun archivio locale (puoi riscaricarli)', 'Tych plików nie ma w folderze gry i nie ma lokalnego archiwum (można pobrać ponownie)', 'Bu dosyalar oyun klasöründe yok ve yerel arşiv de kalmamış (yeniden indirebilirsiniz)', 'ไม่พบไฟล์เหล่านี้ในโฟลเดอร์เกมและไม่มีไฟล์ติดตั้งในเครื่อง (ดาวน์โหลดใหม่ได้)']],
  ['游戏里找不到这些文件了，安装包也没留', ['遊戲裡找不到這些檔案了，安裝包也沒留', 'These files are gone from the game and no archive is left', 'ゲーム内にこれらのファイルが無く、インストール元も残っていません', '게임에서 이 파일들을 찾을 수 없고 설치 파일도 없습니다', 'В игре этих файлов нет, и архив не сохранился', 'Diese Dateien fehlen im Spiel und es liegt kein Archiv mehr vor', 'Ces fichiers ont disparu du jeu et aucune archive ne reste', 'Estos archivos ya no están en el juego y no queda archivo', 'Estes arquivos sumiram do jogo e não há arquivo local', 'Questi file non ci sono più nel gioco e non resta alcun archivio', 'Tych plików nie ma w grze i nie ma archiwum', 'Bu dosyalar oyunda yok ve arşiv de kalmamış', 'ไม่พบไฟล์เหล่านี้ในเกมและไม่มีไฟล์ติดตั้งเหลืออยู่']],

  // ── 0.3.7 · 管理器自带安装包（data/library）——「下好了没装」的另一份来源 ─────────
  // 用户 2026-11-07：「以上这部分功能没看到」。原因：他清过下载队列（0 项），
  // 而下载页在「队列空」时直接早退画空态，把「待安装」整块吞了；包其实一直在 data/library。
  ['装进游戏', ['裝進遊戲', 'Install', 'ゲームに導入', '게임에 설치', 'Установить', 'Installieren', 'Installer', 'Instalar', 'Instalar', 'Installa', 'Zainstaluj', 'Kur', 'ติดตั้ง']],
  ['把这份安装包装进当前游戏目录', ['把這份安裝包裝進目前遊戲目錄', 'Install this package into the current game folder', 'このパッケージを現在のゲームフォルダに導入します', '이 패키지를 현재 게임 폴더에 설치합니다', 'Установить этот архив в текущую папку игры', 'Dieses Paket in den aktuellen Spielordner installieren', 'Installer cette archive dans le dossier de jeu actuel', 'Instalar este paquete en la carpeta actual del juego', 'Instalar este pacote na pasta atual do jogo', 'Installa questo pacchetto nella cartella di gioco corrente', 'Zainstaluj to archiwum w bieżącym folderze gry', 'Bu paketi geçerli oyun klasörüne kur', 'ติดตั้งแพ็กเกจนี้ลงโฟลเดอร์เกมปัจจุบัน']],
  ['已加入安装队列', ['已加入安裝佇列', 'Added to the install queue', 'インストール待ちに追加しました', '설치 대기열에 추가했습니다', 'Добавлено в очередь установки', 'Zur Installationswarteschlange hinzugefügt', "Ajouté à la file d'installation", 'Añadido a la cola de instalación', 'Adicionado à fila de instalação', 'Aggiunto alla coda di installazione', 'Dodano do kolejki instalacji', 'Kurulum kuyruğuna eklendi', 'เพิ่มเข้าคิวติดตั้งแล้ว']],
  ['可本地装 %s', ['可本機安裝 %s', 'Installable %s', 'ローカル導入可 %s', '로컬 설치 가능 %s', 'Можно установить %s', 'Lokal installierbar %s', 'Installables %s', 'Instalables %s', 'Instaláveis %s', 'Installabili %s', 'Do instalacji %s', 'Yerelden kurulabilir %s', 'ติดตั้งจากเครื่องได้ %s']],
  ['全部装进去（%s）', ['全部裝進去（%s）', 'Install all (%s)', 'すべて導入（%s）', '모두 설치(%s)', 'Установить все (%s)', 'Alle installieren (%s)', 'Tout installer (%s)', 'Instalar todo (%s)', 'Instalar tudo (%s)', 'Installa tutto (%s)', 'Zainstaluj wszystko (%s)', 'Tümünü kur (%s)', 'ติดตั้งทั้งหมด (%s)']],
  ['还有 %s 个没列出来（装完上面这些再看）', ['還有 %s 個沒列出來（裝完上面這些再看）', '%s more not listed (install the ones above first)', 'まだ %s 件あります（上を導入してから確認してください）', '%s개가 더 있습니다(위 항목을 먼저 설치하세요)', 'Ещё %s не показано (сначала установите перечисленные)', '%s weitere nicht gelistet (erst die oberen installieren)', "%s de plus non listés (installez d'abord ceux du dessus)", '%s más sin listar (instala primero los de arriba)', '%s a mais não listados (instale os acima primeiro)', 'Altri %s non elencati (installa prima quelli sopra)', '%s więcej nie pokazano (najpierw zainstaluj powyższe)', '%s tane daha listelenmedi (önce yukarıdakileri kurun)', 'ยังมีอีก %s รายการที่ไม่ได้แสดง (ติดตั้งรายการด้านบนก่อน)']],
  ['正在安装中，稍等…', ['正在安裝中，請稍候…', 'Installing now, please wait…', 'インストール中です。しばらくお待ちください…', '설치 중입니다. 잠시만 기다려 주세요…', 'Идёт установка, подождите…', 'Installation läuft, bitte warten…', 'Installation en cours, patientez…', 'Instalando, espera…', 'Instalando, aguarde…', 'Installazione in corso, attendi…', 'Trwa instalacja, czekaj…', 'Kurulum sürüyor, bekleyin…', 'กำลังติดตั้ง โปรดรอ…']],
  ['已开始安装 %s 个包', ['已開始安裝 %s 個套件', 'Started installing %s packages', '%s 件の導入を開始しました', '%s개 패키지 설치를 시작했습니다', 'Начата установка %s архивов', 'Installation von %s Paketen gestartet', 'Installation de %s archives lancée', 'Instalación de %s paquetes iniciada', 'Instalação de %s pacotes iniciada', "Avviata l'installazione di %s pacchetti", 'Rozpoczęto instalację %s archiwów', '%s paket kurulmaya başlandı', 'เริ่มติดตั้ง %s แพ็กเกจแล้ว']],
  ['已开始安装 %s 个包，%s 个没能开始（在下载页看原因）', ['已開始安裝 %s 個套件，%s 個沒能開始（在下載頁看原因）', 'Started installing %s packages; %s could not start (see reasons on the download page)', '%s 件の導入を開始しました。%s 件は開始できませんでした（理由はダウンロードページで確認してください）', '%s개 패키지 설치를 시작했습니다. %s개는 시작하지 못했습니다(다운로드 페이지에서 이유를 확인하세요)', 'Начата установка %s архивов; %s не удалось запустить (причины на странице загрузок)', 'Installation von %s Paketen gestartet; %s konnten nicht starten (Gründe auf der Download-Seite)', "Installation de %s archives lancée ; %s n'ont pas pu démarrer (voir la page Téléchargements)", 'Instalación de %s paquetes iniciada; %s no pudieron empezar (mira el motivo en Descargas)', 'Instalação de %s pacotes iniciada; %s não puderam começar (veja o motivo em Downloads)', "Avviata l'installazione di %s pacchetti; %s non sono partiti (motivi nella pagina Download)", 'Rozpoczęto instalację %s archiwów; %s nie wystartowało (powody na stronie pobierania)', '%s paket kurulmaya başlandı; %s başlatılamadı (nedenler İndirilenler sayfasında)', 'เริ่มติดตั้ง %s แพ็กเกจแล้ว, %s แพ็กเกจเริ่มไม่ได้ (ดูสาเหตุที่หน้าดาวน์โหลด)']],
  ['管理器里还有 %s 个安装包没有装进当前游戏目录（包一直在管理器目录里，不会跟着游戏走）。', ['管理器裡還有 %s 個安裝包沒有裝進目前遊戲目錄（套件一直在管理器目錄裡，不會跟著遊戲走）。', '%s install packages are still in the manager folder and not in the current game folder (they stay in the manager folder and do not move with the game).', 'マネージャー内に %s 個の未導入パッケージがあります（パッケージはマネージャーのフォルダにあり、ゲームと一緒には移動しません）。', '관리자 폴더에 아직 현재 게임 폴더로 설치되지 않은 패키지가 %s개 있습니다(패키지는 관리자 폴더에 있으며 게임을 따라 이동하지 않습니다).', 'В папке менеджера осталось %s архивов, не установленных в текущую папку игры (архивы хранятся у менеджера и не переезжают вместе с игрой).', 'Im Manager-Ordner liegen %s Pakete, die nicht im aktuellen Spielordner installiert sind (die Pakete bleiben beim Manager und wandern nicht mit dem Spiel).', '%s archives sont encore dans le dossier du gestionnaire et pas dans le dossier de jeu actuel (elles ne suivent pas le jeu).', 'Hay %s paquetes en la carpeta del gestor que no están instalados en la carpeta actual del juego (no se mueven con el juego).', 'Há %s pacotes na pasta do gerenciador que não estão instalados na pasta atual do jogo (eles não acompanham o jogo).', 'Ci sono %s pacchetti nella cartella del gestore non installati nella cartella di gioco corrente (non seguono il gioco).', 'W folderze menedżera jest %s archiwów niezainstalowanych w bieżącym folderze gry (archiwa nie przenoszą się z grą).', 'Yönetici klasöründe, geçerli oyun klasörüne kurulmamış %s paket var (paketler yöneticide kalır, oyunla taşınmaz).', 'ยังมีแพ็กเกจ %s รายการในโฟลเดอร์ตัวจัดการที่ยังไม่ได้ติดตั้งลงโฟลเดอร์เกมปัจจุบัน (แพ็กเกจจะอยู่กับตัวจัดการ ไม่ย้ายตามเกม)']],

  /* ---- 0.4.0 · 安装包目录可配置 ---- */
  ['安装包目录', ['安裝包目錄', 'Install package folder', 'インストールパッケージフォルダ', '설치 패키지 폴더', 'Папка пакетов установки', 'Installationspaket-Ordner', 'Dossier des paquets d\'installation', 'Carpeta de paquetes de instalación', 'Pasta de pacotes de instalação', 'Cartella dei pacchetti di installazione', 'Folder pakietów instalacyjnych', 'Kurulum paketi klasörü', 'โฟลเดอร์แพ็กเกจติดตั้ง']],
  ['目录', ['目錄', 'Folder', 'フォルダ', '폴더', 'Папка', 'Ordner', 'Dossier', 'Carpeta', 'Pasta', 'Cartella', 'Folder', 'Klasör', 'โฟลเดอร์']],
  ['里面的包', ['裡面的包', 'Packages inside', '中のパッケージ', '안에 있는 패키지', 'Пакеты внутри', 'Enthaltene Pakete', 'Paquets présents', 'Paquetes dentro', 'Pacotes dentro', 'Pacchetti presenti', 'Zawarte pakiety', 'İçindeki paketler', 'แพ็กเกจข้างใน']],
  ['自定义', ['自訂', 'Custom', 'カスタム', '사용자 지정', 'Своя', 'Eigener', 'Personnalisé', 'Personalizado', 'Personalizado', 'Personalizzata', 'Własny', 'Özel', 'กำหนดเอง']],
  ['默认', ['預設', 'Default', '既定', '기본', 'По умолчанию', 'Standard', 'Par défaut', 'Predeterminado', 'Padrão', 'Predefinita', 'Domyślny', 'Varsayılan', 'ค่าเริ่มต้น']],
  ['这个目录不存在（点「恢复默认」或换个目录）', ['這個目錄不存在（點「恢復預設」或換個目錄）', 'This folder doesn\'t exist (click "Reset" or pick another).', 'このフォルダがありません（「既定に戻す」か別のフォルダを選んでください）。', '이 폴더가 없습니다 ("기본값 복원"을 누르거나 다른 폴더를 선택하세요).', 'Папки нет (нажмите «По умолчанию» или выберите другую).', 'Ordner fehlt (auf „Standard" klicken oder anderen wählen).', 'Dossier introuvable (cliquez sur « Par défaut » ou choisissez-en un autre).', 'La carpeta no existe (pulsa "Predeterminado" o elige otra).', 'A pasta não existe (clique em "Padrão" ou escolha outra).', 'Cartella inesistente (premi "Predefinita" o scegline un\'altra).', 'Brak folderu (kliknij „Domyślny" lub wybierz inny).', 'Klasör yok ("Varsayılan"a bas ya da başka seç).', 'ไม่มีโฟลเดอร์นี้ (กด "ค่าเริ่มต้น" หรือเลือกโฟลเดอร์อื่น)']],
  ['更改目录…', ['變更目錄…', 'Change folder…', 'フォルダを変更…', '폴더 변경…', 'Сменить папку…', 'Ordner ändern…', 'Changer de dossier…', 'Cambiar carpeta…', 'Alterar pasta…', 'Cambia cartella…', 'Zmień folder…', 'Klasörü değiştir…', 'เปลี่ยนโฟลเดอร์…']],
  ['打开目录', ['開啟目錄', 'Open folder', 'フォルダを開く', '폴더 열기', 'Открыть папку', 'Ordner öffnen', 'Ouvrir le dossier', 'Abrir carpeta', 'Abrir pasta', 'Apri cartella', 'Otwórz folder', 'Klasörü aç', 'เปิดโฟลเดอร์']],
  ['恢复默认', ['恢復預設', 'Reset to default', '既定に戻す', '기본값 복원', 'По умолчанию', 'Auf Standard', 'Par défaut', 'Predeterminado', 'Padrão', 'Predefinita', 'Domyślny', 'Varsayılana dön', 'กลับค่าเริ่มต้น']],
  ['%s 个包 · %s · 其中 %s 个还没装进当前游戏目录', ['%s 個包 · %s · 其中 %s 個還沒裝進目前遊戲目錄', '%s packages · %s · %s not installed in the current game folder yet', '%s 個 · %s · うち %s 個は現在のゲームフォルダに未インストール', '%s개 · %s · 그중 %s개는 현재 게임 폴더에 아직 설치되지 않음', '%s пакетов · %s · из них %s ещё не в папке игры', '%s Pakete · %s · davon %s noch nicht im Spielordner', '%s paquets · %s · dont %s pas encore installés', '%s paquetes · %s · de ellos %s sin instalar', '%s pacotes · %s · sendo %s ainda não instalados', '%s pacchetti · %s · di cui %s non ancora installati', '%s pakietów · %s · w tym %s jeszcze nie zainstalowano', '%s paket · %s · bunlardan %s hâlâ kurulmadı', '%s แพ็กเกจ · %s · โดย %s ยังไม่ได้ติดตั้ง']],
  ['安装包目录已改为：', ['安裝包目錄已改為：', 'Install package folder changed to:', 'インストールパッケージフォルダを変更しました：', '설치 패키지 폴더를 변경했습니다:', 'Папка пакетов изменена:', 'Paketordner geändert:', 'Dossier des paquets modifié :', 'Carpeta de paquetes cambiada:', 'Pasta de pacotes alterada:', 'Cartella dei pacchetti cambiata:', 'Zmieniono folder pakietów:', 'Paket klasörü değişti:', 'เปลี่ยนโฟลเดอร์แพ็กเกจเป็น:']],
  ['重启管理器后生效', ['重新啟動管理器後生效', 'Takes effect after restarting the manager', 'マネージャーを再起動すると反映されます', '관리자를 다시 시작하면 적용됩니다', 'Применится после перезапуска', 'Wirkt nach Neustart des Managers', 'Effectif après redémarrage', 'Se aplica tras reiniciar', 'Aplica-se após reiniciar', 'Attivo dopo il riavvio', 'Zadziała po restarcie', 'Yöneticiyi yeniden başlatınca geçerli olur', 'มีผลหลังรีสตาร์ทตัวจัดการ']],
  /* ── 0.4.3 · 管理器自带安装包改成卡片（与浏览页同一套版式） ── */
  ['安装包', ['安裝包', 'Package', 'パッケージ', '패키지', 'Пакет', 'Paket', 'Paquet', 'Paquete', 'Pacote', 'Pacchetto', 'Pakiet', 'Paket', 'แพ็กเกจ']],
  ['详情', ['詳情', 'Details', '詳細', '상세', 'Подробнее', 'Details', 'Détails', 'Detalles', 'Detalhes', 'Dettagli', 'Szczegóły', 'Ayrıntılar', 'รายละเอียด']],
  ['作者', ['作者', 'Author', '作者', '제작자', 'Автор', 'Autor', 'Auteur', 'Autor', 'Autor', 'Autore', 'Autor', 'Yazar', 'ผู้สร้าง']],
  ['本地安装包', ['本機安裝包', 'Local package', 'ローカルパッケージ', '로컬 패키지', 'Локальный пакет', 'Lokales Paket', 'Paquet local', 'Paquete local', 'Pacote local', 'Pacchetto locale', 'Pakiet lokalny', 'Yerel paket', 'แพ็กเกจในเครื่อง']],
  ['显示更多（还有 %s 个）', ['顯示更多（還有 %s 個）', 'Show more (%s left)', 'さらに表示（残り %s 個）', '더 보기 (%s개 남음)', 'Показать ещё (осталось %s)', 'Mehr anzeigen (%s übrig)', 'Afficher plus (%s restants)', 'Mostrar más (%s restantes)', 'Mostrar mais (%s restantes)', 'Mostra altri (%s rimasti)', 'Pokaż więcej (pozostało %s)', 'Daha fazla göster (%s kaldı)', 'แสดงเพิ่มเติม (เหลือ %s)']],
  // ── 0.4.4 · 「已下载」筛选 / 批量安装（13 条）
  [
    "正在盘点管理器里的安装包…",
    [
      "正在盤點管理器裡的安裝包…",
      "Checking the installer packages in the manager…",
      "マネージャー内のインストールパッケージを確認しています…",
      "관리자에 있는 설치 패키지를 확인하는 중…",
      "Проверяем установочные пакеты в менеджере…",
      "Installationspakete im Manager werden geprüft…",
      "Vérification des paquets d'installation du gestionnaire…",
      "Comprobando los paquetes de instalación del gestor…",
      "Verificando os pacotes de instalação do gerenciador…",
      "Verifica dei pacchetti di installazione nel gestore…",
      "Sprawdzanie pakietów instalacyjnych w menedżerze…",
      "Yöneticideki kurulum paketleri denetleniyor…",
      "กำลังตรวจสอบแพ็กเกจติดตั้งในตัวจัดการ…",
    ],
  ],
  [
    "没有已下载但没装的 Mod",
    [
      "沒有已下載但沒裝的 Mod",
      "No downloaded-but-not-installed mods",
      "ダウンロード済みで未インストールの Mod はありません",
      "다운로드했지만 설치하지 않은 Mod가 없습니다",
      "Нет модов, скачанных но не установленных",
      "Keine heruntergeladenen, aber nicht installierten Mods",
      "Aucun mod téléchargé mais non installé",
      "No hay mods descargados sin instalar",
      "Nenhum mod baixado e não instalado",
      "Nessuna mod scaricata ma non installata",
      "Brak pobranych, ale niezainstalowanych modów",
      "İndirilmiş ama kurulmamış mod yok",
      "ไม่มี Mod ที่ดาวน์โหลดแล้วแต่ยังไม่ได้ติดตั้ง",
    ],
  ],
  [
    "管理器里的安装包都已经装进当前游戏目录了。再点一次「已下载」回到在线列表。",
    [
      "管理器裡的安裝包都已經裝進目前遊戲目錄了。再點一次「已下載」回到線上列表。",
      "Every package in the manager is already installed into the current game folder. Click \"Downloaded\" again to go back to the online list.",
      "マネージャー内のパッケージはすべて現在のゲームフォルダーにインストール済みです。「ダウンロード済み」をもう一度押すとオンライン一覧に戻ります。",
      "관리자의 모든 패키지가 현재 게임 폴더에 설치되어 있습니다. 「다운로드됨」을 다시 누르면 온라인 목록으로 돌아갑니다.",
      "Все пакеты в менеджере уже установлены в текущую папку игры. Нажмите «Скачанные» ещё раз, чтобы вернуться к онлайн-списку.",
      "Alle Pakete im Manager sind bereits im aktuellen Spielordner installiert. Klicke erneut auf „Heruntergeladen\", um zur Online-Liste zurückzukehren.",
      "Tous les paquets du gestionnaire sont déjà installés dans le dossier de jeu actuel. Cliquez à nouveau sur « Téléchargés » pour revenir à la liste en ligne.",
      "Todos los paquetes del gestor ya están instalados en la carpeta de juego actual. Vuelve a pulsar «Descargados» para volver a la lista en línea.",
      "Todos os pacotes do gerenciador já estão instalados na pasta do jogo atual. Clique em «Baixados» novamente para voltar à lista online.",
      "Tutti i pacchetti del gestore sono già installati nella cartella di gioco attuale. Premi di nuovo «Scaricati» per tornare all'elenco online.",
      "Wszystkie pakiety w menedżerze są już zainstalowane w bieżącym folderze gry. Kliknij ponownie „Pobrane\", aby wrócić do listy online.",
      "Yöneticideki tüm paketler geçerli oyun klasörüne kurulmuş. Çevrimiçi listeye dönmek için «İndirilenler»e tekrar bas.",
      "แพ็กเกจทั้งหมดในตัวจัดการถูกติดตั้งลงโฟลเดอร์เกมปัจจุบันแล้ว กด «ดาวน์โหลดแล้ว» อีกครั้งเพื่อกลับไปยังรายการออนไลน์",
    ],
  ],
  [
    "已下载但没装 %s 个",
    [
      "已下載但沒裝 %s 個",
      "%s downloaded, not installed",
      "ダウンロード済み・未インストール %s 件",
      "다운로드했지만 미설치 %s개",
      "Скачано, но не установлено: %s",
      "%s heruntergeladen, nicht installiert",
      "%s téléchargés, non installés",
      "%s descargados, sin instalar",
      "%s baixados, não instalados",
      "%s scaricati, non installati",
      "%s pobranych, niezainstalowanych",
      "%s indirildi, kurulmadı",
      "ดาวน์โหลดแล้วยังไม่ติดตั้ง %s รายการ",
    ],
  ],
  [
    "已下载但没装 %s 个 · 已列出 %s 个 · 选中 %s 个",
    [
      "已下載但沒裝 %s 個 · 已列出 %s 個 · 選取 %s 個",
      "%s downloaded, not installed · %s listed · %s selected",
      "ダウンロード済み・未インストール %s 件 · 表示 %s 件 · 選択 %s 件",
      "다운로드했지만 미설치 %s개 · 표시 %s개 · 선택 %s개",
      "Не установлено: %s · показано: %s · выбрано: %s",
      "%s heruntergeladen, nicht installiert · %s angezeigt · %s ausgewählt",
      "%s téléchargés non installés · %s affichés · %s sélectionnés",
      "%s descargados sin instalar · %s mostrados · %s seleccionados",
      "%s baixados não instalados · %s exibidos · %s selecionados",
      "%s scaricati non installati · %s mostrati · %s selezionati",
      "%s pobranych niezainstalowanych · %s pokazanych · %s wybranych",
      "%s indirildi kurulmadı · %s listelendi · %s seçildi",
      "ดาวน์โหลดแล้วยังไม่ติดตั้ง %s · แสดง %s · เลือก %s",
    ],
  ],
  [
    "（勾选后点右上「批量安装」）",
    [
      "（勾選後點右上「批次安裝」）",
      "(tick the ones you want, then click \"Install selected\")",
      "（選んだら右上の「まとめてインストール」）",
      "（선택한 뒤 오른쪽 위 「일괄 설치」）",
      "(отметьте нужные и нажмите «Установить выбранные» справа сверху)",
      "(anhaken, dann oben rechts „Auswahl installieren\")",
      "(cochez, puis « Installer la sélection » en haut à droite)",
      "(marca y pulsa «Instalar seleccionados» arriba a la derecha)",
      "(marque e clique em «Instalar selecionados» no canto superior direito)",
      "(seleziona e premi «Installa selezionati» in alto a destra)",
      "(zaznacz i kliknij „Zainstaluj zaznaczone\" w prawym górnym rogu)",
      "(işaretle, sonra sağ üstteki «Seçilenleri kur»)",
      "(เลือกแล้วกด «ติดตั้งที่เลือก» ที่มุมขวาบน)",
    ],
  ],
  [
    "（点「多选」后勾卡片，可批量安装）",
    [
      "（點「多選」後勾卡片，可批次安裝）",
      "(click \"Select\", tick the cards, then install them in one go)",
      "（「複数選択」を押してカードを選ぶとまとめてインストールできます）",
      "(「다중 선택」을 누르고 카드를 고르면 일괄 설치할 수 있습니다)",
      "(нажмите «Выбор», отметьте карточки и установите все сразу)",
      "(auf „Mehrfachauswahl\" klicken, Karten anhaken, dann alle installieren)",
      "(cliquez sur « Sélection », cochez les cartes, puis installez en une fois)",
      "(pulsa «Selección», marca las tarjetas y instala de una vez)",
      "(clique em «Seleção», marque os cartões e instale de uma vez)",
      "(premi «Selezione», segna le schede e installa in un colpo)",
      "(kliknij „Wielokrotny wybór\", zaznacz karty i zainstaluj naraz)",
      "(«Çoklu seç»e bas, kartları işaretle, hepsini birden kur)",
      "(กด «เลือกหลายรายการ» แล้วเลือกการ์ดเพื่อติดตั้งพร้อมกัน)",
    ],
  ],
  [
    "批量安装（%s）",
    [
      "批次安裝（%s）",
      "Install selected (%s)",
      "まとめてインストール（%s）",
      "일괄 설치（%s）",
      "Установить выбранные (%s)",
      "Auswahl installieren (%s)",
      "Installer la sélection (%s)",
      "Instalar seleccionados (%s)",
      "Instalar selecionados (%s)",
      "Installa selezionati (%s)",
      "Zainstaluj zaznaczone (%s)",
      "Seçilenleri kur (%s)",
      "ติดตั้งที่เลือก (%s)",
    ],
  ],
  [
    "批量安装",
    [
      "批次安裝",
      "Install selected",
      "まとめてインストール",
      "일괄 설치",
      "Установить выбранные",
      "Auswahl installieren",
      "Installer la sélection",
      "Instalar seleccionados",
      "Instalar selecionados",
      "Installa selezionati",
      "Zainstaluj zaznaczone",
      "Seçilenleri kur",
      "ติดตั้งที่เลือก",
    ],
  ],
  [
    "先勾选要安装的包",
    [
      "先勾選要安裝的包",
      "Tick the packages you want to install first",
      "先にインストールするパッケージを選んでください",
      "먼저 설치할 패키지를 선택하세요",
      "Сначала отметьте нужные пакеты",
      "Bitte zuerst die gewünschten Pakete anhaken",
      "Cochez d'abord les paquets à installer",
      "Primero marca los paquetes que quieres instalar",
      "Marque primeiro os pacotes que deseja instalar",
      "Prima segna i pacchetti da installare",
      "Najpierw zaznacz pakiety do instalacji",
      "Önce kurmak istediğin paketleri işaretle",
      "เลือกแพ็กเกจที่ต้องการติดตั้งก่อน",
    ],
  ],
  [
    "到「已下载」里批量安装",
    [
      "到「已下載」裡批次安裝",
      "Install them from \"Downloaded\"",
      "「ダウンロード済み」でまとめてインストール",
      "「다운로드됨」에서 일괄 설치",
      "Установить из «Скачанные»",
      "Unter „Heruntergeladen\" installieren",
      "Installer depuis « Téléchargés »",
      "Instalar desde «Descargados»",
      "Instalar em «Baixados»",
      "Installa da «Scaricati»",
      "Zainstaluj w „Pobrane\"",
      "«İndirilenler» içinden kur",
      "ติดตั้งจาก «ดาวน์โหลดแล้ว»",
    ],
  ],
  [
    "打开「浏览 Mod」页的「已下载」筛选，可以多选批量安装",
    [
      "開啟「瀏覽 Mod」頁的「已下載」篩選，可以多選批次安裝",
      "Open the \"Downloaded\" filter on the Browse page to select several and install them together",
      "「Mod を探す」ページの「ダウンロード済み」絞り込みを開くと、まとめて選んでインストールできます",
      "「Mod 둘러보기」페이지의 「다운로드됨」 필터를 열면 여러 개를 골라 일괄 설치할 수 있습니다",
      "Откройте фильтр «Скачанные» на странице «Обзор Mod», чтобы выбрать несколько и установить их вместе",
      "Öffne den Filter „Heruntergeladen\" auf der Seite „Mods durchsuchen\", um mehrere auszuwählen und gemeinsam zu installieren",
      "Ouvrez le filtre « Téléchargés » de la page « Parcourir » pour en sélectionner plusieurs et les installer ensemble",
      "Abre el filtro «Descargados» de la página «Explorar» para seleccionar varios e instalarlos juntos",
      "Abra o filtro «Baixados» da página «Explorar» para selecionar vários e instalar juntos",
      "Apri il filtro «Scaricati» della pagina «Sfoglia» per selezionarne diversi e installarli insieme",
      "Otwórz filtr „Pobrane\" na stronie „Przeglądaj\", aby zaznaczyć kilka i zainstalować je razem",
      "«Modlara göz at» sayfasındaki «İndirilenler» filtresini açarak birkaçını seçip birlikte kurabilirsin",
      "เปิดตัวกรอง «ดาวน์โหลดแล้ว» ในหน้า «เรียกดู Mod» เพื่อเลือกหลายรายการแล้วติดตั้งพร้อมกัน",
    ],
  ],
  [
    "只看管理器里已经下好、但还没装进当前游戏目录的安装包（本地清单，可多选批量安装）",
    [
      "只看管理器裡已經下好、但還沒裝進目前遊戲目錄的安裝包（本機清單，可多選批次安裝）",
      "Show only packages already downloaded into the manager but not yet installed into the current game folder (local list, multi-select install)",
      "マネージャーにダウンロード済みで、まだ現在のゲームフォルダーに入れていないパッケージだけを表示します（ローカル一覧・まとめてインストール可）",
      "관리자에 내려받았지만 아직 현재 게임 폴더에 설치하지 않은 패키지만 표시합니다 (로컬 목록, 일괄 설치 가능)",
      "Показывать только пакеты, уже скачанные в менеджер, но ещё не установленные в текущую папку игры (локальный список, можно ставить пачкой)",
      "Nur Pakete zeigen, die bereits im Manager heruntergeladen, aber noch nicht im aktuellen Spielordner installiert sind (lokale Liste, Mehrfachinstallation)",
      "Afficher uniquement les paquets déjà téléchargés dans le gestionnaire mais pas encore installés dans le dossier de jeu actuel (liste locale, installation groupée)",
      "Mostrar solo los paquetes ya descargados en el gestor pero aún no instalados en la carpeta de juego actual (lista local, instalación múltiple)",
      "Mostrar apenas os pacotes já baixados no gerenciador mas ainda não instalados na pasta do jogo atual (lista local, instalação múltipla)",
      "Mostra solo i pacchetti già scaricati nel gestore ma non ancora installati nella cartella di gioco attuale (elenco locale, installazione multipla)",
      "Pokazuj tylko pakiety pobrane do menedżera, ale jeszcze niezainstalowane w bieżącym folderze gry (lista lokalna, instalacja wielu naraz)",
      "Yalnızca yöneticiye indirilmiş ama geçerli oyun klasörüne henüz kurulmamış paketleri göster (yerel liste, çoklu kurulum)",
      "แสดงเฉพาะแพ็กเกจที่ดาวน์โหลดเข้าเครื่องจัดการแล้วแต่ยังไม่ได้ติดตั้งลงโฟลเดอร์เกมปัจจุบัน (รายการในเครื่อง เลือกหลายรายการติดตั้งได้)",
    ],
  ],
  // ── 0.4.5 · 「已下载」卡片的定位 / 删除（5 条）
  [
    "删除",
    [
      "刪除",
      "Delete",
      "削除",
      "삭제",
      "Удалить",
      "Löschen",
      "Supprimer",
      "Eliminar",
      "Excluir",
      "Elimina",
      "Usuń",
      "Sil",
      "ลบ",
    ],
  ],
  [
    "在资源管理器里定位这份安装包",
    [
      "在檔案總管裡定位這份安裝包",
      "Show this package in File Explorer",
      "このインストールパッケージをエクスプローラーで表示",
      "이 설치 패키지를 탐색기에서 보기",
      "Показать этот пакет в Проводнике",
      "Dieses Paket im Explorer anzeigen",
      "Afficher ce paquet dans l’Explorateur",
      "Mostrar este paquete en el Explorador",
      "Mostrar este pacote no Explorador",
      "Mostra questo pacchetto in Esplora file",
      "Pokaż ten pakiet w Eksploratorze",
      "Bu paketi Gezgin’de göster",
      "แสดงแพ็กเกจนี้ใน File Explorer",
    ],
  ],
  [
    "从管理器里删掉这份安装包（不影响已经装进游戏的文件）",
    [
      "從管理器裡刪掉這份安裝包（不影響已經裝進遊戲的檔案）",
      "Delete this package from the manager (installed game files are not touched)",
      "マネージャーからこのパッケージを削除（ゲームに入れたファイルには影響しません）",
      "관리자에서 이 패키지를 삭제 (게임에 설치된 파일은 그대로)",
      "Удалить пакет из менеджера (установленные файлы игры не затрагиваются)",
      "Dieses Paket aus dem Manager löschen (installierte Spieldateien bleiben unberührt)",
      "Supprimer ce paquet du gestionnaire (les fichiers installés dans le jeu ne sont pas touchés)",
      "Eliminar este paquete del gestor (los archivos instalados en el juego no se tocan)",
      "Excluir este pacote do gerenciador (os arquivos instalados no jogo não são tocados)",
      "Elimina questo pacchetto dal gestore (i file installati nel gioco restano)",
      "Usuń ten pakiet z menedżera (pliki w grze pozostają)",
      "Bu paketi yöneticiden sil (oyuna kurulan dosyalara dokunulmaz)",
      "ลบแพ็กเกจนี้จากตัวจัดการ (ไฟล์ที่ติดตั้งในเกมไม่ถูกแตะต้อง)",
    ],
  ],
  [
    "这个安装包已经不在清单里了，刷新一下看看",
    [
      "這個安裝包已經不在清單裡了，重新整理看看",
      "That package is no longer in the list — try refreshing",
      "このパッケージはもう一覧にありません。更新してみてください",
      "이 패키지는 더 이상 목록에 없습니다. 새로고침해 보세요",
      "Этого пакета больше нет в списке — обновите",
      "Dieses Paket steht nicht mehr in der Liste – bitte aktualisieren",
      "Ce paquet n’est plus dans la liste — rafraîchissez",
      "Ese paquete ya no está en la lista: actualiza",
      "Esse pacote não está mais na lista — atualize",
      "Quel pacchetto non è più nell’elenco: aggiorna",
      "Tego pakietu nie ma już na liście — odśwież",
      "Bu paket artık listede değil — yenile",
      "แพ็กเกจนี้ไม่อยู่ในรายการแล้ว ลองรีเฟรช",
    ],
  ],
  [
    "已删除安装包：%s",
    [
      "已刪除安裝包：%s",
      "Package deleted: %s",
      "インストールパッケージを削除しました：%s",
      "설치 패키지 삭제됨: %s",
      "Пакет удалён: %s",
      "Paket gelöscht: %s",
      "Paquet supprimé : %s",
      "Paquete eliminado: %s",
      "Pacote excluído: %s",
      "Pacchetto eliminato: %s",
      "Usunięto pakiet: %s",
      "Paket silindi: %s",
      "ลบแพ็กเกจแล้ว: %s",
    ],
  ],
  // ── 0.4.6 · 顶栏「启动游戏」（4 条）
  [
    "启动游戏",
    [
      "啟動遊戲",
      "Launch game",
      "ゲームを起動",
      "게임 실행",
      "Запустить игру",
      "Spiel starten",
      "Lancer le jeu",
      "Iniciar juego",
      "Iniciar jogo",
      "Avvia gioco",
      "Uruchom grę",
      "Oyunu başlat",
      "เปิดเกม",
    ],
  ],
  [
    "直接启动游戏（不走 Steam，绿色版 / Steam / Epic 都行）",
    [
      "直接啟動遊戲（不走 Steam，綠色版 / Steam / Epic 都行）",
      "Launch the game directly (no Steam needed — works for portable, Steam and Epic installs)",
      "ゲームを直接起動（Steam 不要。ポータブル / Steam / Epic いずれも可）",
      "게임을 직접 실행 (Steam 불필요 — 포터블/Steam/Epic 모두 가능)",
      "Запустить игру напрямую (без Steam — подходит для портативной версии, Steam и Epic)",
      "Spiel direkt starten (ohne Steam – funktioniert für Portable-, Steam- und Epic-Installationen)",
      "Lancer le jeu directement (sans Steam — fonctionne pour les versions portable, Steam et Epic)",
      "Iniciar el juego directamente (sin Steam: sirve para versiones portable, Steam y Epic)",
      "Iniciar o jogo diretamente (sem Steam — funciona para versões portátil, Steam e Epic)",
      "Avvia il gioco direttamente (senza Steam: va bene per versioni portable, Steam ed Epic)",
      "Uruchom grę bezpośrednio (bez Steam — działa dla wersji portable, Steam i Epic)",
      "Oyunu doğrudan başlat (Steam gerekmez — taşınabilir, Steam ve Epic kurulumları için)",
      "เปิดเกมโดยตรง (ไม่ต้องใช้ Steam ใช้ได้กับเวอร์ชันพกพา, Steam และ Epic)",
    ],
  ],
  [
    "还没设置游戏目录，先到设置里选一下",
    [
      "還沒設定遊戲目錄，先到設定裡選一下",
      "No game folder set yet — pick one in Settings first",
      "ゲームフォルダが未設定です。先に設定で選んでください",
      "게임 폴더가 아직 없습니다. 먼저 설정에서 선택하세요",
      "Папка игры не задана — выберите её в настройках",
      "Noch kein Spielordner festgelegt – bitte zuerst in den Einstellungen wählen",
      "Aucun dossier de jeu défini — choisissez-le dans les réglages",
      "Aún no hay carpeta del juego: elígela en Ajustes",
      "Nenhuma pasta do jogo definida — escolha nos ajustes",
      "Nessuna cartella del gioco impostata: sceglila nelle impostazioni",
      "Nie ustawiono folderu gry — wybierz go w ustawieniach",
      "Oyun klasörü ayarlı değil — önce ayarlardan seçin",
      "ยังไม่ได้ตั้งโฟลเดอร์เกม เลือกได้ที่หน้าตั้งค่า",
    ],
  ],
  [
    "正在启动游戏…",
    [
      "正在啟動遊戲…",
      "Launching the game…",
      "ゲームを起動しています…",
      "게임 실행 중…",
      "Запускаем игру…",
      "Spiel wird gestartet…",
      "Lancement du jeu…",
      "Iniciando el juego…",
      "Iniciando o jogo…",
      "Avvio del gioco…",
      "Uruchamianie gry…",
      "Oyun başlatılıyor…",
      "กำลังเปิดเกม…",
    ],
  ],
  // ── 0.4.7 · 已安装抽屉的来源网址（4 条）
  [
    "这个地址是按 Mod ID 拼出来的 Nexus 页面（安装时没记下原网址）。",
    [
      "這個位址是按 Mod ID 拼出來的 Nexus 頁面（安裝時沒記下原網址）。",
      "This link is built from the Mod ID — the original URL was not recorded at install time.",
      "この URL は Mod ID から組み立てた Nexus ページです（インストール時に元の URL を記録していません）。",
      "이 주소는 Mod ID로 만든 Nexus 페이지입니다 (설치할 때 원래 주소를 기록하지 않았습니다).",
      "Эта ссылка собрана из Mod ID — исходный адрес при установке не сохранился.",
      "Dieser Link wurde aus der Mod-ID gebaut – die ursprüngliche URL wurde bei der Installation nicht gespeichert.",
      "Ce lien est construit à partir du Mod ID — l’URL d’origine n’a pas été enregistrée à l’installation.",
      "Este enlace se compone a partir del Mod ID: la URL original no se guardó al instalar.",
      "Este link é montado a partir do Mod ID — a URL original não foi registrada na instalação.",
      "Questo link è composto dall’ID del mod: l’URL originale non è stata salvata durante l’installazione.",
      "Ten link złożono z identyfikatora moda — pierwotny adres nie został zapisany przy instalacji.",
      "Bu bağlantı Mod ID’den oluşturuldu — kurulum sırasında özgün adres kaydedilmedi.",
      "ลิงก์นี้สร้างจาก Mod ID (ตอนติดตั้งไม่ได้บันทึกที่อยู่เดิมไว้)",
    ],
  ],
  [
    "未知来源（非管理器安装，也没有 Mod ID 可以拼 Nexus 地址）",
    [
      "未知來源（非管理器安裝，也沒有 Mod ID 可以拼 Nexus 位址）",
      "Unknown source (not installed by the manager, and no Mod ID to build a Nexus link)",
      "入手元不明（マネージャーで入れたものではなく、Mod ID もないため Nexus の URL を作れません）",
      "출처 불명 (관리자로 설치한 것이 아니고, Mod ID도 없어 Nexus 주소를 만들 수 없습니다)",
      "Источник неизвестен (установлено не менеджером, и нет Mod ID для ссылки на Nexus)",
      "Quelle unbekannt (nicht über den Manager installiert und keine Mod-ID für einen Nexus-Link)",
      "Source inconnue (pas installé par le gestionnaire et aucun Mod ID pour construire un lien Nexus)",
      "Origen desconocido (no lo instaló el gestor y no hay Mod ID para crear un enlace de Nexus)",
      "Origem desconhecida (não foi instalado pelo gerenciador e não há Mod ID para montar um link do Nexus)",
      "Origine sconosciuta (non installato dal gestore e nessun Mod ID per creare un link Nexus)",
      "Źródło nieznane (nie zainstalowano przez menedżer i brak Mod ID do złożenia linku Nexus)",
      "Kaynak bilinmiyor (yöneticiyle kurulmadı ve Nexus bağlantısı için Mod ID yok)",
      "ไม่ทราบแหล่งที่มา (ไม่ได้ติดตั้งผ่านตัวจัดการ และไม่มี Mod ID ให้สร้างลิงก์ Nexus)",
    ],
  ],
  [
    "🌐 打开 Mod 网页",
    [
      "🌐 開啟 Mod 網頁",
      "🌐 Open mod page",
      "🌐 Mod ページを開く",
      "🌐 Mod 페이지 열기",
      "🌐 Открыть страницу мода",
      "🌐 Mod-Seite öffnen",
      "🌐 Ouvrir la page du mod",
      "🌐 Abrir la página del mod",
      "🌐 Abrir a página do mod",
      "🌐 Apri la pagina del mod",
      "🌐 Otwórz stronę moda",
      "🌐 Mod sayfasını aç",
      "🌐 เปิดหน้า Mod",
    ],
  ],
  [
    "在浏览器里打开这个 Mod 的 Nexus 页面",
    [
      "在瀏覽器裡開啟這個 Mod 的 Nexus 頁面",
      "Open this mod’s Nexus page in your browser",
      "この Mod の Nexus ページをブラウザで開く",
      "이 Mod의 Nexus 페이지를 브라우저에서 열기",
      "Открыть страницу этого мода на Nexus в браузере",
      "Die Nexus-Seite dieses Mods im Browser öffnen",
      "Ouvrir la page Nexus de ce mod dans le navigateur",
      "Abrir la página de Nexus de este mod en el navegador",
      "Abrir a página deste mod no Nexus no navegador",
      "Apri la pagina Nexus di questo mod nel browser",
      "Otwórz stronę tego moda na Nexusie w przeglądarce",
      "Bu modun Nexus sayfasını tarayıcıda aç",
      "เปิดหน้า Nexus ของ Mod นี้ในเบราว์เซอร์",
    ],
  ],
  ["游戏版本", ["遊戲版本", "Game version", "ゲームのバージョン", "게임 버전", "Версия игры", "Spielversion", "Version du jeu", "Versión del juego", "Versão do jogo", "Versione del gioco", "Wersja gry", "Oyun sürümü", "เวอร์ชันเกม"]],
  ["读自主程序版本信息", ["讀自主程式版本資訊", "Read from the game executable", "ゲーム本体のバージョン情報から取得", "게임 실행 파일의 버전 정보에서 읽음", "Из версии исполняемого файла игры", "Aus den Versionsinformationen der Spiel-EXE", "Lu depuis les informations de version de l’exécutable", "Leído de la información de versión del ejecutable", "Lido das informações de versão do executável", "Letto dalle informazioni di versione dell’eseguibile", "Odczytano z informacji o wersji pliku gry", "Oyun çalıştırılabilir dosyasının sürüm bilgisinden", "อ่านจากข้อมูลเวอร์ชันของไฟล์เกม"]],
  ["这个 exe 里读不到版本号", ["這個 exe 裡讀不到版本號", "No version info found in this exe", "この exe からバージョン情報を読み取れません", "이 exe에서 버전 정보를 읽을 수 없음", "В этом exe не найдена информация о версии", "In dieser EXE wurde keine Versionsinfo gefunden", "Aucune information de version dans cet exe", "No se encontró información de versión en este exe", "Nenhuma informação de versão neste exe", "Nessuna informazione di versione in questo exe", "Nie znaleziono informacji o wersji w tym exe", "Bu exe içinde sürüm bilgisi bulunamadı", "ไม่พบข้อมูลเวอร์ชันใน exe นี้"]],
  ["找不到游戏主程序", ["找不到遊戲主程式", "Game executable not found", "ゲーム本体が見つかりません", "게임 실행 파일을 찾을 수 없음", "Не найден исполняемый файл игры", "Spiel-EXE nicht gefunden", "Exécutable du jeu introuvable", "No se encontró el ejecutable del juego", "Executável do jogo não encontrado", "Eseguibile del gioco non trovato", "Nie znaleziono pliku gry", "Oyun çalıştırılabilir dosyası bulunamadı", "ไม่พบไฟล์เกม"]],

  /* ⑰ 「有 bug」标记（0.4.11）：卸载处的标记按钮 + 批量安装前的提示 */
  ['⚠ 有 bug', ['⚠ 有 bug', '⚠ Buggy', '⚠ 不具合あり', '⚠ 버그 있음', '⚠ Есть баг', '⚠ Fehlerhaft', '⚠ Bugué', '⚠ Con fallos', '⚠ Com bugs', '⚠ Con bug', '⚠ Błędy', '⚠ Hatalı', '⚠ มีบั๊ก']],
  ['⚠ 标为有 bug', ['⚠ 標為有 bug', '⚠ Mark as buggy', '⚠ 不具合として記録', '⚠ 버그 있음으로 표시', '⚠ Пометить как с багом', '⚠ Als fehlerhaft markieren', '⚠ Marquer comme bugué', '⚠ Marcar con fallos', '⚠ Marcar com bugs', '⚠ Segna con bug', '⚠ Oznacz jako błędny', '⚠ Hatalı olarak işaretle', '⚠ ทำเครื่องหมายว่ามีบั๊ก']],
  ['⚠ 已标有 bug', ['⚠ 已標有 bug', '⚠ Marked as buggy', '⚠ 不具合として記録済み', '⚠ 버그 있음으로 표시됨', '⚠ Помечен как с багом', '⚠ Als fehlerhaft markiert', '⚠ Marqué comme bugué', '⚠ Marcado con fallos', '⚠ Marcado com bugs', '⚠ Segnato con bug', '⚠ Oznaczony jako błędny', '⚠ Hatalı olarak işaretlendi', '⚠ ทำเครื่องหมายว่ามีบั๊กแล้ว']],
  ['点一下取消标记（之后批量安装不会再提示）', ['點一下取消標記（之後批次安裝不會再提示）', 'Click to clear the mark (batch installs will stop warning)', 'クリックで記録を解除（以後バッチインストールで警告しません）', '클릭하면 표시가 해제됩니다(이후 일괄 설치 시 안내하지 않음)', 'Нажмите, чтобы снять метку (предупреждения при пакетной установке прекратятся)', 'Klicken, um die Markierung zu entfernen (keine Warnung mehr bei Stapelinstallationen)', "Cliquer pour retirer la marque (plus d'avertissement lors des installations groupées)", 'Haz clic para quitar la marca (las instalaciones por lotes ya no avisarán)', 'Clique para remover a marca (instalações em lote não avisarão mais)', 'Clicca per rimuovere il segno (le installazioni multiple non avviseranno più)', 'Kliknij, aby usunąć oznaczenie (zbiorcze instalacje przestaną ostrzegać)', 'İşareti kaldırmak için tıklayın (toplu kurulumlar artık uyarmaz)', 'คลิกเพื่อยกเลิกเครื่องหมาย (การติดตั้งแบบกลุ่มจะไม่เตือนอีก)']],
  ['打个记号：这个 Mod 装了会出问题。浏览页照常显示，批量安装前会先问你跳过它', ['打個記號：這個 Mod 裝了會出問題。瀏覽頁照常顯示，批次安裝前會先問你跳過它', 'Put a mark: this mod caused problems. It still shows in browse, but batch installs will ask before including it', '記録します：この Mod を入れると問題が起きました。ブラウズには表示されますが、バッチインストール時にスキップするか確認します', '표시해 둡니다: 이 Mod를 설치하면 문제가 생겼습니다. 둘러보기에는 그대로 보이지만 일괄 설치 전에 건너뛸지 묻습니다', 'Поставить метку: этот мод вызвал проблемы. В браузере он остаётся, но при пакетной установке спросим, пропустить ли его', 'Markieren: Dieser Mod hat Probleme verursacht. Er bleibt im Browser sichtbar, bei Stapelinstallationen wird aber gefragt', "Marquer : ce mod a causé des problèmes. Il reste visible, mais l'installation groupée demandera s'il faut l'ignorer", 'Marcar: este mod causó problemas. Sigue visible, pero la instalación por lotes preguntará si omitirlo', 'Marcar: este mod causou problemas. Continua visível, mas a instalação em lote perguntará se deve ignorá-lo', 'Segna: questo mod ha causato problemi. Resta visibile, ma l’installazione multipla chiederà se saltarlo', 'Oznacz: ten mod powodował problemy. Nadal jest widoczny, ale instalacja zbiorcza zapyta, czy go pominąć', 'İşaretle: bu mod sorun çıkardı. Görüntülemede görünmeye devam eder, toplu kurulumda atlanması sorulur', 'ทำเครื่องหมาย: มอดนี้ทำให้เกิดปัญหา ยังแสดงในหน้าดู แต่การติดตั้งแบบกลุ่มจะถามว่าข้ามหรือไม่']],
  ['你标记过这个 Mod 有 bug —— 批量安装时会先问一句要不要跳过', ['你標記過這個 Mod 有 bug —— 批次安裝時會先問一句要不要跳過', 'You marked this mod as buggy — batch installs will ask whether to skip it', 'この Mod を不具合ありとして記録しています —— バッチインストール時にスキップするか確認します', '이 Mod를 버그 있음으로 표시했습니다 — 일괄 설치 시 건너뛸지 묻습니다', 'Вы пометили этот мод как проблемный — при пакетной установке спросим, пропустить ли его', 'Du hast diesen Mod als fehlerhaft markiert — bei Stapelinstallationen wird gefragt, ob er übersprungen wird', "Vous avez marqué ce mod comme bugué — l'installation groupée demandera s'il faut l'ignorer", 'Marcaste este mod con fallos — la instalación por lotes preguntará si omitirlo', 'Você marcou este mod com bugs — a instalação em lote perguntará se deve ignorá-lo', "Hai segnato questo mod con bug — l'installazione multipla chiederà se saltarlo", 'Oznaczono ten mod jako błędny — instalacja zbiorcza zapyta, czy go pominąć', 'Bu modu hatalı olarak işaretlediniz — toplu kurulumda atlanması sorulacak', 'คุณทำเครื่องหมายมอดนี้ว่ามีบั๊ก — การติดตั้งแบบกลุ่มจะถามว่าข้ามหรือไม่']],
  ['这个 Mod 没有 Nexus Mod ID，没法标记（标记靠 Mod ID 认人）', ['這個 Mod 沒有 Nexus Mod ID，無法標記（標記靠 Mod ID 認人）', "This mod has no Nexus Mod ID, so it can't be marked (marks identify mods by Mod ID)", 'この Mod には Nexus Mod ID がないため記録できません（記録は Mod ID で識別します）', '이 Mod에는 Nexus Mod ID가 없어 표시할 수 없습니다(표시는 Mod ID로 구분합니다)', 'У этого мода нет Nexus Mod ID, поэтому пометить нельзя (метки опознают моды по Mod ID)', 'Dieser Mod hat keine Nexus Mod ID und kann daher nicht markiert werden (Markierungen erkennen Mods an der Mod ID)', "Ce mod n'a pas de Nexus Mod ID, impossible de le marquer (les marques identifient les mods par Mod ID)", 'Este mod no tiene Nexus Mod ID, no se puede marcar (las marcas identifican por Mod ID)', 'Este mod não tem Nexus Mod ID, não é possível marcar (as marcas identificam pelo Mod ID)', 'Questo mod non ha un Nexus Mod ID, impossibile segnarlo (i segni identificano tramite Mod ID)', 'Ten mod nie ma Nexus Mod ID, nie można go oznaczyć (oznaczenia rozpoznają po Mod ID)', "Bu modun Nexus Mod ID'si yok, işaretlenemez (işaretler Mod ID ile tanır)", 'มอดนี้ไม่มี Nexus Mod ID จึงทำเครื่องหมายไม่ได้ (เครื่องหมายใช้ Mod ID ในการระบุ)']],
  ['已取消「有 bug」标记：%s', ['已取消「有 bug」標記：%s', 'Cleared the "buggy" mark: %s', '「不具合あり」の記録を解除しました：%s', "'버그 있음' 표시를 해제했습니다: %s", 'Метка «с багом» снята: %s', 'Markierung „fehlerhaft“ entfernt: %s', 'Marque « bugué » retirée : %s', 'Marca «con fallos» eliminada: %s', 'Marca "com bugs" removida: %s', 'Segno "con bug" rimosso: %s', 'Usunięto oznaczenie „błędny“: %s', '"Hatalı" işareti kaldırıldı: %s', 'ยกเลิกเครื่องหมาย "มีบั๊ก" แล้ว: %s']],
  ['已标记有 bug：%s —— 批量安装前会先问你要不要跳过', ['已標記有 bug：%s —— 批次安裝前會先問你要不要跳過', 'Marked as buggy: %s — batch installs will ask whether to skip it', '不具合ありとして記録しました：%s —— バッチインストール前にスキップするか確認します', '버그 있음으로 표시했습니다: %s — 일괄 설치 전에 건너뛸지 묻습니다', 'Помечен как проблемный: %s — перед пакетной установкой спросим, пропустить ли', 'Als fehlerhaft markiert: %s — vor Stapelinstallationen wird gefragt, ob übersprungen wird', "Marqué comme bugué : %s — l'installation groupée demandera s'il faut l'ignorer", 'Marcado con fallos: %s — la instalación por lotes preguntará si omitirlo', 'Marcado com bugs: %s — a instalação em lote perguntará se deve ignorá-lo', 'Segnato con bug: %s — l’installazione multipla chiederà se saltarlo', 'Oznaczono jako błędny: %s — instalacja zbiorcza zapyta, czy pominąć', 'Hatalı olarak işaretlendi: %s — toplu kurulum öncesi atlanması sorulacak', 'ทำเครื่องหมายว่ามีบั๊กแล้ว: %s — ก่อนติดตั้งแบบกลุ่มจะถามว่าข้ามหรือไม่']],
  ['这批里有标过「有 bug」的 Mod', ['這批裡有標過「有 bug」的 Mod', 'This batch includes mods marked as buggy', 'このバッチに「不具合あり」の Mod が含まれています', "이 묶음에 '버그 있음'으로 표시된 Mod가 있습니다", 'В этой партии есть моды с меткой «с багом»', 'In diesem Stapel sind als fehlerhaft markierte Mods', 'Ce lot contient des mods marqués comme bugués', 'Este lote incluye mods marcados con fallos', 'Este lote inclui mods marcados com bugs', 'Questo lotto contiene mod segnati con bug', 'Ta partia zawiera mody oznaczone jako błędne', 'Bu grupta hatalı olarak işaretlenmiş modlar var', 'ชุดนี้มีมอดที่ทำเครื่องหมายว่ามีบั๊ก']],
  ['里面这 %s 个你之前标记过「有 bug」—— 装进去可能影响游戏：', ['裡面這 %s 個你之前標記過「有 bug」—— 裝進去可能影響遊戲：', '%s of them you marked as buggy — installing them may break the game:', 'うち %s 件は「不具合あり」として記録済みです —— 入れるとゲームに影響する可能性があります：', "그중 %s개는 '버그 있음'으로 표시한 것입니다 — 설치하면 게임에 영향을 줄 수 있습니다:", 'Из них %s помечены как проблемные — установка может повредить игру:', 'Davon hast du %s als fehlerhaft markiert — die Installation kann das Spiel beeinträchtigen:', "dont %s sont marqués comme bugués — les installer peut affecter le jeu :", '%s de ellos están marcados con fallos — instalarlos puede afectar al juego:', '%s deles estão marcados com bugs — instalá-los pode afetar o jogo:', '%s di questi sono segnati con bug — installarli può compromettere il gioco:', '%s z nich oznaczono jako błędne — instalacja może zaszkodzić grze:', 'Bunlardan %s tanesi hatalı olarak işaretli — kurmak oyunu etkileyebilir:', 'ในนั้น %s รายการคุณทำเครื่องหมายว่ามีบั๊ก — ติดตั้งแล้วอาจกระทบเกม:']],
  ['标记只是提醒，不会拦你。想改主意可以在「已安装 Mod」里点开那个 Mod，取消标记。', ['標記只是提醒，不會攔你。想改主意可以在「已安裝 Mod」裡點開那個 Mod，取消標記。', "A mark is only a reminder and won't block you. To change your mind, open that mod under Installed and clear the mark.", '記録はあくまで注意喚起で、ブロックはしません。気が変わったら「インストール済み Mod」でその Mod を開き、記録を解除してください。', "표시는 알림일 뿐 막지 않습니다. 마음이 바뀌면 '설치된 Mod'에서 해당 Mod를 열어 표시를 해제하세요.", 'Метка только предупреждает и ничего не блокирует. Передумали — откройте мод в «Установленные Mod» и снимите метку.', 'Eine Markierung ist nur ein Hinweis und blockiert nichts. Falls du es dir anders überlegst, öffne den Mod unter „Installierte Mods“ und entferne die Markierung.', "Une marque n'est qu'un rappel et ne bloque rien. Pour changer d'avis, ouvrez ce mod dans « Mods installés » et retirez la marque.", 'La marca solo avisa y no bloquea nada. Si cambias de opinión, abre ese mod en «Mods instalados» y quita la marca.', 'A marca é só um aviso e não bloqueia nada. Se mudar de ideia, abra esse mod em "Mods instalados" e remova a marca.', 'Il segno è solo un avviso e non blocca nulla. Se cambi idea, apri quel mod in "Mod installati" e togli il segno.', 'Oznaczenie tylko przypomina i niczego nie blokuje. Jeśli zmienisz zdanie, otwórz ten mod w „Zainstalowane mody“ i usuń oznaczenie.', 'İşaret yalnızca bir hatırlatmadır, engellemez. Fikrinizi değiştirirseniz "Kurulu Modlar"da o modu açıp işareti kaldırın.', 'เครื่องหมายเป็นเพียงการเตือน ไม่ได้บล็อก หากเปลี่ยนใจ เปิดมอดนั้นใน "มอดที่ติดตั้งแล้ว" แล้วยกเลิกเครื่องหมาย']],
  ['全部跳过这 %s 个', ['全部跳過這 %s 個', 'Skip all %s', 'この %s 件をすべてスキップ', '이 %s개 모두 건너뛰기', 'Пропустить все %s', 'Alle %s überspringen', 'Ignorer les %s', 'Omitir los %s', 'Ignorar todos os %s', 'Salta tutti i %s', 'Pomiń wszystkie (%s)', '%s tanesini tümüyle atla', 'ข้ามทั้ง %s รายการ']],
  ['仍然全部安装', ['仍然全部安裝', 'Install all anyway', 'それでもすべてインストール', '그래도 모두 설치', 'Всё равно установить всё', 'Trotzdem alle installieren', 'Tout installer quand même', 'Instalar todo igualmente', 'Instalar tudo mesmo assim', 'Installa comunque tutto', 'Mimo to zainstaluj wszystko', 'Yine de tümünü kur', 'ติดตั้งทั้งหมดต่อไป']],
  ['勾选的包都标过「有 bug」，已全部跳过', ['勾選的包都標過「有 bug」，已全部跳過', 'All selected packages are marked as buggy — skipped them all', '選択したパッケージはすべて「不具合あり」のため、すべてスキップしました', "선택한 패키지가 모두 '버그 있음'이라 전부 건너뛰었습니다", 'Все выбранные пакеты помечены как проблемные — пропущены', 'Alle ausgewählten Pakete sind als fehlerhaft markiert — alle übersprungen', 'Tous les paquets sélectionnés sont marqués comme bugués — tous ignorés', 'Todos los paquetes seleccionados están marcados con fallos: omitidos', 'Todos os pacotes selecionados estão marcados com bugs — todos ignorados', 'Tutti i pacchetti selezionati sono segnati con bug: saltati', 'Wszystkie wybrane paczki są oznaczone jako błędne — pominięto', 'Seçilen tüm paketler hatalı işaretli — hepsi atlandı', 'แพ็กเกจที่เลือกทำเครื่องหมายว่ามีบั๊กทั้งหมด — ข้ามทั้งหมดแล้ว']],
  ['待安装的包都标过「有 bug」，已全部跳过', ['待安裝的包都標過「有 bug」，已全部跳過', 'Every pending package is marked as buggy — skipped them all', 'インストール待ちのパッケージはすべて「不具合あり」のため、すべてスキップしました', "설치 대기 중인 패키지가 모두 '버그 있음'이라 전부 건너뛰었습니다", 'Все ожидающие пакеты помечены как проблемные — пропущены', 'Alle ausstehenden Pakete sind als fehlerhaft markiert — alle übersprungen', 'Tous les paquets en attente sont marqués comme bugués — tous ignorés', 'Todos los paquetes pendientes están marcados con fallos: omitidos', 'Todos os pacotes pendentes estão marcados com bugs — todos ignorados', 'Tutti i pacchetti in attesa sono segnati con bug: saltati', 'Wszystkie oczekujące paczki są oznaczone jako błędne — pominięto', 'Bekleyen tüm paketler hatalı işaretli — hepsi atlandı', 'แพ็กเกจที่รอติดตั้งทำเครื่องหมายว่ามีบั๊กทั้งหมด — ข้ามทั้งหมดแล้ว']],
  // ── ⑱ 0.4.12：安装包已在本地的按钮/提示 + 图集加载进度（5 条）──────────────
  ['安装包已经在管理器里（不用再下一次），直接装进游戏目录', [
    '安裝包已經在管理器裡（不用再下一次），直接裝進遊戲目錄',
    'The installer is already in the manager (no need to download again) - install it straight into the game folder',
    'インストーラーはすでにマネージャー内にあります（再ダウンロード不要）。そのままゲームフォルダーへインストールします',
    '설치 파일이 이미 관리자에 있습니다(다시 받을 필요 없음). 게임 폴더에 바로 설치합니다',
    'Установочный архив уже в менеджере (скачивать заново не нужно) — установим сразу в папку игры',
    'Das Installationspaket liegt bereits im Manager (kein erneuter Download nötig) – direkt in den Spielordner installieren',
    "L'archive d'installation est déjà dans le gestionnaire (pas besoin de la retélécharger) - installer directement dans le dossier du jeu",
    'El paquete de instalación ya está en el gestor (no hace falta descargarlo otra vez): instálalo directamente en la carpeta del juego',
    'O pacote de instalação já está no gerenciador (não precisa baixar de novo) - instale direto na pasta do jogo',
    "Il pacchetto di installazione è già nel gestore (non serve riscaricarlo): installalo direttamente nella cartella del gioco",
    'Paczka instalacyjna jest już w menedżerze (nie trzeba pobierać ponownie) — zainstaluj ją od razu w folderze gry',
    'Kurulum paketi zaten yöneticide (yeniden indirmeye gerek yok) - doğrudan oyun klasörüne kur',
    'มีแพ็กเกจติดตั้งอยู่ในตัวจัดการแล้ว (ไม่ต้องดาวน์โหลดซ้ำ) - ติดตั้งลงโฟลเดอร์เกมได้เลย'
  ]],
  ['安装包不在本地了（可能被删了），重新下载一次吧', [
    '安裝包不在本地了（可能被刪了），重新下載一次吧',
    'The installer is no longer on disk (it may have been deleted). Please download it again',
    'インストーラーがローカルにありません（削除された可能性があります）。もう一度ダウンロードしてください',
    '설치 파일이 로컬에 없습니다(삭제되었을 수 있음). 다시 다운로드해 주세요',
    'Установочного архива больше нет на диске (возможно, удалён). Скачайте заново',
    'Das Installationspaket ist nicht mehr vorhanden (vielleicht gelöscht). Bitte erneut herunterladen',
    "L'archive d'installation n'est plus présente (peut-être supprimée). Retéléchargez-la",
    'El paquete de instalación ya no está en disco (puede que se haya borrado). Descárgalo otra vez',
    'O pacote de instalação não está mais no disco (talvez tenha sido excluído). Baixe novamente',
    "Il pacchetto di installazione non è più sul disco (forse è stato eliminato). Scaricalo di nuovo",
    'Paczki instalacyjnej nie ma już na dysku (może została usunięta). Pobierz ją ponownie',
    'Kurulum paketi artık diskte yok (silinmiş olabilir). Lütfen yeniden indir',
    'ไม่มีแพ็กเกจติดตั้งในเครื่องแล้ว (อาจถูกลบไป) กรุณาดาวน์โหลดใหม่'
  ]],
  ['正在获取这个 Mod 的图集…', [
    '正在取得這個 Mod 的圖集…',
    'Loading this mod’s gallery…',
    'この Mod のギャラリーを取得中…',
    '이 Mod의 갤러리를 가져오는 중…',
    'Загружаем галерею этого мода…',
    'Galerie dieses Mods wird geladen…',
    'Chargement de la galerie de ce mod…',
    'Cargando la galería de este mod…',
    'Carregando a galeria deste mod…',
    'Caricamento della galleria di questo mod…',
    'Wczytywanie galerii tego moda…',
    'Bu modun galerisi yükleniyor…',
    'กำลังโหลดแกลเลอรีของมอดนี้…'
  ]],
  ['图集还在抓，先看这张主图；抓到会自动补上。', [
    '圖集還在抓，先看這張主圖；抓到會自動補上。',
    'Still fetching the gallery - here is the main image for now; it will fill in automatically.',
    'ギャラリーを取得中です。まずはメイン画像をご覧ください。取得でき次第自動で反映されます。',
    '갤러리를 아직 가져오는 중입니다. 우선 대표 이미지를 보여드리며, 가져오면 자동으로 채워집니다.',
    'Галерея ещё загружается — пока показываем главное изображение. Как только загрузится, оно появится само.',
    'Die Galerie wird noch geladen – hier ist vorerst das Hauptbild. Es wird automatisch ergänzt.',
    'Galerie en cours de récupération - voici l’image principale en attendant ; elle se complétera automatiquement.',
    'Aún se está obteniendo la galería: por ahora mostramos la imagen principal; se completará automáticamente.',
    'A galeria ainda está sendo buscada - mostrando a imagem principal por enquanto; ela será completada automaticamente.',
    'La galleria è ancora in recupero: per ora mostriamo l’immagine principale; si completerà da sola.',
    'Galeria wciąż się wczytuje — na razie pokazujemy obraz główny; uzupełni się automatycznie.',
    'Galeri hâlâ alınıyor - şimdilik ana görseli gösteriyoruz; geldiğinde kendiliğinden tamamlanacak.',
    'กำลังดึงแกลเลอรีอยู่ ระหว่างนี้แสดงภาพหลักก่อน เมื่อได้แล้วจะเติมให้อัตโนมัติ'
  ]],
  ['没能取到更多图集（可能被 Cloudflare 拦住，或该 Mod 没有额外图片）。', [
    '沒能取得更多圖集（可能被 Cloudflare 攔住，或該 Mod 沒有額外圖片）。',
    'Could not fetch more gallery images (Cloudflare may be blocking, or this mod has no extra images).',
    'これ以上のギャラリーを取得できませんでした（Cloudflare に遮られているか、この Mod に追加画像がない可能性があります）。',
    '갤러리를 더 가져오지 못했습니다(Cloudflare에 막혔거나 이 Mod에 추가 이미지가 없을 수 있습니다).',
    'Не удалось получить больше изображений галереи (возможно, блокирует Cloudflare или у мода нет дополнительных изображений).',
    'Es konnten keine weiteren Galeriebilder geladen werden (evtl. blockiert Cloudflare, oder der Mod hat keine weiteren Bilder).',
    "Impossible de récupérer plus d'images (Cloudflare bloque peut-être, ou ce mod n'a pas d'images supplémentaires).",
    'No se pudieron obtener más imágenes (puede que Cloudflare lo bloquee o que este mod no tenga imágenes adicionales).',
    'Não foi possível obter mais imagens (o Cloudflare pode estar bloqueando ou este mod não tem imagens extras).',
    'Non è stato possibile recuperare altre immagini (forse Cloudflare blocca o questo mod non ha immagini extra).',
    'Nie udało się pobrać kolejnych obrazów (być może blokuje Cloudflare lub mod nie ma dodatkowych obrazów).',
    'Daha fazla galeri görseli alınamadı (Cloudflare engelliyor olabilir veya bu modun ek görseli yok).',
    'ดึงภาพแกลเลอรีเพิ่มไม่ได้ (อาจถูก Cloudflare บล็อก หรือมอดนี้ไม่มีภาพเพิ่มเติม)'
  ]],
  // ---------- ⑲ 「已下载」+「未安装」两个筛选可以同时开（2026-11-10） ----------
  ['（「已下载」+「未安装」同时开着）', ['（「已下載」+「未安裝」同時開著）', '("Downloaded" + "Not installed" both on)',
    '（「ダウンロード済み」+「未インストール」を同時に表示中）', "('다운로드됨' + '설치 안 됨' 동시 켜짐)", '(включены и «Скачано», и «Не установлено»)',
    '(„Heruntergeladen“ + „Nicht installiert“ beide aktiv)', '(« Téléchargé » + « Non installé » activés ensemble)',
    '(«Descargado» + «No instalado» activados a la vez)', '("Baixado" + "Não instalado" ativados juntos)',
    '(«Scaricato» + «Non installato» attivi insieme)', '(„Pobrane“ + „Niezainstalowane“ włączone razem)',
    '(«İndirildi» + «Kurulmadı» birlikte açık)', '(เปิดทั้ง "ดาวน์โหลดแล้ว" และ "ยังไม่ติดตั้ง")']],
  ['已下载 共 %s 个', ['已下載 共 %s 個', 'Downloaded total %s', 'ダウンロード済み 計 %s 個', '다운로드됨 총 %s개',
    'Скачано всего: %s', 'Heruntergeladen gesamt %s', 'Téléchargés au total %s', 'Descargados en total %s',
    'Baixados no total %s', 'Scaricati in totale %s', 'Pobrane łącznie %s', 'Toplam indirilen %s', 'ดาวน์โหลดแล้วทั้งหมด %s']],
  ['这条件下没有已下载但没装的 Mod', ['這條件下沒有已下載但沒裝的 Mod', 'No downloaded-but-not-installed mods match this filter',
    'この条件に合う「ダウンロード済みで未インストール」の Mod はありません', "이 조건에 맞는 '다운로드했지만 설치 안 된' Mod가 없습니다",
    'Под этот фильтр не подходит ни один скачанный, но не установленный мод', 'Keine heruntergeladenen, aber nicht installierten Mods für diesen Filter',
    'Aucun mod téléchargé mais non installé ne correspond à ce filtre', 'Ningún mod descargado pero no instalado coincide con este filtro',
    'Nenhum mod baixado mas não instalado corresponde a este filtro', 'Nessuna mod scaricata ma non installata corrisponde a questo filtro',
    'Żaden pobrany, ale niezainstalowany mod nie pasuje do tego filtra', 'Bu filtreye uyan, indirilmiş ama kurulmamış mod yok',
    'ไม่มี Mod ที่ดาวน์โหลดแล้วแต่ยังไม่ติดตั้งตรงกับเงื่อนไขนี้']],
  ['已下载的有 %s 个，但都被关键词或黑名单筛掉了。清掉筛选再看看。', ['已下載的有 %s 個，但都被關鍵詞或黑名單篩掉了。清掉篩選再看看。',
    '%s are downloaded, but the keyword or blacklist filtered them all out. Clear the filters and try again.',
    'ダウンロード済みは %s 個ありますが、キーワードかブラックリストで全て除外されました。フィルターを解除して確認してください。',
    '다운로드된 항목이 %s개 있지만 키워드나 블랙리스트로 모두 걸러졌습니다. 필터를 해제하고 다시 보세요.',
    'Скачано %s, но все отфильтрованы ключевым словом или чёрным списком. Сбросьте фильтры.',
    '%s sind heruntergeladen, wurden aber durch Suchbegriff oder Blacklist alle ausgefiltert. Filter zurücksetzen.',
    '%s sont téléchargés, mais tous ont été filtrés par le mot-clé ou la liste noire. Effacez les filtres et réessayez.',
    'Hay %s descargados, pero el filtro de palabra clave o la lista negra los ocultaron todos. Borra los filtros y vuelve a mirar.',
    'Há %s baixados, mas todos foram filtrados pela palavra-chave ou pela lista negra. Limpe os filtros e veja de novo.',
    'Ce ne sono %s scaricati, ma tutti filtrati dalla parola chiave o dalla blacklist. Azzera i filtri e riprova.',
    'Pobranych jest %s, ale wszystkie odfiltrowało słowo kluczowe lub czarna lista. Wyczyść filtry.',
    '%s indirilmiş var, ama hepsi anahtar sözcük veya kara liste tarafından elendi. Filtreleri temizleyip tekrar bakın.',
    'ดาวน์โหลดแล้ว %s รายการ แต่ถูกคำค้นหรือบัญชีดำกรองออกทั้งหมด ล้างตัวกรองแล้วดูอีกครั้ง']],

  // ── ⑳ 0.4.14：设置页「打开游戏目录 / 打开 Mod 目录」（2 条）────────────────
  // 这两个按钮文案在 app.js 的模板串里，抽取器本该自动捞；登记一遍更保险
  // （脚本是幂等的：keys.json 里已有就跳过，不会重复加）。
  ['打开游戏目录', [
    '打開遊戲目錄',
    'Open game folder',
    'ゲームフォルダーを開く',
    '게임 폴더 열기',
    'Открыть папку игры',
    'Spielordner öffnen',
    'Ouvrir le dossier du jeu',
    'Abrir la carpeta del juego',
    'Abrir a pasta do jogo',
    'Apri la cartella del gioco',
    'Otwórz folder gry',
    'Oyun klasörünü aç',
    'เปิดโฟลเดอร์เกม'
  ]],
  ['打开 Mod 目录', [
    '打開 Mod 目錄',
    'Open mods folder',
    'Mod フォルダーを開く',
    '모드 폴더 열기',
    'Открыть папку модов',
    'Mod-Ordner öffnen',
    'Ouvrir le dossier des mods',
    'Abrir la carpeta de mods',
    'Abrir a pasta de mods',
    'Apri la cartella dei mod',
    'Otwórz folder modów',
    'Mod klasörünü aç',
    'เปิดโฟลเดอร์มอด'
  ]],

  // ── ㉑ 0.4.22：「有 bug」标记改红 + 已安装页顶部「有 bug / 不含 bug」筛选（4 条）──
  // 角标文案（⚠ 有 bug）0.4.11 就登记过，这里只补筛选按钮与两条提示。
  ['有 bug', [
    '有 bug','Has bug','バグあり','버그 있음','Есть баг','Fehlerhaft','Bug signalé','Con fallo','Com falha','Con bug','Ma błąd','Hatalı','มีบั๊ก'
  ]],
  ['不含 bug', [
    '不含 bug','No bugged mods','バグありを除外','버그 없음만','Без багов','Ohne Fehler-Mods','Sans mods bugués','Sin mods con fallos','Sem mods com falha','Senza mod con bug','Bez modów z błędem','Hatalı olmayanlar','ไม่รวมที่มีบั๊ก'
  ]],
  ['只看标记过「有 bug」的 Mod', [
    '只看標記過「有 bug」的 Mod','Only show mods you marked as buggy','「バグあり」に印を付けた Mod だけ表示','버그 있음으로 표시한 Mod만 보기','Показывать только моды с отметкой «есть баг»','Nur als fehlerhaft markierte Mods anzeigen','Afficher uniquement les mods marqués comme bugués','Mostrar solo los mods marcados como defectuosos','Mostrar só os mods marcados como com falha','Mostra solo i mod segnati come con bug','Pokaż tylko mody oznaczone jako błędne','Yalnızca hatalı olarak işaretlediklerini göster','แสดงเฉพาะ Mod ที่ทำเครื่องหมายว่ามีบั๊ก'
  ]],
  ['把标记过「有 bug」的 Mod 藏起来', [
    '把標記過「有 bug」的 Mod 藏起來','Hide the mods you marked as buggy','「バグあり」に印を付けた Mod を隠す','버그 있음으로 표시한 Mod 숨기기','Скрыть моды с отметкой «есть баг»','Als fehlerhaft markierte Mods ausblenden','Masquer les mods marqués comme bugués','Ocultar los mods marcados como defectuosos','Ocultar os mods marcados como com falha','Nascondi i mod segnati come con bug','Ukryj mody oznaczone jako błędne','Hatalı olarak işaretlenenleri gizle','ซ่อน Mod ที่ทำเครื่องหมายว่ามีบั๊ก'
  ]],
﻿  // ㉒「已验证」标记（用户 2026-11-10：实测好用的可以标为已验证）
  ['✓ 已验证', [
    '✓ 已驗證','✓ Verified','✓ 検証済み','✓ 검증됨','✓ Проверено','✓ Geprüft','✓ Vérifié','✓ Verificado','✓ Verificado','✓ Verificato','✓ Sprawdzony','✓ Doğrulandı','✓ ยืนยันแล้ว'
  ]],
  ['未验证', [
    '未驗證','Not verified','未検証','미검증','Не проверено','Nicht geprüft','Non vérifié','No verificado','Não verificado','Non verificato','Niezweryfikowane','Doğrulanmadı','ยังไม่ยืนยัน'
  ]],
  ['标记已验证', [
    '標記已驗證','Mark as verified','検証済みにする','검증됨으로 표시','Отметить как проверенный','Als geprüft markieren','Marquer comme vérifié','Marcar como verificado','Marcar como verificado','Segna come verificato','Oznacz jako sprawdzony','Doğrulandı olarak işaretle','ทำเครื่องหมายว่ายืนยันแล้ว'
  ]],
  ['✓ 标为已验证', [
    '✓ 標為已驗證','✓ Mark verified','✓ 検証済みにする','✓ 검증 표시','✓ Отметить','✓ Als geprüft markieren','✓ Marquer vérifié','✓ Marcar verificado','✓ Marcar verificado','✓ Segna verificato','✓ Oznacz','✓ İşaretle','✓ ทำเครื่องหมาย'
  ]],
  ['点一下取消「已验证」标记', [
    '點一下取消「已驗證」標記','Click to remove the "verified" mark','クリックで「検証済み」を解除','클릭하면 「검증됨」 표시가 해제됩니다','Нажмите, чтобы снять отметку «проверено»','Klicken, um die Markierung „Geprüft“ zu entfernen','Cliquez pour retirer la marque « vérifié »','Haz clic para quitar la marca «verificado»','Clique para remover a marca «verificado»','Clicca per togliere il segno «verificato»','Kliknij, aby usunąć oznaczenie „sprawdzony”','«Doğrulandı» işaretini kaldırmak için tıkla','คลิกเพื่อยกเลิกเครื่องหมาย «ยืนยันแล้ว»'
  ]],
  ['我实测过它能用 —— 打上「已验证」，之后可以按这个筛', [
    '我實測過它能用 —— 打上「已驗證」，之後可以按這個篩','I tested it and it works — mark it verified so you can filter by it later','実際に動いたので「検証済み」を付けます（後で絞り込めます）','직접 써 보고 정상 작동해서 「검증됨」으로 표시합니다(나중에 필터 가능)','Я проверил, всё работает — отметить как проверенный, чтобы потом фильтровать','Selbst getestet und läuft — als geprüft markieren, um später danach zu filtern','Testé et fonctionnel — marquez-le vérifié pour pouvoir filtrer ensuite','Lo probé y funciona: márcalo como verificado para poder filtrar después','Testei e funciona — marque como verificado para filtrar depois','Provato e funziona: segnalo come verificato per filtrare dopo','Sprawdziłem, działa — oznacz jako sprawdzony, by później filtrować','Kendim denedim, çalışıyor — doğrulandı olarak işaretle, sonra filtreleyebilirsin','ฉันลองแล้วใช้งานได้ — ทำเครื่องหมายว่ายืนยันแล้ว เพื่อกรองภายหลัง'
  ]],
  ['把标记过「已验证」的 Mod 藏起来', [
    '把標記過「已驗證」的 Mod 藏起來','Hide the mods you marked as verified','「検証済み」に印を付けた Mod を隠す','검증됨으로 표시한 Mod 숨기기','Скрыть моды с отметкой «проверено»','Als geprüft markierte Mods ausblenden','Masquer les mods marqués comme vérifiés','Ocultar los mods marcados como verificados','Ocultar os mods marcados como verificados','Nascondi i mod segnati come verificati','Ukryj mody oznaczone jako sprawdzone','Doğrulanmış olarak işaretlenenleri gizle','ซ่อน Mod ที่ทำเครื่องหมายว่ายืนยันแล้ว'
  ]],
  // ㉓ Mod 库排序（用户 2026-11-10：按开启时间排序，排查新装的 Mod）
  ['开启时间', [
    '開啟時間','Enabled at','有効化日時','활성화 시간','Время включения','Aktiviert am','Activé le','Activado el','Ativado em','Attivato il','Włączono','Etkinleştirme','เวลาที่เปิดใช้งาน'
  ]],
  ['开启时间 ↓', [
    '開啟時間 ↓','Enabled ↓','有効化日時 ↓','활성화 시간 ↓','Включено ↓','Aktiviert ↓','Activé ↓','Activado ↓','Ativado ↓','Attivato ↓','Włączono ↓','Etkinleştirme ↓','เปิดใช้งาน ↓'
  ]],
  ['开启时间 ↑', [
    '開啟時間 ↑','Enabled ↑','有効化日時 ↑','활성화 시간 ↑','Включено ↑','Aktiviert ↑','Activé ↑','Activado ↑','Ativado ↑','Attivato ↑','Włączono ↑','Etkinleştirme ↑','เปิดใช้งาน ↑'
  ]],
  ['安装时间 ↓', [
    '安裝時間 ↓','Installed ↓','インストール日時 ↓','설치 시간 ↓','Установлено ↓','Installiert ↓','Installé ↓','Installado ↓','Instalado ↓','Installato ↓','Zainstalowano ↓','Kurulum ↓','ติดตั้ง ↓'
  ]],
  ['（按安装时间推算）', [
    '（依安裝時間推算）','(estimated from install time)','（インストール日時から推定）','(설치 시간 기준 추정)','(по времени установки)','(aus Installationszeit geschätzt)','(estimé d’après l’installation)','(estimado según la instalación)','(estimado pela instalação)','(stimato dall’installazione)','(szacowane z czasu instalacji)','(kurulum zamanından tahmini)','(ประมาณจากเวลาติดตั้ง)'
  ]],
  // ㉔ 批量标记（用户 2026-11-10：全选之后要能一次标 喜欢 / 不喜欢 / 有 bug / 已验证 / 未验证）
  ['👍 喜欢', [
    '👍 喜歡','👍 Like','👍 いいね','👍 좋아요','👍 Нравится','👍 Gefällt mir','👍 J’aime','👍 Me gusta','👍 Gostei','👍 Mi piace','👍 Lubię','👍 Beğendim','👍 ชอบ'
  ]],
  ['👎 不喜欢', [
    '👎 不喜歡','👎 Not interested','👎 興味なし','👎 관심 없음','👎 Не интересно','👎 Nicht interessiert','👎 Pas intéressé','👎 No me interesa','👎 Não me interessa','👎 Non mi interessa','👎 Nie interesuje','👎 İlgilenmiyorum','👎 ไม่สนใจ'
  ]],
  ['移出黑名单', [
    '移出黑名單','Remove from blocklist','ブロック解除','차단 해제','Убрать из чёрного списка','Aus der Sperrliste entfernen','Retirer de la liste noire','Quitar de la lista negra','Remover da lista de bloqueio','Rimuovi dalla lista nera','Usuń z czarnej listy','Kara listeden çıkar','เอาออกจากรายการบล็อก'
  ]],
  ['取消「有 bug」', [
    '取消「有 bug」','Remove “has bug”','「不具合あり」を解除','「버그 있음」 해제','Снять «есть баг»','„Fehlerhaft“ entfernen','Retirer « bug »','Quitar «tiene bug»','Remover «tem bug»','Togli «ha bug»','Usuń „ma błąd”','«Hatalı» işaretini kaldır','ยกเลิก «มีบั๊ก»'
  ]],
  ['取消「已验证」', [
    '取消「已驗證」','Remove “verified”','「検証済み」を解除','「검증됨」 해제','Снять «проверено»','„Geprüft“ entfernen','Retirer « vérifié »','Quitar «verificado»','Remover «verificado»','Togli «verificato»','Usuń „sprawdzony”','«Doğrulandı» işaretini kaldır','ยกเลิก «ยืนยันแล้ว»'
  ]],
  ['先勾选要标记的 Mod', [
    '先勾選要標記的 Mod','Select the mods to mark first','先にマークする Mod を選んでください','먼저 표시할 Mod를 선택하세요','Сначала выберите моды для отметки','Erst die zu markierenden Mods auswählen','Sélectionnez d’abord les mods à marquer','Primero selecciona los mods a marcar','Selecione primeiro os mods a marcar','Prima seleziona i mod da contrassegnare','Najpierw zaznacz mody do oznaczenia','Önce işaretlenecek modları seçin','เลือก Mod ที่จะทำเครื่องหมายก่อน'
  ]],
  ['选中的条目都没有 Nexus Mod ID，标不上（标记靠 Mod ID 认人）', [
    '選中的項目都沒有 Nexus Mod ID，標不上（標記靠 Mod ID 認人）','None of the selected items has a Nexus mod ID — marks are keyed by mod ID','選択した項目に Nexus Mod ID がないためマークできません（マークは Mod ID で識別）','선택한 항목에 Nexus Mod ID가 없어 표시할 수 없습니다(표시는 Mod ID 기준)','У выбранных записей нет Nexus Mod ID — отметки привязаны к ID','Keine der ausgewählten Dateien hat eine Nexus-Mod-ID — Markierungen hängen an der Mod-ID','Aucun élément sélectionné n’a d’ID Nexus — les marques sont liées à l’ID','Ningún elemento seleccionado tiene ID de Nexus: las marcas se guardan por ID','Nenhum item selecionado tem ID do Nexus — as marcas são por ID','Nessun elemento selezionato ha un ID Nexus: i contrassegni sono legati all’ID','Żaden zaznaczony element nie ma Nexus Mod ID — oznaczenia trzymają się ID','Seçilen öğelerin Nexus Mod ID’si yok — işaretler ID’ye bağlıdır','รายการที่เลือกไม่มี Nexus Mod ID จึงทำเครื่องหมายไม่ได้ (ใช้ Mod ID ระบุ)'
  ]],
  ['已标记喜欢：%s 个', [
    '已標記喜歡：%s 個','Marked as liked: %s','いいねを付けました：%s 件','좋아요 표시: %s개','Отмечено «нравится»: %s','Als „gefällt mir“ markiert: %s','Marqué comme aimé : %s','Marcado como me gusta: %s','Marcado como gostei: %s','Contrassegnato come mi piace: %s','Oznaczono jako lubię: %s','Beğenildi olarak işaretlendi: %s','ทำเครื่องหมายชอบแล้ว: %s'
  ]],
  ['已取消喜欢：%s 个', [
    '已取消喜歡：%s 個','Removed the like from: %s','いいねを外しました：%s 件','좋아요 취소: %s개','Снято «нравится»: %s','„Gefällt mir“ entfernt: %s','Mention « j’aime » retirée : %s','Se quitó «me gusta» de: %s','«Gostei» removido de: %s','Rimosso «mi piace» da: %s','Usunięto „lubię” z: %s','Beğeni kaldırıldı: %s','ยกเลิกชอบแล้ว: %s'
  ]],
  ['已加入黑名单：%s 个', [
    '已加入黑名單：%s 個','Added to blocklist: %s','ブロックリストに追加：%s 件','차단 목록에 추가: %s개','Добавлено в чёрный список: %s','Zur Sperrliste hinzugefügt: %s','Ajouté à la liste noire : %s','Añadido a la lista negra: %s','Adicionado à lista de bloqueio: %s','Aggiunto alla lista nera: %s','Dodano do czarnej listy: %s','Kara listeye eklendi: %s','เพิ่มในรายการบล็อกแล้ว: %s'
  ]],
  ['已移出黑名单：%s 个', [
    '已移出黑名單：%s 個','Removed from blocklist: %s','ブロックリストから削除：%s 件','차단 목록에서 제거: %s개','Убрано из чёрного списка: %s','Aus der Sperrliste entfernt: %s','Retiré de la liste noire : %s','Quitado de la lista negra: %s','Removido da lista de bloqueio: %s','Rimosso dalla lista nera: %s','Usunięto z czarnej listy: %s','Kara listeden çıkarıldı: %s','เอาออกจากรายการบล็อกแล้ว: %s'
  ]],
  ['已标记「有 bug」：%s 个', [
    '已標記「有 bug」：%s 個','Marked as “has bug”: %s','「不具合あり」を付けました：%s 件','「버그 있음」 표시: %s개','Отмечено «есть баг»: %s','Als „Fehlerhaft“ markiert: %s','Marqué « bug » : %s','Marcado como «tiene bug»: %s','Marcado como «tem bug»: %s','Contrassegnato «ha bug»: %s','Oznaczono „ma błąd”: %s','«Hatalı» olarak işaretlendi: %s','ทำเครื่องหมาย «มีบั๊ก» แล้ว: %s'
  ]],
  ['已取消「有 bug」：%s 个', [
    '已取消「有 bug」：%s 個','Removed “has bug” from: %s','「不具合あり」を解除：%s 件','「버그 있음」 해제: %s개','Снято «есть баг»: %s','„Fehlerhaft“ entfernt: %s','« bug » retiré : %s','«tiene bug» quitado de: %s','«tem bug» removido de: %s','«ha bug» rimosso da: %s','Usunięto „ma błąd” z: %s','«Hatalı» işareti kaldırıldı: %s','ยกเลิก «มีบั๊ก» แล้ว: %s'
  ]],
  ['已标记「已验证」：%s 个', [
    '已標記「已驗證」：%s 個','Marked as verified: %s','「検証済み」を付けました：%s 件','「검증됨」 표시: %s개','Отмечено «проверено»: %s','Als „Geprüft“ markiert: %s','Marqué « vérifié » : %s','Marcado como «verificado»: %s','Marcado como «verificado»: %s','Contrassegnato «verificato»: %s','Oznaczono „sprawdzony”: %s','«Doğrulandı» işaretlendi: %s','ทำเครื่องหมาย «ยืนยันแล้ว» แล้ว: %s'
  ]],
  ['已取消「已验证」：%s 个', [
    '已取消「已驗證」：%s 個','Removed “verified” from: %s','「検証済み」を解除：%s 件','「검증됨」 해제: %s개','Снято «проверено»: %s','„Geprüft“ entfernt: %s','« vérifié » retiré : %s','«verificado» quitado de: %s','«verificado» removido de: %s','«verificato» rimosso da: %s','Usunięto „sprawdzony” z: %s','«Doğrulandı» işareti kaldırıldı: %s','ยกเลิก «ยืนยันแล้ว» แล้ว: %s'
  ]],
  ['（失败 %s 个）', [
    '（失敗 %s 個）','(%s failed)','（%s 件失敗）','(%s개 실패)','(ошибок: %s)','(%s fehlgeschlagen)','(%s échecs)','(%s fallos)','(%s falhas)','(%s non riusciti)','(nie udało się: %s)','(%s başarısız)','(ล้มเหลว %s)'
  ]],

  // ---------- ㉕ 恢复 Mod 库缺失功能（0.5.5） ----------
  ['显示内置脚本', ['顯示內建腳本', 'Show built-in scripts', '内蔵スクリプトを表示', '내장 스크립트 표시', 'Показать встроенные скрипты', 'Eingebaute Skripte anzeigen', 'Afficher les scripts intégrés', 'Mostrar scripts integrados', 'Mostrar scripts integrados', 'Mostra script integrati', 'Pokaż wbudowane skrypty', 'Yerleşik betikleri göster', 'แสดงสคริปต์ในตัว']],
  ['显示 UE4SS 自带的 10 个内置脚本模组（默认藏起来，免得和真 Mod 混在一起）', ['顯示 UE4SS 內建的 10 個腳本模組（預設隱藏，免得和真 Mod 混在一起）', 'Show the 10 script mods bundled with UE4SS (hidden by default so they do not mix with real mods)', 'UE4SS に同梱のスクリプト MOD 10 個を表示（実際の MOD と混ざらないよう既定では非表示）', 'UE4SS에 포함된 스크립트 모드 10개 표시(실제 모드와 섞이지 않도록 기본은 숨김)', 'Показать 10 скриптовых модов из UE4SS (по умолчанию скрыты, чтобы не смешивались с настоящими модами)', 'Die 10 Skript-Mods aus UE4SS anzeigen (standardmäßig ausgeblendet, damit sie sich nicht mit echten Mods vermischen)', 'Afficher les 10 mods de script fournis avec UE4SS (masqués par défaut pour ne pas les mélanger aux vrais mods)', 'Mostrar los 10 mods de script incluidos con UE4SS (ocultos por defecto para no mezclarlos con mods reales)', 'Mostrar os 10 mods de script incluídos com o UE4SS (ocultos por padrão para não se misturar com mods reais)', 'Mostra i 10 mod di script inclusi in UE4SS (nascosti per impostazione predefinita per non mescolarli ai mod reali)', 'Pokaż 10 modów skryptowych dołączonych do UE4SS (domyślnie ukryte, aby nie mieszały się z prawdziwymi modami)', 'UE4SS ile gelen 10 betik modunu göster (gerçek modlarla karışmaması için varsayılan olarak gizli)', 'แสดงมอดสคริปต์ 10 รายการที่มาพร้อม UE4SS (ซ่อนไว้เป็นค่าเริ่มต้นเพื่อไม่ให้ปนกับมอดจริง)']],
  ['本地记录的分类要等 Nexus 信息补全后才出现', ['本機記錄的分類要等 Nexus 資訊補全後才會出現', 'Categories for local entries appear after their Nexus info is filled in', 'ローカル項目の分類は Nexus の情報が揃うと表示されます', '로컬 항목의 분류는 Nexus 정보가 채워지면 나타납니다', 'Категории локальных записей появятся после заполнения данных Nexus', 'Kategorien für lokale Einträge erscheinen, sobald die Nexus-Infos ergänzt sind', 'Les catégories des entrées locales apparaissent une fois les infos Nexus complétées', 'Las categorías de las entradas locales aparecen cuando se completan los datos de Nexus', 'As categorias das entradas locais aparecem quando as informações do Nexus são preenchidas', 'Le categorie delle voci locali compaiono quando le informazioni Nexus sono complete', 'Kategorie lokalnych wpisów pojawią się po uzupełnieniu informacji z Nexusa', 'Yerel kayıtların kategorileri Nexus bilgileri tamamlanınca görünür', 'หมวดหมู่ของรายการในเครื่องจะแสดงเมื่อข้อมูล Nexus ครบถ้วน']]
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
  // ⚠️ 这里**没有** `这条任务缺少 Mod ID / 文件 ID，无法自动授权（可点「手动」）。` ——
  //    上一轮把它拆成了下面三条更具体的文案，`autoauth-fileid-test.js` 明确断言
  //    「旧的笼统键已从 keys.json 移除」。曾经漏删过：源码与语言包都干净了，
  //    只留着 EXTRA 这一行没动，直到下一次重跑 `_rebuild-keys.js` 又把它捞回 keys.json，
  //    测试立刻转红（"旧的笼统键已从 keys.json 移除 → 还在"）。改文案时别忘了同步这里。
  '管理器上次退出时任务未完成；请重新授权或重试。',
  // ── 自动授权失败原因（nexusAutoAuth.js :: humanize()）──
  // 这几条会直接落进下载卡片的错误行，是用户最常看到的报错。
  'Nexus 未登录（或登录已失效）。到「Nexus 账号」里登录一次即可。',
  '被 Cloudflare 人机验证拦住了，请稍后再试；也可以对该 mod 点「手动授权」在窗口里点一下。',
  '这个文件没有「Mod Manager Download」链接（作者只开了手动下载），请点「手动授权」。',
  // 「文件刚上传、还没同步到文件服务器」——与上一条长得像，但话和后续动作完全不同：
  // 上一条要对用户说「作者关了管理器下载」，这一条要说「等几分钟再点自动授权」。
  '这个文件刚上传，Nexus 还在把它同步到文件服务器，暂时给不出管理器下载链接。过几分钟再点「自动授权」即可。',
  // `连不上 Nexus（${reason}），稍后再试…` —— reason 是运行时的英文错误码（不是数字），
  // 形状键的 `%s` 只通配数字，所以按**前后两段片段**登记，靠 ③ 子串替换拼回去。
  '连不上 Nexus（',
  '），稍后再试或点「手动授权」。',
  '这条任务缺少 Mod ID / 文件 ID，无法自动授权。',
  // ⚠️ 下面三条是 `ipc.js :: autoAuthorizeTask()` 里 `markAuthFailed()` 的 reason，
  //    会原样显示在下载卡片的错误行上。曾经漏在 EXTRA 外，
  //    重跑 `_rebuild-keys.js` 时被当成「源码里没有的旧词条」洗掉，
  //    `_sync-packs.js --apply` 接着把 13 个语言包里的译文一并删了 ——
  //    于是英文界面弹出中文报错。主进程文案必须**手工**登记在这里。
  '这条任务没有来源 Mod ID，无法自动授权（可点「手动」）。',
  '这个 Mod 在 Nexus 上没有可下载的文件，无法自动授权（可点「手动」）。',
  '取不到这个 Mod 的文件列表（网络或接口问题），稍后再试或点「手动」。',
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
  // ⚠️ 下面这几条是「数字夹在词中间」的句子，**片段替换救不了**：
  //    `处理 3 项`   → `处理` 只有 2 字，进不了片段表（MIN_FRAGMENT=3），
  //                    而剥噪声要求词核心**整串**命中字典，`项` 是汉字剥不掉。
  //    `仍有 3 项需要你挑内容` → 片段能换掉后半句，但前面剩个 `仍有`，
  //                    ③ 的验收是「结果里不能再有中文」→ 整句被拒。
  //    所以必须按形状键（`%s`）登记，让 ③ 一次吃下整句、把数字原样回填。
  '处理 %s 项',
  '仍有 %s 项需要你挑内容',
  '正在处理 %s 项',
  '已停止 %s 项（进度已保留，可点「全部恢复」接着下）',
  '失败 %s',
  // ⚠️ 源码是 `包里有 ${n} 套内容，其中 ${g} 组是同一件东西的不同版本 …`（app.js:385）。
  //    提取器只抽出中间那几个**片段**（`套内容，其中` / `组是同一件东西…`），
  //    可开头那个 `包里有` 没被登记成键 —— 片段替换跑完还剩个中文 `包里有`，
  //    ③ 的「结果无中文」验收直接否掉整句，英文界面就整条留中文。
  //    把它整句登记成形状键，一次吃掉两个数字位。
  '包里有 %s 套内容，其中 %s 组是同一件东西的不同版本 —— 已按「每组第一套」替你选好，点「一键安装」即可（想改就点「选择内容」）',
  '包里有 %s 套内容，互不相关 —— 点「一键安装」全部装上',
  // 界面把超过 40 字的落点说明截成 38 字 + `…`（app.js 的 `whyText`），
  // 截断后的形态也自成一条 —— 不补的话下载列表里这条永远是中文。
  'CNS 服装数据（pak + .dekcns / .dekani）全部原样放…',

  // ── 0.2.4：已安装页「同一 Mod 多文件合并」+ 浏览页 👍/👎 引入的数字句 ──
  // 这一批的共同特点是**数字落在句首或句中**，提取器只抽得出两侧的片段：
  //   `3 个已装文件`      → 片段 `个已装文件`（数字在前的样子拼不回英文语序）
  //   `已启用 3 个文件`   → 片段 `已启用` 已经是 3 字键，替换后剩「Enabled 3 个文件」
  //   `已安装的文件（3 个，可逐个操作）` → 两侧片段都在，但中文括号与语序无法自洽
  // 一律登记成形状键，让 ③ 一次吃下整句、把数字原样回填进译文的占位处。
  '%s 个已装文件',
  '这个 Mod 装了 %s 个文件，点开卡片可以逐个启用 / 禁用 / 卸载',
  '已安装的文件（%s 个，可逐个操作）',
  '已启用 %s 个文件',
  '已禁用 %s 个文件',
  '已卸载 %s 个文件',
  '已卸载 %s / %s 个文件，有 %s 个失败',
  '作用于这个 Mod 已安装的全部 %s 个文件',
  '逐个移除这 %s 个文件',

  // ── 0.2.11：设置页「数据目录可改位置 + 一键搬运」────────────────────────
  // ⚠️ 这一批里的**普通句子**由渲染层抽取器自动捞（app.js），不用登记；
  //    下面两条是 `ipc.js :: data:migrate / data:setDir` 抛的**主进程**文案
  //    （抽取器只扫渲染层），而且**句首就是数字**、句中还夹 `/`：
  //      形状键的 `%s` 只通配数字串，所以必须整句登记成一个形状键，
  //      靠片段替换是拼不回来的（`还有` 只有 2 字，进不了片段表）。
  '还有 %s 个下载 / 安装任务在跑，先暂停或等它跑完再搬数据',
  '还有 %s 个下载 / 安装任务在跑，先处理完再改数据位置'
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

  // 2026-11-10：语言包现在统一是 CRLF（早期只有 LF），两种行尾都要吃。
  // 这里不用正则、也不用模板里的转义 —— 直接拿字符码拼，避免行尾被工具层改写。
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const EOL = src.indexOf(CR + LF) >= 0 ? CR + LF : LF;
  let end = src;
  while (end.endsWith(LF) || end.endsWith(CR)) end = end.slice(0, -1);
  const tailA = EOL + '  });' + EOL + '})();';
  const tailB = ',' + tailA;
  let cut = '';
  if (end.endsWith(tailB)) cut = tailB;
  else if (end.endsWith(tailA)) cut = tailA;
  if (!cut) { console.log(`  ✗ ${code}: 结尾格式不匹配，未改动`); continue; }

  const lines = need.map(n => `    '${jsq(n.key)}': '${jsq(n.t[code])}',`).join(EOL);
  // 上一行末尾补逗号 + 追加新行
  src = end.slice(0, end.length - cut.length) + ',' + EOL + lines + EOL + '  });' + EOL + '})();' + EOL;
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
