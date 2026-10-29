/*
 * Прогресс прочтения кейса: доля = scrollY / (scrollHeight − innerHeight).
 * Скролл слушаем passive, обновляем дугу раз в кадр (rAF).
 * Высоту прокрутки кешируем и пересчитываем только при изменении размеров —
 * в обработчике скролла чтение scrollY и запись stroke-dashoffset (только отрисовка, без layout).
 */
(() => {
  const arc = document.querySelector('.case-progress__arc');
  if (!arc) return;

  const root = document.documentElement;
  let maxScroll = 1;
  let queued = false;
  let shown = null;

  const measure = () => {
    maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
  };

  const render = () => {
    queued = false;
    const p = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
    arc.style.strokeDashoffset = String(100 - p * 100);
    const visible = p > 0.001;
    if (visible !== shown) {
      arc.style.opacity = visible ? '1' : '0';
      shown = visible;
    }
  };

  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(render);
    }
  };

  const remeasure = () => {
    measure();
    request();
  };

  measure();
  render();
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', remeasure, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(remeasure).observe(document.body);
})();
