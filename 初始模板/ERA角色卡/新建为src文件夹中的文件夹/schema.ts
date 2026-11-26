// ERA 变量结构. 由 `脚本/变量结构` 注册到 ERA 后:
// - ERA 用它纠正、拦截 AI 写出的不合法修改;
// - `.describe()` 写的说明、枚举值会通过 `{{ERA-schema}}` 告诉 AI (见 `世界书/ERA/变量意图说明.txt`);
// - 状态栏 `界面/状态栏/store.ts` 用它校验并读取变量.
// 下面是示例, 请换成你自己的变量. 写法说明见 docs/era/05-接口与设置.md 与 docs/era/示例/变量结构与钩子脚本示例.js

/** 数字; 只接受数字和纯数字文本. 不要用 z.coerce.number(), 它会把 null、空文本、true 变成 0 或 1, 掩盖 AI 的错误 */
const Num = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(/^[+-]?\d+(\.\d+)?$/)
    .transform(Number),
]);
/** 0~100 的数值; transform 夹住的范围 AI 看不到, 要写进 describe */
const Percent = Num.transform(value => _.clamp(value, 0, 100)).describe('0~100');
/** 文本; AI 有时会写成数字 */
const Text = z.union([z.string(), z.number().transform(String)]).prefault('--');

export const Schema = z.object({
  世界: z.looseObject({
    时间段: z.enum(['清晨', '上午', '下午', '傍晚', '夜晚', '深夜']).describe('随剧情推进, 深夜之后是第二天清晨'),
    地点: Text.describe('角色当前所在的具体地点'),
  }),
  角色: z.looseObject({
    好感度: Percent,
    心情: z.enum(['平静', '开心', '害羞', '生气', '难过']),
    背包: z.record(z.string().describe('物品名'), z.looseObject({ 数量: Num.describe('至少为 1') })).prefault({}),
  }),
});
export type Schema = z.output<typeof Schema>;
