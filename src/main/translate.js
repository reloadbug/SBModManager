'use strict';
const https = require('https');
const { readJson, writeJson } = require('./store');

/**
 * 翻译服务。默认后端 MyMemory（免费、无需 Key，实测本机可直连）。
 * 原文永远保留，译文单独存一份，界面可随时切回英文。
 * 结果持久化到 data/cache/translate.json，同一段文字只翻一次。
 */

const MAX_CHUNK = 450; // MyMemory 匿名请求约 500 字节上限

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'StarBladeModManager/0.1 (Windows)', 'Accept': 'application/json' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error('翻译服务返回了非 JSON 内容')); }
      });
    });
    req.on('error', e => reject(new Error('翻译请求失败：' + e.message)));
    req.setTimeout(20000, () => req.destroy(new Error('翻译请求超时')));
  });
}

/** 把长文切成不超过 MAX_CHUNK 的片段，优先在段落/句子边界切 */
function chunk(text) {
  const parts = [];
  const paras = String(text).split(/\n{2,}/);
  for (const p of paras) {
    if (p.length <= MAX_CHUNK) { if (p.trim()) parts.push(p); continue; }
    let buf = '';
    for (const sentence of p.split(/(?<=[.!?。！？])\s+/)) {
      if ((buf + ' ' + sentence).length > MAX_CHUNK) {
        if (buf.trim()) parts.push(buf.trim());
        if (sentence.length > MAX_CHUNK) {
          for (let i = 0; i < sentence.length; i += MAX_CHUNK) parts.push(sentence.slice(i, i + MAX_CHUNK));
          buf = '';
        } else buf = sentence;
      } else buf = buf ? buf + ' ' + sentence : sentence;
    }
    if (buf.trim()) parts.push(buf.trim());
  }
  return parts;
}

async function mymemoryTranslate(text, target) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
    '&langpair=' + encodeURIComponent('en|' + target);
  const json = await httpsGetJson(url);
  const t = json && json.responseData && json.responseData.translatedText;
  if (!t) {
    const msg = (json && json.responseDetails) || '翻译服务未返回结果';
    throw new Error(msg);
  }
  // MyMemory 在超限时会返回警告文本
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error(t);
  return t;
}

function createTranslator({ cacheFile, targetLang = 'zh-CN' } = {}) {
  let cache = readJson(cacheFile, {});
  let dirty = false;
  let timer = null;

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    try { writeJson(cacheFile, cache); } catch { /* 忽略写失败 */ }
  };
  const scheduleFlush = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, 1500);
  };

  const keyOf = (text, lang) => lang + '::' + require('crypto').createHash('sha1').update(text).digest('hex');

  async function translate(text, lang, onProgress) {
    const target = lang || targetLang;
    const src = String(text || '').trim();
    if (!src) return { text: '', cached: false };

    const k = keyOf(src, target);
    if (cache[k]) return { text: cache[k], cached: true };

    const parts = chunk(src);
    const out = [];
    let done = 0;
    const report = () => { if (onProgress) try { onProgress({ done, total: parts.length }); } catch { /* 忽略 */ } };
    report();

    for (const p of parts) {
      const pk = keyOf(p, target);
      if (cache[pk]) { out.push(cache[pk]); done++; report(); continue; }
      const translated = await mymemoryTranslate(p, target);
      cache[pk] = translated;
      out.push(translated);
      done++;
      report();
      scheduleFlush();
    }
    const joined = out.join('\n\n');
    cache[k] = joined;
    scheduleFlush();
    flush();
    return { text: joined, cached: false, chunks: parts.length };
  }

  return {
    translate,
    stats: () => ({ entries: Object.keys(cache).length }),
    clear: () => { cache = {}; writeJson(cacheFile, cache); }
  };
}

module.exports = { createTranslator, chunk };
