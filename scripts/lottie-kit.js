/*
 * Общий помощник для Lottie-модулей (scripts/card-face.js, scripts/sheet-carousel.js).
 *
 *   LottieKit.load()     → Promise<lottie>: lottie-web light (только SVG), грузится один раз и лениво;
 *   LottieKit.json(url)  → Promise<data>: JSON анимации, один запрос на адрес (кэш на странице);
 *   LottieKit.idle(fn)   — выполнить в простое (requestIdleCallback или setTimeout);
 *   LottieKit.sync()     — общий rAF lottie (один на все плееры страницы) замораживается, когда
 *                          ни один плеер не играет, и размораживается, когда играет хоть один.
 *                          Считает по всем зарегистрированным анимациям, поэтому модули не мешают
 *                          друг другу: пауза лица карты не останавливает карусель, и наоборот.
 *
 * Подключается до модулей (defer, по порядку). Если страница его не подключила (главная),
 * card-face.js догружает его сам — рядом со своим файлом.
 */
(function () {
  if (window.LottieKit) return;
  // Плеер лежит в проекте (scripts/vendor, lottie-web 5.12.2, сборка light) — путь от этого файла
  const HERE = (document.currentScript && document.currentScript.src) || location.href;
  const LOTTIE_SRC = new URL('vendor/lottie_light-5.12.2.min.js', HERE).href;

  let lottiePromise = null;
  const load = () => lottiePromise || (lottiePromise = new Promise((resolve, reject) => {
    if (window.lottie) return resolve(window.lottie);
    const s = document.createElement('script');
    s.src = LOTTIE_SRC;
    s.async = true;
    s.onload = () => resolve(window.lottie);
    s.onerror = (e) => { lottiePromise = null; reject(e); };
    document.head.appendChild(s);
  }));

  const cache = new Map(); // url → Promise<data>
  const json = (url) => {
    if (!cache.has(url)) {
      const p = fetch(url).then((r) => {
        if (!r.ok) throw new Error(r.status + ' ' + url);
        return r.json();
      });
      p.catch(() => cache.delete(url)); // ошибка сети — следующий вызов попробует снова
      cache.set(url, p);
    }
    return cache.get(url);
  };

  const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 1000 })
    : (fn) => setTimeout(fn, 1);

  const sync = () => {
    const l = window.lottie;
    if (!l) return;
    const playing = l.getRegisteredAnimations().some((a) => !a.isPaused);
    if (playing) l.unfreeze(); else l.freeze();
  };

  window.LottieKit = { load, json, idle, sync };
})();
