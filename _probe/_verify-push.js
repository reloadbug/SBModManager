'use strict';
/**
 * 核对「API 推上远端的内容」与「本地 git 索引」是否逐文件一致。
 *
 * 起因：`push-via-api.js` 上传的是**工作区字节**，而本地 blob 是 index 里
 * （经 `core.autocrlf` 处理过的）字节 —— 两者在行尾上可能不同，于是
 * 远端 tree 的 SHA 与本地 tree 的 SHA 不一致，但内容其实等价。
 *
 * 本脚本按 path 对比 blob sha，并把「sha 不同」的文件再比一次内容
 * （先比字节，再比忽略行尾），从而区分：
 *   - 真差异（内容真的不一样）      → 必须修
 *   - 纯行尾差异（CRLF vs LF）      → 无害
 *
 * 用法：GITHUB_TOKEN=ghp_xxx node _probe/_verify-push.js --repo=reloadbug/SBModManager
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find(a => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const REPO = flag('repo', 'reloadbug/SBModManager');
const BRANCH = flag('branch', 'main');
const TOKEN = process.env.GITHUB_TOKEN;

async function gh(path) {
  const res = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sbmodmanager-verify'
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status + '：' + text.slice(0, 200));
  return JSON.parse(text);
}

/** 去掉所有 \r，用于「忽略行尾」的内容比较 */
const stripCR = b => Buffer.from(b.toString('binary').replace(/\r/g, ''), 'binary');

async function main() {
  if (!TOKEN) throw new Error('缺少 GITHUB_TOKEN');

  const tree = await gh('/repos/' + REPO + '/git/trees/' + BRANCH + '?recursive=1');
  if (tree.truncated) console.warn('⚠️ tree 被截断，结果可能不完整');
  const remote = new Map();
  for (const e of tree.tree) if (e.type === 'blob') remote.set(e.path, { sha: e.sha, size: e.size });

  // 本地索引（sha 即提交里的 blob sha；注意 git 会给非 ASCII 路径加引号）
  // ⚠️ 本沙箱会拦掉同步 spawn（EBUSY），一律用异步 execFile
  const { stdout: raw } = await execFileAsync('git', ['ls-files', '--stage'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const unquote = p => {
    if (p.length < 2 || p[0] !== '"' || p[p.length - 1] !== '"') return p;
    const inner = p.slice(1, -1);
    const bytes = [];
    for (let i = 0; i < inner.length;) {
      const c = inner[i];
      if (c === '\\' && i + 1 < inner.length) {
        const n = inner[i + 1];
        if (n >= '0' && n <= '7') {
          let oct = n, j = i + 2;
          while (j < inner.length && j < i + 4 && inner[j] >= '0' && inner[j] <= '7') { oct += inner[j]; j++; }
          bytes.push(parseInt(oct, 8) & 0xff); i = j; continue;
        }
        const map = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };
        bytes.push(map[n] !== undefined ? map[n] : n.charCodeAt(0)); i += 2; continue;
      }
      const cp = inner.codePointAt(i);
      for (const b of Buffer.from(String.fromCodePoint(cp), 'utf8')) bytes.push(b);
      i += cp > 0xffff ? 2 : 1;
    }
    return Buffer.from(bytes).toString('utf8');
  };
  const local = new Map();
  for (const line of raw.split('\n').filter(Boolean)) {
    const m = line.match(/^(\d+) ([0-9a-f]+) \d+\t(.*)$/);
    if (m) local.set(unquote(m[3]), m[2]);
  }

  const onlyRemote = [...remote.keys()].filter(p => !local.has(p));
  const onlyLocal = [...local.keys()].filter(p => !remote.has(p));
  const sameSha = [], diffSha = [];
  for (const [p, sha] of local) {
    const r = remote.get(p);
    if (!r) continue;
    (r.sha === sha ? sameSha : diffSha).push(p);
  }

  console.log('本地索引文件数 :', local.size);
  console.log('远端 tree 文件数:', remote.size);
  console.log('sha 相同        :', sameSha.length);
  console.log('sha 不同        :', diffSha.length);
  console.log('仅远端有        :', onlyRemote.length, onlyRemote.slice(0, 10));
  console.log('仅本地有        :', onlyLocal.length, onlyLocal.slice(0, 10));

  if (!diffSha.length) {
    console.log('\n✅ 逐文件 sha 全部一致，远端与本地内容完全相同');
    return;
  }

  console.log('\n--- 逐个检查 sha 不同的文件 ---');
  let real = 0, eolOnly = 0;
  for (const p of diffSha) {
    const { stdout: l } = await execFileAsync('git', ['cat-file', 'blob', ':' + p],
      { encoding: 'buffer', maxBuffer: 1 << 28 });
    const j = await gh('/repos/' + REPO + '/git/blobs/' + remote.get(p).sha);
    const r = Buffer.from(j.content, j.encoding === 'base64' ? 'base64' : 'utf8');
    if (l.equals(r)) { console.log('  字节相同(?)', p); continue; }
    if (stripCR(l).equals(stripCR(r))) {
      eolOnly++;
      console.log('  仅行尾不同:', p, ' 本地', l.length, 'B / 远端', r.length, 'B');
    } else {
      real++;
      console.log('  ❌ 内容真不同:', p, ' 本地', l.length, 'B / 远端', r.length, 'B');
    }
  }
  console.log('\n结论：纯行尾差异 ' + eolOnly + ' 个，真差异 ' + real + ' 个');
  if (!real) console.log('✅ 无实质差异 —— 远端与本地内容等价（行尾差异不影响功能）');
}

main().catch(e => { console.error('核对失败：' + e.message); process.exitCode = 1; });
