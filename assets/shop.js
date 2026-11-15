/* Shared shop code for the sim store and the toolkit page.
   Talks to the SwiftDrop backend: catalogue, cart, Stripe checkout, and
   download delivery for digital products (ids starting "dg_").
   A page sets window.SHOP_CONFIG before loading this file, then listens for
   the "shop:ready" event and draws its own product list. */
(function () {
  const cfg = Object.assign({ api: "", categories: [], preview: false, sampleProducts: [] }, window.SHOP_CONFIG || {});
  const state = { products: [], groups: [], cart: [], stripe: null, loadError: false, elements: null };
  const money = n => "£" + Number(n).toFixed(2);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isDigital = id => String(id).indexOf("dg_") === 0;
  const $ = id => document.getElementById(id);

  // Print-on-demand products arrive as one row per size and colour, named
  // "Product / Colour / Size". Fold them into one product with options.
  function group(products) {
    const map = new Map();
    for (const p of products) {
      const parts = String(p.id).indexOf("pf_") === 0 ? p.name.split(" / ") : [p.name];
      const base = parts[0];
      const key = (String(p.id).indexOf("pf_") === 0 ? "pf:" : "one:" + p.id + ":") + base;
      if (!map.has(key)) map.set(key, { key, name: base, category: p.category, image: p.image, emoji: p.emoji, description: p.description, digital: isDigital(p.id), sample: !!p.sample, variants: [] });
      map.get(key).variants.push({ id: p.id, label: parts.slice(1).join(" / "), price: Number(p.price) });
    }
    const sizes = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
    const rank = l => { const s = l.split(" / ").pop(); const i = sizes.indexOf(s); return i < 0 ? 99 : i; };
    for (const g of map.values()) {
      g.variants.sort((a, b) => a.label.split(" / ")[0].localeCompare(b.label.split(" / ")[0]) || rank(a.label) - rank(b.label));
      g.from = Math.min.apply(null, g.variants.map(v => v.price));
      g.onePrice = g.variants.every(v => v.price === g.from);
    }
    return Array.from(map.values());
  }

  async function load() {
    if (cfg.preview) {
      state.products = cfg.sampleProducts;
    } else {
      try {
        const r = await fetch(cfg.api + "/api/products");
        const d = await r.json();
        state.products = d.products || [];
      } catch (e) { state.loadError = true; }
      try {
        const r = await fetch(cfg.api + "/api/payments/config");
        const d = await r.json();
        if (d.publishable_key && window.Stripe) state.stripe = window.Stripe(d.publishable_key);
      } catch (e) {}
    }
    if (cfg.categories.length) state.products = state.products.filter(p => cfg.categories.indexOf(p.category) >= 0);
    state.groups = group(state.products);
    document.dispatchEvent(new CustomEvent("shop:ready"));
  }

  /* ── page chrome this file owns: overlay, cart drawer, toast ── */
  function mount() {
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="shop-overlay" id="shopOverlay" hidden><div class="shop-dialog" id="shopDialog" role="dialog" aria-modal="true" tabindex="-1"></div></div>' +
      '<aside class="shop-cart" id="shopCart" aria-label="Basket" hidden><div class="shop-cart-head"><h2>Basket</h2><button class="shop-x" id="shopCartClose" aria-label="Close basket">×</button></div><div id="shopCartBody"></div></aside>' +
      '<div class="shop-toast" id="shopToast" role="status" hidden></div>';
    document.body.appendChild(wrap);
    $("shopOverlay").addEventListener("click", e => { if (e.target === $("shopOverlay")) closeDialog(); });
    $("shopCartClose").addEventListener("click", () => toggleCart(false));
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeDialog(); toggleCart(false); } });
  }
  function dialog(html) { $("shopDialog").innerHTML = '<button class="shop-x" id="shopDialogClose" aria-label="Close">×</button>' + html; $("shopOverlay").hidden = false; document.body.style.overflow = "hidden"; $("shopDialogClose").addEventListener("click", closeDialog); $("shopDialog").focus(); }
  function closeDialog() { if ($("shopOverlay").hidden) return; $("shopOverlay").hidden = true; document.body.style.overflow = ""; }
  let toastTimer;
  function toast(text) { const t = $("shopToast"); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200); }

  /* ── basket ── */
  const count = () => state.cart.reduce((n, i) => n + i.qty, 0);
  function totals() {
    const sub = state.cart.reduce((n, i) => n + i.price * i.qty, 0);
    const physical = state.cart.some(i => !isDigital(i.id));
    const shipping = !physical ? 0 : sub >= 50 ? 0 : 3.99;   // mirrors the backend, which has the final say
    return { sub, shipping, total: sub + shipping, physical };
  }
  function add(variantId, qty) {
    const p = state.products.find(x => x.id === variantId); if (!p) return;
    const line = state.cart.find(x => x.id === variantId);
    if (line) line.qty = isDigital(variantId) ? 1 : Math.min(100, line.qty + qty);
    else state.cart.push({ id: p.id, name: p.name, price: Number(p.price), qty: isDigital(variantId) ? 1 : qty });
    changed();
  }
  function remove(id) { state.cart = state.cart.filter(x => x.id !== id); changed(); }
  function changed() { document.dispatchEvent(new CustomEvent("shop:cart", { detail: { count: count() } })); renderCart(); }
  function toggleCart(open) { const c = $("shopCart"); c.hidden = open === undefined ? !c.hidden : !open; if (!c.hidden) renderCart(); }
  function renderCart() {
    const el = $("shopCartBody");
    if (!state.cart.length) { el.innerHTML = '<p class="shop-muted">Your basket is empty.</p>'; return; }
    const t = totals();
    el.innerHTML = state.cart.map(i => '<div class="shop-line"><div><strong>' + esc(i.name) + "</strong><span>" + money(i.price) + " × " + i.qty + '</span></div><button class="shop-link" data-remove="' + esc(i.id) + '">Remove</button></div>').join("") +
      '<dl class="shop-sum"><div><dt>Subtotal</dt><dd>' + money(t.sub) + "</dd></div>" +
      (t.physical ? "<div><dt>UK delivery</dt><dd>" + (t.shipping ? money(t.shipping) : "Free") + "</dd></div>" : "") +
      '<div class="shop-total"><dt>Total</dt><dd>' + money(t.total) + '</dd></div></dl><button class="shop-btn" id="shopCheckout">Check out</button>';
    el.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => remove(b.getAttribute("data-remove"))));
    $("shopCheckout").addEventListener("click", checkout);
  }

  /* ── product dialog ── */
  function open(key) {
    const g = state.groups.find(x => x.key === key); if (!g) return;
    const many = g.variants.length > 1;
    dialog(
      (g.image ? '<img class="shop-photo" src="' + esc(g.image) + '" alt="">' : '<div class="shop-photo shop-photo-empty" aria-hidden="true">' + esc(g.emoji || "") + "</div>") +
      "<h2>" + esc(g.name) + "</h2>" +
      (g.description && g.description !== g.variants[0].label && g.description.indexOf(g.name + " / ") !== 0 ? "<p>" + esc(g.description) + "</p>" : "") +
      (many ? '<label class="shop-field">Option<select id="shopVariant">' + g.variants.map(v => '<option value="' + esc(v.id) + '">' + esc(v.label) + " (" + money(v.price) + ")</option>").join("") + "</select></label>" : "") +
      (g.digital ? "" : '<label class="shop-field">Quantity<input id="shopQty" type="number" min="1" max="100" value="1" inputmode="numeric"></label>') +
      '<button class="shop-btn" id="shopAdd">Add to basket' + (many ? "" : " — " + money(g.from)) + "</button>");
    $("shopAdd").addEventListener("click", () => {
      const id = many ? $("shopVariant").value : g.variants[0].id;
      const qty = g.digital ? 1 : Math.max(1, Math.min(100, parseInt($("shopQty").value, 10) || 1));
      add(id, qty); closeDialog(); toast("Added to basket"); toggleCart(true);
    });
  }

  /* ── checkout ── */
  function checkout() {
    if (!state.cart.length) return;
    toggleCart(false);
    const t = totals();
    const hasDigital = state.cart.some(i => isDigital(i.id));
    dialog(
      "<h2>Check out</h2>" +
      '<ul class="shop-review">' + state.cart.map(i => "<li><span>" + esc(i.name) + (i.qty > 1 ? " × " + i.qty : "") + "</span><span>" + money(i.price * i.qty) + "</span></li>").join("") +
      (t.physical ? "<li><span>UK delivery</span><span>" + (t.shipping ? money(t.shipping) : "Free") + "</span></li>" : "") +
      '<li class="shop-total"><span>Total</span><span>' + money(t.total) + "</span></li></ul>" +
      '<form id="shopForm" novalidate>' +
      '<label class="shop-field">Full name<input id="shopName" autocomplete="name" required></label>' +
      '<label class="shop-field">Email<input id="shopEmail" type="email" autocomplete="email" required></label>' +
      (t.physical ?
        '<label class="shop-field">Address<input id="shopAddr" autocomplete="address-line1" required></label>' +
        '<div class="shop-two"><label class="shop-field">Town or city<input id="shopCity" autocomplete="address-level2" required></label>' +
        '<label class="shop-field">Postcode<input id="shopPost" autocomplete="postal-code" required></label></div>' +
        '<p class="shop-muted">We deliver to UK addresses.</p>' : "") +
      (hasDigital ? '<label class="shop-check"><input id="shopConsent" type="checkbox"><span>Send my download straight away. I understand that once it starts I lose the 14-day right to cancel a digital purchase.</span></label>' : "") +
      '<p class="shop-error" id="shopError" role="alert" hidden></p>' +
      '<button class="shop-btn" id="shopPayStep" type="submit">Continue to payment</button></form>' +
      '<p class="shop-muted">Card details are handled by Stripe. We never see them.</p>');
    $("shopForm").addEventListener("submit", e => { e.preventDefault(); startPayment(t.physical, hasDigital); });
  }
  function fail(msg) { const e = $("shopError"); e.textContent = msg; e.hidden = false; }

  async function startPayment(physical, hasDigital) {
    const v = id => ($(id) ? $(id).value.trim() : "");
    const name = v("shopName"), email = v("shopEmail");
    $("shopError").hidden = true;
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return fail("Enter your name and a valid email address.");
    if (physical && (!v("shopAddr") || !v("shopCity") || !v("shopPost"))) return fail("Enter the full delivery address.");
    if (hasDigital && !$("shopConsent").checked) return fail("Tick the box to get your download straight away.");
    if (cfg.preview) return fail("This is a preview, so payment is switched off here.");
    if (!state.stripe) return fail("Payment is not available right now. Try again in a few minutes.");
    const btn = $("shopPayStep"); btn.disabled = true; btn.textContent = "Loading payment…";
    try {
      const body = { customer_email: email, customer_name: name, items: state.cart.map(i => ({ product_id: i.id, quantity: i.qty })) };
      if (physical) body.shipping_address = { line1: v("shopAddr"), city: v("shopCity"), postcode: v("shopPost"), country: "GB" };
      const order = await post("/api/orders", body);
      if (!order.success) throw new Error(order.error || "The order could not be created.");
      const intent = await post("/api/payments/create-intent", { order_id: order.order_id });
      if (!intent.success) throw new Error(intent.error || "Payment could not be started.");
      state.elements = state.stripe.elements({ clientSecret: intent.client_secret });
      dialog("<h2>Payment</h2><p class=\"shop-muted\">Order " + esc(order.order_id) + ", total " + money(order.total) + '</p><div id="shopPayment"></div><p class="shop-error" id="shopError" role="alert" hidden></p><button class="shop-btn" id="shopPay">Pay ' + money(order.total) + "</button>");
      state.elements.create("payment").mount("#shopPayment");
      $("shopPay").addEventListener("click", () => pay(order, name));
    } catch (e) {
      btn.disabled = false; btn.textContent = "Continue to payment"; fail(e.message);
    }
  }
  async function post(path, body) {
    const r = await fetch(cfg.api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.json();
  }

  async function pay(order, name) {
    const btn = $("shopPay"); btn.disabled = true; btn.textContent = "Processing…"; $("shopError").hidden = true;
    const result = await state.stripe.confirmPayment({ elements: state.elements, redirect: "if_required" });
    if (result.error || !result.paymentIntent || result.paymentIntent.status !== "succeeded") {
      btn.disabled = false; btn.textContent = "Pay " + money(order.total);
      return fail((result.error && result.error.message) || "The payment did not go through. Try again.");
    }
    const bought = state.cart.slice(); state.cart = []; changed();
    if (window.fbq) window.fbq("track", "Purchase", { value: Number(order.total), currency: "GBP" });
    if (window.ttq) window.ttq.track("CompletePayment", { value: Number(order.total), currency: "GBP" });
    const physical = bought.some(i => !isDigital(i.id));
    dialog("<h2>Paid. Thank you, " + esc(name.split(" ")[0]) + '.</h2><p>Your order number is <strong>' + esc(order.order_id) + "</strong>. Keep a note of it.</p>" +
      (order.download_token ? '<div id="shopDownloads"><p class="shop-muted">Getting your download ready…</p></div>' : "") +
      (physical ? "<p>We are getting your order made and sent.</p>" : "") +
      '<button class="shop-btn shop-btn-quiet" id="shopDone">Close</button>');
    $("shopDone").addEventListener("click", closeDialog);
    if (order.download_token) claim(order, 0);
  }

  // The payment is confirmed to the backend by Stripe a moment after the
  // buyer sees "paid", so ask for the download a few times before giving up.
  async function claim(order, attempt) {
    const box = $("shopDownloads"); if (!box) return;
    let d = null;
    try { d = await post("/api/downloads/claim", { order_id: order.order_id, token: order.download_token }); } catch (e) {}
    if (d && d.success && d.files && d.files.length) {
      box.innerHTML = d.files.map(f => '<a class="shop-btn" href="' + esc(cfg.api + f.url) + '" download>Download ' + esc(f.name) + "</a>").join("") +
        '<p class="shop-muted">Save the file somewhere safe. This link works for 24 hours.</p>';
      return;
    }
    if (attempt < 10) return setTimeout(() => claim(order, attempt + 1), 1500);
    box.innerHTML = '<p class="shop-error">Your payment went through but the download is taking longer than it should. <button class="shop-link" id="shopRetry">Try again</button></p><p class="shop-muted">If it still does not appear, reply to your receipt email quoting order ' + esc(order.order_id) + ".</p>";
    $("shopRetry").addEventListener("click", () => { box.innerHTML = '<p class="shop-muted">Getting your download ready…</p>'; claim(order, 0); });
  }

  window.Shop = {
    groups: () => state.groups, loadError: () => state.loadError, money, esc,
    open, toggleCart, count,
    buyNow(variantId) { state.cart = []; add(variantId, 1); checkout(); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { mount(); load(); });
  else { mount(); load(); }
})();
