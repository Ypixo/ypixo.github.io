/*
 * Закрытые кейсы (карточки с [data-locked]).
 * — Мышь/трекпад (hover: hover и pointer: fine): курсор — замочек (CSS), рядом с курсором
 *   едет плашка «locked» (media/icons/badge-locked.svg).
 * — Тач (телефоны, планшеты): по тапу карточка плавно размывается (с затемнением), по центру — замочек
 *   и «Оформляю»; надпись трясётся, как ошибка, и телефон коротко вибрирует (хаптик). Повторный тап —
 *   снова тряска. Через несколько секунд так же плавно возвращается превью.
 *   Эталон: docs/reference/main-mobile-locked-case.png. Тайминги — токены --motion-*-locked-*.
 * Позиция плашки пишется раз в кадр, только transform; размытие — слой с backdrop-filter,
 * анимируется только opacity.
 */
(function () {
  const cards = [...document.querySelectorAll('[data-locked]')];
  if (!cards.length) return;

  const scriptSrc = document.currentScript ? document.currentScript.src : location.href;
  const asset = (path) => new URL(path, scriptSrc).href;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  /* Английская версия (/en, <html lang="en">) — свои подписи. Русская плашка — картинка
     media/icons/badge-locked.svg (текст в кривых), английская — та же плашка живым текстом. */
  const EN = document.documentElement.lang === 'en';
  const LABEL = EN ? 'In progress' : 'Оформляю';

  /* ── Курсор и плашка рядом с ним ── */
  let badge;
  if (EN) {
    badge = document.createElement('span');
    badge.className = 'locked-badge locked-badge--text';
    badge.textContent = LABEL;
  } else {
    badge = document.createElement('img');
    badge.className = 'locked-badge';
    badge.src = asset('../media/icons/badge-locked.svg');
    badge.alt = '';
    badge.width = 94;
    badge.height = 26;
  }
  badge.setAttribute('aria-hidden', 'true');
  document.body.append(badge);

  let x = 0, y = 0, queued = false;
  const paint = () => {
    queued = false;
    badge.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    // у правого края не помещается справа (запас 8 px) — встаёт слева от курсора
    const offX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--locked-badge-offset-x')) || 12;
    badge.classList.toggle('is-flipped', x + offX + (badge.offsetWidth || 94) > document.documentElement.clientWidth - 8);
  };
  const move = (e) => {
    x = e.clientX; y = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  };

  /* ── Клик мышью: плашка трясётся из стороны в сторону (как ошибка / хаптик в iOS).
   * Позиция плашки — transform, тряска — отдельное свойство translate, они складываются. */
  const shaking = new WeakMap();
  const shake = (el = badge, delay = 0) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !el.animate) return;
    const d = getComputedStyle(document.documentElement).getPropertyValue('--locked-shake-distance').trim() || '6px';
    const n = parseFloat(d);
    if (shaking.has(el)) shaking.get(el).cancel();
    shaking.set(el, el.animate(
      { translate: ['0 0', `${-n}px 0`, `${n * 0.85}px 0`, `${-n * 0.6}px 0`, `${n * 0.4}px 0`, `${-n * 0.2}px 0`, '0 0'] },
      { duration: readMs('--motion-duration-locked-shake', 420), delay, easing: 'ease-out', composite: 'add' }   // поверх translate переворота у края
    ));
  };

  /* ── Хаптик «ошибка» по тапу.
   * Android и др.: Vibration API — двойной короткий импульс.
   * iPhone (Safari не поддерживает vibrate): системный переключатель <input type="checkbox" switch>
   * даёт тактильный отклик при переключении (iOS 18+). Скрытый переключатель «щёлкаем» внутри тапа.
   * На старых iOS и на десктопе — просто ничего не происходит. */
  let haptic = null;
  const buzz = () => {
    if (navigator.vibrate) { navigator.vibrate([12, 40, 12]); return; }
    if (!haptic) {
      haptic = document.createElement('label');
      haptic.className = 'visually-hidden';
      haptic.setAttribute('aria-hidden', 'true');
      haptic.innerHTML = '<input type="checkbox" switch tabindex="-1">';
      document.body.append(haptic);
    }
    haptic.click();
  };

  /* ── Тап: размытие и «Оформляю» ── */
  const readMs = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const lockIcon =
    '<svg class="locked-veil__icon" viewBox="0 0 20 20" aria-hidden="true">' +
    '<rect x="4" y="9" width="12" height="8.5" rx="2.5"/>' +
    '<path d="M6.75 9V6.75a3.25 3.25 0 0 1 6.5 0V9"/>' +
    '<path d="M10 12.5v1.5"/></svg>';

  cards.forEach((card) => {
    const veil = document.createElement('div');
    veil.className = 'locked-veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.innerHTML = `<span class="locked-veil__label">${lockIcon}${LABEL}</span>`;
    card.append(veil);

    let timer = 0;
    card.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !fine.matches) return;
      move(e); paint();
      badge.classList.add('is-visible');
    });
    card.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') move(e); }, { passive: true });
    card.addEventListener('pointerleave', () => badge.classList.remove('is-visible'));

    const label = veil.querySelector('.locked-veil__label');
    card.addEventListener('click', (e) => {
      if (fine.matches && e.pointerType !== 'touch') { shake(); return; } // мышь — плашка «трясётся», как ошибка
      clearTimeout(timer);
      buzz();
      // первый тап — тряска, когда надпись уже проявилась; повторный — сразу
      shake(label, card.classList.contains('is-locked-reveal') ? 0 : readMs('--motion-duration-locked-in', 450) * 0.5);
      card.classList.add('is-locked-reveal');
      timer = setTimeout(() => card.classList.remove('is-locked-reveal'),
        readMs('--motion-duration-locked-in', 400) + readMs('--motion-locked-hold', 2200));
    });
  });

  // Карточка уехала из-под курсора при скролле — прячем плашку
  addEventListener('scroll', () => {
    if (!badge.classList.contains('is-visible')) return;
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest('[data-locked]')) badge.classList.remove('is-visible');
  }, { passive: true });
})();
