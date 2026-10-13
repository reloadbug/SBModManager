// 顶栏「已登录 → 头像 + 账号名」验证。
// 直接给 state.auth 塞假登录态再调 renderTopAccount() —— 不碰真实会话、不写缓存。
// 一次跑两种状态：① 有头像（data URL，一定能加载）② 拿不到头像（退化成首字母方块）。
await new Promise(r => setTimeout(r, 4500));

const btn = document.getElementById('btnNexusAccount');
if (!btn) return { err: '找不到 #btnNexusAccount' };
const before = btn.textContent.trim();

// data URL 当头像：CSP 允许（img-src 'self' https: data:），且一定能加载成功
const px = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
  '<rect width="64" height="64" fill="#E8A33D"/>' +
  '<text x="32" y="46" font-size="38" text-anchor="middle" fill="#1A1206" font-family="sans-serif">N</text></svg>');

// ---- ① 有头像 ----
state.auth = { loggedIn: true, user: 'NexusTester', avatar: px, cookieCount: 12 };
renderTopAccount();
await new Promise(r => setTimeout(r, 800));
const av1 = btn.querySelector('.acct-av');
const withAvatar = {
  cls: btn.className,
  avTag: av1 ? av1.tagName : null,
  avLoaded: av1 && av1.tagName === 'IMG' ? av1.naturalWidth > 0 : null,
  name: (btn.querySelector('.acct-nm') || {}).textContent || null,
  title: btn.title
};

// ---- ② 拿不到头像（很多判定路径就是这样）----
state.auth = { loggedIn: true, user: 'NexusTester', avatar: null, cookieCount: 12 };
renderTopAccount();
await new Promise(r => setTimeout(r, 600));
const av2 = btn.querySelector('.acct-av');
const noAvatar = {
  cls: btn.className,
  avTag: av2 ? av2.tagName : null,
  isPlaceholder: av2 ? av2.classList.contains('ph') : false,
  text: av2 ? av2.textContent : null,
  name: (btn.querySelector('.acct-nm') || {}).textContent || null
};

// ---- ③ 未登录（恢复原样）----
state.auth = { loggedIn: false, user: null, avatar: null, cookieCount: 0 };
renderTopAccount();
await new Promise(r => setTimeout(r, 400));
const loggedOut = { cls: btn.className, text: btn.textContent.trim(), hasImg: !!btn.querySelector('.acct-av') };

// 截图停在**有头像**那一态（更有信息量）—— 所以再切回去
state.auth = { loggedIn: true, user: 'NexusTester', avatar: px, cookieCount: 12 };
renderTopAccount();
await new Promise(r => setTimeout(r, 700));

const r = btn.getBoundingClientRect();
return { before, withAvatar, noAvatar, loggedOut, inTop: !!btn.closest('.top'),
  btnW: Math.round(r.width), btnH: Math.round(r.height) };
