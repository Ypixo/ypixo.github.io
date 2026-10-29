/*
 * Сравнение «до/после» ([data-compare], стили — .compare в styles/components.css).
 * Позиция границы — CSS-переменная --compare-pos (0–100 %) на контейнере: её задаёт разметка (стартовая),
 * дальше — перетаскивание (мышь, палец; захват указателя), клик по картинке — граница туда же,
 * клавиатура на ручке: ←/→ по 5 %, Home/End — края. Вертикальный скролл пальцем не мешает:
 * перетаскивание начинается только при горизонтальном жесте (touch-action: pan-y у контейнера).
 */
(function () {
  document.querySelectorAll('[data-compare]').forEach((box) => {
    const handle = box.querySelector('.compare__handle');
    const set = (pct) => {
      const v = Math.max(0, Math.min(100, pct));
      box.style.setProperty('--compare-pos', v.toFixed(2) + '%');
      if (handle) handle.setAttribute('aria-valuenow', String(Math.round(v)));
    };
    const fromX = (x) => { const r = box.getBoundingClientRect(); set(((x - r.left) / r.width) * 100); };

    let dragging = false;
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      box.setPointerCapture(e.pointerId);
      fromX(e.clientX);
    });
    box.addEventListener('pointermove', (e) => { if (dragging) fromX(e.clientX); });
    const stop = () => { dragging = false; };
    box.addEventListener('pointerup', stop);
    box.addEventListener('pointercancel', stop);

    if (handle) handle.addEventListener('keydown', (e) => {
      const now = parseFloat(handle.getAttribute('aria-valuenow')) || 50;
      const map = { ArrowLeft: now - 5, ArrowRight: now + 5, Home: 0, End: 100 };
      if (!(e.key in map)) return;
      e.preventDefault();
      set(map[e.key]);
    });
  });
})();
