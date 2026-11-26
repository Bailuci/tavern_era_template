/*
 * 修改声明（AFPL 第 2(c)(i) 条）：本文件由 Bailuci 新增。
 * 日期：2026-11-25 至 2026-11-26
 * 目的：供角色卡前端读写 ERA 变量（era.ts，基于 pinia）与提供 Era 接口的类型声明（exported.era.d.ts）
 * 原项目：RockingSisyphus/ERA-EfficientRollbackArchitecture，修改记录见仓库根目录的 修改记录.md
 */
import type { StoreDefinition } from 'pinia';
import type { DeepReadonly } from 'vue';

/** 当前角色卡的标识, 与 ERA 判断 schema 归属的方式一致 */
const getOwner = (): unknown => _.get(SillyTavern.characters, [SillyTavern.characterId, 'avatar']);

/** ERA 自身的保留字段, 不属于作者定义的变量结构 (与 ERA 校验 schema 时剔除的字段一致) */
const RESERVED_KEYS = ['$meta', '$template'];

/** 递归移除 ERA 的保留字段, 返回新对象. 其他以 `$` 开头的键会保留, 因为 schema 可能会定义它们 (如 `$time`) */
export function stripEraReserved(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stripEraReserved);
  }
  if (_.isPlainObject(value)) {
    const result: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      if (!RESERVED_KEYS.includes(key)) {
        result[key] = stripEraReserved(value[key]);
      }
    }
    return result;
  }
  return value;
}

/** `era:updateByObject` 的补丁: 只需给出要修改的字段, 数字可以写成 `'+=5'` 这样的增量 */
export type EraPatch<T> = T extends readonly any[]
  ? T
  : T extends number
    ? T | `${'+' | '-' | '*' | '/'}=${number}`
    : T extends object
      ? { [K in keyof T]?: EraPatch<T[K]> }
      : T;

export type EraDataStore<D> = {
  /**
   * 通过 schema 校验的最新变量, 只读. 尚未取得合法变量时为 `null`;
   * 校验失败时保持上一次的合法值, 此时 `error` 不为 `null`
   */
  data: Ref<DeepReadonly<D> | null>;
  /** 最近一次取得的、未经 schema 处理的变量 (已剔除 ERA 保留字段), 只读. 尚未取得任何变量时为 `null` */
  raw: Ref<DeepReadonly<Record<string, any>> | null>;
  /** 最近一次 schema 校验失败的说明, 校验通过后为 `null` */
  error: Ref<string | null>;
  /** 修改已存在的变量, 等价于 `eventEmit('era:updateByObject', patch)` */
  update: (patch: EraPatch<D>) => void;
  /** 插入不存在的变量, 等价于 `eventEmit('era:insertByObject', patch)` */
  insert: (patch: Record<string, any>) => void;
  /** 删除变量, 等价于 `eventEmit('era:deleteByObject', patch)`; 用空对象标出要删除的位置 */
  remove: (patch: Record<string, any>) => void;
};

/**
 * 定义一个读取 ERA 最新变量的 pinia store, 用法与 `defineMvuDataStore` 相似.
 *
 * - 数据是**只读**的: 对 ERA 的写入会把指令块追加到最后一条 AI 消息再重算, 既异步又可能被拒绝,
 *   因此不提供双向绑定, 请用 `update` / `insert` / `remove` 写入, 再从 `data` 观察结果.
 * - ERA 的变量是聊天级的, 无论界面在哪一楼, 这里都是聊天的最新变量.
 *
 * @param schema 变量结构
 * @param id 同一个界面或脚本里定义多个 store 时用于区分
 */
export function defineEraDataStore<T extends z.ZodType<Record<string, any>>>(
  schema: T,
  id = 'latest',
): StoreDefinition<`era_data.${string}`, EraDataStore<z.infer<T>>> {
  return defineStore(
    `era_data.${id}`,
    errorCatched(() => {
      // 必须直接返回 ref, 不能返回 computed: 打包后 pinia 使用它自己的一份 vue (jsdelivr 的 +esm),
      // 而这里使用酒馆助手提供的全局 Vue; storeToRefs 会用 pinia 那份 vue 重新包装 computed, 导致界面不再更新.
      const data = shallowRef<z.infer<T> | null>(null);
      const raw = shallowRef<Record<string, any> | null>(null);
      const error = ref<string | null>(null);

      function accept(stat: unknown) {
        if (!_.isPlainObject(stat)) {
          return;
        }
        // 同时也是深拷贝: 事件载荷会被所有监听者共享
        const current: Record<string, any> = stripEraReserved(stat);
        if (raw.value !== null && _.isEqual(raw.value, current)) {
          return;
        }
        raw.value = current;

        // 变量为空说明还没初始化 (或被回滚到了初始化之前), 不算错误, 但也不能继续显示旧数据
        if (_.isEmpty(current)) {
          data.value = null;
          error.value = null;
          return;
        }

        const result = schema.safeParse(current);
        if (result.success) {
          data.value = result.data;
          error.value = null;
        } else {
          error.value = z.prettifyError(result.error);
          console.warn(`[defineEraDataStore] 变量不符合 schema, 保留上一次的合法数据\n${error.value}`);
        }
      }

      function refresh() {
        try {
          accept(Era.getCurrentVars().stat);
        } catch {
          // 旧版 ERA 没有全局接口 Era, 或共享它的脚本已经被卸载
          eventEmit('era:requestWriteDone');
        }
      }

      eventOn('era:writeDone', payload => accept(payload?.stat));

      // 楼层界面会随聊天切换被销毁; 这里是为了常驻的脚本界面, 避免继续显示上一个聊天的变量
      let chat_id = SillyTavern.getCurrentChatId();
      eventOn(tavern_events.CHAT_CHANGED, () => {
        const new_chat_id = SillyTavern.getCurrentChatId();
        if (chat_id !== new_chat_id) {
          chat_id = new_chat_id;
          data.value = null;
          raw.value = null;
          error.value = null;
          refresh();
        }
      });

      // 新版 ERA: 接口可用后直接读取. 旧版 ERA 的这个等待不会结束, 由定时器改用事件获取
      waitGlobalInitialized('Era').then(refresh, () => {});
      setTimeout(() => {
        if (raw.value === null) {
          eventEmit('era:requestWriteDone');
        }
      }, 300);

      return {
        data,
        raw,
        error,
        update: (patch: EraPatch<z.infer<T>>) => {
          eventEmit('era:updateByObject', patch as Record<string, any>);
        },
        insert: (patch: Record<string, any>) => {
          eventEmit('era:insertByObject', patch);
        },
        remove: (patch: Record<string, any>) => {
          eventEmit('era:deleteByObject', patch);
        },
      };
    }),
  ) as any;
}

/**
 * 在角色卡脚本中把变量结构注册到 ERA. 旧版 ERA 没有该功能, 此时只给出提示, 角色卡照常运行.
 *
 * - ERA 加载得比本脚本晚时会一直等待, 直到能够注册.
 * - ERA 脚本重载会丢失 schema, 本函数会在之后的 `era:writeDone` 时重新注册.
 * - 脚本卸载时自动注销.
 *
 * @returns 注销函数
 */
export function registerEraSchema(
  input: z.ZodType<Record<string, any>> | (() => z.ZodType<Record<string, any>>),
  options?: Era.RegisterSchemaOptions,
): () => void {
  const schema = typeof input === 'function' ? input() : input;
  const owner = getOwner();
  let disposed = false;
  let unregister: (() => void) | null = null;

  /** @param force 是否覆盖已经生效的 schema; 首次注册时覆盖, 避免热重载后旧实例的 schema 残留 */
  const register = async (force: boolean) => {
    await waitGlobalInitialized('Era');
    // 等待期间脚本可能已经卸载、角色卡可能已经切换, 此时绝不能把本卡的 schema 注册到别的卡上
    if (disposed || getOwner() !== owner || (!force && Era.hasSchema())) {
      return;
    }
    unregister = Era.registerSchema(schema, options);
    console.info('[registerEraSchema] 变量结构注册成功');
  };
  const tryRegister = (force = false) => {
    register(force).catch(e => console.error('[registerEraSchema] 变量结构注册失败', e));
  };

  const timer = setTimeout(() => {
    if (unregister === null) {
      console.warn('[registerEraSchema] 还没有等到全局接口 Era, 可能是 ERA 未启用或版本过旧');
    }
  }, 10000);
  const listener = eventOn('era:writeDone', () => tryRegister());
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearTimeout(timer);
    listener.stop();
    unregister?.();
  };
  $(window).on('pagehide', dispose);

  tryRegister(true);
  return dispose;
}
