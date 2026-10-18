/* BorgerrrPOS Admin — app shell, router and pages. Reads/writes only via window.DataStore. */
(function () {
  'use strict';
  const APP_VERSION = 'web2';
  const D = window.DataStore;
  const { esc, fmt, toast, modal, closeModal, DataTable, sparkline, downloadCSV } = window.UI;
  const HOUR = 3600e3, DAY = 24 * HOUR, OFF = 8 * HOUR;
  const dayStart = t => Math.floor((t + OFF) / DAY) * DAY - OFF;
  const hourOf = t => Math.floor(((t + OFF) % DAY) / HOUR);
  const BIZ_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const hourLabel = h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const S = { range: ls('bp_range') || 'today', collapsed: ls('bp_sidebar') === '1', session: null, data: null, charts: [], donutTab: 'payments' };
  if (!['today', '7d', '30d'].includes(S.range)) S.range = 'today';

  const NAV = [
    { section: 'General', items: [['overview', 'Overview', 'dashboard'], ['orders', 'Orders', 'receipt'], ['activity', 'Activity log', 'activity']] },
    { section: 'Business', items: [['sales', 'Sales & profit', 'trending'], ['menu', 'Menu & prices', 'utensils'], ['stock', 'Ingredients & stock', 'package'], ['discounts', 'Discounts', 'percent']] },
    { section: 'System', items: [['settings', 'Settings', 'settings']] }
  ];
  const TITLES = { overview: 'Overview', orders: 'Orders', activity: 'Activity log', sales: 'Sales & profit', menu: 'Menu & prices', stock: 'Ingredients & stock', discounts: 'Discounts', settings: 'Settings' };

  /* ---------- Ranges & metrics ---------- */
  function range(key) {
    const now = Date.now(), today = dayStart(now);
    if (key === '7d') return { key, from: today - 6 * DAY, to: now, pFrom: today - 13 * DAY, pTo: now - 7 * DAY, days: 7, label: 'Last 7 days', short: '7 days', cmp: 'vs prev. 7 days', cmpShort: 'Prev. 7 days', bucket: 'day', span: fmt.date(today - 6 * DAY) + ' – ' + fmt.date(now) };
    if (key === '30d') return { key, from: today - 29 * DAY, to: now, pFrom: today - 59 * DAY, pTo: now - 30 * DAY, days: 30, label: 'Last 30 days', short: '30 days', cmp: 'vs prev. 30 days', cmpShort: 'Prev. 30 days', bucket: 'day', span: fmt.date(today - 29 * DAY) + ' – ' + fmt.date(now) };
    return { key: 'today', from: today, to: now, pFrom: today - DAY, pTo: now - DAY, days: 1, label: 'Today', short: 'today', cmp: 'vs yesterday', cmpShort: 'Yesterday', bucket: 'hour', span: 'Today, ' + fmt.date(now) };
  }
  const within = (list, a, b) => list.filter(o => o.t >= a && o.t <= b);
  function metrics(orders) {
    const m = { gross: 0, disc: 0, vatEx: 0, net: 0, cogs: 0, orders: 0, voids: 0, voidAmt: 0, refunds: 0, refundAmt: 0, items: 0 };
    for (const o of orders) {
      if (o.status === 'voided') { m.voids++; m.voidAmt += o.gross; continue; }
      if (o.status === 'refunded') { m.refunds++; m.refundAmt += o.net; continue; }
      m.orders++; m.gross += o.gross; m.net += o.net; m.cogs += o.cost; m.items += o.items;
      if (o.discount) { m.disc += o.discount.amount; m.vatEx += o.discount.vatExempt; }
    }
    m.avg = m.orders ? m.net / m.orders : 0;
    m.profit = m.net - m.cogs;
    m.margin = m.net ? m.profit / m.net * 100 : 0;
    return m;
  }
  function buckets(r) {
    if (r.bucket === 'hour') { const nowH = hourOf(Date.now()); return BIZ_HOURS.filter(h => h <= Math.max(nowH, 10)).map(h => ({ label: hourLabel(h), test: o => hourOf(o.t) === h })); }
    const out = []; for (let d = r.days - 1; d >= 0; d--) { const s = dayStart(r.to) - d * DAY; out.push({ label: fmt.date(s), test: o => o.t >= s && o.t < s + DAY }); }
    return out;
  }
  function series(orders, r, fn) {
    const done = orders.filter(o => o.status === 'completed');
    return buckets(r).map(b => fn(done.filter(b.test)));
  }
  const sum = (list, f) => list.reduce((a, o) => a + f(o), 0);
  const change = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null;
  const ctx = () => { const r = range(S.range); const all = S.data.orders; return { r, cur: within(all, r.from, r.to), prev: within(all, r.pFrom, r.pTo) }; };
  const stockStatus = s => s.qty <= 0 ? 'out' : s.qty <= s.min * 0.5 ? 'critical' : s.qty <= s.min ? 'low' : 'ok';
  const lowStock = () => S.data.stock.filter(s => stockStatus(s) !== 'ok').sort((a, b) => a.qty / a.min - b.qty / b.min);

  /* ---------- Small render helpers ---------- */
  const badge = (text, tone, dot) => '<span class="badge badge-' + tone + '">' + (dot !== false ? '<i></i>' : '') + esc(text) + '</span>';
  const STATUS = { completed: ['Completed', 'green'], voided: ['Voided', 'red'], refunded: ['Refunded', 'amber'] };
  const STOCK = { ok: ['In stock', 'green'], low: ['Low', 'amber'], critical: ['Critical', 'red'], out: ['Out of stock', 'red'] };
  const EVT = { sale: ['Sale', 'green', 'receipt'], void: ['Void', 'red', 'ban'], discount: ['Discount', 'violet', 'tag'], admin: ['Admin', 'blue', 'shield'] };
  const DISC_TONE = { senior: 'violet', pwd: 'blue', promo: 'orange' };
  const initials = n => String(n).split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
  const delta = (pct, invert) => {
    if (pct == null || !isFinite(pct)) return '<span class="delta flat">—</span>';
    if (Math.abs(pct) < 0.05) return '<span class="delta flat">0.0%</span>';
    const up = pct >= 0, good = invert ? !up : up;
    return '<span class="delta ' + (Math.abs(pct) < 0.05 ? 'flat' : good ? 'up' : 'down') + '">' + icon(up ? 'arrowUp' : 'arrowDown') + Math.abs(pct).toFixed(1) + '%</span>';
  };
  const head = (title, sub, actions) => '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="page-sub">' + sub + '</p>' : '') + '</div><div class="page-actions">' + (actions || '') + '</div></div>';
  const cardHead = (title, sub, right) => '<div class="card-head"><div><h3>' + esc(title) + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (right || '') + '</div>';
  const kpi = (label, value, pct, cmp, spark, opts) => '<div class="kpi card"><div class="kpi-top"><span class="kpi-label">' + esc(label) + '</span>' + delta(pct, opts && opts.invert) + '</div><div class="kpi-value num">' + value + '</div><div class="kpi-foot"><span class="kpi-cmp">' + esc(cmp) + '</span></div><div class="kpi-spark">' + sparkline(spark, { h: 34, color: (opts && opts.color) || 'var(--brand)' }) + '</div></div>';

  /* ---------- Charts ---------- */
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function destroyCharts() { S.charts.forEach(c => c.destroy()); S.charts = []; }
  function chartDefaults() {
    if (!window.Chart) return;
    const C = window.Chart;
    C.defaults.font.family = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';
    C.defaults.font.size = 11.5;
    C.defaults.color = css('--text-3');
    C.defaults.borderColor = css('--border');
    Object.assign(C.defaults.plugins.tooltip, { backgroundColor: css('--tooltip'), titleColor: '#fff', bodyColor: '#E2E8F0', padding: 10, cornerRadius: 8, boxPadding: 4, titleFont: { weight: '600' }, usePointStyle: true });
    C.defaults.plugins.legend.display = false;
    C.defaults.animation.duration = 450;
  }
  function mkChart(id, cfg) {
    const el = document.getElementById(id); if (!el) return null;
    if (!window.Chart) { el.parentElement.innerHTML = '<div class="chart-fallback">' + icon('info') + 'Charts could not load (offline?).</div>'; return null; }
    const ch = new window.Chart(el, cfg); S.charts.push(ch); return ch;
  }
  const axisY = cb => ({ beginAtZero: true, border: { display: false }, grid: { color: css('--grid') }, ticks: { padding: 8, maxTicksLimit: 5, callback: cb } });
  const axisX = { border: { display: false }, grid: { display: false }, ticks: { padding: 6, maxRotation: 0, autoSkipPadding: 14 } };
  const fillGrad = color => c => { const { chart } = c; const a = chart.chartArea; if (!a) return 'transparent'; const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, color + '40'); g.addColorStop(1, color + '00'); return g; };
  const centerText = { id: 'center', afterDraw(ch) { const o = ch.options.plugins.center; if (!o || !ch.chartArea) return; const { ctx: c, chartArea: a } = ch; const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2; c.save(); c.textAlign = 'center'; c.fillStyle = css('--text-3'); c.font = '500 11px Inter, sans-serif'; c.fillText(o.label, x, y - 8); c.fillStyle = css('--text-1'); c.font = '600 17px Inter, sans-serif'; c.fillText(o.value, x, y + 13); c.restore(); } };

  /* ---------- Login ---------- */
  function renderLogin() {
    destroyCharts();
    document.title = 'Sign in · BorgerrrPOS Admin';
    document.getElementById('app').innerHTML = `
    <div class="login">
      <aside class="login-brand">
        <div class="login-brand-inner">
          <div class="brand-row">${logoMark(36)}<span class="brand-name">BorgerrrPOS</span></div>
          <div class="login-pitch">
            <h1>Run every shift from one clear dashboard.</h1>
            <p>Sales, profit, stock levels and staff activity for your burger shop — in pesos, in Manila time, on any device.</p>
            <ul class="login-points">
              <li>${icon('trending')}<span><b>Live sales &amp; profit</b> by hour, item and payment type</span></li>
              <li>${icon('package')}<span><b>Low-stock alerts</b> before the patties run out</span></li>
              <li>${icon('shield')}<span><b>Full activity log</b> of voids, discounts and admin changes</span></li>
            </ul>
          </div>
          <div class="login-preview" aria-hidden="true">
            <div class="lp-row"><span>Net sales · today</span><span class="lp-delta">${icon('arrowUp')}12.4%</span></div>
            <div class="lp-value">₱38,420.50</div>
            ${sparkline([4, 6, 5, 9, 14, 11, 8, 10, 15, 17, 13, 16], { h: 44, color: '#FB923C' })}
          </div>
          <div class="login-foot">© 2026 BorgerrrPOS · Quezon City, PH</div>
        </div>
      </aside>
      <main class="login-main">
        <div class="login-card">
          <div class="brand-row mobile-only">${logoMark(32)}<span class="brand-name">BorgerrrPOS</span></div>
          <h2>Sign in to Admin</h2>
          <p class="login-sub">Manage menu, prices, stock and sales for Borgerrr.</p>
          <button class="btn btn-primary btn-lg btn-block" id="demo-btn">Continue in demo mode ${icon('chevronRight')}</button>
          <div class="divider"><span>or sign in with your shop account</span></div>
          <form class="login-form" onsubmit="return false">
            <label class="field"><span class="field-label">Email</span><span class="input-wrap">${icon('mail')}<input class="input" type="email" placeholder="owner@borgerrr.ph" disabled autocomplete="off"></span></label>
            <label class="field"><span class="field-label">Password</span><span class="input-wrap">${icon('lock')}<input class="input" type="password" placeholder="••••••••" disabled autocomplete="off"></span></label>
            <button class="btn btn-secondary btn-block" disabled title="Available once Firebase is connected">${icon('lock')}Sign in</button>
          </form>
          <div class="callout callout-info">${icon('info')}<div><b>Real sign-in comes with Firebase.</b> Until then, demo mode opens the dashboard with sample data saved only in this browser. No real shop data is shown.</div></div>
        </div>
        <div class="login-legal">Sample build · <span class="mono">${APP_VERSION}</span></div>
      </main>
    </div>`;
    document.getElementById('demo-btn').onclick = async () => {
      S.session = await D.signIn({ mode: 'demo' });
      if (!location.hash || location.hash === '#/' || location.hash === '#/login') history.replaceState(null, '', '#/overview');
      await route();
      setTimeout(() => toast('Welcome to demo mode', { type: 'info', desc: 'You are viewing sample data. Changes stay in this browser.' }), 300);
    };
  }

  /* ---------- App shell ---------- */
  function renderShell() {
    document.getElementById('app').innerHTML = `
    <div class="shell ${S.collapsed ? 'collapsed' : ''}">
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <div class="sb-top">
          <a class="sb-brand" href="#/overview">${logoMark(30)}<span class="sb-brand-text"><b>BorgerrrPOS</b><small>Admin</small></span></a>
          <button class="icon-btn sb-close mobile-only" data-act="nav-close" aria-label="Close menu">${icon('x')}</button>
        </div>
        <nav class="sb-nav">${NAV.map(s => `<div class="sb-section"><div class="sb-label">${s.section}</div>${s.items.map(([id, label, ic]) => `<a href="#/${id}" class="sb-link" data-route="${id}" title="${label}">${icon(ic)}<span class="sb-text">${label}</span>${id === 'stock' ? '<span class="sb-badge" id="sb-low"></span>' : ''}</a>`).join('')}</div>`).join('')}</nav>
        <div class="sb-bottom">
          <div class="sb-status"><span class="pulse"></span><span class="sb-text">Demo mode · sample data</span></div>
          <button class="sb-link sb-collapse desktop-only" data-act="collapse" title="Collapse sidebar">${icon('panel')}<span class="sb-text">Collapse sidebar</span></button>
        </div>
      </aside>
      <div class="scrim" data-act="nav-close"></div>
      <div class="main">
        <header class="topbar">
          <div class="tb-left">
            <button class="icon-btn mobile-only" data-act="nav-open" aria-label="Open menu">${icon('menu')}</button>
            <div class="gsearch" id="gsearch">
              ${icon('search')}<input id="gsearch-input" type="search" placeholder="Search orders, menu, ingredients…" autocomplete="off" aria-label="Search">
              <kbd class="desktop-only">/</kbd>
              <div class="dd-menu gsearch-results" id="gsearch-results" hidden></div>
            </div>
          </div>
          <div class="tb-right">
            <div class="seg range-seg" role="group" aria-label="Date range" id="range-seg">${icon('calendar', 'seg-ic')}${[['today', 'Today'], ['7d', '7d'], ['30d', '30d']].map(([k, l]) => `<button type="button" data-range="${k}">${l}</button>`).join('')}</div>
            <div class="dd store-dd">
              <button class="btn btn-secondary store-btn" data-dd="store">${icon('store')}<span id="store-name">Borgerrr - Main</span>${icon('chevronsUpDown', 'i-sm')}</button>
              <div class="dd-menu right" data-menu="store" hidden>
                <div class="dd-label">Stores</div>
                <button class="dd-item on">${icon('store')}<span class="dd-grow" id="store-name-2">Borgerrr - Main</span>${icon('check', 'i-brand')}</button>
                <div class="dd-sep"></div>
                <button class="dd-item" disabled>${icon('plus')}<span class="dd-grow">Add another store</span><span class="dd-hint">With Firebase</span></button>
              </div>
            </div>
            <span class="tb-sep desktop-only"></span>
            <button class="icon-btn theme-btn" data-act="theme" aria-label="Toggle dark mode" title="Toggle dark mode"><span class="theme-ic"></span></button>
            <div class="dd">
              <button class="icon-btn bell" data-dd="bell" aria-label="Notifications">${icon('bell')}<span class="bell-dot" id="bell-count"></span></button>
              <div class="dd-menu right wide" data-menu="bell" hidden id="bell-menu"></div>
            </div>
            <div class="dd">
              <button class="avatar-btn" data-dd="user" aria-label="Account menu"><span class="avatar">DA</span><span class="avatar-meta desktop-only"><b>Demo Admin</b><small>Owner</small></span>${icon('chevronDown', 'i-sm desktop-only')}</button>
              <div class="dd-menu right" data-menu="user" hidden>
                <div class="dd-user"><span class="avatar">DA</span><div><b>Demo Admin</b><small>demo@borgerrr.ph</small></div></div>
                <div class="dd-sep"></div>
                <a class="dd-item" href="#/settings">${icon('settings')}<span class="dd-grow">Settings</span></a>
                <button class="dd-item" data-act="theme">${icon('moon')}<span class="dd-grow">Toggle dark mode</span></button>
                <div class="dd-sep"></div>
                <button class="dd-item danger" data-act="signout">${icon('logout')}<span class="dd-grow">Sign out</span></button>
              </div>
            </div>
          </div>
        </header>
        <main class="content" id="content" tabindex="-1"></main>
      </div>
    </div>`;
    updateThemeIcon();
  }

  function updateChrome(page) {
    document.querySelectorAll('.sb-link[data-route]').forEach(a => { a.classList.toggle('active', a.dataset.route === page); if (a.dataset.route === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.querySelectorAll('#range-seg button').forEach(b => { b.classList.toggle('on', b.dataset.range === S.range); b.setAttribute('aria-pressed', b.dataset.range === S.range); });
    const low = lowStock();
    const sb = document.getElementById('sb-low'); if (sb) { sb.textContent = low.length || ''; sb.hidden = !low.length; }
    const bc = document.getElementById('bell-count'); if (bc) { bc.textContent = low.length || ''; bc.hidden = !low.length; }
    const sn = S.data.settings.storeName; document.getElementById('store-name').textContent = sn; document.getElementById('store-name-2').textContent = sn;
    document.getElementById('bell-menu').innerHTML = '<div class="dd-head"><b>Notifications</b>' + (low.length ? badge(low.length + ' low stock', 'red', false) : '') + '</div>' +
      (low.length ? low.slice(0, 6).map(s => `<a class="notif" href="#/stock"><span class="notif-ic ${stockStatus(s) === 'low' ? 'amber' : 'red'}">${icon('alert')}</span><span class="dd-grow"><b>${esc(s.name)}</b><small>${fmt.qty(s.qty)} ${esc(s.unit)} left · reorder at ${fmt.qty(s.min)}</small></span></a>`).join('') : '<div class="dd-empty">You’re all caught up.</div>') +
      '<a class="dd-foot" href="#/stock">View inventory ' + icon('chevronRight', 'i-sm') + '</a>';
  }

  /* ---------- Pages ---------- */
  const Pages = {};

  Pages.overview = () => {
    const { r, cur, prev } = ctx(), m = metrics(cur), p = metrics(prev);
    const h = hourOf(Date.now());
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const sp = f => series(cur, r, f);
    const recent = S.data.activity.slice(0, 7);
    const low = lowStock();
    return {
      html: head(greet + ', Demo', 'Here’s how <b>' + esc(S.data.settings.storeName) + '</b> is doing · ' + esc(r.span) + ' · ' + esc(fmt.time(Date.now())) + ' PHT',
        `<a class="btn btn-secondary" href="#/orders">${icon('receipt')}View orders</a><button class="btn btn-primary" data-act="export-orders">${icon('download')}Export</button>`) +
        `<div class="kpis">
          ${kpi('Gross sales', fmt.peso(m.gross), change(m.gross, p.gross), r.cmp, sp(l => sum(l, o => o.gross)))}
          ${kpi('Net sales', fmt.peso(m.net), change(m.net, p.net), r.cmp, sp(l => sum(l, o => o.net)))}
          ${kpi('Orders', fmt.num(m.orders), change(m.orders, p.orders), r.cmp, sp(l => l.length), { color: '#0EA5E9' })}
          ${kpi('Avg ticket', fmt.peso(m.avg), change(m.avg, p.avg), r.cmp, sp(l => l.length ? sum(l, o => o.net) / l.length : 0), { color: '#8B5CF6' })}
          ${kpi('Gross profit', fmt.peso(m.profit), change(m.profit, p.profit), r.cmp, sp(l => sum(l, o => o.net - o.cost)), { color: '#10B981' })}
        </div>
        <div class="grid">
          <section class="card span-8">
            ${cardHead('Sales by hour', 'Net sales' + (r.days > 1 ? ', average per day' : '') + ' · ' + esc(r.label), `<div class="legend-inline"><span><i class="lg-dot brand"></i>${esc(r.days > 1 ? r.label : 'Today')}</span><span><i class="lg-dash"></i>${esc(r.cmpShort)}</span></div>`)}
            <div class="chart h-280"><canvas id="c-hour" aria-label="Sales by hour chart" role="img"></canvas></div>
          </section>
          <section class="card span-4">
            ${cardHead('Breakdown', esc(r.label), `<div class="seg seg-sm" id="donut-tabs"><button type="button" data-tab="payments">Payments</button><button type="button" data-tab="discounts">Discounts</button></div>`)}
            <div class="donut-wrap"><div class="chart h-180"><canvas id="c-donut" role="img" aria-label="Breakdown chart"></canvas></div><ul class="legend-list" id="donut-legend"></ul></div>
          </section>
          <section class="card span-5">
            ${cardHead('Top items', 'By quantity sold · ' + esc(r.label), '<a class="link" href="#/sales">Margins ' + icon('chevronRight', 'i-sm') + '</a>')}
            <div class="chart h-300"><canvas id="c-top" role="img" aria-label="Top items chart"></canvas></div>
          </section>
          <section class="card span-3">
            ${cardHead('Low stock', low.length ? low.length + ' ingredients to reorder' : 'Everything is stocked', '<a class="link" href="#/stock">All ' + icon('chevronRight', 'i-sm') + '</a>')}
            <ul class="stock-list">${low.length ? low.slice(0, 5).map(s => { const st = stockStatus(s); const pct = Math.min(100, s.qty / s.min * 100); return `<li><div class="sl-row"><span class="sl-name">${esc(s.name)}</span>${badge(STOCK[st][0], STOCK[st][1], false)}</div><div class="bar"><span class="bar-${STOCK[st][1]}" style="width:${Math.max(pct, 2)}%"></span></div><div class="sl-meta"><span class="num">${fmt.qty(s.qty)} / ${fmt.qty(s.min)} ${esc(s.unit)}</span><button class="link" data-act="adjust" data-id="${s.id}">Restock</button></div></li>`; }).join('') : `<li class="empty-sm">${icon('checkCircle')} All ingredients are above their reorder point.</li>`}</ul>
          </section>
          <section class="card span-4">
            ${cardHead('Recent activity', 'Live from the register', '<a class="link" href="#/activity">View log ' + icon('chevronRight', 'i-sm') + '</a>')}
            <ul class="feed">${recent.map(e => `<li><span class="feed-ic ${EVT[e.type][1]}">${icon(EVT[e.type][2])}</span><div class="feed-body"><div class="feed-title">${esc(e.title)}</div><div class="feed-sub">${esc(e.staff)} · ${esc(fmt.rel(e.t))}</div></div>${e.amount != null ? `<span class="feed-amt num ${e.type === 'void' || e.type === 'discount' ? 'neg' : ''}">${e.type === 'void' || e.type === 'discount' ? '−' : ''}${fmt.peso(e.amount)}</span>` : ''}</li>`).join('')}</ul>
          </section>
        </div>`,
      mount() {
        const nowH = hourOf(Date.now());
        const byHour = (list, days) => BIZ_HOURS.map(hh => sum(list.filter(o => o.status === 'completed' && hourOf(o.t) === hh), o => o.net) / days);
        const curH = byHour(cur, r.days).map((v, i) => r.key === 'today' && BIZ_HOURS[i] > nowH ? null : v);
        const brand = css('--brand-hex');
        mkChart('c-hour', {
          type: 'line',
          data: { labels: BIZ_HOURS.map(hourLabel), datasets: [
            { label: r.days > 1 ? r.label : 'Today', data: curH, borderColor: brand, backgroundColor: fillGrad(brand), fill: true, tension: .38, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: brand, borderWidth: 2.2 },
            { label: r.cmpShort, data: byHour(prev, r.days), borderColor: css('--text-4'), borderDash: [4, 4], fill: false, tension: .38, pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.5 }] },
          options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: axisY(v => fmt.pesoShort(v)), x: axisX }, plugins: { tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmt.peso(c.parsed.y || 0) } } } }
        });
        const agg = {};
        cur.filter(o => o.status === 'completed').forEach(o => o.lines.forEach(l => { const a = agg[l.itemId] || (agg[l.itemId] = { name: l.name, qty: 0, rev: 0 }); a.qty += l.qty; a.rev += l.qty * l.price; }));
        const top = Object.values(agg).sort((a, b) => b.qty - a.qty).slice(0, 8);
        mkChart('c-top', {
          type: 'bar',
          data: { labels: top.map(t => t.name.length > 22 ? t.name.replace(/\s*\(.*\)/, '') : t.name), datasets: [{ data: top.map(t => t.qty), backgroundColor: top.map((t, i) => i === 0 ? brand : brand + '8C'), hoverBackgroundColor: brand, borderRadius: 6, borderSkipped: false, barThickness: 16 }] },
          options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: axisY(v => fmt.num(v)), y: { border: { display: false }, grid: { display: false }, ticks: { color: css('--text-2'), font: { weight: '500' } } } }, plugins: { tooltip: { callbacks: { label: c => ' ' + fmt.num(c.parsed.x) + ' sold · ' + fmt.peso(top[c.dataIndex].rev) } } } }
        });
        drawDonut(cur);
        document.getElementById('donut-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; S.donutTab = b.dataset.tab; S.charts = S.charts.filter(c => { if (c.canvas.id === 'c-donut') { c.destroy(); return false; } return true; }); drawDonut(cur); });
      }
    };
  };
  function drawDonut(cur) {
    document.querySelectorAll('#donut-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.donutTab));
    const done = cur.filter(o => o.status === 'completed');
    let rows, center, colors;
    if (S.donutTab === 'payments') {
      const keys = ['Cash', 'GCash', 'Maya', 'Card', 'Online'], names = { Online: 'Delivery apps' };
      rows = keys.map(k => { const l = done.filter(o => o.payment === k); return { label: names[k] || k, value: sum(l, o => o.net), count: l.length }; });
      center = { label: 'Net sales', value: fmt.pesoShort(sum(done, o => o.net)) };
      colors = ['#F97316', '#0EA5E9', '#10B981', '#8B5CF6', '#94A3B8'];
    } else {
      rows = [['senior', 'Senior Citizen'], ['pwd', 'PWD'], ['promo', 'Promo']].map(([k, n]) => { const l = done.filter(o => o.discount && o.discount.type === k); return { label: n, value: sum(l, o => o.discount.amount + o.discount.vatExempt), count: l.length }; });
      center = { label: 'Discounts', value: fmt.pesoShort(sum(rows, x => x.value)) };
      colors = ['#8B5CF6', '#0EA5E9', '#F97316'];
    }
    const total = sum(rows, x => x.value) || 1;
    document.getElementById('donut-legend').innerHTML = rows.map((x, i) => `<li><i style="background:${colors[i]}"></i><span class="lg-name">${esc(x.label)}<small>${fmt.num(x.count)} orders</small></span><span class="lg-val num">${fmt.peso0(x.value)}</span><span class="lg-pct num">${(x.value / total * 100).toFixed(0)}%</span></li>`).join('') +
      (S.donutTab === 'discounts' ? '<li class="lg-note">Senior/PWD amounts include the 12% VAT exemption.</li>' : '');
    mkChart('c-donut', { type: 'doughnut', data: { labels: rows.map(x => x.label), datasets: [{ data: rows.map(x => x.value), backgroundColor: colors, borderColor: css('--surface'), borderWidth: 3, hoverOffset: 4 }] }, options: { cutout: '72%', maintainAspectRatio: false, plugins: { center, tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt.peso(c.parsed) } } } }, plugins: [centerText] });
  }

  /* ---------- Orders ---------- */
  function orderModal(o) {
    const st = STATUS[o.status];
    const vatable = o.discount && o.discount.vatExempt ? 0 : o.net / 1.12;
    modal({
      title: 'Order #' + o.no, size: 'lg',
      desc: esc(fmt.long(o.t)) + ' · ' + esc(fmt.time(o.t)) + ' PHT',
      body: `<div class="od-meta"><div><span>Status</span>${badge(st[0], st[1])}</div><div><span>Cashier</span><b>${esc(o.staff)}</b></div><div><span>Order type</span><b>${esc(o.type)}</b></div><div><span>Payment</span><b>${esc(o.payment === 'Online' ? 'Paid in app' : o.payment)}</b></div></div>
        ${o.reason ? `<div class="callout callout-${o.status === 'voided' ? 'danger' : 'warn'}">${icon('alert')}<div><b>${st[0]}:</b> ${esc(o.reason)}</div></div>` : ''}
        <div class="twrap bordered"><table class="table table-compact"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${o.lines.map(l => `<tr><td>${esc(l.name)}</td><td class="r num">${l.qty}</td><td class="r num">${fmt.peso(l.price)}</td><td class="r num">${fmt.peso(l.qty * l.price)}</td></tr>`).join('')}</tbody></table></div>
        <dl class="totals"><div><dt>Subtotal</dt><dd class="num">${fmt.peso(o.gross)}</dd></div>
        ${o.discount && o.discount.vatExempt ? `<div><dt>Less: VAT exemption (12%)</dt><dd class="num">−${fmt.peso(o.discount.vatExempt)}</dd></div>` : ''}
        ${o.discount ? `<div><dt>Less: ${esc(o.discount.label)} ${o.discount.rate}%</dt><dd class="num">−${fmt.peso(o.discount.amount)}</dd></div>` : ''}
        <div class="total"><dt>Total</dt><dd class="num">${fmt.peso(o.net)}</dd></div>
        ${vatable ? `<div class="sub"><dt>VATable sales / VAT (12%)</dt><dd class="num">${fmt.peso(vatable)} / ${fmt.peso(o.net - vatable)}</dd></div>` : '<div class="sub"><dt>VAT-exempt sale</dt><dd>Senior/PWD</dd></div>'}
        </dl>`,
      cancel: 'Close',
      submit: 'Void order', danger: true,
      onSubmit: o.status === 'completed' ? () => { voidModal(o); return false; } : null
    });
  }
  function voidModal(o) {
    modal({
      title: 'Void order #' + o.no + '?', icon: 'alert', danger: true,
      desc: 'This removes ' + fmt.peso(o.net) + ' from sales and is recorded in the activity log.',
      body: `<label class="field"><span class="field-label">Reason</span><select name="reason" class="input">${['Customer cancelled', 'Wrong order punched', 'Duplicate entry', 'Payment failed', 'Manager override'].map(x => `<option>${x}</option>`).join('')}</select></label>`,
      submit: 'Void order',
      onSubmit: async d => { await D.voidOrder(o.id, d.reason); await refresh(); toast('Order #' + o.no + ' voided', { desc: d.reason }); }
    });
  }
  function exportOrders(list, label) {
    downloadCSV('borgerrr-orders-' + label + '.csv', [['Order', 'Date (PHT)', 'Time (PHT)', 'Type', 'Payment', 'Cashier', 'Items', 'Gross (PHP)', 'Discount type', 'Discount (PHP)', 'VAT exempt (PHP)', 'Net (PHP)', 'Cost (PHP)', 'Status']].concat(
      list.map(o => [o.no, fmt.dateY(o.t), fmt.time(o.t), o.type, o.payment, o.staff, o.lines.map(l => l.qty + 'x ' + l.name).join('; '), o.gross.toFixed(2), o.discount ? o.discount.label : '', o.discount ? o.discount.amount.toFixed(2) : '0.00', o.discount ? o.discount.vatExempt.toFixed(2) : '0.00', o.net.toFixed(2), o.cost.toFixed(2), o.status])));
    toast('Export ready', { desc: fmt.num(list.length) + ' orders downloaded as CSV' });
  }
  const stamp = () => new Date(Date.now() + OFF).toISOString().slice(0, 10);

  Pages.orders = () => {
    const { r, cur } = ctx(); const m = metrics(cur);
    return {
      html: head('Orders', fmt.num(cur.length) + ' orders · ' + esc(r.span) + ' · ' + fmt.peso(m.net) + ' net sales', `<button class="btn btn-secondary" data-act="export-orders">${icon('download')}Export CSV</button>`) + '<div id="t-orders"></div>',
      mount() {
        DataTable(document.getElementById('t-orders'), {
          id: 'orders', rows: cur, noun: 'orders', pageSize: 12, placeholder: 'Search order #, item, cashier…',
          sort: { key: 't', dir: 'desc' },
          search: o => '#' + o.no + ' ' + o.staff + ' ' + o.type + ' ' + o.payment + ' ' + o.lines.map(l => l.name).join(' ') + ' ' + (o.discount ? o.discount.label : ''),
          filters: [{ key: 'all', label: 'All' }, { key: 'completed', label: 'Completed', test: o => o.status === 'completed' }, { key: 'disc', label: 'Discounted', test: o => !!o.discount && o.status === 'completed' }, { key: 'voided', label: 'Voided', test: o => o.status === 'voided' }, { key: 'refunded', label: 'Refunded', test: o => o.status === 'refunded' }],
          columns: [
            { key: 'no', label: 'Order', value: o => o.t, render: o => `<span class="mono strong">#${esc(o.no)}</span>` },
            { key: 't', label: 'Date', value: o => o.t, render: o => `<span class="nowrap">${esc(fmt.date(o.t))}</span> <span class="muted nowrap">${esc(fmt.time(o.t))}</span>` },
            { key: 'items', label: 'Items', value: o => o.items, cls: 'td-items', render: o => `<span class="ellipsis" title="${esc(o.lines.map(l => l.qty + '× ' + l.name).join(', '))}">${o.lines[0].qty > 1 ? o.lines[0].qty + '× ' : ''}${esc(o.lines[0].name)}${o.lines.length > 1 ? ` <span class="muted">+${o.lines.length - 1} more</span>` : ''}</span>` },
            { key: 'type', label: 'Type', render: o => `<span class="nowrap">${esc(o.type)}</span>` },
            { key: 'payment', label: 'Payment', render: o => `<span class="pay pay-${o.payment.toLowerCase()}">${esc(o.payment === 'Online' ? 'In-app' : o.payment)}</span>` },
            { key: 'disc', label: 'Discount', value: o => o.discount ? o.discount.label : '', render: o => o.discount ? badge(o.discount.type === 'promo' ? 'Promo' : o.discount.type === 'pwd' ? 'PWD' : 'Senior', DISC_TONE[o.discount.type], false) : '<span class="muted">—</span>' },
            { key: 'net', label: 'Total', align: 'right', value: o => o.net, render: o => `<span class="num strong ${o.status !== 'completed' ? 'strike' : ''}">${fmt.peso(o.net)}</span>` },
            { key: 'status', label: 'Status', render: o => badge(STATUS[o.status][0], STATUS[o.status][1]) }
          ],
          onRow: orderModal
        });
      }
    };
  };

  /* ---------- Activity ---------- */
  Pages.activity = () => {
    const { r } = ctx();
    const list = S.data.activity.filter(e => e.t >= r.from && e.t <= r.to);
    const c = t => list.filter(e => e.type === t).length;
    const stat = (t, label) => `<div class="mini card"><span class="feed-ic ${EVT[t][1]}">${icon(EVT[t][2])}</span><div><div class="mini-label">${label}</div><div class="mini-value num">${fmt.num(c(t))}</div></div></div>`;
    S.activityView = list;
    return {
      html: head('Activity log', 'Every sale, void, discount and admin change · ' + esc(r.span), `<button class="btn btn-secondary" data-act="export-activity">${icon('download')}Export CSV</button>`) +
        `<div class="minis">${stat('sale', 'Sales')}${stat('void', 'Voids &amp; refunds')}${stat('discount', 'Discounts')}${stat('admin', 'Admin actions')}</div><div id="t-activity"></div>`,
      mount() {
        DataTable(document.getElementById('t-activity'), {
          id: 'activity', rows: list, noun: 'events', pageSize: 12, placeholder: 'Search events, order #, staff…', sort: { key: 't', dir: 'desc' },
          search: e => e.title + ' ' + e.detail + ' ' + e.staff,
          filters: [{ key: 'all', label: 'All' }, { key: 'sale', label: 'Sales', test: e => e.type === 'sale' }, { key: 'void', label: 'Voids', test: e => e.type === 'void' }, { key: 'discount', label: 'Discounts', test: e => e.type === 'discount' }, { key: 'admin', label: 'Admin actions', test: e => e.type === 'admin' }],
          columns: [
            { key: 't', label: 'Time', value: e => e.t, width: '140px', render: e => `<div class="stack"><span class="nowrap">${esc(fmt.time(e.t))}</span><small class="muted nowrap">${esc(fmt.week(e.t))}</small></div>` },
            { key: 'title', label: 'Event', render: e => `<div class="evt"><span class="feed-ic sm ${EVT[e.type][1]}">${icon(EVT[e.type][2])}</span><div class="stack"><span class="strong">${esc(e.title)}</span><small class="muted">${esc(e.detail)}</small></div></div>` },
            { key: 'type', label: 'Type', render: e => badge(EVT[e.type][0], EVT[e.type][1]) },
            { key: 'staff', label: 'Staff', render: e => `<span class="who"><span class="avatar xs">${esc(initials(e.staff))}</span><span class="nowrap">${esc(e.staff)}</span></span>` },
            { key: 'amount', label: 'Amount', align: 'right', value: e => e.amount || 0, render: e => e.amount == null ? '<span class="muted">—</span>' : `<span class="num ${e.type === 'void' || e.type === 'discount' ? 'neg' : 'strong'}">${e.type === 'void' || e.type === 'discount' ? '−' : ''}${fmt.peso(e.amount)}</span>` }
          ],
          onRow: e => { const o = e.ref && S.data.orders.find(x => x.id === e.ref); if (o) orderModal(o); }
        });
      }
    };
  };

  /* ---------- Sales & profit ---------- */
  function itemMargins(cur) {
    const agg = {};
    cur.filter(o => o.status === 'completed').forEach(o => o.lines.forEach(l => { const a = agg[l.itemId] || (agg[l.itemId] = { qty: 0, rev: 0, cost: 0 }); a.qty += l.qty; a.rev += l.qty * l.price; a.cost += l.qty * l.cost; }));
    return S.data.menu.map(m => { const a = agg[m.id] || { qty: 0, rev: 0, cost: 0 }; return { ...m, unitMargin: m.price - m.cost, marginPct: m.price ? (m.price - m.cost) / m.price * 100 : 0, qty: a.qty, rev: a.rev, profit: a.rev - a.cost }; });
  }
  const marginBar = pct => { const tone = pct >= 60 ? 'green' : pct >= 45 ? 'amber' : 'red'; return `<span class="mbar"><span class="bar sm"><span class="bar-${tone}" style="width:${Math.max(0, Math.min(100, pct))}%"></span></span><span class="num">${pct.toFixed(1)}%</span></span>`; };
  Pages.sales = () => {
    const { r, cur, prev } = ctx(), m = metrics(cur), p = metrics(prev);
    const sp = f => series(cur, r, f);
    return {
      html: head('Sales & profit', esc(r.span) + ' · amounts in PHP, VAT-inclusive', `<button class="btn btn-secondary" data-act="export-daily">${icon('download')}Summary CSV</button><button class="btn btn-primary" data-act="export-margins">${icon('download')}Item margins CSV</button>`) +
        `<div class="kpis k4">
          ${kpi('Net revenue', fmt.peso(m.net), change(m.net, p.net), r.cmp, sp(l => sum(l, o => o.net)))}
          ${kpi('Cost of goods', fmt.peso(m.cogs), change(m.cogs, p.cogs), r.cmp, sp(l => sum(l, o => o.cost)), { color: '#64748B', invert: true })}
          ${kpi('Gross profit', fmt.peso(m.profit), change(m.profit, p.profit), r.cmp, sp(l => sum(l, o => o.net - o.cost)), { color: '#10B981' })}
          ${kpi('Gross margin', fmt.pct(m.margin), change(m.margin, p.margin), r.cmp, sp(l => { const n = sum(l, o => o.net); return n ? (n - sum(l, o => o.cost)) / n * 100 : 0; }), { color: '#8B5CF6' })}
        </div>
        <div class="grid">
          <section class="card span-8">${cardHead('Revenue, cost & profit', (r.bucket === 'hour' ? 'By hour' : 'By day') + ' · ' + esc(r.label), '<div class="legend-inline"><span><i class="lg-dot brand"></i>Revenue</span><span><i class="lg-dot slate"></i>Cost</span><span><i class="lg-dot green"></i>Profit</span></div>')}<div class="chart h-300"><canvas id="c-trend" role="img" aria-label="Revenue cost and profit trend"></canvas></div></section>
          <section class="card span-4">${cardHead('Profit breakdown', esc(r.label))}
            <dl class="waterfall">
              <div><dt>Gross sales</dt><dd class="num">${fmt.peso(m.gross)}</dd></div>
              <div class="minus"><dt>Promo &amp; statutory discounts</dt><dd class="num">−${fmt.peso(m.disc)}</dd></div>
              <div class="minus"><dt>VAT exemptions <small>Senior/PWD</small></dt><dd class="num">−${fmt.peso(m.vatEx)}</dd></div>
              <div class="sum"><dt>Net sales</dt><dd class="num">${fmt.peso(m.net)}</dd></div>
              <div class="minus"><dt>Cost of goods sold</dt><dd class="num">−${fmt.peso(m.cogs)}</dd></div>
              <div class="sum strong"><dt>Gross profit</dt><dd class="num">${fmt.peso(m.profit)}</dd></div>
            </dl>
            <div class="wf-foot"><span>Voided orders</span><b class="num">${fmt.num(m.voids)} · ${fmt.peso(m.voidAmt)}</b></div>
            <div class="wf-foot"><span>Refunds</span><b class="num">${fmt.num(m.refunds)} · ${fmt.peso(m.refundAmt)}</b></div>
          </section>
        </div>
        <div class="section-title"><h2>Per-item margins</h2><p>Unit margin uses current menu price and cost. Sales and profit are before order-level discounts.</p></div>
        <div id="t-margins"></div>`,
      mount() {
        const b = buckets(r), done = cur.filter(o => o.status === 'completed');
        const rev = b.map(x => sum(done.filter(x.test), o => o.net)), cost = b.map(x => sum(done.filter(x.test), o => o.cost));
        const brand = css('--brand-hex');
        mkChart('c-trend', {
          type: 'line',
          data: { labels: b.map(x => x.label), datasets: [
            { label: 'Revenue', data: rev, borderColor: brand, backgroundColor: fillGrad(brand), fill: true, tension: .35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.2 },
            { label: 'Cost', data: cost, borderColor: '#94A3B8', tension: .35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.8 },
            { label: 'Profit', data: rev.map((v, i) => v - cost[i]), borderColor: '#10B981', tension: .35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.8 }] },
          options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: axisY(v => fmt.pesoShort(v)), x: axisX }, plugins: { tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmt.peso(c.parsed.y) } } } }
        });
        const rows = itemMargins(cur);
        S.marginRows = rows;
        DataTable(document.getElementById('t-margins'), {
          id: 'margins', rows, noun: 'items', pageSize: 10, placeholder: 'Search items…', sort: { key: 'profit', dir: 'desc' },
          search: x => x.name + ' ' + x.sku + ' ' + x.category,
          filters: [{ key: 'all', label: 'All' }].concat(CATS.map(c => ({ key: c, label: c, test: x => x.category === c }))),
          columns: [
            { key: 'name', label: 'Item', render: x => `<div class="stack"><span class="strong">${esc(x.name)}</span><small class="muted mono">${esc(x.sku)} · ${esc(x.category)}</small></div>` },
            { key: 'price', label: 'Price', align: 'right', render: x => `<span class="num">${fmt.peso(x.price)}</span>` },
            { key: 'cost', label: 'Unit cost', align: 'right', render: x => `<span class="num muted">${fmt.peso(x.cost)}</span>` },
            { key: 'unitMargin', label: 'Unit margin', align: 'right', render: x => `<span class="num">${fmt.peso(x.unitMargin)}</span>` },
            { key: 'marginPct', label: 'Margin', align: 'right', render: x => marginBar(x.marginPct) },
            { key: 'qty', label: 'Sold', align: 'right', render: x => `<span class="num">${fmt.num(x.qty)}</span>` },
            { key: 'rev', label: 'Sales', align: 'right', render: x => `<span class="num">${fmt.peso(x.rev)}</span>` },
            { key: 'profit', label: 'Profit', align: 'right', render: x => `<span class="num strong">${fmt.peso(x.profit)}</span>` }
          ]
        });
      }
    };
  };

  /* ---------- Menu ---------- */
  const CATS = ['Burgers', 'Combos', 'Sides', 'Drinks', 'Desserts'];
  const CAT_TONE = { Burgers: 'orange', Combos: 'violet', Sides: 'amber', Drinks: 'blue', Desserts: 'pink' };
  function menuModal(item) {
    const isNew = !item;
    item = item || { name: '', category: 'Burgers', price: '', cost: '', active: true };
    modal({
      title: isNew ? 'Add menu item' : 'Edit menu item',
      desc: isNew ? 'New items reach the POS once Firebase sync is connected.' : '<span class="mono">' + esc(item.sku) + '</span> · changes are recorded in the activity log',
      body: `<label class="field"><span class="field-label">Item name</span><input class="input" name="name" value="${esc(item.name)}" required maxlength="60" placeholder="e.g. Spicy Adobo Burger"></label>
        <div class="field-row">
          <label class="field"><span class="field-label">Category</span><select class="input" name="category">${CATS.map(c => `<option ${c === item.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <div class="field"><span class="field-label">Status</span><label class="switch-row"><span class="switch"><input type="checkbox" name="active" ${item.active ? 'checked' : ''}><span></span></span><span class="switch-label">Show on POS</span></label></div>
        </div>
        <div class="field-row">
          <label class="field"><span class="field-label">Selling price</span><span class="input-affix"><span>₱</span><input class="input" type="number" name="price" min="0" step="0.01" value="${item.price}" required></span></label>
          <label class="field"><span class="field-label">Unit cost</span><span class="input-affix"><span>₱</span><input class="input" type="number" name="cost" min="0" step="0.01" value="${item.cost}" required></span></label>
        </div>
        <div class="preview" id="mp"></div>`,
      submit: isNew ? 'Add item' : 'Save changes',
      onMount(f) {
        const upd = () => { const p = +f.price.value, c = +f.cost.value; const el = f.querySelector('#mp'); if (!(p > 0)) { el.innerHTML = '<span class="muted">Enter a price to see the margin.</span>'; return; } const pct = (p - c) / p * 100; el.innerHTML = `<span>Margin per item</span><b class="num">${fmt.peso(p - c)}</b>${marginBar(pct)}`; };
        f.price.addEventListener('input', upd); f.cost.addEventListener('input', upd); upd();
      },
      onSubmit: async d => {
        if (!d.name.trim()) throw new Error('Please enter an item name.');
        if (!(+d.price > 0)) throw new Error('Selling price must be more than ₱0.');
        if (d.cost === '' || +d.cost < 0) throw new Error('Unit cost can’t be negative.');
        if (+d.cost > +d.price) throw new Error('Unit cost is higher than the price. Double-check the numbers.');
        const saved = await D.saveMenuItem({ ...item, name: d.name.trim(), category: d.category, price: +d.price, cost: +d.cost, active: d.active });
        await refresh();
        toast(isNew ? 'Item added' : 'Changes saved', { desc: saved.name + ' · ' + fmt.peso(saved.price) });
      }
    });
  }
  Pages.menu = () => {
    const { r, cur } = ctx();
    const rows = itemMargins(cur);
    const active = S.data.menu.filter(m => m.active).length;
    return {
      html: head('Menu & prices', fmt.num(S.data.menu.length) + ' items · ' + active + ' on the POS · prices are VAT-inclusive', `<button class="btn btn-primary" data-act="add-item">${icon('plus')}Add item</button>`) + '<div id="t-menu"></div>',
      mount() {
        DataTable(document.getElementById('t-menu'), {
          id: 'menu', rows, noun: 'items', pageSize: 12, placeholder: 'Search menu…', sort: { key: 'sku', dir: 'asc' },
          search: x => x.name + ' ' + x.sku + ' ' + x.category,
          filters: [{ key: 'all', label: 'All' }].concat(CATS.map(c => ({ key: c, label: c, test: x => x.category === c }))),
          columns: [
            { key: 'sku', label: 'Item', value: x => x.sku, render: x => `<div class="item-cell"><span class="thumb t-${CAT_TONE[x.category]}">${esc(initials(x.name.replace(/\(.*\)/, '')))}</span><div class="stack"><span class="strong">${esc(x.name)}</span><small class="muted mono">${esc(x.sku)}</small></div></div>` },
            { key: 'category', label: 'Category', render: x => badge(x.category, CAT_TONE[x.category], false) },
            { key: 'price', label: 'Price', align: 'right', render: x => `<span class="num strong">${fmt.peso(x.price)}</span>` },
            { key: 'cost', label: 'Cost', align: 'right', render: x => `<span class="num muted">${fmt.peso(x.cost)}</span>` },
            { key: 'marginPct', label: 'Margin', align: 'right', render: x => marginBar(x.marginPct) },
            { key: 'qty', label: 'Sold · ' + r.short, align: 'right', render: x => `<span class="num">${fmt.num(x.qty)}</span>` },
            { key: 'active', label: 'Status', value: x => x.active ? 1 : 0, render: x => x.active ? badge('Active', 'green') : badge('Hidden', 'gray') },
            { key: 'act', label: '', sortable: false, align: 'right', render: () => `<button class="btn btn-ghost btn-sm" data-act="edit">${icon('pencil')}Edit</button>` }
          ],
          onRow: x => menuModal(S.data.menu.find(m => m.id === x.id)),
          onAction: (a, x) => menuModal(S.data.menu.find(m => m.id === x.id))
        });
      }
    };
  };

  /* ---------- Stock ---------- */
  function stockModal(s) {
    modal({
      title: 'Adjust stock', desc: '<b>' + esc(s.name) + '</b> · ' + fmt.qty(s.qty) + ' ' + esc(s.unit) + ' on hand · ' + esc(s.supplier),
      body: `<div class="field"><span class="field-label">Adjustment type</span><div class="radio-cards">
          <label><input type="radio" name="mode" value="receive" checked><span>${icon('plus')}<b>Receive delivery</b><small>Add to on-hand</small></span></label>
          <label><input type="radio" name="mode" value="waste"><span>${icon('trash')}<b>Record wastage</b><small>Subtract spoilage</small></span></label>
          <label><input type="radio" name="mode" value="count"><span>${icon('refresh')}<b>Set count</b><small>After a physical count</small></span></label></div></div>
        <div class="field-row">
          <label class="field"><span class="field-label">Quantity</span><span class="input-affix suffix"><input class="input" type="number" name="amount" min="0" step="0.1" required placeholder="0"><span>${esc(s.unit)}</span></span></label>
          <label class="field"><span class="field-label">Reorder point</span><span class="input-affix suffix"><input class="input" type="number" name="min" min="0" step="0.1" value="${s.min}"><span>${esc(s.unit)}</span></span></label>
        </div>
        <label class="field"><span class="field-label">Note <small class="muted">(optional)</small></span><input class="input" name="note" maxlength="80" placeholder="e.g. DR #4471"></label>
        <div class="preview" id="sp"></div>`,
      submit: 'Save adjustment',
      onMount(f) {
        const upd = () => { const a = +f.amount.value || 0, mode = f.querySelector('[name=mode]:checked').value; const n = mode === 'receive' ? s.qty + a : mode === 'waste' ? Math.max(0, s.qty - a) : a; const st = STOCK[stockStatus({ qty: n, min: +f.min.value || s.min })]; f.querySelector('#sp').innerHTML = `<span>New on-hand</span><b class="num">${fmt.qty(n)} ${esc(s.unit)}</b>${badge(st[0], st[1], false)}`; };
        f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
      },
      onSubmit: async d => {
        if (d.amount === '' || +d.amount < 0) throw new Error('Enter a quantity of 0 or more.');
        const saved = await D.adjustStock(s.id, d);
        await refresh();
        toast('Stock updated', { desc: saved.name + ' now at ' + fmt.qty(saved.qty) + ' ' + saved.unit });
      }
    });
  }
  Pages.stock = () => {
    const list = S.data.stock, low = lowStock();
    const value = sum(list, s => s.qty * s.unitCost);
    const out = list.filter(s => s.qty <= 0).length;
    const stat = (label, val, tone, ic) => `<div class="mini card"><span class="feed-ic ${tone}">${icon(ic)}</span><div><div class="mini-label">${label}</div><div class="mini-value num">${val}</div></div></div>`;
    return {
      html: head('Ingredients & stock', 'On-hand counts and reorder points · ' + fmt.num(low.length) + ' items need attention', '') +
        `<div class="minis">${stat('Tracked ingredients', fmt.num(list.length), 'blue', 'package')}${stat('Needs reorder', fmt.num(low.length), 'amber', 'alert')}${stat('Out of stock', fmt.num(out), 'red', 'ban')}${stat('Inventory value', fmt.peso0(value), 'green', 'wallet')}</div><div id="t-stock"></div>`,
      mount() {
        DataTable(document.getElementById('t-stock'), {
          id: 'stock', rows: list, noun: 'ingredients', pageSize: 12, placeholder: 'Search ingredients or suppliers…', sort: { key: 'level', dir: 'asc' },
          search: s => s.name + ' ' + s.category + ' ' + s.supplier,
          filters: [{ key: 'all', label: 'All' }, { key: 'low', label: 'Needs reorder', test: s => stockStatus(s) !== 'ok' }, { key: 'out', label: 'Out of stock', test: s => s.qty <= 0 }],
          columns: [
            { key: 'name', label: 'Ingredient', render: s => `<div class="stack"><span class="strong">${esc(s.name)}</span><small class="muted">${esc(s.supplier)}</small></div>` },
            { key: 'category', label: 'Category', render: s => `<span class="muted">${esc(s.category)}</span>` },
            { key: 'qty', label: 'On hand', align: 'right', render: s => `<span class="num strong">${fmt.qty(s.qty)}</span> <span class="muted">${esc(s.unit)}</span>` },
            { key: 'level', label: 'Level', value: s => s.qty / s.min, render: s => { const st = stockStatus(s); return `<span class="bar lvl" title="Marker = reorder point"><span class="bar-${STOCK[st][1]}" style="width:${Math.max(2, Math.min(100, s.qty / (s.min * 2) * 100))}%"></span><i></i></span>`; } },
            { key: 'min', label: 'Reorder at', align: 'right', render: s => `<span class="num muted">${fmt.qty(s.min)} ${esc(s.unit)}</span>` },
            { key: 'status', label: 'Status', value: s => ['out', 'critical', 'low', 'ok'].indexOf(stockStatus(s)), dir: 'asc', render: s => badge(STOCK[stockStatus(s)][0], STOCK[stockStatus(s)][1]) },
            { key: 'updatedAt', label: 'Updated', render: s => `<span class="muted nowrap">${esc(fmt.rel(s.updatedAt))}</span>` },
            { key: 'act', label: '', sortable: false, align: 'right', render: () => `<button class="btn btn-ghost btn-sm" data-act="adjust">${icon('pencil')}Adjust</button>` }
          ],
          onRow: s => stockModal(s), onAction: (a, s) => stockModal(s)
        });
      }
    };
  };

  /* ---------- Discounts ---------- */
  function discountModal(d) {
    const statutory = d.vatExempt;
    modal({
      title: 'Edit ' + d.label + ' discount',
      desc: statutory ? 'Statutory discount under ' + esc(d.law) + '. Only change this if the law changes.' : 'Store promo applied by code at the register.',
      body: `<div class="field-row">
          <label class="field"><span class="field-label">Discount rate</span><span class="input-affix suffix"><input class="input" type="number" name="rate" min="0" max="100" step="1" value="${d.rate}" required><span>%</span></span></label>
          ${statutory ? '' : `<label class="field"><span class="field-label">Promo code</span><input class="input mono" name="code" value="${esc(d.code)}" maxlength="20"></label>`}
        </div>
        <label class="switch-row"><span class="switch"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}><span></span></span><span class="switch-label">Available at the register</span></label>
        ${statutory ? `<div class="callout callout-warn">${icon('alert')}<div>Senior Citizen and PWD discounts are <b>20% plus VAT exemption</b> by law. Cashiers must record the ID number on every transaction.</div></div>` : ''}`,
      onSubmit: async f => {
        const saved = await D.saveDiscount(d.key, { rate: +f.rate, code: f.code, active: f.active });
        await refresh();
        toast(saved.label + ' discount saved', { desc: saved.rate + '% · ' + (saved.active ? 'active' : 'disabled') });
      }
    });
  }
  Pages.discounts = () => {
    const { r, cur } = ctx(), ds = S.data.discounts;
    const done = cur.filter(o => o.status === 'completed');
    const ex = 199, exVat = ex / 1.12;
    const card = (d, ic, tone, body) => `<section class="card disc-card"><div class="disc-top"><span class="feed-ic lg ${tone}">${icon(ic)}</span>${d.active ? badge('Active', 'green') : badge('Disabled', 'gray')}</div><h3>${esc(d.label)}</h3><div class="disc-rate num">${d.rate}%<small>${d.vatExempt ? '+ VAT exemption' : 'off the bill'}</small></div>${body}<div class="disc-foot"><button class="btn btn-secondary btn-sm" data-act="edit-disc" data-key="${d.key}">${icon('pencil')}Edit</button></div></section>`;
    const usage = ['senior', 'pwd', 'promo'].map(k => { const l = done.filter(o => o.discount && o.discount.type === k); return { k, label: ds[k].label, n: l.length, amt: sum(l, o => o.discount.amount), vat: sum(l, o => o.discount.vatExempt), gross: sum(l, o => o.gross) }; });
    return {
      html: head('Discounts', 'Statutory and store discounts applied at the register', '') +
        `<div class="grid g3">
          ${card(ds.promo, 'tag', 'orange', `<p class="disc-desc">Code <span class="code">${esc(ds.promo.code)}</span> for dine-in and take-out orders. Can’t be combined with Senior/PWD.</p>`)}
          ${card(ds.senior, 'users', 'violet', `<p class="disc-desc">For senior citizens (60+) with an OSCA ID, per ${esc(ds.senior.law)}.</p><div class="vat-note">${icon('info')}<div><b>VAT-exempt.</b> Remove the 12% VAT first, then take ${ds.senior.rate}% off the VAT-exclusive price. Example: ${fmt.peso(ex)} → ${fmt.peso(exVat)} ex-VAT → <b>${fmt.peso(exVat * (1 - ds.senior.rate / 100))}</b> to pay.</div></div>`)}
          ${card(ds.pwd, 'shield', 'blue', `<p class="disc-desc">For persons with disability with a valid PWD ID, per ${esc(ds.pwd.law)}.</p><div class="vat-note">${icon('info')}<div><b>VAT-exempt.</b> Same computation as Senior: remove 12% VAT, then ${ds.pwd.rate}% off.</div></div>`)}
        </div>
        <section class="card flush">${cardHead('Discount usage', esc(r.label) + ' · completed orders only')}
          <div class="twrap"><table class="table"><thead><tr><th>Discount</th><th class="r">Orders</th><th class="r">Gross of discounted orders</th><th class="r">Discount given</th><th class="r">VAT exempted</th><th class="r">Total reduction</th></tr></thead><tbody>
          ${usage.map(u => `<tr><td>${badge(u.label, DISC_TONE[u.k], false)}</td><td class="r num">${fmt.num(u.n)}</td><td class="r num">${fmt.peso(u.gross)}</td><td class="r num">${fmt.peso(u.amt)}</td><td class="r num">${u.vat ? fmt.peso(u.vat) : '<span class="muted">—</span>'}</td><td class="r num strong">${fmt.peso(u.amt + u.vat)}</td></tr>`).join('')}
          <tr class="tr-total"><td>Total</td><td class="r num">${fmt.num(sum(usage, u => u.n))}</td><td class="r num">${fmt.peso(sum(usage, u => u.gross))}</td><td class="r num">${fmt.peso(sum(usage, u => u.amt))}</td><td class="r num">${fmt.peso(sum(usage, u => u.vat))}</td><td class="r num">${fmt.peso(sum(usage, u => u.amt + u.vat))}</td></tr>
          </tbody></table></div></section>`
    };
  };

  /* ---------- Settings ---------- */
  Pages.settings = () => {
    const s = S.data.settings, theme = ls('bp_theme') || 'system';
    const row = (title, desc, body) => `<div class="set-row"><div class="set-info"><h3>${title}</h3><p>${desc}</p></div><div class="set-body">${body}</div></div>`;
    return {
      html: head('Settings', 'Store profile, tax, appearance and data', '') + `<div class="settings">
        ${row('Store profile', 'Shown on receipts and reports.', `<form class="card set-form" data-form="profile">
          <div class="field-row"><label class="field"><span class="field-label">Business name</span><input class="input" name="shopName" value="${esc(s.shopName)}" maxlength="40"></label><label class="field"><span class="field-label">Store name</span><input class="input" name="storeName" value="${esc(s.storeName)}" maxlength="40"></label></div>
          <label class="field"><span class="field-label">Address</span><input class="input" name="address" value="${esc(s.address)}" maxlength="120"></label>
          <label class="field"><span class="field-label">Phone</span><input class="input" name="phone" value="${esc(s.phone)}" maxlength="20"></label>
          <div class="set-actions"><button class="btn btn-primary" type="submit">Save profile</button></div></form>`)}
        ${row('Tax &amp; receipts', 'VAT applies to all non-exempt sales.', `<form class="card set-form" data-form="tax">
          <div class="field-row"><label class="field"><span class="field-label">VAT rate</span><span class="input-affix suffix"><input class="input" type="number" name="vat" value="${esc(s.vat)}" min="0" max="30" step="0.5"><span>%</span></span></label>
          <div class="field"><span class="field-label">Menu prices</span><label class="switch-row"><span class="switch"><input type="checkbox" name="pricesIncludeVat" ${s.pricesIncludeVat ? 'checked' : ''}><span></span></span><span class="switch-label">Include VAT</span></label></div></div>
          <label class="field"><span class="field-label">Receipt footer</span><input class="input" name="receiptFooter" value="${esc(s.receiptFooter)}" maxlength="80"></label>
          <div class="set-actions"><button class="btn btn-primary" type="submit">Save tax settings</button></div></form>`)}
        ${row('Regional', 'Fixed for the Philippines.', `<div class="card set-form"><dl class="kv"><div><dt>Time zone</dt><dd>Asia/Manila (UTC+8)</dd></div><div><dt>Currency</dt><dd>Philippine peso (₱, PHP)</dd></div><div><dt>Business hours</dt><dd>10:00 AM – 10:00 PM</dd></div></dl></div>`)}
        ${row('Appearance', 'How the dashboard looks on this device.', `<div class="card set-form"><div class="radio-cards three" id="theme-pick">${[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'settings']].map(([k, l, ic]) => `<label><input type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}><span>${icon(ic)}<b>${l}</b></span></label>`).join('')}</div></div>`)}
        ${row('Data connection', 'Where this dashboard reads from.', `<div class="card set-form"><div class="conn"><span class="feed-ic lg amber">${icon('database')}</span><div class="dd-grow"><div class="conn-title"><b>Firebase</b>${badge('Not connected', 'amber')}</div><p class="muted">Real sign-in and live shop data come with Firebase (Auth + Firestore). Until then, everything here is sample data stored only in this browser.</p></div></div></div>`)}
        ${row('Danger zone', 'These actions can’t be undone.', `<div class="card set-form danger-zone"><div class="dz-row"><div><b>Reset sample data</b><p class="muted">Restore menu, prices, stock and discounts to the defaults and clear admin changes.</p></div><button class="btn btn-danger-outline" data-act="reset">${icon('refresh')}Reset data</button></div><div class="dz-row"><div><b>Sign out</b><p class="muted">End the demo session in this browser.</p></div><button class="btn btn-secondary" data-act="signout">${icon('logout')}Sign out</button></div></div>`)}
      </div>`,
      mount() {
        document.querySelectorAll('[data-form]').forEach(f => f.addEventListener('submit', async e => {
          e.preventDefault();
          const patch = {};
          Array.from(f.elements).forEach(el => { if (el.name) patch[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim(); });
          if (patch.storeName === '' || patch.shopName === '') { toast('Name can’t be empty', { type: 'error' }); return; }
          await D.saveSettings(patch); await refresh(); toast('Settings saved');
        }));
        document.getElementById('theme-pick').addEventListener('change', e => setTheme(e.target.value));
      }
    };
  };

  /* ---------- Theme ---------- */
  function applyTheme() {
    const pref = ls('bp_theme') || 'system';
    const dark = pref === 'dark' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  function setTheme(v) { ls('bp_theme', v); applyTheme(); updateThemeIcon(); if (S.session && S.data) renderPage(); }
  function updateThemeIcon() { const dark = document.documentElement.dataset.theme === 'dark'; document.querySelectorAll('.theme-ic').forEach(el => { el.innerHTML = icon(dark ? 'sun' : 'moon'); }); }

  /* ---------- Global search ---------- */
  function searchResults(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    const out = [];
    Object.entries(TITLES).forEach(([k, v]) => { if (v.toLowerCase().includes(q)) out.push({ group: 'Pages', label: v, ic: 'chevronRight', go: () => { location.hash = '#/' + k; } }); });
    S.data.menu.filter(m => (m.name + ' ' + m.sku).toLowerCase().includes(q)).slice(0, 4).forEach(m => out.push({ group: 'Menu', label: m.name, sub: fmt.peso(m.price), ic: 'utensils', go: () => { location.hash = '#/menu'; setTimeout(() => menuModal(m), 60); } }));
    S.data.stock.filter(s => s.name.toLowerCase().includes(q)).slice(0, 4).forEach(s => out.push({ group: 'Ingredients', label: s.name, sub: fmt.qty(s.qty) + ' ' + s.unit, ic: 'package', go: () => { location.hash = '#/stock'; setTimeout(() => stockModal(s), 60); } }));
    const qn = q.replace(/^#/, '');
    if (/\d{3}/.test(qn)) S.data.orders.filter(o => o.no.includes(qn)).slice(-4).reverse().forEach(o => out.push({ group: 'Orders', label: '#' + o.no, sub: fmt.dateTime(o.t) + ' · ' + fmt.peso(o.net), ic: 'receipt', go: () => orderModal(o) }));
    return out.slice(0, 12);
  }
  function bindSearch() {
    const input = document.getElementById('gsearch-input'), box = document.getElementById('gsearch-results');
    let res = [], sel = 0;
    const draw = () => {
      if (!input.value.trim()) { box.hidden = true; return; }
      box.hidden = false;
      if (!res.length) { box.innerHTML = '<div class="dd-empty">No matches for “' + esc(input.value) + '”</div>'; return; }
      let g = '';
      box.innerHTML = res.map((x, i) => { const h = x.group !== g ? '<div class="dd-label">' + x.group + '</div>' : ''; g = x.group; return h + `<button class="dd-item ${i === sel ? 'sel' : ''}" data-i="${i}">${icon(x.ic)}<span class="dd-grow">${esc(x.label)}</span>${x.sub ? `<span class="dd-hint">${esc(x.sub)}</span>` : ''}</button>`; }).join('');
    };
    const pickRes = i => { const x = res[i]; input.value = ''; box.hidden = true; input.blur(); if (x) x.go(); };
    input.addEventListener('input', () => { res = searchResults(input.value); sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(res.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); pickRes(sel); }
      else if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
    });
    box.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (!b) return; e.preventDefault(); pickRes(+b.dataset.i); });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
    input.addEventListener('focus', () => { if (input.value.trim()) draw(); });
  }

  /* ---------- Router ---------- */
  async function loadData() {
    const now = Date.now(), from = dayStart(now) - 59 * DAY;
    const [menu, stock, discounts, settings, orders, activity] = await Promise.all([D.getMenu(), D.getStock(), D.getDiscounts(), D.getSettings(), D.getOrders({ from, to: now }), D.getActivity({ from, to: now })]);
    S.data = { menu, stock, discounts, settings, orders, activity };
  }
  async function refresh() { await loadData(); renderPage(); }
  function currentPage() { const p = (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0]; return Pages[p] ? p : 'overview'; }
  function renderPage() {
    const page = currentPage();
    destroyCharts(); chartDefaults();
    updateChrome(page);
    const v = Pages[page]();
    const content = document.getElementById('content');
    content.innerHTML = v.html;
    content.dataset.page = page;
    if (v.mount) v.mount();
    document.title = TITLES[page] + ' · BorgerrrPOS Admin';
  }
  async function route() {
    applyTheme();
    if (!S.session) { renderLogin(); return; }
    if (!document.querySelector('.shell')) { renderShell(); bindSearch(); }
    if (!S.data) await loadData();
    const prev = document.getElementById('content').dataset.page;
    renderPage();
    document.body.classList.remove('nav-open');
    if (prev && prev !== currentPage()) window.scrollTo(0, 0);
  }

  /* ---------- Global events ---------- */
  function closeMenus(except) { document.querySelectorAll('.dd-menu[data-menu]').forEach(m => { if (m !== except) m.hidden = true; }); }
  function exportActivity() { const list = S.activityView || []; downloadCSV('borgerrr-activity-' + S.range + '-' + stamp() + '.csv', [['Date (PHT)', 'Time (PHT)', 'Type', 'Event', 'Detail', 'Staff', 'Amount (PHP)']].concat(list.map(x => [fmt.dateY(x.t), fmt.time(x.t), x.type, x.title, x.detail, x.staff, x.amount == null ? '' : x.amount.toFixed(2)]))); toast('Export ready', { desc: fmt.num(list.length) + ' events downloaded as CSV' }); }
  function exportMargins() { const rows = S.marginRows || []; downloadCSV('borgerrr-item-margins-' + S.range + '-' + stamp() + '.csv', [['SKU', 'Item', 'Category', 'Price (PHP)', 'Unit cost (PHP)', 'Unit margin (PHP)', 'Margin %', 'Qty sold', 'Sales (PHP)', 'Profit (PHP)']].concat(rows.map(x => [x.sku, x.name, x.category, x.price.toFixed(2), x.cost.toFixed(2), x.unitMargin.toFixed(2), x.marginPct.toFixed(1), x.qty, x.rev.toFixed(2), x.profit.toFixed(2)]))); toast('Export ready', { desc: rows.length + ' items downloaded as CSV' }); }
  function exportDaily() {
    const { r, cur } = ctx(); const b = buckets(r);
    downloadCSV('borgerrr-sales-summary-' + S.range + '-' + stamp() + '.csv', [[r.bucket === 'hour' ? 'Hour (PHT)' : 'Date (PHT)', 'Orders', 'Gross sales (PHP)', 'Discounts (PHP)', 'VAT exempt (PHP)', 'Net sales (PHP)', 'COGS (PHP)', 'Gross profit (PHP)', 'Voids']].concat(b.map(x => { const m = metrics(cur.filter(x.test)); return [x.label, m.orders, m.gross.toFixed(2), m.disc.toFixed(2), m.vatEx.toFixed(2), m.net.toFixed(2), m.cogs.toFixed(2), m.profit.toFixed(2), m.voids]; })));
    toast('Export ready', { desc: 'Sales summary downloaded as CSV' });
  }
  document.addEventListener('click', async e => {
    const dd = e.target.closest('[data-dd]');
    if (dd) { const m = dd.parentElement.querySelector('[data-menu="' + dd.dataset.dd + '"]'); closeMenus(m); m.hidden = !m.hidden; return; }
    if (!e.target.closest('.dd-menu')) closeMenus();
    else if (e.target.closest('a,button.dd-item')) closeMenus();
    const rb = e.target.closest('[data-range]');
    if (rb) { S.range = rb.dataset.range; ls('bp_range', S.range); renderPage(); return; }
    const a = e.target.closest('[data-act]'); if (!a || a.closest('tbody')) return;
    const act = a.dataset.act;
    if (act === 'nav-open') document.body.classList.add('nav-open');
    else if (act === 'nav-close') document.body.classList.remove('nav-open');
    else if (act === 'collapse') { S.collapsed = !S.collapsed; ls('bp_sidebar', S.collapsed ? '1' : '0'); document.querySelector('.shell').classList.toggle('collapsed', S.collapsed); setTimeout(() => S.charts.forEach(c => c.resize()), 220); }
    else if (act === 'theme') setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    else if (act === 'signout') { await D.signOut(); S.session = null; S.data = null; closeModal(); history.replaceState(null, '', '#/login'); renderLogin(); }
    else if (act === 'export-orders') { const { cur } = ctx(); exportOrders(cur, S.range + '-' + stamp()); }
    else if (act === 'export-activity') exportActivity();
    else if (act === 'export-margins') exportMargins();
    else if (act === 'export-daily') exportDaily();
    else if (act === 'add-item') menuModal(null);
    else if (act === 'adjust' && a.dataset.id) stockModal(S.data.stock.find(s => s.id === +a.dataset.id));
    else if (act === 'edit-disc') discountModal(S.data.discounts[a.dataset.key]);
    else if (act === 'reset') modal({ title: 'Reset sample data?', icon: 'alert', danger: true, desc: 'Menu, prices, stock, discounts, settings and admin changes go back to the defaults.', submit: 'Reset data', onSubmit: async () => { await D.reset(); await refresh(); toast('Sample data reset'); } });
  });
  document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag) && document.getElementById('gsearch-input')) { e.preventDefault(); document.getElementById('gsearch-input').focus(); }
    if (e.key === 'Escape') { closeMenus(); document.body.classList.remove('nav-open'); }
  });
  window.addEventListener('hashchange', route);
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((ls('bp_theme') || 'system') === 'system') { applyTheme(); updateThemeIcon(); if (S.session && S.data) renderPage(); } });
  setInterval(() => { if (S.session && S.data && !document.querySelector('.modal-backdrop') && !document.querySelector('.dd-menu:not([hidden])') && !(document.activeElement && document.activeElement.matches('input,select,textarea'))) refresh(); }, 120e3);

  window.BorgerrrAdmin = { version: APP_VERSION };
  (async () => { S.session = await D.getSession(); route(); })();
})();
