'use strict';
/**
 * 分类 / 标签筛选自检。
 *
 * 分两部分：
 *   A. 离线 —— `buildModsFilter` 拼出来的 GraphQL filter 片段（**纯函数**，必须稳）
 *   B. 联网 —— 真实打 Nexus 接口，验证筛选结果与计数自洽（连不上时记为「跳过」）
 *
 * A 部分为什么重要：这里有两个实测踩过的坑，写错了不会报错，只会**静默返回错误数据**：
 *   1. `tag` 在同一个 filter 对象里重复写 → GraphQL 拒绝（多选必须嵌套 filter）
 *   2. `op:OR` 写在顶层 → 把 gameDomainName 一起 OR 掉，返回 12 万+（全站）而不是剑星的几千
 *
 * 用法：
 *   node _probe/nexus-filter-test.js
 */
const { createNexus, buildModsFilter, CATEGORIES, TAGS, ADULT_MODES } = require('../src/main/nexus');

let pass = 0, fail = 0, skip = 0;

function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

async function ta(label, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else if (r === 'skip') { skip++; console.log('  ~ ' + label + '  → 跳过（网络不通）'); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

/* ============ A. 离线：filter 片段构造 ============ */
console.log('\n=== A. buildModsFilter（离线） ===');

t('默认只带游戏限定', () => {
  const { filters } = buildModsFilter({});
  return filters.length === 1 && filters[0] === 'gameDomainName:{value:"stellarblade"}' ? true : JSON.stringify(filters);
});

t('分类单选 → categoryName', () => {
  const { filters, cat } = buildModsFilter({ category: 'Outfits' });
  if (cat !== 'Outfits') return 'cat=' + cat;
  return filters.includes('categoryName:{value:"Outfits"}') ? true : JSON.stringify(filters);
});

t('空分类不产生 categoryName', () => {
  const { filters } = buildModsFilter({ category: '   ' });
  return filters.some(f => f.includes('categoryName')) ? JSON.stringify(filters) : true;
});

t('单标签 → 直接 tag 字段（不嵌套）', () => {
  const { filters } = buildModsFilter({ tags: ['Textures'] });
  if (!filters.includes('tag:{value:"Textures"}')) return JSON.stringify(filters);
  return filters.some(f => f.startsWith('filter:[')) ? '不该嵌套：' + JSON.stringify(filters) : true;
});

t('多标签 → 嵌套 filter + op:OR（且 OR 不在顶层）', () => {
  const { filters } = buildModsFilter({ tags: ['Sexualised', 'Textures'] });
  const nested = filters.find(f => f.startsWith('filter:['));
  if (!nested) return '没生成嵌套 filter：' + JSON.stringify(filters);
  if (!nested.includes('op:OR')) return '嵌套层没有 op:OR：' + nested;
  if (!nested.includes('{tag:{value:"Sexualised"}}') || !nested.includes('{tag:{value:"Textures"}}')) return nested;
  // 顶层绝不能出现 op:OR —— 那会把 gameDomainName 一起 OR 掉
  if (filters[0].includes('op:OR')) return '顶层被污染：' + filters[0];
  if (filters.filter(f => f.includes('op:OR')).length !== 1) return 'op:OR 出现了多次：' + JSON.stringify(filters);
  return true;
});

t('多标签不重复写 tag 字段（GraphQL 不允许重复键）', () => {
  const { filters } = buildModsFilter({ tags: ['A', 'B', 'C'] });
  const topLevel = filters.join(',').split('filter:[')[0];
  const n = (topLevel.match(/tag:\{/g) || []).length;
  return n === 0 ? true : '顶层出现了 ' + n + ' 个 tag 字段：' + topLevel;
});

t('三个标签都在嵌套里', () => {
  const { filters } = buildModsFilter({ tags: ['A', 'B', 'C'] });
  const nested = filters.find(f => f.startsWith('filter:[')) || '';
  return ['A', 'B', 'C'].every(x => nested.includes(`{tag:{value:"${x}"}}`)) ? true : nested;
});

t('分类 + 多标签 同时生效', () => {
  const { filters } = buildModsFilter({ category: 'Outfits', tags: ['Textures', 'Replacer'] });
  if (!filters.includes('categoryName:{value:"Outfits"}')) return JSON.stringify(filters);
  return filters.some(f => f.startsWith('filter:[') && f.includes('op:OR')) ? true : JSON.stringify(filters);
});

t('引号 / 反斜杠被摘掉（防注入破坏查询）', () => {
  const { filters, cat } = buildModsFilter({ category: 'Out"fits\\x' });
  if (cat !== 'Outfitsx') return 'cat=' + cat;
  return filters.includes('categoryName:{value:"Outfitsx"}') ? true : JSON.stringify(filters);
});

t('标签数组里的脏值被过滤', () => {
  const { tagList } = buildModsFilter({ tags: ['Textures', '', '  ', null, undefined] });
  return tagList.length === 1 && tagList[0] === 'Textures' ? true : JSON.stringify(tagList);
});

t('adultMode=hide → adultContent:false', () => {
  const { filters, adultMode } = buildModsFilter({ adultMode: 'hide' });
  if (adultMode !== 'hide') return 'adultMode=' + adultMode;
  return filters.includes('adultContent:{value:false}') ? true : JSON.stringify(filters);
});

t('adultMode=only → adultContent:true', () => {
  const { filters, adultMode } = buildModsFilter({ adultMode: 'only' });
  if (adultMode !== 'only') return 'adultMode=' + adultMode;
  return filters.includes('adultContent:{value:true}') ? true : JSON.stringify(filters);
});

t('adultMode=all → 不加任何 adultContent', () => {
  const { filters, adultMode } = buildModsFilter({ adultMode: 'all' });
  if (adultMode !== 'all') return 'adultMode=' + adultMode;
  return filters.some(f => f.includes('adultContent')) ? JSON.stringify(filters) : true;
});

t('adultMode 默认 = all（不过滤）', () => {
  const { filters, adultMode } = buildModsFilter({});
  if (adultMode !== 'all') return 'adultMode=' + adultMode;
  return filters.some(f => f.includes('adultContent')) ? JSON.stringify(filters) : true;
});

t('非法 adultMode 回落到 all（不会拼出坏查询）', () => {
  for (const bad of ['', null, undefined, 'HIDE', 'yes', 123, {}, []]) {
    const { adultMode, filters } = buildModsFilter({ adultMode: bad });
    if (adultMode !== 'all') return JSON.stringify(bad) + ' → ' + adultMode;
    if (filters.some(f => f.includes('adultContent'))) return JSON.stringify(bad) + ' 拼出了 adultContent';
  }
  return true;
});

t('三态互斥：同时只会出现一个 adultContent 条件', () => {
  for (const m of ['hide', 'all', 'only']) {
    const { filters } = buildModsFilter({ adultMode: m });
    const n = filters.filter(f => f.includes('adultContent')).length;
    if (m === 'all' ? n !== 0 : n !== 1) return m + ' 出现了 ' + n + ' 个 adultContent';
  }
  return true;
});

t('搜索 + 分类 + 标签 三者共存', () => {
  const { filters } = buildModsFilter({ search: 'bikini', category: 'Outfits', tags: ['Sexualised'] });
  if (!filters.some(f => f.includes('name:{value:"bikini", op:WILDCARD}'))) return JSON.stringify(filters);
  if (!filters.some(f => f.includes('categoryName:{value:"Outfits"}'))) return JSON.stringify(filters);
  return filters.some(f => f.includes('tag:{value:"Sexualised"}')) ? true : JSON.stringify(filters);
});

t('分类常量：5 个，值不重复', () => {
  if (CATEGORIES.length !== 5) return '有 ' + CATEGORIES.length + ' 个';
  const vals = new Set(CATEGORIES.map(c => c.value));
  return vals.size === 5 ? true : '有重复值';
});

t('分类常量：中文名齐全', () => {
  const bad = CATEGORIES.filter(c => !c.zh || !c.value);
  return bad.length ? JSON.stringify(bad) : true;
});

t('标签常量：值不重复、中文名齐全', () => {
  const vals = new Set(TAGS.map(x => x.value));
  if (vals.size !== TAGS.length) return '有重复值';
  const bad = TAGS.filter(x => !x.zh || !x.value);
  return bad.length ? JSON.stringify(bad) : true;
});

t('标签常量不含与分类重名的项（避免界面混淆）', () => {
  const catNames = new Set(CATEGORIES.map(c => c.value));
  const dup = TAGS.filter(x => catNames.has(x.value));
  return dup.length ? JSON.stringify(dup.map(x => x.value)) : true;
});

t('ADULT_MODES 导出且为三态 hide/all/only', () => {
  if (!Array.isArray(ADULT_MODES)) return 'ADULT_MODES 不是数组：' + typeof ADULT_MODES;
  const want = ['hide', 'all', 'only'];
  if (ADULT_MODES.length !== 3) return '有 ' + ADULT_MODES.length + ' 个';
  return want.every(x => ADULT_MODES.includes(x)) ? true : JSON.stringify(ADULT_MODES);
});

/* ============ B. 联网：真实接口 ============ */
(async () => {
  console.log('\n=== B. 真实接口（联网） ===');
  const nexus = createNexus();

  // 先探活
  let alive = false;
  try {
    const r = await nexus.listMods({ count: 1 });
    alive = r.total > 0;
  } catch { /* 网络不通 */ }

  if (!alive) {
    skip += 14;
    console.log('  ~ 全部跳过（连不上 Nexus）');
    summary();
    return;
  }

  const base = await nexus.listMods({ count: 1 });

  // ⚠️ 别写死数字：剑星的 mod 数量每天在涨，写死会天天报假失败。
  //    这里只断言「量级对」（全站有 12 万+，剑星只有几千），
  //    后面所有「不能超过全站总数」的断言都以这次实测值为基准。
  await ta('剑星 mod 总数在合理量级（>3000 且远小于全站）',
    () => base.total > 3000 ? true : '只拿到 ' + base.total);

  await ta('分类计数之和 = 总数（分类完备覆盖）', async () => {
    const f = await nexus.getFacets({});
    const sum = f.categories.reduce((a, c) => a + c.count, 0);
    return sum === f.total ? true : sum + ' ≠ ' + f.total;
  });

  await ta('facets 返回 5 个分类 + 9 个标签', async () => {
    const f = await nexus.getFacets({});
    if (f.categories.length !== 5) return '分类 ' + f.categories.length + ' 个';
    if (f.tags.length !== 9) return '标签 ' + f.tags.length + ' 个';
    return true;
  });

  await ta('facets 带 degraded 标记，计数为数字（降级契约）', async () => {
    const f = await nexus.getFacets({});
    if (f.degraded !== false) return 'degraded=' + f.degraded;
    if (typeof f.total !== 'number') return 'total 不是数字：' + f.total;
    const bad = f.categories.concat(f.tags).filter(x => typeof x.count !== 'number');
    return bad.length ? '有计数不是数字：' + JSON.stringify(bad.slice(0, 3)) : true;
  });

  await ta('facets 分类计数与逐个查询一致', async () => {
    const f = await nexus.getFacets({});
    for (const c of f.categories) {
      const r = await nexus.listMods({ category: c.value, count: 1 });
      if (r.total !== c.count) return c.value + '：facets=' + c.count + ' 实际=' + r.total;
    }
    return true;
  });

  await ta('按分类筛选：结果全属该分类', async () => {
    const r = await nexus.listMods({ category: 'Outfits', count: 20 });
    if (!r.items.length) return '没拿到结果';
    const bad = r.items.filter(m => m.category !== 'Outfits');
    return bad.length ? bad.map(m => m.category).join(',') : true;
  });

  await ta('按分类筛选：中文名正确映射', async () => {
    const r = await nexus.listMods({ category: 'User Interface', count: 5 });
    if (!r.items.length) return '没拿到结果';
    const bad = r.items.filter(m => m.categoryZh !== '界面');
    return bad.length ? JSON.stringify(bad.map(m => m.categoryZh)) : true;
  });

  await ta('单标签筛选 = 该标签的 facets 计数', async () => {
    const f = await nexus.getFacets({});
    const t0 = f.tags.find(x => x.value === 'Textures');
    const r = await nexus.listMods({ tags: ['Textures'], count: 1 });
    return r.total === t0.count ? true : '列表=' + r.total + ' facets=' + t0.count;
  });

  await ta('多标签取并集（OR），不是交集', async () => {
    const a = await nexus.listMods({ tags: ['Sexualised'], count: 1 });
    const b = await nexus.listMods({ tags: ['Textures'], count: 1 });
    const both = await nexus.listMods({ tags: ['Sexualised', 'Textures'], count: 1 });
    // 并集必须 ≥ 任一单项；交集一定 ≤ min。这里断言前者。
    if (both.total < Math.max(a.total, b.total)) return '并集 ' + both.total + ' < 单项 max ' + Math.max(a.total, b.total);
    // 且必须严格大于交集（35）——说明不是 AND
    if (both.total <= 35) return '看起来被当成 AND 了：' + both.total;
    // 且不能超过全站总数（说明 gameDomainName 被 OR 掉了）
    if (both.total > base.total) return '超过剑星总数，gameDomainName 被 OR 掉了：' + both.total + ' > ' + base.total;
    return true;
  });

  await ta('分类 + 标签 组合筛选自洽', async () => {
    const f = await nexus.getFacets({ category: 'Outfits' });
    const t0 = f.tags.find(x => x.value === 'Textures');
    const r = await nexus.listMods({ category: 'Outfits', tags: ['Textures'], count: 1 });
    return r.total === t0.count ? true : '列表=' + r.total + ' facets=' + t0.count;
  });

  await ta('标签计数随分类变化', async () => {
    const all = await nexus.getFacets({});
    const outfits = await nexus.getFacets({ category: 'Outfits' });
    const a = all.tags.find(x => x.value === 'Textures').count;
    const b = outfits.tags.find(x => x.value === 'Textures').count;
    if (a === b) return '没变化，可能分类没传进去（都是 ' + a + '）';
    return b <= a ? true : '分类内计数反而更大：' + b + ' > ' + a;
  });

  await ta('筛选结果与排序共存', async () => {
    const r = await nexus.listMods({ category: 'Outfits', sort: 'newest', count: 5 });
    if (r.items.length !== 5) return '只拿到 ' + r.items.length;
    const dates = r.items.map(m => Date.parse(m.createdAt) || 0);
    for (let i = 1; i < dates.length; i++) if (dates[i] > dates[i - 1]) return '没按最新排序';
    return true;
  });

  await ta('筛选 + 搜索关键词共存', async () => {
    const r = await nexus.listMods({ category: 'Outfits', search: 'bikini', count: 10 });
    if (!r.total) return '没结果';
    const bad = r.items.filter(m => m.category !== 'Outfits');
    return bad.length ? '混入了非 Outfits：' + bad.map(m => m.category).join(',') : true;
  });

  await ta('缓存 key 含分类：不同分类拿到不同结果', async () => {
    const a = await nexus.listMods({ category: 'Outfits', count: 3 });
    const b = await nexus.listMods({ category: 'Visuals', count: 3 });
    const aIds = a.items.map(m => m.modId).join(',');
    const bIds = b.items.map(m => m.modId).join(',');
    return aIds !== bIds ? true : '两个分类拿到了同样的结果（缓存 key 没带分类？）';
  });

  await ta('缓存 key 含标签：不同标签拿到不同结果', async () => {
    const a = await nexus.listMods({ tags: ['Textures'], count: 3 });
    const b = await nexus.listMods({ tags: ['Replacer'], count: 3 });
    return a.items.map(m => m.modId).join(',') !== b.items.map(m => m.modId).join(',') ? true : '缓存 key 没带标签？';
  });

  await ta('空分类 / 空标签数组 = 不过滤', async () => {
    const r = await nexus.listMods({ category: '', tags: [], count: 1 });
    return r.total === base.total ? true : r.total + ' ≠ ' + base.total;
  });

  await ta('隐藏成人时：facets 计数与列表总数一致', async () => {
    const f = await nexus.getFacets({ adultMode: 'hide' });
    const r = await nexus.listMods({ adultMode: 'hide', count: 1 });
    if (f.total !== r.total) return 'facets=' + f.total + ' 列表=' + r.total;
    const sum = f.categories.reduce((a, c) => a + c.count, 0);
    return sum === f.total ? true : '分类计数之和 ' + sum + ' ≠ ' + f.total;
  });

  await ta('仅成人时：facets 计数与列表总数一致', async () => {
    const f = await nexus.getFacets({ adultMode: 'only' });
    const r = await nexus.listMods({ adultMode: 'only', count: 1 });
    if (f.total !== r.total) return 'facets=' + f.total + ' 列表=' + r.total;
    const sum = f.categories.reduce((a, c) => a + c.count, 0);
    return sum === f.total ? true : '分类计数之和 ' + sum + ' ≠ ' + f.total;
  });

  await ta('三态自洽：全部 = 隐藏成人 + 仅成人', async () => {
    const all = await nexus.listMods({ adultMode: 'all', count: 1 });
    const no = await nexus.listMods({ adultMode: 'hide', count: 1 });
    const yes = await nexus.listMods({ adultMode: 'only', count: 1 });
    const sum = no.total + yes.total;
    return sum === all.total ? true : no.total + ' + ' + yes.total + ' = ' + sum + ' ≠ ' + all.total;
  });

  await ta('仅成人模式：返回的条目确实都是成人', async () => {
    const r = await nexus.listMods({ adultMode: 'only', count: 24 });
    if (!r.items.length) return '没拿到结果';
    const bad = r.items.filter(m => !m.adult);
    return bad.length ? '混入 ' + bad.length + ' 个非成人：' + bad.slice(0, 3).map(m => m.modId).join(',') : true;
  });

  await ta('隐藏成人模式：返回的条目确实都不是成人', async () => {
    const r = await nexus.listMods({ adultMode: 'hide', count: 24 });
    if (!r.items.length) return '没拿到结果';
    const bad = r.items.filter(m => m.adult);
    return bad.length ? '混入 ' + bad.length + ' 个成人：' + bad.slice(0, 3).map(m => m.modId).join(',') : true;
  });

  await ta('三态各拿到不同结果（缓存 key 带 adultMode）', async () => {
    const a = await nexus.listMods({ adultMode: 'all', count: 5 });
    const h = await nexus.listMods({ adultMode: 'hide', count: 5 });
    const o = await nexus.listMods({ adultMode: 'only', count: 5 });
    const ids = [a, h, o].map(x => x.items.map(m => m.modId).join(','));
    return new Set(ids).size === 3 ? true : '有重复结果：' + JSON.stringify(ids);
  });

  await ta('仅成人 + 分类 + 标签 组合仍自洽', async () => {
    const r = await nexus.listMods({ adultMode: 'only', category: 'Outfits', tags: ['Textures'], count: 10 });
    const bad = r.items.filter(m => m.category !== 'Outfits' || !m.adult);
    return bad.length ? '混入 ' + bad.length + ' 个不该有的' : true;
  });

  await ta('隐藏成人 + 分类 + 标签 组合仍自洽', async () => {
    const r = await nexus.listMods({ adultMode: 'hide', category: 'Outfits', tags: ['Textures'], count: 10 });
    const bad = r.items.filter(m => m.category !== 'Outfits' || m.adult);
    return bad.length ? '混入 ' + bad.length + ' 个不该有的' : true;
  });

  summary();

  function summary() {
    console.log('\n' + '─'.repeat(52));
    console.log('  通过 ' + pass + ' · 失败 ' + fail + (skip ? ' · 跳过 ' + skip : ''));
    console.log('─'.repeat(52));
    process.exit(fail ? 1 : 0);
  }
})().catch(e => {
  console.error('\n测试崩了：' + e.message);
  process.exit(1);
});
