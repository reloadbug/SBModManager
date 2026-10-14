'use strict';
/**
 * 第三十一轮：新增 / 变更 1 条 i18n 文案（「文件刚上传，Nexus 还没同步好」）。
 *
 * 做法：键表（_probe/i18n-keys.json）与 13 个语言包**完全同序**（已校验），
 * 所以先在键表里按码点排序算出插入位，再在**同一个索引**对应的那一行前面插进语言包。
 * 不用手工数行，也不会把顺序搞乱。
 *
 * 用法：node _probe/_i18n-add-30.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS_FILE = path.join(ROOT, '_probe', 'i18n-keys.json');
const LOCALES = path.join(ROOT, 'src', 'renderer', 'locales');

const NEW_KEY = '这个文件刚上传，Nexus 还在把它同步到文件服务器，暂时给不出管理器下载链接。过几分钟再点「自动授权」即可。';

const T = {
  'en-US': 'This file was just uploaded — Nexus is still syncing it to its file servers, so no mod-manager download link is available yet. Click "Auto authorize" again in a few minutes.',
  'zh-TW': '這個檔案剛上傳，Nexus 還在把它同步到檔案伺服器，暫時給不出管理器下載連結。過幾分鐘再點「自動授權」即可。',
  'ja-JP': 'このファイルはアップロードされたばかりで、Nexus がまだファイルサーバーへ同期しています。そのためマネージャー用のダウンロードリンクはまだ取得できません。数分後にもう一度「自動承認」を押してください。',
  'ko-KR': '이 파일은 방금 업로드되어 Nexus가 아직 파일 서버로 동기화하는 중입니다. 그래서 매니저 다운로드 링크를 아직 받을 수 없습니다. 몇 분 후에 "자동 승인"을 다시 누르세요.',
  'de-DE': 'Diese Datei wurde gerade hochgeladen — Nexus synchronisiert sie noch mit den Dateiservern, daher gibt es noch keinen Mod-Manager-Downloadlink. Klicke in ein paar Minuten erneut auf „Automatisch autorisieren“.',
  'es-ES': 'Este archivo se acaba de subir — Nexus todavía lo está sincronizando con sus servidores de archivos, así que aún no hay enlace de descarga del gestor. Vuelve a pulsar «Autorización automática» en unos minutos.',
  'fr-FR': "Ce fichier vient d'être mis en ligne — Nexus est encore en train de le synchroniser avec ses serveurs de fichiers, donc aucun lien de téléchargement pour gestionnaire n'est disponible pour l'instant. Recliquez sur « Autorisation automatique » dans quelques minutes.",
  'it-IT': 'Questo file è appena stato caricato — Nexus lo sta ancora sincronizzando con i suoi file server, quindi il link di download per il gestore non è ancora disponibile. Premi di nuovo "Autorizzazione automatica" tra qualche minuto.',
  'pl-PL': 'Ten plik został właśnie przesłany — Nexus wciąż synchronizuje go z serwerami plików, więc link do pobierania przez menedżer nie jest jeszcze dostępny. Kliknij ponownie „Autoryzacja automatyczna” za kilka minut.',
  'pt-BR': 'Este arquivo acabou de ser enviado — o Nexus ainda o está sincronizando com os servidores de arquivos, então ainda não há link de download para o gerenciador. Clique em "Autorização automática" novamente em alguns minutos.',
  'ru-RU': 'Этот файл только что загружен — Nexus ещё синхронизирует его с файловыми серверами, поэтому ссылки для загрузки через менеджер пока нет. Нажмите «Автоавторизация» ещё раз через несколько минут.',
  'th-TH': 'ไฟล์นี้เพิ่งอัปโหลด Nexus ยังซิงก์ไฟล์ไปยังเซิร์ฟเวอร์อยู่ จึงยังไม่มีลิงก์ดาวน์โหลดผ่านตัวจัดการ โปรดกด "อนุญาตอัตโนมัติ" อีกครั้งในอีกสักครู่',
  'tr-TR': 'Bu dosya yeni yüklendi — Nexus hâlâ dosya sunucularına senkronize ediyor, bu yüzden yönetici indirme bağlantısı henüz yok. Birkaç dakika sonra "Otomatik yetkilendirme"ye tekrar basın.'
};

/** JS 单引号字面量（与现有语言包同风格：内部单引号转义） */
const jsStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

const rawKeys = fs.readFileSync(KEYS_FILE, 'utf8');
const keys = JSON.parse(rawKeys);

if (keys.includes(NEW_KEY)) { console.log('键表里已经有了，先退出（幂等）'); process.exit(0); }

// —— 1) 键表：按码点排序算出插入位 ——
const sorted = keys.concat(NEW_KEY).sort();
const idx = sorted.indexOf(NEW_KEY);
const nextKey = sorted[idx + 1];           // 原本排在这一位、现在要往下挪一条的那个键
if (nextKey === undefined) throw new Error('新键排到了最后一位，插入逻辑需要重看');

// 回写格式必须与原文一致（1 空格缩进 + 末尾一个换行），先自检
const render = (arr) => '[\n' + arr.map(k => ' ' + JSON.stringify(k)).join(',\n') + '\n]\n';
if (render(keys) !== rawKeys) throw new Error('keys.json 的回写格式与原文不一致，先对齐格式再插');
fs.writeFileSync(KEYS_FILE, render(sorted), 'utf8');
console.log(`键表：${keys.length} → ${sorted.length} 条，新键插在第 ${idx} 位（其后是「${nextKey.slice(0, 12)}…」）`);

// —— 2) 13 个语言包：在**同一个索引**对应的那一行前插 ——
const files = fs.readdirSync(LOCALES).filter(f => f.endsWith('.js')).sort();
let done = 0;
for (const f of files) {
  const code = f.replace(/\.js$/, '');
  const tr = T[code];
  if (!tr) { console.log(`  ⚠ 缺 ${code} 的译文，跳过`); continue; }
  const fp = path.join(LOCALES, f);
  const lines = fs.readFileSync(fp, 'utf8').split('\n');
  const anchor = lines.findIndex(l => l.trimStart().startsWith(jsStr(nextKey) + ':'));
  if (anchor < 0) { console.log(`  ⚠ ${f} 里找不到锚点行（${nextKey.slice(0, 10)}…），跳过`); continue; }
  lines.splice(anchor, 0, '    ' + jsStr(NEW_KEY) + ': ' + jsStr(tr) + ',');
  fs.writeFileSync(fp, lines.join('\n'), 'utf8');
  done++;
}
console.log(`语言包：${done}/${files.length} 个已插入`);
