// ERA 示例：用条目过滤器按变量与最近的剧情选择世界书条目（取代脚本改写世界书开关）。所属文档：docs/era/08-动态提示词.md
// 用法：作为角色卡的酒馆助手脚本导入。需要 ERA-Heron 2.0.1 及以上。
//
// 示例世界是一个虚构的世界模拟器“雾港群岛”，变量大致是：
//   { 世界: { 区域: '潮汐港', 地点: '灯塔', 时代: '和平', 季节: '秋' }, 主角: { 生命: 20, 声望: 3 } }
//
// 条目名里的标记决定它什么时候发送：
//   [区域:潮汐港] 港口风俗          当前区域是“潮汐港”时发送
//   [地点:灯塔] 灯塔                当前地点是“灯塔”时发送
//   [时代:战争] 战时规则            按“世界.时代”在和平、战争两套设定之间切换（ERA 变量操作规则也可以这样分两套）
//   [行动:潜入] 潜入规则            最近的剧情（含玩家这一轮的输入）里出现“潜入”时发送，例如玩家写了“[行动] 潜入仓库”
//   [人物:岚] 灯塔守 岚             最近的剧情提到“岚”（排除“山岚”“晓岚”等词）时发送
//   [替换] 当前局势                 内容里的 {区域}、{季节} 换成变量的值后发送
// 没有标记的条目不表态，按世界书文件里的开关和关键字处理。

(async () => {
  await waitGlobalInitialized('Era');
  if (typeof Era.registerEntryFilter !== 'function') {
    console.warn('[动态世界书] 当前 ERA 不支持条目过滤器，请更新 ERA-Heron');
    return;
  }

  /** 单字人名容易被普通词误触：判断前先去掉这些词。 */
  const BLACKLIST = {
    岚: ['山岚', '晓岚', '雾岚'],
  };
  const mentions = (text, name) => (BLACKLIST[name] ?? []).reduce((t, word) => t.replaceAll(word, ''), text).includes(name);

  /** 条目名里的 [种类:值] 标记。 */
  const tagOf = (name, kind) => new RegExp(`\\[${kind}:([^\\]]+)\\]`).exec(name)?.[1];

  const off = Era.registerEntryFilter('雾港群岛.动态世界书', (entry, ctx) => {
    const world = ctx.stat?.世界;
    // 变量还没有初始化（开场白之前）：不表态
    if (!world) return undefined;

    const region = tagOf(entry.name, '区域');
    if (region) return world.区域 === region;

    const place = tagOf(entry.name, '地点');
    if (place) return world.地点 === place;

    const era = tagOf(entry.name, '时代');
    if (era) return world.时代 === era;

    const action = tagOf(entry.name, '行动');
    if (action) return ctx.text.includes(action);

    const person = tagOf(entry.name, '人物');
    if (person) return mentions(ctx.text, person);

    if (entry.name.includes('[替换]')) {
      return entry.content
        .replaceAll('{区域}', String(world.区域 ?? '未知'))
        .replaceAll('{季节}', String(world.季节 ?? '未知'));
    }

    return undefined;
  });

  $(window).on('pagehide', off);
})();
