/*
 * 修改声明（AFPL 第 2(c)(i) 条）：本文件由 Bailuci 新增。
 * 日期：2026-11-25 至 2026-11-26
 * 目的：供角色卡前端读写 ERA 变量（era.ts，基于 pinia）与提供 Era 接口的类型声明（exported.era.d.ts）；
 *       新增按楼层读取的 store、commit / patch 写入、registerEraHook、isLatestFloor，群聊中的归属判断与 ERA 一致
 * 原项目：RockingSisyphus/ERA-EfficientRollbackArchitecture，修改记录见仓库根目录的 修改记录.md
 */
import type { StoreDefinition } from 'pinia';
import type { DeepReadonly } from 'vue';

/**
 * 当前角色卡的标识, 与 ERA 判断 schema 和钩子归属的方式一致 (`api/schema_registry.ts` 的 `getCurrentOwner`):
 * 群聊中 characterId 会随正在发言的成员变化, 因此以群组为准
 */
const getOwner = (): string => {
  try {
    if (SillyTavern.groupId) {
      return `group:${SillyTavern.groupId}`;
    }
    const id = SillyTavern.characterId;
    return String(_.get(SillyTavern.characters, [id as any, 'avatar']) ?? id);
  } catch {
    return 'unknown';
  }
};

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
   * 通过 schema 校验的变量, 只读. 尚未取得合法变量时为 `null`;
   * 校验失败时保持上一次的合法值, 此时 `error` 不为 `null`
   */
  data: Ref<DeepReadonly<D> | null>;
  /** 最近一次取得的、未经 schema 处理的变量 (已剔除 ERA 保留字段), 只读. 尚未取得任何变量时为 `null` */
  raw: Ref<DeepReadonly<Record<string, any>> | null>;
  /** 最近一次 schema 校验失败, 或按楼层读取失败的说明; 成功后为 `null` */
  error: Ref<string | null>;
  /**
   * 按顺序提交一组写入, 等价于 `Era.commit`: 不修改消息正文, 在写入被计算之后完成, 失败时说明原因.
   * **推荐的写入方式.** 默认写到最后一条 AI 消息, 用 `options.mk` / `options.message_id` 指定楼层
   */
  commit: (
    operations: Era.CommitOperation | Era.CommitOperation[],
    options?: Era.CommitOptions,
  ) => Promise<Era.WriteResult>;
  /** 执行 `<VariablePatch>` 的操作 (数组增删、整体替换、改名), 等价于 `commit({ patch: operations }, options)` */
  patch: (
    operations: Era.PatchOperation | Era.PatchOperation[],
    options?: Era.CommitOptions,
  ) => Promise<Era.WriteResult>;
  /**
   * 修改已存在的变量, 等价于 `eventEmit('era:updateByObject', patch)`. 拿不到结果, 默认设置下会追加到 AI 消息正文;
   * 为兼容旧版 ERA 而保留, 新代码请用 `commit([{ edit: patch }])`
   */
  update: (patch: EraPatch<D>) => void;
  /** 插入不存在的变量, 等价于 `eventEmit('era:insertByObject', patch)`; 新代码请用 `commit([{ insert: patch }])` */
  insert: (patch: Record<string, any>) => void;
  /**
   * 删除变量, 等价于 `eventEmit('era:deleteByObject', patch)`; 用空对象标出要删除的位置.
   * 新代码请用 `commit([{ delete: patch }])`
   */
  remove: (patch: Record<string, any>) => void;
};

export type EraDataStoreOptions = {
  /**
   * 读取哪一楼处理完之后的变量 (消息 ID, 可以用负数从末尾倒数). 省略时读取聊天的最新变量.
   * 楼层界面可以传 `getCurrentMessageId()`, 让旧楼显示那一楼当时的值. 需要 ERA-Heron 1.6.0 以上 (`Era.getVarsAt`),
   * 旧版 ERA 会退回显示最新变量
   */
  message_id?: number;
};

/** 某一楼是否是聊天的最后一楼; 楼层界面可以据此只在最新一楼显示完整的状态栏 */
export function isLatestFloor(message_id: number = getCurrentMessageId()): boolean {
  return message_id === getLastMessageId();
}

/**
 * 定义一个读取 ERA 变量的 pinia store, 用法与 `defineMvuDataStore` 相似.
 *
 * - 数据是**只读**的: 对 ERA 的写入既异步又可能被拒绝, 因此不提供双向绑定,
 *   请用 `commit` / `patch` 写入 (可以 `await` 得到结果), 再从 `data` 观察结果.
 * - ERA 的变量是聊天级的. 默认读取聊天的最新变量, 无论界面在哪一楼;
 *   传入 `options.message_id` 时读取那一楼处理完之后的变量, 见 `defineEraFloorStore`.
 *
 * @param schema 变量结构
 * @param id 同一个界面或脚本里定义多个 store 时用于区分
 */
export function defineEraDataStore<T extends z.ZodType<Record<string, any>>>(
  schema: T,
  id = 'latest',
  options: EraDataStoreOptions = {},
): StoreDefinition<`era_data.${string}`, EraDataStore<z.infer<T>>> {
  const floor = options.message_id;
  if (floor !== undefined && !Number.isInteger(floor)) {
    throw new Error(`[defineEraDataStore] message_id 必须是整数: ${floor}`);
  }
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
          // 按楼层读取时, 之前的读取失败可能留下了错误; 读到的变量没变, 说明已恢复
          if (floor !== undefined && data.value !== null) {
            error.value = null;
          }
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

      function refreshLatest() {
        try {
          accept(Era.getCurrentVars().stat);
        } catch {
          // 旧版 ERA 没有全局接口 Era, 或共享它的脚本已经被卸载
          eventEmit('era:requestWriteDone');
        }
      }

      /** 按楼层读取: 只采用最后一次请求的结果, 避免慢的旧请求覆盖新结果 */
      let request_seq = 0;
      let warned_old_era = false;
      /** 旧版 ERA 不支持按楼层读取, 退回显示最新变量. 注意不能在这里请求 `era:requestWriteDone`, 否则会循环 */
      const canReadFloor = (): boolean => {
        const era = (globalThis as any).Era;
        if (typeof era?.getVarsAt === 'function') {
          return true;
        }
        // 没有 Era 时可能只是还没等到它 (等到后会重新读取), 也可能是很旧的 ERA, 都先显示最新变量
        if (era !== undefined && !warned_old_era) {
          warned_old_era = true;
          console.warn('[defineEraDataStore] 当前 ERA 不支持按楼层读取 (Era.getVarsAt), 改为显示最新变量');
        }
        return false;
      };
      async function refreshFloor() {
        const seq = ++request_seq;
        if (!canReadFloor()) {
          try {
            accept(Era.getCurrentVars().stat);
          } catch {
            // 没有全局接口 Era 时, 由下面的定时器或 era:writeDone 取得变量
          }
          return;
        }
        try {
          const snapshot = await Era.getVarsAt(floor!);
          if (seq === request_seq) {
            accept(snapshot.stat);
          }
        } catch (e) {
          // 例如这一楼还没有算完, 或日志已折叠又没有存档; 保留上一次的数据
          if (seq === request_seq) {
            error.value = e instanceof Error ? e.message : String(e);
          }
        }
      }

      const refresh = () => {
        if (floor === undefined) {
          refreshLatest();
        } else {
          refreshFloor();
        }
      };

      eventOn('era:writeDone', payload => {
        if (floor === undefined) {
          accept(payload?.stat);
          return;
        }
        // 本楼正是最后计算的一楼时, 载荷里的变量就是它的值, 不必再查询
        const length = payload?.selectedMks?.length ?? 0;
        if (!canReadFloor() || (length > 0 && (floor < 0 ? length + floor : floor) === length - 1)) {
          request_seq++;
          accept(payload?.stat);
        } else {
          refreshFloor();
        }
      });

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

      const commit = async (
        operations: Era.CommitOperation | Era.CommitOperation[],
        commit_options?: Era.CommitOptions,
      ): Promise<Era.WriteResult> => {
        await waitGlobalInitialized('Era');
        const result = await Era.commit(operations, commit_options);
        if (floor === undefined) {
          accept(result.stat);
        }
        return result;
      };

      return {
        data,
        raw,
        error,
        commit,
        patch: (operations: Era.PatchOperation | Era.PatchOperation[], commit_options?: Era.CommitOptions) =>
          commit({ patch: _.castArray(operations) }, commit_options),
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
 * 定义一个读取某一楼变量的 pinia store, 供楼层里的状态栏显示“那一楼当时”的值 (而不是聊天的最新值).
 * 每次 `era:writeDone` 后重新读取, 因此编辑、删除更早的楼层后也会更新. 写入方法与 `defineEraDataStore` 相同,
 * 默认仍写到最后一条 AI 消息.
 *
 * @param schema 变量结构
 * @param message_id 楼层的消息 ID, 默认是界面所在的楼层 (`getCurrentMessageId()`, 只能在楼层界面中使用)
 */
export function defineEraFloorStore<T extends z.ZodType<Record<string, any>>>(
  schema: T,
  message_id: number = getCurrentMessageId(),
): StoreDefinition<`era_data.${string}`, EraDataStore<z.infer<T>>> {
  return defineEraDataStore(schema, `floor_${message_id}`, { message_id });
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
    if (Era.hasSchema()) {
      console.info('[registerEraSchema] 变量结构注册成功');
    } else {
      console.error('[registerEraSchema] 变量结构注册失败: schema 无效, 详见 ERA 的提示');
    }
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

type EraHookFn<P extends 'before' | 'after'> = P extends 'before'
  ? (ctx: Era.BeforeApplyContext) => void
  : (ctx: Era.AfterApplyContext) => void;

/**
 * 在角色卡脚本中注册更新钩子 (`Era.onBeforeApply` / `Era.onAfterApply`), 处理方式与 `registerEraSchema` 相同:
 *
 * - ERA 加载得比本脚本晚时会一直等待, 直到能够注册.
 * - ERA 脚本重载会丢失钩子, 本函数会在之后的 `era:writeDone` 时重新注册. 这需要 ERA-Heron 1.6.0 以上的 `Era.hasHook`;
 *   更早的版本无法判断钩子是否还在, 不会补注册, ERA 重载后请重新加载角色卡脚本.
 * - 脚本卸载时自动注销.
 *
 * 钩子必须是同步的、只依赖 `ctx` 的纯函数, 见 doc/05 第 8 节.
 *
 * @param phase `'before'`: 指令执行前修改指令; `'after'`: 指令执行后修改变量
 * @param id 钩子的标识, 建议使用 “角色卡.功能”
 * @returns 注销函数
 */
export function registerEraHook<P extends 'before' | 'after'>(
  phase: P,
  id: string,
  hook: EraHookFn<P>,
  options?: Era.HookOptions,
): () => void {
  const owner = getOwner();
  let disposed = false;
  let unregister: (() => void) | null = null;

  /** @param force 是否不检查直接注册; 首次注册时直接注册, 同一 id 的旧钩子会被替换 */
  const register = async (force: boolean) => {
    await waitGlobalInitialized('Era');
    if (disposed || getOwner() !== owner) {
      return;
    }
    const register_fn = (phase === 'before' ? Era.onBeforeApply : Era.onAfterApply) as unknown as
      ((id: string, hook: EraHookFn<P>, options?: Era.HookOptions) => () => void) | undefined;
    if (typeof register_fn !== 'function') {
      if (force) {
        console.warn('[registerEraHook] 当前 ERA 不支持更新钩子, 请更新 ERA');
      }
      return;
    }
    // 不能判断钩子是否还在时不补注册: 每次注册都会触发同步, 会无限循环
    const can_check = typeof Era.hasHook === 'function';
    if (!force && (!can_check || Era.hasHook(id, phase))) {
      return;
    }
    unregister = register_fn(id, hook, options);
    if (can_check && !Era.hasHook(id, phase)) {
      console.error(`[registerEraHook] 钩子 ${id} 注册失败, 详见 ERA 的提示`);
    } else {
      console.info(`[registerEraHook] 钩子 ${id} 注册成功`);
    }
  };
  const tryRegister = (force = false) => {
    register(force).catch(e => console.error(`[registerEraHook] 钩子 ${id} 注册失败`, e));
  };

  const timer = setTimeout(() => {
    if (unregister === null) {
      console.warn('[registerEraHook] 还没有等到全局接口 Era, 可能是 ERA 未启用或版本过旧');
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
