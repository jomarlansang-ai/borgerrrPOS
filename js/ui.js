/* Shared UI helpers: formatting, toasts, modal, data table, sparkline. */
(function () {
  'use strict';
  const TZ = 'Asia/Manila';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf2 = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 });
  const fTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const fDate = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  const fDateY = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
  const fWeek = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  const fLong = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmt = {
    peso: n => (n < 0 ? '−' : '') + '₱' + nf2.format(Math.abs(n)),
    peso0: n => (n < 0 ? '−' : '') + '₱' + nf0.format(Math.abs(Math.round(n))),
    pesoShort: n => { const a = Math.abs(n); return (n < 0 ? '−' : '') + '₱' + (a >= 1e6 ? nf2.format(a / 1e6) + 'M' : a >= 1e4 ? nf1.format(a / 1e3) + 'k' : nf0.format(a)); },
    num: n => nf0.format(n),
    qty: n => nf1.format(n),
    pct: (n, d) => (n == null || !isFinite(n)) ? '—' : n.toFixed(d == null ? 1 : d) + '%',
    time: t => fTime.format(t),
    date: t => fDate.format(t),
    dateY: t => fDateY.format(t),
    week: t => fWeek.format(t),
    long: t => fLong.format(t),
    dateTime: t => fDate.format(t) + ', ' + fTime.format(t),
    rel: t => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : d + 'd ago'; }
  };

  /* ---------- Toasts ---------- */
  function toast(title, opts) {
    opts = opts || {};
    const type = opts.type || 'success';
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span class="toast-ic">' + icon(type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info') + '</span><div class="toast-body"><div class="toast-title">' + esc(title) + '</div>' + (opts.desc ? '<div class="toast-desc">' + esc(opts.desc) + '</div>' : '') + '</div><button class="toast-x" aria-label="Dismiss">' + icon('x') + '</button>';
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const kill = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 220); };
    el.querySelector('button').onclick = kill;
    setTimeout(kill, opts.ms || 3800);
  }

  /* ---------- Modal ---------- */
  function closeModal() {
    const root = document.getElementById('modal-root');
    const b = root.querySelector('.modal-backdrop');
    if (!b) return;
    b.classList.remove('in');
    document.removeEventListener('keydown', root._esc);
    setTimeout(() => { root.innerHTML = ''; }, 160);
    if (root._return && root._return.focus) root._return.focus();
  }
  function modal(o) {
    const root = document.getElementById('modal-root');
    root._return = document.activeElement;
    root.innerHTML = '<div class="modal-backdrop"><form class="modal ' + (o.size || '') + '" role="dialog" aria-modal="true" aria-labelledby="m-title" novalidate>' +
      '<div class="modal-head"><div>' + (o.icon ? '<span class="modal-ic ' + (o.danger ? 'danger' : '') + '">' + icon(o.icon) + '</span>' : '') + '<h2 id="m-title">' + esc(o.title) + '</h2>' + (o.desc ? '<p>' + o.desc + '</p>' : '') + '</div><button type="button" class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div>' +
      '<div class="modal-body">' + (o.body || '') + '<div class="form-error" hidden></div></div>' +
      '<div class="modal-foot">' + (o.footNote ? '<span class="foot-note">' + o.footNote + '</span>' : '') + '<button type="button" class="btn btn-secondary" data-close>' + esc(o.cancel || 'Cancel') + '</button>' + (o.onSubmit ? '<button type="submit" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '">' + esc(o.submit || 'Save changes') + '</button>' : '') + '</div></form></div>';
    const back = root.querySelector('.modal-backdrop'), form = root.querySelector('form'), err = root.querySelector('.form-error');
    requestAnimationFrame(() => back.classList.add('in'));
    back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
    root.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    root._esc = e => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', root._esc);
    form.onsubmit = async e => {
      e.preventDefault();
      if (!o.onSubmit) return;
      const data = {};
      Array.from(form.elements).forEach(el => { if (!el.name) return; if (el.type === 'checkbox') data[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; } else data[el.name] = el.value; });
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { const r = await o.onSubmit(data, form); if (r !== false) closeModal(); }
      catch (ex) { err.hidden = false; err.textContent = ex.message || String(ex); }
      finally { btn.disabled = false; }
    };
    if (o.onMount) o.onMount(form);
    const first = form.querySelector('input:not([type=hidden]):not([disabled]),select,textarea');
    setTimeout(() => (first || form.querySelector('[type=submit]') || form).focus(), 30);
    return form;
  }

  /* ---------- Data table: sort, search, filter chips, pagination ---------- */
  const TS = {};
  function pager(p, n) {
    const out = [];
    const btn = (label, page, dis, on, aria) => '<button type="button" class="pg ' + (on ? 'on' : '') + '" ' + (dis ? 'disabled' : 'data-p="' + page + '"') + (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';
    out.push(btn(icon('chevronLeft'), p - 1, p <= 1, false, 'Previous page'));
    const set = new Set([1, n, p - 1, p, p + 1].filter(x => x >= 1 && x <= n));
    let last = 0;
    [...set].sort((a, b) => a - b).forEach(x => { if (x - last > 1) out.push('<span class="pg-gap">…</span>'); out.push(btn(x, x, false, x === p)); last = x; });
    out.push(btn(icon('chevronRight'), p + 1, p >= n, false, 'Next page'));
    return out.join('');
  }
  function DataTable(el, o) {
    const st = TS[o.id] || (TS[o.id] = { q: '', page: 1, sort: o.sort || null, filter: o.filters ? o.filters[0].key : null });
    const ps = o.pageSize || 10;
    const chips = o.filters ? '<div class="chips" role="group" aria-label="Filter">' + o.filters.map(f => '<button type="button" class="chip" data-f="' + f.key + '">' + esc(f.label) + ' <span class="chip-count"></span></button>').join('') + '</div>' : '';
    el.innerHTML = '<div class="tcard">' +
      '<div class="ttool"><div class="ttool-l"><label class="tsearch">' + icon('search') + '<input type="search" placeholder="' + esc(o.placeholder || 'Search…') + '" value="' + esc(st.q) + '" aria-label="Search table"></label>' + chips + '</div><div class="ttool-r">' + (o.toolbar || '') + '</div></div>' +
      '<div class="twrap"><table class="table"><thead><tr>' + o.columns.map((c, i) => '<th data-i="' + i + '" class="' + (c.align === 'right' ? 'r ' : '') + (c.sortable === false ? '' : 'sortable') + '"' + (c.width ? ' style="width:' + c.width + '"' : '') + '>' + (c.sortable === false ? esc(c.label) : '<button type="button" class="th-btn">' + esc(c.label) + '<span class="sort-ind"></span></button>') + '</th>').join('') + '</tr></thead><tbody></tbody></table></div>' +
      '<div class="tfoot"></div></div>';
    const tbody = el.querySelector('tbody'), foot = el.querySelector('.tfoot'), input = el.querySelector('.tsearch input');
    let view = [], slice = [];
    function apply() {
      let r = o.rows;
      const f = o.filters && o.filters.find(x => x.key === st.filter);
      if (f && f.test) r = r.filter(f.test);
      const q = st.q.trim().toLowerCase();
      if (q) r = r.filter(x => o.search(x).toLowerCase().includes(q));
      if (st.sort) {
        const c = o.columns.find(c => c.key === st.sort.key);
        if (c) { const v = c.value || (x => x[c.key]); const d = st.sort.dir === 'asc' ? 1 : -1; r = r.slice().sort((a, b) => { const A = v(a), B = v(b); return (typeof A === 'string' ? A.localeCompare(B) : (A > B ? 1 : A < B ? -1 : 0)) * d; }); }
      }
      return r;
    }
    function update() {
      view = apply();
      const pages = Math.max(1, Math.ceil(view.length / ps));
      st.page = Math.min(Math.max(1, st.page), pages);
      slice = view.slice((st.page - 1) * ps, st.page * ps);
      tbody.innerHTML = slice.length ? slice.map((row, i) => '<tr data-i="' + i + '" class="' + (o.onRow ? 'clickable' : '') + '">' + o.columns.map(c => '<td class="' + (c.align === 'right' ? 'r ' : '') + (c.cls || '') + '">' + (c.render ? c.render(row) : esc(row[c.key])) + '</td>').join('') + '</tr>').join('')
        : '<tr class="empty-row"><td colspan="' + o.columns.length + '"><div class="empty">' + icon('search') + '<div class="empty-title">No results</div><div class="empty-sub">Try a different search term or filter.</div></div></td></tr>';
      el.querySelectorAll('th').forEach(th => {
        const c = o.columns[+th.dataset.i]; const on = st.sort && st.sort.key === c.key;
        th.setAttribute('aria-sort', on ? (st.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        th.classList.toggle('sorted', !!on);
        const ind = th.querySelector('.sort-ind'); if (ind) ind.innerHTML = icon(on ? (st.sort.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'chevronsUpDown');
      });
      if (o.filters) el.querySelectorAll('.chip').forEach(b => { const f = o.filters.find(x => x.key === b.dataset.f); b.classList.toggle('on', f.key === st.filter); b.setAttribute('aria-pressed', f.key === st.filter); b.querySelector('.chip-count').textContent = fmt.num(f.test ? o.rows.filter(f.test).length : o.rows.length); });
      const a = view.length ? (st.page - 1) * ps + 1 : 0, b = Math.min(st.page * ps, view.length);
      foot.innerHTML = '<div class="tfoot-info">Showing <b>' + fmt.num(a) + '–' + fmt.num(b) + '</b> of <b>' + fmt.num(view.length) + '</b> ' + esc(o.noun || 'rows') + '</div><div class="pager">' + pager(st.page, pages) + '</div>';
    }
    input.addEventListener('input', () => { st.q = input.value; st.page = 1; update(); });
    el.querySelector('thead').addEventListener('click', e => {
      const th = e.target.closest('th.sortable'); if (!th) return;
      const c = o.columns[+th.dataset.i];
      st.sort = st.sort && st.sort.key === c.key ? { key: c.key, dir: st.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.dir || (typeof (c.value || (x => x[c.key]))(o.rows[0] || {}) === 'string' ? 'asc' : 'desc') };
      st.page = 1; update();
    });
    if (o.filters) el.querySelector('.chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; st.filter = b.dataset.f; st.page = 1; update(); });
    foot.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; st.page = +b.dataset.p; update(); el.querySelector('.tcard').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
    tbody.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const row = slice[+tr.dataset.i];
      const act = e.target.closest('[data-act]');
      if (act && o.onAction) { e.stopPropagation(); o.onAction(act.dataset.act, row, act); return; }
      if (o.onRow) o.onRow(row);
    });
    update();
    return { update, view: () => view, state: st };
  }

  /* ---------- Sparkline (hand-rolled SVG) ---------- */
  let sid = 0;
  function sparkline(vals, opts) {
    opts = opts || {};
    const w = opts.w || 120, h = opts.h || 36, color = opts.color || 'var(--brand)';
    if (!vals.length) vals = [0, 0];
    if (vals.length === 1) vals = [vals[0], vals[0]];
    const max = Math.max(...vals), min = Math.min(...vals), span = max - min || 1;
    const pts = vals.map((v, i) => [i / (vals.length - 1) * w, h - 3 - (v - min) / span * (h - 6)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const id = 'sg' + (++sid);
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" width="100%" height="' + h + '" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".22"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs><path d="' + line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="url(#' + id + ')"/><path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  function downloadCSV(name, rows) {
    const csv = rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.UI = { esc, fmt, toast, modal, closeModal, DataTable, sparkline, downloadCSV };
})();
