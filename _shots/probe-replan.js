/**
 * 端到端验证：应用启动后 `refreshUnknownPlans()` 会把卡在「待确认」的任务重新 analyze。
 *
 * 目标任务是 mod 123「Sexy Harness - NSFW (CNS compatible)」那条 ——
 * 修复前 plan 是 `unknown`（结构无法识别），修复后应当变成 `pak` / ~Mods。
 *
 * ⚠️ 时序：`ipc.js` 里是 `setTimeout(..., 6000)` 触发重算，而本探针在 did-finish-load
 *    后 3s 才被注入，所以内部要再等 9s 才有结果 → `--shot-delay` 必须 > 12000。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe . \
 *     --shot=_shots/replan.png --shot-page=p-download \
 *     --shot-eval-file=_shots/probe-replan.js --shot-delay=20000
 */
const TARGET_ID = '91566801-0a48-44d9-a89f-8925dbbe9c00';

const lap = Date.now();
await new Promise(r => setTimeout(r, 9000));   // 等启动重算跑完

const env = await window.api.download.list();
// ⚠️ 两个坑叠在一起：
//   1. preload 暴露的 API 返回的是**信封** `{ ok, data }`，渲染层的 `call()` 才负责拆包。
//      直接调 `window.api.*` 拿到的 `raw.tasks` 永远是 undefined → 探针静默报「队列总数 0」。
//   2. `download:list` 的 data 是 `{ tasks, stats }`，**不是**裸数组。
const raw = (env && env.ok && env.data) || {};
const arr = raw.tasks || [];
const t = arr.find(x => x.id === TARGET_ID);

const plan = t && t.install && t.install.plan;
return {
  等重算耗时: ((Date.now() - lap) / 1000).toFixed(1) + ' s',
  队列总数: arr.length,
  队列统计: raw.stats || null,
  目标任务: t ? {
    status: t.status,
    planOk: plan ? plan.ok : null,
    planKind: plan ? plan.kind : null,
    planTarget: plan ? plan.target : null,
    planReason: plan ? plan.reason : null,
    文件数: plan ? plan.fileCount : null,
    候选数: plan ? (plan.options || []).length : null,
    安装原因: t.install && t.install.reason,
    mapping: plan && plan.mapping ? plan.mapping.map(m => m.rel) : null
  } : '没找到这条任务',
  待确认任务: arr.filter(x => x.status === 'needs_review').map(x => ({
    id: x.id,
    名称: (x.meta && x.meta.name) || x.filename,
    原因: x.install && x.install.reason
  }))
};
