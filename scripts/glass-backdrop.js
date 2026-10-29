/*
 * Стекло кнопок подстраивается под то, что под ним.
 * Для каждого элемента с [data-glass-adapt] смотрим, что лежит под его центром,
 * и ставим data-backdrop="dark" | "light". Учитываются:
 *   — сплошные фоны (тёмная карточка, инверсия фона страницы);
 *   — картинки: яркость берётся по пикселям самой картинки в этой точке
 *     (один раз уменьшаем картинку до сетки 24×24 и кэшируем); прозрачные места
 *     картинки пропускаются — смотрим, что под ними;
 *   — картинки обложек, которые не ловят клики (pointer-events: none — elementsFromPoint
 *     их не видит): у контейнера [data-glass-surfaces], картинки внутри — [data-glass-surface],
 *     попадание проверяется по геометрии (с учётом обрезки предком [data-glass-clip]),
 *     верхняя — последняя в DOM. Живой контент (scripts/browser-scroll.js) шлёт
 *     'backdrop:refresh', пока движется, — пересчитываем и без скролла.
 * Стили вариантов — styles/components.css и styles/case.css (прогресс).
 * Чтение и запись разведены: один проход в кадр, только при скролле/ресайзе.
 *
 * Пока идёт переход между страницами (html[data-pt-freeze], ставит page-transition.js), состояние стекла
 * не пересчитывается: цвет подписей остаётся тем, каким был в момент клика. После перехода — 'backdrop:refresh'.
 */
(function () {
  // Скрытые (hidden, MVP) элементы стекло не обрабатывает
  const targets = [...document.querySelectorAll('[data-glass-adapt]')].filter((el) => !el.closest('[hidden]'));
  if (!targets.length) return;

  const GRID = 24;
  const imageGrids = new WeakMap(); // img + src → { lum, alpha: Float32Array } | null

  const parseRgb = (value) => {
    const m = value.match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const [r, g, b, a = 1] = m.map(Number);
    return { r, g, b, a };
  };
  const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  // Сетка яркостей картинки (same-origin, поэтому canvas читается)
  const gridFor = (img) => {
    const cached = imageGrids.get(img);
    if (cached && cached.src === img.currentSrc) return cached.grid;
    if (!img.complete || !img.naturalWidth) return null;
    let grid = null;
    try {
      const c = document.createElement('canvas');
      c.width = GRID; c.height = GRID;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, GRID, GRID);
      const data = ctx.getImageData(0, 0, GRID, GRID).data;
      const lum = new Float32Array(GRID * GRID);
      const alpha = new Float32Array(GRID * GRID);
      for (let i = 0; i < lum.length; i++) {
        alpha[i] = data[i * 4 + 3] / 255;
        // цвет в canvas не премножен: прозрачное место — по альфе, а не «чёрное»
        lum[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      }
      grid = { lum, alpha };
    } catch (e) { grid = null; }
    imageGrids.set(img, { src: img.currentSrc, grid });
    return grid;
  };

  const imageLuminanceAt = (img, x, y) => {
    const grid = gridFor(img);
    if (!grid) return null;
    const box = img.getBoundingClientRect();
    const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((x - box.left) / box.width) * GRID)));
    const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((y - box.top) / box.height) * GRID)));
    const i = gy * GRID + gx;
    return grid.alpha[i] < 0.5 ? null : grid.lum[i]; // прозрачно — смотрим глубже
  };

  const inside = (box, x, y) => box.width > 0 && x >= box.left && x < box.right && y >= box.top && y < box.bottom;

  // Картинки обложки, не ловящие клики: верхняя — последняя в DOM
  const surfaceLuminance = (container, x, y) => {
    const imgs = container.querySelectorAll('img[data-glass-surface]');
    for (let i = imgs.length - 1; i >= 0; i--) {
      const img = imgs[i];
      if (!inside(img.getBoundingClientRect(), x, y)) continue;
      const clip = img.closest('[data-glass-clip]');
      if (clip && !inside(clip.getBoundingClientRect(), x, y)) continue;
      const l = imageLuminanceAt(img, x, y);
      if (l !== null) return l;
    }
    return null;
  };

  // Яркость первого непрозрачного слоя под точкой, без учёта самой кнопки
  const backdropLuminance = (x, y, self) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (self.contains(el)) continue;
      if (el.tagName === 'IMG') {
        const l = imageLuminanceAt(el, x, y);
        if (l !== null) return l;
        continue;
      }
      if (el.hasAttribute('data-glass-surfaces')) {
        const l = surfaceLuminance(el, x, y);
        if (l !== null) return l;
      }
      const c = parseRgb(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0.5) return luminance(c.r, c.g, c.b);
    }
    const root = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
    return root ? luminance(root.r, root.g, root.b) : 1;
  };

  let queued = false;
  const update = () => {
    queued = false;
    if (document.documentElement.hasAttribute('data-pt-freeze')) return; // переход идёт — не трогаем
    const states = targets.map((el) => {
      const box = el.getBoundingClientRect();
      if (!box.width) return el.dataset.backdrop || 'light';
      return backdropLuminance(box.left + box.width / 2, box.top + box.height / 2, el) < 0.5 ? 'dark' : 'light';
    });
    targets.forEach((el, i) => {
      if (el.dataset.backdrop !== states[i]) el.dataset.backdrop = states[i];
    });
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  addEventListener('load', schedule);
  document.addEventListener('backdrop:refresh', schedule);
  // Картинки догружаются лениво — пересчитываем, когда загрузилась любая
  document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') schedule(); }, true);
  // Фон страницы меняет scripts/playground.js — догоняем и без скролла
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  schedule();
})();
