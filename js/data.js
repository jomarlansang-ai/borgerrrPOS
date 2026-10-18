/*
 * BorgerrrPOS — DataStore (sample implementation)
 * ------------------------------------------------
 * Every read and write the dashboard makes goes through window.DataStore.
 * All methods are async and return plain objects, so a Firebase
 * (Auth + Firestore) implementation can replace this file later with the
 * same method names. Nothing else in the app touches storage.
 *
 * SAMPLE DATA ONLY. No API keys, no secrets, nothing from the real shop.
 * Orders are generated deterministically per calendar day (Asia/Manila),
 * edits are saved to this browser's localStorage.
 */
(function () {
  'use strict';
  const HOUR = 3600e3, DAY = 24 * HOUR, OFFSET = 8 * HOUR; // Asia/Manila is UTC+8, no DST
  const STORE_KEY = 'borgerrr_admin_v2';
  const SESSION_KEY = 'borgerrr_session_v2';
  const HISTORY_DAYS = 60; // 30 days visible + 30 days for "vs previous period" comparisons

  const dayStart = t => Math.floor((t + OFFSET) / DAY) * DAY - OFFSET;
  const dayIndex = t => Math.floor((t + OFFSET) / DAY);
  const manilaParts = t => { const d = new Date(t + OFFSET); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours() }; };
  const pad = n => String(n).padStart(2, '0');
  const round2 = n => Math.round(n * 100) / 100;
  const clone = o => JSON.parse(JSON.stringify(o));

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const pick = (r, list, wkey) => {
    const total = list.reduce((a, x) => a + (wkey ? x[wkey] : x[1]), 0);
    let v = r() * total;
    for (const x of list) { v -= wkey ? x[wkey] : x[1]; if (v <= 0) return wkey ? x : x[0]; }
    return wkey ? list[list.length - 1] : list[list.length - 1][0];
  };

  /* ---------- Seed catalogue ---------- */
  const SEED = {
    menu: [
      { id: 1, sku: 'BRG-001', name: 'Classic Borgerrr', category: 'Burgers', price: 129, cost: 48, active: true, w: 10 },
      { id: 2, sku: 'BRG-002', name: 'Cheesy Borgerrr', category: 'Burgers', price: 149, cost: 56, active: true, w: 12 },
      { id: 3, sku: 'BRG-003', name: 'Double Patty Borgerrr', category: 'Burgers', price: 219, cost: 92, active: true, w: 7 },
      { id: 4, sku: 'BRG-004', name: 'Bacon Overload', category: 'Burgers', price: 239, cost: 104, active: true, w: 5 },
      { id: 5, sku: 'BRG-005', name: 'Sisig Smash Burger', category: 'Burgers', price: 189, cost: 76, active: true, w: 6 },
      { id: 6, sku: 'BRG-006', name: 'Chicken Inasal Burger', category: 'Burgers', price: 169, cost: 64, active: true, w: 6 },
      { id: 7, sku: 'BRG-007', name: 'Tapa Silog Burger', category: 'Burgers', price: 199, cost: 84, active: true, w: 4 },
      { id: 8, sku: 'BRG-008', name: 'Mushroom Swiss', category: 'Burgers', price: 199, cost: 86, active: true, w: 3 },
      { id: 9, sku: 'CMB-001', name: 'Borgerrr Meal (Classic + Fries + Iced Tea)', category: 'Combos', price: 209, cost: 78, active: true, w: 8 },
      { id: 10, sku: 'CMB-002', name: 'Barkada Bucket (4 burgers + 2 large fries)', category: 'Combos', price: 799, cost: 330, active: true, w: 1.2 },
      { id: 11, sku: 'SID-001', name: 'Fries (Regular)', category: 'Sides', price: 59, cost: 16, active: true, w: 9 },
      { id: 12, sku: 'SID-002', name: 'Fries (Large)', category: 'Sides', price: 89, cost: 24, active: true, w: 5 },
      { id: 13, sku: 'SID-003', name: 'Cheesy Bacon Fries', category: 'Sides', price: 119, cost: 42, active: true, w: 4 },
      { id: 14, sku: 'SID-004', name: 'Onion Rings', category: 'Sides', price: 89, cost: 28, active: true, w: 3 },
      { id: 15, sku: 'SID-005', name: 'Kamote Fries', category: 'Sides', price: 79, cost: 22, active: true, w: 3 },
      { id: 16, sku: 'DRK-001', name: 'House Iced Tea', category: 'Drinks', price: 45, cost: 8, active: true, w: 9 },
      { id: 17, sku: 'DRK-002', name: 'Calamansi Juice', category: 'Drinks', price: 55, cost: 12, active: true, w: 4 },
      { id: 18, sku: 'DRK-003', name: 'Coke Mismo', category: 'Drinks', price: 35, cost: 19, active: true, w: 6 },
      { id: 19, sku: 'DRK-004', name: 'Mango Shake', category: 'Drinks', price: 99, cost: 34, active: true, w: 4 },
      { id: 20, sku: 'DST-001', name: 'Leche Flan Sundae', category: 'Desserts', price: 79, cost: 26, active: true, w: 3 },
      { id: 21, sku: 'DST-002', name: 'Turon a la Mode', category: 'Desserts', price: 69, cost: 21, active: true, w: 2 },
      { id: 22, sku: 'DST-003', name: 'Halo-Halo Float', category: 'Desserts', price: 89, cost: 30, active: false, w: 2 }
    ],
    stock: [
      [1, 'Burger buns', 'Bakery', 'pcs', 186, 120, 9, 'Pan de Manila Wholesale'],
      [2, 'Beef patties (120 g)', 'Meat', 'pcs', 64, 150, 38, 'Monterey Meatshop'],
      [3, 'Chicken thigh fillet', 'Meat', 'pcs', 58, 40, 32, 'Magnolia'],
      [4, 'Bacon strips', 'Meat', 'pcs', 140, 80, 7, 'Purefoods'],
      [5, 'Cheddar slices', 'Dairy', 'pcs', 210, 100, 5, 'Magnolia'],
      [6, 'Pork sisig mix', 'Meat', 'kg', 3.5, 4, 320, 'Monterey Meatshop'],
      [7, 'Beef tapa', 'Meat', 'kg', 6, 3, 420, 'Monterey Meatshop'],
      [8, 'Lettuce', 'Produce', 'kg', 2.8, 2, 160, 'Benguet Fresh'],
      [9, 'Tomatoes', 'Produce', 'kg', 4, 3, 90, 'Benguet Fresh'],
      [10, 'White onions', 'Produce', 'kg', 5, 3, 140, 'Benguet Fresh'],
      [11, 'Potatoes (fries cut)', 'Frozen', 'kg', 9, 15, 120, 'Lamb Weston PH'],
      [12, 'Kamote', 'Produce', 'kg', 6, 5, 70, 'Benguet Fresh'],
      [13, 'Cooking oil', 'Pantry', 'L', 18, 10, 95, 'Minola Distributor'],
      [14, 'Iced tea concentrate', 'Beverage', 'L', 7, 4, 180, 'Nestea Foodservice'],
      [15, 'Calamansi', 'Produce', 'kg', 0.8, 2, 120, 'Benguet Fresh'],
      [16, 'Ripe mangoes', 'Produce', 'kg', 6, 4, 150, 'Guimaras Direct'],
      [17, 'Coke Mismo (290 ml)', 'Beverage', 'bottles', 96, 48, 18, 'Coca-Cola Beverages PH'],
      [18, 'House burger sauce', 'Pantry', 'L', 4.5, 3, 210, 'In-house'],
      [19, 'Take-out boxes', 'Packaging', 'pcs', 140, 200, 6, 'Pack & Go Supply'],
      [20, 'Paper cups (16 oz)', 'Packaging', 'pcs', 0, 150, 4, 'Pack & Go Supply'],
      [21, 'Leche flan', 'Dessert', 'pcs', 24, 12, 22, 'Tita Baby\u2019s Kitchen'],
      [22, 'Vanilla ice cream', 'Dessert', 'L', 5, 4, 260, 'Selecta Foodservice']
    ].map(([id, name, category, unit, qty, min, unitCost, supplier], i) => ({ id, name, category, unit, qty, min, unitCost, supplier, updatedAgoMin: 35 + i * 97 % 2800 })),
    discounts: {
      promo: { key: 'promo', label: 'Promo', rate: 10, code: 'BORGERRR10', vatExempt: false, active: true },
      senior: { key: 'senior', label: 'Senior Citizen', rate: 20, vatExempt: true, active: true, law: 'RA 9994' },
      pwd: { key: 'pwd', label: 'PWD', rate: 20, vatExempt: true, active: true, law: 'RA 10754' }
    },
    settings: {
      shopName: 'Borgerrr', storeName: 'Borgerrr - Main',
      address: '88 Maginhawa St., Teachers Village East, Quezon City',
      phone: '+63 917 000 0000', vat: 12, pricesIncludeVat: true,
      receiptFooter: 'Salamat, Borgerrr lover! Balik ka ha.',
      timezone: 'Asia/Manila', currency: 'PHP'
    }
  };

  const STAFF_AM = ['Aira M.', 'Paolo R.'], STAFF_PM = ['Jessa L.', 'Mark D.'];
  const HOURS = [[10, .45], [11, 1.0], [12, 1.85], [13, 1.35], [14, .6], [15, .5], [16, .7], [17, 1.05], [18, 1.6], [19, 1.75], [20, 1.25], [21, .7]];
  const TYPES = [['Dine-in', 45], ['Take-out', 30], ['GrabFood', 15], ['foodpanda', 10]];
  const PAYMENTS = [['Cash', 46], ['GCash', 31], ['Maya', 11], ['Card', 12]];
  const VOID_REASONS = ['Customer cancelled', 'Wrong order punched', 'Duplicate entry', 'Payment failed', 'Item unavailable'];
  const ITEM_VOID_REASONS = ['customer changed order', 'wrong item punched', 'out of stock'];

  /* ---------- Persistence of edits (browser only) ---------- */
  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  let ov = loadOverrides();
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(ov)); } catch (e) { /* storage full or blocked */ } };
  const menu = () => ov.menu || clone(SEED.menu);
  const stock = () => ov.stock || SEED.stock.map(s => ({ ...s, updatedAt: Date.now() - s.updatedAgoMin * 60e3 }));
  const discounts = () => ov.discounts || clone(SEED.discounts);
  const settings = () => ({ ...SEED.settings, ...(ov.settings || {}) });

  function adminLog(title, detail, amount) {
    ov.adminLog = ov.adminLog || [];
    ov.adminLog.unshift({ id: 'adm-' + Date.now() + '-' + Math.floor(Math.random() * 1e4), t: Date.now(), type: 'admin', title, detail: detail || '', staff: 'Demo Admin', amount: amount == null ? null : amount });
    ov.adminLog = ov.adminLog.slice(0, 300);
  }

  /* ---------- Deterministic order history ---------- */
  let cache = null;
  function generate() {
    const now = Date.now();
    const today = dayStart(now);
    const items = SEED.menu.filter(m => m.active);
    const byCat = c => items.filter(m => m.category === c);
    const cats = { Burgers: byCat('Burgers'), Combos: byCat('Combos'), Sides: byCat('Sides'), Drinks: byCat('Drinks'), Desserts: byCat('Desserts') };
    const orders = [], events = [];
    for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
      const start = today - d * DAY, idx = dayIndex(start), p = manilaParts(start);
      const r = rng(idx * 7919 + 17);
      const weekend = { 5: 1.22, 6: 1.42, 0: 1.33 }[p.dow] || 1;
      const payday = (p.d === 15 || p.d === 30 || p.d === 31 || p.d === 1) ? 1.18 : 1;
      const trend = 1 + (HISTORY_DAYS - d) * 0.0035;
      const volume = 74 * weekend * payday * trend * (0.88 + r() * 0.24);
      const sumW = HOURS.reduce((a, h) => a + h[1], 0);
      const mmdd = pad(p.m) + pad(p.d);
      let seq = 0;
      const dayOrders = [];
      for (const [h, w] of HOURS) {
        const n = Math.max(0, Math.round(volume * w / sumW + (r() - 0.5) * 3));
        for (let k = 0; k < n; k++) dayOrders.push(start + h * HOUR + Math.floor(r() * HOUR));
      }
      dayOrders.sort((a, b) => a - b);
      // shift + cash events
      const lead = STAFF_AM[idx % 2], closer = STAFF_PM[idx % 2];
      const ev = (t, type, title, detail, staff, amount, ref) => { if (t <= now) events.push({ id: 'e' + idx + '-' + events.length, t, type, title, detail, staff, amount, ref }); };
      ev(start + 9 * HOUR + 42 * 60e3, 'admin', 'Shift opened', 'Starting cash fund ₱3,000.00 · Register 1', lead, null);
      ev(start + 15 * HOUR + 5 * 60e3, 'admin', 'Cash drop recorded', 'Moved to safe · counted by ' + lead, lead, 10000);
      ev(start + 16 * HOUR, 'admin', 'Shift handover', lead + ' → ' + closer + ' · drawer counted', closer, null);
      if (idx % 3 === 0) ev(start + 9 * HOUR + 20 * 60e3, 'admin', 'Stock received', 'Beef patties +200 pcs, Burger buns +240 pcs · Monterey Meatshop', lead, null);
      if (idx % 4 === 1) ev(start + 9 * HOUR + 25 * 60e3, 'admin', 'Stock received', 'Potatoes (fries cut) +20 kg · Lamb Weston PH', lead, null);
      if (idx % 7 === 2) ev(start + 14 * HOUR + 40 * 60e3, 'admin', 'Wastage recorded', 'Lettuce −0.6 kg (wilted) · end-of-lunch check', lead, null);

      for (const t of dayOrders) {
        if (t > now) continue;
        seq++;
        const hour = Math.floor((t - start) / HOUR);
        const staff = hour < 16 ? lead : closer;
        const type = pick(r, TYPES);
        const delivery = type === 'GrabFood' || type === 'foodpanda';
        const payment = delivery ? 'Online' : pick(r, PAYMENTS);
        const lineCount = pick(r, [[1, 40], [2, 35], [3, 18], [4, 7]]);
        const lines = [];
        for (let i = 0; i < lineCount; i++) {
          const cat = i === 0 ? pick(r, [['Burgers', 78], ['Combos', 22]]) : i === 1 ? pick(r, [['Sides', 58], ['Drinks', 34], ['Burgers', 8]]) : i === 2 ? pick(r, [['Drinks', 66], ['Desserts', 34]]) : pick(r, [['Desserts', 50], ['Sides', 50]]);
          const m = pick(r, cats[cat], 'w');
          const qty = pick(r, [[1, 80], [2, 16], [3, 4]]);
          const ex = lines.find(l => l.itemId === m.id);
          if (ex) ex.qty += qty; else lines.push({ itemId: m.id, name: m.name, category: m.category, qty, price: m.price, cost: m.cost });
        }
        const gross = lines.reduce((a, l) => a + l.qty * l.price, 0);
        const cost = lines.reduce((a, l) => a + l.qty * l.cost, 0);
        let discount = null;
        const dr = r();
        if (dr < 0.075) discount = 'senior'; else if (dr < 0.105) discount = 'pwd'; else if (!delivery && dr < 0.165) discount = 'promo';
        let net = gross, disc = null;
        if (discount === 'promo') { const a = round2(gross * 0.10); net = gross - a; disc = { type: 'promo', label: 'Promo BORGERRR10', rate: 10, amount: a, vatExempt: 0 }; }
        else if (discount) { const exVat = gross / 1.12; const vatEx = round2(gross - exVat); const a = round2(exVat * 0.20); net = round2(gross - vatEx - a); disc = { type: discount, label: discount === 'senior' ? 'Senior Citizen' : 'PWD', rate: 20, amount: a, vatExempt: vatEx }; }
        const sr = r();
        const status = sr < 0.014 ? 'voided' : sr < 0.019 ? 'refunded' : 'completed';
        const no = mmdd + '-' + pad(seq).padStart(3, '0');
        const o = { id: 'o' + idx + '-' + seq, no, t, type, payment, staff, lines, items: lines.reduce((a, l) => a + l.qty, 0), gross, cost, net: round2(net), discount: disc, status, reason: status === 'voided' ? VOID_REASONS[Math.floor(r() * VOID_REASONS.length)] : status === 'refunded' ? 'Customer complaint — refunded in full' : null };
        orders.push(o);
        const summary = o.items + (o.items === 1 ? ' item' : ' items') + ' · ' + payment + ' · ' + type;
        if (status === 'voided') ev(t + 90e3, 'void', 'Order #' + no + ' voided', o.reason + ' · approved by ' + lead, staff, gross, o.id);
        else {
          ev(t, 'sale', 'Order #' + no + ' completed', summary, staff, o.net, o.id);
          if (disc) ev(t - 20e3, 'discount', disc.label + ' discount on #' + no, disc.vatExempt ? '20% off + VAT exemption · ID verified' : 'Code BORGERRR10 · 10% off', staff, round2(disc.amount + disc.vatExempt), o.id);
          if (status === 'refunded') ev(t + 25 * 60e3, 'void', 'Refund on #' + no, o.reason, closer, o.net, o.id);
          if (r() < 0.025) { const l = lines[0]; ev(t - 45e3, 'void', 'Item voided on #' + no, '1× ' + l.name + ' — ' + ITEM_VOID_REASONS[Math.floor(r() * 3)], staff, l.price, o.id); }
        }
      }
      ev(start + 22 * HOUR + 18 * 60e3, 'admin', 'Shift closed · Z-reading printed', 'Register 1 · ' + seq + ' transactions', closer, null);
    }
    cache = { day: today, orders, events };
  }
  function history() {
    if (!cache || cache.day !== dayStart(Date.now()) || Date.now() - (cache.at || 0) > 60e3) { generate(); cache.at = Date.now(); }
    const voids = ov.voids || {};
    const orders = cache.orders.map(o => voids[o.id] ? { ...o, status: 'voided', reason: voids[o.id].reason, voidedAt: voids[o.id].t } : o);
    return { orders, events: cache.events };
  }

  const delay = v => Promise.resolve(clone(v));

  /* ---------- Public API (same shape planned for Firebase) ---------- */
  window.DataStore = {
    source: 'sample',
    connected: false,

    // Auth — TODO: replace with Firebase Auth (signInWithEmailAndPassword / onAuthStateChanged)
    async getSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } },
    async signIn(opts) {
      if (!opts || opts.mode !== 'demo') throw new Error('Real sign-in comes with Firebase. Use demo mode for now.');
      const s = { demo: true, name: 'Demo Admin', email: 'demo@borgerrr.ph', role: 'Owner', at: Date.now() };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      return s;
    },
    async signOut() { sessionStorage.removeItem(SESSION_KEY); },

    // Reads — TODO: Firestore collections menu, stock, orders, activity; docs settings/discounts
    async getMenu() { return delay(menu()); },
    async getStock() { return delay(stock()); },
    async getDiscounts() { return delay(discounts()); },
    async getSettings() { return delay(settings()); },
    async getOrders(q) { q = q || {}; const from = q.from || 0, to = q.to || Infinity; return delay(history().orders.filter(o => o.t >= from && o.t <= to)); },
    async getActivity(q) {
      q = q || {}; const from = q.from || 0, to = q.to || Infinity;
      const h = history();
      const voids = Object.entries(ov.voids || {}).map(([id, v]) => { const o = h.orders.find(x => x.id === id); return o ? { id: 'uv-' + id, t: v.t, type: 'void', title: 'Order #' + o.no + ' voided', detail: v.reason + ' · from admin dashboard', staff: 'Demo Admin', amount: o.gross, ref: o.id } : null; }).filter(Boolean);
      const all = h.events.concat(ov.adminLog || [], voids).filter(e => e.t >= from && e.t <= to).sort((a, b) => b.t - a.t);
      return delay(all);
    },

    // Writes — each one also lands in the activity log as an admin action
    async saveMenuItem(item) {
      const list = menu();
      item = { ...item, price: round2(+item.price), cost: round2(+item.cost), active: !!item.active };
      if (!item.name || !(item.price > 0) || item.cost < 0) throw new Error('Name, price and cost are required.');
      const ex = list.find(m => m.id === item.id);
      if (ex) {
        const changes = [];
        if (ex.price !== item.price) changes.push('price ₱' + ex.price.toFixed(2) + ' → ₱' + item.price.toFixed(2));
        if (ex.cost !== item.cost) changes.push('cost ₱' + ex.cost.toFixed(2) + ' → ₱' + item.cost.toFixed(2));
        if (ex.name !== item.name) changes.push('renamed from “' + ex.name + '”');
        if (ex.category !== item.category) changes.push('moved to ' + item.category);
        if (ex.active !== item.active) changes.push(item.active ? 'shown on POS' : 'hidden from POS');
        Object.assign(ex, item);
        adminLog('Menu item updated: ' + item.name, changes.join(' · ') || 'No changes');
      } else {
        item.id = Math.max(0, ...list.map(m => m.id)) + 1;
        const prefix = { Burgers: 'BRG', Combos: 'CMB', Sides: 'SID', Drinks: 'DRK', Desserts: 'DST' }[item.category] || 'ITM';
        item.sku = prefix + '-' + pad(list.filter(m => m.sku.startsWith(prefix)).length + 1).padStart(3, '0');
        item.w = 1;
        list.push(item);
        adminLog('Menu item added: ' + item.name, item.category + ' · ₱' + item.price.toFixed(2));
      }
      ov.menu = list; persist();
      return clone(item);
    },
    async adjustStock(id, adj) {
      const list = stock(); const s = list.find(x => x.id === id);
      if (!s) throw new Error('Ingredient not found');
      const amount = +adj.amount;
      if (!(amount >= 0)) throw new Error('Enter a valid amount.');
      const before = s.qty;
      if (adj.mode === 'receive') s.qty = round2(s.qty + amount);
      else if (adj.mode === 'waste') s.qty = Math.max(0, round2(s.qty - amount));
      else s.qty = round2(amount);
      if (adj.min != null && adj.min !== '' && +adj.min >= 0) s.min = +adj.min;
      s.updatedAt = Date.now();
      const label = { receive: 'Stock received', waste: 'Wastage recorded', count: 'Stock count updated' }[adj.mode] || 'Stock updated';
      adminLog(label + ': ' + s.name, before + ' → ' + s.qty + ' ' + s.unit + (adj.note ? ' · ' + adj.note : ''));
      ov.stock = list; persist();
      return clone(s);
    },
    async saveDiscount(key, patch) {
      const d = discounts(); const cur = d[key];
      if (!cur) throw new Error('Unknown discount');
      const rate = +patch.rate;
      if (!(rate >= 0 && rate <= 100)) throw new Error('Rate must be between 0 and 100.');
      const changes = [];
      if (cur.rate !== rate) changes.push(cur.rate + '% → ' + rate + '%');
      if (patch.code != null && patch.code !== cur.code) changes.push('code ' + (cur.code || '—') + ' → ' + patch.code);
      if (patch.active != null && !!patch.active !== cur.active) changes.push(patch.active ? 'enabled' : 'disabled');
      Object.assign(cur, { rate, active: patch.active == null ? cur.active : !!patch.active }, patch.code != null ? { code: String(patch.code).toUpperCase() } : {});
      adminLog(cur.label + ' discount updated', changes.join(' · ') || 'No changes');
      ov.discounts = d; persist();
      return clone(cur);
    },
    async saveSettings(patch) {
      const cur = settings(); const changed = Object.keys(patch).filter(k => String(cur[k]) !== String(patch[k]));
      ov.settings = { ...(ov.settings || {}), ...patch };
      adminLog('Settings updated', changed.length ? changed.join(', ') : 'No changes');
      persist();
      return settings();
    },
    async voidOrder(id, reason) {
      ov.voids = ov.voids || {};
      ov.voids[id] = { reason: reason || 'Voided by admin', t: Date.now() };
      persist();
    },
    async reset() { ov = {}; persist(); cache = null; }
  };
})();
