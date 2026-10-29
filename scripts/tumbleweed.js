/*
 * Перекати-поле в блоке Playground на главной (стили — styles/playground.css): цикл по видимой части кадра.
 * Видео (8 с) — шар катится слева направо через весь кадр. На десктопе кадр = ширина экрана: в первом
 * и последнем кадре шар виден у края, поэтому в конце он плавно гаснет (--tumble-fade), несколько секунд
 * пусто (--tumble-rest), и видео начинается сначала с плавным появлением — без скачка из угла в угол. На мобайле кадр вдвое шире экрана: шар входит в экран позже начала и
 * уходит раньше конца. Тогда цикл — от момента, когда шар появляется у левого края экрана,
 * до момента, когда он целиком ушёл за правый, и сразу заново.
 * TRACK — границы шара по горизонтали (доли ширины кадра) каждые 0.125 с, сняты с видео покадрово.
 * Играет, только пока блок на экране; reduced motion — стоит кадр-заглушка (середина пути).
 */
(function () {
  const box = document.querySelector('[data-tumble]');
  if (!box) return;
  const video = box.querySelector('video');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  const STEP = 0.125;
  const TRACK = [[0, 0.105], [0, 0.124], [0, 0.144], [0, 0.158], [0, 0.178], [0, 0.196], [0, 0.218], [0.013, 0.236], [0.036, 0.255], [0.054, 0.269], [0.071, 0.285], [0.091, 0.305], [0.118, 0.327], [0.138, 0.347], [0.153, 0.364], [0.173, 0.382], [0.193, 0.407], [0.211, 0.42], [0.227, 0.427], [0.242, 0.44], [0.253, 0.451], [0.262, 0.46], [0.273, 0.464], [0.28, 0.471], [0.289, 0.485], [0.304, 0.502], [0.32, 0.518], [0.331, 0.533], [0.34, 0.544], [0.351, 0.56], [0.364, 0.571], [0.374, 0.58], [0.384, 0.587], [0.391, 0.595], [0.395, 0.598], [0.396, 0.6], [0.398, 0.6], [0.398, 0.602], [0.4, 0.604], [0.402, 0.606], [0.404, 0.609], [0.407, 0.615], [0.411, 0.62], [0.418, 0.627], [0.425, 0.636], [0.436, 0.644], [0.451, 0.653], [0.466, 0.665], [0.482, 0.678], [0.496, 0.693], [0.52, 0.718], [0.553, 0.746], [0.566, 0.769], [0.589, 0.802], [0.613, 0.829], [0.642, 0.856], [0.678, 0.893], [0.709, 0.913], [0.74, 0.947], [0.769, 0.989], [0.807, 0.998], [0.842, 0.998], [0.873, 0.998], [0.913, 0.998], [0.951, 0.998]];

  let tIn = 0, tOut = Infinity, inView = false, started = false;
  let edge = false, resting = false, restTimer = 0;     // edge — десктоп: шар в кадре от начала до конца
  const EMPTY = document.documentElement.lang === 'en' ? 'Nothing here yet' : 'Пока пусто';   // английская версия — /en
  const ms = (name, fb) => { const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(n) ? n : fb; };

  // Видимая часть кадра → моменты входа и выхода шара
  function measure() {
    const w = video.getBoundingClientRect().width || 1;
    const half = Math.min(1, box.clientWidth / w) / 2;
    const c0 = 0.5 - half, c1 = 0.5 + half;
    const enter = TRACK.findIndex(([, right]) => right >= c0);
    const leave = TRACK.findIndex(([left]) => left >= c1);
    tIn = Math.max(0, (enter - 1) * STEP);                  // на шаг раньше — шар выкатывается из-за края
    tOut = leave === -1 ? Infinity : leave * STEP;          // целиком ушёл за правый край
    edge = tIn === 0 && tOut === Infinity;                  // десктоп — цикл с паузой (см. rest)
    video.loop = false;
    box.dataset.window = `${tIn.toFixed(2)}–${tOut === Infinity ? 'конец' : tOut.toFixed(2)} с`;
    document.dispatchEvent(new CustomEvent('tumble:window'));
  }

  // Проверка конца цикла — на каждом кадре видео (или по timeupdate, где rVFC нет)
  const check = () => {
    if (video.currentTime >= tOut) video.currentTime = tIn;
    // десктоп: перед концом шар плавно гаснет
    if (edge && !resting && video.duration && video.duration - video.currentTime <= ms('--tumble-fade', 500) / 1000) {
      box.classList.add('is-resting');
    }
  };
  if ('requestVideoFrameCallback' in video) {
    const loop = () => { check(); video.requestVideoFrameCallback(loop); };
    video.requestVideoFrameCallback(loop);
  } else {
    video.addEventListener('timeupdate', check);
  }
  video.addEventListener('ended', () => {
    if (!edge) { video.currentTime = tIn; video.play().catch(() => {}); return; }
    // десктоп: пауза, затем с начала — шар проявляется
    resting = true;
    box.classList.add('is-resting');
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      resting = false;
      video.currentTime = 0;
      box.classList.remove('is-resting');
      update();
    }, ms('--tumble-rest', 3000));
  });

  function update() {
    if (reduce.matches) {
      video.pause();
      return;                                              // стоит постер — середина пути
    }
    if (inView) {
      if (!started) { started = true; video.currentTime = tIn; }
      if (resting) return;                                 // пауза между проходами — продолжит таймер
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    update();
  }, { threshold: 0.15 }).observe(box);

  addEventListener('resize', () => { measure(); if (video.currentTime < tIn || video.currentTime >= tOut) video.currentTime = tIn; });
  reduce.addEventListener('change', update);
  video.addEventListener('loadedmetadata', measure);
  measure();

  /* ── Наведение на шар (мышь/трекпад): плашка «Пока пусто» рядом с курсором ──
   * Шар движется, поэтому попадание проверяется на каждом кадре, пока курсор над блоком:
   * границы шара в момент currentTime — по TRACK (по горизонтали), по вертикали 0.26–0.77 кадра;
   * попадание — внутри вписанного эллипса (по краям веток пусто). */
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const section = box.closest('.playground') || box;
  const badge = document.createElement('span');
  badge.className = 'tumble-badge';
  badge.textContent = EMPTY;
  badge.setAttribute('aria-hidden', 'true');
  document.body.append(badge);

  let px = 0, py = 0, over = false, hoverRaf = 0;
  const ballAt = (t) => {
    const f = Math.min(TRACK.length - 1.001, Math.max(0, t / STEP));
    const i = Math.floor(f), k = f - i, a = TRACK[i], b = TRACK[i + 1] || a;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const hit = () => {
    const r = video.getBoundingClientRect();
    const [l, rr] = ballAt(video.currentTime);
    const x0 = r.left + l * r.width, x1 = r.left + rr * r.width;
    const y0 = r.top + 0.26 * r.height, y1 = r.top + 0.77 * r.height;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (px - cx) / rx, dy = (py - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
  const hoverTick = () => {
    hoverRaf = 0;
    if (!over) { badge.classList.remove('is-visible'); return; }
    badge.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    // не помещается справа до края экрана (запас 8 px) — встаёт слева от курсора
    const offX = parseFloat(getComputedStyle(badge).marginLeft) || 12;
    badge.classList.toggle('is-flipped', px + offX + badge.offsetWidth > document.documentElement.clientWidth - 8);
    badge.classList.toggle('is-visible', hit());
    hoverRaf = requestAnimationFrame(hoverTick);       // шар едет и под неподвижным курсором
  };
  // Блок «прозрачен» для нажатий (styles/playground.css: на мобайле он заходит под низ последней карточки) —
  // поэтому указатель слушаем на документе и сами проверяем, что он над блоком.
  const inSection = (x, y) => { const r = section.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !fine.matches) return;
    px = e.clientX; py = e.clientY;
    over = inSection(px, py);
    if (!over) { badge.classList.remove('is-visible'); return; }
    if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverTick);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { over = false; badge.classList.remove('is-visible'); });

  /* ── Тап по шару (тач): размытие + «Пока пусто» по центру шара, тряска и хаптик ──
   * Как «Оформляю» у закрытых кейсов (scripts/locked-cursor.js): тайминги — токены --motion-*-locked-*.
   * Видео не останавливается: размыто всё видео, а надпись каждый кадр едет за центром шара (решение пользователя). */
  const empty = document.createElement('span');
  empty.className = 'tumble__empty';
  empty.textContent = EMPTY;
  empty.setAttribute('aria-hidden', 'true');
  box.append(empty);
  let haptic = null;
  const buzz = () => {
    if (navigator.vibrate) { navigator.vibrate([12, 40, 12]); return; }
    if (!haptic) {                                         // iPhone (iOS 18+): системный переключатель даёт тактильный отклик
      haptic = document.createElement('label');
      haptic.className = 'visually-hidden';
      haptic.setAttribute('aria-hidden', 'true');
      haptic.innerHTML = '<input type="checkbox" switch tabindex="-1">';
      document.body.append(haptic);
    }
    haptic.click();
  };
  let shaking = null;
  const shake = (delay) => {
    if (reduce.matches || !empty.animate) return;
    const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--locked-shake-distance')) || 6;
    if (shaking) shaking.cancel();
    shaking = empty.animate(
      { translate: ['-50% -50%', `calc(-50% - ${n}px) -50%`, `calc(-50% + ${n * 0.85}px) -50%`, `calc(-50% - ${n * 0.6}px) -50%`, `calc(-50% + ${n * 0.4}px) -50%`, `calc(-50% - ${n * 0.2}px) -50%`, '-50% -50%'] },
      { duration: ms('--motion-duration-locked-shake', 420), delay, easing: 'ease-out' },
    );
  };
  let emptyTimer = 0, stopTimer = 0, followRaf = 0;
  const follow = () => {                                   // надпись — в центре шара на текущем кадре
    const r = video.getBoundingClientRect(), b = box.getBoundingClientRect();
    const [l, rr] = ballAt(video.currentTime);
    empty.style.left = `${r.left - b.left + ((l + rr) / 2) * r.width}px`;
    empty.style.top = `${r.top - b.top + 0.515 * r.height}px`;
    followRaf = requestAnimationFrame(follow);
  };
  // Мышь: клик по шару — плашка у курсора трясётся, как плашка «locked» у закрытых кейсов.
  // translate плашки уже занят переворотом у правого края — тряска добавляется поверх (composite: add).
  let badgeShake = null;
  const shakeBadge = () => {
    if (reduce.matches || !badge.animate) return;
    const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--locked-shake-distance')) || 6;
    if (badgeShake) badgeShake.cancel();
    badgeShake = badge.animate(
      { translate: ['0 0', `${-n}px 0`, `${n * 0.85}px 0`, `${-n * 0.6}px 0`, `${n * 0.4}px 0`, `${-n * 0.2}px 0`, '0 0'] },
      { duration: ms('--motion-duration-locked-shake', 420), easing: 'ease-out', composite: 'add' },
    );
  };
  document.addEventListener('click', (e) => {
    if (fine.matches && e.pointerType !== 'touch') {         // мышь — трясём плашку у курсора
      if (inSection(e.clientX, e.clientY)) { px = e.clientX; py = e.clientY; if (hit()) shakeBadge(); }
      return;
    }
    if (!inSection(e.clientX, e.clientY)) return;
    px = e.clientX; py = e.clientY;
    if (!hit()) return;
    const shown = box.classList.contains('is-empty-reveal');
    buzz();
    shake(shown ? 0 : ms('--motion-duration-locked-in', 300) * 0.5);
    box.classList.add('is-empty-reveal');
    clearTimeout(stopTimer);                               // тап, пока надпись гаснет, — снова висит и едет
    if (!followRaf) follow();
    clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => {
      box.classList.remove('is-empty-reveal');
      // надпись гаснет ещё --motion-duration-locked-out — пусть доедет с шаром
      stopTimer = setTimeout(() => { cancelAnimationFrame(followRaf); followRaf = 0; }, ms('--motion-duration-locked-out', 400));
    }, ms('--motion-duration-locked-in', 300) + ms('--motion-locked-hold', 1200));
  });
  addEventListener('scroll', () => { if (over && !hoverRaf) hoverRaf = requestAnimationFrame(hoverTick); }, { passive: true });


})();
