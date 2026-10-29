/*
 * Переходы между страницами. Стили — styles/page-transitions.css. Длительность — токен --motion-duration-page (1 с).
 * Подключается в <head> без defer и с blocking="render": иначе, пока файл грузится по сети, браузер
 * может «показать» страницу раньше, и pagereveal пройдёт мимо обработчика.
 * Сами движения страниц — CSS (page-transitions.css, ::view-transition-*). Здесь:
 *  1) направление: вперёд / назад (кнопка «Назад» с data-vt-back, браузерное «назад» по истории) →
 *     тип перехода 'back' → зеркальные @keyframes;
 *  2) построчное появление заголовка новой страницы ([data-reveal-lines]): строки — по фактическим
 *     переносам, каждая поднимается из-под маски. После анимации разметка заголовка возвращается как была.
 *     Строки всех [data-reveal-lines] на странице идут одной очередью (заголовок, затем подзаголовок).
 *  3) [data-reveal-on-load] — то же появление при обычном открытии страницы (ввод адреса, обновление):
 *     сразу, без ожидания перехода. Один раз за жизнь документа (возврат из bfcache не повторяет).
 *  4) Вместе со строками: [data-reveal-pop] (аватар) проявляется с лёгким увеличением — и при переходе,
 *     и при открытии; [data-reveal-rise] (карточки кейсов) — только при открытии и только те, что видны
 *     в первом экране: выезжают снизу под углом (--motion-page-tilt), как новая страница при переходе.
 * Без поддержки View Transitions (Firefox, старые Safari) — ничего не делает, навигация обычная.
 */
(function () {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const time = (v) => { v = v.trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; };
  const SPACE = /([ \t\n\r]+)/;

  // Доли от D — та же раскладка, что в page-transitions.css
  const REVEAL_AT = 0.6;      // строки поднимаются, когда переход закончился (он длится 0.6 D) — уже на живой странице
  const REVEAL_DUR = 0.45;   // строка — 450 мс при D = 1 с (text.mov)
  const LOAD_AT = 0.1;        // при обычном открытии — почти сразу после первой отрисовки
  const POP_DUR = 0.5;        // аватар
  let revealed = false;

  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch (e) {} },
  };

  /* Прокрутка при открытии страницы с [data-reload-top] (главная).
     Браузер сам возвращает прежнюю прокрутку после обновления, а с плавным скроллом (base.css) это видно
     как «улёт» страницы. Поэтому восстановление ручное: обновление и обычный заход — с самого верха,
     «назад/вперёд» по истории — на прежнее место, мгновенно. Якорь в адресе (#cases) браузер отрабатывает сам. */
  if (root.hasAttribute('data-reload-top') && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
    const KEY = 'scroll:' + location.pathname;
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type === 'back_forward' && !location.hash) {
      const y = parseFloat(store.get(KEY)) || 0;
      const restore = () => window.scrollTo({ top: y, behavior: 'instant' });
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore, { once: true });
      else restore();
    }
    addEventListener('pagehide', () => store.set(KEY, String(window.scrollY)));
  }

  // Клик по ссылке: запоминаем направление для следующей страницы
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a) store.set('pt-dir', a.hasAttribute('data-vt-back') ? 'back' : 'forward');
  }, true);

  function direction() {
    const act = window.navigation && navigation.activation;
    if (act && act.navigationType === 'traverse' && act.from && act.entry && act.from.index > -1) {
      return act.entry.index < act.from.index ? 'back' : 'forward';
    }
    return store.get('pt-dir') || 'forward';
  }

  /* Разбивка на строки: слова → span, группировка по top, каждая строка — маска + внутренний слой */
  function splitLines(el) {
    const html = el.innerHTML;
    const tokens = [];
    [...el.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        n.textContent.split(SPACE).forEach((p) => {
          if (!p) return;
          if (!p.replace(SPACE, '')) tokens.push(document.createTextNode(' '));
          else { const s = document.createElement('span'); s.textContent = p; tokens.push(s); }
        });
      } else tokens.push(n.cloneNode(true));
    });
    el.replaceChildren(...tokens);

    const lines = [];
    let cur = null, top = 0;
    tokens.forEach((t) => {
      if (t.nodeType === 3) { if (cur) cur.push(t); return; }
      if (t.nodeName === 'BR') { cur = null; return; }
      const y = t.getBoundingClientRect().top;
      if (!cur || Math.abs(y - top) > 2) { cur = []; lines.push(cur); top = y; }
      cur.push(t);
    });

    const inners = lines.map((l) => {
      while (l.length && l[l.length - 1].nodeType === 3) l.pop();
      while (l.length && l[0].nodeType === 3) l.shift();
      const line = document.createElement('span'); line.className = 'reveal-line';
      const inner = document.createElement('span'); inner.className = 'reveal-line__inner';
      inner.append(...l); line.append(inner);
      return line;
    });
    el.replaceChildren(...inners);
    return { inners: inners.map((l) => l.firstChild), restore: () => { el.innerHTML = html; } };
  }

  function reveal(vt) {
    revealed = true;
    const s = getComputedStyle(root);
    const D = time(s.getPropertyValue('--motion-duration-page'));
    const stagger = time(s.getPropertyValue('--motion-stagger-lines'));
    const ease = s.getPropertyValue('--motion-ease-reveal').trim();
    const start = D * (vt ? REVEAL_AT : LOAD_AT);
    let n = 0;                   // сквозной номер строки по всем элементам
    document.querySelectorAll(vt ? '[data-reveal-lines]' : '[data-reveal-on-load]').forEach((el) => {
      const { inners, restore } = splitLines(el);
      const anims = inners.map((inner) => inner.animate(
        [{ transform: 'translateY(calc(100% + 0.25em))' }, { transform: 'translateY(0)' }],
        { duration: D * REVEAL_DUR, delay: start + (n++) * stagger, easing: ease, fill: 'backwards' },
      ));
      const back = () => { anims.forEach((a) => a.cancel()); restore(); };
      Promise.all(anims.map((a) => a.finished)).then(restore, () => {});
      if (vt) vt.ready.catch(back);      // переход отменён (skip) — заголовок сразу на месте
    });

    const settle = (anims) => { if (vt) vt.ready.catch(() => anims.forEach((a) => a.cancel())); };
    const pageIn = s.getPropertyValue('--motion-ease-page-in').trim();
    settle([...document.querySelectorAll('[data-reveal-pop]')].map((el) => el.animate(
      [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: D * POP_DUR, delay: start, easing: pageIn, fill: 'backwards' },
    )));
    if (vt) return;
    const tilt = s.getPropertyValue('--motion-page-tilt').trim() || '3deg';
    const riseDur = time(s.getPropertyValue('--motion-duration-card-rise'));
    const riseEase = s.getPropertyValue('--motion-ease-card-rise').trim();
    [...document.querySelectorAll('[data-reveal-rise]')]
      .filter((el) => el.getBoundingClientRect().top < innerHeight)
      .forEach((el, i) => {
        const delay = start + i * stagger;
        el.animate(
          [{ transform: `translateY(30%) rotate(${tilt})` }, { transform: 'translateY(0) rotate(0deg)' }],
          { duration: riseDur, delay, easing: riseEase, fill: 'backwards' },
        );
        // мягкое проявление в начале пути — без «скачка» карточки на первом кадре
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: riseDur * 0.4, delay, easing: 'ease-out', fill: 'backwards' });
      });
  }

  /* Состояние стекла (светлое/тёмное) переносится со старой страницы и замораживается на время перехода */
  const GLASS = '.site-menu [data-glass-adapt]:not([hidden]), .case-back, .case-progress';
  const glassKey = (el) => getComputedStyle(el).viewTransitionName;
  function freezeGlass(vt) {
    let saved = {};
    try { saved = JSON.parse(store.get('pt-glass') || '{}'); } catch (err) {}
    store.del('pt-glass');
    root.setAttribute('data-pt-freeze', '');
    document.querySelectorAll(GLASS).forEach((el) => {
      const k = glassKey(el);
      if (saved[k]) el.dataset.backdrop = saved[k];
    });
    vt.finished.finally(() => {
      root.removeAttribute('data-pt-freeze');
      document.dispatchEvent(new Event('backdrop:refresh'));   // glass-backdrop.js пересчитает и сменит плавно
    });
  }

  window.addEventListener('pagereveal', (e) => {
    const vt = e.viewTransition;
    const dir = direction();
    store.del('pt-dir');
    const hadControls = store.get('pt-controls');
    store.del('pt-controls');
    if (!vt) {
      // обычное открытие страницы — построчное появление [data-reveal-on-load], один раз
      if (revealed || reduce.matches || !document.querySelector('[data-reveal-on-load]')) return;
      const go = () => reveal(null);
      if (document.readyState !== 'loading') go();
      else document.addEventListener('DOMContentLoaded', go, { once: true });
      return;
    }
    vt.ready.catch(() => {});   // пропущенный переход — не ошибка
    if (reduce.matches || root.hasAttribute('data-no-motion')) { vt.skipTransition(); return; }
    vt.types.add(dir);
    // фиксированные контролы кейса («Назад», прогресс): появляются или уходят вместе со страницей
    const had = hadControls === '1';
    const has = !!document.querySelector('.case-back');
    if (has && !had) {
      vt.types.add('controls-in');
      // после перехода живые «Назад» и прогресс проявляются (в самом переходе их слои скрыты)
      const els = document.querySelectorAll('.case-back, .case-progress');
      els.forEach((el) => { el.style.opacity = '0'; });
      vt.finished.finally(() => {
        const s = getComputedStyle(root);
        const D = time(s.getPropertyValue('--motion-duration-page'));
        els.forEach((el) => {
          el.style.opacity = '';
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D * 0.3, easing: s.getPropertyValue('--motion-ease-reveal').trim() });
        });
      });
    }
    if (had && !has) vt.types.add('controls-out');
    // стекло и цвет подписей — как в момент клика, без смены до конца перехода
    freezeGlass(vt);
    const run = () => reveal(vt);
    // заголовок должен быть уже разобран парсером (<link rel="expect" blocking="render">); если нет — по DOMContentLoaded
    if (document.querySelector('[data-reveal-lines]') || document.readyState !== 'loading') run();
    else document.addEventListener('DOMContentLoaded', run, { once: true });
  });

  // Старая страница: переход без анимации, если пользователь просит меньше движения
  window.addEventListener('pageswap', (e) => {
    const glass = {};
    document.querySelectorAll(GLASS).forEach((el) => { if (el.dataset.backdrop) glass[glassKey(el)] = el.dataset.backdrop; });
    store.set('pt-glass', JSON.stringify(glass));
    store.set('pt-controls', document.querySelector('.case-back') ? '1' : '0');
    if (e.viewTransition) e.viewTransition.ready.catch(() => {});
    if (e.viewTransition && (reduce.matches || root.hasAttribute('data-no-motion'))) e.viewTransition.skipTransition();
  });
})();
