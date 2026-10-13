const {app}=require('electron');
console.log('HELLO_FROM_ELECTRON');
app.whenReady().then(()=>{console.log('READY');app.exit(0);});
