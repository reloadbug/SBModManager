'use strict';
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

/**
 * 解压抽象层。
 *
 * 本机实测（2026-10-10）：
 *   · `C:\Program Files\7-Zip\7z.exe` 存在（7-Zip 26.03），首选
 *   · `C:\Windows\System32\tar.exe` 是 bsdtar（libarchive），可读 zip/7z，作为兜底
 *   · Git Bash 里的 `tar` 是 GNU tar 1.35，**读不了 zip**，不能用
 *
 * ⚠️ 必须加 `-sccUTF-8`：不加的话 7z 按控制台代码页（GBK）输出，
 *    中文文件名会变成 `����˵��.txt` 这样的乱码，后续路径判断全错。
 */

const TOOL_CANDIDATES = [
  { kind: '7z', exe: 'C:\\Program Files\\7-Zip\\7z.exe' },
  { kind: '7z', exe: 'C:\\Program Files (x86)\\7-Zip\\7z.exe' },
  { kind: '7z', exe: 'C:\\Program Files\\7-Zip\\7za.exe' },
  { kind: 'tar', exe: 'C:\\Windows\\System32\\tar.exe' }
];

const MAX_BUFFER = 32 * 1024 * 1024;

let cached = null;
let probed = false;

/**
 * 把 7-Zip / tar 的原始输出**翻译成用户能行动的话**。
 *
 * 🔴 7z 把一切输出都写在 **stdout**（banner、进度、完整列表），stderr 通常为空；
 *    出错时退出码是 **2**（fatal）。原来这里直接把 stdout 前 500 字塞进
 *    `error.message`，用户看到的是：
 *      「结构识别失败：7-Zip 26.03 (x64) : Copyright (c) 1999-2026 Igor Pavlov :
 *        2026-09-03 / Scanning the drive for archives: 1 file, 50692225 bytes …」
 *    —— 一整段横幅 + 扫描进度，**没有任何可行动作**（实测 mod 1763）。
 *
 * 所以只保留真正有用的部分：`ERRORS:` 段、已知故障短语、退出码。
 */
function explainToolError(err, stdout, stderr) {
  const code = err && typeof err.code === 'number' ? err.code : null;
  const raw = String(stderr || stdout || (err && err.message) || '');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // ① `ERRORS:` 之后到下一个空段/`----------` 之前，是 7z 自己列的故障原因
  const at = lines.findIndex(l => /^errors?:?$/i.test(l));
  const errBlock = [];
  if (at >= 0) {
    for (let i = at + 1; i < lines.length; i++) {
      if (/^-+$/.test(lines[i]) || /^(Path|Folder|Size|Type|Physical Size|Characteristics|Errors)\b/.test(lines[i])) break;
      errBlock.push(lines[i]);
      if (errBlock.length >= 4) break;
    }
  }

  // ② 已知故障短语 → 人话（顺序即优先级）
  const joined = lines.join('\n');
  let reason = '';
  if (/Unexpected end of archive|unexpected end of data/i.test(joined)) {
    reason = '压缩包不完整（下载被中断，或文件被截断）—— 请重新下载这个文件';
  } else if (/CRC Failed|Data Error|Data error|Bad CRC/i.test(joined)) {
    reason = '压缩包内容损坏（CRC 校验失败）—— 请重新下载这个文件';
  } else if (/Cannot open file as archive|Archive type unsupported|Unsupported archive|not supported archive/i.test(joined)) {
    reason = '这个文件不是受支持的压缩包（可能是网页或视频被存成了 .zip）';
  } else if (/does not look like a tar archive/i.test(joined)) {
    reason = '这个文件不是 tar 压缩包';
  } else if (/Cannot open file|No such file|系统找不到指定的文件|The system cannot find/i.test(joined)) {
    reason = '文件不存在或正在被占用';
  } else if (errBlock.length) {
    reason = errBlock.join('；');
  } else {
    // 兜底：跳过 banner / 进度行 / Node 自己的 "Command failed"，取第一条像样的输出
    const skip = /^(7-Zip|p7zip| Scanning the drive|Listing archive| \d+ file,|.*Copyright \(c\)|Command failed)/i;
    const first = lines.find(l => !skip.test(l));
    reason = first ? first.slice(0, 160) : '解压工具执行失败';
  }

  const tail = code == null ? '' : `（退出码 ${code}）`;
  const msg = `读取压缩包失败${tail}：${reason}`;
  return msg.length > 260 ? msg.slice(0, 257) + '…' : msg;
}

function run(exe, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      ...opts
    }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(explainToolError(err, stdout, stderr));
        e.stdout = stdout;
        e.stderr = stderr;
        e.exitCode = err.code;
        return reject(e);
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/** 探测可用的解压工具，结果缓存 */
function probeTool() {
  if (probed) return cached;
  probed = true;

  for (const c of TOOL_CANDIDATES) {
    try {
      if (!fs.existsSync(c.exe)) continue;

      if (c.kind === '7z') {
        cached = { ...c, label: '7-Zip' };
        break;
      }

      // tar：必须确认是 bsdtar/libarchive —— GNU tar 不支持 zip
      // （Git Bash 里的 tar 就是 GNU tar，误用会报 "This does not look like a tar archive"）
      const out = execFileSync(c.exe, ['--version'], { encoding: 'utf8', windowsHide: true });
      if (/bsdtar|libarchive/i.test(out)) {
        cached = { ...c, label: 'bsdtar (libarchive)' };
        break;
      }
    } catch { /* 换下一个候选 */ }
  }
  return cached;
}

function toolInfo() {
  const t = probeTool();
  return t
    ? { available: true, kind: t.kind, exe: t.exe, label: t.label }
    : {
        available: false,
        kind: null,
        exe: null,
        label: null,
        hint: '没有找到可用的解压工具。请安装 7-Zip（https://www.7-zip.org/）后重试。'
      };
}

/* ---------------- 路径安全 ---------------- */

/**
 * 拒绝绝对路径与向上穿越（zip slip）。
 * 归档里的路径统一转成 `a/b/c` 形式。
 */
function normalizeEntry(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!s) return null;
  if (/^[a-zA-Z]:/.test(s)) return null;          // 绝对路径（C:\...）
  if (s.startsWith('/')) return null;              // 绝对路径（/...）
  const parts = s.split('/');
  if (parts.some(x => x === '..')) return null;    // 向上穿越
  const clean = parts.filter(x => x && x !== '.');
  return clean.length ? clean.join('/') : null;
}

/* ---------------- 列条目 ---------------- */

async function list7z(tool, archivePath) {
  const { stdout } = await run(tool.exe, ['l', '-slt', '-sccUTF-8', '-p-', archivePath]);

  // 表头里也有一行 `Path = <压缩包自身>`，必须从分隔线之后开始解析
  const sep = stdout.indexOf('----------');
  const body = sep >= 0 ? stdout.slice(sep + 10) : stdout;

  const entries = [];
  let cur = null;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('Path = ')) {
      if (cur) entries.push(cur);
      cur = { path: line.slice(7), dir: false, size: 0 };
    } else if (!cur) {
      continue;
    } else if (line.startsWith('Folder = ')) {
      cur.dir = line.slice(9).trim() === '+';
    } else if (line.startsWith('Size = ')) {
      cur.size = Number(line.slice(7).trim()) || 0;
    } else if (line.startsWith('Attributes = ') && /\bD\b/.test(line.slice(13))) {
      cur.dir = true;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

async function listTar(tool, archivePath) {
  const { stdout } = await run(tool.exe, ['-tf', archivePath]);
  return stdout.split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => ({ path: l, dir: /\/$/.test(l), size: 0 }));
}

/**
 * 列出压缩包条目（不解压）。
 * 返回 [{ path:'a/b/c', dir:bool, size:number }]，路径已归一化为 `/` 分隔、已剔除非法项。
 */
async function listEntries(archivePath) {
  const tool = probeTool();
  if (!tool) throw new Error(toolInfo().hint);
  if (!fs.existsSync(archivePath)) throw new Error('压缩包不存在：' + archivePath);

  const raw = tool.kind === '7z'
    ? await list7z(tool, archivePath)
    : await listTar(tool, archivePath);

  const out = [];
  let skipped = 0;
  for (const e of raw) {
    const norm = normalizeEntry(e.path);
    if (!norm) { skipped++; continue; }
    out.push({ path: norm, dir: !!e.dir, size: Number(e.size) || 0 });
  }
  if (!out.length) throw new Error('压缩包是空的，或者里面全是非法路径（已拦截 ' + skipped + ' 项）');
  return { entries: out, skipped, tool };
}

/* ---------------- 解压 ---------------- */

/** 解压到指定目录（目录必须由调用方保证在 data/tmp 下） */
/**
 * 解压。
 *
 * @param {string} archivePath
 * @param {string} destDir
 * @param {string[]} [names] 只解这几个条目（归档内相对路径，`/` 分隔）。
 *   不传 = 全解。给「只要包里的几张预览图」这种场景用 —— 一个 47MB 的变体包
 *   全解要 142MB，只为拿 7 张 jpg 太浪费。
 */
async function extract(archivePath, destDir, names = null) {
  const tool = probeTool();
  if (!tool) throw new Error(toolInfo().hint);

  await fs.promises.mkdir(destDir, { recursive: true });

  // 🔴 只挑「安全的字面文件名」：7z / bsdtar 都把 `-` 开头的参数当开关，
  //    而 `*` `?` 会被当通配符 —— 一旦漏进去就是「解压了别的东西」或「报错」。
  const wanted = Array.isArray(names);
  const picked = (wanted ? names : [])
    .map(n => String(n).replace(/\\/g, '/'))
    .filter(n => n && !n.startsWith('-') && !/[*?]/.test(n));

  // ⚠️ 传了 names 但全被过滤掉 → **什么都不解**。
  //    绝不能因为 `picked` 为空就退回「全解」—— 那是「本想只拿 7 张图，
  //    结果把 142MB 全解出来」的静默放大。
  if (wanted && !picked.length) return destDir;

  if (tool.kind === '7z') {
    await run(tool.exe, [
      'x', archivePath,
      '-o' + destDir,
      '-y', '-p-', '-sccUTF-8',
      '-bso0', '-bsp0',          // 静音：只留错误信息，避免几万行进度塞满 buffer
      ...picked
    ]);
  } else {
    await run(tool.exe, ['-xf', archivePath, '-C', destDir, ...picked]);
  }

  return destDir;
}

/* ---------------- 递归统计 ---------------- */

function walk(dir, base = dir, acc = { files: 0, bytes: 0 }) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const it of items) {
    const fp = path.join(dir, it.name);
    if (it.isDirectory()) walk(fp, base, acc);
    else {
      try { acc.bytes += fs.statSync(fp).size; acc.files++; } catch { /* 忽略 */ }
    }
  }
  return acc;
}

module.exports = {
  probeTool,
  toolInfo,
  listEntries,
  extract,
  normalizeEntry,
  walk,
  /** 仅供测试：把 7-Zip/tar 的原始输出翻译成人话（纯函数） */
  explainToolError
};
