/*
 * ERA 示例：变量结构（schema）与更新钩子
 * 所属文档：../05-接口与设置.md（“全局接口 Era”一节中的 Era.registerSchema 与 Era.onAfterApply）
 *
 * 用法：
 *   在酒馆助手的脚本库里新建一个“角色卡脚本”，把本文件全部内容粘贴进去并启用。
 *   ERA 变量框架脚本也要启用（顺序不限，本脚本会等待 ERA 加载完）。
 *   本文件是普通 JavaScript，`z`（zod）、`_`（lodash）、`$`（jQuery）都是酒馆助手提供的全局变量，不需要导入。
 *
 * 本脚本对应的开场白初始化（与 ../04-宏.md 步骤 1 的示例相同）：
 *   <VariableInsert>
 *   {
 *     "player_status": { "name": "勇者", "level": 1, "hp": 100, "max_hp": 100, "mp": 50, "max_mp": 50 },
 *     "game_info": { "day": 1, "hour": 8, "weather": "晴朗" }
 *   }
 *   </VariableInsert>
 *
 * 各部分的作用：
 *   1. 常用写法 Num / Percent：AI 有时把数字写成 "5"，Num 只接受数字和纯数字文本；Percent 把数值夹在 0~100。
 *   2. Schema：变量结构。注册后 ERA 会在每个指令块执行后纠正格式、拦下不合法的修改（广播 era:schemaError），
 *      并把 .describe() 的说明、枚举选项通过宏 {{ERA-schema}} 提供给 AI。
 *      - 对象用 z.looseObject：保留 schema 里没写到的键，不会误删变量。
 *      - 不要用 z.coerce.number()：它会把 null、空字符串变成 0，掩盖 AI 的错误。
 *      - schema 必须幂等（parse 两次与 parse 一次结果相同），因为历史消息会被反复重算。
 *   3. 钩子 Era.onAfterApply：每条 AI 消息的指令执行、schema 纠正之后调用。这里把 hour 满 24 进位到 day。
 *      钩子必须是同步的、只依赖 ctx 的纯函数（需要随机数时用 ctx.random()），也不能在钩子里发送写入事件。
 *      注意：hour 的 schema 不能把值夹在 0~23，否则 hour 在进入钩子之前就被夹住，进位不会发生。
 *   4. 注销：脚本卸载（pagehide，例如切换角色卡、关闭脚本）时注销 schema 和钩子。
 *      schema 和钩子只保存在内存中，脚本每次加载都会重新注册。
 *
 * 想让 AI 看到变量结构，在世界书条目“ERA 变量意图说明”里写：<变量结构>{{ERA-schema}}</变量结构>
 * 注册后可在浏览器控制台执行 Era.describeSchema() 查看这段说明。
 */

// 1. 常用写法
/** 数字；只接受数字和纯数字文本（"5"、"-3"、"2.5"） */
const Num = z.union([z.number(), z.string().trim().regex(/^[+-]?\d+(\.\d+)?$/).transform(Number)]);
/** 0~100 的数字；用 transform 夹的范围 AI 看不到，所以要写进 describe */
const Percent = Num.transform(v => _.clamp(v, 0, 100)).describe('0~100');
/** 不小于 0 的数字 */
const NonNegative = Num.transform(v => Math.max(0, v));

// 2. 变量结构
const Schema = z.object({
  player_status: z.looseObject({
    name: z.string().describe('玩家姓名'),
    level: Num.transform(v => Math.max(1, Math.round(v))).describe('整数，从 1 开始'),
    hp: NonNegative.describe('当前生命值，不超过 max_hp'),
    max_hp: NonNegative,
    mp: NonNegative.describe('当前魔力值，不超过 max_mp'),
    max_mp: NonNegative,
  }),
  game_info: z.looseObject({
    day: Num.describe('第几天，从 1 开始'),
    hour: NonNegative.describe('当前小时 0~23；直接加时间即可，满 24 会自动进位到 day'),
    weather: z.enum(['晴朗', '多云', '下雨', '下雪', '大雾']).describe('随剧情变化'),
    // 可选字段：开场白里没有也合法
    morale: Percent.optional().describe('队伍士气，0~100'),
  }),
});

// 3. 钩子：hour 满 24 进位到 day。只读写 ctx，不读取闭包里的状态。
function carryHourToDay(ctx) {
  const info = ctx.stat.game_info;
  if (!info || typeof info.hour !== 'number' || typeof info.day !== 'number') return;
  if (info.hour >= 24) {
    info.day += Math.floor(info.hour / 24);
    info.hour = info.hour % 24;
  }
}

$(async () => {
  await waitGlobalInitialized('Era');

  const unregisterSchema = Era.registerSchema(Schema);
  // id 建议用“角色卡.功能”；同一 id 重复注册会替换之前的钩子
  const unregisterHook = Era.onAfterApply('示例卡.时间进位', carryHourToDay);
  console.info('[示例卡] 已注册变量结构和时间进位钩子');

  // 4. 注销
  $(window).on('pagehide', () => {
    unregisterSchema();
    unregisterHook();
  });
});
