/* 文件归属表：哪个文件属于哪个 Mod（拿安装包反推，把丢掉的关系补回来）
 *
 * 用户 2026-11-24：
 *   「这部分文件要跟库里的压缩包比对，正常流程应该是安装的过程中记录下来哪个文件是哪个mod的；
 *     既然已经丢失了这部分数据就想办法补回来；如果确认是垃圾文件可以删除」
 *
 * 这份探针只读、不联网、不动真实游戏目录（全在临时目录里造数据）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const installer = require('../src/main/installer');
const scanner = require('../src/main/scanner');
const { createFileOwner, indexPlan, indexLibrary } = require('../src/main/fileOwner');
const { attachOwners } = require('../src/main/attachOwners');
const paths = require('../src/main/paths');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  ← ' + extra : '')); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmm-owner-'));
const ownerFile = path.join(tmp, 'mod-file-owner.json');
const modsDir = path.join(tmp, '~Mods');
fs.mkdirSync(modsDir, { recursive: true });

/* ---------- A 归属表本身 ---------- */
const fo = createFileOwner(ownerFile);
ok('A1 空表：files/mods 都是 0', fo.stats().files === 0 && fo.stats().mods === 0, JSON.stringify(fo.stats()));
const w = fo.setMany({
  [installer.fileKey('Bar.dekcns.json')]: { modId: 900, entry: 'A/Bar.dekcns.json', archive: '900_x.zip' },
  [installer.fileKey('Foo_P [nx900].pak')]: { modId: 900, entry: 'A/Foo_P.pak', archive: '900_x.zip' }
});
ok('A2 写入两条 → added=2', w.added === 2 && w.total === 2, JSON.stringify(w));
ok('A3 按文件名查（带 [nx] 也认）', (fo.get('Bar.dekcns.json') || {}).modId === 900);
ok('A4 查不到返回 null', fo.get('Nobody.dekcns.json') === null);
ok('A5 keysOfMod 给出该 Mod 的两个文件', fo.keysOfMod(900).length === 2, String(fo.keysOfMod(900).length));
ok('A6 stats：2 文件 / 1 Mod', fo.stats().files === 2 && fo.stats().mods === 1);
ok('A7 落盘了（文件存在）', fs.existsSync(ownerFile));
const fo2 = createFileOwner(ownerFile);
ok('A8 重新打开能读回来', (fo2.get('Bar.dekcns.json') || {}).modId === 900);
ok('A9 重写同一个键不重复计数（modId 没变）', fo2.setMany({ [installer.fileKey('Bar.dekcns.json')]: { modId: 900 } }).added === 0);
ok('A10 modId 变了会覆盖', (() => {
  fo2.setMany({ [installer.fileKey('Bar.dekcns.json')]: { modId: 901 } });
  return fo2.get('Bar.dekcns.json').modId === 901 && fo2.keysOfMod(901).length === 1;
})());

/* ---------- B 从安装包条目建归属 ---------- */
const fo3 = createFileOwner(path.join(tmp, 'owner2.json'));
const fakePlan = {
  entries: [
    { rel: 'MyMod/Foo_P.pak', size: 339 },
    { rel: 'MyMod/Foo_P.ucas', size: 1000 },
    { rel: 'MyMod/Foo.dekcns.json', size: 500 },
    { rel: 'readme.txt', size: 10 }
  ]
};
const r1 = indexPlan(fo3, fakePlan, 4184, 'D:/lib/4184_Blossom.zip');
ok('B1 只给 CNS 数据文件建索引（pak/readme 不收）', r1.added === 1 && fo3.stats().files === 1, JSON.stringify(r1));
ok('B2 记下了来源安装包与包内路径', (() => {
  const v = fo3.get('Foo.dekcns.json');
  return v.modId === 4184 && v.entry === 'MyMod/Foo.dekcns.json' && v.archive === '4184_Blossom.zip';
})(), JSON.stringify(fo3.get('Foo.dekcns.json')));
ok('B3 modId 为 0 时不写', indexPlan(fo3, fakePlan, 0, 'x.zip').added === 0);

/* ---------- C 扫库（注入假的 listEntries，不真读压缩包） ---------- */
(async () => {
  const libDir = path.join(tmp, 'library');
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, '2439_Bayonetta_1.1.zip'), 'x');
  fs.writeFileSync(path.join(libDir, 'noid.zip'), 'x');
  const fo4 = createFileOwner(path.join(tmp, 'owner3.json'));
  const lib = await indexLibrary(fo4, libDir, {
    archive: {
      listEntries: async (p) => ({
        entries: String(p).includes('2439')
          ? [{ path: 'Bayonetta/Bayonetta.dekcns.json', size: 426 }, { path: 'Bayonetta/Bayonetta_P.pak', size: 339 }]
          : [{ path: 'X/Y.dekcns.json', size: 1 }]
      })
    },
    parseName: (name) => {
      const m = String(name).match(/^(\d+)_/);
      return m ? { modId: Number(m[1]) } : null;
    }
  });
  ok('C1 认不出编号的包跳过、只读带编号的', lib.read === 1 && lib.skipped === 1, JSON.stringify(lib));
  ok('C2 索引到 1 条 CNS 条目', lib.entries === 1 && lib.added === 1, JSON.stringify(lib));
  ok('C3 归属指向 Mod 2439', (fo4.get('Bayonetta.dekcns.json') || {}).modId === 2439);

  /* ---------- D 补挂：把孤儿数据文件挂回卡片 ---------- */
  fs.writeFileSync(path.join(modsDir, 'Foo_P [nx900].pak'), 'pak');
  fs.writeFileSync(path.join(modsDir, 'Bar.dekcns.json'), 'cns');
  fs.writeFileSync(path.join(modsDir, 'Baz.dekcns.json'), 'cns2');

  const foD = createFileOwner(path.join(tmp, 'owner4.json'));
  foD.setMany({
    [installer.fileKey('Bar.dekcns.json')]: { modId: 900 },
    [installer.fileKey('Baz.dekcns.json')]: { modId: 901 }   // 这个 Mod 没有卡片
  });

  const makeList = () => ([{
    id: 'disk:paks:Foo_P [nx900]',
    name: 'Foo',
    kind: 'pak',
    enabled: true,
    files: [{ name: 'Foo_P [nx900].pak', disabled: false, size: 3, mtime: '' }],
    fileCount: 1,
    size: 3,
    mtime: '',
    cnsData: []
  }]);
  const list = makeList();
  const out = attachOwners(list, foD, modsDir);
  const card = list[0];
  ok('D1 挂上了 1 个文件', out.attached === 1, JSON.stringify(out));
  ok('D2 卡片多了这个伴随件（companion + cnsData + owner）', (() => {
    const f = card.files.find(x => x.name === 'Bar.dekcns.json');
    return !!f && f.companion === true && f.cnsData === true && f.owner === 900;
  })(), JSON.stringify(card.files));
  const barSize = fs.statSync(path.join(modsDir, 'Bar.dekcns.json')).size;
  ok('D3 计数与体积跟着涨', card.fileCount === 2 && card.size === 3 + barSize, `${card.fileCount}/${card.size}`);
  ok('D4 cnsData 里记了文件名', Array.isArray(card.cnsData) && card.cnsData.includes('Bar.dekcns.json'));
  ok('D5 没有卡片的那个 Mod 不硬挂（记为 noCard）', out.noCard === 1, JSON.stringify(out));
  ok('D6 再跑一次不重复挂（幂等）', attachOwners(list, foD, modsDir).attached === 0);

  /* ---------- E 同一 Mod 多张卡片：挑名字最像的，其次多的，稳定 ---------- */
  const list2 = [
    { id: 'disk:paks:Alpha_P [nx900]', name: 'Alpha', kind: 'pak', enabled: true,
      files: [{ name: 'Alpha_P [nx900].pak', disabled: false, size: 1, mtime: '' }], fileCount: 1, size: 1, mtime: '', cnsData: [] },
    { id: 'disk:paks:Bar_P [nx900]', name: 'Bar', kind: 'pak', enabled: true,
      files: [{ name: 'Bar_P [nx900].pak', disabled: false, size: 1, mtime: '' }], fileCount: 1, size: 1, mtime: '', cnsData: [] }
  ];
  attachOwners(list2, foD, modsDir);
  const barCard = list2.find(c => c.id.indexOf('Bar_P') >= 0);
  ok('E1 挂到名字最像的那张（Bar → Bar_P）', (barCard.cnsData || []).includes('Bar.dekcns.json'),
    JSON.stringify(list2.map(c => [c.id, c.cnsData])));

  /* ---------- F 关着的文件照实记录 ---------- */
  fs.writeFileSync(path.join(modsDir, 'Off.dekcns.json.disabled'), 'off');
  const foF = createFileOwner(path.join(tmp, 'owner5.json'));
  foF.setMany({ [installer.fileKey('Off.dekcns.json.disabled')]: { modId: 900 } });
  const list3 = makeList();
  const outF = attachOwners(list3, foF, modsDir);
  ok('F1 .disabled 的数据文件也能挂上，并标 disabled', (() => {
    const f = list3[0].files.find(x => x.name === 'Off.dekcns.json.disabled');
    return !!f && f.disabled === true;
  })(), JSON.stringify(outF));
  ok('F2 伴随件关着时置 partialDisabled（卡片本身仍是启用）', list3[0].partialDisabled === true && list3[0].enabled === true);

  /* ---------- G 接线：paths / ipc 真的用上了 ---------- */
  ok('G1 paths 导出 modOwnerFile', typeof paths.modOwnerFile === 'string' && /mod-file-owner\.json$/.test(paths.modOwnerFile));
  ok('G2 STATE_NAMES 收了它（会跟着游戏目录走、会镜像）', paths.STATE_NAMES.includes('mod-file-owner.json'));
  const ipc = read('src/main/ipc.js');
  ok('G3 ipc 建了归属表单例', ipc.includes('fileOwner = createFileOwner(paths.modOwnerFile)'));
  ok('G4 启动时补建一次（空表才跑）', ipc.includes('ensureFileOwners();') && ipc.includes('fileOwner.stats().mods > 0'));
  ok('G5 扫描统一走 scanAll，且只有 scanAll 里直接调 scanner.scan',
    (ipc.match(/scanner\.scan\(root, registry, linkReaderSafe\(\)\)/g) || []).length === 1
    && ipc.includes('function scanAll(root)')
    && (ipc.match(/scanAll\(root\)/g) || []).length >= 8,
    String((ipc.match(/scanner\.scan\(root, registry, linkReaderSafe\(\)\)/g) || []).length));
  ok('G6 scanAll 里调了 attachOwners', ipc.includes('attachOwners(list, fileOwner, game.layout(root).modsDir)'));
  ok('G7 有手动重建入口（设置页/后续用）', ipc.includes("handle('mods:indexOwners'") && ipc.includes("handle('mods:ownerStats'"));
  ok('G8 补登记时顺手记归属', ipc.includes('indexOwnerFromPlan(fileOwner, plan'));

  console.log(`\n${pass} 通过 / ${fail} 失败`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
