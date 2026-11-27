// ERA 示例：用条目过滤器按变量与最近的剧情选择世界书条目（取代脚本改写世界书开关）。所属文档：docs/era/08-动态提示词.md
// 用法：作为角色卡的酒馆助手脚本导入。需要 ERA-Heron 1.8.0 及以上才会作用于主生成（1.7.0 只作用于分步更新）。
//
// 条目名里的标记决定它什么时候发送：
//   [区域:寂白之阶·雪境] 雪境生态      当前区域是“寂白之阶·雪境”时发送
//   [地点:初风镇] 初风镇               当前地点是“初风镇”时发送
//   [阶段:归一后] ERA 变量操作规则      按“白鹭辞.归一”二选一，归一前后两套规则整套切换
//   [指令:尝试见切] 见切                最近的剧情（含玩家这一轮的输入）里出现“尝试见切”时发送
//   [人物:烈] 扶光院主                  最近的剧情提到“烈”（排除“激烈”“烈火”等词）时发送
//   [替换] 当前局势                     内容里的 {区域}、{地点} 换成变量的值后发送
// 没有标记的条目不表态，按世界书文件里的开关和关键字处理。

(async () => {
  await waitGlobalInitialized('Era');
  if (typeof Era.registerEntryFilter !== 'function') {
    console.warn('[动态世界书] 当前 ERA 不支持条目过滤器，请更新 ERA-Heron');
    return;
  }

  /** 单字人名容易被普通词误触：判断前先去掉这些词。 */
  const BLACKLIST = {
    烈: ['激烈', '猛烈', '剧烈', '热烈', '强烈', '烈火', '烈日', '烈酒'],
    岩: ['岩石', '熔岩', '岩浆', '岩壁'],
  };
  const mentions = (text, name) => (BLACKLIST[name] ?? []).reduce((t, word) => t.replaceAll(word, ''), text).includes(name);

  /** 条目名里的 [种类:值] 标记。 */
  const tagOf = (name, kind) => new RegExp(`\\[${kind}:([^\\]]+)\\]`).exec(name)?.[1];

  const off = Era.registerEntryFilter('示例.动态世界书', (entry, ctx) => {
    const stat = ctx.stat ?? {};
    // 变量还没有初始化（开场白之前）：不表态
    if (!stat.世界状态) return undefined;

    const region = tagOf(entry.name, '区域');
    if (region) return stat.世界状态.当前区域 === region;

    const place = tagOf(entry.name, '地点');
    if (place) return stat.世界状态.当前地点 === place;

    const phase = tagOf(entry.name, '阶段');
    if (phase) return (stat.白鹭辞?.归一 ? '归一后' : '归一前') === phase;

    const command = tagOf(entry.name, '指令');
    if (command) return ctx.text.includes(command);

    const person = tagOf(entry.name, '人物');
    if (person) return mentions(ctx.text, person);

    if (entry.name.includes('[替换]')) {
      return entry.content
        .replaceAll('{区域}', String(stat.世界状态.当前区域 ?? '未知'))
        .replaceAll('{地点}', String(stat.世界状态.当前地点 ?? '未知'));
    }

    return undefined;
  });

  $(window).on('pagehide', off);
})();
