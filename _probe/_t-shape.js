/* 临时探针：验证 %s 形状片段匹配 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

const win = { navigator: { language: 'zh-CN' }, console };
win.window = win; win.globalThis = win;
const ctx = vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n.js'), 'utf8'), ctx, { filename: 'i18n.js' });
const I = win.I18N;
console.log('导出 API:', Object.keys(I).join(', '));

I.register('en-US', { '加载更多（还有 %s 个）': 'Load more (%s left)' });
I.setLang('en-US');
console.log('getLang() =', I.getLang(), '· effective() =', I.effective());
console.log('lookup =', JSON.stringify(I.lookup('加载更多（还有 3,027 个）')));
console.log('fragments =', JSON.stringify(I._frag('en-US')));
console.log('peel =', JSON.stringify(I._peel('加载更多（还有 3,027 个）', { '加载更多（还有 %s 个）': 'X' })));

// 手动复算形状正则，确认正则本身没问题
const key = '加载更多（还有 %s 个）';
const NUM = String.raw`(\d[\d,.\s]*\d|\d)`;
const body = key.split('%s').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(NUM);
console.log('正则源 =', body);
console.log('正则 test =', new RegExp(body).test('加载更多（还有 3,027 个）'));
