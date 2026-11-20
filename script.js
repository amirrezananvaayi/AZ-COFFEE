/* ==========================================================
   AZ COFFEE — منطق سایت
   بخش‌ها:
     ۱) تنظیمات ثابت
     ۲) ابزارهای کمکی
     ۳) تنظیمات سایت (settings.json)
     ۴) داده‌ها: دسته‌بندی‌ها، تعرفه‌ها (options.json)، محصولات
     ۵) محاسبه‌ی قیمت
     ۶) مسیریابی و صفحه‌ها (خانه، دسته‌بندی، محصول)
     ۷) سبد خرید
     ۸) پنل‌های کشویی (منو و سبد)
     ۹) پرداخت (آماده‌ی اتصال درگاه)
     ۱۰) شروع برنامه

   این فایل هیچ کد درگاه پرداختی ندارد (README، بخش «اتصال درگاه پرداخت»).
   تمام قیمت‌ها و گزینه‌ها از فایل‌های JSON خوانده می‌شود و از پنل مدیریت قابل ویرایش است.
   ========================================================== */
'use strict';

/* ==========================================================
   ۱) تنظیمات ثابت
   ========================================================== */
const CONFIG = {
  productsUrl: 'products.json',
  categoriesUrl: 'categories.json',
  optionsUrl: 'options.json',
  settingsUrl: 'settings.json',
  currency: 'تومان',
  cartKey: 'azcoffee_cart_v2',          // کلید ذخیره‌ی سبد در مرورگر
  customerKey: 'azcoffee_customer_v1',  // اطلاعات مشتری برای خرید بعدی
  maxQty: 20,                           // حداکثر تعداد از هر ردیف سبد
  placeholderImage: 'images/placeholder.svg'
};

/** مقدارهای پیش‌فرض گزینه‌ها؛ اگر options.json خراب یا ناقص بود استفاده می‌شود */
const DEFAULT_OPTIONS = {
  weight: {
    title: 'میزان و حجم',
    label_250: '۲۵۰ گرم',
    label_500: '۵۰۰ گرم',
    label_1000: '۱ کیلوگرم',
    label_custom: 'بیش از ۱ کیلوگرم',
    custom_hint: 'وزن (کیلوگرم)',
    custom_max: 50
  },
  roast: {
    title: 'میزان رست',
    options: [
      { label: 'لایت رست' },
      { label: 'مدیوم رست' },
      { label: 'دارک رست' }
    ]
  },
  blend: { groups: [] },
  rounding: 1000
};

/* ==========================================================
   ۲) ابزارهای کمکی
   ========================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** ساخت المان به‌صورت امن (بدون innerHTML، تا محتوای پنل مدیریت هرگز به‌عنوان کد اجرا نشود) */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'role' || key.startsWith('data-') || key.startsWith('aria-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  [].concat(children).forEach((child) => child && node.append(child));
  return node;
}

function formatPrice(n) {
  return Number(n).toLocaleString('fa-IR') + ' ' + CONFIG.currency;
}

function toLatinDigits(str) {
  return String(str)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function onlyDigits(str) {
  return toLatinDigits(str).replace(/\D/g, '');
}

function toNumber(v, fallback = 0) {
  const n = Number(toLatinDigits(String(v ?? '')).replace(/[٫,]/g, '.'));
  return Number.isFinite(n) ? n : fallback;
}

/** نمایش وزن با ارقام فارسی (مثلاً ۲٫۵) */
function formatKg(kg) {
  return Number(kg).toLocaleString('fa-IR', { maximumFractionDigits: 2 });
}

let toastTimer;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-show'), 2200);
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* نادیده */ }
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  return res.json();
}

/** تصویر با جایگزین خودکار در صورت خراب بودن آدرس */
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

/** هر خط از متن، یک پاراگراف */
function paragraphs(text) {
  return String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => el('p', { text: l }));
}

/* ==========================================================
   ۳) تنظیمات سایت (settings.json)
   ========================================================== */
const state = {
  settings: {},
  categories: [],
  products: [],
  options: DEFAULT_OPTIONS,
  cart: []   // [{ id, qty, sel:{ w, kg, roast, blend:{} } }]
};

function cleanHandle(value, allowDot) {
  const v = String(value || '').trim()
    .replace(/^(https?:\/\/)?(www\.)?(instagram\.com|t\.me|telegram\.me|rubika\.ir)\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  const re = allowDot ? /^[A-Za-z0-9._]{1,40}$/ : /^[A-Za-z0-9_]{3,40}$/;
  return re.test(v) ? v : '';
}

function cleanWhatsApp(value) {
  let d = onlyDigits(String(value || '').replace(/^.*wa\.me\//i, ''));
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

function applySettings() {
  const s = state.settings;

  $$('[data-s]').forEach((node) => {
    const value = s[node.dataset.s];
    if (typeof value === 'string' && value.trim()) node.textContent = value.trim();
  });

  if (typeof s.about_text === 'string' && s.about_text.trim()) {
    $('#about-text').replaceChildren(...paragraphs(s.about_text));
  }

  buildContact();
  buildSupport();
  buildFooterSocials();

  const note = $('#shipping-note');
  const shipping = typeof s.shipping_note === 'string' ? s.shipping_note.trim() : '';
  note.textContent = shipping;
  note.hidden = !shipping;
}

/** لینک‌های تماس؛ فقط مواردی که پر شده‌اند. chat=true یعنی برای بخش پشتیبانی هم مناسب است */
function contactLinks() {
  const s = state.settings;
  const links = [];
  const phone = String(s.phone || '').trim();
  const wa = cleanWhatsApp(s.whatsapp);
  const tg = cleanHandle(s.telegram, false);
  const ig = cleanHandle(s.instagram, true);
  const rb = cleanHandle(s.rubika, false);
  const email = String(s.email || '').trim();

  if (phone && telHref(phone)) links.push({ label: 'تلفن', text: phone, href: telHref(phone), ltr: true, chat: true });
  if (wa) links.push({ label: 'واتس‌اپ', text: '+' + wa, href: 'https://wa.me/' + wa, ltr: true, external: true, chat: true });
  if (tg) links.push({ label: 'تلگرام', text: '@' + tg, href: 'https://t.me/' + tg, ltr: true, external: true, chat: true });
  if (rb) links.push({ label: 'روبیکا', text: '@' + rb, href: 'https://rubika.ir/' + rb, ltr: true, external: true, chat: true });
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

/** دکمه‌های پشتیبانی (تلفن، واتس‌اپ، تلگرام، روبیکا) */
function buildSupport() {
  const box = $('#support-links');
  box.replaceChildren();
  const chat = contactLinks().filter((l) => l.chat);
  chat.forEach((l) => {
    const a = el('a', { class: 'btn btn-ghost', href: l.href, text: l.label });
    if (l.external) { a.target = '_blank'; a.rel = 'noopener'; }
    box.append(a);
  });
  box.hidden = chat.length === 0;
}

function buildFooterSocials() {
  const box = $('#footer-socials');
  box.replaceChildren();
  contactLinks().filter((l) => l.external).forEach((l) => {
    box.append(el('a', { href: l.href, text: l.label, target: '_blank', rel: 'noopener' }));
  });
}

/* ==========================================================
   ۴) داده‌ها
   ========================================================== */

/** پاک‌سازی دسته‌بندی‌ها */
function normalizeCategories(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c === 'object' && c.name)
    .map((c, i) => {
      let id = String(c.id || 'cat-' + (i + 1)).trim();
      while (seen.has(id)) id += '-2';
      seen.add(id);
      return {
        id,
        name: String(c.name),
        description: String(c.description || ''),
        image: String(c.image || ''),
        show_roast: c.show_roast !== false,   // نمایش «میزان رست» (پیش‌فرض: بله)
        show_blend: c.show_blend === true     // نمایش «نوع قهوه ربوستا/عربیکا» (پیش‌فرض: خیر)
      };
    });
}

/** پاک‌سازی ردیف‌های تعرفه‌ی ترکیبی یک محصول */
function cleanPriceRows(list) {
  const t = (v) => toLatinDigits(String(v == null ? '' : v)).trim();
  return (Array.isArray(list) ? list : [])
    .map((r) => (r && typeof r === 'object' ? {
      w: t(r.weight),
      roast: String(r.roast || '').trim(),
      b: [String(r.blend_1 || '').trim(), String(r.blend_2 || '').trim()],
      price: toNumber(r.price, 0)
    } : null))
    .filter((r) => r && ['250', '500', '1000', 'custom'].includes(r.w) && r.price > 0);
}

/** پاک‌سازی محصولات */
function normalizeProducts(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p === 'object' && p.name)
    .map((p, index) => {
      let id = String(p.id || 'item-' + (index + 1)).trim();
      while (seen.has(id)) id += '-2';
      seen.add(id);

      const num = (v) => { const n = toNumber(v, 0); return n > 0 ? n : 0; };
      let p1000 = num(p.price_1000);
      // سازگاری با فرمت قدیمی: فقط یک فیلد price
      if (!p1000 && !num(p.price_250) && !num(p.price_500) && num(p.price)) p1000 = num(p.price);

      const product = {
        id,
        name: String(p.name),
        category: String(p.category || ''),
        description: String(p.description || ''),
        image: String(p.image || ''),
        price_250: num(p.price_250),
        price_500: num(p.price_500),
        price_1000: p1000,
        price_per_kg_over: num(p.price_per_kg_over),
        prices: cleanPriceRows(p.prices)
      };
      product.available = p.available !== false && minPrice(product) > 0;
      return product;
    });
}

/** پاک‌سازی تعرفه‌ها و گزینه‌ها (options.json) با جایگزین پیش‌فرض */
function normalizeOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULT_OPTIONS;
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);

  const cleanList = (list) => (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x === 'object' && String(x.label || '').trim())
    .map((x) => ({ label: String(x.label).trim() }));

  const w = o.weight || {};
  const roast = o.roast || {};
  const groupsRaw = o.blend && Array.isArray(o.blend.groups) ? o.blend.groups : [];

  const rounding = toNumber(o.rounding, D.rounding);
  const customMax = toNumber(w.custom_max, D.weight.custom_max);

  return {
    weight: {
      title: str(w.title, D.weight.title),
      label_250: str(w.label_250, D.weight.label_250),
      label_500: str(w.label_500, D.weight.label_500),
      label_1000: str(w.label_1000, D.weight.label_1000),
      label_custom: str(w.label_custom, D.weight.label_custom),
      custom_hint: str(w.custom_hint, D.weight.custom_hint),
      custom_max: customMax > 1 ? customMax : D.weight.custom_max
    },
    roast: {
      title: str(roast.title, D.roast.title),
      options: Array.isArray(roast.options) ? cleanList(roast.options) : D.roast.options
    },
    blend: {
      groups: groupsRaw
        .filter((g) => g && String(g.title || '').trim())
        .map((g) => ({ title: String(g.title).trim(), options: cleanList(g.options) }))
        .filter((g) => g.options.length)
    },
    rounding: rounding > 0 ? rounding : 1
  };
}

async function loadData() {
  const get = async (url, fallback) => {
    try { return await fetchJSON(url); } catch (err) { console.error('خطا در بارگذاری ' + url, err); return fallback; }
  };
  const [cats, prods, opts] = await Promise.all([
    get(CONFIG.categoriesUrl, null),
    get(CONFIG.productsUrl, null),
    get(CONFIG.optionsUrl, null)
  ]);
  state.loadFailed = !cats || !prods;
  state.categories = normalizeCategories(cats && (Array.isArray(cats) ? cats : cats.categories));
  state.products = normalizeProducts(prods && (Array.isArray(prods) ? prods : prods.products));
  state.options = normalizeOptions(opts);
}

const categoryOf = (product) => state.categories.find((c) => c.id === product.category);

/* ==========================================================
   ۵) محاسبه‌ی قیمت
   ----------------------------------------------------------
   هر محصول در products.json یک لیست «prices» دارد؛ هر ردیف قیمت یک ترکیب است:
     weight   : 250 | 500 | 1000 | custom   (custom = قیمت هر کیلوگرم برای «بیش از ۱ کیلوگرم»)
     roast    : نام گزینه‌ی رست (خالی = برای همه‌ی رست‌ها)
     blend_1  : زیرشاخه‌ی گروه اول (ربوستا) (خالی = همه)
     blend_2  : زیرشاخه‌ی گروه دوم (عربیکا) (خالی = همه)
     price    : قیمت همان ترکیب
   اگر چند ردیف با انتخاب مشتری جور باشد، ردیفی که «دقیق‌تر» است (فیلد پر بیشتر) برنده است.
   اگر ردیفی پیدا نشود، قیمت‌های پایه‌ی محصول (price_250 / price_500 / price_1000 /
   price_per_kg_over) به‌عنوان جایگزین استفاده می‌شود.
   قیمت نهایی در مضرب rounding (پیش‌فرض ۱۰۰۰ تومان) گرد می‌شود.
   ========================================================== */
const TIER_KG = { '250': 0.25, '500': 0.5, '1000': 1 };

function minPrice(p) {
  const v = [p.price_250, p.price_500, p.price_1000]
    .concat(p.prices.filter((r) => r.w !== 'custom').map((r) => r.price))
    .filter((x) => x > 0);
  return v.length ? Math.min(...v) : (customRate(p) || 0);
}

/** قیمت پایه‌ی هر کیلوگرم برای وزن‌های بیش از ۱ کیلوگرم */
function perKgOver(p) {
  return p.price_per_kg_over > 0 ? p.price_per_kg_over : p.price_1000;
}
function customRate(p) {
  const rows = p.prices.filter((r) => r.w === 'custom').map((r) => r.price);
  return perKgOver(p) || (rows.length ? Math.min(...rows) : 0);
}
const hasCustom = (p) => customRate(p) > 0;

/** وزن‌های قابل انتخاب برای یک محصول (فقط وزن‌هایی که قیمت دارند) */
function weightTiers(p) {
  const W = state.options.weight;
  const base = { '250': p.price_250, '500': p.price_500, '1000': p.price_1000 };
  return [
    { id: '250', label: W.label_250, kg: TIER_KG['250'] },
    { id: '500', label: W.label_500, kg: TIER_KG['500'] },
    { id: '1000', label: W.label_1000, kg: TIER_KG['1000'] }
  ].filter((t) => base[t.id] > 0 || p.prices.some((r) => r.w === t.id));
}

/** ردیف تعرفه‌ای که بهترین تطبیق را با انتخاب مشتری دارد (یا null) */
function findRule(product, sel, category) {
  const useRoast = roastShown(category);
  const groups = activeGroups(category);
  let best = null;
  let bestScore = -1;
  product.prices.forEach((r) => {
    if (r.w !== sel.w) return;
    let score = 0;
    if (useRoast && r.roast) { if (r.roast !== sel.roast) return; score++; }
    for (let i = 0; i < Math.min(groups.length, 2); i++) {
      if (r.b[i]) { if (r.b[i] !== (sel.blend || {})[groups[i].title]) return; score++; }
    }
    if (score > bestScore) { best = r; bestScore = score; }
  });
  return best;
}

/** گزینه‌ای که برای این دسته نمایش داده می‌شود */
function activeGroups(category) {
  return category && category.show_blend ? state.options.blend.groups : [];
}
function roastShown(category) {
  return Boolean(category) && category.show_roast && state.options.roast.options.length > 0;
}

/** وزن واردشده توسط مشتری؛ فقط وزن بیشتر از ۱ و تا سقف مجاز پذیرفته می‌شود */
function parseCustomKg(value) {
  const kg = toNumber(value, NaN);
  const max = state.options.weight.custom_max;
  return kg > 1 && kg <= max ? Math.round(kg * 100) / 100 : null;
}

/**
 * محاسبه‌ی قیمت یک ردیف.
 * sel = { w: '250'|'500'|'1000'|'custom', kg, roast, blend:{ [عنوان گروه]: [برچسب گزینه] } }
 * خروجی: { price, kg } یا null اگر انتخاب‌ها ناقص/نامعتبر باشد.
 */
function computePrice(product, sel) {
  const category = categoryOf(product);
  let kg;

  if (sel.w === 'custom') {
    kg = parseCustomKg(sel.kg);
    if (kg === null) return null;
  } else {
    const tier = weightTiers(product).find((t) => t.id === sel.w);
    if (!tier) return null;
    kg = tier.kg;
  }

  // همه‌ی انتخاب‌های لازم باید انجام شده باشد
  if (roastShown(category) && !state.options.roast.options.some((o) => o.label === sel.roast)) return null;
  for (const g of activeGroups(category)) {
    if (!g.options.some((x) => x.label === (sel.blend || {})[g.title])) return null;
  }

  const rule = findRule(product, sel, category);
  let total;
  if (rule) total = sel.w === 'custom' ? rule.price * kg : rule.price;
  else if (sel.w === 'custom') total = perKgOver(product) * kg;
  else total = product['price_' + sel.w];

  if (!(total > 0)) return null;
  const step = state.options.rounding;
  return { price: Math.round(total / step) * step, kg };
}

/** خلاصه‌ی انتخاب‌ها برای نمایش در سبد و ارسال همراه سفارش: [[عنوان، مقدار], ...] */
function selectionParts(product, sel, kg) {
  const category = categoryOf(product);
  const W = state.options.weight;
  const parts = [[W.title, sel.w === 'custom' ? formatKg(kg) + ' کیلوگرم'
    : (weightTiers(product).find((t) => t.id === sel.w) || {}).label || '']];
  if (roastShown(category)) parts.push([state.options.roast.title, sel.roast]);
  activeGroups(category).forEach((g) => parts.push([g.title, (sel.blend || {})[g.title]]));
  return parts;
}

/* ==========================================================
   ۶) مسیریابی و صفحه‌ها
   مسیرها (hash):  #/category/<شناسه>   #/product/<شناسه>   یا لنگر صفحه‌ی اصلی (#about ...)
   ========================================================== */
const VIEWS = { home: '#view-home', category: '#view-category', product: '#view-product' };
let currentView = 'home';
let homeScrollY = 0;
const BASE_TITLE = 'AZ COFFEE | فروشگاه تخصصی قهوه';

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function currentRoute() {
  const h = location.hash || '';
  let m = h.match(/^#\/category\/([^/]+)$/);
  if (m) return { name: 'category', id: safeDecode(m[1]) };
  m = h.match(/^#\/product\/([^/]+)$/);
  if (m) return { name: 'product', id: safeDecode(m[1]) };
  return { name: 'home', anchor: h.startsWith('#') && !h.startsWith('#/') ? safeDecode(h.slice(1)) : '' };
}

function route() {
  const r = currentRoute();
  if (currentView === 'home' && r.name !== 'home') homeScrollY = window.scrollY;

  Object.entries(VIEWS).forEach(([name, sel]) => { $(sel).hidden = name !== r.name; });
  closeDrawer(true);

  if (r.name === 'category') renderCategory(r.id);
  else if (r.name === 'product') renderProduct(r.id);
  else document.title = BASE_TITLE;

  if (r.name !== 'home') {
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else {
    const target = r.anchor ? document.getElementById(r.anchor) : null;
    requestAnimationFrame(() => {
      if (target) target.scrollIntoView();
      else if (currentView !== 'home') window.scrollTo({ top: homeScrollY, behavior: 'instant' });
    });
  }
  currentView = r.name;
}

/** صفحه‌ی «پیدا نشد» */
function renderNotFound(root, text, href, linkText) {
  root.replaceChildren(
    el('p', { class: 'status', text }),
    el('a', { class: 'btn btn-primary', href, text: linkText })
  );
}

/* ---------- صفحه‌ی اصلی: کارت‌های دسته‌بندی ---------- */
function renderCategories() {
  const grid = $('#category-grid');
  const status = $('#categories-status');
  grid.replaceChildren();

  if (state.loadFailed) {
    status.hidden = false;
    status.textContent = 'بارگذاری دسته‌بندی‌ها انجام نشد. لطفاً صفحه را دوباره باز کنید.';
    return;
  }
  status.hidden = state.categories.length > 0;
  if (!state.categories.length) status.textContent = 'به‌زودی محصولات جدید اضافه می‌شود.';

  state.categories.forEach((c) => {
    grid.append(el('a', { class: 'cat-card', href: '#/category/' + encodeURIComponent(c.id) }, [
      makeImage(c.image, '', 'cat-img', 480, 360),
      el('span', { class: 'cat-title', text: c.name })
    ]));
  });
}

/* ---------- صفحه‌ی دسته‌بندی: لیست محصولات ---------- */
function renderCategory(id) {
  const root = $('#view-category');
  const category = state.categories.find((c) => c.id === id);
  if (!category) {
    document.title = BASE_TITLE;
    renderNotFound(root, 'این دسته‌بندی پیدا نشد.', '#categories', 'بازگشت به دسته‌بندی‌ها');
    return;
  }
  document.title = category.name + ' | AZ COFFEE';

  const items = state.products
    .filter((p) => p.category === category.id)
    .sort((a, b) => Number(b.available) - Number(a.available));

  const grid = el('div', { class: 'product-grid' });
  items.forEach((p) => {
    grid.append(el('a', { class: 'card' + (p.available ? '' : ' is-soldout'), href: '#/product/' + encodeURIComponent(p.id) }, [
      makeImage(p.image, p.name, 'card-img', 640, 480),
      el('div', { class: 'card-body' }, [
        el('h3', { class: 'card-title', text: p.name }),
        el('p', { class: 'card-desc', text: p.description.replace(/\n+/g, ' ') }),
        el('div', { class: 'card-price', text: p.available ? 'از ' + formatPrice(minPrice(p)) : 'ناموجود' })
      ])
    ]));
  });

  root.replaceChildren(
    el('a', { class: 'back-link', href: '#categories', text: '‹ بازگشت به دسته‌بندی‌ها' }),
    el('h1', { class: 'view-title', text: category.name }),
    category.description ? el('p', { class: 'view-sub', text: category.description }) : el('div', { class: 'view-sub' }),
    items.length ? grid : el('p', { class: 'status', text: 'هنوز محصولی در این دسته ثبت نشده است.' })
  );
}

/* ---------- صفحه‌ی محصول ---------- */
function renderProduct(id) {
  const root = $('#view-product');
  const product = state.products.find((p) => p.id === id);
  if (!product) {
    document.title = BASE_TITLE;
    renderNotFound(root, 'این محصول پیدا نشد.', '#categories', 'بازگشت به دسته‌بندی‌ها');
    return;
  }
  document.title = product.name + ' | AZ COFFEE';
  const category = categoryOf(product);
  const O = state.options;

  /* انتخاب‌های مشتری */
  const sel = { w: '', kg: '', roast: '', blend: {} };

  /* تعریف ردیف‌های انتخابگر: هر ردیف یک یا چند «سرتیتر» دارد و یک نوار گزینه */
  const weightOpts = weightTiers(product).map((t) => ({ id: t.id, label: t.label }));
  if (hasCustom(product)) weightOpts.push({ id: 'custom', label: O.weight.label_custom });

  const rowsDef = [[{ kind: 'weight', title: O.weight.title, options: weightOpts }]];
  if (roastShown(category)) {
    rowsDef.push([{ kind: 'roast', title: O.roast.title, options: O.roast.options.map((o) => ({ id: o.label, label: o.label })) }]);
  }
  const groups = activeGroups(category);
  if (groups.length) {
    rowsDef.push(groups.map((g) => ({ kind: 'blend', group: g.title, title: g.title, options: g.options.map((o) => ({ id: o.label, label: o.label })) })));
  }

  const getVal = (d) => (d.kind === 'weight' ? sel.w : d.kind === 'roast' ? sel.roast : sel.blend[d.group] || '');
  const setVal = (d, v) => {
    if (d.kind === 'weight') sel.w = v;
    else if (d.kind === 'roast') sel.roast = v;
    else sel.blend[d.group] = v;
  };
  const displayVal = (d) => {
    const v = getVal(d);
    if (!v) return '';
    if (d.kind === 'weight' && v === 'custom') {
      const kg = parseCustomKg(sel.kg);
      return kg ? formatKg(kg) + ' کیلوگرم' : O.weight.label_custom;
    }
    return (d.options.find((o) => o.id === v) || {}).label || '';
  };

  const priceEl = el('strong', { class: 'pdp-price' });
  const priceLabel = el('span', { class: 'pdp-price-label' });
  const errorEl = el('p', { class: 'pdp-error', role: 'alert' });
  errorEl.hidden = true;

  const rows = [];
  const paintAll = () => rows.forEach((r) => r.paint());

  function refreshPrice() {
    const res = computePrice(product, sel);
    if (res) { priceLabel.textContent = 'قیمت نهایی'; priceEl.textContent = formatPrice(res.price); }
    else { priceLabel.textContent = 'قیمت از'; priceEl.textContent = formatPrice(minPrice(product)); }
    errorEl.hidden = true;
    // همه‌ی انتخاب‌ها انجام شده ولی برای این ترکیب قیمتی ثبت نشده
    if (!res && !firstMissing()) {
      errorEl.textContent = 'برای این ترکیب قیمتی ثبت نشده است؛ لطفاً ترکیب دیگری انتخاب کنید.';
      errorEl.hidden = false;
    }
  }

  /** ساخت یک ردیف انتخابگر */
  function buildRow(defs) {
    const wrap = el('div', { class: 'sel' });
    const heads = el('div', { class: 'sel-heads' });
    const bar = el('div', { class: 'sel-bar' });
    bar.hidden = true;
    let openIdx = -1;

    const kgInput = el('input', {
      type: 'text', class: 'kg-input', placeholder: O.weight.custom_hint,
      'aria-label': O.weight.custom_hint
    });
    kgInput.inputMode = 'decimal';
    kgInput.addEventListener('input', () => { sel.kg = kgInput.value; paintAll(); refreshPrice(); });

    const valEls = defs.map(() => el('span', { class: 'sel-val' }));
    const headBtns = defs.map((d, i) => {
      const b = el('button', { type: 'button', class: 'sel-head', 'aria-expanded': 'false' }, [
        el('span', { class: 'sel-title', text: d.title }), valEls[i]
      ]);
      b.addEventListener('click', () => (openIdx === i ? closeBar() : openBar(i)));
      heads.append(b);
      return b;
    });

    function paint() {
      defs.forEach((d, i) => {
        const v = displayVal(d);
        valEls[i].textContent = v || 'انتخاب کنید';
        valEls[i].classList.toggle('is-empty', !v);
      });
    }

    function closeBar() {
      openIdx = -1;
      bar.hidden = true;
      headBtns.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }

    function openBar(i) {
      openIdx = i;
      const d = defs[i];
      bar.replaceChildren();
      d.options.forEach((o) => {
        const active = getVal(d) === o.id;
        const b = el('button', { type: 'button', class: 'opt' + (active ? ' is-active' : ''), text: o.label, 'aria-pressed': String(active) });
        b.addEventListener('click', () => {
          setVal(d, o.id);
          paint();
          refreshPrice();
          if (d.kind === 'weight' && o.id === 'custom') { openBar(i); kgInput.focus(); }
          else closeBar();
        });
        bar.append(b);
        // کادر وزن دلخواه، کنار گزینه‌ی «بیش از ۱ کیلوگرم»
        if (d.kind === 'weight' && o.id === 'custom' && sel.w === 'custom') {
          bar.append(el('span', { class: 'kg-wrap' }, [kgInput, el('span', { class: 'kg-unit', text: 'کیلوگرم' })]));
        }
      });
      bar.hidden = false;
      headBtns.forEach((b, j) => b.setAttribute('aria-expanded', String(j === i)));
    }

    wrap.append(heads, bar);
    const row = { el: wrap, defs, paint, openBar };
    rows.push(row);
    paint();
    return row;
  }

  /** اولین انتخاب ناقص را پیدا می‌کند (برای پیام خطا) */
  function firstMissing() {
    for (const row of rows) {
      for (let i = 0; i < row.defs.length; i++) {
        const d = row.defs[i];
        if (!getVal(d)) {
          return { row, i, msg: 'لطفاً «' + d.title + '» را انتخاب کنید.' };
        }
        if (d.kind === 'weight' && sel.w === 'custom' && parseCustomKg(sel.kg) === null) {
          return { row, i, msg: 'وزن را به کیلوگرم و بیشتر از ۱ (تا ' + formatKg(O.weight.custom_max) + ') وارد کنید.' };
        }
      }
    }
    return null;
  }

  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', text: product.available ? 'افزودن به سبد خرید' : 'ناموجود', disabled: !product.available });
  addBtn.addEventListener('click', () => {
    const missing = firstMissing();
    const res = missing ? null : computePrice(product, sel);
    if (missing || !res) {
      errorEl.textContent = missing ? missing.msg : 'برای این ترکیب قیمتی ثبت نشده است.';
      errorEl.hidden = false;
      if (missing) missing.row.openBar(missing.i);
      return;
    }
    addToCart(product.id, {
      w: sel.w,
      kg: sel.w === 'custom' ? String(res.kg) : '',
      roast: roastShown(category) ? sel.roast : '',
      blend: Object.fromEntries(groups.map((g) => [g.title, sel.blend[g.title]]))
    });
  });

  const buildRows = product.available ? rowsDef.map(buildRow) : [];
  refreshPrice();

  root.replaceChildren(
    el('a', { class: 'back-link', href: category ? '#/category/' + encodeURIComponent(category.id) : '#categories', text: '‹ ' + (category ? category.name : 'بازگشت') }),
    el('article', { class: 'pdp' }, [
      makeImage(product.image, product.name, 'pdp-img', 800, 600),
      el('h1', { class: 'pdp-title', text: product.name }),
      el('div', { class: 'pdp-desc' }, paragraphs(product.description)),
      ...buildRows.map((r) => r.el),
      el('div', { class: 'pdp-buy' }, [
        el('div', { class: 'pdp-price-row' }, [priceLabel, priceEl]),
        errorEl,
        addBtn
      ])
    ])
  );
}

/* ==========================================================
   ۷) سبد خرید
   ========================================================== */
const cartKeyOf = (id, sel) => JSON.stringify([id, sel.w, sel.kg, sel.roast, Object.entries(sel.blend || {}).sort()]);

function cleanSel(s) {
  const sel = s && typeof s === 'object' ? s : {};
  const blend = sel.blend && typeof sel.blend === 'object' ? sel.blend : {};
  return {
    w: String(sel.w || ''),
    kg: String(sel.kg || ''),
    roast: String(sel.roast || ''),
    blend: Object.fromEntries(Object.entries(blend).map(([k, v]) => [String(k), String(v)]))
  };
}

function loadCart() {
  try {
    const raw = JSON.parse(storageGet(CONFIG.cartKey) || '[]');
    state.cart = Array.isArray(raw)
      ? raw
          .filter((i) => i && typeof i.id === 'string' && Number.isInteger(i.qty) && i.qty > 0)
          .map((i) => ({ id: i.id, qty: Math.min(i.qty, CONFIG.maxQty), sel: cleanSel(i.sel) }))
      : [];
  } catch {
    state.cart = [];
  }
}

function saveCart() {
  storageSet(CONFIG.cartKey, JSON.stringify(state.cart));
}

/** ردیف‌های سبد با قیمت «به‌روز» از تعرفه‌ی فعلی؛ ردیف نامعتبر (محصول/گزینه‌ی حذف‌شده) کنار گذاشته می‌شود */
function cartLines() {
  const lines = [];
  state.cart.forEach((item) => {
    const product = state.products.find((p) => p.id === item.id);
    if (!product || !product.available) return;
    const res = computePrice(product, item.sel);
    if (!res) return;
    lines.push({
      item, product, qty: item.qty,
      unit: res.price, kg: res.kg,
      subtotal: res.price * item.qty,
      parts: selectionParts(product, item.sel, res.kg)
    });
  });
  return lines;
}

function cartTotal() {
  return cartLines().reduce((sum, l) => sum + l.subtotal, 0);
}

function pruneCart() {
  const valid = new Set(cartLines().map((l) => l.item));
  const before = state.cart.length;
  state.cart = state.cart.filter((i) => valid.has(i));
  if (state.cart.length !== before) saveCart();
}

function addToCart(id, sel) {
  const key = cartKeyOf(id, sel);
  const existing = state.cart.find((i) => cartKeyOf(i.id, i.sel) === key);
  if (existing) {
    if (existing.qty >= CONFIG.maxQty) { showToast('حداکثر تعداد مجاز برای این مورد'); return; }
    existing.qty += 1;
  } else {
    state.cart.push({ id, qty: 1, sel });
  }
  saveCart();
  renderCart();
  showToast('به سبد خرید اضافه شد');
}

function changeQty(item, delta) {
  item.qty = Math.min(item.qty + delta, CONFIG.maxQty);
  if (item.qty <= 0) state.cart = state.cart.filter((i) => i !== item);
  saveCart();
  renderCart();
}

function removeFromCart(item) {
  state.cart = state.cart.filter((i) => i !== item);
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

  lines.forEach((l) => {
    const minus = el('button', { type: 'button', text: '−', 'aria-label': 'کم کردن' });
    const plus = el('button', { type: 'button', text: '+', 'aria-label': 'زیاد کردن' });
    const remove = el('button', { type: 'button', class: 'ci-remove', text: 'حذف' });
    minus.addEventListener('click', () => changeQty(l.item, -1));
    plus.addEventListener('click', () => changeQty(l.item, +1));
    remove.addEventListener('click', () => removeFromCart(l.item));

    list.append(el('li', { class: 'cart-item' }, [
      makeImage(l.product.image, '', '', 64, 64),
      el('div', {}, [
        el('div', { class: 'ci-name', text: l.product.name }),
        el('div', { class: 'ci-opts', text: l.parts.map(([k, v]) => k + ': ' + v).join(' | ') }),
        el('div', { class: 'ci-price', text: formatPrice(l.unit) + (l.qty > 1 ? ' × ' + l.qty.toLocaleString('fa-IR') + ' = ' + formatPrice(l.subtotal) : '') }),
        el('div', { class: 'ci-row' }, [
          el('div', { class: 'qty' }, [minus, el('span', { text: l.qty.toLocaleString('fa-IR') }), plus]),
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

  if (!lines.length && !$('#view-checkout').hidden) showView('cart');
}

/* ==========================================================
   ۸) پنل‌های کشویی (منو از راست، سبد از چپ)
   ========================================================== */
const DRAWERS = { cart: '#cart-drawer', menu: '#menu-drawer' };
let openName = null;
let lastFocus = null;

function showView(name) {
  ['cart', 'checkout', 'success'].forEach((v) => { $('#view-' + v).hidden = v !== name; });
  const target = { cart: '#cart-close', checkout: '#f-name', success: '#success-close' }[name];
  const node = $(target);
  if (node && openName === 'cart') node.focus({ preventScroll: true });
}

function openDrawer(name) {
  if (openName === name) return;
  if (openName) closeDrawer(true);
  lastFocus = document.activeElement;
  const d = $(DRAWERS[name]);
  d.inert = false;
  d.classList.add('is-open');
  $('#overlay').hidden = false;
  document.body.classList.add('no-scroll');
  openName = name;
  $('#toast').classList.remove('is-show');
  if (name === 'cart') showView('cart');
  else $('#menu-close').focus({ preventScroll: true });
}

/** keepFocus=true یعنی فوکوس به دکمه‌ی قبلی برنگردد */
function closeDrawer(keepFocus) {
  if (!openName) return;
  const d = $(DRAWERS[openName]);
  d.classList.remove('is-open');
  d.inert = true;
  $('#overlay').hidden = true;
  document.body.classList.remove('no-scroll');
  openName = null;
  if (!keepFocus && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

function trapFocus(e) {
  if (e.key !== 'Tab' || !openName) return;
  const d = $(DRAWERS[openName]);
  const items = $$('button:not([disabled]), a[href], input, textarea', d).filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function initDrawers() {
  $('#cart-open').addEventListener('click', () => openDrawer('cart'));
  $('#cart-close').addEventListener('click', () => closeDrawer());
  $('#success-close').addEventListener('click', () => closeDrawer());
  $('#menu-open').addEventListener('click', () => openDrawer('menu'));
  $('#menu-close').addEventListener('click', () => closeDrawer());
  $('#overlay').addEventListener('click', () => closeDrawer());
  // کلیک روی هر لینک منو، پنل را می‌بندد (و صفحه به مقصد می‌رود)
  $('#menu-drawer').addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(true); });

  $('#btn-checkout').addEventListener('click', () => { fillSavedCustomer(); showView('checkout'); });
  $('#checkout-back').addEventListener('click', () => showView('cart'));
  $('#checkout-form').addEventListener('submit', handleCheckoutSubmit);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
    trapFocus(e);
  });
  // هماهنگی سبد بین چند تب مرورگر
  window.addEventListener('storage', (e) => {
    if (e.key === CONFIG.cartKey) { loadCart(); pruneCart(); renderCart(); }
  });
}

/* ==========================================================
   ۹) پرداخت (آماده‌ی اتصال درگاه)
   ----------------------------------------------------------
   در این فایل هیچ کد درگاه پرداختی وجود ندارد.

   برای اتصال درگاه: فایل جداگانه‌ی payment.js بسازید و در آن
   تابع window.AZ_ORDER_HANDLER(order, api) را تعریف کنید، سپس خط
   <script src="payment.js"></script> را در index.html فعال کنید.
   (نمونه‌ی کامل در README، بخش «اتصال درگاه پرداخت»)

   order.items[i] = { id, name, qty, price (قیمت واحد), kg, options:{ عنوان: مقدار } }

   تا زمانی که این تابع تعریف نشده، با زدن «پرداخت» فقط پیام
   «پرداخت آنلاین هنوز فعال نشده» نمایش داده می‌شود و سبد حفظ می‌شود.
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
    items: lines.map((l) => ({
      id: l.product.id,
      name: l.product.name,
      qty: l.qty,
      price: l.unit,
      kg: l.kg,
      options: Object.fromEntries(l.parts)
    })),
    total: cartTotal(),
    createdAt: new Date().toISOString()
  };

  storageSet(CONFIG.customerKey, JSON.stringify(order.customer));

  if (typeof window.AZ_ORDER_HANDLER !== 'function') {
    showView('success');
    return;
  }

  const submitBtn = $('#btn-submit');
  submitBtn.disabled = true;
  try {
    await window.AZ_ORDER_HANDLER(order, { clearCart, closeCart: closeDrawer, showToast, formatPrice });
  } catch (err) {
    console.error('خطا در پرداخت:', err);
    errorBox.hidden = false;
    errorBox.textContent = 'اتصال به درگاه پرداخت انجام نشد. لطفاً دوباره تلاش کنید.';
  } finally {
    submitBtn.disabled = false;
  }
}

/* ==========================================================
   ۱۰) شروع برنامه
   ========================================================== */
async function init() {
  $('#year').textContent = new Date().getFullYear().toLocaleString('fa-IR', { useGrouping: false });
  initDrawers();
  loadCart();
  window.addEventListener('hashchange', route);

  await Promise.all([loadSettings(), loadData()]);
  applySettings();
  pruneCart();
  renderCategories();
  renderCart();
  route();
}

document.addEventListener('DOMContentLoaded', init);
