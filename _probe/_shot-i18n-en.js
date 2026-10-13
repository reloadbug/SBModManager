/* 截图用注入脚本：把界面切到英文并停在设置页。
   通过 --shot-eval-file 注入，在渲染进程里执行（能直接摸到 window.I18N）。 */
try {
  if (window.I18N) {
    window.I18N.setLang('en-US');
    window.I18N.refresh();
  }
} catch (e) { console.error('I18N_SWITCH_ERR ' + e.message); }

try { window.switchPage && window.switchPage('p-settings'); } catch (e) {}
document.title = 'I18N_OK ' + (window.I18N ? window.I18N.effective() : 'no-i18n');

await new Promise(r => setTimeout(r, 1500));
