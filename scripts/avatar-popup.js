/*
 * Поп-ап с большим аватаром (стили — styles/avatar-popup.css).
 * Открытие: подложка (размытие + затемнение) проявляется, фото вырастает из маленького аватара —
 * из его центра и из нулевого размера — в круг 256 по центру экрана; крестик проявляется сверху чуть позже.
 * Закрытие (крестик, клик по фону, Esc) — обратно в аватар. <dialog> + showModal: фокус внутри,
 * после закрытия возвращается на аватар. Под фото — плеер: песня играет без звука, кнопка включает звук;
 * при закрытии песня ставится на паузу. Reduced motion — без движения, только проявление.
 */
(function () {
  const trigger = document.querySelector('[data-avatar-open]');
  const pop = document.querySelector('.avatar-pop');
  if (!trigger || !pop || !pop.showModal) return;
  const photo = pop.querySelector('.avatar-pop__photo');
  const veil = pop.querySelector('.avatar-pop__veil');
  const close = pop.querySelector('.avatar-pop__close');
  const bar = pop.querySelector('.avatar-pop__player');
  const player = pop.querySelector('.player');
  const sound = pop.querySelector('.player__sound');
  const audio = pop.querySelector('audio');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const time = (v) => { v = v.trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; };
  let busy = false;

  // Сдвиг от центра экрана (где стоит фото) к центру маленького аватара
  const from = () => {
    const a = trigger.getBoundingClientRect();
    return `translate(${a.left + a.width / 2 - innerWidth / 2}px, ${a.top + a.height / 2 - innerHeight / 2}px) scale(0)`;
  };
  const tokens = () => {
    const s = getComputedStyle(document.documentElement);
    return {
      open: time(s.getPropertyValue('--motion-duration-avatar-open')),
      close: time(s.getPropertyValue('--motion-duration-avatar-close')),
      ease: s.getPropertyValue('--motion-ease-avatar').trim(),
    };
  };

  /* Плеер: при открытии песня играет сразу, но без звука (muted — автозапуск без звука браузеры разрешают).
     Кнопка звука включает/выключает звук. Палочки «волны» прыгают, пока песня реально играет. */
  /* Громкость при включении — тихая, фоном (data-volume у <audio>, по умолчанию 0.3).
     audio.volume iPhone игнорирует (там всегда 100 %), поэтому громкость — через Web Audio (GainNode).
     Граф создаётся при первом включении звука — это нажатие пользователя, без него браузер не даст
     запустить AudioContext. Дальше звук вкл/выкл — плавной сменой gain (~50 мс, без щелчка).
     Если Web Audio нет — обычные muted + volume. */
  const VOLUME = audio ? (parseFloat(audio.dataset.volume) || 0.3) : 0;
  let graph = null;   // null — ещё не создан, false — недоступен, иначе { ctx, gain }
  let soundOn = false;
  const ensureGraph = () => {
    if (graph !== null) return graph;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return (graph = false);
    try {
      const ctx = new AC();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
      graph = { ctx, gain };
    } catch (e) { graph = false; }
    return graph;
  };
  const setSound = (on) => {
    soundOn = on;
    sound.setAttribute('aria-pressed', String(on));   // подпись постоянная — «Звук песни», состояние — aria-pressed
    if (graph) {
      audio.muted = false;                             // глушит gain, а не элемент
      graph.gain.gain.setTargetAtTime(on ? VOLUME : 0, graph.ctx.currentTime, 0.05);
      if (on && graph.ctx.state !== 'running') graph.ctx.resume().catch(() => {});
    } else {
      audio.volume = VOLUME;
      audio.muted = !on;
    }
  };
  if (audio) {
    audio.addEventListener('playing', () => player.classList.add('is-playing'));
    audio.addEventListener('pause', () => player.classList.remove('is-playing'));
    audio.addEventListener('waiting', () => player.classList.remove('is-playing'));
    sound.addEventListener('click', () => {
      if (!soundOn) ensureGraph();
      setSound(!soundOn);
      if (audio.paused) audio.play().catch(() => {});
    });
  }

  /* Цвет панелей браузера (theme-color), пока открыт поп-ап, — как затемнение (светлая страница под
     Card Inverse 70 % ≈ #575757): иначе Safari на iPhone красит полосы сверху и снизу в светлый цвет темы. */
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  let themePrev = null;
  const setTheme = (on) => {
    if (!themeMeta) return;
    if (on) { themePrev = themeMeta.content; themeMeta.content = '#575757'; }
    else if (themePrev !== null) { themeMeta.content = themePrev; themePrev = null; }
  };

  /* Открыли тапом или мышью — фокус на сам поп-ап, а не на крестик: иначе Safari на iPhone рисует
     вокруг крестика кольцо фокуса (как при навигации с клавиатуры). С клавиатуры (Enter/пробел,
     у click detail = 0) — фокус, как обычно, на крестике. */
  function open(e) {
    if (busy || pop.open) return;
    pop.showModal();
    setTheme(true);
    if (e && e.detail > 0) pop.focus({ preventScroll: true });
    if (audio) { setSound(false); audio.play().catch(() => {}); }
    if (reduce.matches) return;
    const t = tokens();
    busy = true;
    opening = [];
    opening.push(veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: t.open * 0.6, easing: 'ease-out', fill: 'backwards' }));
    opening.push(close.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }],
      { duration: t.open * 0.6, delay: t.open * 0.35, easing: t.ease, fill: 'backwards' }));
    opening.push(bar.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: t.open * 0.6, delay: t.open * 0.45, easing: t.ease, fill: 'backwards' }));
    const grow = photo.animate([{ transform: from() }, { transform: 'none' }], { duration: t.open, easing: t.ease, fill: 'backwards' });
    opening.push(grow);
    grow.finished.then(() => { busy = false; opening = []; }, () => {});
  }

  let opening = [];
  function shut() {
    if (!pop.open) return;
    if (busy && opening.length) { opening.forEach((a) => a.finish()); opening = []; busy = false; }   // Esc во время открытия
    if (busy) return;
    if (audio) audio.pause();
    if (reduce.matches) { pop.close(); setTheme(false); return; }
    const t = tokens();
    busy = true;
    const opt = { duration: t.close, easing: t.ease, fill: 'forwards' };
    const anims = [
      photo.animate([{ transform: 'none' }, { transform: from() }], opt),
      veil.animate([{ opacity: 1 }, { opacity: 0 }], { ...opt, easing: 'ease-in' }),
      close.animate([{ opacity: 1 }, { opacity: 0 }], { duration: t.close * 0.4, easing: 'ease-out', fill: 'forwards' }),
      bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: t.close * 0.4, easing: 'ease-out', fill: 'forwards' }),
    ];
    anims[0].finished.then(() => {
      pop.close();
      setTheme(false);
      anims.forEach((a) => a.cancel());
      busy = false;
    }, () => { busy = false; });
  }

  // Картинки поп-апа — loading="lazy"; подгружаем, как только к аватару тянутся (наведение, фокус, касание)
  const warm = () => pop.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
  ['pointerenter', 'focus', 'touchstart'].forEach((ev) => trigger.addEventListener(ev, warm, { once: true, passive: true }));
  trigger.addEventListener('click', (e) => { warm(); open(e); });
  pop.addEventListener('click', (e) => { if (e.target.closest('[data-avatar-close]')) shut(); });
  pop.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });   // Esc
})();
