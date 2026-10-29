/*
 * «Прокрутка букв» на ссылках (стили — styles/link-roll.css).
 * Сверено по docs/reference/transitions.mov, пункт меню «Music» (2.15–2.45 с):
 *  — наведение: буквы по очереди слева направо уезжают вверх, снизу въезжает копия —
 *    едет полупрозрачной и проявляется во второй половине пути;
 *  — уход курсора: слово целиком (все буквы разом) прокручивается обратно вниз.
 *  Замеры по docs/reference/links.mov — в комментарии к токенам в tokens.css.
 *
 * Где: .site-menu__item (пункты нижнего меню; в пилюле CV — только текст, иконка стоит)
 * и .link-roll (текстовые ссылки на страницах). Кнопка «Назад» — иконка, без эффекта.
 *
 * Разметка после разбивки (на первом наведении; только hover: hover + pointer: fine и без reduced motion):
 *   <span class="visually-hidden">Cases</span>                  ← доступное имя, как было
 *   <span class="link-roll__text" aria-hidden="true">
 *     <span class="link-roll__word">                            ← маска (clip-path) и nowrap
 *       <span class="link-roll__char"><span class="link-roll__a">C</span><span class="link-roll__b">C</span></span>…
 *   Пробелы между словами остаются обычными пробелами (переносы как были), неразрывный пробел —
 *   буква внутри слова. Кернинг сохраняется: ширина каждой буквы подгоняется под её исходную
 *   позицию в строке (margin-inline-end), ширина слова не меняется.
 * Анимируются только transform и opacity (Web Animations API), тайминги — токены tokens.css.
 * Без JS, на тач-экранах и при reduced motion — обычный текст.
 */
(function () {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const SELECTOR = '.site-menu__item, .link-roll';
  const MAX_STAGGER_TOTAL = 200; // ms: длинное слово не «ползёт» — шаг ужимается (см. --motion-stagger-roll)
  const SPACE = /([ \t\n\r]+)/;   // \s сюда не годится: он ловит и неразрывный пробел

  const rootStyle = () => getComputedStyle(document.documentElement);
  const time = (v) => { v = v.trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; };
  const tokens = () => {
    const s = rootStyle();
    return {
      dur: time(s.getPropertyValue('--motion-duration-roll')),
      stagger: time(s.getPropertyValue('--motion-stagger-roll')),
      ease: s.getPropertyValue('--motion-ease-roll').trim(),
      ghost: parseFloat(s.getPropertyValue('--motion-roll-ghost')),
      hold: parseFloat(s.getPropertyValue('--motion-roll-ghost-hold')),
      fadeEase: s.getPropertyValue('--motion-ease-roll-fade').trim(),
      outEase: s.getPropertyValue('--motion-ease-roll-out').trim(),
      out: time(s.getPropertyValue('--motion-duration-roll-out')),
    };
  };
  const off = () => reduce.matches || document.documentElement.hasAttribute('data-no-motion');

  /* Позиции букв в исходной строке — с кернингом и трекингом */
  function advances(node, text) {
    const r = document.createRange();
    const lefts = [];
    for (let i = 0; i < text.length; i++) {
      r.setStart(node, i); r.setEnd(node, i + 1);
      const rect = r.getClientRects()[0] || r.getBoundingClientRect();
      lefts.push(rect ? [rect.left, rect.right, rect.top] : [0, 0, 0]);
    }
    return lefts;
  }

  function splitTextNode(node, chars) {
    const text = node.textContent;
    const pos = advances(node, text);
    const hidden = document.createElement('span');
    hidden.className = 'visually-hidden';
    hidden.textContent = text;
    const wrap = document.createElement('span');
    wrap.className = 'link-roll__text';
    wrap.setAttribute('aria-hidden', 'true');

    let i = 0;
    text.split(SPACE).forEach((part) => {
      if (!part) return;
      if (SPACE.test(part) && !part.replace(SPACE, '')) {
        wrap.append(document.createTextNode(part));
        i += part.length;
        return;
      }
      const word = document.createElement('span');
      word.className = 'link-roll__word';
      for (let k = 0; k < part.length; k++, i++) {
        const c = part[k];
        const ch = document.createElement('span');
        ch.className = 'link-roll__char';
        const a = document.createElement('span'); a.className = 'link-roll__a'; a.textContent = c;
        const b = document.createElement('span'); b.className = 'link-roll__b'; b.textContent = c;
        ch.append(a, b);
        // исходный шаг буквы: до начала следующей в том же слове (с кернингом), у последней — её ширина
        const next = k < part.length - 1 && pos[i + 1][2] === pos[i][2] ? pos[i + 1][0] : pos[i][1];
        chars.push({ ch, a, b, advance: next - pos[i][0] });
        word.append(ch);
      }
      wrap.append(word);
    });
    node.replaceWith(hidden, wrap);
  }

  function split(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('.visually-hidden, .link-roll__text'))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    if (!nodes.length) return null;
    const chars = [];
    nodes.forEach((n) => splitTextNode(n, chars));
    // кернинг: подгоняем ширину каждой буквы под исходный шаг (дробные px)
    const widths = chars.map((c) => c.ch.getBoundingClientRect().width);
    chars.forEach((c, k) => {
      const d = c.advance - widths[k];
      if (Math.abs(d) > 0.01) c.ch.style.marginInlineEnd = d.toFixed(3) + 'px';
    });
    return chars;
  }

  function attach(el) {
    let chars = null;        // разбиваем лениво, на первом наведении: элемент точно виден, позиции букв верные
    let state = 'rest';      // rest | entering | hovered | leaving
    let hover = false;
    let anims = [];

    const clear = () => { anims.forEach((a) => a.cancel()); anims = []; };
    const done = (list, cb) => Promise.all(list.map((a) => a.finished)).then(cb, () => {});

    function enter() {
      const t = tokens();
      clear();
      state = 'entering';
      const step = chars.length > 1 ? Math.min(t.stagger, MAX_STAGGER_TOTAL / (chars.length - 1)) : 0;
      chars.forEach(({ a, b }, k) => {
        const o = { duration: t.dur, delay: k * step, easing: t.ease, fill: 'both' };
        anims.push(
          a.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], o),
          b.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], o),
          // копия едет полупрозрачной, проявляется на последних ≈ 40 % пути (как в docs/reference/links.mov)
          b.animate([
            { opacity: t.ghost, offset: 0 },
            { opacity: t.ghost, offset: t.hold, easing: t.fadeEase },
            { opacity: 1, offset: 1 },
          ], { duration: t.dur, delay: k * step, fill: 'both' }),
        );
      });
      const mine = anims.slice();
      done(mine, () => {
        if (anims[0] !== mine[0]) return;
        state = 'hovered';
        if (!hover) leave();
      });
    }

    function leave() {
      const t = tokens();
      clear();
      state = 'leaving';
      const o = { duration: t.out, easing: t.outEase, fill: 'both' };
      chars.forEach(({ a, b }) => {
        // обратный ход всем словом разом: копия уезжает вниз, буква возвращается сверху
        anims.push(
          a.animate([{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], o),
          b.animate([{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], o),
        );
      });
      const mine = anims.slice();
      done(mine, () => {
        if (anims[0] !== mine[0]) return;
        clear();
        state = 'rest';
        if (hover) enter();
      });
    }

    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || off()) return;
      if (!chars) {
        chars = split(el);
        if (!chars) return;
        el.classList.add('is-rolling-ready');
      }
      hover = true;
      if (state === 'rest') enter();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || !chars) return;
      hover = false;
      if (state === 'hovered') leave();
      // entering → доиграет и сам уйдёт; leaving → доиграет
    });
  }

  function init() {
    if (!fine.matches || reduce.matches) return;
    document.querySelectorAll(SELECTOR).forEach((el) => { if (!el.closest('[hidden]')) attach(el); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
