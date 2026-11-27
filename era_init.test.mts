/* eslint-disable */
// @ts-nocheck
// ERA 初始值生成器的测试. 运行: node --test era_init.test.mts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyEraMeta, BEGIN, END, generateCard, mergeInit, replaceInitBlock } from './era_init.mts';

const SCHEMA = `
const Num = z.union([z.number(), z.string().regex(/^\\d+$/).transform(Number)]);
const 物品 = z.object({ 数量: Num, 描述: z.string().prefault('') }).meta({ era: { necessary: 'self' } });
export const Schema = z.object({
  世界: z.object({ 时间: z.string() }).meta({ era: { updatable: false }, description: '只由脚本推进' }),
  主角: z
    .object({
      生命: Num.meta({ era: { updatable: false } }),
      背包: z.record(z.string(), 物品).prefault({}),
      称号: z.object({ 名称: z.string() }).meta({ era: { unInsertAble: 'self' } }).optional(),
    })
    .prefault({}),
});
`;

function makeCard(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'era-init-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const opening = body => `开场白正文\n${BEGIN}\n${body}\n${END}\n结尾`;
const readInit = file => JSON.parse(/<VariableInsert>\n([\s\S]*?)\n<\/VariableInsert>/.exec(fs.readFileSync(file, 'utf8'))[1]);

test('mergeInit：对象逐层合并，数组整体替换，不改参数', () => {
  const base = { a: { b: 1, c: [1, 2] }, d: 1 };
  assert.deepEqual(mergeInit(base, { a: { c: [3] }, e: 2 }), { a: { b: 1, c: [3] }, d: 1, e: 2 });
  assert.deepEqual(base, { a: { b: 1, c: [1, 2] }, d: 1 });
});

test('replaceInitBlock：只替换标记之间，没有标记时返回 null', () => {
  assert.equal(replaceInitBlock('没有标记', {}), null);
  const text = replaceInitBlock(opening('旧的'), { a: 1 });
  assert.equal(text, `开场白正文\n${BEGIN}\n<VariableInsert>\n{\n  "a": 1\n}\n</VariableInsert>\n${END}\n结尾`);
  assert.equal(replaceInitBlock(text, { a: 1 }), text, '再次生成结果不变');
});

test('生成：合并覆盖、写 $meta 与 $template.$meta，标在非对象上的提示，校验不合法时跳过', async () => {
  const dir = makeCard({
    'schema.ts': SCHEMA,
    'initvar.yaml': '世界:\n  时间: 清晨\n主角:\n  生命: 100\n  背包:\n    钥匙:\n      数量: 1\n',
    '第一条消息/0.txt': opening(''),
    '第一条消息/1.txt': opening(''),
    '第一条消息/1.initvar.yaml': '世界:\n  时间: 深夜\n主角:\n  称号:\n    名称: 旅人\n',
    '第一条消息/2.txt': opening(''),
    '第一条消息/2.initvar.yaml': '主角:\n  生命: 很多\n',
    '第一条消息/3.txt': '没有标记的开场白',
  });
  const result = await generateCard(dir);
  assert.deepEqual(
    result.files.map(f => [f.file, f.status]),
    [
      ['0.txt', 'updated'],
      ['1.txt', 'updated'],
      ['2.txt', 'invalid'],
      ['3.txt', 'no_marker'],
    ],
  );
  assert.match(result.files[2].message, /主角\.生命/);
  assert.ok(result.warnings.some(w => /主角\.生命.*只能放在对象上/.test(w)));

  const first = readInit(path.join(dir, '第一条消息/0.txt'));
  assert.deepEqual(first, {
    世界: { 时间: '清晨', $meta: { updatable: false } },
    主角: {
      生命: 100,
      背包: {
        钥匙: { 数量: 1, $meta: { necessary: 'self' } },
        $template: { $meta: { necessary: 'self' } },
      },
    },
  });
  const second = readInit(path.join(dir, '第一条消息/1.txt'));
  assert.equal(second.世界.时间, '深夜');
  assert.deepEqual(second.主角.称号, { 名称: '旅人', $meta: { unInsertAble: 'self' } });
  assert.equal(fs.readFileSync(path.join(dir, '第一条消息/3.txt'), 'utf8'), '没有标记的开场白');

  const again = await generateCard(dir, false);
  assert.deepEqual(
    again.files.filter(f => f.status === 'updated'),
    [],
    '再次运行不应有变化',
  );
});

test('applyEraMeta：解析 $ref（重复使用的子结构）', () => {
  const root = {
    type: 'object',
    properties: { a: { $ref: '#/$defs/X' }, b: { $ref: '#/$defs/X' } },
    $defs: { X: { type: 'object', era: { updatable: false }, properties: { v: { type: 'number' } } } },
  };
  assert.deepEqual(applyEraMeta({ a: { v: 1 }, b: { v: 2 } }, root, root), {
    a: { v: 1, $meta: { updatable: false } },
    b: { v: 2, $meta: { updatable: false } },
  });
});
