/*
 * 修改声明（AFPL 第 2(c)(i) 条）：本文件由 Bailuci 新增。
 * 日期：2026-11-25 至 2026-11-26
 * 目的：供角色卡前端读写 ERA 变量（era.ts，基于 pinia）与提供 Era 接口的类型声明（exported.era.d.ts）；
 *       新增按楼层读取的 store、commit / patch 写入、registerEraHook、isLatestFloor，群聊中的归属判断与 ERA 一致；新增 getEraMath
 *       2026-11-26 新增 requireEra、compareEraVersions
 *       新增 registerEraEntryFilter
 *       2026-11-27 更正 getEraMath 的注释；新增 registerEraTool、registerEraExprFn
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
   * 楼层界面可以传 `getCurrentMessageId()`, 让旧楼显示那一楼当时的值. 需要 ERA-Heron (`Era.getVarsAt`),
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
 * - ERA 脚本重载会丢失钩子, 本函数会在之后的 `era:writeDone` 时重新注册. 这需要 ERA-Heron 的 `Era.hasHook`;
 *   更早的版本无法判断钩子是否还在, 不会补注册, ERA 重载后请重新加载角色卡脚本.
 * - 脚本卸载时自动注销.
 *
 * 钩子必须是同步的、只依赖 `ctx` 的纯函数, 见 docs/era/05 第 8 节.
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

/**
 * 比较两个版本号 (`'1.7'`、`'1.7.0'`、`'v1.7.0-beta.1'` 都可以; 缺少的段按 0 计, 预发布后缀忽略).
 * @returns 负数表示 a 较旧, 0 表示相同, 正数表示 a 较新; 无法识别时返回 `NaN`
 */
export function compareEraVersions(a: string, b: string): number {
  const parse = (text: string): number[] | null => {
    const match = String(text ?? '')
      .trim()
      .match(/^v?(\d+(?:\.\d+){0,2})(?:[-+].*)?$/i);
    if (!match) {
      return null;
    }
    const parts = match[1].split('.').map(Number);
    while (parts.length < 3) {
      parts.push(0);
    }
    return parts;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) {
    return NaN;
  }
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return 0;
}

/**
 * 检查玩家装的 ERA 是否不低于 `min_version` (例如 `'2.0'`). 角色卡用到新接口之前调用, 不满足时提示玩家更新.
 *
 * - 有 `Era.version`; 更早的版本没有, 一律视为不满足.
 * - 等不到全局接口 `Era` (ERA 未启用或版本太旧) 时, 超时后视为不满足.
 * - 也可以在角色卡变量 `ERA最低版本` 中声明, ERA 会在加载角色卡时自行检查并提示.
 *
 * @param options.toast 不满足时是否弹窗提示, 默认 `true`
 * @param options.timeout 等待 `Era` 的毫秒数, 默认 `10000`
 * @returns 是否满足
 * @example
 * if (await requireEra('2.0')) {
 *   await Era.applyText(reply);
 * }
 */
export async function requireEra(
  min_version: string,
  options: { toast?: boolean; timeout?: number } = {},
): Promise<boolean> {
  const { toast = true, timeout = 10000 } = options;
  const ready = await Promise.race([
    waitGlobalInitialized('Era').then(
      () => true,
      () => false,
    ),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeout)),
  ]);
  const version = ready ? (Era as { version?: unknown }).version : undefined;
  const ok = typeof version === 'string' && compareEraVersions(version, min_version) >= 0;
  if (!ok) {
    const current = typeof version === 'string' ? `ERA-Heron ${version}` : ready ? '较早版本的 ERA' : '未检测到 ERA';
    const message = `这张角色卡需要 ERA ${min_version} 以上, 当前是 ${current}. 请更新 ERA 脚本, 否则部分功能不会生效.`;
    console.warn(`[requireEra] ${message}`);
    if (toast) {
      toastr.warning(message, '[ERA] 版本过低');
    }
  }
  return ok;
}

/**
 * 获取确定性数学函数 `Era.math`, 用法同 `Math`, 三角、指数、对数在各浏览器上逐位一致.
 * 钩子里直接用 `ctx.math`; 前端需要与 ERA 重算结果一致的数值时用它. ERA 版本过旧 (没有 `Era.math`) 时 Promise 失败; 没有装 ERA 时一直等待
 * @example
 * const math = await getEraMath();
 * const dx = math.cos(angle) * speed;
 */
export async function getEraMath(): Promise<Era.DetMath> {
  await waitGlobalInitialized('Era');
  if (!Era.math) {
    throw new Error('当前 ERA 不提供 Era.math, 请更新到 ERA-Heron 2.0.0 以上');
  }
  return Era.math;
}

/**
 * 在角色卡脚本中注册分步更新的条目过滤器 (`Era.registerEntryFilter`), 处理方式与 `registerEraHook` 相同:
 * ERA 加载得比本脚本晚时会等待; ERA 脚本重载会丢失过滤器, 本函数会在之后的 `era:writeDone` 时重新注册; 脚本卸载时自动注销.
 * 旧版 ERA 没有该功能时只给出提示, 角色卡照常运行.
 *
 * 过滤器必须是同步的、只依赖参数的纯函数: 返回 `false` 排除条目, `true` 纳入 (即使文件里关闭了),
 * 字符串表示纳入并替换内容, 其他值表示不表态 (按文件里的开关和关键字).
 *
 * @param name 过滤器的名字, 建议使用 “角色卡.功能”
 * @returns 注销函数
 */
export function registerEraEntryFilter(name: string, filter: Era.EntryFilter): () => void {
  const owner = getOwner();
  let disposed = false;
  let unregister: (() => void) | null = null;

  const register = async (force: boolean) => {
    await waitGlobalInitialized('Era');
    if (disposed || getOwner() !== owner) {
      return;
    }
    if (typeof Era.registerEntryFilter !== 'function' || typeof Era.hasEntryFilter !== 'function') {
      if (force) {
        console.warn('[registerEraEntryFilter] 当前 ERA 不支持条目过滤器, 请更新 ERA-Heron 到 2.0.0 以上');
      }
      return;
    }
    if (!force && Era.hasEntryFilter(name)) {
      return;
    }
    unregister = Era.registerEntryFilter(name, filter);
    if (!Era.hasEntryFilter(name)) {
      console.error(`[registerEraEntryFilter] 过滤器 ${name} 注册失败, 详见 ERA 的提示`);
    } else {
      console.info(`[registerEraEntryFilter] 过滤器 ${name} 注册成功`);
    }
  };
  const tryRegister = (force = false) => {
    register(force).catch(e => console.error(`[registerEraEntryFilter] 过滤器 ${name} 注册失败`, e));
  };

  const listener = eventOn('era:writeDone', () => tryRegister());
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    listener.stop();
    unregister?.();
  };
  $(window).on('pagehide', dispose);

  tryRegister(true);
  return dispose;
}

/** 等待 ERA、ERA 重载后补注册、脚本卸载时注销的通用写法 (registerEraTool / registerEraExprFn 共用) */
function keepRegistered(label: string, feature: string, has: () => boolean, register: () => () => void): () => void {
  const owner = getOwner();
  let disposed = false;
  let unregister: (() => void) | null = null;

  const attempt = async (force: boolean) => {
    await waitGlobalInitialized('Era');
    if (disposed || getOwner() !== owner) {
      return;
    }
    if (!Era.features?.includes(feature)) {
      if (force) {
        console.warn(`[${label}] 当前 ERA 不支持该功能, 请更新 ERA-Heron 到 2.0.0 以上`);
      }
      return;
    }
    if (!force && has()) {
      return;
    }
    unregister = register();
    console[has() ? 'info' : 'error'](`[${label}] ${has() ? '注册成功' : '注册失败, 详见 ERA 的提示'}`);
  };
  const tryRegister = (force = false) => {
    attempt(force).catch(e => console.error(`[${label}] 注册失败`, e));
  };

  const listener = eventOn('era:writeDone', () => tryRegister());
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    listener.stop();
    unregister?.();
  };
  $(window).on('pagehide', dispose);

  tryRegister(true);
  return dispose;
}

/**
 * 在角色卡脚本中注册工具 (`Era.registerTool`), 处理方式与 `registerEraHook` 相同.
 * AI 在正文里写 `<EraFCall name="工具名">{"参数": 1}</EraFCall>` 调用它; `handler` 必须是同步纯函数.
 * @example
 * registerEraTool('攻击', {
 *   description: '对一个敌人发动普通攻击',
 *   parameters: z.object({ 目标: z.string() }),
 *   handler({ 目标 }, ctx) {
 *     const enemy = ctx.stat.敌人?.[目标];
 *     if (!enemy) throw new Error(`没有名为 ${目标} 的敌人`);
 *     const damage = Math.max(1, ctx.stat.主角.攻击 - enemy.防御 + Math.floor(ctx.random() * 6));
 *     return { operations: [{ edit: { 敌人: { [目标]: { 生命: enemy.生命 - damage } } } }], result: { 伤害: damage } };
 *   },
 * });
 */
export function registerEraTool(name: string, definition: Era.ToolDefinition): () => void {
  return keepRegistered(
    `registerEraTool ${name}`,
    'tools',
    () => Era.hasTool(name),
    () => Era.registerTool(name, definition),
  );
}

/**
 * 在角色卡脚本中注册 `$expr` 的自定义公式函数 (`Era.registerExprFn`), 处理方式与 `registerEraHook` 相同.
 * @example
 * registerEraExprFn('伤害', (攻击, 防御) => Math.max(1, 攻击 - 防御), { params: 2, description: '攻击减防御, 至少 1' });
 * // AI 写: <VariableEdit>{"敌人": {"生命": {"$expr": "敌人.生命 - 伤害(主角.攻击 + roll(1, 6), 敌人.防御)"}}}</VariableEdit>
 */
export function registerEraExprFn(
  name: string,
  fn: (...args: number[]) => number,
  options?: Era.ExprFnOptions,
): () => void {
  return keepRegistered(
    `registerEraExprFn ${name}`,
    'exprFns',
    () => Era.hasExprFn(name),
    () => Era.registerExprFn(name, fn, options),
  );
}
