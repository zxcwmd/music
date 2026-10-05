/* Проверка движка воспроизведения: очередь, перемешивание, повторы,
   избранное/история, громкость, обработка CORS-отката.
   Запуск:  node tests/player.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = 0, passed = 0;

function ok(cond, msg, extra) {
  if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + msg); }
  else { failed++; console.log('  \x1b[31m✗\x1b[0m ' + msg + (extra ? '\n      ' + extra : '')); }
}
function eq(a, b, msg) {
  ok(a === b, msg + '  →  ' + JSON.stringify(a), 'ожидалось ' + JSON.stringify(b));
}

/* --- песочница: фейковый Audio, документирующий всё, что с ним делают --- */
class FakeAudio {
  constructor() {
    this.handlers = {}; this.src = ''; this.currentTime = 0; this.duration = 300;
    this.volume = 1; this.muted = false; this.paused = true; this.buffered = { length: 0 };
    this.loads = 0; this.plays = 0; this.attrs = {};
  }
  addEventListener(n, f) { (this.handlers[n] || (this.handlers[n] = [])).push(f); }
  removeEventListener() {}
  dispatch(n) { (this.handlers[n] || []).forEach(f => f({})); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  load() { this.loads++; }
  play() { this.plays++; this.paused = false; this.dispatch('playing'); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatch('pause'); }
}

const store = {};
const created = [];
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  AbortController, URL, URLSearchParams,
  localStorage: {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  },
  fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) }),
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  devicePixelRatio: 1, addEventListener: () => {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  Image: class { set src(v) { this._s = v; } get src() { return this._s; } },
  Audio: function () { const a = new FakeAudio(); created.push(a); return a; },
  document: {
    readyState: 'complete', hidden: false,
    body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, style: {} },
    documentElement: { style: { setProperty() {} } },
    createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [] }) }), width: 0, height: 0 }),
    addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => []
  },
  navigator: {}
};
sandbox.window = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/util.js', 'assets/js/sources.js', 'assets/js/player.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const P = sandbox.Player;

const mk = (n, src) => ({
  id: 'audius:t' + n, source: 'audius', remoteId: 't' + n,
  title: 'Трек ' + n, artist: 'Артист', album: 'Альбом',
  duration: 200, cover: '', streamUrl: src || ('https://cdn/' + n + '.mp3')
});

/* ================================================================== */
console.log('\nинициализация');
P.init();
const audio = created[0];
ok(audio instanceof FakeAudio, 'создан единственный <audio>');
eq(audio.volume, 0.8, 'стартовая громкость (намеренно не 100%)');
eq(P.queue.length, 0, 'очередь пуста');
eq(P.current(), null, 'текущего трека нет');

console.log('\nочередь и порядок');
const list = [mk(1), mk(2), mk(3), mk(4), mk(5)];
P.setQueue(list, 0);
eq(P.queue.length, 5, 'в очереди 5 треков');
eq(P.order.length, 5, 'порядок содержит все индексы');
eq(P.order.slice().sort((a, b) => a - b).join(','), '0,1,2,3,4', 'порядок — перестановка 0..4');

const emitted = [];
P.on('track', t => emitted.push(t && t.id));
P.on('error', e => emitted.push('error:' + e.message));

(async () => {
  await P.playAt(2);
  eq(P.current().id, 'audius:t3', 'playAt(2) ставит третий трек');
  eq(audio.src, 'https://cdn/3.mp3', 'src указывает на поток');
  eq(audio.loads, 1, 'вызван load()');
  eq(audio.plays, 1, 'вызван play()');
  eq(audio.getAttribute('crossorigin'), 'anonymous', 'сначала пробуем с crossorigin');
  eq(emitted[emitted.length - 1], 'audius:t3', 'событие track с новым треком');

  /* --- next / prev по линейному порядку --- */
  await P.next(false);
  eq(P.current().id, 'audius:t4', 'next → следующий по порядку');
  await P.next(false);
  eq(P.current().id, 'audius:t5', 'next ещё раз');

  // трек доиграл сам, повтора нет — очередь должна остановиться, а не прыгнуть в начало
  await P.next(true);
  eq(P.current().id, 'audius:t5', 'автопереход в конце очереди не срабатывает');
  eq(audio.paused, true, 'и плеер встаёт на паузу');

  // а кнопка «следующий» вручную зацикливает очередь
  await P.next(false);
  eq(P.current().id, 'audius:t1', 'ручной next в конце → первый трек');

  P.repeat = 1;
  P.setQueue(list, 4);
  await P.playAt(4);
  await P.next(true);
  eq(P.current().id, 'audius:t1', 'repeat=1 → автопереход в начало очереди');
  P.repeat = 0;

  audio.currentTime = 100;
  await P.prev();
  eq(audio.currentTime, 0, 'prev при currentTime>4 → перемотка в начало, не смена трека');
  eq(P.current().id, 'audius:t1', 'трек не сменился');
  audio.currentTime = 0;
  await P.prev();
  eq(P.current().id, 'audius:t5', 'prev из начала → последний трек');

  /* --- repeat: один трек --- */
  P.repeat = 2;
  const before = P.current().id;
  await P.next(true);
  eq(P.current().id, before, 'repeat=2 → тот же трек по кругу');
  P.repeat = 0;

  /* --- перемешивание --- */
  console.log('\nперемешивание');
  P.setQueue(list, 0);
  const on = P.toggleShuffle();
  eq(on, true, 'toggleShuffle включает');
  eq(P.order.length, 5, 'порядок по-прежнему из 5');
  eq(P.order.slice().sort((a, b) => a - b).join(','), '0,1,2,3,4', 'и это всё та же перестановка');
  eq(P.order[0], 0, 'текущий трек остаётся первым после включения');
  eq(P.orderPos, 0, 'orderPos указывает на текущий');
  P.toggleShuffle();
  eq(P.shuffle, false, 'toggleShuffle выключает');
  eq(P.order.join(','), '0,1,2,3,4', 'без перемешивания порядок линейный');

  console.log('\nрежимы повтора');
  eq(P.cycleRepeat(), 1, '0 → 1');
  eq(P.cycleRepeat(), 2, '1 → 2');
  eq(P.cycleRepeat(), 0, '2 → 0');

  /* --- удаление из очереди --- */
  console.log('\nизменение очереди');
  P.setQueue(list, 3);
  P.removeFromQueue(1);
  eq(P.queue.length, 4, 'трек удалён');
  eq(P.index, 2, 'индекс текущего сдвинут');
  eq(P.current().id, 'audius:t4', 'текущий трек не потерялся');
  P.setQueue(list, 2);
  P.removeFromQueue(2);
  eq(P.current().id, 'audius:t3', 'удаление самого текущего игнорируется');
  P.appendQueue([mk(9)]);
  eq(P.queue.length, 6, 'appendQueue добавляет в конец');

  console.log('\nочистка очереди');
  P.clearQueue();
  eq(P.queue.length, 0, 'очередь пуста');
  eq(P.index, -1, 'индекс сброшен');
  eq(P.current(), null, 'текущего трека нет');

  /* --- избранное и история --- */
  console.log('\nизбранное и история');
  const arch = {
    id: 'arch:abc#1.mp3', source: 'archive', identifier: 'abc',
    title: 'Live', artist: 'Band', album: 'Concert', duration: 600,
    streamUrl: 'https://archive.org/download/abc/1.mp3', pageUrl: 'https://archive.org/details/abc'
  };
  eq(P.favorites().length, 0, 'избранное пусто');
  eq(P.toggleFavorite(list[0]), true, 'первое нажатие добавляет');
  eq(P.favorites().length, 1, 'в избранном один трек');
  ok(P.isFavorite(list[0]), 'isFavorite отвечает true');
  eq(P.toggleFavorite(list[0]), false, 'второе нажатие убирает');
  eq(P.favorites().length, 0, 'и избранное снова пусто');

  const slimAudius = P.slim(list[0]);
  eq(slimAudius.streamUrl, null, 'у Audius протухшая ссылка не сохраняется');
  const slimArch = P.slim(arch);
  eq(slimArch.streamUrl, 'https://archive.org/download/abc/1.mp3', 'у archive.org ссылка стабильная — сохраняем');
  eq(slimArch.title, 'Live', 'название сохраняется');

  delete store['aurora.history'];          // предыдущие шаги теста уже что-то наслояли
  P.setQueue([arch], 0);
  await P.playAt(0);
  eq(P.history().length, 1, 'трек попал в историю');
  eq(P.history()[0].id, arch.id, 'и это он');
  await P.playAt(0);
  eq(P.history().length, 1, 'повторное прослушивание не дублирует запись');

  /* --- громкость --- */
  console.log('\nгромкость');
  P.setVolume(0.42);
  eq(audio.volume, 0.42, 'громкость применена');
  P.setVolume(5);
  eq(audio.volume, 1, 'ограничена сверху');
  P.setVolume(-3);
  eq(audio.volume, 0, 'ограничена снизу');
  P.setVolume(0.7);
  P.toggleMute();
  eq(audio.muted, true, 'mute включает');
  P.toggleMute();
  eq(audio.muted, false, 'mute выключает');
  eq(JSON.parse(store['aurora.volume']), 0.7, 'громкость сохранена в localStorage');

  /* --- откат CORS --- */
  console.log('\nоткат при закрытом CORS');
  P.setQueue([mk(7)], 0);
  P.corsOK = true;
  P.retries = 0;
  await P.playAt(0);
  eq(audio.getAttribute('crossorigin'), 'anonymous', 'первая попытка с crossorigin');
  // имитируем: сервер не отдал ACAO, медиа-элемент сообщил об ошибке
  sandbox.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
    data: { id: 't7', title: 'Трек 7', user: { name: 'A' }, stream: { url: 'https://cdn/7b.mp3' } }
  }) });
  audio.dispatch('error');
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  eq(P.corsOK, false, 'флаг CORS сброшен');
  ok(!audio.getAttribute('crossorigin'), 'вторая попытка без crossorigin');
  eq(P.ctx, null, 'Web Audio не создан');

  P.corsOK = true;
  await P.playAt(0);
  eq(audio.getAttribute('crossorigin'), 'anonymous', 'флаг можно вернуть');

  /* --- буфер --- */
  console.log('\nбуферизация');
  audio.buffered = { length: 1, end: () => 150 };
  audio.duration = 300;
  eq(P.buffered(), 0.5, 'buffered() считает долю');
  audio.buffered = { length: 0 };
  eq(P.buffered(), 0, 'без буфера — 0');

  /* --- таймер сна --- */
  console.log('\nтаймер сна');
  eq(P.setSleep(15), 15, 'setSleep возвращает минуты');
  ok(P.sleepLeft() > 14 * 60 && P.sleepLeft() <= 15 * 60, 'обратный отсчёт ~15 минут', P.sleepLeft());
  eq(P.setSleep(0), 0, 'setSleep(0) выключает');
  eq(P.sleepLeft(), 0, 'и отсчёт обнуляется');

  /* --- ошибки потока --- */
  console.log('\nошибки потока');
  const errs = [];
  P.on('error', e => errs.push(e.message));
  P.setQueue([Object.assign(mk(11), { source: 'archive', streamUrl: 'https://archive.org/download/x/1.mp3' })], 0);
  P.retries = 5;                     // все попытки уже исчерпаны
  P.corsOK = false;
  await P.playAt(0);
  audio.dispatch('error');
  ok(errs.some(m => /Не удалось загрузить/.test(m)), 'после исчерпания попыток — понятная ошибка', errs.join('|'));

  /* --- перемотка --- */
  console.log('\nперемотка');
  audio.duration = 100; audio.currentTime = 0;
  P.seek(0.25);
  eq(audio.currentTime, 25, 'seek(0.25) → 25 с');
  P.seek(9);
  eq(audio.currentTime, 100, 'seek за границей прижимается к концу');
  P.seek(-1);
  eq(audio.currentTime, 0, 'и к началу');
  P.nudge(30);
  eq(audio.currentTime, 30, 'nudge(+30)');
  P.nudge(-1000);
  eq(audio.currentTime, 0, 'nudge не уходит в минус');

  console.log('\n' + (failed ? '\x1b[31m' : '\x1b[32m') + passed + ' пройдено, ' + failed + ' провалено\x1b[0m');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n\x1b[31mТест упал:\x1b[0m', e); process.exit(1); });
