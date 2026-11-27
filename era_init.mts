/* eslint-disable */
// @ts-nocheck
/**
 * ERA 初始值生成器 (ERA-Heron 路线图 1.7-5)
 *
 * 读取角色卡的 `schema.ts` 与 `initvar.yaml`, 把初始变量写进每个开场白 (`第一条消息/*.txt`) 中
 * `<!-- ERA-INIT:BEGIN -->` 与 `<!-- ERA-INIT:END -->` 之间的 `<VariableInsert>`.
 *
 * - `initvar.yaml` 是所有开场白共用的初始值; `第一条消息/<名字>.initvar.yaml` 是该开场白自己的覆盖 (对象逐层合并, 数组整体替换).
 * - 写出前用 schema 校验合成的初始值, 不合法时报告并跳过该开场白.
 * - schema 里用 `.meta({ era: { updatable: false } })` 标的保护会写成初始值里的 `$meta`;
 *   标在 record (z.record) 的值上时写成 `$template.$meta`, 之后插入的新条目自动带上. `$meta` 只能放在对象上.
 * - 只改标记之间的内容, 其余正文不动; 没有标记的开场白跳过.
 *
 * 用法:
 *   pnpm era-init            生成全部 src/ 下有 schema.ts 与 initvar.yaml 的角色卡
 *   pnpm era-init 角色卡名称  只处理 src/角色卡名称
 *   pnpm era-init --check    只检查是否需要更新, 需要时以退出码 1 结束 (用于提交前检查)
 */
import _ from 'lodash';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import z from 'zod';

export const BEGIN = '<!-- ERA-INIT:BEGIN -->';
export const END = '<!-- ERA-INIT:END -->';
const META_KEYS = ['updatable', 'necessary', 'unInsertAble'];

/** 对象逐层合并, 数组与其他值整体替换. 不修改参数. */
export function mergeInit(base: any, override: any): any {
  if (!_.isPlainObject(base) || !_.isPlainObject(override)) return _.cloneDeep(override === undefined ? base : override);
  const result = _.cloneDeep(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? mergeInit(result[key], value) : _.cloneDeep(value);
  }
  return result;
}

/** 顺着 `$ref` 找到真正的节点. */
function resolve(node: any, root: any, depth = 0): any {
  if (!_.isPlainObject(node) || depth > 32) return node;
  if (typeof node.$ref !== 'string') return node;
  const target = node.$ref === '#' ? root : _.get(root, node.$ref.replace(/^#\//, '').split('/'));
  return resolve(target, root, depth + 1);
}

/** 节点本身及其包装 (`allOf`、只有一个分支的 `anyOf`, 例如可选、带默认值) 上的 era 标注. */
function eraOf(node: any, root: any, depth = 0): Record<string, any> | null {
  node = resolve(node, root);
  if (!_.isPlainObject(node) || depth > 16) return null;
  let found = _.isPlainObject(node.era) ? _.pick(node.era, META_KEYS) : null;
  for (const branch of [...(node.allOf ?? []), ...(node.anyOf?.length === 1 ? node.anyOf : [])]) {
    const inner = eraOf(branch, root, depth + 1);
    if (inner) found = { ...inner, ...found };
  }
  return found && !_.isEmpty(found) ? found : null;
}

/** 与值匹配的对象节点: 展开 `$ref`、`allOf`, 在 `anyOf` / `oneOf` 中选出对象分支. */
function objectNode(node: any, root: any, depth = 0): any | null {
  node = resolve(node, root);
  if (!_.isPlainObject(node) || depth > 16) return null;
  if (node.type === 'object' || node.properties || node.additionalProperties) return node;
  for (const branch of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
    const found = objectNode(branch, root, depth + 1);
    if (found) return found;
  }
  return null;
}

/** 由 record 的值的 schema 生成模板: 只含 era 标注 (`$meta`) 与子对象的模板. 没有任何标注时返回 null. */
function buildTemplate(node: any, root: any, depth = 0): any | null {
  if (depth > 12) return null;
  const meta = eraOf(node, root);
  const object = objectNode(node, root);
  const template: any = meta ? { $meta: meta } : {};
  for (const [key, child] of Object.entries<any>(object?.properties ?? {})) {
    const sub = buildTemplate(child, root, depth + 1);
    if (sub) template[key] = sub;
  }
  return _.isEmpty(template) ? null : template;
}

/**
 * 按 JSON Schema 中的 era 标注给初始值加上 `$meta` / `$template`. 返回新的值, 并在 `warnings` 中记下无法放置的标注.
 * @param where 当前路径, 用于提示.
 */
export function applyEraMeta(value: any, node: any, root: any, warnings: string[] = [], where = '(根)'): any {
  const meta = eraOf(node, root);
  if (!_.isPlainObject(value)) {
    if (meta) warnings.push(`${where}: $meta 只能放在对象上, 这里的值不是对象, 已忽略 (可以标在它的上级对象上)`);
    if (Array.isArray(value)) {
      const items = resolve(objectNode(node, root) ?? resolve(node, root), root)?.items;
      return value.map((item, i) => applyEraMeta(item, items, root, warnings, `${where}[${i}]`));
    }
    return value;
  }
  const result: any = { ...value };
  if (meta) result.$meta = { ...meta, ...(_.isPlainObject(value.$meta) ? value.$meta : {}) };
  const object = objectNode(node, root);
  if (!object) return result;
  for (const [key, child] of Object.entries<any>(object.properties ?? {})) {
    if (key in result) result[key] = applyEraMeta(result[key], child, root, warnings, `${where}.${key}`);
  }
  const record = _.isPlainObject(object.additionalProperties) ? object.additionalProperties : null;
  if (record) {
    for (const key of Object.keys(result)) {
      if (key.startsWith('$') || object.properties?.[key]) continue;
      result[key] = applyEraMeta(result[key], record, root, warnings, `${where}.${key}`);
    }
    const template = buildTemplate(record, root);
    if (template && !result.$template) result.$template = template;
  }
  return result;
}

/** 把 `<VariableInsert>` 写进标记之间. 没有标记时返回 null. */
export function replaceInitBlock(text: string, value: any): string | null {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END, start + BEGIN.length);
  if (start === -1 || end === -1) return null;
  const block = `<VariableInsert>\n${JSON.stringify(value, null, 2)}\n</VariableInsert>`;
  return `${text.slice(0, start + BEGIN.length)}\n${block}\n${text.slice(end)}`;
}

/** 加载 schema.ts 的 `Schema` (可以是函数). */
export async function loadSchema(file: string): Promise<any> {
  globalThis._ = _;
  globalThis.z = z;
  const module = await import(pathToFileURL(path.resolve(file)).href);
  let schema = module.Schema;
  if (typeof schema === 'function' && typeof schema.safeParse !== 'function') schema = schema();
  if (!schema || typeof schema.safeParse !== 'function') throw new Error('schema.ts 没有导出 Schema');
  return schema;
}

const readYaml = (file: string): any => YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};

/** 第一个问题的说明. */
const describeIssue = (error: any): string => {
  const issue = error?.issues?.[0];
  return issue ? `${issue.path?.length ? issue.path.join('.') : '(根)'}: ${issue.message}` : String(error);
};

export interface CardResult {
  card: string;
  /** 每个开场白的处理结果. */
  files: { file: string; status: 'updated' | 'unchanged' | 'no_marker' | 'invalid'; message?: string }[];
  warnings: string[];
}

/**
 * 处理一张角色卡 (src/ 下的一个文件夹).
 * @param write 是否写回文件; `false` 时只报告.
 */
export async function generateCard(dir: string, write = true): Promise<CardResult> {
  const result: CardResult = { card: dir, files: [], warnings: [] };
  const schema = await loadSchema(path.join(dir, 'schema.ts'));
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  const base = readYaml(path.join(dir, 'initvar.yaml'));
  const openings = path.join(dir, '第一条消息');
  const files = fs.existsSync(openings) ? fs.readdirSync(openings).filter(name => name.endsWith('.txt')).sort() : [];
  for (const name of files) {
    const file = path.join(openings, name);
    const overrideFile = path.join(openings, name.replace(/\.txt$/, '.initvar.yaml'));
    const value = fs.existsSync(overrideFile) ? mergeInit(base, readYaml(overrideFile)) : base;
    // 校验去掉 $meta / $template 之后的值: ERA 校验时同样不看这些保留字段
    const checked = schema.safeParse(value);
    if (!checked.success) {
      result.files.push({ file: name, status: 'invalid', message: describeIssue(checked.error) });
      continue;
    }
    const withMeta = applyEraMeta(value, json, json, result.warnings);
    const text = fs.readFileSync(file, 'utf8');
    const next = replaceInitBlock(text, withMeta);
    if (next === null) {
      result.files.push({ file: name, status: 'no_marker' });
      continue;
    }
    if (next === text) {
      result.files.push({ file: name, status: 'unchanged' });
      continue;
    }
    if (write) fs.writeFileSync(file, next);
    result.files.push({ file: name, status: 'updated' });
  }
  result.warnings = _.uniq(result.warnings);
  return result;
}

const LABELS = { updated: '已更新', unchanged: '无需更新', no_marker: '没有 ERA-INIT 标记, 跳过', invalid: '初始值不符合 schema, 跳过' };

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const names = args.filter(arg => !arg.startsWith('--'));
  const dirs = fs
    .globSync('src/**/schema.ts')
    .map(file => path.dirname(file))
    .filter(dir => fs.existsSync(path.join(dir, 'initvar.yaml')))
    .filter(dir => names.length === 0 || names.includes(path.basename(dir)));
  if (dirs.length === 0) {
    console.log('没有找到同时有 schema.ts 和 initvar.yaml 的角色卡文件夹.');
    return;
  }
  let failed = false;
  for (const dir of dirs) {
    try {
      const result = await generateCard(dir, !check);
      console.log(`\n${dir}`);
      for (const item of result.files) {
        console.log(`  ${item.file}: ${LABELS[item.status]}${item.message ? ` (${item.message})` : ''}`);
        if (item.status === 'invalid' || (check && item.status === 'updated')) failed = true;
      }
      for (const warning of result.warnings) console.log(`  注意: ${warning}`);
    } catch (error) {
      failed = true;
      console.error(`\n${dir}: 生成失败: ${error?.message ?? error}`);
    }
  }
  if (check && failed) console.log('\n有开场白需要更新或初始值不合法, 请运行 pnpm era-init.');
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
