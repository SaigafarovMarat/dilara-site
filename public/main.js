(function () {
  // Кнопка быстрого выхода: заменяет страницу в истории, чтобы «Назад» не вернул на сайт
  function quickExit() {
    try { window.open('https://www.google.com', '_blank'); } catch (e) {}
    window.location.replace('https://www.google.com');
  }
  var btn = document.getElementById('quick-exit');
  if (btn) btn.addEventListener('click', quickExit);

  // Двойное нажатие Esc тоже закрывает страницу
  var lastEsc = 0;
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var now = Date.now();
    if (now - lastEsc < 700) quickExit();
    lastEsc = now;
  });

  // Мобильное меню
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Плавное появление блоков
  var items = document.querySelectorAll('.reveal');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || reduce) {
    items.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach(function (el) { io.observe(el); });
})();
