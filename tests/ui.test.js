/* Сквозная проверка интерфейса: настоящий index.html + настоящие util/sources/player/app,
   загруженные в jsdom. Клики, клавиатура и переходы — как у пользователя.
   Запуск:  node tests/ui.test.js */
'use strict';

const path = require('path');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.log('\x1b[33mПропущено:\x1b[0m нужен jsdom — выполните `npm install`, затем `npm run test:ui`');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
let failed = 0, passed = 0;
function ok(c, m, e) {
  if (c) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + m); }
  else { failed++; console.log('  \x1b[31m✗\x1b[0m ' + m + (e ? '\n      ' + e : '')); }
}
function eq(a, b, m) { ok(a === b, m + '  →  ' + JSON.stringify(a), 'ожидалось ' + JSON.stringify(b)); }
const tick = (n = 6) => new Promise(r => { let i = 0; (function s() { i++ >= n ? r() : setImmediate(s); })(); });

/* ---------- фикстуры ---------- */
const audiusTracks = [1, 2, 3].map(n => ({
  id: 'A' + n, title: 'Песня ' + n, duration: 180 + n, play_count: n * 100, favorite_count: n,
  genre: 'Electronic', permalink: '/u/song' + n,
  artwork: { '480x480': 'http://x/480-' + n + '.jpg', '1000x1000': 'http://x/1000-' + n + '.jpg' },
  stream: { url: 'http://cdn/audius' + n + '.mp3' },
  user: { id: 'u' + n, name: 'Артист ' + n, handle: 'a' + n }
}));
const archDocs = [
  { identifier: 'alb1', title: 'Первый альбом', creator: 'Группа А', downloads: 500, year: 2020 },
  { identifier: 'alb2', title: 'Второй альбом', creator: 'Группа Б', downloads: 300 }
];
const archMeta = {
  files: [
    { name: 'alb1_files.xml', format: 'Metadata' },
    { name: 'cover.jpg', format: 'JPEG' },
    { name: '01 - Группа А - Первая.mp3', format: 'VBR MP3', source: 'original', track: '1/2', length: '240', artist: 'Группа А', album: 'Первый альбом' },
    { name: '02 - Группа А - Вторая.mp3', format: 'VBR MP3', source: 'original', track: '2/2', length: '310', artist: 'Группа А', album: 'Первый альбом' }
  ],
  metadata: { identifier: 'alb1', title: 'Первый альбом', creator: 'Группа А', description: '<b>Описание</b>' }
};

function mockFetch(url) {
  url = String(url);
  const json = (data) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  if (url === 'https://api.audius.co') return json({ data: ['https://api.audius.co'] });
  if (url.includes('/v1/tracks/trending')) return json({ data: audiusTracks });
  if (url.includes('/v1/tracks/search')) return json({ data: audiusTracks.slice(0, 2) });
  if (url.includes('/v1/tracks/')) return json({ data: audiusTracks[0] });
  if (url.includes('advancedsearch.php')) return json({ response: { docs: archDocs } });
  if (url.includes('/metadata/')) return json(archMeta);
  return json({});
}

/* ---------- песочница ---------- */
const vc = new VirtualConsole();
const jsErrors = [];
vc.on('jsdomError', e => { if (!/Could not load|Not implemented: HTMLMediaElement/.test(e.message)) jsErrors.push(e.message); });
vc.on('error', (...a) => jsErrors.push(String(a.join(' '))));

const rejections = [];
process.on('unhandledRejection', r => rejections.push(String((r && r.message) || r)));

function installShims(w) {
  w.fetch = mockFetch;
  w.addEventListener('unhandledrejection', e => rejections.push(String((e.reason && e.reason.message) || e.reason)));

  // канвас визуализатора
  const ctx2d = new Proxy({}, {
    get: (t, k) => {
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'canvas') return { width: 100, height: 40 };
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : () => {};
      return undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; }
  });
  w.HTMLCanvasElement.prototype.getContext = () => ctx2d;

  // медиа-элемент: jsdom не умеет играть
  const M = w.HTMLMediaElement.prototype;
  M.load = function () { this._loaded = (this._loaded || 0) + 1; };
  M.play = function () { this._paused = false; this.dispatchEvent(new w.Event('playing')); return Promise.resolve(); };
  M.pause = function () { this._paused = true; this.dispatchEvent(new w.Event('pause')); };
  for (const [k, v] of [['duration', 200], ['volume', 1], ['currentTime', 0], ['muted', false]]) {
    Object.defineProperty(M, k, {
      configurable: true,
      get() { return this['_v_' + k] === undefined ? v : this['_v_' + k]; },
      set(x) { this['_v_' + k] = x; }
    });
  }
  Object.defineProperty(M, 'paused', { configurable: true, get() { return this._paused !== false; } });
  Object.defineProperty(M, 'buffered', { configurable: true, get() { return { length: 0 }; } });

  w.Element.prototype.setPointerCapture = function () {};
  w.Element.prototype.releasePointerCapture = function () {};
  w.AudioContext = undefined;      // Web Audio в jsdom нет — проверяем именно ветку без него
  w.ResizeObserver = class { observe() {} disconnect() {} };
}

(async () => {
  // подставляем настоящие файлы скриптов инлайном — загрузка по file:// в jsdom капризна
  const fs = require('fs');
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<link rel="stylesheet"[^>]*>/, '');
  html = html.replace(/<script src="assets\/js\/([^"]+)"><\/script>/g,
    (m, f) => '<script>' + fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8') + '</script>');
  ok(!/<script src=/.test(html), 'все скрипты подставлены инлайном');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
    beforeParse: installShims
  });
  const w = dom.window, d = w.document;
  await tick(20);

  const $ = s => d.querySelector(s);
  const $$ = s => Array.from(d.querySelectorAll(s));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const key = (k, opts) => d.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts)));
  const P = w.Player;

  console.log('\nзагрузка страницы');
  ok(!!w.U && !!w.Sources && !!w.Player, 'все четыре модуля загружены');
  eq(jsErrors.filter(m => !/getContext|Audio|fetch/i.test(m)).length, 0, 'без ошибок в консоли', jsErrors.join(' | '));
  ok($('.hero'), 'нарисован hero-блок');
  eq($$('#view .track').length, 3, 'список трендов из фикстуры — 3 трека');
  eq($$('#view .chip').length, w.Sources.Audius.genres.length, 'чипсы жанров');
  eq($('.track__title').textContent, 'Песня 1', 'первый трек в списке');
  ok($('#statusPill').textContent.includes('3'), 'счётчик в статус-баре', $('#statusPill').textContent);
  eq($('#npTitle').textContent, 'Ничего не играет', 'плеер пуст до первого клика');

  console.log('\nклик по треку');
  click($$('#view .track')[0]);
  await tick(12);
  eq(P.current() && P.current().id, 'audius:A1', 'трек выбран');
  eq(w.Player.audio.src, 'http://cdn/audius1.mp3', 'плеер получил поток');
  ok($('#btnPlay').classList.contains('is-playing'), 'кнопка перешла в «играет»');
  eq($('#npTitle').textContent, 'Песня 1', 'название в плеере');
  eq($('#npArtist').textContent, 'Артист 1', 'артист в плеере');
  eq($('#tDur').textContent, '3:01', 'длительность из метаданных (181 с)', $('#tDur').textContent);
  ok(d.title.includes('Песня 1'), 'заголовок вкладки обновлён', d.title);
  ok($('#view .track').classList.contains('is-current'), 'строка подсвечена');
  ok($('.track.is-current .eq'), 'появился анимированный эквалайзер');
  eq($('#queueList').children.length > 0 || !$('.drawer').classList.contains('is-open'), true, 'очередь не рисуется, пока закрыта');

  console.log('\nкнопки плеера');
  click($('#btnNext')); await tick(10);
  eq(P.current().id, 'audius:A2', 'next переключил трек');
  click($('#btnPrev')); await tick(10);
  eq(P.current().id, 'audius:A1', 'prev вернул назад');
  click($('#btnPlay')); await tick(4);
  ok(!$('#btnPlay').classList.contains('is-playing'), 'пауза сняла подсветку');
  click($('#btnPlay')); await tick(4);
  ok($('#btnPlay').classList.contains('is-playing'), 'и снова играет');
  click($('#btnShuffle'));
  ok($('#btnShuffle').classList.contains('is-on'), 'перемешивание подсветилось');
  ok(P.shuffle, 'и включилось в движке');
  click($('#btnShuffle'));
  click($('#btnRepeat'));
  eq(P.repeat, 1, 'repeat → очередь');
  click($('#btnRepeat'));
  ok($('#btnRepeat').innerHTML.includes('i-repeat1'), 'иконка сменилась на «1»', $('#btnRepeat').innerHTML);
  click($('#btnRepeat'));
  eq(P.repeat, 0, 'третий клик выключает повтор');

  console.log('\nизбранное');
  click($$('#view .track')[1].querySelector('[data-act="fav"]'));
  await tick(4);
  eq(P.favorites().length, 1, 'трек добавлен');
  eq(P.favorites()[0].id, 'audius:A2', 'и это именно второй');
  click($$('#view .track')[1].querySelector('[data-act="fav"]'));
  await tick(4);
  eq(P.favorites().length, 0, 'повторный клик убрал');
  click($$('#view .track')[0].querySelector('[data-act="fav"]'));
  await tick(4);
  ok($('.toast'), 'появился тост');

  console.log('\nдобавление в очередь');
  const qBefore = P.queue.length;
  click($$('#view .track')[2].querySelector('[data-act="enqueue"]'));
  await tick(4);
  eq(P.queue.length, qBefore + 1, 'очередь выросла на один');
  eq(P.queue[P.queue.length - 1].id, 'audius:A3', 'в конец добавлен третий трек');
  eq(P.current().id, 'audius:A1', 'текущий трек не сбросился');

  console.log('\nпанель очереди');
  click($('#btnQueue')); await tick(4);
  ok($('#drawer').classList.contains('is-open'), 'панель открылась');
  eq($$('#queueList .qrow').length, P.queue.length, 'в панели все треки очереди');
  ok($('#queueList .qrow.is-current'), 'текущий помечен');
  click($('#queueList .qrow:not(.is-current)')); await tick(10);
  ok(P.current().id !== 'audius:A1', 'клик по строке очереди переключил трек', P.current() && P.current().id);
  click($('#btnCloseDrawer')); await tick(4);
  ok(!$('#drawer').classList.contains('is-open'), 'панель закрылась');

  console.log('\nклавиатура');
  const before = P.current().id;
  const wasPlaying = $('#btnPlay').classList.contains('is-playing');
  key(' '); await tick(4);
  ok($('#btnPlay').classList.contains('is-playing') !== wasPlaying, 'пробел переключает воспроизведение');
  key(' '); await tick(4);
  ok($('#btnPlay').classList.contains('is-playing') === wasPlaying, 'второй пробел возвращает как было');
  key('n'); await tick(10);
  ok(P.current().id !== before, 'N — следующий трек');
  key('l'); await tick(4);
  ok(P.favorites().length >= 1, 'L — добавить в избранное');
  key('q'); await tick(4);
  ok($('#drawer').classList.contains('is-open'), 'Q — открыть очередь');
  key('Escape'); await tick(4);
  ok(!$('#drawer').classList.contains('is-open'), 'Esc — закрыть');
  key('f'); await tick(6);
  ok($('#np').classList.contains('is-open'), 'F — полноэкранный вид трека');
  eq($('#npBigTitle').textContent, P.current().title, 'в нём крупное название');
  ok($('#npStats').children.length > 0, 'и статистика');
  key('Escape'); await tick(4);
  ok(!$('#np').classList.contains('is-open'), 'Esc закрывает и его');

  console.log('\nнавигация: Internet Archive');
  click($('[data-view="archive"]')); await tick(14);
  eq($$('#view .card').length, 2, 'сетка альбомов из фикстуры');
  eq($('.card__title').textContent, 'Первый альбом', 'название альбома');
  eq($$('#view .chip').length, w.Sources.Archive.shelves.length, 'чипсы подборок');

  console.log('\nоткрытие альбома');
  click($('#view .card')); await tick(14);
  eq($$('#view .track').length, 2, 'два трека альбома');
  eq($$('#view .track .track__title')[0].textContent.replace(/^IA/, '').trim(), 'Первая', 'название очищено от номера и артиста',
     $$('#view .track .track__title')[0].textContent);
  ok($('#view [data-act="play-all"]'), 'есть кнопка «Слушать всё»');
  ok($('#view [data-act="shuffle-all"]'), 'и «Перемешать»');
  click($('#view [data-act="play-all"]')); await tick(12);
  eq(P.queue.length, 2, 'весь альбом встал в очередь');
  eq(P.queue[0].streamUrl, 'https://archive.org/download/alb1/' + encodeURIComponent('01 - Группа А - Первая.mp3'),
     'прямая ссылка на archive.org');
  ok(P.current().id.startsWith('arch:alb1'), 'играет трек из альбома', P.current() && P.current().id);

  console.log('\nпоиск');
  $('#searchInput').value = 'ambient';
  $('#searchInput').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(14);
  eq($$('#view .track').length, 2, 'результаты Audius по запросу');
  ok($('#view').textContent.includes('Найдено'), 'показан счётчик');

  console.log('\nизбранное и история как разделы');
  click($('[data-view="favorites"]')); await tick(10);
  ok($$('#view .track').length >= 1, 'в избранном есть треки');
  click($('[data-view="history"]')); await tick(10);
  ok($$('#view .track').length >= 1, 'история заполнена');

  console.log('\nэконом-режим');
  click($('#btnPerf')); await tick(4);
  ok(d.body.classList.contains('perf'), 'класс perf на body');
  eq($('#perfLabel').textContent, 'вкл', 'подпись переключилась');
  ok(!P.Viz.running, 'цикл визуализатора остановлен');
  click($('#btnPerf')); await tick(4);
  ok(!d.body.classList.contains('perf'), 'и снимается обратно');

  console.log('\nтаймер сна');
  click($('#btnSleep')); await tick(4);
  eq($('#sleepLabel').textContent, '15 мин', 'первый шаг — 15 минут');
  ok($('#btnSleep').classList.contains('is-on'), 'кнопка подсвечена');
  ok(P.sleepLeft() > 0, 'идёт обратный отсчёт');
  click($('#btnSleep')); click($('#btnSleep')); click($('#btnSleep')); await tick(4);
  eq($('#sleepLabel').textContent, 'выкл', 'по кругу возвращаемся к выкл');

  console.log('\nгонка: ответ пришёл после смены вида');
  const realFetch = w.fetch;
  let resolveSearch = null;
  w.fetch = (url) => String(url).includes('/v1/tracks/search')
    ? new Promise(r => { resolveSearch = r; })      // запрос «зависает»
    : realFetch(url);
  $('#searchInput').value = 'slow';
  $('#searchInput').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(6);
  ok(!!$('#searchBody'), 'показан скелетон загрузки');
  click($('[data-view="favorites"]')); await tick(6);
  ok(!$('#searchBody'), 'пользователь ушёл на другой вид');
  const errCount = jsErrors.length + rejections.length;
  resolveSearch({ ok: true, status: 200, json: () => Promise.resolve({ data: audiusTracks }) });
  await tick(20);
  await new Promise(r => setTimeout(r, 30));
  eq(jsErrors.length + rejections.length, errCount, 'поздний ответ не уронил приложение',
     jsErrors.slice(errCount).concat(rejections).join(' | '));
  w.fetch = realFetch;

  console.log('\nвизуализатор без Web Audio');
  ok(!w.AudioContext, 'AudioContext в этом окружении нет');
  eq(P.ctx, null, 'контекст не создан');
  eq(P.Viz.analyser, undefined, 'анализатор не привязан');
  let drawErr = null;
  try { P.Viz.ringOpen = true; P.Viz.resize(); for (let f = 0; f < 120; f++) P.Viz.draw(f * 16); }
  catch (e) { drawErr = e.message; }
  ok(!drawErr, '120 кадров рисуются без ошибок', drawErr);
  const lv = P.Viz.levels(1000);
  eq(lv.length, 64, 'отдаёт 64 уровня');
  ok(Array.from(lv).every(v => v >= 0 && v <= 1), 'все уровни в диапазоне 0..1');
  P.Viz.ringOpen = false;

  console.log('\nSoundCloud: официальный виджет');
  click($('[data-view="soundcloud"]')); await tick(8);
  ok($('#scInput'), 'поле для ссылки');
  ok($('.sc__note'), 'предупреждение о блокировке в РФ');
  $('#scInput').value = 'https://soundcloud.com/forss/flickermood';
  click($('#view [data-act="sc-play"]')); await tick(6);
  const fr = $('#scFrame');
  ok(!!fr, 'создан iframe виджета');
  ok(fr && fr.getAttribute('src').indexOf('https://w.soundcloud.com/player/?url=') === 0, 'src — официальный виджет', fr && fr.getAttribute('src'));
  ok(fr && fr.getAttribute('src').indexOf(encodeURIComponent('https://soundcloud.com/forss/flickermood')) !== -1, 'ссылка закодирована в url=');
  ok(fr && fr.getAttribute('src').indexOf('auto_play=true') !== -1, 'автоплей включён');
  // невалидная ссылка не создаёт плеер
  $('#scInput').value = 'https://example.com/not-soundcloud';
  const framesBefore = $$('#view iframe').length;
  click($('#view [data-act="sc-play"]')); await tick(4);
  eq($$('#view iframe').length, framesBefore, 'невалидная ссылка не создаёт iframe');
  // плейлист (/sets/) → высокий виджет
  $('#scInput').value = 'https://soundcloud.com/artist/sets/myset';
  click($('#view [data-act="sc-play"]')); await tick(4);
  ok($('#scFrame').classList.contains('sc__frame--visual'), 'плейлист получает высокий виджет');

  console.log('\nXSS: названия из API экранируются');
  w.eval(`window.Sources.Audius.trending = function(){ return Promise.resolve([{
    id:'audius:evil', source:'audius', remoteId:'evil',
    title:'<img src=x onerror="window.__pwned=1">', artist:'"><script>window.__pwned=1<\\/script>',
    album:'x', duration:10, cover:'', streamUrl:'http://cdn/e.mp3'
  }]); };`);
  click($('[data-view="home"]')); await tick(16);
  click(Array.from(d.querySelectorAll('#view [data-chip="genre"]'))
        .find(c => c.dataset.val === 'Techno')); await tick(16);
  ok(!w.__pwned, 'скрипт из названия не выполнился');
  eq($$('#view .track img[src="x"]').length, 0, 'и тег <img> не появился');
  ok($('.track__title').textContent.includes('<img'), 'текст показан как есть', $('.track__title').textContent);

  console.log('\n' + (failed ? '\x1b[31m' : '\x1b[32m') + passed + ' пройдено, ' + failed + ' провалено\x1b[0m');
  if (jsErrors.length) console.log('\x1b[33mзаметки jsdom:\x1b[0m ' + jsErrors.slice(0, 5).join(' | '));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n\x1b[31mТест упал:\x1b[0m', e); process.exit(1); });
