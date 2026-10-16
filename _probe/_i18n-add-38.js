'use strict';
/**
 * 第三十八轮：新增 43 条 i18n 文案 —— 设置页「数据目录可改位置 + 一键搬运」。
 *
 * 本轮新增的都是设置页「存储」区块 + 搬运向导（选目录 → 探目标 → 问旧数据怎么办
 * → 搬运 → 提示重启）里的句子。里面有一批是**句中夹数字**的（形状键 `%s`）：
 *   · `这个目录里已经有 %s 个文件了`
 *   · `当前数据有 %s 个文件，要搬到新位置吗？`
 *   · `搬运了 %s 个文件，跳过 %s 个已存在的`
 *   · `还有 %s 个下载 / 安装任务在跑，…`（主进程，另见 i18n-add-keys.js 的 EXTRA）
 *
 * 做法与 `_i18n-add-34.js` 相同：键表（`_probe/i18n-keys.json`）与 13 个语言包
 * **完全同序**，先在键表里按码点排序算出插入位，再在同一个索引对应的那一行前面插。
 * 多条新增必须**从后往前插**（靠后的新键先落位，前面那条的锚点才一定存在）。
 *
 * 用法：node _probe/_i18n-add-38.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS_FILE = path.join(ROOT, '_probe', 'i18n-keys.json');
const LOCALES = path.join(ROOT, 'src', 'renderer', 'locales');

const NEW = [
  {
    key: '更改位置…',
    t: {
      'en-US': 'Change location…', 'zh-TW': '變更位置…', 'ja-JP': '場所を変更…',
      'ko-KR': '위치 변경…', 'de-DE': 'Speicherort ändern…', 'es-ES': 'Cambiar ubicación…',
      'fr-FR': 'Changer d’emplacement…', 'it-IT': 'Cambia posizione…',
      'pl-PL': 'Zmień lokalizację…', 'pt-BR': 'Alterar local…',
      'ru-RU': 'Изменить расположение…', 'th-TH': 'เปลี่ยนตำแหน่ง…', 'tr-TR': 'Konumu değiştir…'
    }
  },
  {
    key: '恢复默认',
    t: {
      'en-US': 'Restore default', 'zh-TW': '恢復預設', 'ja-JP': '既定に戻す',
      'ko-KR': '기본값으로 복원', 'de-DE': 'Standard wiederherstellen',
      'es-ES': 'Restaurar predeterminado', 'fr-FR': 'Rétablir la valeur par défaut',
      'it-IT': 'Ripristina predefinito', 'pl-PL': 'Przywróć domyślne',
      'pt-BR': 'Restaurar padrão', 'ru-RU': 'Восстановить по умолчанию',
      'th-TH': 'คืนค่าเริ่มต้น', 'tr-TR': 'Varsayılana dön'
    }
  },
  {
    key: '默认位置',
    t: {
      'en-US': 'Default location', 'zh-TW': '預設位置', 'ja-JP': '既定の場所',
      'ko-KR': '기본 위치', 'de-DE': 'Standardort', 'es-ES': 'Ubicación predeterminada',
      'fr-FR': 'Emplacement par défaut', 'it-IT': 'Posizione predefinita',
      'pl-PL': 'Lokalizacja domyślna', 'pt-BR': 'Local padrão',
      'ru-RU': 'Расположение по умолчанию', 'th-TH': 'ตำแหน่งเริ่มต้น', 'tr-TR': 'Varsayılan konum'
    }
  },
  {
    key: '自定义位置',
    t: {
      'en-US': 'Custom location', 'zh-TW': '自訂位置', 'ja-JP': 'カスタムの場所',
      'ko-KR': '사용자 지정 위치', 'de-DE': 'Benutzerdefinierter Ort',
      'es-ES': 'Ubicación personalizada', 'fr-FR': 'Emplacement personnalisé',
      'it-IT': 'Posizione personalizzata', 'pl-PL': 'Lokalizacja niestandardowa',
      'pt-BR': 'Local personalizado', 'ru-RU': 'Пользовательское расположение',
      'th-TH': 'ตำแหน่งที่กำหนดเอง', 'tr-TR': 'Özel konum'
    }
  },
  {
    key: '待重启生效',
    t: {
      'en-US': 'Pending restart', 'zh-TW': '待重啟生效', 'ja-JP': '再起動待ち',
      'ko-KR': '재시작 필요', 'de-DE': 'Neustart ausstehend', 'es-ES': 'Pendiente de reinicio',
      'fr-FR': 'Redémarrage requis', 'it-IT': 'Riavvio necessario',
      'pl-PL': 'Wymaga ponownego uruchomienia', 'pt-BR': 'Requer reinício',
      'ru-RU': 'Требуется перезапуск', 'th-TH': 'รอรีสตาร์ท', 'tr-TR': 'Yeniden başlatma bekliyor'
    }
  },
  {
    key: '数据目录可以改到别的盘（下载缓存与安装包会占用较多空间）。改完需要重启程序才生效。',
    t: {
      'en-US': 'The data folder can be moved to another drive (the download cache and installers take up a lot of space). The change takes effect after restarting the app.',
      'zh-TW': '資料目錄可以改到別的磁碟（下載快取與安裝包會佔用較多空間）。改完需要重新啟動程式才生效。',
      'ja-JP': 'データフォルダは別のドライブに変更できます（ダウンロードキャッシュとインストーラーは容量を多く使います）。変更はアプリの再起動後に有効になります。',
      'ko-KR': '데이터 폴더는 다른 드라이브로 옮길 수 있습니다(다운로드 캐시와 설치 파일이 많은 공간을 차지합니다). 변경 사항은 앱을 다시 시작한 후 적용됩니다.',
      'de-DE': 'Der Datenordner kann auf ein anderes Laufwerk verschoben werden (Download-Cache und Installationspakete belegen viel Speicher). Die Änderung wird nach einem Neustart wirksam.',
      'es-ES': 'La carpeta de datos puede moverse a otra unidad (la caché de descargas y los instaladores ocupan bastante espacio). El cambio se aplica al reiniciar la aplicación.',
      'fr-FR': 'Le dossier de données peut être déplacé vers un autre disque (le cache de téléchargement et les installateurs prennent beaucoup de place). La modification prend effet après le redémarrage de l’application.',
      'it-IT': 'La cartella dati può essere spostata su un altro disco (la cache dei download e gli installer occupano molto spazio). La modifica ha effetto dopo il riavvio dell’app.',
      'pl-PL': 'Folder danych można przenieść na inny dysk (pamięć podręczna pobierania i instalatory zajmują dużo miejsca). Zmiana działa po ponownym uruchomieniu programu.',
      'pt-BR': 'A pasta de dados pode ser movida para outro disco (o cache de downloads e os instaladores ocupam bastante espaço). A alteração entra em vigor ao reiniciar o aplicativo.',
      'ru-RU': 'Папку данных можно перенести на другой диск (кэш загрузок и установочные файлы занимают много места). Изменение вступит в силу после перезапуска приложения.',
      'th-TH': 'ย้ายโฟลเดอร์ข้อมูลไปยังไดรฟ์อื่นได้ (แคชการดาวน์โหลดและไฟล์ติดตั้งใช้พื้นที่ค่อนข้างมาก) การเปลี่ยนแปลงจะมีผลหลังรีสตาร์ทโปรแกรม',
      'tr-TR': 'Veri klasörü başka bir sürücüye taşınabilir (indirme önbelleği ve kurulum paketleri çok yer kaplar). Değişiklik, uygulama yeniden başlatıldıktan sonra geçerli olur.'
    }
  },
  {
    key: '设置的数据目录现在用不了（磁盘未连接或没有权限），已暂时回落到默认位置。恢复可用后重启程序即可切回。',
    t: {
      'en-US': 'The configured data folder is unavailable (drive not connected or no permission), so the default location is being used for now. Restart the app once it is available again to switch back.',
      'zh-TW': '設定的資料目錄現在無法使用（磁碟未連接或沒有權限），已暫時回落到預設位置。恢復可用後重新啟動程式即可切回。',
      'ja-JP': '設定したデータフォルダは現在使用できません（ドライブが接続されていないか、権限がありません）。当面は既定の場所を使用します。利用可能になったらアプリを再起動すると戻せます。',
      'ko-KR': '설정한 데이터 폴더를 지금 사용할 수 없습니다(드라이브가 연결되지 않았거나 권한이 없음). 당분간 기본 위치를 사용합니다. 사용할 수 있게 되면 앱을 다시 시작해 되돌릴 수 있습니다.',
      'de-DE': 'Der eingestellte Datenordner ist derzeit nicht verfügbar (Laufwerk nicht verbunden oder keine Berechtigung). Vorerst wird der Standardort verwendet. Nach einem Neustart wird wieder umgeschaltet, sobald er verfügbar ist.',
      'es-ES': 'La carpeta de datos configurada no está disponible (unidad no conectada o sin permisos); por ahora se usa la ubicación predeterminada. Reinicia la aplicación cuando vuelva a estar disponible para cambiarla.',
      'fr-FR': 'Le dossier de données configuré est indisponible (disque non connecté ou accès refusé) ; l’emplacement par défaut est utilisé pour l’instant. Redémarrez l’application après son rétablissement pour y revenir.',
      'it-IT': 'La cartella dati configurata non è disponibile (disco non collegato o permessi mancanti); per ora viene usata la posizione predefinita. Riavvia l’app quando torna disponibile per riconfigurarla.',
      'pl-PL': 'Ustawiony folder danych jest teraz niedostępny (dysk niepodłączony lub brak uprawnień). Na razie używana jest lokalizacja domyślna. Po jego udostępnieniu uruchom program ponownie, aby wrócić.',
      'pt-BR': 'A pasta de dados configurada está indisponível (disco não conectado ou sem permissão); por enquanto será usada a localização padrão. Reinicie o aplicativo quando ela voltar a funcionar para reverter.',
      'ru-RU': 'Настроенная папка данных сейчас недоступна (диск не подключён или нет прав), поэтому временно используется расположение по умолчанию. После восстановления доступности перезапустите приложение.',
      'th-TH': 'โฟลเดอร์ข้อมูลที่ตั้งไว้ใช้งานไม่ได้ในขณะนี้ (ไดรฟ์ไม่ได้เชื่อมต่อหรือไม่มีสิทธิ์) จึงใช้ตำแหน่งเริ่มต้นชั่วคราว กลับมาใช้งานได้แล้วให้รีสตาร์ทโปรแกรมเพื่อสลับกลับ',
      'tr-TR': 'Ayarlanan veri klasörü şu anda kullanılamıyor (sürücü bağlı değil veya izin yok), bu yüzden geçici olarak varsayılan konum kullanılıyor. Kullanılabilir olduğunda geri dönmek için uygulamayı yeniden başlatın.'
    }
  },
  {
    key: '目标：',
    t: {
      'en-US': 'Target:', 'zh-TW': '目標：', 'ja-JP': '対象：', 'ko-KR': '대상:',
      'de-DE': 'Ziel:', 'es-ES': 'Destino:', 'fr-FR': 'Cible :', 'it-IT': 'Destinazione:',
      'pl-PL': 'Cel:', 'pt-BR': 'Destino:', 'ru-RU': 'Цель:', 'th-TH': 'เป้าหมาย:',
      'tr-TR': 'Hedef:'
    }
  },
  {
    key: '新位置：',
    t: {
      'en-US': 'New location:', 'zh-TW': '新位置：', 'ja-JP': '新しい場所：', 'ko-KR': '새 위치:',
      'de-DE': 'Neuer Ort:', 'es-ES': 'Nueva ubicación:', 'fr-FR': 'Nouvel emplacement :',
      'it-IT': 'Nuova posizione:', 'pl-PL': 'Nowa lokalizacja:', 'pt-BR': 'Novo local:',
      'ru-RU': 'Новое расположение:', 'th-TH': 'ตำแหน่งใหม่:', 'tr-TR': 'Yeni konum:'
    }
  },
  {
    key: '新位置已设置好，重启程序后生效。',
    t: {
      'en-US': 'The new location is set; restart the app to apply it.',
      'zh-TW': '新位置已設定好，重新啟動程式後生效。',
      'ja-JP': '新しい場所を設定しました。アプリの再起動後に有効になります。',
      'ko-KR': '새 위치가 설정되었습니다. 앱을 다시 시작하면 적용됩니다.',
      'de-DE': 'Der neue Ort ist festgelegt; er wird nach einem Neustart wirksam.',
      'es-ES': 'La nueva ubicación está configurada; se aplicará al reiniciar la aplicación.',
      'fr-FR': 'Le nouvel emplacement est défini ; il sera appliqué après le redémarrage.',
      'it-IT': 'La nuova posizione è impostata; avrà effetto dopo il riavvio dell’app.',
      'pl-PL': 'Nowa lokalizacja została ustawiona; zadziała po ponownym uruchomieniu programu.',
      'pt-BR': 'O novo local foi definido; entrará em vigor após reiniciar o aplicativo.',
      'ru-RU': 'Новое расположение задано; оно вступит в силу после перезапуска.',
      'th-TH': 'ตั้งตำแหน่งใหม่แล้ว จะมีผลหลังรีสตาร์ทโปรแกรม',
      'tr-TR': 'Yeni konum ayarlandı; uygulamayı yeniden başlatınca geçerli olur.'
    }
  },
  {
    key: '这个目录就是当前的数据目录',
    t: {
      'en-US': 'That folder is already the current data folder',
      'zh-TW': '這個目錄就是目前的資料目錄',
      'ja-JP': 'そのフォルダはすでに現在のデータフォルダです',
      'ko-KR': '그 폴더가 이미 현재 데이터 폴더입니다',
      'de-DE': 'Dieser Ordner ist bereits der aktuelle Datenordner',
      'es-ES': 'Esa carpeta ya es la carpeta de datos actual',
      'fr-FR': 'Ce dossier est déjà le dossier de données actuel',
      'it-IT': 'Quella cartella è già la cartella dati corrente',
      'pl-PL': 'Ten folder jest już bieżącym folderem danych',
      'pt-BR': 'Essa pasta já é a pasta de dados atual',
      'ru-RU': 'Эта папка уже является текущей папкой данных',
      'th-TH': 'โฟลเดอร์นี้เป็นโฟลเดอร์ข้อมูลปัจจุบันอยู่แล้ว',
      'tr-TR': 'Bu klasör zaten geçerli veri klasörü'
    }
  },
  {
    key: '目标目录里已经有数据',
    t: {
      'en-US': 'The target folder already has data',
      'zh-TW': '目標目錄裡已經有資料',
      'ja-JP': '対象フォルダにはすでにデータがあります',
      'ko-KR': '대상 폴더에 이미 데이터가 있습니다',
      'de-DE': 'Der Zielordner enthält bereits Daten',
      'es-ES': 'La carpeta de destino ya contiene datos',
      'fr-FR': 'Le dossier cible contient déjà des données',
      'it-IT': 'La cartella di destinazione contiene già dati',
      'pl-PL': 'Folder docelowy zawiera już dane',
      'pt-BR': 'A pasta de destino já contém dados',
      'ru-RU': 'В целевой папке уже есть данные',
      'th-TH': 'โฟลเดอร์ปลายทางมีข้อมูลอยู่แล้ว',
      'tr-TR': 'Hedef klasörde zaten veri var'
    }
  },
  {
    key: '这个目录里已经有一份数据了：',
    t: {
      'en-US': 'This folder already contains a copy of the data:',
      'zh-TW': '這個目錄裡已經有一份資料了：',
      'ja-JP': 'このフォルダにはすでにデータがあります：',
      'ko-KR': '이 폴더에는 이미 데이터가 있습니다:',
      'de-DE': 'Dieser Ordner enthält bereits Daten:',
      'es-ES': 'Esta carpeta ya contiene datos:',
      'fr-FR': 'Ce dossier contient déjà des données :',
      'it-IT': 'Questa cartella contiene già dei dati:',
      'pl-PL': 'Ten folder zawiera już dane:',
      'pt-BR': 'Esta pasta já contém dados:',
      'ru-RU': 'В этой папке уже есть данные:',
      'th-TH': 'โฟลเดอร์นี้มีข้อมูลอยู่แล้ว:',
      'tr-TR': 'Bu klasörde zaten veri var:'
    }
  },
  {
    key: '这个目录里已经有 %s 个文件了',
    t: {
      'en-US': 'This folder already has %s files',
      'zh-TW': '這個目錄裡已經有 %s 個檔案了',
      'ja-JP': 'このフォルダにはすでに %s 個のファイルがあります',
      'ko-KR': '이 폴더에는 이미 %s개의 파일이 있습니다',
      'de-DE': 'Dieser Ordner enthält bereits %s Dateien',
      'es-ES': 'Esta carpeta ya tiene %s archivos',
      'fr-FR': 'Ce dossier contient déjà %s fichiers',
      'it-IT': 'Questa cartella contiene già %s file',
      'pl-PL': 'Ten folder zawiera już %s plików',
      'pt-BR': 'Esta pasta já tem %s arquivos',
      'ru-RU': 'В этой папке уже %s файлов',
      'th-TH': 'โฟลเดอร์นี้มี %s ไฟล์อยู่แล้ว',
      'tr-TR': 'Bu klasörde zaten %s dosya var'
    }
  },
  {
    key: '约',
    t: {
      'en-US': 'approx.', 'zh-TW': '約', 'ja-JP': '約', 'ko-KR': '약', 'de-DE': 'ca.',
      'es-ES': 'aprox.', 'fr-FR': 'env.', 'it-IT': 'circa', 'pl-PL': 'około',
      'pt-BR': 'aprox.', 'ru-RU': 'ок.', 'th-TH': 'ประมาณ', 'tr-TR': 'yaklaşık'
    }
  },
  {
    key: '覆盖目标里的同名文件',
    t: {
      'en-US': 'Overwrite same-named files in the target',
      'zh-TW': '覆蓋目標裡的同名檔案',
      'ja-JP': '対象にある同名ファイルを上書き',
      'ko-KR': '대상의 같은 이름 파일 덮어쓰기',
      'de-DE': 'Gleichnamige Dateien im Ziel überschreiben',
      'es-ES': 'Sobrescribir los archivos con el mismo nombre en el destino',
      'fr-FR': 'Écraser les fichiers de même nom dans la cible',
      'it-IT': 'Sovrascrivi i file con lo stesso nome nella destinazione',
      'pl-PL': 'Nadpisz pliki o tej samej nazwie w miejscu docelowym',
      'pt-BR': 'Substituir os arquivos de mesmo nome no destino',
      'ru-RU': 'Перезаписать одноимённые файлы в цели',
      'th-TH': 'เขียนทับไฟล์ชื่อเดียวกันในปลายทาง',
      'tr-TR': 'Hedefteki aynı adlı dosyaların üzerine yaz'
    }
  },
  {
    key: '同名文件保留目标那份',
    t: {
      'en-US': 'Keep the target copy of same-named files',
      'zh-TW': '同名檔案保留目標那一份',
      'ja-JP': '同名ファイルは対象側を残す',
      'ko-KR': '같은 이름 파일은 대상 쪽을 유지',
      'de-DE': 'Bei gleichnamigen Dateien die Zieldatei behalten',
      'es-ES': 'Conservar la copia del destino para los archivos con el mismo nombre',
      'fr-FR': 'Conserver la version cible des fichiers de même nom',
      'it-IT': 'Mantieni la copia di destinazione per i file con lo stesso nome',
      'pl-PL': 'Zachowaj pliki z miejsca docelowego o tej samej nazwie',
      'pt-BR': 'Manter a cópia do destino para arquivos de mesmo nome',
      'ru-RU': 'Оставить версию из цели для одноимённых файлов',
      'th-TH': 'เก็บไฟล์ชื่อเดียวกันของปลายทางไว้',
      'tr-TR': 'Aynı adlı dosyalarda hedefteki kopyayı koru'
    }
  },
  {
    key: '不搬，直接用那个位置的数据',
    t: {
      'en-US': 'Don’t copy — just use the data in that location',
      'zh-TW': '不搬，直接用那個位置的資料',
      'ja-JP': 'コピーせず、その場所のデータをそのまま使う',
      'ko-KR': '옮기지 않고 그 위치의 데이터를 그대로 사용',
      'de-DE': 'Nicht kopieren – die Daten an diesem Ort direkt verwenden',
      'es-ES': 'No copiar: usar directamente los datos de esa ubicación',
      'fr-FR': 'Ne pas copier — utiliser directement les données de cet emplacement',
      'it-IT': 'Non copiare: usa direttamente i dati in quella posizione',
      'pl-PL': 'Nie przenoś — użyj danych z tej lokalizacji',
      'pt-BR': 'Não copiar — usar diretamente os dados nesse local',
      'ru-RU': 'Не копировать — использовать данные из этого расположения',
      'th-TH': 'ไม่คัดลอก ใช้ข้อมูลในตำแหน่งนั้นเลย',
      'tr-TR': 'Kopyalama — o konumdaki veriyi doğrudan kullan'
    }
  },
  {
    key: '把现有数据搬到新目录吗？',
    t: {
      'en-US': 'Move the existing data to the new folder?',
      'zh-TW': '要把現有資料搬到新目錄嗎？',
      'ja-JP': '既存のデータを新しいフォルダに移動しますか？',
      'ko-KR': '기존 데이터를 새 폴더로 옮길까요?',
      'de-DE': 'Vorhandene Daten in den neuen Ordner verschieben?',
      'es-ES': '¿Mover los datos existentes a la nueva carpeta?',
      'fr-FR': 'Déplacer les données existantes vers le nouveau dossier ?',
      'it-IT': 'Spostare i dati esistenti nella nuova cartella?',
      'pl-PL': 'Przenieść istniejące dane do nowego folderu?',
      'pt-BR': 'Mover os dados existentes para a nova pasta?',
      'ru-RU': 'Переместить существующие данные в новую папку?',
      'th-TH': 'ย้ายข้อมูลที่มีอยู่ไปยังโฟลเดอร์ใหม่หรือไม่?',
      'tr-TR': 'Mevcut veriler yeni klasöre taşınsın mı?'
    }
  },
  {
    key: '当前数据有 %s 个文件，要搬到新位置吗？',
    t: {
      'en-US': 'The current data has %s files. Move them to the new location?',
      'zh-TW': '目前資料有 %s 個檔案，要搬到新位置嗎？',
      'ja-JP': '現在のデータは %s 個のファイルです。新しい場所に移動しますか？',
      'ko-KR': '현재 데이터에 %s개의 파일이 있습니다. 새 위치로 옮길까요?',
      'de-DE': 'Die aktuellen Daten umfassen %s Dateien. An den neuen Ort verschieben?',
      'es-ES': 'Los datos actuales tienen %s archivos. ¿Moverlos a la nueva ubicación?',
      'fr-FR': 'Les données actuelles comptent %s fichiers. Les déplacer vers le nouvel emplacement ?',
      'it-IT': 'I dati attuali contengono %s file. Spostarli nella nuova posizione?',
      'pl-PL': 'Bieżące dane obejmują %s plików. Przenieść je do nowej lokalizacji?',
      'pt-BR': 'Os dados atuais têm %s arquivos. Movê-los para o novo local?',
      'ru-RU': 'Текущие данные содержат %s файлов. Переместить их в новое расположение?',
      'th-TH': 'ข้อมูลปัจจุบันมี %s ไฟล์ ต้องการย้ายไปตำแหน่งใหม่หรือไม่?',
      'tr-TR': 'Mevcut verilerde %s dosya var. Yeni konuma taşınsın mı?'
    }
  },
  {
    key: '移动（推荐，搬完删掉旧目录）',
    t: {
      'en-US': 'Move (recommended — deletes the old folder)',
      'zh-TW': '移動（推薦，搬完刪掉舊目錄）',
      'ja-JP': '移動（推奨・移動後に元のフォルダを削除）',
      'ko-KR': '이동(권장, 완료 후 이전 폴더 삭제)',
      'de-DE': 'Verschieben (empfohlen – löscht den alten Ordner)',
      'es-ES': 'Mover (recomendado: elimina la carpeta antigua)',
      'fr-FR': 'Déplacer (recommandé — supprime l’ancien dossier)',
      'it-IT': 'Sposta (consigliato: elimina la vecchia cartella)',
      'pl-PL': 'Przenieś (zalecane — usuwa stary folder)',
      'pt-BR': 'Mover (recomendado — apaga a pasta antiga)',
      'ru-RU': 'Переместить (рекомендуется — старая папка удаляется)',
      'th-TH': 'ย้าย (แนะนำ — ลบโฟลเดอร์เดิม)',
      'tr-TR': 'Taşı (önerilir — eski klasörü siler)'
    }
  },
  {
    key: '复制（旧目录保留一份）',
    t: {
      'en-US': 'Copy (keeps a copy in the old folder)',
      'zh-TW': '複製（舊目錄保留一份）',
      'ja-JP': 'コピー（元のフォルダに残す）',
      'ko-KR': '복사(이전 폴더에 사본 유지)',
      'de-DE': 'Kopieren (behält eine Kopie im alten Ordner)',
      'es-ES': 'Copiar (conserva una copia en la carpeta antigua)',
      'fr-FR': 'Copier (conserve une copie dans l’ancien dossier)',
      'it-IT': 'Copia (mantiene una copia nella vecchia cartella)',
      'pl-PL': 'Kopiuj (zostawia kopię w starym folderze)',
      'pt-BR': 'Copiar (mantém uma cópia na pasta antiga)',
      'ru-RU': 'Копировать (копия остаётся в старой папке)',
      'th-TH': 'คัดลอก (เก็บสำเนาไว้ในโฟลเดอร์เดิม)',
      'tr-TR': 'Kopyala (eski klasörde bir kopya bırakır)'
    }
  },
  {
    key: '恢复到默认位置',
    t: {
      'en-US': 'Restore to the default location',
      'zh-TW': '恢復到預設位置',
      'ja-JP': '既定の場所に戻す',
      'ko-KR': '기본 위치로 복원',
      'de-DE': 'Auf den Standardort zurücksetzen',
      'es-ES': 'Restaurar a la ubicación predeterminada',
      'fr-FR': 'Revenir à l’emplacement par défaut',
      'it-IT': 'Ripristina la posizione predefinita',
      'pl-PL': 'Przywróć domyślną lokalizację',
      'pt-BR': 'Restaurar para o local padrão',
      'ru-RU': 'Вернуть расположение по умолчанию',
      'th-TH': 'คืนค่าตำแหน่งเริ่มต้น',
      'tr-TR': 'Varsayılan konuma dön'
    }
  },
  {
    key: '当前数据有 %s 个文件，要搬回默认位置吗？',
    t: {
      'en-US': 'The current data has %s files. Move them back to the default location?',
      'zh-TW': '目前資料有 %s 個檔案，要搬回預設位置嗎？',
      'ja-JP': '現在のデータは %s 個のファイルです。既定の場所に戻しますか？',
      'ko-KR': '현재 데이터에 %s개의 파일이 있습니다. 기본 위치로 되돌릴까요?',
      'de-DE': 'Die aktuellen Daten umfassen %s Dateien. Zurück an den Standardort verschieben?',
      'es-ES': 'Los datos actuales tienen %s archivos. ¿Moverlos de vuelta a la ubicación predeterminada?',
      'fr-FR': 'Les données actuelles comptent %s fichiers. Les remettre à l’emplacement par défaut ?',
      'it-IT': 'I dati attuali contengono %s file. Riportarli nella posizione predefinita?',
      'pl-PL': 'Bieżące dane obejmują %s plików. Przenieść je z powrotem do lokalizacji domyślnej?',
      'pt-BR': 'Os dados atuais têm %s arquivos. Movê-los de volta para o local padrão?',
      'ru-RU': 'Текущие данные содержат %s файлов. Вернуть их в расположение по умолчанию?',
      'th-TH': 'ข้อมูลปัจจุบันมี %s ไฟล์ ต้องการย้ายกลับไปตำแหน่งเริ่มต้นหรือไม่?',
      'tr-TR': 'Mevcut verilerde %s dosya var. Varsayılan konuma geri taşınsın mı?'
    }
  },
  {
    key: '默认位置：',
    t: {
      'en-US': 'Default location:', 'zh-TW': '預設位置：', 'ja-JP': '既定の場所：',
      'ko-KR': '기본 위치:', 'de-DE': 'Standardort:', 'es-ES': 'Ubicación predeterminada:',
      'fr-FR': 'Emplacement par défaut :', 'it-IT': 'Posizione predefinita:',
      'pl-PL': 'Lokalizacja domyślna:', 'pt-BR': 'Local padrão:',
      'ru-RU': 'Расположение по умолчанию:', 'th-TH': 'ตำแหน่งเริ่มต้น:', 'tr-TR': 'Varsayılan konum:'
    }
  },
  {
    key: '设置失败',
    t: {
      'en-US': 'Failed to save the setting', 'zh-TW': '設定失敗', 'ja-JP': '設定に失敗しました',
      'ko-KR': '설정 실패', 'de-DE': 'Einstellung fehlgeschlagen',
      'es-ES': 'No se pudo guardar la configuración',
      'fr-FR': 'Échec de l’enregistrement du paramètre', 'it-IT': 'Impostazione non riuscita',
      'pl-PL': 'Nie udało się zapisać ustawienia', 'pt-BR': 'Falha ao salvar a configuração',
      'ru-RU': 'Не удалось сохранить настройку', 'th-TH': 'บันทึกการตั้งค่าไม่สำเร็จ',
      'tr-TR': 'Ayar kaydedilemedi'
    }
  },
  {
    key: '数据目录没有变化',
    t: {
      'en-US': 'The data folder is unchanged', 'zh-TW': '資料目錄沒有變化',
      'ja-JP': 'データフォルダは変更されていません', 'ko-KR': '데이터 폴더가 변경되지 않았습니다',
      'de-DE': 'Der Datenordner ist unverändert', 'es-ES': 'La carpeta de datos no ha cambiado',
      'fr-FR': 'Le dossier de données est inchangé', 'it-IT': 'La cartella dati non è cambiata',
      'pl-PL': 'Folder danych nie uległ zmianie', 'pt-BR': 'A pasta de dados não mudou',
      'ru-RU': 'Папка данных не изменилась', 'th-TH': 'โฟลเดอร์ข้อมูลไม่มีการเปลี่ยนแปลง',
      'tr-TR': 'Veri klasörü değişmedi'
    }
  },
  {
    key: '正在搬运数据…',
    t: {
      'en-US': 'Moving data…', 'zh-TW': '正在搬運資料…', 'ja-JP': 'データを移動しています…',
      'ko-KR': '데이터를 옮기는 중…', 'de-DE': 'Daten werden verschoben…',
      'es-ES': 'Moviendo datos…', 'fr-FR': 'Déplacement des données…',
      'it-IT': 'Spostamento dei dati…', 'pl-PL': 'Przenoszenie danych…',
      'pt-BR': 'Movendo dados…', 'ru-RU': 'Перемещение данных…',
      'th-TH': 'กำลังย้ายข้อมูล…', 'tr-TR': 'Veriler taşınıyor…'
    }
  },
  {
    key: '正在准备…',
    t: {
      'en-US': 'Preparing…', 'zh-TW': '正在準備…', 'ja-JP': '準備しています…', 'ko-KR': '준비 중…',
      'de-DE': 'Vorbereitung…', 'es-ES': 'Preparando…', 'fr-FR': 'Préparation…',
      'it-IT': 'Preparazione…', 'pl-PL': 'Przygotowywanie…', 'pt-BR': 'Preparando…',
      'ru-RU': 'Подготовка…', 'th-TH': 'กำลังเตรียมการ…', 'tr-TR': 'Hazırlanıyor…'
    }
  },
  {
    key: '正在搬运…',
    t: {
      'en-US': 'Copying…', 'zh-TW': '正在搬運…', 'ja-JP': '移動しています…', 'ko-KR': '옮기는 중…',
      'de-DE': 'Wird verschoben…', 'es-ES': 'Moviendo…', 'fr-FR': 'Déplacement…',
      'it-IT': 'Spostamento…', 'pl-PL': 'Przenoszenie…', 'pt-BR': 'Movendo…',
      'ru-RU': 'Перемещение…', 'th-TH': 'กำลังย้าย…', 'tr-TR': 'Taşınıyor…'
    }
  },
  {
    key: '正在改写路径引用…',
    t: {
      'en-US': 'Updating path references…', 'zh-TW': '正在改寫路徑參照…',
      'ja-JP': 'パスの参照を書き換えています…', 'ko-KR': '경로 참조를 다시 쓰는 중…',
      'de-DE': 'Pfadverweise werden angepasst…', 'es-ES': 'Actualizando las referencias de rutas…',
      'fr-FR': 'Mise à jour des références de chemin…',
      'it-IT': 'Aggiornamento dei riferimenti ai percorsi…',
      'pl-PL': 'Aktualizowanie odwołań do ścieżek…',
      'pt-BR': 'Atualizando as referências de caminho…', 'ru-RU': 'Обновление ссылок на пути…',
      'th-TH': 'กำลังปรับการอ้างอิงพาธ…', 'tr-TR': 'Yol başvuruları güncelleniyor…'
    }
  },
  {
    key: '收尾…',
    t: {
      'en-US': 'Finishing…', 'zh-TW': '收尾…', 'ja-JP': '仕上げ中…', 'ko-KR': '마무리 중…',
      'de-DE': 'Abschluss…', 'es-ES': 'Finalizando…', 'fr-FR': 'Finalisation…',
      'it-IT': 'Finalizzazione…', 'pl-PL': 'Kończenie…', 'pt-BR': 'Finalizando…',
      'ru-RU': 'Завершение…', 'th-TH': 'กำลังเก็บรายละเอียด…', 'tr-TR': 'Tamamlanıyor…'
    }
  },
  {
    key: '搬运期间请不要关闭程序。',
    t: {
      'en-US': 'Please don’t close the app while the data is being moved.',
      'zh-TW': '搬運期間請不要關閉程式。',
      'ja-JP': '移動中はアプリを閉じないでください。',
      'ko-KR': '옮기는 동안 앱을 닫지 마세요.',
      'de-DE': 'Bitte schließen Sie die App während des Verschiebens nicht.',
      'es-ES': 'No cierres la aplicación mientras se mueven los datos.',
      'fr-FR': 'Ne fermez pas l’application pendant le déplacement.',
      'it-IT': 'Non chiudere l’app durante lo spostamento.',
      'pl-PL': 'Nie zamykaj programu w trakcie przenoszenia.',
      'pt-BR': 'Não feche o aplicativo durante a movimentação.',
      'ru-RU': 'Не закрывайте приложение во время перемещения.',
      'th-TH': 'อย่าปิดโปรแกรมระหว่างการย้ายข้อมูล',
      'tr-TR': 'Taşıma sırasında uygulamayı kapatmayın.'
    }
  },
  {
    key: '搬运失败',
    t: {
      'en-US': 'Move failed', 'zh-TW': '搬運失敗', 'ja-JP': '移動に失敗しました',
      'ko-KR': '옮기기 실패', 'de-DE': 'Verschieben fehlgeschlagen', 'es-ES': 'Error al mover',
      'fr-FR': 'Échec du déplacement', 'it-IT': 'Spostamento non riuscito',
      'pl-PL': 'Przenoszenie nie powiodło się', 'pt-BR': 'Falha ao mover',
      'ru-RU': 'Не удалось переместить', 'th-TH': 'ย้ายไม่สำเร็จ', 'tr-TR': 'Taşıma başarısız'
    }
  },
  {
    key: '需要重启',
    t: {
      'en-US': 'Restart required', 'zh-TW': '需要重啟', 'ja-JP': '再起動が必要です',
      'ko-KR': '재시작 필요', 'de-DE': 'Neustart erforderlich', 'es-ES': 'Se requiere reiniciar',
      'fr-FR': 'Redémarrage nécessaire', 'it-IT': 'Riavvio necessario',
      'pl-PL': 'Wymagane ponowne uruchomienie', 'pt-BR': 'Reinício necessário',
      'ru-RU': 'Требуется перезапуск', 'th-TH': 'ต้องรีสตาร์ท', 'tr-TR': 'Yeniden başlatma gerekli'
    }
  },
  {
    key: '数据已经搬到新位置，重启程序后生效。',
    t: {
      'en-US': 'The data has been moved to the new location; restart the app to apply it.',
      'zh-TW': '資料已經搬到新位置，重新啟動程式後生效。',
      'ja-JP': 'データを新しい場所に移動しました。アプリの再起動後に有効になります。',
      'ko-KR': '데이터를 새 위치로 옮겼습니다. 앱을 다시 시작하면 적용됩니다.',
      'de-DE': 'Die Daten wurden an den neuen Ort verschoben; wird nach einem Neustart wirksam.',
      'es-ES': 'Los datos se han movido a la nueva ubicación; se aplicará al reiniciar la aplicación.',
      'fr-FR': 'Les données ont été déplacées vers le nouvel emplacement ; appliquez après redémarrage.',
      'it-IT': 'I dati sono stati spostati nella nuova posizione; avrà effetto dopo il riavvio dell’app.',
      'pl-PL': 'Dane przeniesiono do nowej lokalizacji; zadziała po ponownym uruchomieniu programu.',
      'pt-BR': 'Os dados foram movidos para o novo local; entrará em vigor após reiniciar o aplicativo.',
      'ru-RU': 'Данные перемещены в новое расположение; вступит в силу после перезапуска.',
      'th-TH': 'ย้ายข้อมูลไปตำแหน่งใหม่แล้ว จะมีผลหลังรีสตาร์ทโปรแกรม',
      'tr-TR': 'Veriler yeni konuma taşındı; uygulamayı yeniden başlatınca geçerli olur.'
    }
  },
  {
    key: '搬运了 %s 个文件，跳过 %s 个已存在的',
    t: {
      'en-US': 'Moved %s files, skipped %s that already existed',
      'zh-TW': '搬運了 %s 個檔案，跳過 %s 個已存在的',
      'ja-JP': '%s 個のファイルを移動、既存の %s 個をスキップ',
      'ko-KR': '%s개 파일을 옮겼고 기존 %s개는 건너뛰었습니다',
      'de-DE': '%s Dateien verschoben, %s vorhandene übersprungen',
      'es-ES': 'Se movieron %s archivos; se omitieron %s que ya existían',
      'fr-FR': '%s fichiers déplacés, %s existants ignorés',
      'it-IT': '%s file spostati, %s già esistenti saltati',
      'pl-PL': 'Przeniesiono %s plików, pominięto %s istniejących',
      'pt-BR': '%s arquivos movidos, %s já existentes ignorados',
      'ru-RU': 'Перемещено %s файлов, пропущено %s существующих',
      'th-TH': 'ย้าย %s ไฟล์ ข้าม %s ไฟล์ที่มีอยู่แล้ว',
      'tr-TR': '%s dosya taşındı, var olan %s dosya atlandı'
    }
  },
  {
    key: '改写了 %s 处路径引用',
    t: {
      'en-US': 'Rewrote %s path references', 'zh-TW': '改寫了 %s 處路徑參照',
      'ja-JP': '%s か所のパス参照を書き換えました', 'ko-KR': '경로 참조 %s곳을 다시 썼습니다',
      'de-DE': '%s Pfadverweise angepasst', 'es-ES': 'Se reescribieron %s referencias de rutas',
      'fr-FR': '%s références de chemin réécrites',
      'it-IT': '%s riferimenti di percorso riscritti',
      'pl-PL': 'Zaktualizowano %s odwołań do ścieżek',
      'pt-BR': '%s referências de caminho reescritas',
      'ru-RU': 'Переписано %s ссылок на пути', 'th-TH': 'เขียนการอ้างอิงพาธใหม่ %s จุด',
      'tr-TR': '%s yol başvurusu güncellendi'
    }
  },
  {
    key: '立即重启',
    t: {
      'en-US': 'Restart now', 'zh-TW': '立即重啟', 'ja-JP': '今すぐ再起動', 'ko-KR': '지금 재시작',
      'de-DE': 'Jetzt neu starten', 'es-ES': 'Reiniciar ahora', 'fr-FR': 'Redémarrer maintenant',
      'it-IT': 'Riavvia ora', 'pl-PL': 'Uruchom ponownie teraz', 'pt-BR': 'Reiniciar agora',
      'ru-RU': 'Перезапустить сейчас', 'th-TH': 'รีสตาร์ททันที', 'tr-TR': 'Şimdi yeniden başlat'
    }
  },
  {
    key: '稍后自己重启',
    t: {
      'en-US': 'I’ll restart later', 'zh-TW': '稍後自己重啟', 'ja-JP': 'あとで自分で再起動する',
      'ko-KR': '나중에 직접 재시작', 'de-DE': 'Später selbst neu starten',
      'es-ES': 'Reiniciaré más tarde', 'fr-FR': 'Je redémarrerai plus tard',
      'it-IT': 'Riavvio più tardi', 'pl-PL': 'Uruchomię ponownie później',
      'pt-BR': 'Vou reiniciar depois', 'ru-RU': 'Перезапущу позже',
      'th-TH': 'จะรีสตาร์ทเองภายหลัง', 'tr-TR': 'Daha sonra kendim başlatırım'
    }
  },
  {
    key: '数据目录已经改好，重启程序后生效。',
    t: {
      'en-US': 'The data folder has been changed; restart the app to apply it.',
      'zh-TW': '資料目錄已經改好，重新啟動程式後生效。',
      'ja-JP': 'データフォルダを変更しました。アプリの再起動後に有効になります。',
      'ko-KR': '데이터 폴더를 변경했습니다. 앱을 다시 시작하면 적용됩니다.',
      'de-DE': 'Der Datenordner wurde geändert; wird nach einem Neustart wirksam.',
      'es-ES': 'La carpeta de datos se ha cambiado; se aplicará al reiniciar la aplicación.',
      'fr-FR': 'Le dossier de données a été modifié ; appliquez après redémarrage.',
      'it-IT': 'La cartella dati è stata cambiata; avrà effetto dopo il riavvio dell’app.',
      'pl-PL': 'Folder danych został zmieniony; zadziała po ponownym uruchomieniu programu.',
      'pt-BR': 'A pasta de dados foi alterada; entrará em vigor após reiniciar o aplicativo.',
      'ru-RU': 'Папка данных изменена; вступит в силу после перезапуска.',
      'th-TH': 'เปลี่ยนโฟลเดอร์ข้อมูลแล้ว จะมีผลหลังรีสตาร์ทโปรแกรม',
      'tr-TR': 'Veri klasörü değiştirildi; uygulamayı yeniden başlatınca geçerli olur.'
    }
  },
  {
    key: '还有 %s 个下载 / 安装任务在跑，先暂停或等它跑完再搬数据',
    t: {
      'en-US': '%s download / install tasks are still running — pause them or wait until they finish before moving the data',
      'zh-TW': '還有 %s 個下載 / 安裝任務在跑，先暫停或等它跑完再搬資料',
      'ja-JP': '%s 件のダウンロード / インストールが実行中です。一時停止するか完了を待ってからデータを移動してください',
      'ko-KR': '%s개의 다운로드 / 설치 작업이 실행 중입니다. 일시정지하거나 끝난 뒤 데이터를 옮기세요',
      'de-DE': '%s Download-/Installationsvorgänge laufen noch – pausieren oder abwarten, bevor Daten verschoben werden',
      'es-ES': 'Hay %s tareas de descarga / instalación en curso: pausa o espera a que terminen antes de mover los datos',
      'fr-FR': '%s tâches de téléchargement / installation sont en cours — mettez-les en pause ou attendez la fin avant de déplacer les données',
      'it-IT': '%s attività di download / installazione in corso: mettile in pausa o attendi che finiscano prima di spostare i dati',
      'pl-PL': 'Trwa %s zadań pobierania / instalacji — wstrzymaj je lub poczekaj, zanim przeniesiesz dane',
      'pt-BR': '%s tarefas de download / instalação em execução — pause ou aguarde terminarem antes de mover os dados',
      'ru-RU': 'Выполняется %s задач загрузки / установки — приостановите их или дождитесь завершения, прежде чем перемещать данные',
      'th-TH': 'มีงานดาวน์โหลด / ติดตั้ง %s งานกำลังทำงานอยู่ หยุดชั่วคราวหรือรอให้เสร็จก่อนย้ายข้อมูล',
      'tr-TR': '%s indirme / kurulum görevi çalışıyor — verileri taşımadan önce duraklatın veya bitmesini bekleyin'
    }
  },
  {
    key: '还有 %s 个下载 / 安装任务在跑，先处理完再改数据位置',
    t: {
      'en-US': '%s download / install tasks are still running — finish them before changing the data location',
      'zh-TW': '還有 %s 個下載 / 安裝任務在跑，先處理完再改資料位置',
      'ja-JP': '%s 件のダウンロード / インストールが実行中です。先に片付けてからデータの場所を変更してください',
      'ko-KR': '%s개의 다운로드 / 설치 작업이 실행 중입니다. 먼저 끝낸 뒤 데이터 위치를 변경하세요',
      'de-DE': '%s Download-/Installationsvorgänge laufen noch – zuerst abschließen, dann den Datenort ändern',
      'es-ES': 'Hay %s tareas de descarga / instalación en curso: termínalas antes de cambiar la ubicación de los datos',
      'fr-FR': '%s tâches de téléchargement / installation sont en cours — terminez-les avant de changer l’emplacement des données',
      'it-IT': '%s attività di download / installazione in corso: completale prima di cambiare la posizione dei dati',
      'pl-PL': 'Trwa %s zadań pobierania / instalacji — ukończ je przed zmianą lokalizacji danych',
      'pt-BR': '%s tarefas de download / instalação em execução — conclua-as antes de alterar o local dos dados',
      'ru-RU': 'Выполняется %s задач загрузки / установки — завершите их, прежде чем менять расположение данных',
      'th-TH': 'มีงานดาวน์โหลด / ติดตั้ง %s งานกำลังทำงานอยู่ จัดการให้เสร็จก่อนเปลี่ยนตำแหน่งข้อมูล',
      'tr-TR': '%s indirme / kurulum görevi çalışıyor — veri konumunu değiştirmeden önce bunları tamamlayın'
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
