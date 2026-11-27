// ERA 示例：用角色卡脚本在酒馆页面上挂一个常驻的状态面板，不放在聊天楼层里。所属文档：docs/era/03-状态栏.md “常驻状态面板”
// 用法：作为角色卡的酒馆助手脚本导入。把 FIELDS 换成你的变量路径和显示名。
//
// 和楼层状态栏的区别：整个页面只有一个面板，始终显示最新的变量，长聊天里不会随楼层增加而变卡；
// 但不能像楼层状态栏那样翻回去看“那一楼当时”的值。两者可以并用，也可以只用其中一种。
// 样式、位置、折叠方式都由你决定，ERA 只负责提供变量（Era.getCurrentVars）和变化通知（era:writeDone）。

(async () => {
  /** 要显示的变量：[显示名, 路径]。路径写法与 {{ERA:路径}} 相同。 */
  const FIELDS = [
    ['时间', '世界.时间段'],
    ['地点', '世界.地点'],
    ['好感度', '角色.好感度'],
    ['心情', '角色.心情'],
  ];

  await waitGlobalInitialized('Era');

  const escape = text => String(text).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  const show = value => (value === undefined ? '--' : typeof value === 'object' ? JSON.stringify(value) : value);

  // 酒馆助手脚本里的 $ 操作的是酒馆页面
  const panel = $(`
    <div id="my-card-status" style="
      position: fixed; top: 64px; right: 12px; z-index: 30; min-width: 160px; max-width: 260px;
      padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.6;
      color: var(--SmartThemeBodyColor); background: var(--SmartThemeBlurTintColor);
      border: 1px solid var(--SmartThemeBorderColor); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);">
      <div class="my-card-status__head" style="cursor: pointer; font-weight: bold;">状态 ▾</div>
      <div class="my-card-status__body"></div>
    </div>`).appendTo('body');
  panel.find('.my-card-status__head').on('click', () => panel.find('.my-card-status__body').toggle());

  function render(stat) {
    const rows = FIELDS.map(([label, path]) => `<div>${escape(label)}：${escape(show(_.get(stat, path)))}</div>`);
    panel.find('.my-card-status__body').html(rows.join(''));
  }

  // 加载时先显示当前值，之后每次 ERA 写完变量就刷新
  render(Era.getCurrentVars().statWithoutMeta);
  const listener = eventOn('era:writeDone', detail => render(detail.statWithoutMeta));

  // 切换角色卡、关闭页面时移除面板
  $(window).on('pagehide', () => {
    listener.stop();
    panel.remove();
  });
})();
