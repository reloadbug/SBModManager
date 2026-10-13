const orig = window.switchPage;
window.__log = [];
window.switchPage = function (id) { window.__log.push(id); return orig.apply(this, arguments); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(2000);
window.switchPage("p-download");
await wait(6000);
return { log: window.__log, now: (document.querySelector(".nav-i.on") || {}).textContent };
