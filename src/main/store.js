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

/** 原子写入 JSON（先写 .tmp 再 rename，避免半截文件） */
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
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

module.exports = { readJson, writeJson, createConfigStore, DEFAULT_CONFIG };
