/* Проверка реального кода источников на реальных ответах API.
   Запуск:  node tests/sources.test.js
   Фикстуры ниже — точные срезы ответов archive.org/metadata и Audius /v1/tracks/trending,
   полученные 2026-10-04. Сетевые запросы подменяются, чтобы тест был воспроизводимым. */
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
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '  →  ' + JSON.stringify(actual),
     'ожидалось ' + JSON.stringify(expected));
}

/* ------------------------------------------------------------------ *
 * Загружаем боевые файлы в песочницу с минимальным window/document
 * ------------------------------------------------------------------ */
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  AbortController, URL, URLSearchParams,
  localStorage: {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); }
  },
  fetch: () => Promise.reject(new Error('сеть в тесте отключена')),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  devicePixelRatio: 1,
  addEventListener: () => {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  Image: class { set src(v) { this._src = v; } get src() { return this._src; } },
  Audio: class { setAttribute() {} removeAttribute() {} getAttribute() { return null; } load() {} play() { return Promise.resolve(); } pause() {} },
  document: {
    readyState: 'complete',
    body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, style: {} },
    documentElement: { style: { setProperty() {} } },
    createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [] }) }), width: 0, height: 0 }),
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    hidden: false
  },
  navigator: {},
  localStorageAvailable: true
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);

for (const f of ['assets/js/util.js', 'assets/js/sources.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}

const U = sandbox.U;
const { Audius, Archive } = sandbox.Sources;

/* ================================================================== *
 * 1. util
 * ================================================================== */
console.log('\nutil');
eq(U.fmt(0), '0:00', 'fmt(0)');
eq(U.fmt(65), '1:05', 'fmt(65)');
eq(U.fmt(3661), '1:01:01', 'fmt(3661)');
eq(U.fmt(NaN), '0:00', 'fmt(NaN)');
eq(U.compact(1323441), '1.3M', 'compact(1323441)');
eq(U.compact(980), '980', 'compact(980)');
eq(U.clamp(5, 0, 1), 1, 'clamp верхняя граница');
eq(U.esc('<script>"&"</script>'), '&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;', 'esc экранирует HTML');
eq(U.trackNumber({ track: '3/8' }), 3, 'trackNumber("3/8")');
eq(U.trackNumber({}), 9999, 'trackNumber без поля');
eq(U.cleanTitle('01 Riding Alone For Thousands Of Miles - lullaby', 'Riding Alone for Thousands of Miles'),
   'lullaby', 'cleanTitle срезает номер и артиста');
eq(U.cleanTitle('05 - Satellite.mp3'), 'Satellite', 'cleanTitle с расширением');
eq(U.natural('track2', 'track10'), -1, 'natural сортирует по числам');
eq(U.cleanTitle('2001 A Space Odyssey'), '2001 A Space Odyssey', 'cleanTitle не ломает год в названии');
eq(U.cleanTitle('3. Third Song'), 'Third Song', 'cleanTitle «3. …»');
eq(U.cleanTitle('Artist - Track', 'Artist'), 'Track', 'cleanTitle только артист');
eq(U.cleanTitle('', 'X'), 'Без названия', 'cleanTitle пустой строки');

/* ================================================================== *
 * 2. Internet Archive — разбор реального ответа /metadata/badpanda018
 * ================================================================== */
console.log('\narchive.pickAudio (реальный список файлов badpanda018)');

const realFiles = [
  { name: '00RidingAloneForThousandsOfMiles-BrickCityGhosts.jpg', source: 'original', format: 'JPEG', title: '00 Riding Alone for Thousands of Miles - Brick City Ghosts' },
  { name: '00RidingAloneForThousandsOfMiles-BrickCityGhosts.png', source: 'original', format: 'PNG' },
  { name: '00RidingAloneForThousandsOfMiles-BrickCityGhosts_thumb.jpg', source: 'derivative', format: 'JPEG Thumb' },
  { name: '01RidingAloneForThousandsOfMiles-Lullaby.mp3', source: 'original', format: 'VBR MP3', title: '01 Riding Alone For Thousands Of Miles - lullaby', artist: 'Riding Alone for Thousands of Miles', album: 'Brick City Ghosts', track: '1\\/8', length: '509.22' },
  { name: '01RidingAloneForThousandsOfMiles-Lullaby.ogg', source: 'derivative', format: 'Ogg Vorbis', original: '01RidingAloneForThousandsOfMiles-Lullaby.mp3', length: '496.11' },
  { name: '02RidingAloneForThousandsOfMiles-AnyasPrayerAnyasDream.mp3', source: 'original', format: 'VBR MP3', title: "02 Riding Alone For Thousands Of Miles - Anya's prayer, Anya's dream", artist: 'Riding Alone for Thousands of Miles', album: 'Brick City Ghosts', track: '2\\/8', length: '601.72' },
  { name: '02RidingAloneForThousandsOfMiles-AnyasPrayerAnyasDream.ogg', source: 'derivative', format: 'Ogg Vorbis', length: '588' },
  { name: '03RidingAloneForThousandsOfMiles-SheWasMyLighthouse.mp3', source: 'original', format: 'VBR MP3', title: '03 Riding Alone For Thousands Of Miles - she was my lighthouse', track: '3\\/8', length: '348.51' },
  { name: '04RidingAloneForThousandsOfMiles-LoveSong.mp3', source: 'original', format: 'VBR MP3', title: '04 Riding Alone For Thousands Of Miles - love song', track: '4\\/8', length: '396.76' },
  { name: '05RidingAloneForThousandsOfMiles-Satellite.mp3', source: 'original', format: 'VBR MP3', title: '05 Riding Alone For Thousands Of Miles - satellite', track: '5\\/8', length: '165.1' },
  { name: 'Riding Alone For Thousands Of Miles - Brick City Ghosts.zip', source: 'original', format: 'ZIP' },
  { name: 'RidingAloneForThousandsOfMiles-BrickCityLoveSong.wav', source: 'original', format: 'WAVE', length: '440.64' },
  { name: 'RidingAloneForThousandsOfMiles-BrickCityLoveSong.flac', source: 'derivative', format: 'Flac' },
  { name: 'badpanda018_files.xml', source: 'metadata', format: 'Metadata' },
  { name: 'badpanda018_meta.xml', source: 'metadata', format: 'Metadata' },
  { name: 'badpanda018_spectrogram.png', source: 'derivative', format: 'Spectrogram' },
  { name: 'badpanda018_checksums', source: 'metadata', format: 'Checksums' },
  { name: 'badpanda018_archive.torrent', source: 'metadata', format: 'Archive BitTorrent' },
  { name: 'badpanda018.ffp', source: 'derivative', format: 'Flac FingerPrint' }
];

const picked = Archive.pickAudio(realFiles);
eq(picked.length, 5, 'осталось 5 MP3-оригиналов');
ok(picked.every(f => /\.mp3$/i.test(f.name)), 'только .mp3');
ok(picked.every(f => f.source === 'original'), 'только оригиналы (не производные ogg)');
eq(picked[0].name, '01RidingAloneForThousandsOfMiles-Lullaby.mp3', 'первым идёт трек 1');
eq(picked[4].name, '05RidingAloneForThousandsOfMiles-Satellite.mp3', 'последним — трек 5');
ok(!picked.some(f => /(_files\.xml|_meta\.xml|spectrogram|\.torrent|\.ffp|\.zip|\.flac|\.wav|\.jpg|\.png|checksums)/i.test(f.name)),
   'служебные и неиграбельные файлы отброшены');

console.log('\narchive.pickAudio — запасные варианты');
eq(Archive.pickAudio([{ name: 'a.ogg', format: 'Ogg Vorbis' }]).length, 1, 'нет MP3 → берём ogg');
eq(Archive.pickAudio([{ name: 'a.m4a', format: 'M4A' }]).length, 1, 'нет MP3 и ogg → берём m4a');
eq(Archive.pickAudio([{ name: 'a.flac', format: 'Flac' }]).length, 0, 'только FLAC → пусто');
const order = Archive.pickAudio([
  { name: 'b.mp3', format: 'VBR MP3', source: 'derivative', track: '1/2' },
  { name: 'a.mp3', format: 'VBR MP3', source: 'original', track: '1/2' }
]);
eq(order[0].name, 'a.mp3', 'при равном номере оригинал раньше производного');
eq(Archive.pickAudio(new Array(200).fill(0).map((_, i) => ({ name: i + '.mp3', format: 'MP3' }))).length, 120,
   'список обрезан до 120 треков');

console.log('\narchive — сборка URL и метаданных');
const metaFixture = {
  files: realFiles,
  metadata: {
    identifier: 'badpanda018',
    title: 'Riding Alone for Thousands of Miles – Brick City Love Song [BadPanda018]',
    creator: 'Riding Alone For Thousands Of Miles',
    description: '<p>Some <b>html</b> description</p>',
    licenseurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/'
  }
};
let capturedUrl = null;
sandbox.fetch = (url) => { capturedUrl = url; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(metaFixture) }); };

Archive.item('badpanda018').then(album => {
  eq(album.identifier, 'badpanda018', 'identifier');
  eq(album.tracks.length, 5, 'треков в альбоме');
  eq(album.cover, 'https://archive.org/services/img/badpanda018', 'обложка');
  eq(album.tracks[0].streamUrl,
     'https://archive.org/download/badpanda018/01RidingAloneForThousandsOfMiles-Lullaby.mp3',
     'прямая ссылка на поток');
  eq(album.tracks[0].duration, 509.22, 'длительность из length');
  eq(album.tracks[0].title, 'lullaby', 'название очищено');
  eq(album.tracks[0].artist, 'Riding Alone for Thousands of Miles', 'артист из тега файла');
  eq(album.tracks[0].pageUrl, 'https://archive.org/details/badpanda018', 'страница источника');
  eq(album.description, 'Some html description', 'описание очищено от HTML');
  ok(/^https:\/\/archive\.org\/metadata\/badpanda018$/.test(capturedUrl), 'запрос к /metadata/', capturedUrl);

  /* ---------------------------------------------------------------- *
   * 3. Формирование поискового запроса archive.org
   * ---------------------------------------------------------------- */
  console.log('\narchive.search — параметры запроса');
  capturedUrl = null;
  sandbox.fetch = (url) => { capturedUrl = url; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ response: { docs: [] } }) }); };
  return Archive.search('ambient drone', 'netlabels').then(() => {
    const u = new URL(capturedUrl);
    ok(u.origin === 'https://archive.org' && u.pathname === '/advancedsearch.php', 'хост и путь', capturedUrl);
    const q = u.searchParams.get('q');
    ok(/mediatype:\(audio\)/.test(q), 'фильтр mediatype:(audio)', q);
    ok(/collection:netlabels/.test(q), 'подборка netlabels', q);
    ok(/\(ambient drone\)/.test(q), 'пользовательский запрос', q);
    eq(u.searchParams.getAll('fl[]').join(','), 'identifier,title,creator,downloads,year', 'повторяющиеся fl[]=');
    eq(u.searchParams.get('output'), 'json', 'output=json');
    eq(u.searchParams.get('rows'), '60', 'rows=60');
    eq(u.searchParams.get('sort[]'), 'downloads desc', 'сортировка по популярности');

    capturedUrl = null;
    return Archive.search('', null);
  }).then(() => {
    const q = new URL(capturedUrl).searchParams.get('q');
    ok(/collection:netlabels OR collection:etree OR collection:audio_music/.test(q),
       'без подборки — три музыкальные коллекции', q);
    ok(!/\(\s*\)/.test(q), 'без запроса нет пустых скобок', q);

    capturedUrl = null;
    return Archive.search('bad " quote \\', 'etree');
  }).then(() => {
    const q = new URL(capturedUrl).searchParams.get('q');
    ok(!/["\\]/.test(q.replace(/collection:|mediatype:|audio/g, '')), 'кавычки и бэкслеши вырезаны', q);

    /* ---------------------------------------------------------------- *
     * 4. Audius — нормализация реального объекта трека
     * ---------------------------------------------------------------- */
    console.log('\naudius.normalize (реальный объект из /v1/tracks/trending)');
    const realTrack = {
      track_id: 15450275,
      id: 'xkQaGx',
      title: 'iLLPeTiLL - Wonky/Deep/Body Buzz Bass Mix/Mashup',
      genre: 'Dubstep',
      duration: 417,
      play_count: 1548,
      favorite_count: 65,
      permalink: '/iLLPeTiLL/illpetill-wonkydeepbody-buzz-bass-mixmashup',
      is_streamable: true,
      artwork: {
        '150x150': 'https://audius-content-5.figment.io/content/baeaaaiqseb63nabs3/150x150.jpg',
        '480x480': 'https://audius-content-5.figment.io/content/baeaaaiqseb63nabs3/480x480.jpg',
        '1000x1000': 'https://audius-content-5.figment.io/content/baeaaaiqseb63nabs3/1000x1000.jpg'
      },
      stream: { url: 'https://audius.rickyrombo.com/tracks/cidstream/baeaaaiqsedwaxd24n5j2hern?signature=abc' },
      user: { id: 'O5lQz', handle: 'iLLPeTiLL', name: '@iLLPeTiLL' }
    };
    const t = Audius.normalize(realTrack);
    eq(t.id, 'audius:xkQaGx', 'уникальный id с префиксом источника');
    eq(t.remoteId, 'xkQaGx', 'remoteId для обновления ссылки');
    eq(t.source, 'audius', 'источник');
    eq(t.artist, '@iLLPeTiLL', 'артист из user.name');
    eq(t.album, 'Dubstep', 'в поле album — жанр');
    eq(t.duration, 417, 'длительность');
    eq(t.cover, 'https://audius-content-5.figment.io/content/baeaaaiqseb63nabs3/480x480.jpg', 'обложка 480 для списка');
    eq(t.coverBig, 'https://audius-content-5.figment.io/content/baeaaaiqseb63nabs3/1000x1000.jpg', 'большая обложка');
    eq(t.streamUrl, 'https://audius.rickyrombo.com/tracks/cidstream/baeaaaiqsedwaxd24n5j2hern?signature=abc', 'поток из ответа');
    eq(t.plays, 1548, 'прослушивания');
    eq(t.pageUrl, 'https://audius.co/iLLPeTiLL/illpetill-wonkydeepbody-buzz-bass-mixmashup', 'страница трека');
    eq(Audius.normalize(null), null, 'normalize(null) не падает');
    eq(Audius.normalize({ title: 'без id' }), null, 'normalize без id отбрасывается');
    eq(Audius.normalize({ id: 'z', user: { handle: 'h' } }).artist, 'h', 'нет name → берём handle');

    /* ---------------------------------------------------------------- *
     * 5. Audius — запросы (хост, жанр, app_name)
     * ---------------------------------------------------------------- */
    console.log('\naudius — построение запросов');
    const seen = [];
    sandbox.fetch = (url) => {
      seen.push(url);
      if (url === 'https://api.audius.co') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: ['https://api.audius.co'] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [realTrack] }) });
    };
    Audius._hostPromise = null; Audius.host = null;

    return Audius.trending('Electronic').then(list => {
      eq(list.length, 1, 'trending вернул трек');
      const discovery = seen[0], call = seen[1];
      eq(discovery, 'https://api.audius.co', 'сначала узнаём discovery-узел');
      const cu = new URL(call);
      eq(cu.pathname, '/v1/tracks/trending', 'путь trending');
      eq(cu.searchParams.get('genre'), 'Electronic', 'жанр передан');
      eq(cu.searchParams.get('limit'), '48', 'limit=48');
      ok(cu.searchParams.get('app_name').length > 0, 'app_name обязателен', cu.searchParams.get('app_name'));
    });
  }).then(() => {
    const seen2 = [];
    sandbox.fetch = (url) => {
      seen2.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [ { id: 'xkQaGx', title: 'T', user: { name: 'A' }, stream: { url: 'https://cdn/x.mp3' } } ] }) });
    };
    return Audius.search('lofi').then(() => {
      const su = new URL(seen2[0]);
      eq(su.pathname, '/v1/tracks/search', 'путь search');
      eq(su.searchParams.get('query'), 'lofi', 'поисковая строка');
      eq(su.searchParams.get('limit'), '60', 'limit=60');
    });
  }).then(() => {
    /* ---------------------------------------------------------------- *
     * 5b. Audius — обход узлов, отдающих 403
     * ---------------------------------------------------------------- */
    console.log('\naudius — обход узлов с 403');
    Audius._hostPromise = null; Audius.hosts = []; Audius._cursor = 0; Audius.host = null;
    const seenH = [];
    sandbox.fetch = (url) => {
      seenH.push(url);
      if (url === 'https://api.audius.co') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: ['https://bad-node.example', 'https://good-node.example'] }) });
      if (url.indexOf('https://bad-node.example') === 0) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 'g1', title: 'G', user: { name: 'A' }, stream: { url: 'http://x/g.mp3' } }] }) });
    };
    return Audius.search('q').then(list => {
      eq(list.length, 1, 'результат получен со второго узла');
      eq(Audius.host, 'https://good-node.example', 'рабочий узел запомнен');
      ok(seenH.some(u => u.indexOf('https://bad-node.example/v1/tracks/search') === 0), 'сначала опрошен плохой узел', seenH.join('\n'));
      ok(seenH.some(u => u.indexOf('https://good-node.example/v1/tracks/search') === 0), 'затем хороший');
      ok(Audius.hosts.indexOf('https://api.audius.co') !== -1, 'запасной узел всегда в списке');
    });
  }).then(() => {
    /* все узлы мертвы — понятная ошибка, а не тихий undefined */
    Audius._hostPromise = null; Audius.hosts = ['https://a.example', 'https://b.example']; Audius._cursor = 0;
    sandbox.fetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    return Audius.trending('').then(
      () => { ok(false, 'должен отклониться'); },
      e => ok(/503/.test(e.message), 'ошибка несёт последний статус', e.message)
    );
  }).then(() => {
    /* ---------------------------------------------------------------- *
     * 5c. Превью для платных (gated) треков
     * ---------------------------------------------------------------- */
    console.log('\naudius — превью для платных треков');
    const gated = Audius.normalize({ id: 'g', title: 'T', user: { name: 'A' }, stream: null, preview: { url: 'http://x/prev.mp3' }, duration: 30 });
    eq(gated.streamUrl, 'http://x/prev.mp3', 'берётся превью-ссылка');
    eq(gated.isPreview, true, 'флаг превью');
    const free = Audius.normalize({ id: 'f', title: 'T', user: { name: 'A' }, stream: { url: 'http://x/full.mp3' }, preview: { url: 'http://x/prev.mp3' } });
    eq(free.streamUrl, 'http://x/full.mp3', 'полный поток предпочитается превью');
    eq(free.isPreview, false, 'без флага превью');
    const dead = Audius.normalize({ id: 'd', title: 'T', user: { name: 'A' } });
    eq(dead.streamUrl, null, 'нет ни потока ни превью — null');
  }).then(() => {
    /* refresh: stream уже есть в /v1/tracks/{id} */
    const seen3 = [];
    sandbox.fetch = (url) => {
      seen3.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { id: 'abc', title: 'T', user: { name: 'A' }, stream: { url: 'https://cdn/fresh.mp3' } } }) });
    };
    return Audius.refresh('abc').then(t => {
      eq(t.streamUrl, 'https://cdn/fresh.mp3', 'refresh берёт свежую ссылку');
      ok(seen3.some(u => u.includes('/v1/tracks/abc')), 'запрошен /v1/tracks/abc', seen3.join(' '));
    });
  }).then(() => {
    /* refresh: потока в карточке нет → отдельный запрос /stream */
    const seen4 = [];
    sandbox.fetch = (url) => {
      seen4.push(url);
      if (url.includes('/stream?')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { url: 'https://cdn/streamed.mp3' } }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { id: 'abc', title: 'T', user: { name: 'A' } } }) });
    };
    return Audius.refresh('abc').then(t => {
      eq(t.streamUrl, 'https://cdn/streamed.mp3', 'запасной путь /v1/tracks/{id}/stream');
      ok(seen4.some(u => u.includes('/v1/tracks/abc/stream')), 'запрошен /stream', seen4.join(' '));
    });
  }).then(() => {
    /* таймаут и HTTP-ошибки превращаются в понятные сообщения */
    console.log('\nисточники — обработка сбоев');
    sandbox.fetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    return Audius.search('x').then(
      () => { ok(false, 'HTTP 503 должен отклоняться'); },
      e => ok(/503/.test(e.message), 'HTTP 503 → ошибка с кодом', e.message)
    );
  }).then(() => {
    // сервер висит: проверяем, что AbortController реально рвёт запрос
    sandbox.fetch = (url, opts) => new Promise((resolve, reject) => {
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
      });
    });
    const t0 = Date.now();
    return sandbox.Sources.getJSON('https://example.com', 300).then(
      () => { ok(false, 'зависший запрос должен прерываться'); },
      e => ok(/вовремя|abort/i.test(e.message) && Date.now() - t0 < 2000,
              'таймаут обрывает запрос: ' + e.message, e.message)
    );
  }).then(() => {
    console.log('\n' + (failed ? '\x1b[31m' : '\x1b[32m') + passed + ' пройдено, ' + failed + ' провалено\x1b[0m');
    process.exit(failed ? 1 : 0);
  });
}).catch(e => { console.error('\n\x1b[31mТест упал:\x1b[0m', e); process.exit(1); });
