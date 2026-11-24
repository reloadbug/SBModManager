// 用真实 IPC 跑一次「补登记」（mod 4184）：记录在 15:02 的核对里被当「文件全丢」删掉了，
// 文件其实还在 ~Mods 里。这里走渲染层 → preload → ipc.registerExisting 全链路。
const TASK = '7ab47e1a-d8f6-4e83-b85a-e30f32c56fc8';
const r = await window.api.mods.registerExisting({ taskId: TASK });
await (window.refreshDownloads ? window.refreshDownloads() : Promise.resolve());
return r;
