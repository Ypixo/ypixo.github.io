/*
 * Карусель шторок (bottom sheet) с Lottie-иллюстрацией: шторка доигрывает свою анимацию до конца,
 * уезжает вправо, следующая въезжает слева, встаёт на место — и только тогда стартует её анимация.
 * По кругу. Кейс Digital Card — шторки «возможности карты».
 *
 * Разметка (всё декларативно, логики на странице нет):
 *   <div class="sheet-carousel" data-sheet-carousel
 *        data-sheet-src="…/bottom-sheet/"            — папка с JSON (относительно страницы)
 *        data-sheet-art="14.103 7.339 71.795 51.376"> — место иллюстрации: left top width height, % шторки
 *     <div class="sheet-carousel__slide" data-sheet-lottie="lottie-shop-online" style="--sheet-art-bg: #ffb45c">
 *       <img …шторка…>                               — PNG/WebP шторки с пустым местом под иллюстрацию
 *       <div class="sheet-carousel__art"></div>       — сюда ставится плеер; фон — цвет квадрата (до загрузки и без JS)
 *     </div>
 *     <div class="sheet-carousel__slide" data-sheet-lottie="…" hidden>…</div>   — остальные скрыты (без JS не видны)
 *   </div>
 * Порядок слайдов — порядок в разметке. У слайда можно переопределить место иллюстрации (data-sheet-art)
 * и кадр-постер для reduced motion (data-sheet-poster, по умолчанию 0).
 * Тайминги — токены tokens.css: --motion-duration-sheet-slide, --motion-ease-sheet-slide,
 * --motion-duration-sheet-hold (пауза на последнем кадре перед уходом).
 *
 * Производительность:
 *   — lottie-web light грузится лениво, когда карусель в одном экране от окна (scripts/lottie-kit.js);
 *   — JSON загружается только для текущей и следующей шторки; следующий плеер собирается заранее
 *     в простое (стоит на кадре 0), поэтому въезжает уже с иллюстрацией; в DOM не больше двух плееров;
 *   — играет один плеер; вне экрана и на скрытой вкладке — пауза анимации, ожидания и самого слайда;
 *   — слайд — Web Animations, только transform;
 *   — prefers-reduced-motion: первая шторка, иллюстрация на кадре-постере, без слайдов;
 *   — без JS — первая шторка с цветным квадратом на месте иллюстрации.
 * Отладка: el.sheetCarousel (index, phase, log, players) и событие 'sheetcarousel:state'.
 */
(function () {
  const NEAR = '100% 0px';
  const roots = [...document.querySelectorAll('[data-sheet-carousel]')];
  const kit = window.LottieKit;
  if (!roots.length || !kit || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const nums = (s) => (s || '').trim().split(/\s+/).map(Number);

  // Токен времени ('800ms' / '0.8s') → мс
  const ms = (el, name, fallback) => {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    if (!v) return fallback;
    return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
  };
  const token = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

  class SheetCarousel {
    constructor(el) {
      this.el = el;
      this.base = el.dataset.sheetSrc || '';
      const rect = el.dataset.sheetArt;
      this.slides = [...el.querySelectorAll('[data-sheet-lottie]')].map((s, i) => {
        const art = s.querySelector('.sheet-carousel__art');
        const [x, y, w, h] = nums(s.dataset.sheetArt || rect || '0 0 100 100');
        art.style.setProperty('--art-x', x + '%');
        art.style.setProperty('--art-y', y + '%');
        art.style.setProperty('--art-w', w + '%');
        art.style.setProperty('--art-h', h + '%');
        return { i, el: s, art, img: s.querySelector('img'), name: s.dataset.sheetLottie, poster: +(s.dataset.sheetPoster || 0) };
      });
      this.index = 0;            // какая шторка на месте
      this.phase = 'idle';       // idle → playing → hold → sliding → playing …; waiting — доиграла вне экрана
      this.players = new Map();  // индекс слайда → { anim, box }
      this.building = new Map(); // индекс → Promise (идёт сборка)
      this.moves = [];           // текущие Web Animations слайда
      this.timer = 0;
      this.inView = false;
      this.started = false;
      this.reduced = null;       // null — как в системе, true/false — принудительно (проверка)
      this.log = [];             // сыгранные анимации: { name, frame, total } на момент complete
      el.sheetCarousel = this;
    }

    get isReduced() { return this.reduced ?? reduceQuery.matches; }
    get count() { return this.slides.length; }
    nextIndex(i = this.index) { return (i + 1) % this.count; }
    url(i) { return this.base + this.slides[i].name + '.json'; }
    canPlay() { return this.inView && !document.hidden && !this.isReduced; }

    async prepare() {
      if (this.started) return;
      this.started = true;
      const [lottie] = await Promise.all([kit.load(), kit.json(this.url(0))]);
      this.lottie = lottie;
      const p = await this.build(0);
      p.anim.goToAndStop(this.isReduced ? this.slides[0].poster : 0, true);
      p.box.hidden = false;
      this.phase = 'playing';
      this.update('ready');
      kit.idle(() => this.preloadNext());
    }

    build(i) {
      if (this.players.has(i)) return Promise.resolve(this.players.get(i));
      if (!this.building.has(i)) this.building.set(i, this.create(i).finally(() => this.building.delete(i)));
      return this.building.get(i);
    }

    async create(i) {
      const data = await kit.json(this.url(i));
      const slide = this.slides[i];
      const box = document.createElement('div');
      box.className = 'sheet-carousel__player';
      box.hidden = true;
      slide.art.appendChild(box);
      const anim = this.lottie.loadAnimation({
        container: box,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: data,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false, hideOnTransparent: true },
      });
      anim.setSubframe(false); // 24 fps: на 120 Гц не рисуем лишние кадры
      anim.addEventListener('complete', () => this.onComplete(i));
      const p = { anim, box };
      this.players.set(i, p);
      return p;
    }

    // Следующая шторка: картинка — без lazy, плеер собран и стоит на кадре 0
    async preloadNext() {
      if (this.isReduced || this.count < 2) return;
      const n = this.nextIndex();
      const s = this.slides[n];
      if (s.img) s.img.loading = 'eager';
      const p = await this.build(n);
      if (p.anim.isPaused) p.anim.goToAndStop(0, true);
      p.box.hidden = false;
      this.emit('preload');
    }

    onComplete(i) {
      if (i !== this.index || this.phase !== 'playing') return;
      const p = this.players.get(i);
      this.log.push({ name: this.slides[i].name, frame: p.anim.currentFrame, total: p.anim.totalFrames });
      this.phase = 'waiting';
      this.update('complete');
    }

    // Пауза на последнем кадре, затем слайд. Таймер идёт только пока карусель видна.
    scheduleSlide() {
      if (this.timer) return;
      this.phase = 'hold';
      this.timer = setTimeout(() => { this.timer = 0; this.slide(); }, ms(this.el, '--motion-duration-sheet-hold', 0));
    }

    cancelHold() {
      if (!this.timer) return;
      clearTimeout(this.timer);
      this.timer = 0;
      this.phase = 'waiting';
    }

    async slide() {
      const from = this.index;
      const to = this.nextIndex();
      const out = this.slides[from];
      const inn = this.slides[to];
      this.phase = 'sliding';
      const p = await this.build(to);
      p.anim.goToAndStop(0, true);
      p.box.hidden = false;
      if (inn.img) { inn.img.loading = 'eager'; await inn.img.decode().catch(() => {}); }

      // Путь — от центра рамки до полного выхода из неё: полрамки + полшторки
      const frame = this.el.parentElement.getBoundingClientRect().width;
      const d = Math.ceil((frame + this.el.offsetWidth) / 2) + 1;
      const opts = {
        duration: ms(this.el, '--motion-duration-sheet-slide', 800),
        easing: token(this.el, '--motion-ease-sheet-slide', 'ease-in-out'),
        fill: 'both',
      };
      inn.el.hidden = false;
      this.moves = [
        out.el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${d}px)` }], opts),
        inn.el.animate([{ transform: `translateX(${-d}px)` }, { transform: 'translateX(0)' }], opts),
      ];
      this.update('slide');
      await Promise.all(this.moves.map((m) => m.finished)).catch(() => {});
      this.moves.forEach((m) => m.cancel());
      this.moves = [];
      out.el.hidden = true;

      // Старая шторка ушла: её плеер больше не нужен (в DOM остаются текущий и следующий)
      const old = this.players.get(from);
      if (old && from !== this.nextIndex(to)) { old.anim.destroy(); old.box.remove(); this.players.delete(from); }
      this.index = to;
      this.phase = 'playing';
      if (this.isReduced) p.anim.goToAndStop(inn.poster, true);
      this.update('arrived');
      kit.idle(() => this.preloadNext());
    }

    update(reason) {
      const p = this.players.get(this.index);
      if (this.isReduced) {
        this.cancelHold();
        this.moves.forEach((m) => m.finish());
        if (p && this.phase !== 'sliding') { p.anim.goToAndStop(this.slides[this.index].poster, true); }
      } else if (this.canPlay()) {
        this.moves.forEach((m) => m.play());
        if (this.phase === 'playing' && p && p.anim.isPaused) p.anim.play();
        if (this.phase === 'waiting') this.scheduleSlide();
      } else {
        this.moves.forEach((m) => m.pause());
        this.cancelHold();
        if (p && !p.anim.isPaused) p.anim.pause();
      }
      kit.sync();
      this.emit(reason);
    }

    emit(reason) {
      const p = this.players.get(this.index);
      this.el.dispatchEvent(new CustomEvent('sheetcarousel:state', {
        detail: {
          index: this.index,
          name: this.slides[this.index].name,
          phase: this.phase,
          playing: !!p && !p.anim.isPaused,
          players: this.el.querySelectorAll('.sheet-carousel__player').length,
          inView: this.inView,
          hiddenTab: document.hidden,
          reduced: this.isReduced,
          reason,
        },
      }));
    }

    setReduced(value) {
      this.reduced = value;
      if (!this.isReduced) this.preloadNext();
      this.update('reduced-motion');
    }
  }

  const items = roots.map((el) => new SheetCarousel(el));
  const byEl = new Map(items.map((c) => [c.el, c]));

  const near = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      near.unobserve(e.target);
      byEl.get(e.target).prepare().catch(() => { /* нет сети — остаётся статичная первая шторка */ });
    });
  }, { rootMargin: NEAR });

  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const c = byEl.get(e.target);
      c.inView = e.isIntersecting;
      c.update(e.isIntersecting ? 'in-view' : 'off-screen');
    });
  });

  items.forEach((c) => { near.observe(c.el); seen.observe(c.el); });
  document.addEventListener('visibilitychange', () => items.forEach((c) => c.update(document.hidden ? 'tab-hidden' : 'tab-visible')));
  reduceQuery.addEventListener('change', () => items.forEach((c) => c.update('reduced-motion')));
})();
