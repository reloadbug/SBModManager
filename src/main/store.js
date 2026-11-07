'use strict';
const fs = require('fs');
const path = require('path');

/** 读取 JSON，失败或不存在时返回 fallback */
function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * 写文件时的「镜像」钩子。
 *
 * 数据现在优先放在 `<游戏根>\.sbmod\`（跟着游戏走），但缓存/日志仍留在管理器目录，
 * 而且真要在会话中途换数据目录就得重建整条链路（见 `paths.setDataDir` 的注释）。
 * 所以这里的做法是：**照旧写当前目录，同时把同一份内容镜像到游戏目录**。
 * 下一次启动时 `paths` 会优先读游戏目录里那份，等于自动完成了「跟着游戏走」。
 *
 * 由 `ipc.init()` 用 `gameHome.mirror` 装上；纯 Node 探针里没人装，钩子是空的。
 */
let mirrorFn = null;
function setMirror(fn) { mirrorFn = typeof fn === 'function' ? fn : null; }

/** 原子写入 JSON（先写 .tmp 再 rename，避免半截文件） */
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  if (mirrorFn) {
    // 镜像失败绝不能影响主写入（游戏目录可能只读/被占用）
    try { mirrorFn(file, data); } catch { /* 忽略 */ }
  }
}

/* ---------------- 配置 ---------------- */

const DEFAULT_CONFIG = {
  gameRoot: 'D:\\games\\Star Blade',
  nexusApiKey: '',
  translateBackend: 'mymemory',
  targetLang: 'zh-CN',
  autoTranslate: true,
  listPageSize: 24,
  requestTimeout: 20000,
  // 下载目录监听：盯着「下载」文件夹，出现新的 mod 压缩包就自动导入队列
  watchDownloads: true,
  // 自动安装开关：关掉后，监听到的包只进队列不自动装（一律等确认）
  watchAutoInstall: true,
  // 自动授权：新加入下载队列的任务直接向 Nexus 要下载授权，不再逐条弹窗让你点。
  // 关掉后回到老流程（每条任务点「手动授权」在窗口里点一次下载按钮）。
  autoAuthorize: true,
  // 记住上次的筛选条件：浏览页（排序 / 成人内容 / 只显示未安装 / 黑名单 / 只看喜欢 /
  // 分类 / 标签）与「已安装 Mod」页（排序、是否显示内置脚本）下次启动自动套用，
  // 不用每次重新筛。关掉时不保存、不恢复。
  // ⚠️ 搜索词**不算**筛选条件（那是临时查询），故不入快照。
  rememberFilters: true,
  // 实际存下来的筛选快照（由渲染层写入；null = 还没存过）
  lastFilters: null,
  // 监听目录（空 = 用系统「下载」文件夹）
  watchDirs: [],
  // GitHub 镜像前缀（如 https://ghfast.top/）。默认空 —— 不内置第三方镜像，
  // 等于不把二进制交给中间人；只有 github.com 不可达且用户显式配置时才走它
  githubMirror: ''
};

function createConfigStore(file) {
  let cfg = { ...DEFAULT_CONFIG, ...readJson(file, {}) };
  return {
    all: () => ({ ...cfg }),
    get: (k) => cfg[k],
    set(patch) {
      cfg = { ...cfg, ...patch };
      writeJson(file, cfg);
      return { ...cfg };
    },
    reset() {
      cfg = { ...DEFAULT_CONFIG };
      writeJson(file, cfg);
      return { ...cfg };
    },
    defaults: DEFAULT_CONFIG
  };
}

module.exports = { readJson, writeJson, createConfigStore, setMirror, DEFAULT_CONFIG };
