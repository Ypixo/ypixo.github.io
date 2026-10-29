/*
 * Изгиб карточек кейсов при скролле. Сверено по docs/reference/scroll effrct.mov; решение пользователя —
 * все карточки на одной общей дуге (previews/card-scroll-bend), прогиб --motion-bend-max.
 *
 * Скорость скролла (сглаженная) → целевой прогиб 0…max; прогиб догоняет цель по экспоненте: быстро при
 * разгоне (--motion-bend-tau-in), мягко при остановке (--motion-bend-tau-out). Направление не важно.
 * Дуга — высотой в экран: прогиб строки на высоте y экрана b·(1 − ((y − vh/2)/(vh/2))²), у краёв экрана 0.
 * Каждая строка карточки растягивается по горизонтали от центра на свой прогиб: верх и низ прямые,
 * углы скруглённые, боковые края идут по общей дуге. Рисует ::before карточки (styles/main.css).
 * rAF крутится только пока есть движение. Reduced motion — без эффекта.
 */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const cards = [...document.querySelectorAll('[data-scroll-bend]')];
  if (!cards.length) return;

  const time = (v) => { v = v.trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; };
  let max, vFull, tauIn, tauOut, boxes;
  const measure = () => {
    const s = getComputedStyle(document.documentElement);
    max = parseFloat(s.getPropertyValue('--motion-bend-max')) || 12;
    vFull = parseFloat(s.getPropertyValue('--motion-bend-velocity')) || 2200;
    tauIn = time(s.getPropertyValue('--motion-bend-tau-in')) || 60;
    tauOut = time(s.getPropertyValue('--motion-bend-tau-out')) || 160;
    boxes = cards.map((el) => ({ el, w: el.offsetWidth, h: el.offsetHeight, r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 }));
  };
  measure();
  addEventListener('resize', measure);

  const f = (n) => Math.round(n * 100) / 100;
  function path({ w, h, r }, b, top) {
    const half = innerHeight / 2;
    const off = (y) => { const t = (top + y - half) / half; return Math.max(0, b * (1 - t * t)); };
    const pts = [];
    const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
    const side = (x, y0, y1) => { const n = 24; for (let i = 1; i < n; i++) pts.push([x, y0 + (y1 - y0) * (i / n)]); };
    corner(w - r, r, -Math.PI / 2);   // правый верхний
    side(w, r, h - r);
    corner(w - r, h - r, 0);          // правый нижний
    corner(r, h - r, Math.PI / 2);    // левый нижний
    side(0, h - r, r);
    corner(r, r, Math.PI);            // левый верхний
    const cx = w / 2;
    // ::before шире карточки на max с каждой стороны — отсюда сдвиг на max
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(max + cx + (x - cx) * (1 + 2 * off(y) / w))},${f(y)}`).join(' ');
    return `path("${d} Z")`;
  }

  function draw(b) {
    boxes.forEach((box) => {
      const on = b > 0.05;
      box.el.classList.toggle('is-bending', on);
      if (!on) { box.el.style.removeProperty('--bend-path'); return; }
      const top = box.el.getBoundingClientRect().top;
      if (top > innerHeight || top + box.h < 0) return;     // вне экрана — не пересчитываем
      box.el.style.setProperty('--bend-path', path(box, b, top));
    });
  }

  let lastY = scrollY, lastT = 0, vel = 0, bend = 0, raf = 0;
  function frame(now) {
    const dt = Math.max(8, now - lastT); lastT = now;
    const y = scrollY;
    const v = Math.abs(y - lastY) / dt * 1000; lastY = y;
    vel += (v - vel) * (1 - Math.exp(-dt / 50));          // сглаживание скорости
    const target = Math.min(1, vel / vFull) * max;
    bend += (target - bend) * (1 - Math.exp(-dt / (target > bend ? tauIn : tauOut)));
    if (bend < 0.05 && vel < 5) { bend = 0; vel = 0; draw(0); raf = 0; return; }
    draw(bend);
    raf = requestAnimationFrame(frame);
  }
  addEventListener('scroll', () => {
    if (raf || reduce.matches) return;
    lastT = performance.now() - 16;
    raf = requestAnimationFrame(frame);
  }, { passive: true });
})();
