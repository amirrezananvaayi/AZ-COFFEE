/* ==========================================================
   انیمیشن شروع سایت: مزرعه ← برداشت ← فراوری ← خشک کردن ← رست ← بسته‌بندی ← عصاره‌گیری
   در پایان لوگو ظاهر می‌شود، کم‌رنگ می‌شود و به‌عنوان پس‌زمینه‌ی سایت می‌ماند.
   فقط یک‌بار در هر بار باز کردن سایت (تا بستن تب) نمایش داده می‌شود.
   برای تغییر زمان هر صحنه، اعداد SCENE_MS را (به میلی‌ثانیه) عوض کنید.
   ========================================================== */
(function () {
  'use strict';
  var root = document.documentElement;
  var intro = document.getElementById('intro');
  if (!intro || !root.classList.contains('intro-on')) return;

  var SCENE_MS = [3000, 3000, 2600, 2400, 3000, 3400, 4600];   // مدت هر صحنه
  var LOGO_MS = 2200;                                           // مدت نمایش لوگو
  var scenes = Array.prototype.slice.call(intro.querySelectorAll('.sc'));
  var cap = document.getElementById('intro-cap');
  var bar = document.getElementById('intro-bar');
  var skipBtn = document.getElementById('intro-skip');
  var timers = [];
  var finished = false;

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    try { sessionStorage.setItem('az_intro_seen', '1'); } catch (e) { /* بدون ذخیره هم کار می‌کند */ }
    intro.classList.add('logo-stage', 'out');
    root.classList.add('intro-reveal');
    document.removeEventListener('keydown', onKey);
    later(function () {
      root.classList.remove('intro-on', 'intro-reveal');
      intro.hidden = true;
    }, 1600);
  }

  function onKey(e) { if (e.key === 'Escape') finish(); }

  function playScene(i) {
    if (finished) return;
    if (i >= scenes.length) {
      // مرحله‌ی لوگو
      intro.classList.add('logo-stage');
      later(finish, LOGO_MS);
      return;
    }
    scenes.forEach(function (s, j) { s.classList.toggle('on', j === i); });
    cap.classList.remove('show');
    later(function () { cap.textContent = scenes[i].getAttribute('data-cap') || ''; cap.classList.add('show'); }, 350);
    later(function () { playScene(i + 1); }, SCENE_MS[i] || 3000);
  }

  var total = SCENE_MS.reduce(function (a, b) { return a + b; }, 0) + LOGO_MS;
  bar.style.transition = 'width ' + total + 'ms linear';
  requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.width = '100%'; }); });

  skipBtn.addEventListener('click', finish);
  document.addEventListener('keydown', onKey);
  skipBtn.focus({ preventScroll: true });
  playScene(0);
})();
