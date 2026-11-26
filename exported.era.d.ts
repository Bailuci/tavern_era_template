/*
 * 修改声明（AFPL 第 2(c)(i) 条）：本文件由 Bailuci 新增。
 * 日期：2026-11-25 至 2026-11-26
 * 目的：供角色卡前端读写 ERA 变量（era.ts，基于 pinia）与提供 Era 接口的类型声明（exported.era.d.ts）
 * 原项目：RockingSisyphus/ERA-EfficientRollbackArchitecture，修改记录见仓库根目录的 修改记录.md
 */
declare namespace Era {
  /** ERA 对 schema 的最小要求: 一个 `safeParse` 方法; zod 的所有 schema 都满足 */
  type SchemaLike = { safeParse(data: unknown): { success: boolean; data?: any; error?: any } };

  type RegisterSchemaOptions = {
    /** 是否保留 stat_data 顶层那些不在 schema 里的键, 默认 `true` */
    keepUnknownRootKeys?: boolean;
    /** 变量完全为空时是否也补全 schema 的默认值, 默认 `false` */
    fillDefaultsOnEmpty?: boolean;
    /** 注册后是否立即重算最新楼层, 默认 `true` */
    resync?: boolean;
  };

  type ActionsTaken = {
    rollback: boolean;
    apply: boolean;
    resync: boolean;
    api: boolean;
    apiWrite: boolean;
    editedResync: boolean;
    swipedRollback: boolean;
  };

  type Snapshot = {
    mk: string;
    message_id: number;
    is_user: boolean;
    /** 含 `$meta` 等内部字段 */
    stat: any;
    /** 不含任何 `$` 开头的字段, 适合展示 */
    statWithoutMeta: any;
  };

  /**
   * 注意: 由 `era:requestWriteDone` 触发的重播中, `stat`、`statWithoutMeta`、`selectedMks`、`editLogs` 是最新的,
   * 但 `mk`、`message_id`、`is_user`、`actions` 仍是上一次写入时的值 (甚至可能来自上一个聊天).
   */
  type WriteDonePayload = Snapshot & {
    actions: ActionsTaken;
    selectedMks: (string | null)[];
    editLogs: Record<string, any[]>;
    consecutiveProcessingCount: number;
  };

  type QueryResultPayload = {
    queryType:
      | 'getCurrentVars'
      | 'getSnapshotAtMk'
      | 'getSnapshotsBetweenMks'
      | 'getSnapshotAtMId'
      | 'getSnapshotsBetweenMIds';
    /** 原始查询的 detail, 可在其中放自定义字段来匹配请求 */
    request: any;
    /** `Snapshot`、`Snapshot[]` 或 `{ error: string }` */
    result: any;
    selectedMks: (string | null)[];
    editLogs: Record<string, any[]>;
  };

  type HookCommand = { type: 'insert' | 'edit' | 'delete' | 'patch'; data: any[] };

  /** `<VariablePatch>` 中的一项操作, 路径形如 `/角色/背包/-` */
  type PatchOperation = {
    op:
      | 'replace'
      | 'set'
      | 'update'
      | 'insert'
      | 'add'
      | 'remove'
      | 'delete'
      | 'unset'
      | 'delta'
      | 'increment'
      | 'inc'
      | 'toggle'
      | 'append'
      | 'move'
      | 'rename'
      | 'copy';
    path?: string;
    from?: string;
    to?: string;
    value?: any;
  };

  type CommitOperation = { insert: object } | { edit: object } | { delete: object } | { patch: PatchOperation[] };

  type CommitOptions = {
    /** 写到哪一楼, 默认是最后一条 AI 消息 */
    mk?: string;
    message_id?: number;
    /** 有任何一项不能生效时, 全部不写入 */
    atomic?: boolean;
  };

  type WriteResult = { mk: string; stat: any; statWithoutMeta: any };

  type CommandErrorPayload = {
    errors: { mk: string | null; message_id: number; path: string; reason: string; [key: string]: any }[];
  };

  type ExtraStatusPayload = {
    mk: string;
    message_id: number;
    status: 'started' | 'retry' | 'done' | 'no_entries' | 'no_change' | 'aborted' | 'failed';
    problems?: string[];
  };

  type HookOptions = {
    /** 数值小的先执行, 相同时按 id 排序, 默认 0 */
    order?: number;
    /** 注册后是否立即同步一次, 默认 `true` */
    resync?: boolean;
  };

  type AfterApplyContext = {
    /** 本条消息的 MK, 重算时不变 */
    mk: string;
    /** 本条消息应用前的变量 (副本) */
    old_stat: any;
    /** 可原地修改或整体赋值 */
    stat: any;
    /** 本条消息执行的指令 (副本) */
    commands: HookCommand[];
    /** 确定性随机数, 重算时序列相同 */
    random: () => number;
  };

  type BeforeApplyContext = Omit<AfterApplyContext, 'stat'>;

  type SchemaErrorPayload = {
    errors: {
      mk: string | null;
      message_id: number;
      op: 'insert' | 'update' | 'delete';
      path: string;
      value?: any;
      message: string;
    }[];
  };
}

/**
 * ERA 变量框架共享到全局的接口, **使用前必须先 `await waitGlobalInitialized('Era')`**.
 * 旧版 ERA 没有该接口, 等待将永远不会结束.
 */
declare const Era: {
  /** 注册变量结构 schema, 重复注册会覆盖; 返回注销函数 */
  registerSchema: (schema: Era.SchemaLike, options?: Era.RegisterSchemaOptions) => () => void;
  /** 注销 schema; 提供 `schema` 时只有当前生效的正是它才注销 */
  unregisterSchema: (schema?: Era.SchemaLike) => boolean;
  /** 当前是否注册了 schema */
  hasSchema: () => boolean;
  /** 指令解析后、执行前修改指令; 钩子必须是同步的、只依赖 `ctx` 的纯函数; 返回注销函数 */
  onBeforeApply: (id: string, hook: (ctx: Era.BeforeApplyContext) => void, options?: Era.HookOptions) => () => void;
  /** 指令执行后修改变量; 钩子必须是同步的、只依赖 `ctx` 的纯函数; 返回注销函数 */
  onAfterApply: (id: string, hook: (ctx: Era.AfterApplyContext) => void, options?: Era.HookOptions) => () => void;
  /**
   * 按顺序提交一组写入, 在写入被计算之后完成; 不修改消息正文
   * @example
   * await Era.commit([{ edit: { 金币: '-=3' } }, { patch: [{ op: 'insert', path: '/背包/-', value: '面包' }] }], { atomic: true });
   */
  commit: (
    operations: Era.CommitOperation | Era.CommitOperation[],
    options?: Era.CommitOptions,
  ) => Promise<Era.WriteResult>;
  /** 试算一段含指令的文本, 不写入任何数据; `mk` 指定在哪一楼之后的状态上试算 */
  simulate: (text: string, mk?: string) => Promise<{ stat: any; problems: { path: string; reason: string }[] }>;
  /** 当前注册的变量结构的文字说明, 没有注册时为空字符串; 宏为 `{{ERA-schema}}` */
  describeSchema: () => string;
  /** 额外模型解析 */
  extra: {
    /** 重新解析指定 MK 的消息, 不指定时解析最后一条 AI 消息 */
    run: (mk?: string) => Promise<void>;
    /** 取消正在进行的解析 */
    abort: (mk?: string) => void;
    /** 等待正在进行的解析完成; 脚本自行触发生成 (如 `/trigger`) 之前可以先等待它 */
    wait: () => Promise<void>;
  };
  /** 同步获取当前最新变量 */
  getCurrentVars: () => { stat: any; statWithoutMeta: any };
};

interface ListenerType {
  // ERA 发出的事件
  'era:writeDone': (payload: Era.WriteDonePayload) => void;
  'era:queryResult': (payload: Era.QueryResultPayload) => void;
  'era:schemaError': (payload: Era.SchemaErrorPayload) => void;
  'era:commandError': (payload: Era.CommandErrorPayload) => void;
  'era:extraStatus': (payload: Era.ExtraStatusPayload) => void;

  // 发送给 ERA 的事件
  'era:insertByObject': (detail: Record<string, any>) => void;
  'era:updateByObject': (detail: Record<string, any>) => void;
  'era:deleteByObject': (detail: Record<string, any>) => void;
  'era:insertByPath': (detail: { path: string; value: any }) => void;
  'era:updateByPath': (detail: { path: string; value: any }) => void;
  'era:deleteByPath': (detail: { path: string }) => void;
  'era:patch': (detail: Era.PatchOperation | Era.PatchOperation[]) => void;
  'era:commit': (
    detail: Era.CommitOptions & { operations: Era.CommitOperation | Era.CommitOperation[] },
  ) => void;
  'era:getCurrentVars': (detail?: any) => void;
  'era:getSnapshotAtMk': (detail: { mk: string; [key: string]: any }) => void;
  'era:getSnapshotsBetweenMks': (detail?: { startMk?: string; endMk?: string; [key: string]: any }) => void;
  'era:getSnapshotAtMId': (detail: { message_id: number; [key: string]: any }) => void;
  'era:getSnapshotsBetweenMIds': (detail?: { startId?: number; endId?: number; [key: string]: any }) => void;
  'era:requestWriteDone': () => void;
  'era:forceSync': (detail?: { mode?: 'full' | 'latest' | 'auto' | 'rollbackTo'; message_id?: number }) => void;
}
