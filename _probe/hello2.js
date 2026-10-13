const {app}=require('electron');
const path=require('path');
const APP_NAME='剑星 Mod 管理器';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA||'', APP_NAME));
console.log('SETUP_OK userData='+app.getPath('userData'));
app.whenReady().then(()=>{console.log('READY');app.exit(0);});
