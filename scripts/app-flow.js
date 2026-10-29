/*
 * Прототип приложения в мокапе телефона: экраны, нажатия и переходы по сценарию, по кругу —
 * как запись экрана реального приложения. Кейс Digital Card — сценарий активации карты.
 *
 * Разметка (вся логика — в данных, на странице только описание):
 *   <div class="app-flow" data-app-flow data-flow-lottie-src="…/media/optimized/">
 *     <div class="app-flow__phone"><div class="app-flow__display">
 *       <div class="app-flow__screen" data-flow-screen="wake-up">            — экран: картинка + живые части
 *         <img class="app-flow__ui" src="…/screen-wake-up.svg" …>             — статичный экран (SVG 390×844)
 *         <div class="app-flow__lottie" data-flow-lottie="card-animations/sleep"
 *              data-flow-start="appear" style="--x: 55; --y: 126; --w: 280; --h: 180; --r: 17"></div>
 *         <div class="app-flow__press" data-flow-target="wake" style="--x: …"></div>  — подсветка нажатия
 *         <div data-flow-keypad="59 431 100 88 72"></div>                       — клавиатура PIN: x y шагX шагY размер
 *         <div data-flow-dots="create" data-flow-geom="153 281.5 28 8 4"></div> — точки PIN: cx cy шаг r количество
 *       </div>
 *       <div class="app-flow__screen" data-flow-screen="…" hidden>…</div>      — остальные скрыты (без JS не видны)
 *       <div class="app-flow__chrome">                                          — системные элементы поверх экранов
 *         <img data-flow-chrome="status" src="…/chrome.svg#status" …>           — не уезжают при push, как в iOS
 *       </div>
 *     </div></div>
 *     <script type="application/json" data-flow-script>{ "start": …, "chrome": {…}, "steps": […] }</script>
 *   </div>
 * Координаты (--x/--y/--w/--h/--r) — в pt экрана 390×844, CSS переводит их в % экрана.
 *
 * Сценарий (JSON) — шаги по порядку, время идёт подряд:
 *   { "wait": "--motion-flow-intro" }                    — пауза (токен tokens.css или число мс)
 *   { "wait": "--motion-flow-finale", "after": "lottie" } — пауза от конца разовых анимаций Lottie экрана
 *   { "tap": "wake" }                                    — нажатие на [data-flow-target] текущего экрана;
 *                                                          действие следующего шага — на отпускании
 *   { "type": "2580", "dots": "create" }                 — набор на клавиатуре текущего экрана; точка группы dots
 *                                                          заполняется на отпускании клавиши
 *   { "go": "create-pin", "via": "push", "chrome": {…} } — переход: push | dissolve;
 *                                                          chrome — какие системные элементы видны после (меняются
 *                                                          вместе с переходом); "chrome": "start" — как в начале
 *   { "go": "cabinet", "via": "sheet", "timing": {…} }   — «шторка»: экраны растворяются (шапка ↔ баланс), общие слои
 *                                                          [data-flow-layer] переезжают между позами экранов (см. ниже);
 *                                                          timing — длительность и кривая (токены) для "screen" и каждого
 *                                                          слоя: { "sheet": ["--motion-duration-…", "--motion-ease-…"] };
 *                                                          без timing — как dissolve. Шаг длится до конца самого долгого.
 *   { "face": "show" | "on" | "off" }                    — лицо карты (.card-face внутри прототипа, scripts/card-face.js):
 *                                                          show — видно, нейтральное (стоит); on — играет (random ↔
 *                                                          stare-blink); off — скрыто и в покое (следующий показ — снова
 *                                                          нейтральное, первой сыграет random). До первого шага — off.
 *                                                          Ставить off, когда лицо закрыто (например, шторкой).
 *   { "swap": true }                                     — смена телефона целиком (последний шаг): телефон
 *                                                          в финальном состоянии уезжает вниз за край рамки,
 *                                                          сверху сцепкой въезжает тот же телефон на стартовом
 *                                                          экране — круг бесшовный, «перезагрузки» экрана не видно.
 *   Уходящий телефон — статичный снимок (клон DOM в кадре начала смены: картинки из кэша, лицо — застывшая
 *   SVG-отрисовка без плеера, id внутри переименованы), живой — входящий; снимок удаляется по окончании.
 *   Сдвиг — --flow-swap-shift (% высоты телефона: сколько нужно, чтобы уйти за край рамки, задаёт место в кейсе).
 * Общие слои (поверх экранов, не уезжают при dissolve) — для перехода "sheet":
 *   <div class="app-flow__stage">                                            — экран телефона (обрезка)
 *     <div class="app-flow__layer" data-flow-layer="card"
 *          data-flow-pose-cabinet="translateY(21%) scale(0.93)">…</div>     — поза слоя на экране (transform);
 *   </div>                                                                     нет атрибута — "none" (как в разметке)
 *   Цель нажатия [data-flow-target] ищется в текущем экране, затем во всём прототипе (например, карта в слое).
 * "reduced": "cabinet" в сценарии — какой экран показать статично в prefers-reduced-motion (по умолчанию — первый).
 * Lottie на экране (data-flow-lottie="a b c") — анимации по очереди, последняя по кругу; время идёт с момента,
 * когда экран начал появляться (data-flow-start="appear") или встал на место ("shown"). До старта — кадр 0 первой.
 *
 * Как устроено: сценарий компилируется в список событий с абсолютным временем внутри круга. Состояние в любой
 * момент — чистая функция времени: seek(t) расставляет конечные состояния прошедших событий, идущие переходы
 * создаёт Web Animations с нужным currentTime, Lottie ставит на нужный кадр. Воспроизведение — таймеры
 * до следующих событий; пауза/продолжение — тот же seek. Поэтому круг можно прокрутить к любому моменту.
 *
 * Производительность:
 *   — всё лениво: lottie-web light, JSON и экраны грузятся, когда медиа в одном экране от окна (LottieKit);
 *   — переходы и нажатия — Web Animations, только transform и opacity;
 *   — играет только видимое: Lottie неактивных экранов на паузе; вне экрана и на скрытой вкладке —
 *     пауза всего сценария (таймеры сняты, rAF lottie заморожен через LottieKit.sync);
 *   — prefers-reduced-motion: первый экран статично (спящая карта, кадр 0), без сценария;
 *   — без JS — первый экран без лица.
 * Отладка: el.appFlow — seek(t), play(), pause(), rate (ускорение для проверки), t, T, events, log;
 * событие 'appflow:event' на корне (detail: { at, kind, name }).
 */
(function () {
  const NEAR = '100% 0px';
  const roots = [...document.querySelectorAll('[data-app-flow]')];
  if (!roots.length || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const nums = (s) => (s || '').trim().split(/\s+/).map(Number);
  const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean);
  const now = () => performance.now();

  // Токен tokens.css → значение; время ('500ms' / '0.5s') → мс
  const token = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();
  const ms = (el, v) => {
    if (typeof v === 'number') return v;
    const s = v.startsWith('--') ? token(el, v) : v;
    if (!s) throw new Error('app-flow: нет токена ' + v);
    return s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000;
  };

  // Позиция в pt экрана 390×844 → CSS-переменные (CSS переводит их в %)
  const place = (el, x, y, w, h, r) => {
    el.style.setProperty('--x', x); el.style.setProperty('--y', y);
    el.style.setProperty('--w', w); el.style.setProperty('--h', h);
    if (r != null) el.style.setProperty('--r', r);
  };

  class AppFlow {
    constructor(el) {
      this.el = el;
      this.script = JSON.parse(el.querySelector('[data-flow-script]').textContent);
      this.lottieBase = el.dataset.flowLottieSrc || '';
      this.screens = new Map([...el.querySelectorAll('[data-flow-screen]')].map((s) => [s.dataset.flowScreen, s]));
      this.phone = el.querySelector('.app-flow__phone');
      this.chrome = new Map([...el.querySelectorAll('[data-flow-chrome]')].map((c) => [c.dataset.flowChrome, c]));
      this.layers = new Map([...el.querySelectorAll('[data-flow-layer]')].map((l) => [l.dataset.flowLayer, l]));
      this.faces = [...el.querySelectorAll('.card-face')];
      this.faceOn = 'off';
      this.reducedAt = 0;   // момент круга, который показывается в reduced motion
      this.slots = [...el.querySelectorAll('[data-flow-lottie]')].map((s) => ({
        el: s,
        screen: s.closest('[data-flow-screen]').dataset.flowScreen,
        names: words(s.dataset.flowLottie),
        start: s.dataset.flowStart || 'appear',
        players: [],   // { anim, box, dur, fr, total }
        origin: null,  // по кругу: [{ from, to, origin }]
      }));
      this.events = [];     // { at, dur, kind, name, el, frames, easing, before, after }
      this.T = 0;           // длина круга, мс
      this.t = 0;           // текущее время круга, мс
      this.base = 0;        // performance.now() в момент t = 0 (при воспроизведении)
      this.playing = false;
      this.running = [];    // идущие Web Animations
      this.timer = 0;
      this.next = 0;        // индекс следующего события
      this.rate = 1;        // ускорение времени (проверка)
      this.inView = false;
      this.started = false;
      this.ready = false;
      this.reduced = null;  // null — как в системе, true/false — принудительно (проверка)
      this.log = [];
      this.managed = new Set();
      // Точки PIN: по геометрии группы (cx первой, cy, шаг, r, количество), заполненные — поверх пустых в SVG
      el.querySelectorAll('[data-flow-dots]').forEach((g) => {
        const [cx, cy, step, r, n] = nums(g.dataset.flowGeom);
        for (let i = 0; i < n; i++) {
          const d = document.createElement('div');
          d.className = 'app-flow__dot';
          place(d, cx + i * step - r, cy - r, 2 * r, 2 * r, r);
          g.appendChild(d);
        }
      });
      el.appFlow = this;
    }

    get isReduced() { return this.reduced ?? reduceQuery.matches; }
    canPlay() { return this.ready && this.inView && !document.hidden && !this.isReduced; }

    // ── Подготовка: плеер, JSON, картинки экранов; затем компиляция сценария
    async prepare() {
      if (this.started) return;
      this.started = true;
      const kit = window.LottieKit;
      // Скрытые без JS экраны раскрываем (видимость дальше — через visibility), картинки грузим сразу
      this.screens.forEach((s) => { s.hidden = false; });
      this.chrome.forEach((c) => { c.hidden = false; });
      const imgs = [...this.el.querySelectorAll('img')];
      imgs.forEach((img) => { img.loading = 'eager'; });
      this.reset(); // до загрузки — стартовое состояние (без мигания скрытых экранов)
      const [lottie] = await Promise.all([
        kit.load(),
        ...this.slots.flatMap((s) => s.names.map((n) => kit.json(this.lottieBase + n + '.json'))),
        ...imgs.map((img) => img.decode().catch(() => {})),
      ]);
      for (const slot of this.slots) {
        for (const name of slot.names) {
          const data = await kit.json(this.lottieBase + name + '.json');
          const box = document.createElement('div');
          box.className = 'app-flow__player';
          box.hidden = true;
          slot.el.appendChild(box);
          const anim = lottie.loadAnimation({
            container: box, renderer: 'svg', loop: false, autoplay: false, animationData: data,
            rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false, hideOnTransparent: true },
          });
          anim.setSubframe(false);
          slot.players.push({ anim, box, fr: data.fr, total: data.op - data.ip, dur: (data.op - data.ip) / data.fr * 1000 });
        }
      }
      this.compile();
      this.ready = true;
      this.seek(0);
      this.update('ready');
    }

    // ── Компиляция сценария в события
    compile() {
      const el = this.el;
      const sc = this.script;
      const E = [];
      const tk = {
        push: ms(el, '--motion-duration-flow-push'), pushEase: token(el, '--motion-ease-flow-push'),
        parallax: token(el, '--motion-flow-push-parallax'),
        dissolve: ms(el, '--motion-duration-flow-dissolve'), dissolveEase: token(el, '--motion-ease-flow-dissolve'),
        swap: ms(el, '--motion-duration-flow-swap'), swapEase: token(el, '--motion-ease-flow-swap'),
        pressIn: ms(el, '--motion-duration-flow-press-in'), pressInEase: token(el, '--motion-ease-flow-press-in'),
        touch: ms(el, '--motion-duration-flow-touch'),
        pressOut: ms(el, '--motion-duration-flow-press-out'), pressOutEase: token(el, '--motion-ease-flow-press-out'),
        dot: ms(el, '--motion-duration-flow-dot'),
        keyInterval: ms(el, '--motion-flow-key-interval'),
      };
      this.tk = tk;
      this.chromeStart = { ...sc.chrome };
      let chromeNow = { ...sc.chrome };
      let cur = sc.start;
      let t = 0;
      let z = 1;
      const shown = { [sc.start]: [] }; // экран → интервалы показа [{ a, e, h }]: начал появляться, встал, исчез
      shown[sc.start].push({ a: 0, e: 0, h: Infinity, first: true });

      const press = (target, at, name) => {
        this.managed.add(target);
        const total = tk.touch + tk.pressOut;
        E.push({
          at, dur: total, kind: 'press', name, el: target,
          frames: [
            { opacity: 0, easing: tk.pressInEase },
            { opacity: 1, offset: Math.min(tk.pressIn, tk.touch) / total },
            { opacity: 1, offset: tk.touch / total, easing: tk.pressOutEase },
            { opacity: 0 },
          ],
          easing: 'linear',
        });
      };

      for (const step of sc.steps) {
        if (step.wait != null) {
          // "after": "lottie" — пауза отсчитывается от конца разовых анимаций Lottie текущего экрана
          // (например, карта доиграла wake-up — дальше look-around по кругу), а не от прихода на экран
          if (step.after === 'lottie') {
            const slot = this.slots.find((s) => s.screen === cur);
            const iv = shown[cur][shown[cur].length - 1];
            if (slot && iv) {
              const origin = slot.start === 'shown' ? iv.e : iv.a;
              t = Math.max(t, origin + slot.players.slice(0, -1).reduce((sum, p) => sum + p.dur, 0));
            }
          }
          t += ms(el, step.wait);
        } else if (step.tap) {
          const sel = `[data-flow-target="${step.tap}"]`;
          const target = this.screens.get(cur).querySelector(sel) || this.el.querySelector(sel);
          press(target, t, cur + ':' + step.tap);
          t += tk.touch; // действие — на отпускании
        } else if (step.type) {
          const screen = this.screens.get(cur);
          const pad = screen.querySelector('[data-flow-keypad]');
          const dots = [...screen.querySelectorAll(`[data-flow-dots="${step.dots}"] .app-flow__dot`)];
          [...String(step.type)].forEach((digit, i, all) => {
            press(this.key(pad, digit), t, cur + ':key-' + digit);
            const dot = dots[i];
            if (dot) {
              this.managed.add(dot);
              // Точка заполняется на отпускании клавиши (на эталоне 05: клавиша нажата, точка ещё пустая)
              E.push({ at: t + tk.touch, dur: tk.dot, kind: 'dot', name: cur + ':dot-' + (i + 1), el: dot,
                frames: [{ opacity: 0 }, { opacity: 1 }], easing: tk.pressInEase });
            }
            t += i < all.length - 1 ? tk.keyInterval : tk.touch;
          });
        } else if (step.face) {
          E.push({ at: t, dur: 0, kind: 'face', name: 'face ' + step.face, face: step.face });
        } else if (step.swap) {
          // Смена телефона: живой телефон сразу на стартовом экране (въезжает сверху), уходящий — снимок
          const dur = tk.swap;
          E.push({ at: t, dur, kind: 'swap', name: 'phone swap', easing: tk.swapEase });
          const openFrom = shown[cur].find((s) => s.h === Infinity);
          if (openFrom) openFrom.h = t;
          (shown[sc.start] = shown[sc.start] || []).push({ a: t, e: t + dur, h: Infinity });
          chromeNow = { ...this.chromeStart };
          cur = sc.start;
          t += dur;
        } else if (step.go) {
          const from = this.screens.get(cur);
          const to = this.screens.get(step.go);
          const via = step.via || 'push';
          // Тайминг шага: "timing": { "screen" | имя слоя: [длительность, кривая] } (токены или значения)
          const tm = step.timing || {};
          const timing = (k, d, e) => (tm[k] ? [ms(el, tm[k][0]), tm[k][1].startsWith('--') ? token(el, tm[k][1]) : tm[k][1]] : [d, e]);
          const [fade, fadeEase] = via === 'sheet' ? timing('screen', tk.dissolve, tk.dissolveEase) : [tk.dissolve, tk.dissolveEase];
          let dur = via === 'push' ? tk.push : fade;
          const easing = via === 'push' ? tk.pushEase : fadeEase;
          this.managed.add(from); this.managed.add(to);
          const zi = z++;
          if (via === 'push') {
            E.push({ at: t, dur, kind: 'go', name: cur + '→' + step.go, el: to, easing,
              before: { visibility: 'visible', zIndex: zi },
              frames: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }] });
            E.push({ at: t, dur, kind: 'leave', name: cur, el: from, easing,
              frames: [{ transform: 'translateX(0)' }, { transform: `translateX(${tk.parallax})` }],
              after: { visibility: 'hidden', transform: 'none' } });
          } else {
            // dissolve и sheet: новый экран проявляется поверх прежнего, прежний скрывается в конце
            E.push({ at: t, dur, kind: 'go', name: cur + '→' + step.go, el: to, easing,
              before: { visibility: 'visible', zIndex: zi, transform: 'none' },
              frames: [{ opacity: 0 }, { opacity: 1 }] });
            E.push({ at: t + dur, dur: 0, kind: 'leave', name: cur, el: from, frames: null,
              after: { visibility: 'hidden' } });
          }
          if (via === 'sheet') {
            // Общие слои (шторка, карта) переезжают из позы прежнего экрана в позу нового — только transform
            for (const [name, layer] of this.layers) {
              const a = this.pose(layer, cur);
              const b = this.pose(layer, step.go);
              if (a === b) continue;
              const [ld, le] = timing(name, fade, fadeEase);
              this.managed.add(layer);
              E.push({ at: t, dur: ld, kind: 'layer', name: name + ' ' + cur + '→' + step.go, el: layer, easing: le,
                frames: [{ transform: a }, { transform: b }] });
              dur = Math.max(dur, ld);
            }
          }
          // Системные элементы меняются вместе с переходом
          const want = step.chrome === 'start' ? { ...this.chromeStart } : { ...chromeNow, ...(step.chrome || {}) };
          for (const [name, c] of this.chrome) {
            const was = !!chromeNow[name];
            const will = !!want[name];
            if (was === will) continue;
            this.managed.add(c);
            E.push({ at: t, dur: via === 'push' ? dur : fade, kind: 'chrome', name: name + (will ? ' in' : ' out'), el: c,
              easing: via === 'push' ? tk.pushEase : fadeEase,
              frames: [{ opacity: was ? 1 : 0 }, { opacity: will ? 1 : 0 }] });
          }
          chromeNow = want;
          // Интервалы показа экранов (для Lottie)
          const openFrom = shown[cur].find((s) => s.h === Infinity);
          if (openFrom) openFrom.h = via === 'push' ? t + dur : t + dur;
          (shown[step.go] = shown[step.go] || []).push({ a: t, e: t + dur, h: Infinity });
          cur = step.go;
          t += dur;
          if (sc.reduced === cur && !this.reducedAt) this.reducedAt = t; // reduced motion: экран встал на место
        }
      }
      this.T = t;
      if (cur !== sc.start) console.warn('app-flow: сценарий не вернулся на стартовый экран — круг со скачком');

      // Lottie: время каждой «вставки» идёт с момента показа экрана (или когда встал — start: shown).
      // Стартовый экран показан с конца прошлого круга (смена телефона) — его время идёт оттуда, стык бесшовный.
      for (const slot of this.slots) {
        const ivs = (shown[slot.screen] || []).map((s) => ({ ...s }));
        const loopIn = ivs.find((s) => !s.first && s.h === Infinity && slot.screen === sc.start);
        slot.intervals = ivs.map((s) => {
          const h = s.h === Infinity ? this.T : s.h;
          if (s.first && loopIn) {
            const o = (slot.start === 'shown' ? loopIn.e : loopIn.a) - this.T;
            return { from: 0, to: h, origin: o };
          }
          return { from: s.a, to: h, origin: slot.start === 'shown' ? s.e : s.a };
        });
        // События: начало и конец показа, смена анимаций в очереди
        slot.intervals.forEach((iv) => {
          const marks = new Set([iv.from, iv.to, iv.origin]);
          let acc = iv.origin;
          slot.players.slice(0, -1).forEach((p) => { acc += p.dur; marks.add(acc); });
          marks.forEach((m) => {
            if (m >= 0 && m <= this.T && m >= iv.from && m <= iv.to) {
              E.push({ at: m, dur: 0, kind: 'lottie', name: slot.names.join('+') + ' @' + slot.screen, slot });
            }
          });
        });
      }
      this.events = E.sort((a, b) => a.at - b.at);
    }

    // Поза общего слоя на экране: data-flow-pose-<экран>="transform" (нет — как в разметке)
    pose(layer, screen) { return layer.getAttribute('data-flow-pose-' + screen) || 'none'; }

    // Лицо карты (scripts/card-face.js): видно с show, играет с on (и только пока играет сценарий);
    // off — скрыто и в покое (нейтральное лицо, следующей сыграет random)
    syncFace(state) {
      this.faceOn = state;
      this.faces.forEach((f) => {
        f.style.visibility = state === 'off' ? 'hidden' : 'visible';
        const face = f.cardFace;
        if (!face || !face.setGate) return;
        if (state === 'off') face.rest();
        face.setGate(state === 'on' && this.playing);
      });
    }

    // Клавиша цифры на клавиатуре: подсветка создаётся по геометрии data-flow-keypad
    key(pad, digit) {
      pad.keys = pad.keys || {};
      if (pad.keys[digit]) return pad.keys[digit];
      const [x0, y0, sx, sy, size] = nums(pad.dataset.flowKeypad);
      const pos = digit === '0' ? [1, 3] : digit === '⌫' ? [2, 3] : [(+digit - 1) % 3, Math.floor((+digit - 1) / 3)];
      const k = document.createElement('div');
      k.className = 'app-flow__press app-flow__press--key';
      place(k, x0 + pos[0] * sx, y0 + pos[1] * sy, size, size, size / 2);
      pad.appendChild(k);
      pad.keys[digit] = k;
      return k;
    }

    // ── Состояние в момент t
    reset() {
      this.running.forEach((a) => a.cancel());
      this.running = [];
      this.el.querySelectorAll('.app-flow__ghost').forEach((g) => g.remove());
      this.phone.style.transform = '';
      this.resetScreens();
    }

    resetScreens() {
      const start = this.script.start;
      this.screens.forEach((s, name) => {
        s.style.visibility = name === start ? 'visible' : 'hidden';
        s.style.transform = 'none';
        s.style.opacity = '1';
        s.style.zIndex = '0';
      });
      this.chrome.forEach((c, name) => { c.style.opacity = this.script.chrome[name] ? '1' : '0'; });
      this.layers.forEach((l) => { l.style.transform = this.pose(l, start); });
      this.el.querySelectorAll('.app-flow__press, .app-flow__dot').forEach((p) => { p.style.opacity = '0'; });
    }

    finish(ev) {
      const s = ev.el.style;
      if (ev.frames) Object.entries(ev.frames[ev.frames.length - 1]).forEach(([k, v]) => {
        if (k !== 'offset' && k !== 'easing') s[k] = v;
      });
      if (ev.after) Object.entries(ev.after).forEach(([k, v]) => { s[k] = v; });
    }

    // Событие наступило (elapsed — сколько мс назад)
    apply(ev, elapsed) {
      this.log.push({ at: ev.at, kind: ev.kind, name: ev.name, late: Math.round(elapsed) });
      if (this.log.length > 400) this.log.splice(0, 200);
      this.el.dispatchEvent(new CustomEvent('appflow:event', { detail: { at: ev.at, kind: ev.kind, name: ev.name } }));
      if (ev.kind === 'lottie') { this.syncSlot(ev.slot); return; }
      if (ev.kind === 'face') { this.syncFace(ev.face); return; }
      if (ev.kind === 'swap') { this.swap(ev, elapsed); return; }
      if (ev.before) Object.entries(ev.before).forEach(([k, v]) => { ev.el.style[k] = v; });
      if (!ev.frames || elapsed >= ev.dur) { this.finish(ev); return; }
      const a = ev.el.animate(ev.frames, { duration: ev.dur, easing: ev.easing || 'linear', fill: 'both' });
      a.currentTime = elapsed;
      a.playbackRate = this.rate;
      if (!this.playing) a.pause();
      a.onfinish = () => { this.finish(ev); a.cancel(); this.running = this.running.filter((x) => x !== a); };
      this.running.push(a);
    }

    // Lottie-вставка в момент t: какой плеер, какой кадр, играет ли
    slotState(slot, t) {
      const iv = slot.intervals.find((i) => t >= i.from && t < i.to) || null;
      const ps = slot.players;
      if (!iv) return { visible: false, idx: 0, frame: 0, playing: false };
      let local = t - iv.origin;
      if (local < 0) return { visible: true, idx: 0, frame: 0, playing: false };
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        const last = i === ps.length - 1;
        if (last) local %= p.dur;
        if (last || local < p.dur) return { visible: true, idx: i, frame: Math.min(local / 1000 * p.fr, p.total - 1), playing: true, loop: last };
        local -= p.dur;
      }
      return { visible: true, idx: 0, frame: 0, playing: false };
    }

    syncSlot(slot, t = this.time(), live = this.playing) {
      const st = this.slotState(slot, t);
      slot.players.forEach((p, i) => {
        const on = i === st.idx;
        p.box.hidden = !on;
        if (!on) { if (!p.anim.isPaused) p.anim.pause(); return; }
        p.anim.loop = !!st.loop;
        p.anim.setSpeed(this.rate);
        const play = st.visible && st.playing && live;
        if (play) p.anim.goToAndPlay(st.frame, true);
        else p.anim.goToAndStop(st.frame, true);
      });
      if (window.LottieKit) window.LottieKit.sync();
    }

    // Смена телефона: снимок финального состояния уезжает вниз, живой телефон (уже на стартовом экране) — сверху
    swap(ev, elapsed) {
      const before = ev.at - 0.001; // кадр перед сменой (интервал финального экрана заканчивается в ev.at)
      this.slots.forEach((s) => this.syncSlot(s, before, false));
      const ghost = this.phone.cloneNode(true);
      ghost.classList.add('app-flow__ghost');
      // id внутри SVG-отрисовок Lottie должны быть уникальны — иначе url(#…) снимка ссылается на живой плеер
      const ids = new Map();
      ghost.querySelectorAll('[id]').forEach((n) => { const v = n.id + '-ghost'; ids.set(n.id, v); n.id = v; });
      if (ids.size) {
        ghost.querySelectorAll('*').forEach((n) => {
          for (const a of [...n.attributes]) {
            if (!a.value.includes('#')) continue;
            const v = a.value.replace(/#([^\s)"']+)/g, (m, id) => (ids.has(id) ? '#' + ids.get(id) : m));
            if (v !== a.value) n.setAttribute(a.name, v);
          }
        });
      }
      this.phone.after(ghost);
      this.resetScreens(); // живой телефон — стартовое состояние
      const shift = token(this.el, '--flow-swap-shift') || '110%'; // читается в момент смены: у мобайла свой сдвиг
      const run = (el, frames, onDone) => {
        const a = el.animate(frames, { duration: ev.dur, easing: ev.easing, fill: 'both' });
        a.currentTime = elapsed;
        a.playbackRate = this.rate;
        if (!this.playing) a.pause();
        a.onfinish = () => { onDone(); a.cancel(); this.running = this.running.filter((x) => x !== a); };
        this.running.push(a);
      };
      run(ghost, [{ transform: 'translateY(0)' }, { transform: `translateY(${shift})` }], () => ghost.remove());
      run(this.phone, [{ transform: `translateY(-${shift})` }, { transform: 'translateY(0)' }], () => { this.phone.style.transform = ''; });
      this.slots.forEach((s) => this.syncSlot(s));
    }

    time() {
      return this.playing ? Math.min((now() - this.base) * this.rate, this.T) : this.t;
    }

    // Прокрутка к моменту t (мс внутри круга): всё прошедшее — конечным состоянием, идущее — с нужного места
    seek(t) {
      if (!this.ready) return;
      t = ((t % this.T) + this.T) % this.T;
      clearTimeout(this.timer);
      this.t = t;
      if (this.playing) this.base = now() - t / this.rate;
      this.reset();
      let i = 0;
      let face = 'off';
      for (; i < this.events.length && this.events[i].at <= t; i++) {
        const ev = this.events[i];
        if (ev.kind === 'lottie') continue;
        if (ev.kind === 'face') { face = ev.face; continue; }
        if (ev.kind === 'swap') { if (t < ev.at + ev.dur) this.apply(ev, t - ev.at); else this.resetScreens(); continue; }
        if (ev.before) Object.entries(ev.before).forEach(([k, v]) => { ev.el.style[k] = v; });
        if (!ev.frames || t >= ev.at + ev.dur) this.finish(ev);
        else this.apply(ev, t - ev.at);
      }
      this.next = i;
      this.slots.forEach((s) => this.syncSlot(s));
      this.syncFace(face);
      if (this.playing) this.schedule();
    }

    schedule() {
      clearTimeout(this.timer);
      const t = this.time();
      const ev = this.events[this.next];
      const until = ev ? ev.at : this.T;
      this.timer = setTimeout(() => this.tick(), Math.max(0, (until - t) / this.rate));
    }

    tick() {
      if (!this.playing) return;
      const t = this.time();
      while (this.next < this.events.length && this.events[this.next].at <= t + 4) {
        const ev = this.events[this.next++];
        this.apply(ev, Math.max(0, t - ev.at));
      }
      if (this.next >= this.events.length && t >= this.T - 4) {
        this.cycles = (this.cycles || 0) + 1;
        this.base = now();
        this.seek(0); // круг: конец = начало (стартовый экран после смены телефона)
        return;
      }
      this.schedule();
    }

    play() {
      if (this.playing || !this.ready) return;
      this.playing = true;
      this.base = now() - this.t / this.rate;
      this.seek(this.t);
    }

    pause() {
      if (!this.playing) return;
      this.t = this.time();
      this.playing = false;
      clearTimeout(this.timer);
      // Состояние ровно в момент паузы (WAAPI pause() встаёт кадром позже — пересобираем на паузе)
      this.seek(this.t);
      this.slots.forEach((s) => s.players.forEach((p) => p.anim.pause()));
      if (window.LottieKit) window.LottieKit.sync();
    }

    update(reason) {
      if (!this.ready) return;
      if (this.isReduced) {
        if (this.playing) this.pause();
        this.t = this.reducedAt;
        this.seek(this.reducedAt); // первый экран (или "reduced" сценария) статично
      } else if (this.canPlay()) this.play();
      else this.pause();
      this.el.dispatchEvent(new CustomEvent('appflow:state', {
        detail: { playing: this.playing, t: Math.round(this.time()), inView: this.inView, hiddenTab: document.hidden, reduced: this.isReduced, reason },
      }));
    }

    setReduced(value) { this.reduced = value; this.update('reduced-motion'); }
    setRate(r) { const t = this.time(); this.rate = r; this.t = t; if (this.playing) { this.base = now() - t / r; this.seek(t); } }
  }

  const flows = roots.map((el) => new AppFlow(el));
  const byEl = new Map(flows.map((f) => [f.el, f]));

  const near = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      near.unobserve(e.target);
      const f = byEl.get(e.target);
      if (!window.LottieKit) return;
      f.prepare().catch((err) => { console.warn('app-flow:', err); }); // нет сети — остаётся первый экран
    });
  }, { rootMargin: NEAR });

  /* Когда играть: блок должен быть на экране по-настоящему — не меньше SHOW_AT его высоты
     (для блока выше окна — SHOW_AT высоты окна), иначе пока читают текст выше, а прототип только
     выглянул снизу, сценарий успевает пройти (замечание пользователя). Ушёл с экрана целиком —
     сценарий сбрасывается на начало: при следующем появлении показываем с первого шага.
     Чуть проскроллили туда-обратно (блок не уходил) — пауза и продолжение с того же места. */
  const SHOW_AT = 0.6;
  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const f = byEl.get(e.target);
      const full = Math.min(e.boundingClientRect.height, (e.rootBounds && e.rootBounds.height) || innerHeight) || 1;
      const visible = e.isIntersecting ? e.intersectionRect.height / full : 0;
      const was = f.inView;
      f.inView = visible >= SHOW_AT - 0.001;
      if (!e.isIntersecting && f.ready && !f.isReduced && f.t > 0) {
        if (f.playing) f.pause();
        f.t = 0;
        f.seek(0);                      // ушёл с экрана — следующий показ с начала
      }
      if (f.inView !== was || !e.isIntersecting) f.update(f.inView ? 'in-view' : 'off-screen');
    });
  }, { threshold: [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 1] });

  flows.forEach((f) => { near.observe(f.el); seen.observe(f.el); });
  document.addEventListener('visibilitychange', () => flows.forEach((f) => f.update(document.hidden ? 'tab-hidden' : 'tab-visible')));
  reduceQuery.addEventListener('change', () => flows.forEach((f) => f.update('reduced-motion')));
})();
