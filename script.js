/* ==========================================================
   AZ COFFEE — منطق سایت
   بخش‌ها:
     ۱) تنظیمات ثابت
     ۲) ابزارهای کمکی
     ۳) تنظیمات سایت (settings.json) و نمایش آن‌ها
     ۴) محصولات و فیلتر
     ۵) سبد خرید (ذخیره در localStorage)
     ۶) پنل سبد خرید
     ۷) ثبت سفارش
     ۸) شروع برنامه

   نکته: این فایل هیچ کد درگاه پرداختی ندارد. برای اتصال درگاه،
   راهنمای README (بخش «اتصال درگاه پرداخت») را ببینید.
   ========================================================== */
'use strict';

/* ==========================================================
   ۱) تنظیمات ثابت
   ========================================================== */
const CONFIG = {
  productsUrl: 'products.json',
  settingsUrl: 'settings.json',
  currency: 'تومان',
  cartKey: 'azcoffee_cart_v1',          // کلید ذخیره‌ی سبد در مرورگر
  customerKey: 'azcoffee_customer_v1',  // کلید ذخیره‌ی اطلاعات مشتری برای خرید بعدی
  maxQty: 20,                           // حداکثر تعداد از هر محصول
  placeholderImage: 'images/placeholder.svg',
  categoryOrder: ['دانه کامل', 'آسیاب‌شده', 'ترکیبی'] // ترتیب نمایش فیلترها
};

/* ==========================================================
   ۲) ابزارهای کمکی
   ========================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** ساخت المان به‌صورت امن (بدون innerHTML، تا محتوای CMS هرگز به‌عنوان کد اجرا نشود) */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-') || key.startsWith('aria-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  [].concat(children).forEach((child) => node.append(child));
  return node;
}

/** قیمت با ارقام فارسی و جداکننده‌ی هزارگان */
function formatPrice(n) {
  return Number(n).toLocaleString('fa-IR') + ' ' + CONFIG.currency;
}

/** تبدیل ارقام فارسی/عربی به انگلیسی */
function toLatinDigits(str) {
  return String(str)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function onlyDigits(str) {
  return toLatinDigits(str).replace(/\D/g, '');
}

let toastTimer;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-show'), 2200);
}

/** خواندن امن localStorage (در حالت خصوصی مرورگر ممکن است خطا بدهد) */
function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* نادیده */ }
}

/** خواندن فایل JSON از سایت */
async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  return res.json();
}

/** ساخت تصویر با جایگزین خودکار در صورت خراب بودن آدرس */
function makeImage(src, alt, className, width, height) {
  const img = el('img', { class: className || '', alt: alt || '', loading: 'lazy', decoding: 'async', width, height });
  const onError = () => {
    img.removeEventListener('error', onError);
    img.src = CONFIG.placeholderImage;
  };
  img.addEventListener('error', onError);
  img.src = src || CONFIG.placeholderImage;
  return img;
}

/* ==========================================================
   ۳) تنظیمات سایت (settings.json)
   ========================================================== */
const state = {
  products: [],
  filter: 'all',
  cart: [],        // آرایه‌ای از { id, qty }
  settings: {}
};

/** پاک‌سازی نام کاربری شبکه‌های اجتماعی (حذف @ و آدرس کامل) */
function cleanHandle(value, allowDot) {
  const v = String(value || '').trim()
    .replace(/^https?:\/\/(www\.)?(instagram\.com|t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  const re = allowDot ? /^[A-Za-z0-9._]{1,40}$/ : /^[A-Za-z0-9_]{3,40}$/;
  return re.test(v) ? v : '';
}

/** شماره‌ی واتس‌اپ را به قالب بین‌المللی (98912...) تبدیل می‌کند */
function cleanWhatsApp(value) {
  let d = onlyDigits(value);
  if (d.startsWith('0098')) d = d.slice(2);
  else if (d.startsWith('09')) d = '98' + d.slice(1);
  else if (d.startsWith('9') && d.length === 10) d = '98' + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

function telHref(value) {
  const d = toLatinDigits(value).replace(/[^\d+]/g, '');
  return d ? 'tel:' + d : '';
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

async function loadSettings() {
  try {
    const data = await fetchJSON(CONFIG.settingsUrl);
    state.settings = data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.warn('settings.json بارگذاری نشد؛ از متن‌های پیش‌فرض صفحه استفاده می‌شود.', err);
    state.settings = {};
  }
}

/** نمایش تنظیمات روی صفحه */
function applySettings() {
  const s = state.settings;

  // متن‌های ساده: هر المان با data-s همان کلید را از settings می‌گیرد
  $$('[data-s]').forEach((node) => {
    const value = s[node.dataset.s];
    if (typeof value === 'string' && value.trim()) node.textContent = value.trim();
  });

  // متن «درباره ما» (هر خط یک پاراگراف)
  if (typeof s.about_text === 'string' && s.about_text.trim()) {
    const box = $('#about-text');
    box.replaceChildren();
    s.about_text.split(/\n+/).filter((l) => l.trim()).forEach((line) => box.append(el('p', { text: line.trim() })));
  }

  buildContact();
  buildFooterSocials();

  const note = $('#shipping-note');
  const shipping = typeof s.shipping_note === 'string' ? s.shipping_note.trim() : '';
  note.textContent = shipping;
  note.hidden = !shipping;
}

/** لینک‌های تماس و شبکه‌های اجتماعی؛ فقط مواردی که پر شده‌اند */
function contactLinks() {
  const s = state.settings;
  const links = [];
  const phone = String(s.phone || '').trim();
  const wa = cleanWhatsApp(s.whatsapp);
  const tg = cleanHandle(s.telegram, false);
  const ig = cleanHandle(s.instagram, true);
  const email = String(s.email || '').trim();

  if (phone && telHref(phone)) links.push({ label: 'تلفن', text: phone, href: telHref(phone), ltr: true });
  if (wa) links.push({ label: 'واتس‌اپ', text: '+' + wa, href: 'https://wa.me/' + wa, ltr: true, external: true });
  if (tg) links.push({ label: 'تلگرام', text: '@' + tg, href: 'https://t.me/' + tg, ltr: true, external: true });
  if (ig) links.push({ label: 'اینستاگرام', text: '@' + ig, href: 'https://instagram.com/' + ig, ltr: true, external: true });
  if (isEmail(email)) links.push({ label: 'ایمیل', text: email, href: 'mailto:' + email, ltr: true });
  return links;
}

function buildContact() {
  const list = $('#contact-list');
  list.replaceChildren();
  const s = state.settings;

  contactLinks().forEach((l) => {
    const a = el('a', { href: l.href, text: l.text });
    if (l.ltr) a.dir = 'ltr';
    if (l.external) { a.target = '_blank'; a.rel = 'noopener'; }
    list.append(el('li', {}, [el('span', { text: l.label }), a]));
  });
  if (typeof s.address === 'string' && s.address.trim()) {
    list.append(el('li', {}, [el('span', { text: 'آدرس' }), el('em', { text: s.address.trim() })]));
  }
  if (typeof s.working_hours === 'string' && s.working_hours.trim()) {
    list.append(el('li', {}, [el('span', { text: 'ساعت کاری' }), el('em', { text: s.working_hours.trim() })]));
  }
  if (!list.children.length) {
    list.append(el('li', {}, [el('em', { text: 'اطلاعات تماس به‌زودی اضافه می‌شود.' })]));
  }
}

function buildFooterSocials() {
  const box = $('#footer-socials');
  box.replaceChildren();
  contactLinks().filter((l) => l.external).forEach((l) => {
    box.append(el('a', { href: l.href, text: l.label, target: '_blank', rel: 'noopener' }));
  });
}

/* ==========================================================
   ۴) محصولات
   ========================================================== */

/** پاک‌سازی و یکتاسازی داده‌های products.json */
function normalizeProducts(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p === 'object' && p.name)
    .map((p, index) => {
      let id = String(p.id || 'item-' + (index + 1)).trim();
      while (seen.has(id)) id += '-2'; // اگر شناسه تکراری بود، یکتا می‌شود
      seen.add(id);
      const price = Number(p.price);
      return {
        id,
        name: String(p.name),
        category: String(p.category || ''),
        description: String(p.description || ''),
        price: Number.isFinite(price) && price > 0 ? Math.round(price) : 0,
        image: String(p.image || ''),
        // محصول بدون قیمت معتبر قابل سفارش نیست
        available: p.available !== false && price > 0
      };
    });
}

async function loadProducts() {
  const status = $('#products-status');
  try {
    const data = await fetchJSON(CONFIG.productsUrl);
    // هم {products:[...]} (فرمت پنل) و هم آرایه‌ی ساده پشتیبانی می‌شود
    state.products = normalizeProducts(Array.isArray(data) ? data : data.products);
    status.hidden = state.products.length > 0;
    if (!state.products.length) status.textContent = 'به‌زودی محصولات جدید اضافه می‌شود.';
  } catch (err) {
    console.error('خطا در بارگذاری محصولات:', err);
    status.hidden = false;
    status.textContent = 'بارگذاری محصولات انجام نشد. لطفاً صفحه را دوباره باز کنید.';
  }
}

/** دکمه‌های فیلتر بر اساس دسته‌های موجود در محصولات ساخته می‌شوند */
function renderFilters() {
  const box = $('#filters');
  box.replaceChildren();

  const found = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
  const ordered = [
    ...CONFIG.categoryOrder.filter((c) => found.includes(c)),
    ...found.filter((c) => !CONFIG.categoryOrder.includes(c))
  ];
  if (state.filter !== 'all' && !ordered.includes(state.filter)) state.filter = 'all';

  box.hidden = ordered.length < 2;
  [['all', 'همه'], ...ordered.map((c) => [c, c])].forEach(([value, label]) => {
    box.append(el('button', {
      type: 'button',
      class: 'chip' + (state.filter === value ? ' is-active' : ''),
      text: label,
      'data-filter': value,
      'aria-pressed': String(state.filter === value)
    }));
  });
}

function renderProducts() {
  const grid = $('#product-grid');
  const status = $('#products-status');
  grid.replaceChildren();

  const list = state.products
    .filter((p) => state.filter === 'all' || p.category === state.filter)
    .sort((a, b) => Number(b.available) - Number(a.available)); // موجودها اول

  if (state.products.length) {
    status.hidden = list.length > 0;
    if (!list.length) status.textContent = 'محصولی در این دسته وجود ندارد.';
  }

  list.forEach((p) => {
    const button = el('button', {
      class: 'btn btn-primary', type: 'button',
      text: p.available ? 'افزودن به سبد' : 'ناموجود',
      disabled: !p.available
    });
    if (p.available) button.addEventListener('click', () => addToCart(p.id));

    grid.append(el('article', { class: 'card' + (p.available ? '' : ' is-soldout') }, [
      makeImage(p.image, p.name, 'card-img', 640, 480),
      el('div', { class: 'card-body' }, [
        p.category ? el('span', { class: 'card-cat', text: p.category }) : '',
        el('h3', { class: 'card-title', text: p.name }),
        el('p', { class: 'card-desc', text: p.description }),
        el('div', { class: 'card-foot' }, [
          el('span', { class: 'card-price', text: p.price ? formatPrice(p.price) : '—' }),
          button
        ])
      ])
    ]));
  });
}

function initFilters() {
  $('#filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderFilters();
    renderProducts();
  });
}

/* ==========================================================
   ۵) سبد خرید
   ========================================================== */
function loadCart() {
  try {
    const raw = JSON.parse(storageGet(CONFIG.cartKey) || '[]');
    state.cart = Array.isArray(raw)
      ? raw
          .filter((i) => i && typeof i.id === 'string' && Number.isInteger(i.qty) && i.qty > 0)
          .map((i) => ({ id: i.id, qty: Math.min(i.qty, CONFIG.maxQty) }))
      : [];
  } catch {
    state.cart = [];
  }
}

function saveCart() {
  storageSet(CONFIG.cartKey, JSON.stringify(state.cart));
}

/** محصولاتی که از سایت حذف یا ناموجود شده‌اند از سبد بیرون می‌روند */
function pruneCart() {
  const before = state.cart.length;
  state.cart = state.cart.filter((i) => state.products.some((p) => p.id === i.id && p.available));
  if (state.cart.length !== before) saveCart();
}

/** ردیف‌های سبد؛ قیمت همیشه از products.json خوانده می‌شود، نه از localStorage */
function cartLines() {
  return state.cart
    .map((item) => ({ item, product: state.products.find((p) => p.id === item.id) }))
    .filter((l) => l.product && l.product.available)
    .map(({ item, product }) => ({ product, qty: item.qty, subtotal: product.price * item.qty }));
}

function cartTotal() {
  return cartLines().reduce((sum, l) => sum + l.subtotal, 0);
}

function addToCart(id) {
  const existing = state.cart.find((i) => i.id === id);
  if (existing) {
    if (existing.qty >= CONFIG.maxQty) { showToast('حداکثر تعداد مجاز برای این محصول'); return; }
    existing.qty += 1;
  } else {
    state.cart.push({ id, qty: 1 });
  }
  saveCart();
  renderCart();
  showToast('به سبد خرید اضافه شد');
}

function changeQty(id, delta) {
  const item = state.cart.find((i) => i.id === id);
  if (!item) return;
  item.qty = Math.min(item.qty + delta, CONFIG.maxQty);
  if (item.qty <= 0) state.cart = state.cart.filter((i) => i.id !== id);
  saveCart();
  renderCart();
}

function removeFromCart(id) {
  state.cart = state.cart.filter((i) => i.id !== id);
  saveCart();
  renderCart();
}

function clearCart() {
  state.cart = [];
  saveCart();
  renderCart();
}

function renderCart() {
  const lines = cartLines();
  const count = lines.reduce((sum, l) => sum + l.qty, 0);

  const badge = $('#cart-count');
  badge.textContent = count.toLocaleString('fa-IR');
  badge.hidden = count === 0;

  const list = $('#cart-items');
  list.replaceChildren();

  lines.forEach(({ product, qty, subtotal }) => {
    const minus = el('button', { type: 'button', text: '−', 'aria-label': 'کم کردن' });
    const plus = el('button', { type: 'button', text: '+', 'aria-label': 'زیاد کردن' });
    const remove = el('button', { type: 'button', class: 'ci-remove', text: 'حذف' });
    minus.addEventListener('click', () => changeQty(product.id, -1));
    plus.addEventListener('click', () => changeQty(product.id, +1));
    remove.addEventListener('click', () => removeFromCart(product.id));

    list.append(el('li', { class: 'cart-item' }, [
      makeImage(product.image, '', '', 64, 64),
      el('div', {}, [
        el('div', { class: 'ci-name', text: product.name }),
        el('div', { class: 'ci-price', text: formatPrice(subtotal) }),
        el('div', { class: 'ci-row' }, [
          el('div', { class: 'qty' }, [minus, el('span', { text: qty.toLocaleString('fa-IR') }), plus]),
          remove
        ])
      ])
    ]));
  });

  const total = formatPrice(cartTotal());
  $('#cart-total').textContent = total;
  $('#checkout-total').textContent = total;
  $('#cart-empty').hidden = lines.length > 0;
  $('#btn-checkout').disabled = lines.length === 0;

  // اگر سبد خالی شد و فرم باز بود، به نمای سبد برگرد
  if (!lines.length && !$('#view-checkout').hidden) showView('cart');
}

/* ==========================================================
   ۶) پنل سبد خرید
   ========================================================== */
const drawer = () => $('#cart-drawer');
let lastFocus = null;

function showView(name) {
  ['cart', 'checkout', 'success'].forEach((v) => { $('#view-' + v).hidden = v !== name; });
  const focusTarget = {
    cart: '#cart-close',
    checkout: '#f-name',
    success: '#success-close'
  }[name];
  const node = $(focusTarget);
  if (node && drawer().classList.contains('is-open')) node.focus({ preventScroll: true });
}

function isCartOpen() {
  return drawer().classList.contains('is-open');
}

function openCart() {
  lastFocus = document.activeElement;
  drawer().inert = false;
  drawer().classList.add('is-open');
  $('#cart-overlay').hidden = false;
  document.body.classList.add('no-scroll');
  showView('cart');
}

function closeCart() {
  if (!isCartOpen()) return;
  drawer().classList.remove('is-open');
  drawer().inert = true;
  $('#cart-overlay').hidden = true;
  document.body.classList.remove('no-scroll');
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

/** نگه داشتن فوکوس کیبورد داخل پنل در زمان باز بودن */
function trapFocus(e) {
  if (e.key !== 'Tab' || !isCartOpen()) return;
  const items = $$('button:not([disabled]), a[href], input, textarea', drawer())
    .filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function initCartUI() {
  $('#cart-open').addEventListener('click', openCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#success-close').addEventListener('click', closeCart);
  $('#cart-overlay').addEventListener('click', closeCart);
  $('#btn-checkout').addEventListener('click', () => { fillSavedCustomer(); showView('checkout'); });
  $('#checkout-back').addEventListener('click', () => showView('cart'));
  $('#checkout-form').addEventListener('submit', handleCheckoutSubmit);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCart();
    trapFocus(e);
  });
  // هماهنگی سبد بین چند تب مرورگر
  window.addEventListener('storage', (e) => {
    if (e.key === CONFIG.cartKey) { loadCart(); pruneCart(); renderCart(); }
  });
}

function initNav() {
  const toggle = $('#nav-toggle');
  const nav = $('#site-nav');
  const close = () => { nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); };

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.site-header')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* ==========================================================
   ۷) پرداخت (آماده‌ی اتصال درگاه)
   ----------------------------------------------------------
   در این فایل هیچ کد درگاه پرداختی وجود ندارد.

   برای اتصال درگاه: فایل جداگانه‌ی payment.js بسازید و در آن
   تابع window.AZ_ORDER_HANDLER(order, api) را تعریف کنید، سپس خط
   <script src="payment.js"></script> را در index.html فعال کنید.
   (نمونه‌ی کامل در README، بخش «اتصال درگاه پرداخت»)

   تا زمانی که این تابع تعریف نشده، با زدن «پرداخت» فقط پیام
   «درگاه پرداخت هنوز متصل نشده» نمایش داده می‌شود و سبد حفظ می‌شود.
   ========================================================== */

function fillSavedCustomer() {
  try {
    const saved = JSON.parse(storageGet(CONFIG.customerKey) || 'null');
    if (!saved) return;
    if (!$('#f-name').value) $('#f-name').value = saved.name || '';
    if (!$('#f-phone').value) $('#f-phone').value = saved.phone || '';
    if (!$('#f-address').value) $('#f-address').value = saved.address || '';
  } catch { /* نادیده */ }
}

function validateCheckout(name, phone, address) {
  if (name.trim().length < 3) return 'لطفاً نام و نام خانوادگی را وارد کنید.';
  if (!/^09\d{9}$/.test(onlyDigits(phone))) return 'شماره تماس معتبر نیست (مثال: 09123456789).';
  if (address.trim().length < 10) return 'لطفاً آدرس را کامل‌تر وارد کنید.';
  return '';
}

function makeOrderCode() {
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return 'AZ-' + Date.now().toString(36).toUpperCase().slice(-5) + rand;
}

async function handleCheckoutSubmit(e) {
  e.preventDefault();
  const errorBox = $('#checkout-error');
  const name = $('#f-name').value;
  const phone = $('#f-phone').value;
  const address = $('#f-address').value;

  const error = validateCheckout(name, phone, address);
  errorBox.hidden = !error;
  errorBox.textContent = error;
  if (error) return;

  const lines = cartLines();
  if (!lines.length) return;

  const order = {
    code: makeOrderCode(),
    customer: { name: name.trim(), phone: onlyDigits(phone), address: address.trim() },
    items: lines.map((l) => ({ id: l.product.id, name: l.product.name, qty: l.qty, price: l.product.price })),
    total: cartTotal(),
    createdAt: new Date().toISOString()
  };

  // ذخیره‌ی اطلاعات مشتری برای خرید بعدی (فقط در مرورگر خودش)
  storageSet(CONFIG.customerKey, JSON.stringify(order.customer));

  // درگاه هنوز متصل نشده: فقط پیام نمایش داده می‌شود و سبد حفظ می‌شود
  if (typeof window.AZ_ORDER_HANDLER !== 'function') {
    showView('success');
    return;
  }

  const submitBtn = $('#btn-submit');
  submitBtn.disabled = true;
  try {
    // نقطه‌ی اتصال درگاه پرداخت (در payment.js تعریف می‌شود)
    await window.AZ_ORDER_HANDLER(order, { clearCart, closeCart, showToast, formatPrice });
  } catch (err) {
    console.error('خطا در پرداخت:', err);
    errorBox.hidden = false;
    errorBox.textContent = 'اتصال به درگاه پرداخت انجام نشد. لطفاً دوباره تلاش کنید.';
  } finally {
    submitBtn.disabled = false;
  }
}

/* ==========================================================
   ۸) شروع برنامه
   ========================================================== */
async function init() {
  $('#year').textContent = new Date().getFullYear().toLocaleString('fa-IR', { useGrouping: false });
  initNav();
  initFilters();
  initCartUI();
  loadCart();

  // سبد و ساختار صفحه بلافاصله نشان داده می‌شود؛ داده‌ها به‌صورت موازی می‌آیند
  await Promise.all([loadSettings(), loadProducts()]);
  applySettings();
  pruneCart();
  renderFilters();
  renderProducts();
  renderCart();
}

document.addEventListener('DOMContentLoaded', init);
