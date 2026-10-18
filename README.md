# BorgerrrPOS Admin Dashboard (sample)

Static admin dashboard for BorgerrrPOS. **Sample data only — not connected to the shop yet.**
Plain HTML/CSS/JS, no build step, hash routing (`#/overview`, `#/orders`, `#/activity`, `#/sales`, `#/menu`, `#/stock`, `#/discounts`, `#/settings`). Served by GitHub Pages (`.nojekyll`).

## Structure
- `index.html` — page shell, Inter (Google Fonts), Chart.js 4.4.1 from jsDelivr (pinned + SRI)
- `style.css` — design system (light + dark theme tokens, components, responsive layout)
- `js/icons.js` — inline SVG icons (Lucide paths) and the logo mark
- `js/data.js` — **DataStore**: the only place that reads/writes data. All methods are async so a Firebase (Auth + Firestore) implementation can replace it with the same API
- `js/ui.js` — formatting (₱, Asia/Manila time), toasts, modals, sortable/searchable/paginated data table, sparklines, CSV export
- `js/app.js` — app shell (sidebar, top bar), router and pages

## Sample data
60 days of deterministic orders (30 shown in the "30d" range plus 30 for "vs previous period") for a Quezon City burger shop: menu items, Senior/PWD (20% + VAT exemption) and promo discounts, cash/GCash/Maya/card/delivery-app payments, voids, refunds, shift and stock events. Edits are saved in this browser's `localStorage`; **Settings → Reset sample data** restores defaults.

## DataStore API
`getSession() signIn({mode:'demo'}) signOut() getMenu() getStock() getDiscounts() getSettings() getOrders({from,to}) getActivity({from,to}) saveMenuItem(item) adjustStock(id,{mode,amount,min,note}) saveDiscount(key,patch) saveSettings(patch) voidOrder(id,reason) reset()`

No API keys or secrets are in this repo. Real sign-in comes with Firebase.
