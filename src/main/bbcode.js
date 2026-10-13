'use strict';

/**
 * Nexus 的 mod 说明是 BBCode，转成安全 HTML 供界面展示。
 * 先转义 HTML，再逐条替换 BBCode 标签，避免注入。
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bbcodeToHtml(input) {
  if (!input) return '';
  let t = String(input);

  // 先处理换行标记
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/\r\n?/g, '\n');

  t = escapeHtml(t);

  // 链接 [url=xxx]text[/url] / [url]xxx[/url]
  t = t.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
    (_, href, text) => `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`);
  t = t.replace(/\[url\]([\s\S]*?)\[\/url\]/gi,
    (_, href) => `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`);

  // 图片（仅展示为链接，避免远程图片撑爆界面）
  t = t.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, src) => `<a class="bb-img" href="${src}" target="_blank" rel="noreferrer">[图片]</a>`);

  // 颜色 / 字号 / 字体：只保留文字，丢弃样式
  t = t.replace(/\[color=[^\]]*\]/gi, '').replace(/\[\/color\]/gi, '');
  t = t.replace(/\[size=[^\]]*\]/gi, '').replace(/\[\/size\]/gi, '');
  t = t.replace(/\[font=[^\]]*\]/gi, '').replace(/\[\/font\]/gi, '');
  t = t.replace(/\[center\]/gi, '').replace(/\[\/center\]/gi, '');

  // 强调
  t = t.replace(/\[b\]/gi, '<b>').replace(/\[\/b\]/gi, '</b>');
  t = t.replace(/\[i\]/gi, '<i>').replace(/\[\/i\]/gi, '</i>');
  t = t.replace(/\[u\]/gi, '<u>').replace(/\[\/u\]/gi, '</u>');
  t = t.replace(/\[s\]/gi, '<s>').replace(/\[\/s\]/gi, '</s>');
  t = t.replace(/\[hr\]/gi, '<hr>');

  // 引用 / 折叠
  t = t.replace(/\[quote(=[^\]]*)?\]/gi, '<blockquote>').replace(/\[\/quote\]/gi, '</blockquote>');
  t = t.replace(/\[spoiler(=[^\]]*)?\]/gi, '<details><summary>剧透</summary>').replace(/\[\/spoiler\]/gi, '</details>');

  // 列表
  t = t.replace(/\[list(=[^\]]*)?\]/gi, '<ul>').replace(/\[\/list\]/gi, '</ul>');
  t = t.replace(/\[\*\]/gi, '<li>');
  t = t.replace(/<\/li>\s*(?=<li>)/g, '</li>');

  // 清理残留的未知标签
  t = t.replace(/\[[^\]]{0,40}\]/g, '');

  // 段落：空行分段，单换行 <br>
  t = t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  return t;
}

/** 去掉 BBCode，得到纯文本（用于翻译） */
function bbcodeToText(input) {
  if (!input) return '';
  let t = String(input);
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '');
  t = t.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '$2');
  t = t.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1');
  t = t.replace(/\[[^\]]{0,60}\]/g, '');
  t = t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

module.exports = { bbcodeToHtml, bbcodeToText };
