/* 子 Mod 实跑：把 4184 的「物理特效」那一套单独卸掉，再单独装回来
 *
 * 只动 3 个小文件（pak 339 B / ucas 82.2 KB / utoc 414 B），卸的时候进备份目录，
 * 装的时候从原安装包写回 —— 用来证明「每个子 Mod 可以单独装 / 单独卸」真的成立。
 */
const modId = 4184;
const dir = 'Breast and Hip_Physics';
const pkg = async () => (await window.api.mods.packageFiles({ modId })).data || {};
const pick = (d, top) => (d.entries || []).filter(e => e.top === top).map(e => `${e.name}=${e.state}`);

const before = await pkg();
const r1 = { phys: pick(before, dir), jk: pick(before, 'Kamenlaideng_Blossom Butterfly JK'), total: before.installedCount };

const un = await window.api.mods.uninstallSub({ modId, dir });
const afterUn = await pkg();
const r2 = {
  moved: un.data && un.data.moved,
  remaining: un.data && un.data.remaining,
  phys: pick(afterUn, dir),
  jk: pick(afterUn, 'Kamenlaideng_Blossom Butterfly JK'),
  total: afterUn.installedCount
};

const ins = await window.api.mods.installSub({ modId, dir });
const afterIn = await pkg();
const r3 = {
  written: ins.data && ins.data.written,
  fileCount: ins.data && ins.data.fileCount,
  phys: pick(afterIn, dir),
  jk: pick(afterIn, 'Kamenlaideng_Blossom Butterfly JK'),
  total: afterIn.installedCount
};

if (window.refreshDownloads) await window.refreshDownloads();
if (window.refreshAfterModsChanged) await window.refreshAfterModsChanged();

return { before: r1, afterUninstall: r2, afterInstall: r3 };
