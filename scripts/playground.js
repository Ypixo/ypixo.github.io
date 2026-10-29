/* Главная: инверсия фона на подъезде к блоку Playground.
 * Пока центр слова «Ground» идёт от --motion-invert-start до --motion-invert-end высоты окна,
 * фон страницы плавно темнеет (--color-bg-page → --color-bg-card-inverse), слово светлеет.
 * Ниже блока фон остаётся тёмным; светлеет только при обратном скролле через то же окно.
 * Значения сглажены по времени (--motion-scroll-smoothing), нативный скролл не трогаем.
 * reduced motion — без сглаживания, мгновенная смена в середине окна.
 * Сырых таймингов здесь нет: всё из styles/tokens.css. Отработано в previews/playground.
 */
(() => {
  const root = document.documentElement;
  const section = document.querySelector('.playground');
  if (!section) return;
  const ground = section.querySelector('.playground__ground');

  // центр «Ground» от верха его строки, доля кегля: середина между верхом прописных (0) и базовой линией (0.725)
  const WORD_CENTER = 0.3625;

  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const tok = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  const ms = (v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
  const bezier = (str) => {
    const [x1, y1, x2, y2] = str.match(/-?[\d.]+/g).map(Number);
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 30; i++) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  };
  const seg = (p, from, to) => Math.min(1, Math.max(0, (p - from) / (to - from)));

  let ease, win, smoothing, fontSize;
  const readTokens = () => {
    ease = bezier(tok('--motion-ease-invert'));
    win = {
      start: parseFloat(tok('--motion-invert-start')),
      end: parseFloat(tok('--motion-invert-end')),
      ink: parseFloat(tok('--motion-invert-ink-span')),
    };
    smoothing = ms(tok('--motion-scroll-smoothing')) / 1000;
    fontSize = parseFloat(getComputedStyle(ground).fontSize);
  };

  /* Сглаженный scrollY: x += (цель − x)·(1 − e^(−dt/τ)) — не перелетает цель, после остановки
   * доезжает точно (snap < 0.05 px). Большие прыжки (якорь, восстановление позиции) — сразу. */
  let smY = null, lastNow = 0, raf = 0, snapNext = true;
  let invert = -1, inkInvert = -1;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const themeLight = themeMeta ? themeMeta.content : '';
  const themeDarkColor = tok('--color-bg-card-inverse') || '#171717';
  let themeDark = false;

  const tick = (now) => {
    raf = 0;
    const dt = Math.min(0.064, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;

    // чтение
    const sy = scrollY;
    const top = ground.getBoundingClientRect().top;
    const vh = innerHeight;
    const reduced = reducedMQ.matches;

    // расчёт
    const tau = reduced ? 0 : smoothing;
    if (snapNext || smY === null || tau <= 0.001 || Math.abs(sy - smY) > 3 * vh) {
      smY = sy; snapNext = false;
    } else {
      smY += (sy - smY) * (1 - Math.exp(-dt / tau));
      if (Math.abs(sy - smY) < 0.05) smY = sy;
    }
    const center = top + (sy - smY) + WORD_CENTER * fontSize;
    const x = seg(center / vh, win.start, win.end); // start > end: растёт при скролле вниз
    const t = reduced ? (x >= 0.5 ? 1 : 0) : ease(x);
    // слово меняет цвет в узкой полосе вокруг середины окна, где фон серый и контрастен обоим цветам
    const inkT = reduced ? t : seg(x, 0.5 - win.ink / 2, 0.5 + win.ink / 2);

    // запись
    if (Math.abs(t - invert) >= 1e-4 || Math.abs(inkT - inkInvert) >= 1e-4) {
      invert = t; inkInvert = inkT;
      root.style.setProperty('--pg-invert', t.toFixed(4));
      root.style.setProperty('--pg-ink-invert', inkT.toFixed(4));
      // цвет панелей браузера (theme-color) — как фон страницы: иначе у тёмного низа светлая полоса
      const dark = t >= 0.5;
      if (dark !== themeDark && themeMeta) { themeDark = dark; themeMeta.content = dark ? themeDarkColor : themeLight; }
    }
    if (smY !== sy) raf = requestAnimationFrame(tick); // доезд сглаживания
  };

  const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const resync = () => { readTokens(); snapNext = true; schedule(); };

  readTokens();
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', resync);
  reducedMQ.addEventListener('change', resync);
  document.fonts.ready.then(resync);
  schedule();

  // Для проверки из консоли / iframe
  window.__playground = {
    get invert() { return invert; },
    get smY() { return smY; },
    tick: (now = performance.now()) => tick(now),
    settle() { snapNext = true; tick(performance.now()); },
  };
})();
