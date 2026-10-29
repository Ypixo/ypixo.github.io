/*
 * «Живое» лицо на карте в мокапе: Lottie-анимации по очереди, по кругу.
 *
 * Разметка (всё декларативно, логики на странице нет):
 *   <div class="card-face" aria-hidden="true"
 *        data-card-face="drinking stare-blink"             — порядок анимаций (имена JSON), цикл
 *        data-face-src="media/optimized/card-animations/"  — папка с JSON (относительно страницы)
 *        data-face-rect="17.35 22.23 65.24 20.45"          — карта на мокапе: left top width height, % мокапа
 *        data-face-radius="5.74% / 8.96%"></div>           — скругление карты (необязательно)
 * Элемент кладётся внутрь position: relative-рамки мокапа (рядом с <img>), стили — .card-face.
 *
 * Случайные анимации: слово random в порядке — «любая из пула»:
 *        data-card-face="random stare-blink"               — random → stare-blink → random → …
 *        data-face-pool="music wink sleep …"               — из чего выбирать random
 *   Выбор — «мешок»: пул перемешивается (Фишер — Йетс) и выдаётся по одной, пока не кончится,
 *   потом перемешивается заново. Так все анимации пула проходят без повторов, и подряд одна и та же
 *   не выпадает: если новый мешок начинается с только что сыгранной, она меняется местами с соседней.
 *   Следующая случайная выбирается заранее — её и только её JSON предзагружается.
 *
 * Производительность:
 *   — lottie-web light (только SVG) грузится лениво, когда обложка в одном экране от окна
 *     (загрузчик и общий rAF — scripts/lottie-kit.js, общий с scripts/sheet-carousel.js);
 *   — на виду один играющий плеер; следующий собирается заранее в простое и стоит на паузе
 *     (скрыт), поэтому смена — переключение видимости в один кадр, без сборки DOM;
 *     в DOM не больше двух плееров (текущий и следующий), JSON грузится только для следующего;
 *   — вне экрана и на скрытой вкладке — пауза (lottie сам останавливает свой rAF);
 *   — без субкадров: анимации 60 fps, на 120 Гц экранах не рисуем лишние кадры;
 *   — prefers-reduced-motion: статичный кадр 0 (нейтральное лицо), без цикла;
 *   — без JS — просто мокап.
 * Состояние для отладки: событие 'cardface:state' на элементе (detail: { name, next, playing, reason }).
 *
 * Очередь из нескольких карт (data-face-sequence) — играет одна карта за раз, по очереди:
 *   <div data-face-sequence>                               — общий предок (например, рамка медиа)
 *     <div class="card-face" data-card-face="money-eyes" …></div>   — порядок очереди = порядок в разметке
 *     <div class="card-face" data-card-face="music" …></div>
 *     <div class="card-face" data-card-face="flag" …></div>
 *   </div>
 *   У каждой карты одна анимация; первый и последний её кадры должны совпадать (нейтральное лицо),
 *   тогда стоп-кадр после проигрыша неотличим от последнего кадра — без скачка.
 *   Отыгравшая карта встаёт на кадр 0 (одна SVG-отрисовка, плеер на паузе), сразу стартует следующая.
 *   Скрытые (display: none, например десктопные карты на мобайле) в очереди не участвуют и не грузятся;
 *   если видна одна карта — она играет по кругу. Смена раскладки (ресайз) пересчитывает очередь.
 *   Вне экрана, на скрытой вкладке — пауза играющей; reduced motion — все на кадре 0.
 *   Отладка: el.faceSequence (active, order, history) и событие 'facesequence:turn' на предке.
 *
 * Стоп-кадр и режимы карты (атрибуты на .card-face, необязательные):
 *   data-face-hold="48"   — кадр покоя (по умолчанию 0): на нём карта стоит до своей очереди, после неё
 *                           и в reduced motion. У карты с чередованием — «flag:56» (кадр покоя одной анимации:
 *                           с него карта стартует в reduced motion; в чередовании каждая анимация идёт с 0). В очереди круг играется со сдвигом: от кадра покоя до конца,
 *                           затем с 0 до кадра покоя (стык «последний → 0» бесшовный: первый кадр = последнему).
 *   data-face-play="turn" — по умолчанию: в очереди data-face-sequence;
 *                 ="loop" — вне очереди, играет всегда (на экране): одна анимация — по кругу,
 *                           несколько (data-card-face="flag look-around") — чередование, как у обложки;
 *                 ="hold" — вне очереди, стоит на кадре покоя (один отрисованный кадр, без rAF).
 *   data-face-gate        — лицо управляется извне (прототип scripts/app-flow.js, шаг { "face": "on" | "off" }):
 *                           до setGate(true) не играет; setGate(false) — пауза на текущем кадре;
 *                           rest() — покой: первая анимация порядка (random) на кадре 0, нейтральное лицо.
 */
(function () {
  const NEAR = '100% 0px'; // «подъезжает к экрану»: за один экран до окна
  const RANDOM = 'random';
  const SELF = document.currentScript && document.currentScript.src;

  const faces = [...document.querySelectorAll('[data-card-face]')];
  if (!faces.length || !('IntersectionObserver' in window)) return;

  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean);

  // Загрузка lottie, кэш JSON, простой и общий rAF — scripts/lottie-kit.js. Если страница
  // его не подключила, догружаем рядом с этим файлом (с той же меткой версии ?v=…).
  let kitPromise = null;
  const getKit = () => kitPromise || (kitPromise = window.LottieKit ? Promise.resolve(window.LottieKit)
    : new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const u = new URL('lottie-kit.js', SELF || location.href);
      if (SELF) u.search = new URL(SELF).search;
      s.src = u.href;
      s.onload = () => resolve(window.LottieKit);
      s.onerror = (e) => { kitPromise = null; reject(e); };
      document.head.appendChild(s);
    }));
  const loadLottie = () => getKit().then((kit) => kit.load());
  const loadJson = (url) => getKit().then((kit) => kit.json(url));
  const idle = (fn) => (window.LottieKit ? window.LottieKit.idle(fn) : setTimeout(fn, 1));

  // «Мешок» без повторов: все имена пула по одному разу в случайном порядке, потом новый мешок
  class Bag {
    constructor(names) { this.names = names; this.left = []; }
    draw(avoid) {
      if (!this.left.length) {
        const a = [...this.names];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        // Выдаём с конца: если первым выпадает только что сыгранное — меняем с соседним
        if (a.length > 1 && a[a.length - 1] === avoid) [a[0], a[a.length - 1]] = [a[a.length - 1], a[0]];
        this.left = a;
      }
      return this.left.pop();
    }
  }

  class CardFace {
    constructor(el) {
      this.el = el;
      this.order = words(el.dataset.cardFace); // слоты: имя анимации или random
      const pool = words(el.dataset.facePool);
      this.bag = pool.length ? new Bag(pool) : null;
      this.lastRandom = null;
      this.base = el.dataset.faceSrc || '';
      this.slot = 0;            // какой слот порядка сейчас
      this.name = null;         // какая анимация сейчас
      this.nextName = null;     // какая будет следующей (выбрана заранее)
      this.players = new Map(); // имя → { anim, box }
      this.building = new Map(); // имя → Promise (идёт сборка)
      this.inView = false;
      this.started = false;
      this.reduced = null; // null — как в системе, true/false — принудительно (превью)
      this.history = [];   // сыгранные имена (отладка)
      this.group = null;   // очередь data-face-sequence (если карта в ней)
      // Кадр покоя: «48» — для всех анимаций карты, «flag:56» — для одной (остальные — 0)
      this.holds = {}; this.holdAll = 0;
      words(el.dataset.faceHold).forEach((w) => {
        const [n, f] = w.includes(':') ? w.split(':') : [null, w];
        if (n) this.holds[n] = parseInt(f, 10) || 0; else this.holdAll = parseInt(f, 10) || 0;
      });
      this.mode = el.dataset.facePlay || 'turn';          // turn | loop | hold
      this.armed = false;  // в очереди: круг со сдвигом от кадра покоя заряжен
      this.gate = 'faceGate' in el.dataset ? false : null; // null — без внешнего управления

      const [x, y, w, h] = (el.dataset.faceRect || '0 0 100 100').split(/\s+/).map(Number);
      el.style.setProperty('--face-x', x + '%');
      el.style.setProperty('--face-y', y + '%');
      el.style.setProperty('--face-w', w + '%');
      el.style.setProperty('--face-h', h + '%');
      if (el.dataset.faceRadius) el.style.setProperty('--face-radius', el.dataset.faceRadius);
      el.cardFace = this;
    }

    // Одна анимация без random — просто цикл одного плеера
    get single() { return this.order.length === 1 && this.order[0] !== RANDOM; }
    url(name) { return this.base + name + '.json'; }
    holdFor(name) { return name in this.holds ? this.holds[name] : this.holdAll; }
    get hold() { return this.holdFor(this.name); }
    get isReduced() { return this.reduced ?? reduceQuery.matches; }

    // Имя для слота: фиксированное или следующее из мешка
    resolve(slot) {
      const word = this.order[slot % this.order.length];
      if (word !== RANDOM || !this.bag) return word;
      const name = this.bag.draw(this.lastRandom);
      this.lastRandom = name;
      return name;
    }

    // Обложка в одном экране от окна: грузим плеер и первую анимацию, следующую — в простое
    async prepare() {
      if (this.started) return;
      this.started = true;
      const first = this.resolve(0);
      const [lottie] = await Promise.all([loadLottie(), loadJson(this.url(first))]);
      this.lottie = lottie;
      await this.build(first);
      this.show(first, 0);
      this.update('ready');
      if (!this.single) idle(() => this.preloadNext());
    }

    // Сборка плеера; повторный вызов во время сборки ждёт ту же сборку (без дублей)
    build(name) {
      if (this.players.has(name)) return Promise.resolve(this.players.get(name));
      if (!this.building.has(name)) {
        this.building.set(name, this.create(name).finally(() => this.building.delete(name)));
      }
      return this.building.get(name);
    }

    async create(name) {
      const data = await loadJson(this.url(name));
      const box = document.createElement('div');
      box.className = 'card-face__player';
      box.hidden = true;
      this.el.appendChild(box);
      const anim = this.lottie.loadAnimation({
        container: box,
        renderer: 'svg',
        loop: this.single && !this.group,
        autoplay: false,
        animationData: data, // lottie помечает данные как разобранные (__complete) — повторно не парсит
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false, hideOnTransparent: true },
      });
      anim.setSubframe(false);
      anim.addEventListener('complete', () => (this.group ? this.group.done(this) : this.next()));
      const p = { anim, box };
      this.players.set(name, p);
      return p;
    }

    // Следующая выбирается один раз и заранее: её JSON — единственное, что предзагружается
    pickNext() {
      if (this.nextName === null) this.nextName = this.resolve(this.slot + 1);
      return this.nextName;
    }

    async preloadNext() {
      if (this.isReduced || this.single) return;
      const n = this.pickNext();
      if (n !== this.name) await this.build(n);
      this.update('preload');
    }

    show(name, slot) {
      const p = this.players.get(name);
      // в чередовании анимация стартует с 0 (иначе пропустит начало); кадр покоя — для одной анимации и reduced motion
      p.anim.goToAndStop(this.single || this.isReduced ? this.holdFor(name) : 0, true);
      p.box.hidden = false;
      this.players.forEach((q, k) => { if (k !== name) q.box.hidden = true; });
      this.name = name;
      this.slot = slot;
      this.history.push(name);
    }

    async next() {
      const to = this.pickNext();
      const slot = (this.slot + 1) % this.order.length;
      const p = await this.build(to); // обычно уже собран заранее — мгновенно
      this.nextName = null;
      this.show(to, slot);
      if (this.canPlay()) { p.anim.play(); syncLoop(); }
      // Держим не больше двух плееров: текущий и следующий (следующий выбираем сейчас же)
      const after = this.isReduced ? null : this.pickNext();
      this.players.forEach((q, k) => {
        if (k !== to && k !== after) { q.anim.destroy(); q.box.remove(); this.players.delete(k); }
      });
      this.update('change');
      idle(() => this.preloadNext());
    }

    canPlay() {
      if (this.mode === 'hold' || this.gate === false) return false;
      return this.inView && !document.hidden && !this.isReduced && (!this.group || this.group.active === this);
    }

    // Стоп на кадре покоя (сегменты сброшены: кадр — абсолютный)
    still() {
      const p = this.players.get(this.name);
      if (!p) return;
      p.anim.resetSegments(true);
      p.anim.goToAndStop(this.hold, true);
      this.armed = false;
    }

    // Ход в очереди: полный круг от кадра покоя — [покой → конец], [0 → покой]; 'complete' — после обоих
    arm() {
      const p = this.players.get(this.name);
      this.still();
      if (this.hold > 0) {
        p.anim.playSegments([[this.hold, p.anim.totalFrames], [0, this.hold]], true);
        p.anim.pause();
      }
      this.armed = true;
    }

    update(reason) {
      const p = this.players.get(this.name);
      if (!p) return;
      if (this.isReduced) {
        if (!p.anim.isPaused || p.anim.currentFrame !== this.hold || this.armed) this.still(); // кадр покоя, без движения
      } else if (this.canPlay()) {
        if (this.group && !this.armed) this.arm();
        if (p.anim.isPaused) p.anim.play();
      } else if (!p.anim.isPaused) {
        p.anim.pause();
      }
      syncLoop();
      this.el.dispatchEvent(new CustomEvent('cardface:state', {
        detail: {
          name: this.name,
          next: this.nextName,
          playing: !p.anim.isPaused,
          inView: this.inView,
          hiddenTab: document.hidden,
          reduced: this.isReduced,
          reason,
        },
      }));
    }

    // Внешнее управление (data-face-gate): можно ли играть
    setGate(open) {
      if (this.gate === !!open) return;
      this.gate = !!open;
      this.update(open ? 'gate-open' : 'gate-closed');
    }

    // Покой: первая анимация порядка (random — новая из мешка) на кадре 0 — нейтральное лицо, без движения.
    // Уже в покое (первый слот, кадр 0, пауза) — ничего не делает.
    rest() {
      const p = this.players.get(this.name);
      if (!p || this.isReduced) return;
      if (this.slot === 0 && p.anim.isPaused && Math.round(p.anim.currentFrame) === 0) return;
      p.anim.pause();
      this.slot = this.order.length - 1; // следующий слот — первый
      this.nextName = null;
      this.next();
    }

    // Превью: эмуляция prefers-reduced-motion (null — как в системе)
    setReduced(value) {
      this.reduced = value;
      if (!this.isReduced) this.preloadNext();
      this.update('reduced-motion');
    }
  }

  // Очередь карт: играет одна (active), остальные стоят на кадре 0 — без rAF
  class FaceSequence {
    constructor(root, members) {
      this.root = root;
      this.members = members;
      this.history = [];
      members.forEach((m) => { m.group = this; });
      this.active = this.visible()[0] || null;
      root.faceSequence = this;
    }
    // В очереди только отрисованные карты (display: none — не в очереди)
    visible() { return this.members.filter((m) => m.el.getClientRects().length > 0); }
    get order() { return this.visible().map((m) => m.order[0]); }

    // Карта доиграла: встаёт на стоп-кадр (кадр 0 = последнему), ход переходит к следующей видимой
    done(m) {
      if (m !== this.active) return;
      const vis = this.visible();
      const i = vis.indexOf(m);
      const next = vis.length ? vis[(i + 1) % vis.length] : null;
      this.turn(next, m);
    }

    turn(next, prev) {
      if (prev) prev.still(); // стоп-кадр: кадр покоя (последний кадр круга = ему же)
      this.active = next;
      if (next) {
        this.history.push(next.order[0]);
        next.still(); // круг заряжается в update(); если ещё не загружена — стартует по готовности
      }
      this.members.forEach((m) => { if (m !== next) m.update('sequence-wait'); });
      if (next) next.update('sequence-turn');
      this.root.dispatchEvent(new CustomEvent('facesequence:turn', {
        detail: { name: next && next.order[0], prev: prev && prev.order[0] },
      }));
    }

    // Раскладка поменялась (ресайз через брейкпоинт): активная скрыта — ход первой видимой
    refresh() {
      const vis = this.visible();
      if (this.active && vis.includes(this.active)) return;
      this.turn(vis[0] || null, this.active);
    }
  }

  const items = faces.map((el) => new CardFace(el));
  const sequences = [...document.querySelectorAll('[data-face-sequence]')].map((root) =>
    new FaceSequence(root, items.filter((f) => f.mode === 'turn' && root.contains(f.el))));
  if (sequences.length) {
    let t = 0;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => sequences.forEach((q) => q.refresh()), 150); });
  }

  // Общий цикл lottie (один rAF на все плееры страницы) замораживаем, когда ничего не играет:
  // вне экрана, на скрытой вкладке и в reduced motion страница не тратит ни одного кадра.
  // Считается по всем плеерам страницы (LottieKit.sync), не только по лицам карты.
  const syncLoop = () => { if (window.LottieKit) window.LottieKit.sync(); };
  const byEl = new Map(items.map((f) => [f.el, f]));

  // Подъезд к экрану → загрузка (один раз)
  const near = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      near.unobserve(e.target);
      byEl.get(e.target).prepare().catch(() => { /* нет сети — остаётся мокап */ });
    });
  }, { rootMargin: NEAR });

  // Видимость → игра / пауза
  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const f = byEl.get(e.target);
      f.inView = e.isIntersecting;
      f.update(e.isIntersecting ? 'in-view' : 'off-screen');
    });
  });

  items.forEach((f) => { near.observe(f.el); seen.observe(f.el); });
  document.addEventListener('visibilitychange', () => items.forEach((f) => f.update(document.hidden ? 'tab-hidden' : 'tab-visible')));
  reduceQuery.addEventListener('change', () => items.forEach((f) => f.update('reduced-motion')));
})();
