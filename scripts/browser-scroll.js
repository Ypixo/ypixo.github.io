/*
 * Живой скролл сайта в окне браузера: страница листается сама, как будто её листает человек
 * трекпадом, — жесты с разгоном и инерцией, паузы на блоках, перелёт и поправка, «резинка» у края,
 * в конце быстрый возврат наверх и снова первый экран (круг бесшовный). Главная — обложка m10 Web Redesign.
 *
 * Разметка (вся логика — в данных):
 *   <div class="browser-scroll" data-browser-scroll>
 *     <div class="browser-scroll__window">                          — видимая область страницы (overflow: hidden)
 *       <div class="browser-scroll__page" style="--page-w; --page-h">  — длинная страница, двигается transform
 *         <img class="browser-scroll__tile" src=… srcset=…>          — первый тайл: виден без JS (первый экран)
 *         <img class="browser-scroll__tile" data-srcset=…>           — остальные: грузятся при подъезде
 *       </div>
 *     </div>
 *     <img class="browser-scroll__frame" …>                           — рамка браузера поверх
 *     <script type="application/json" data-browser-scroll-script>{ "unit": 1440, "steps": […] }</script>
 *   </div>
 *
 * Сценарий — шаги по порядку, время идёт подряд, после последнего — снова первый:
 *   { "hold": "--motion-duration-scroll-read" }                 — пауза (токен tokens.css или число мс)
 *   { "to": 640, "dur": "--…", "ease": "--…" }                  — жест к позиции (px страницы шириной unit)
 *   { "to": "end", "past": 40, … }                              — к низу страницы и на 40 px дальше («резинка»)
 * Последний шаг должен вернуть страницу в позицию начала круга (обычно 0) — тогда стык не виден.
 *
 * Как устроено: сценарий компилируется в одну Web Animation (transform: translateY в % высоты страницы,
 * у каждого отрезка своя кривая из токенов) с бесконечным повтором — её ведёт компоновщик, главный поток
 * не нужен. Пауза вне экрана и на скрытой вкладке — animation.pause(), продолжение — с того же места.
 *
 * Производительность:
 *   — тайлы (кроме первого) грузятся, когда обложка в одном экране от окна; круг стартует, когда
 *     все тайлы декодированы (до этого — первый экран статично);
 *   — только transform, will-change — пока анимация играет;
 *   — только ≥ 768 (на мобайле обложка — статичная картинка, тайлы не грузятся);
 *   — prefers-reduced-motion: первый экран статично, остальные тайлы не грузятся;
 *   — без JS — первый экран статично.
 * Стекло меню (scripts/glass-backdrop.js) под обложкой: пока страница едет и обложка видна, раз в 300 мс
 * шлём событие 'backdrop:refresh' — стекло перечитывает, что под ним.
 * Отладка: el.browserScroll — play(), pause(), seek(ms), t, T, positionAt(ms), keyframes, animation,
 * setReduced(true|false|null), state; событие 'browserscroll:state' на корне.
 */
(function () {
  const NEAR = '100% 0px';
  const roots = [...document.querySelectorAll('[data-browser-scroll]')];
  if (!roots.length || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const desktopQuery = matchMedia('(min-width: 768px)');

  const token = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();
  const ms = (el, v) => {
    if (typeof v === 'number') return v;
    const s = token(el, v);
    if (!s) throw new Error('browser-scroll: нет токена ' + v);
    return s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000;
  };
  const ease = (el, v) => {
    const s = v && v.startsWith('--') ? token(el, v) : v;
    if (!s) throw new Error('browser-scroll: нет токена ' + v);
    return s;
  };

  // cubic-bezier(…) → функция прогресса (для positionAt: проверка без рендера)
  const bezier = (css) => {
    const m = css.match(/cubic-bezier\(([^)]+)\)/);
    if (!m) return (x) => x;
    const [x1, y1, x2, y2] = m[1].split(',').map(Number);
    const B = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (x) => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (B(mid, x1, x2) < x) lo = mid; else hi = mid; }
      return B((lo + hi) / 2, y1, y2);
    };
  };

  class BrowserScroll {
    constructor(root) {
      this.root = root;
      this.window = root.querySelector('.browser-scroll__window');
      this.page = root.querySelector('.browser-scroll__page');
      this.tiles = [...root.querySelectorAll('.browser-scroll__tile')];
      this.script = JSON.parse(root.querySelector('[data-browser-scroll-script]').textContent);
      this.reduced = null;     // null — как в системе, true/false — принудительно (проверка)
      this.near = false;
      this.inView = false;
      this.ready = false;      // тайлы загружены и декодированы
      this.loading = null;
      this.animation = null;
      this.ratio = 0;          // высота окна / ширина страницы — по нему считается «end»
      this.glassTimer = 0;
      this.state = 'idle';
      root.browserScroll = this;
    }

    get isReduced() { return this.reduced ?? reduceQuery.matches; }
    get active() { return desktopQuery.matches && !this.isReduced; }

    // Сценарий → ключевые кадры Web Animations (translateY в % высоты страницы) и отрезки для positionAt
    compile() {
      const unit = this.script.unit || 1440;
      const w = this.page.clientWidth;
      const pageH = this.page.clientHeight / w * unit;              // высота страницы в px сайта
      this.ratio = this.window.clientHeight / w;
      const end = pageH - this.ratio * unit;                        // низ: последний экран
      const pos = (step) => (step.to === 'end' ? end : step.to) + (step.past || 0);
      const segments = [];
      let t = 0, y = 0;
      for (const step of this.script.steps) {
        if ('hold' in step) {
          const d = ms(this.root, step.hold);
          segments.push({ t, d, from: y, to: y, ease: 'linear' });
          t += d;
        } else {
          const d = ms(this.root, step.dur);
          const to = pos(step);
          segments.push({ t, d, from: y, to, ease: ease(this.root, step.ease) });
          t += d; y = to;
        }
      }
      if (Math.abs(y - segments[0].from) > 0.5) console.warn('browser-scroll: круг не замкнут — конец', y, 'начало', segments[0].from);
      this.T = t;
      this.segments = segments.map((s) => ({ ...s, fn: bezier(s.ease) }));
      const pct = (v) => `translate3d(0, ${(-v / pageH * 100).toFixed(4)}%, 0)`;
      this.keyframes = segments.map((s) => ({ offset: s.t / t, transform: pct(s.from), easing: s.ease }));
      this.keyframes.push({ offset: 1, transform: pct(y) });
      this.pageH = pageH;
      this.end = end;
    }

    // Позиция (px сайта) в момент круга — та же математика, что у анимации (для проверки)
    positionAt(time) {
      const t = ((time % this.T) + this.T) % this.T;
      const s = this.segments.find((x) => t < x.t + x.d) || this.segments[this.segments.length - 1];
      return s.from + (s.to - s.from) * s.fn(Math.min(1, (t - s.t) / s.d));
    }

    load() {
      if (this.loading) return this.loading;
      this.tiles[0].loading = 'eager';
      this.tiles.forEach((img) => {
        if (img.dataset.srcset) { img.srcset = img.dataset.srcset; img.removeAttribute('data-srcset'); }
      });
      this.loading = Promise.all(this.tiles.map((img) => img.decode().catch(() => {})))
        .then(() => { this.ready = true; this.update('ready'); });
      return this.loading;
    }

    ensureAnimation() {
      if (this.animation) {
        // Пропорции окна заданы в CSS и не меняются; пересобираем, только если что-то всё же поменялось
        if (Math.abs(this.window.clientHeight / this.page.clientWidth - this.ratio) < 0.002) return;
        const t = this.animation.currentTime;
        this.animation.cancel();
        this.animation = null;
        this.compile();
        this.animation = this.page.animate(this.keyframes, { duration: this.T, iterations: Infinity });
        this.animation.currentTime = t % this.T;
        return;
      }
      this.compile();
      this.animation = this.page.animate(this.keyframes, { duration: this.T, iterations: Infinity });
      this.animation.pause();
    }

    // Единая точка решения: играть / пауза / статичный первый экран
    update(reason) {
      if (!this.active) {
        if (this.animation) { this.animation.cancel(); this.animation = null; }
        this.page.style.willChange = '';
        this.stopGlass();
        return this.setState('static', reason);
      }
      if (this.near) this.load();
      if (!this.ready) return this.setState('loading', reason);
      this.ensureAnimation();
      const play = this.inView && !document.hidden;
      if (play) {
        this.page.style.willChange = 'transform';
        if (this.animation.playState !== 'running') this.animation.play();
        this.startGlass();
      } else {
        if (this.animation.playState === 'running') this.animation.pause();
        this.page.style.willChange = '';
        this.stopGlass();
      }
      this.setState(play ? 'playing' : 'paused', reason);
    }

    setState(state, reason) {
      this.state = state;
      this.root.dispatchEvent(new CustomEvent('browserscroll:state', {
        detail: { state, reason, t: Math.round(this.t), inView: this.inView, hiddenTab: document.hidden, reduced: this.isReduced },
      }));
    }

    startGlass() {
      if (this.glassTimer) return;
      this.glassTimer = setInterval(() => document.dispatchEvent(new Event('backdrop:refresh')), 300);
    }
    stopGlass() {
      clearInterval(this.glassTimer);
      this.glassTimer = 0;
    }

    // Отладка и проверка
    get t() { return this.animation ? Number(this.animation.currentTime) % this.T : 0; }
    play() { this.inView = true; this.update('api'); }
    pause() { if (this.animation) this.animation.pause(); this.stopGlass(); this.setState('paused', 'api'); }
    seek(time) {
      if (!this.animation) { if (!this.active) return; this.compile(); this.animation = this.page.animate(this.keyframes, { duration: this.T, iterations: Infinity }); this.animation.pause(); }
      this.animation.currentTime = ((time % this.T) + this.T) % this.T;
    }
    setReduced(value) { this.reduced = value; this.update('reduced-motion'); }
  }

  const items = roots.map((root) => new BrowserScroll(root));
  const byRoot = new Map(items.map((b) => [b.root, b]));

  const near = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const b = byRoot.get(e.target);
      if (e.isIntersecting && !b.near) { b.near = true; b.update('near'); }
    });
  }, { rootMargin: NEAR });
  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const b = byRoot.get(e.target);
      b.inView = e.isIntersecting;
      b.update(e.isIntersecting ? 'in-view' : 'out-of-view');
    });
  });
  items.forEach((b) => { near.observe(b.root); seen.observe(b.root); });

  document.addEventListener('visibilitychange', () => items.forEach((b) => b.update(document.hidden ? 'tab-hidden' : 'tab-visible')));
  reduceQuery.addEventListener('change', () => items.forEach((b) => b.update('reduced-motion')));
  desktopQuery.addEventListener('change', () => items.forEach((b) => b.update('breakpoint')));
})();
