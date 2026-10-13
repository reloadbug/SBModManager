'use strict';

/**
 * archiveName 测试（纯函数，无 IO）。
 *
 * 钉死两件事：
 *   1. 压缩包格式靠**文件头**嗅探 —— Nexus CDN 给的名字没有扩展名
 *   2. 规范名 `<modId>_<模组名>_<版本>.<ext>`，同 mod 多文件靠版本/fileId 区分
 */

const assert = require('assert').strict;
const {
  sniffExtension, safeSlug, buildArchiveName, buildLegacyArchiveName, extOf, KNOWN_EXTS
} = require('../src/main/archiveName');

// ⚠️ 魔数必须用**字节数组**构造。`Buffer.from('7z\xBC\xAF\x27\x1C')` 会先按
//    JS 字符串（UTF-16）再按 UTF-8 编码，`\xBC` 变成 0xC3 0xBC 两个字节，
//    夹具本身就错了（第一版测试就是这么写的，7z 用例假失败）。
const bytes = (...b) => Buffer.from(b);
const ZIP = bytes(0x50, 0x4B, 0x03, 0x04, 0x78, 0x78, 0x78, 0x78);          // PK\x03\x04
const ZIP_EMPTY = bytes(0x50, 0x4B, 0x05, 0x06, 0x78, 0x78, 0x78, 0x78);    // PK\x05\x06
const SEVENZ = bytes(0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C, 0x78, 0x78);       // 7z¼¯'
const RAR4 = bytes(0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00, 0x78);          // Rar!\x1A\x07\x00
const RAR5 = bytes(0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00);         // Rar!\x1A\x07\x01\x00
const GARBAGE = bytes(0x4D, 0x5A, 0x90, 0x00, 0x03, 0x78, 0x78, 0x78);
const SHORT_PK = bytes(0x50, 0x4B);                                          // 只有 2 字节

/* ---------- 1. 文件头嗅探 ---------- */
assert.equal(sniffExtension(ZIP), 'zip');
assert.equal(sniffExtension(ZIP_EMPTY), 'zip');
assert.equal(sniffExtension(SEVENZ), '7z');
assert.equal(sniffExtension(RAR4), 'rar');
assert.equal(sniffExtension(RAR5), 'rar');
assert.equal(sniffExtension(GARBAGE), '');
assert.equal(sniffExtension(null), '');
assert.equal(sniffExtension(Buffer.alloc(0)), '');
assert.equal(sniffExtension(SHORT_PK), '');

/* ---------- 2. 安全化 ---------- */
assert.equal(safeSlug('Silver Kunoich transparent CNS'), 'Silver Kunoich transparent CNS');
assert.equal(safeSlug('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
assert.equal(safeSlug('  多个   空格  '), '多个 空格');
assert.equal(safeSlug('...前面是点...'), '前面是点');
assert.equal(safeSlug(''), '');
assert.equal(safeSlug(null), '');
assert.equal(safeSlug(undefined), '');
// 超长要截断，但别超过 120
assert.ok(safeSlug('x'.repeat(500)).length <= 120);

/* ---------- 3. 规范名 ---------- */
assert.equal(
  buildArchiveName({ modId: 533, name: 'Cake Unveiled - Cooling Suit with Jacketless and CNS Option (Nikke Alice)', version: '6.0', ext: 'zip' }),
  '533_Cake Unveiled - Cooling Suit with Jacketless and CNS Option (Nikke Alice)_6.0.zip');
// 文件版本优先于 mod 版本
assert.equal(
  buildArchiveName({ modId: 1507, name: 'Silver Kunoich transparent CNS', version: '1.0', fileVersion: '716', ext: 'zip' }),
  '1507_Silver Kunoich transparent CNS_716.zip');
// 没有扩展名时（CDN 名字的常态）也要能出名字
assert.equal(
  buildArchiveName({ modId: 1252, name: 'Tabihose - YoRHa Ceremonial', version: 'v3.1', ext: '' }),
  '1252_Tabihose - YoRHa Ceremonial_v3.1');
// 缺版本
assert.equal(buildArchiveName({ modId: 1, name: 'A Mod', ext: '7z' }), '1_A Mod.7z');
// 只有 modId（元数据还没拉到）
assert.equal(buildArchiveName({ modId: 42, ext: 'zip' }), '42_mod.zip');
// 啥都没有也不能空
assert.equal(buildArchiveName({}), 'mod');
// 中文名保留（Windows 合法，且用户认得出）
assert.equal(buildArchiveName({ modId: 692, name: '中文 模组 名', version: '4.65', ext: 'zip' }), '692_中文 模组 名_4.65.zip');
// 非法字符被洗掉
assert.equal(buildArchiveName({ modId: 7, name: 'a/b:c', version: '1', ext: 'zip' }), '7_a b c_1.zip');
// 重复下划线压一压
assert.equal(buildArchiveName({ modId: 7, name: 'a  b', version: '1 2', ext: 'zip' }), '7_a b_1 2.zip');

/* ---------- 4. legacy 名 ---------- */
assert.equal(buildLegacyArchiveName({ modId: 533, fileId: 13012, ext: 'zip' }), 'mod_533_f13012.zip');
assert.equal(buildLegacyArchiveName({ modId: 533, ext: '7z' }), 'mod_533.7z');
assert.equal(buildLegacyArchiveName({ modId: 533 }), 'mod_533');
assert.equal(buildLegacyArchiveName({}), 'mod_unknown');

/* ---------- 5. 扩展名兜底 ---------- */
assert.equal(extOf('/x/y/foo.7z'), '7z');
assert.equal(extOf('/x/y/foo.ZIP'), 'zip');
assert.equal(extOf('Nexus Global Content Delivery Network'), '');
assert.equal(extOf('/x/y/foo.tar.gz'), '');
assert.deepEqual(KNOWN_EXTS, ['7z', 'zip', 'rar']);

console.log('archive name tests passed');
