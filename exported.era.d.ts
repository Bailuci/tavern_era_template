/*
 * 修改声明（AFPL 第 2(c)(i) 条）：本文件由 Bailuci 新增。
 * 日期：2026-11-25 至 2026-11-26
 * 目的：供角色卡前端读写 ERA 变量（era.ts，基于 pinia）与提供 Era 接口的类型声明（exported.era.d.ts）；
 *       新增 Era.getVarsAt、Era.hasHook 的声明，错误事件补 type、origin 字段；
 *       2026-11-26 新增 Era.math、钩子的 ctx.math 与 Era.simulate 的 seedMk 选项；Era.version、Era.features、Era.parseCommands、
 *       Era.applyText、Era.keepMessageKey；条目过滤器 Era.registerEntryFilter / hasEntryFilter，分步更新结果增加 warnings、
 *       status() 增加 pendingSync；Era.checkSchema 与 era:schemaInvalid，注明钩子里不能调用写入接口
 *       2026-11-27 Era.keepMessageKey 同时保留 <era_extra>；说明 seedMk 只对应正文中的指令；错误事件补 source 字段；
 *       更正重入保护、{{ERA-issues}} 报告范围、Era.extra.wait 与 getEraMath 的注释；工具调用与自定义公式函数（1.8）
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
      'getCurrentVars' | 'getSnapshotAtMk' | 'getSnapshotsBetweenMks' | 'getSnapshotAtMId' | 'getSnapshotsBetweenMIds';
    /** 原始查询的 detail, 可在其中放自定义字段来匹配请求 */
    request: any;
    /** `Snapshot`、`Snapshot[]` 或 `{ error: string }` */
    result: any;
    selectedMks: (string | null)[];
    editLogs: Record<string, any[]>;
  };

  /**
   * 钩子看到的指令. `edit` 的数据里可能有尚未求值的表达式叶子 `{ $expr: '...' }`,
   * 按数字处理指令的钩子要跳过它
   */
  /** `call` 是工具调用 `<EraFCall>`, `data` 为 `[{ name, args }]` */
  type HookCommand = { type: 'insert' | 'edit' | 'delete' | 'patch' | 'call'; data: any[] };

  /**
   * 确定性数学函数, 用法同 `Math`. 三角、指数、对数移植自 fdlibm, 各浏览器逐位一致;
   * 会在重算时再次执行的代码 (钩子) 不要直接用 `Math.sin/exp/log/pow` 或 `**`
   */
  type DetMath = {
    readonly PI: number;
    readonly E: number;
    readonly exp: (x: number) => number;
    readonly expm1: (x: number) => number;
    readonly log: (x: number) => number;
    readonly log1p: (x: number) => number;
    readonly log2: (x: number) => number;
    readonly log10: (x: number) => number;
    readonly sin: (x: number) => number;
    readonly cos: (x: number) => number;
    readonly tan: (x: number) => number;
    readonly asin: (x: number) => number;
    readonly acos: (x: number) => number;
    readonly atan: (x: number) => number;
    /** 注意 y 在前 */
    readonly atan2: (y: number, x: number) => number;
    readonly sinh: (x: number) => number;
    readonly cosh: (x: number) => number;
    readonly tanh: (x: number) => number;
    readonly asinh: (x: number) => number;
    readonly acosh: (x: number) => number;
    readonly atanh: (x: number) => number;
    readonly hypot: (x: number, y: number) => number;
    readonly pow: (x: number, y: number) => number;
    readonly sqrt: (x: number) => number;
    readonly abs: (x: number) => number;
    readonly sign: (x: number) => number;
    readonly floor: (x: number) => number;
    readonly ceil: (x: number) => number;
    readonly trunc: (x: number) => number;
    /** 与 `Math.round` 相同 (.5 向正无穷), 不同于表达式里的 `round` */
    readonly round: (x: number) => number;
    readonly min: (...values: number[]) => number;
    readonly max: (...values: number[]) => number;
  };

  type SimulateOptions = {
    /**
     * 表达式 `random()` / `roll()` 与钩子随机数按哪个 MK 取种子; 默认不对应任何消息, 骰点仅供参考.
     * 指定时骰点与"这段文本出现在该楼正文里"相同; `applyText` / `commit` 的旁路写入按写入序号取种子, 骰点不同,
     * 要预览旁路写入请用 `atomic: true` 提交 (预检不通过时不写入)
     */
    seedMk?: string;
  };

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

  type CommitOperation =
    | { insert: object }
    | { edit: object }
    | { delete: object }
    | { patch: PatchOperation[] }
    /** 工具调用 */
    | { call: { name: string; args?: any } };

  type CommitOptions = {
    /** 写到哪一楼, 默认是最后一条 AI 消息; 同时给出 `mk` 和 `message_id` 时以 `mk` 为准 */
    mk?: string;
    /** 消息 ID, 可以用负数从末尾倒数 (`-1` 是最后一条消息) */
    message_id?: number;
    /** 有任何一项不能生效时, 全部不写入 */
    atomic?: boolean;
    /**
     * 幂等键: 目标楼已有同 key 的写入时跳过这次提交, 结果带 `skipped: true`.
     * 用于“首次显示时发奖励”“点击领取”这类只能生效一次的写入; 带 key 的写入不参与合并与压缩
     */
    key?: string;
  };

  /** `skipped`: 该楼已有同一幂等键的写入, 这次没有写入 */
  type WriteResult = { mk: string; stat: any; statWithoutMeta: any; skipped?: boolean };

  /** `Era.parseCommands` 解析出的一个指令块; 数据未转义, 一个块可以有多个对象 */
  type ParsedCommand = { type: 'insert' | 'edit' | 'delete' | 'patch' | 'call'; data: any[] };

  /** 楼层: 消息 ID (可以用负数从末尾倒数)、MK, 或 `{ message_id }` / `{ mk }` (同时给出时以 `mk` 为准) */
  type FloorRef = number | string | { mk?: string; message_id?: number };

  /**
   * 指令来自哪里: `'text'` 正文 (含 `Era.applyText` 写入的指令), `'api'` 旁路写入 (`Era.commit` 或开启
   * `API写入不修改消息` 时的写入事件), `'hook'` beforeApply 钩子追加的指令
   */
  type CommandOrigin = 'text' | 'api' | 'hook' | 'tool';

  /**
   * 指令的来源标记, 只用于报告, 不影响规则: `'extra'` 分步更新写入的 `<era_extra>` 中额外模型的输出,
   * `'apiOps'` 旁路写入 (含 `Era.applyText`). 主模型写在正文里的指令没有. `{{ERA-issues}}` 只报告主模型写在正文里的指令
   * (`origin` 为 `'text'`、没有该字段) 和无法解析的块, 钩子追加的指令和钩子引起的拦截不报告
   */
  type CommandSource = 'extra' | 'apiOps';

  type CommandErrorPayload = {
    errors: {
      mk: string | null;
      message_id: number;
      /** `parse` 表示指令块无法解析 */
      type: 'insert' | 'edit' | 'delete' | 'patch' | 'parse' | 'call';
      /** 涉及的路径; `parse` 时是内容的开头 */
      path: string;
      reason: string;
      /** 无法解析的块没有 */
      origin?: CommandOrigin;
      source?: CommandSource;
      [key: string]: any;
    }[];
  };

  /** 一处不符合变量结构的问题. `missing`: 缺必填字段 (多半是 schema 升级新增了字段); `invalid`: 类型或取值不符 */
  type SchemaIssue = { kind: 'missing' | 'invalid'; path: string; message: string };

  /** `Era.checkSchema` 的结果 */
  type SchemaCheckResult = {
    /** 是否注册了变量结构; 没有注册时 `valid` 为真 */
    registered: boolean;
    valid: boolean;
    issues: SchemaIssue[];
    /** schema 的 safeParse 抛出异常时的说明 */
    error?: string;
  };

  /**
   * 同步后最新的变量 (非空时) 不符合已注册的变量结构; 同一聊天、同一组问题只触发一次.
   * ERA 照常放行之后的修改, 可以用面板“诊断”页一键修复
   */
  type SchemaInvalidPayload = {
    /** 最后一条消息的 MK 和 ID */
    mk: string | null;
    message_id: number;
    issues: SchemaIssue[];
    /** schema 的 safeParse 抛出异常时的说明, 此时 `issues` 为空 */
    error?: string;
  };

  type ExtraStatusPayload = {
    mk: string;
    message_id: number;
    status: 'started' | 'retry' | 'done' | 'no_entries' | 'no_change' | 'aborted' | 'failed';
    problems?: string[];
    /** 结束时才有: 不影响结果判定的告警 (条目过滤器、EJS 渲染等) */
    warnings?: string[];
  };

  type ExtraResultStatus = 'done' | 'no_entries' | 'no_change' | 'aborted' | 'failed';

  /** `Era.extra.run()` 的结果 */
  type PlanRunResult = {
    /** `no_entries`: 卡里没有 `[era_plan]` 条目; `no_change`: 规划模型认为这一轮不需要结算 */
    status: 'done' | 'no_change' | 'no_entries' | 'failed' | 'aborted';
    /** 给剧情模型看的结算摘要 */
    summary: string;
    /** 追加的指令块 */
    blocks: string;
    /** 追加了 `<era_plan>` 的文本; 没有规划结果时是原文 */
    text: string;
    problems: string[];
    warnings: string[];
  };

  type ExtraRunResult = {
    mk: string;
    /** `status` 为 `done` 或 `no_change` */
    ok: boolean;
    /** 被同一楼的新一次解析取代或被取消时为 `aborted` */
    status: ExtraResultStatus;
    /** 最终没有解决的问题 */
    problems: string[];
    /**
     * 不影响结果判定的告警: 条目过滤器出错、EJS 渲染出错或超时、模板调用了写函数、取不到目标楼之前的状态等
     *
     */
    warnings: string[];
  };

  /** `Era.extra.status()` 的结果; 只保存在内存中, 不含 API 密钥 */
  type ExtraStatusSnapshot = {
    /** 正在进行的解析; `attempt` 为已发出的请求次数 (含重试与换用备用接口), 多个分组时取最多的一组 */
    running: Array<{ mk: string; startedAt: number; attempt: number }>;
    /** 最近一次结束的解析; 切换聊天时清空 */
    last: {
      mk: string;
      ok: boolean;
      /** 失败或取消的原因 */
      error?: string;
      /** 实际发送的提示词, 每个分组保留最后一次请求 */
      prompt?: Array<{ group: string; messages: { role: string; content: string }[] }>;
      /** 最后一次的原始回复; 多个分组时每组前面有一行 `【分组 名字】` */
      rawReply?: string;
      finishedAt: number;
      status: ExtraResultStatus;
      problems: string[];
      /** 不影响结果判定的告警 */
      warnings: string[];
    } | null;
    /** 输出已写进这些楼 (MK) 的正文、但同步还没算完; 发送前等待会等它们 */
    pendingSync: string[];
  };

  /** 传给条目过滤器的条目 (副本) */
  type EntryFilterEntry = {
    /** 所在的世界书 */
    world: string;
    uid: number;
    name: string;
    content: string;
    /** 文件里的开关; 有过滤器管理时只是过滤器不表态时的默认值 */
    enabled: boolean;
    [key: string]: any;
  };

  type EntryFilterContext = {
    /** 目标楼的状态: 去掉了 `$` 开头的字段, 已反转义. 只读 */
    stat: any;
    /** 目标楼的原始状态 (转义过的, 含 `$meta` 等字段). 只读 */
    statRaw: any;
    /** 匹配关键字用的文本: 到目标楼为止、最近几楼的正文 */
    text: string;
    /** 目标楼的 MK */
    mk: string;
    /**
     * 给谁选条目: `extra` 分步更新 (目标楼的状态), `plan` 正文前规划, `main` 主生成 (最新的状态).
     * 只想影响其中一种时按它判断, 其余返回 `undefined`
     */
    purpose: 'extra' | 'plan' | 'main';
  };

  /** 返回 `false` 排除, `true` 纳入 (即使文件里关闭), 字符串表示纳入并替换内容, 其他值表示不表态 */
  type EntryFilter = (entry: EntryFilterEntry, ctx: EntryFilterContext) => boolean | string | void | undefined;

  type ToolContext = {
    /** 本楼的 MK, 重算时不变 */
    mk: string;
    /** 执行到这次调用时的变量 (副本, 去掉了 `$meta` 等保留字段) */
    stat: any;
    /** 本楼开始前的变量 (副本) */
    old_stat: any;
    /** 按 MK、工具名和调用位置取种子的确定性随机数 [0, 1) */
    random(): number;
    math: DetMath;
  };

  type ToolDefinition = {
    /** 给 AI 看的说明, `{{ERA-tools}}` 会列出 */
    description?: string;
    /** 参数的 zod schema (先 safeParse, 不合法时调用失败); 也可以只写说明文字 */
    parameters?: any;
    /** 改了 handler 的逻辑时提高版本号, ERA 会完全重算一次 */
    version?: string | number;
    /**
     * 同步纯函数. 返回操作数组 (格式同 `Era.commit`, 不能再含 `call`),
     * 或 `{ operations?, result? }`: `result` 出现在 `{{ERA-toolResults}}` 与 `era:toolResult` 里. 抛出异常表示调用失败
     */
    handler: (
      args: any,
      ctx: ToolContext,
    ) => CommitOperation[] | { operations?: CommitOperation[]; result?: any } | void;
  };

  type ExprFnOptions = {
    /** 参数个数: 一个数表示固定个数, `[最少, 最多]` 表示范围; 默认 0～16 个 */
    params?: number | [number, number];
    description?: string;
    /** 改了公式时提高版本号, ERA 会完全重算一次 */
    version?: string | number;
  };

  type ToolCallResult = {
    name: string;
    args: any;
    ok: boolean;
    result?: any;
    error?: string;
    /** 产出的操作数 */
    operations: number;
  };

  type ToolResultPayload = {
    /** 本轮同步中计算过、有工具调用的楼层 */
    results: { mk: string; message_id: number; calls: ToolCallResult[] }[];
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
    /** 确定性数学函数, 用法同 `Math` */
    math: DetMath;
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
      /** 由 afterApply 钩子的修改引起的拦截没有 */
      origin?: CommandOrigin;
      source?: CommandSource;
    }[];
  };
}

/**
 * ERA 变量框架共享到全局的接口, **使用前必须先 `await waitGlobalInitialized('Era')`**.
 * 旧版 ERA 没有该接口, 等待将永远不会结束.
 */
declare const Era: {
  /** ERA-Heron 的版本号, 例如 `'2.0.0'` (更早的版本没有该字段, 判断版本请用 `era.ts` 的 `requireEra`) */
  version: string;
  /** 当前版本提供的功能, 例如 `Era.features.includes('applyText')` */
  features: readonly string[];
  /**
   * 注册变量结构 schema, 重复注册会覆盖; 返回注销函数.
   * schema 无效时弹窗提示、不注册 (不抛出异常), 可用 `hasSchema()` 确认
   */
  registerSchema: (schema: Era.SchemaLike, options?: Era.RegisterSchemaOptions) => () => void;
  /** 注销 schema; 提供 `schema` 时只有当前生效的正是它才注销 */
  unregisterSchema: (schema?: Era.SchemaLike) => boolean;
  /** 当前是否注册了 schema */
  hasSchema: () => boolean;
  /**
   * 检查变量是否符合当前注册的变量结构, 只读; `mk` 指定检查哪一楼处理完之后的变量, 默认是最新的.
   * 该楼的状态无法计算时 Promise 失败
   */
  checkSchema: (mk?: string) => Promise<Era.SchemaCheckResult>;
  /**
   * 指令解析后、执行前修改指令; 钩子必须是同步的、只依赖 `ctx` 的纯函数; 返回注销函数.
   * 钩子里调用 `Era.commit`、`Era.applyText`、`Era.extra.run` / `wait` 或发出写入事件会让该钩子报错、修改被丢弃
   */
  onBeforeApply: (id: string, hook: (ctx: Era.BeforeApplyContext) => void, options?: Era.HookOptions) => () => void;
  /**
   * 指令执行后修改变量; 钩子必须是同步的、只依赖 `ctx` 的纯函数; 返回注销函数. 参数无效时弹窗提示、不注册.
   * 与 `onBeforeApply` 相同, 钩子里不能调用写入接口
   */
  onAfterApply: (id: string, hook: (ctx: Era.AfterApplyContext) => void, options?: Era.HookOptions) => () => void;
  /** 当前角色卡是否注册了该 id 的钩子; 省略 `phase` 时任一阶段都算 */
  hasHook: (id: string, phase?: 'before' | 'after') => boolean;
  /**
   * 注册条目过滤器: 按变量决定世界书条目发不发、发什么内容, 不改世界书文件. 分步更新按**目标楼**的状态,
   * 正文前规划与主生成 (每次生成加载世界书时) 按最新的状态; 用 `ctx.purpose` 区分.
   * 在文件里的开关之前运行. 必须是同步的纯函数. 同名替换, 按名字顺序调用; 返回注销函数
   * @example
   * Era.registerEntryFilter('我的卡.规则二选一', (entry, ctx) => {
   *   if (entry.name.includes('[和平]')) return ctx.stat.世界?.时代 !== '战争';
   *   if (entry.name.includes('[战争]')) return ctx.stat.世界?.时代 === '战争';
   * });
   */
  registerEntryFilter: (name: string, filter: Era.EntryFilter) => () => void;
  /** 当前角色卡是否注册了该名字的条目过滤器 */
  hasEntryFilter: (name: string) => boolean;
  /**
   * 注册工具: AI 写 `<EraFCall name="工具名">{"参数": 1}</EraFCall>`, ERA 按位置调用 `handler`,
   * 它读到执行到这里时的变量, 返回普通的变量操作. 重算时重新执行. 返回注销函数
   */
  registerTool: (name: string, definition: Era.ToolDefinition) => () => void;
  /** 当前角色卡是否注册了该名字的工具 */
  hasTool: (name: string) => boolean;
  /**
   * 注册自定义公式函数, 在 `$expr` 里调用, 例如 `伤害(roll(1, 6), 防御)`.
   * 只接收数字、返回有限数字的同步纯函数; 不能与内置函数同名. 返回注销函数
   */
  registerExprFn: (name: string, fn: (...args: number[]) => number, options?: Era.ExprFnOptions) => () => void;
  /** 当前角色卡是否注册了该名字的自定义公式函数 */
  hasExprFn: (name: string) => boolean;
  /**
   * 按顺序提交一组写入, 在写入被计算之后完成; 不修改消息正文.
   * 失败时 Promise 带有说明原因的 `Error` (格式错误、找不到楼层、原子提交被放弃、聊天已切换、目标楼被删除或滑走、超时等)
   * @example
   * await Era.commit([{ edit: { 金币: '-=3' } }, { patch: [{ op: 'insert', path: '/背包/-', value: '面包' }] }], { atomic: true });
   */
  commit: (
    operations: Era.CommitOperation | Era.CommitOperation[],
    options?: Era.CommitOptions,
  ) => Promise<Era.WriteResult>;
  /**
   * 试算一段含指令的文本, 不写入任何数据; `mk` 指定在哪一楼之后的状态上试算. 解析方式与 AI 消息正文相同
   * (设置了指令外层标签的新聊天里, 标签外的指令不算). 预览 `applyText` / `commit` 的骰点请用 `atomic` 提交, 见 `seedMk`
   */
  simulate: (
    text: string,
    mk?: string,
    options?: Era.SimulateOptions,
  ) => Promise<{ stat: any; problems: { path: string; reason: string }[] }>;
  /**
   * 解析一段文本中的指令块, 不执行、不写入. 解析方式与 AI 消息正文相同:
   * 新建的聊天中, 思考标签里的指令不算, 设置了指令外层标签时只认标签内的指令
   */
  parseCommands: (text: string) => { commands: Era.ParsedCommand[]; problems: { path: string; reason: string }[] };
  /**
   * 把一段文本中的指令应用到一楼, 不修改正文. 指令保存为旁路写入, 按正文指令的规则执行
   * (例如 `下划线只读` 会限制它们); 选项与 `commit` 相同, `atomic` 时有无法解析的块也全部放弃.
   * 文本中没有可以执行的指令时 Promise 失败
   * @example
   * const reply = await generate({ user_input: '...' });
   * await Era.applyText(reply, { message_id: 0 });
   */
  applyText: (text: string, options?: Era.CommitOptions) => Promise<Era.WriteResult>;
  /**
   * 前端改写楼层正文时保留 ERA 写在正文里的块: 该楼的 MK (`<era_data>` 块, 丢失后该楼的旁路写入
   * 会在下次完全同步时被清除), 以及分步更新写入的 `<era_extra>` 块 (丢失后额外模型写入的变量会回滚).
   * `from` 是原来的正文或楼层的消息 ID; `text` 已含某种块时不再补这种块
   * @example
   * await setChatMessages([{ message_id: 0, message: Era.keepMessageKey(newText, 0) }]);
   */
  keepMessageKey: (text: string, from: string | number) => string;
  /** 确定性数学函数, 用法同 `Math`, 各浏览器逐位一致 */
  math: Era.DetMath;
  /** 当前注册的变量结构的文字说明, 没有注册时为空字符串; 宏为 `{{ERA-schema}}` */
  describeSchema: () => string;
  /** 额外模型解析 */
  extra: {
    /** 重新解析指定 MK 的消息, 不指定时解析最后一条 AI 消息; 结束后返回结果, 找不到消息时 Promise 失败 */
    run: (mk?: string) => Promise<Era.ExtraRunResult>;
    /** 取消正在进行的解析 */
    abort: (mk?: string) => void;
    /**
     * 等待正在进行的解析完成; 脚本自行触发生成 (如 `/trigger`) 之前可以先等待它.
     * 也等待已写进正文、但同步还没算完的输出 (见 `status().pendingSync`).
     * 返回 `false` 表示到了时限 (按重试次数、超时和写入计算) 或玩家点击提示框放弃了等待
     */
    wait: () => Promise<boolean>;
    /** 同步查询正在进行的解析和最近一次解析的结果 (含实际提示词与原始回复) */
    status: () => Era.ExtraStatusSnapshot;
    /**
     * 正文前规划: 按 `[era_plan]` 条目为一段玩家文字做规划, 返回追加了 `<era_plan>` 的文本, 不写入任何内容.
     * 脚本、快速回复自己发送消息时用它; 玩家点击发送时由分步更新设置“正文前规划”自动进行
     */
    plan: (text: string) => Promise<Era.PlanRunResult>;
    /** 重新规划最新一条玩家消息, 替换其中的 `<era_plan>`. 出错时弹窗提示并返回 `null` */
    replan: () => Promise<Era.PlanRunResult | null>;
  };
  /** 同步获取当前最新变量 */
  getCurrentVars: () => { stat: any; statWithoutMeta: any };
  /**
   * 某一楼处理完之后的变量, 让楼层状态栏显示“那一楼当时”的值; 只读.
   * 楼层不存在、还没有计算到、或日志已折叠又没有存档时 Promise 失败
   * @example
   * const { statWithoutMeta } = await Era.getVarsAt(getCurrentMessageId());
   */
  getVarsAt: (where: Era.FloorRef) => Promise<Era.Snapshot>;
};

interface ListenerType {
  // ERA 发出的事件
  'era:writeDone': (payload: Era.WriteDonePayload) => void;
  'era:queryResult': (payload: Era.QueryResultPayload) => void;
  'era:schemaError': (payload: Era.SchemaErrorPayload) => void;
  'era:commandError': (payload: Era.CommandErrorPayload) => void;
  'era:schemaInvalid': (payload: Era.SchemaInvalidPayload) => void;
  'era:extraStatus': (payload: Era.ExtraStatusPayload) => void;
  'era:toolResult': (payload: Era.ToolResultPayload) => void;

  // 发送给 ERA 的事件
  'era:insertByObject': (detail: Record<string, any>) => void;
  'era:updateByObject': (detail: Record<string, any>) => void;
  'era:deleteByObject': (detail: Record<string, any>) => void;
  'era:insertByPath': (detail: { path: string; value: any }) => void;
  'era:updateByPath': (detail: { path: string; value: any }) => void;
  'era:deleteByPath': (detail: { path: string }) => void;
  'era:patch': (detail: Era.PatchOperation | Era.PatchOperation[]) => void;
  'era:commit': (detail: Era.CommitOptions & { operations: Era.CommitOperation | Era.CommitOperation[] }) => void;
  'era:getCurrentVars': (detail?: any) => void;
  'era:getSnapshotAtMk': (detail: { mk: string; [key: string]: any }) => void;
  'era:getSnapshotsBetweenMks': (detail?: { startMk?: string; endMk?: string; [key: string]: any }) => void;
  'era:getSnapshotAtMId': (detail: { message_id: number; [key: string]: any }) => void;
  'era:getSnapshotsBetweenMIds': (detail?: { startId?: number; endId?: number; [key: string]: any }) => void;
  'era:requestWriteDone': () => void;
  'era:forceSync': (detail?: { mode?: 'full' | 'latest' | 'auto' | 'rollbackTo'; message_id?: number }) => void;
}
