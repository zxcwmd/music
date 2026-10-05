/* Aurora · интерфейс. Никаких фреймворков и сборщиков — только DOM. */
(function (global) {
  'use strict';

  var U = global.U, P = global.Player, S = global.Sources;
  var $ = U.$;

  var sleepSteps = [0, 15, 30, 60];
  var sleepIndex = 0;

  var state = {
    view: 'home',
    genre: '',
    query: '',
    archQuery: '',
    archShelf: 'netlabels',
    album: null,
    cache: {},          // «trending:Genre» -> треки, чтобы не дёргать сеть повторно
    npOpen: false,
    drawerOpen: false,
    lastSecond: -1
  };

  /* ================================================================== *
   * Тема по обложке
   * ================================================================== */
  function hueShift(r, g, b, deg) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    h = (h + deg / 360) % 1; if (h < 0) h += 1;
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var rr, gg, bb;
    if (s === 0) { rr = gg = bb = l; }
    else {
      var q2 = l < 0.5 ? l * (1 + s) : l + s - l * s, p2 = 2 * l - q2;
      rr = f(p2, q2, h + 1 / 3); gg = f(p2, q2, h); bb = f(p2, q2, h - 1 / 3);
    }
    return [Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255)];
  }

  function applyAccent(r, g, b) {
    var v = U.vivid(r, g, b);
    var c2 = hueShift(v[0], v[1], v[2], 46);
    var root = document.documentElement.style;
    root.setProperty('--accent', 'rgb(' + v.join(',') + ')');
    root.setProperty('--accent-2', 'rgb(' + c2.join(',') + ')');
    root.setProperty('--accent-rgb', v.join(','));
  }
  function resetAccent() {
    var root = document.documentElement.style;
    root.setProperty('--accent', '#7c5cff');
    root.setProperty('--accent-2', '#22d3ee');
    root.setProperty('--accent-rgb', '124,92,255');
  }

  /* ================================================================== *
   * Мелкие куски разметки
   * ================================================================== */
  function coverHTML(t, cls) {
    var src = t.cover || t.coverBig || '';
    return '<span class="cover ' + (cls || 'cover--md') + '">' +
      (src ? '<img src="' + U.esc(src) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-ready\')" onerror="this.remove()">' : '') +
      '<span class="cover__fallback"><svg><use href="#i-note"/></svg></span></span>';
  }

  function trackRow(t, i, listKey) {
    var isCur = P.current() && P.current().id === t.id;
    return '' +
      '<div class="track' + (isCur ? ' is-current' : '') + '" style="--i:' + Math.min(i, 26) + '" data-id="' + U.esc(t.id) + '" data-list="' + listKey + '" data-i="' + i + '">' +
        '<div class="track__idx"><span class="num">' + (isCur
            ? '<span class="eq' + (P.audio.paused ? ' is-paused' : '') + '"><i></i><i></i><i></i></span>'
            : (i + 1)) + '</span>' +
          '<span class="go" data-act="play"><svg><use href="#i-play"/></svg></span></div>' +
        coverHTML(t, 'cover--md') +
        '<div class="track__main">' +
          '<div class="track__title">' + (t.source === 'archive' ? '<span class="track__badge">IA</span>' : '') +
            (t.isPreview ? '<span class="track__badge track__badge--prev" title="Платный трек — играет бесплатный превью-фрагмент">превью</span>' : '') + U.esc(t.title) + '</div>' +
          '<div class="track__sub">' + U.esc(t.artist) + (t.album && t.album !== t.artist ? ' · ' + U.esc(t.album) : '') + '</div>' +
        '</div>' +
        '<div class="track__dur">' + (t.duration ? U.fmt(t.duration) : '—') + '</div>' +
        '<div class="track__acts">' +
          '<button class="iconbtn' + (P.isFavorite(t) ? ' is-fav' : '') + '" data-act="fav" title="В избранное"><svg><use href="#i-heart"/></svg></button>' +
          '<button class="iconbtn" data-act="enqueue" title="В очередь"><svg><use href="#i-plus"/></svg></button>' +
        '</div>' +
      '</div>';
  }

  function trackList(tracks, listKey) {
    if (!tracks.length) return '';
    return '<div class="tracks" data-listkey="' + listKey + '">' +
      tracks.map(function (t, i) { return trackRow(t, i, listKey); }).join('') + '</div>';
  }

  function skeleton(n) {
    var out = '<div class="skel">';
    for (var i = 0; i < n; i++) out += '<div class="skel__row"></div>';
    return out + '</div>';
  }

  function empty(icon, title, text) {
    return '<div class="empty"><div class="empty__ico"><svg><use href="#' + icon + '"/></svg></div>' +
      '<h3>' + U.esc(title) + '</h3><p>' + U.esc(text) + '</p></div>';
  }

  function chipBar(items, active, group) {
    return '<div class="chips">' + items.map(function (c) {
      return '<button class="chip' + (c.id === active ? ' is-active' : '') + '" data-chip="' + group + '" data-val="' + U.esc(c.id) + '">' + U.esc(c.label) + '</button>';
    }).join('') + '</div>';
  }

  function setStatus(kind, text) {
    var el = $('#statusPill');
    el.dataset.state = kind;
    el.textContent = text;
  }

  /* ================================================================== *
   * Роутер
   * ================================================================== */
  function go(view, opts) {
    opts = opts || {};
    state.view = view;
    U.$$('.nav__item').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.view === view);
    });
    if (view !== 'search') { $('#searchInput').value = ''; state.query = ''; }
    render(opts);
    var v = $('#view');
    v.scrollTop = 0;
    v.classList.remove('swap');
    void v.offsetWidth;
    v.classList.add('swap');
  }

  function render(opts) {
    var v = $('#view');
    switch (state.view) {
      case 'home': return renderHome(v);
      case 'search': return renderSearch(v);
      case 'archive': return renderArchive(v);
      case 'album': return renderAlbum(v, opts.identifier);
      case 'soundcloud': return renderSoundcloud(v);
      case 'favorites': return renderFavorites(v);
      case 'history': return renderHistory(v);
    }
  }

  /* ---------------- SoundCloud (официальный виджет) ---------------- */
  function scValid(url) {
    return /^https?:\/\/(on\.|w\.|m\.)?(soundcloud\.com|sndcd\.co|sndcdn\.com)\/\S+/i.test(String(url || '').trim());
  }

  function renderSoundcloud(root) {
    var recent = U.store.get('soundcloud', []);
    root.innerHTML =
      '<div class="section-head"><div><h2>SoundCloud</h2><p>Официальный embed-виджет: вставьте ссылку — трек заиграет</p></div></div>' +
      '<div class="sc">' +
        '<div class="sc__note"><svg><use href="#i-moon"/></svg><span>В России SoundCloud заблокирован Роскомнадзором с 02.10.2022, поэтому без VPN виджет здесь не откроется. ' +
          'Это сетевая блокировка — приложение не может её обойти. В РФ без VPN работают «В тренде», «Поиск» (Audius) и «Internet Archive».</span></div>' +
        '<div class="sc__form">' +
          '<input class="sc__input" id="scInput" type="url" placeholder="https://soundcloud.com/artist/track" autocomplete="off" spellcheck="false">' +
          '<button class="btn btn--primary" data-act="sc-play"><svg><use href="#i-play"/></svg>Играть</button>' +
        '</div>' +
        '<div id="scPlayer"></div>' +
        (recent.length ? '<div><div class="section-head" style="margin:4px 0 8px"><p style="margin:0">Недавние</p></div>' +
          '<div class="sc__recent">' + recent.map(function (r) {
            return '<button class="chip" data-scurl="' + U.esc(r.url) + '">' + U.esc(r.title || r.url) + '</button>';
          }).join('') + '</div></div>' : '') +
      '</div>';
  }

  function playSoundcloud(url) {
    url = String(url || '').trim();
    if (!scValid(url)) { U.toast('Это не похоже на ссылку SoundCloud', { error: true }); return; }
    var visual = /\/sets\//.test(url);   // плейлист — высокий виджет
    var src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) +
      '&color=%237c5cff&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=' + (visual ? 'true' : 'false');
    $('#scPlayer').innerHTML =
      '<iframe class="sc__frame' + (visual ? ' sc__frame--visual' : '') + '" id="scFrame" loading="lazy" ' +
      'title="SoundCloud player" allow="autoplay" src="' + U.esc(src) + '"></iframe><div class="sc__meta" id="scMeta"></div>';

    var rec = U.store.get('soundcloud', []).filter(function (r) { return r.url !== url; });
    rec.unshift({ url: url, title: '' });
    U.store.set('soundcloud', rec.slice(0, 6));

    S.getJSON('https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(url), 12000)
      .then(function (j) {
        var meta = $('#scMeta');
        if (!meta || !j) return;
        rec[0].title = j.title || url;
        U.store.set('soundcloud', rec.slice(0, 6));
        meta.innerHTML =
          (j.thumbnail_url ? '<img src="' + U.esc(j.thumbnail_url) + '" alt="" onerror="this.remove()">' : '') +
          '<div><div class="t">' + U.esc(j.title || 'SoundCloud') + '</div><div class="a">' + U.esc(j.author_name || '') + '</div></div>';
      })
      .catch(function () { /* виджет уже играет — метаданные не критичны */ });
  }

  /* ---------------- В тренде ---------------- */
  function renderHome(root) {
    var label = (S.Audius.genres.find(function (g) { return g.id === state.genre; }) || {}).label || 'Всё';
    root.innerHTML =
      '<section class="hero">' +
        '<span class="hero__kicker">Audius · без рекламы и ключей</span>' +
        '<h1>Что сейчас слушают</h1>' +
        '<p>Полные треки напрямую от исполнителей. Поток идёт без вставок, трекеров и баннеров.</p>' +
        '<div class="hero__actions"><button class="btn btn--primary" id="heroPlay"><svg><use href="#i-play"/></svg>Слушать подборку</button>' +
        '<button class="btn btn--ghost" data-nav="archive"><svg><use href="#i-archive"/></svg>Альбомы Internet Archive</button></div>' +
      '</section>' +
      '<div class="section-head"><div><h2>В тренде</h2><p>Жанр: ' + U.esc(label) + '</p></div></div>' +
      chipBar(S.Audius.genres, state.genre, 'genre') +
      '<div id="homeBody">' + skeleton(8) + '</div>';

    setStatus('loading', 'загружаем…');
    var key = 'trending:' + state.genre;
    var done = function (tracks) {
      state.cache[key] = tracks;
      var body = $('#homeBody');
      if (!body) return;                 // пользователь уже ушёл на другой вид
      body.innerHTML = tracks.length
        ? trackList(tracks, key)
        : empty('i-search', 'Пусто', 'В этом жанре сейчас нет доступных треков — попробуйте другой.');
      setStatus('idle', tracks.length + ' треков');
    };
    if (state.cache[key]) return done(state.cache[key]);

    S.Audius.trending(state.genre).then(done).catch(function (e) {
      var body = $('#homeBody');
      if (body) body.innerHTML = empty('i-close', 'Не удалось загрузить', e.message + '. Проверьте соединение и обновите страницу.');
      setStatus('error', 'ошибка');
    });
  }

  /* ---------------- Поиск ---------------- */
  function renderSearch(root) {
    var q = state.query.trim();
    root.innerHTML =
      '<div class="section-head"><div><h2>Поиск</h2><p>Треки и исполнители на Audius</p></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn--sm" data-nav="archive"><svg><use href="#i-archive"/></svg>Искать альбомы</button></div>' +
      '<div id="searchBody">' +
        (q ? skeleton(8) : empty('i-search', 'Начните печатать', 'Например: lofi, techno, ambient piano — и нажмите Enter.')) +
      '</div>';
    if (!q) { setStatus('idle', 'готов'); return; }

    setStatus('loading', 'ищем…');
    S.Audius.search(q).then(function (tracks) {
      var key = 'search:' + q;
      state.cache[key] = tracks;
      var body = $('#searchBody');
      if (!body) return;                 // запрос вернулся, а вид уже сменился
      body.innerHTML = tracks.length
        ? '<p style="color:var(--muted-2);font-size:12.5px;margin:0 0 10px">Найдено: ' + tracks.length + '</p>' + trackList(tracks, key)
        : empty('i-search', 'Ничего не нашлось', 'Попробуйте другой запрос или поищите альбомы в Internet Archive.');
      setStatus('idle', tracks.length + ' треков');
    }).catch(function (e) {
      var body = $('#searchBody');
      if (body) body.innerHTML = empty('i-close', 'Ошибка поиска', e.message);
      setStatus('error', 'ошибка');
    });
  }

  /* ---------------- Internet Archive ---------------- */
  function renderArchive(root) {
    root.innerHTML =
      '<div class="section-head"><div><h2>Internet Archive</h2><p>Нетлейблы, живые концерты и CC-альбомы — целиком, бесплатно</p></div></div>' +
      chipBar(S.Archive.shelves.map(function (s) { return { id: s.id, label: s.label }; }), state.archShelf, 'shelf') +
      '<div id="archBody">' + skeleton(6) + '</div>';
    loadArchive();
  }

  function loadArchive() {
    setStatus('loading', 'ищем альбомы…');
    S.Archive.search(state.archQuery, state.archShelf).then(function (albums) {
      var body = $('#archBody');
      if (!body) return;
      if (!albums.length) {
        body.innerHTML = empty('i-archive', 'Ничего не найдено', 'Попробуйте другую подборку или другой запрос.');
        setStatus('idle', 'готов');
        return;
      }
      body.innerHTML = '<div class="grid">' + albums.map(function (a, i) {
        return '<button class="card" style="--i:' + Math.min(i, 24) + '" data-album="' + U.esc(a.identifier) + '">' +
          '<span class="card__art">' +
            '<img src="' + U.esc(a.cover) + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0">' +
            '<span class="card__play"><svg><use href="#i-play"/></svg></span>' +
          '</span>' +
          '<span class="card__title">' + U.esc(a.title) + '</span>' +
          '<span class="card__sub">' + U.esc(a.artist) + (a.year ? ' · ' + U.esc(a.year) : '') + '</span>' +
        '</button>';
      }).join('') + '</div>';
      setStatus('idle', albums.length + ' альбомов');
    }).catch(function (e) {
      var body = $('#archBody');
      if (body) body.innerHTML = empty('i-close', 'Archive.org недоступен', e.message);
      setStatus('error', 'ошибка');
    });
  }

  /* ---------------- Альбом ---------------- */
  function renderAlbum(root, identifier) {
    root.innerHTML =
      '<div class="section-head"><button class="btn btn--sm btn--ghost" data-nav="archive"><svg><use href="#i-back"/></svg>Назад</button></div>' +
      '<div id="albumBody">' + skeleton(8) + '</div>';
    setStatus('loading', 'открываем альбом…');

    S.Archive.item(identifier).then(function (album) {
      state.album = album;
      var key = 'album:' + identifier;
      state.cache[key] = album.tracks;
      var body = $('#albumBody');
      if (!body) return;                 // альбом закрыли, пока грузились метаданные
      if (!album.tracks.length) {
        body.innerHTML = empty('i-note', 'Нет воспроизводимых файлов',
          'В этом предмете лежат только FLAC/SHN — браузер их не умеет. Выберите другой альбом.');
        setStatus('idle', 'готов');
        return;
      }
      body.innerHTML =
        '<section class="hero" style="align-items:flex-start">' +
          '<div style="display:flex;gap:22px;align-items:center;width:100%;flex-wrap:wrap">' +
            '<img src="' + U.esc(album.cover) + '" alt="" style="width:150px;height:150px;border-radius:16px;object-fit:cover;box-shadow:0 24px 60px -20px rgba(0,0,0,.9)" onerror="this.style.display=\'none\'">' +
            '<div style="min-width:0;flex:1">' +
              '<span class="hero__kicker">Internet Archive</span>' +
              '<h1 style="font-size:clamp(22px,3vw,34px)">' + U.esc(album.title) + '</h1>' +
              '<p>' + U.esc(album.artist) + ' · ' + album.tracks.length + ' трек(ов)</p>' +
              (album.description ? '<p style="margin-top:10px;max-width:70ch">' + U.esc(album.description) + '</p>' : '') +
              '<div class="hero__actions">' +
                '<button class="btn btn--primary" data-act="play-all" data-list="' + key + '"><svg><use href="#i-play"/></svg>Слушать всё</button>' +
                '<button class="btn" data-act="shuffle-all" data-list="' + key + '"><svg><use href="#i-shuffle"/></svg>Перемешать</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<div class="section-head"><div><h2>Треки</h2></div></div>' +
        trackList(album.tracks, key);
      setStatus('idle', album.tracks.length + ' треков');
    }).catch(function (e) {
      var body = $('#albumBody');
      if (body) body.innerHTML = empty('i-close', 'Не удалось открыть', e.message);
      setStatus('error', 'ошибка');
    });
  }

  /* ---------------- Избранное / история ---------------- */
  function renderFavorites(root) {
    var favs = P.favorites();
    state.cache['fav'] = favs;
    root.innerHTML =
      '<div class="section-head"><div><h2>Избранное</h2><p>' + favs.length + ' трек(ов) · хранится только в этом браузере</p></div>' +
      (favs.length ? '<div class="spacer"></div><button class="btn btn--sm" data-act="play-all" data-list="fav"><svg><use href="#i-play"/></svg>Слушать всё</button>' : '') +
      '</div>' +
      (favs.length ? trackList(favs, 'fav') : empty('i-heart', 'Пока пусто', 'Нажмите на сердечко у трека — он появится здесь.'));
    setStatus('idle', favs.length + ' треков');
  }

  function renderHistory(root) {
    var h = P.history();
    state.cache['hist'] = h;
    root.innerHTML =
      '<div class="section-head"><div><h2>История</h2><p>Последние ' + h.length + ' прослушанных</p></div></div>' +
      (h.length ? trackList(h, 'hist') : empty('i-clock', 'История пуста', 'Включите что-нибудь — и треки появятся здесь.'));
    setStatus('idle', 'готов');
  }

  /* ================================================================== *
   * Очередь
   * ================================================================== */
  function maybeQueue() { if (state.drawerOpen) renderQueue(); }

  function renderQueue() {
    var list = P.queue;
    $('#queueCount').textContent = list.length + ' ' + plural(list.length, 'трек', 'трека', 'треков');
    var cur = P.current();
    $('#queueList').innerHTML = list.length ? list.map(function (t, i) {
      return '<div class="qrow' + (cur && cur.id === t.id ? ' is-current' : '') + '" data-qi="' + i + '">' +
        coverHTML(t, 'cover--sm') +
        '<div style="min-width:0"><div class="qrow__t">' + U.esc(t.title) + '</div><div class="qrow__a">' + U.esc(t.artist) + '</div></div>' +
        '<button class="iconbtn" data-qdel="' + i + '" title="Убрать"><svg><use href="#i-close"/></svg></button>' +
      '</div>';
    }).join('') : '<div class="empty" style="padding:40px 10px"><p>Очередь пуста</p></div>';
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function toggleDrawer(force) {
    var open = force != null ? force : !state.drawerOpen;
    state.drawerOpen = open;
    $('#drawer').classList.toggle('is-open', open);
    $('#drawer').setAttribute('aria-hidden', String(!open));
    $('#btnQueue').classList.toggle('is-on', open);
    if (open) renderQueue();
  }

  /* ================================================================== *
   * Now Playing
   * ================================================================== */
  function toggleNP(force) {
    var open = force != null ? force : !state.npOpen;
    state.npOpen = open;
    P.Viz.ringOpen = open;
    $('#np').classList.toggle('is-open', open);
    $('#np').setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      requestAnimationFrame(function () { P.Viz.resize(); if (!P.audio.paused) P.Viz.start(); });
    }
  }

  function paintNowPlaying(t) {
    if (!t) {
      $('#npTitle').textContent = 'Ничего не играет';
      $('#npArtist').textContent = 'выберите трек из списка';
      return;
    }
    $('#npTitle').textContent = t.title;
    $('#npArtist').textContent = t.artist;
    var img = $('#coverImg');
    if (t.cover) { img.src = t.cover; img.style.display = ''; } else { img.removeAttribute('src'); img.style.display = 'none'; }
    var big = $('#npImg');
    if (t.coverBig || t.cover) big.src = t.coverBig || t.cover; else big.removeAttribute('src');
    $('#npBg').style.backgroundImage = (t.coverBig || t.cover) ? 'url("' + (t.coverBig || t.cover) + '")' : '';
    $('#npBigTitle').textContent = t.title;
    $('#npBigArtist').textContent = t.artist;
    $('#npSource').textContent = t.source === 'archive' ? 'Internet Archive' : 'Audius';
    $('#npLink').href = t.pageUrl || '#';

    var stats = [];
    if (t.duration) stats.push(U.fmt(t.duration));
    if (t.plays) stats.push(U.compact(t.plays) + ' прослушиваний');
    if (t.likes) stats.push(U.compact(t.likes) + ' ♥');
    if (t.genre) stats.push(t.genre);
    if (t.format) stats.push(t.format);
    $('#npStats').innerHTML = stats.map(function (s) { return '<span>' + U.esc(s) + '</span>'; }).join('');

    var fav = P.isFavorite(t);
    $('#btnFav').classList.toggle('is-fav', fav);
    $('#btnFav').innerHTML = '<svg><use href="#' + (fav ? 'i-heart-fill' : 'i-heart') + '"/></svg>';

    if (t.cover || t.coverBig) U.themeFromImage(t.cover || t.coverBig, applyAccent);
    else resetAccent();
  }

  /* ================================================================== *
   * Прогресс (rAF, только во время воспроизведения)
   * ================================================================== */
  var rafId = 0;
  var barW = 0;
  function measureBar() { barW = $('#seekBar').clientWidth || 1; }

  function progressLoop() {
    var a = P.audio;
    var d = a.duration;
    if (isFinite(d) && d > 0) {
      var ratio = U.clamp(a.currentTime / d, 0, 1);
      $('#fillBar').style.transform = 'scaleX(' + ratio + ')';
      $('#knob').style.transform = 'translateX(' + Math.round(ratio * barW) + 'px)';
      var sec = Math.floor(a.currentTime);
      if (sec !== state.lastSecond) {
        state.lastSecond = sec;
        $('#tCur').textContent = U.fmt(sec);
        $('#seekBar').setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      }
    }
    rafId = requestAnimationFrame(progressLoop);
  }
  function startProgress() {
    measureBar();
    if (!rafId) rafId = requestAnimationFrame(progressLoop);
  }
  function stopProgress() { cancelAnimationFrame(rafId); rafId = 0; }

  /* ================================================================== *
   * События
   * ================================================================== */
  /** Стоит ли уже этот список в очереди — чтобы не сбрасывать добавленное вручную */
  function sameQueue(list) {
    var q = P.queue;
    if (q.length !== list.length) return false;
    for (var i = 0; i < q.length; i++) if (q[i].id !== list[i].id) return false;
    return true;
  }

  function playFromList(listKey, i, replace) {
    var list = state.cache[listKey];
    if (!list || !list.length) return;
    var track = list[i];
    if (!track) return;
    // у Audius-треков из избранного/истории ссылки нет — она подтянется сама
    if (replace === false) { P.appendQueue([track]); maybeQueue(); U.toast('Добавлено в очередь'); return; }
    P.retries = 0;
    if (!sameQueue(list)) P.setQueue(list, i);
    P.playAt(i).then(refreshRows);
    maybeQueue();
  }

  function refreshRows() {
    U.$$('#view .track').forEach(function (row) {
      var cur = P.current();
      var isCur = cur && row.dataset.id === cur.id;
      row.classList.toggle('is-current', isCur);
      var num = row.querySelector('.track__idx .num');
      if (!num) return;
      if (isCur) num.innerHTML = '<span class="eq"><i></i><i></i><i></i></span>';
      else if (!/^\d+$/.test(num.textContent.trim())) num.textContent = row.dataset.i === undefined ? '·' : (Number(row.dataset.i) + 1);
    });
    maybeQueue();
  }

  function wireEvents() {
    /* --- навигация --- */
    U.$$('.nav__item').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.view === 'archive') { go('archive'); }
        else go(b.dataset.view);
      });
    });

    /* --- поиск --- */
    var input = $('#searchInput');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        state.query = input.value;
        go('search');
        input.blur();
      }
    });
    var live = U.debounce(function () {
      if (input.value.trim().length >= 2 || state.view === 'search') {
        state.query = input.value;
        go('search');
      }
    }, 620);
    input.addEventListener('input', live);

    /* --- клики внутри вида (делегирование) --- */
    $('#view').addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (nav) { go(nav.dataset.nav); return; }

      var scr = e.target.closest('[data-scurl]');
      if (scr) {
        var inp = $('#scInput');
        if (inp) inp.value = scr.dataset.scurl;
        playSoundcloud(scr.dataset.scurl);
        return;
      }

      var chip = e.target.closest('[data-chip]');
      if (chip) {
        if (chip.dataset.chip === 'genre') {
          state.genre = chip.dataset.val;
          U.$$('#view [data-chip="genre"]').forEach(function (c) { c.classList.toggle('is-active', c === chip); });
          renderHome($('#view'));
        } else if (chip.dataset.chip === 'shelf') {
          state.archShelf = chip.dataset.val;
          U.$$('#view [data-chip="shelf"]').forEach(function (c) { c.classList.toggle('is-active', c === chip); });
          loadArchive();
        }
        return;
      }

      var album = e.target.closest('[data-album]');
      if (album) { go('album', { identifier: album.dataset.album }); return; }

      if (e.target.closest('#heroPlay')) {
        var key = 'trending:' + state.genre;
        var list = state.cache[key];
        if (list && list.length) { P.setQueue(list, 0); P.playAt(0).then(refreshRows); maybeQueue(); }
        return;
      }

      var act = e.target.closest('[data-act]');
      if (act) {
        var name = act.dataset.act;
        var listKey = act.dataset.list;

        if (name === 'sc-play') {
          playSoundcloud($('#scInput') ? $('#scInput').value : '');
          return;
        }

        if (name === 'play-all' || name === 'shuffle-all') {
          var tracks = state.cache[listKey];
          if (!tracks || !tracks.length) return;
          var order = tracks.slice();
          if (name === 'shuffle-all') {
            for (var j = order.length - 1; j > 0; j--) {
              var k = Math.floor(Math.random() * (j + 1));
              var tmp = order[j]; order[j] = order[k]; order[k] = tmp;
            }
            state.cache[listKey + ':shuf'] = order;
            listKey = listKey + ':shuf';
          }
          P.setQueue(state.cache[listKey], 0);
          P.playAt(0).then(refreshRows);
          maybeQueue();
          return;
        }

        var row = act.closest('.track');
        if (!row) return;
        var rk = row.dataset.list, ri = Number(row.dataset.i);

        if (name === 'play' || name === 'enqueue' || name === 'fav') {
          e.stopPropagation();
        }
        if (name === 'fav') {
          var tr = (state.cache[rk] || [])[ri];
          var on = P.toggleFavorite(tr);
          act.classList.toggle('is-fav', on);
          act.innerHTML = '<svg><use href="#' + (on ? 'i-heart-fill' : 'i-heart') + '"/></svg>';
          var cur = P.current();
          if (cur && tr && cur.id === tr.id) {
            $('#btnFav').classList.toggle('is-fav', on);
            $('#btnFav').innerHTML = '<svg><use href="#' + (on ? 'i-heart-fill' : 'i-heart') + '"/></svg>';
          }
          U.toast(on ? 'Добавлено в избранное' : 'Убрано из избранного');
          return;
        }
        if (name === 'enqueue') { playFromList(rk, ri, false); return; }
        if (name === 'play') { playFromList(rk, ri); return; }
        return;
      }

      var trow = e.target.closest('.track');
      if (trow) playFromList(trow.dataset.list, Number(trow.dataset.i));
    });

    /* --- SoundCloud: Enter в поле ссылки --- */
    $('#view').addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'scInput' && e.key === 'Enter') {
        e.preventDefault();
        playSoundcloud(e.target.value);
      }
    });

    /* --- очередь --- */
    $('#btnQueue').addEventListener('click', function () { toggleDrawer(); });
    $('#btnCloseDrawer').addEventListener('click', function () { toggleDrawer(false); });
    $('#btnClearQueue').addEventListener('click', function () {
      P.clearQueue(); paintNowPlaying(null); resetAccent();
      $('#fillBar').style.transform = 'scaleX(0)';
      U.toast('Очередь очищена');
    });
    $('#queueList').addEventListener('click', function (e) {
      var del = e.target.closest('[data-qdel]');
      if (del) { P.removeFromQueue(Number(del.dataset.qdel)); renderQueue(); return; }
      var row = e.target.closest('[data-qi]');
      if (row) { P.playAt(Number(row.dataset.qi)).then(refreshRows); }
    });

    /* --- плеер --- */
    $('#btnPlay').addEventListener('click', function () { P.toggle(); });
    $('#btnNext').addEventListener('click', function () { P.next(false).then(refreshRows); });
    $('#btnPrev').addEventListener('click', function () { P.prev().then(refreshRows); });
    $('#btnShuffle').addEventListener('click', function () {
      var on = P.toggleShuffle();
      this.classList.toggle('is-on', on);
      U.toast(on ? 'Перемешивание включено' : 'Перемешивание выключено');
    });
    $('#btnRepeat').addEventListener('click', function () {
      var r = P.cycleRepeat();
      this.classList.toggle('is-on', r > 0);
      this.innerHTML = '<svg><use href="#' + (r === 2 ? 'i-repeat1' : 'i-repeat') + '"/></svg>';
      U.toast(['Повтор выключен', 'Повтор очереди', 'Повтор трека'][r]);
    });
    $('#btnFav').addEventListener('click', function () {
      var t = P.current();
      if (!t) return U.toast('Сначала включите трек');
      var on = P.toggleFavorite(t);
      this.classList.toggle('is-fav', on);
      this.innerHTML = '<svg><use href="#' + (on ? 'i-heart-fill' : 'i-heart') + '"/></svg>';
      U.toast(on ? 'Добавлено в избранное' : 'Убрано из избранного');
      if (state.view === 'favorites') renderFavorites($('#view'));
    });
    $('#coverBtn').addEventListener('click', function () { toggleNP(); });

    /* --- перемотка --- */
    var bar = $('#seekBar'), dragging = false;
    function ratioFrom(ev) {
      var r = bar.getBoundingClientRect();
      return U.clamp((ev.clientX - r.left) / r.width, 0, 1);
    }
    function showTip(ev) {
      var r = bar.getBoundingClientRect();
      var ratio = ratioFrom(ev);
      var tip = $('#seekTip');
      tip.style.left = (ratio * r.width) + 'px';
      var d = P.audio.duration;
      tip.textContent = isFinite(d) && d ? U.fmt(ratio * d) : '--:--';
      $('#fillBar').style.transform = 'scaleX(' + ratio + ')';
      $('#knob').style.transform = 'translateX(' + Math.round(ratio * r.width) + 'px)';
    }
    bar.addEventListener('pointerdown', function (e) {
      dragging = true; bar.setPointerCapture(e.pointerId); showTip(e);
    });
    bar.addEventListener('pointermove', function (e) { if (dragging) showTip(e); });
    bar.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      P.seek(ratioFrom(e));
    });
    bar.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { P.nudge(5); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { P.nudge(-5); e.preventDefault(); }
    });

    /* --- громкость --- */
    var vol = $('#volRange');
    function paintVol(v) { vol.style.setProperty('--p', Math.round(v * 100) + '%'); }
    vol.addEventListener('input', function () {
      var v = Number(vol.value) / 100;
      P.setVolume(v);
      paintVol(v);
      $('#player').querySelector('.vol').classList.toggle('is-muted', v === 0);
    });

    $('#btnMute').addEventListener('click', function () {
      P.toggleMute();
      $('#player').querySelector('.vol').classList.toggle('is-muted', P.muted || P.volume === 0);
    });

    /* --- now playing --- */
    $('#npClose').addEventListener('click', function () { toggleNP(false); });
    $('#np').addEventListener('click', function (e) { if (e.target === $('#np') || e.target === $('#npBg')) toggleNP(false); });

    /* --- модалка клавиш --- */
    $('#btnKeys').addEventListener('click', function () { $('#keysModal').classList.add('is-open'); });
    $('#keysClose').addEventListener('click', function () { $('#keysModal').classList.remove('is-open'); });
    $('#keysModal').addEventListener('click', function (e) { if (e.target === $('#keysModal')) $('#keysModal').classList.remove('is-open'); });

    /* --- эконом-режим --- */
    $('#btnPerf').addEventListener('click', function () {
      var on = !document.body.classList.contains('perf');
      document.body.classList.toggle('perf', on);
      this.classList.toggle('is-on', on);
      $('#perfLabel').textContent = on ? 'вкл' : 'выкл';
      U.store.set('perf', on);
      if (on) { P.Viz.stop(); if (P.ctx) { try { P.ctx.close(); } catch (e) {} P.ctx = null; P.analyser = null; } }
      else if (!P.audio.paused) P.Viz.start();
      U.toast(on ? 'Эконом-режим: эффекты выключены' : 'Эффекты снова включены');
    });

    /* --- таймер сна --- */
    sleepIndex = 0;
    $('#btnSleep').addEventListener('click', function () {
      sleepIndex = (sleepIndex + 1) % sleepSteps.length;
      var m = sleepSteps[sleepIndex];
      P.setSleep(m);
      $('#sleepLabel').textContent = m ? m + ' мин' : 'выкл';
      this.classList.toggle('is-on', m > 0);
      U.toast(m ? 'Остановить через ' + m + ' мин' : 'Таймер сна выключен');
    });

    /* --- клавиатура --- */
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      if (e.key === 'Escape') {
        if (state.npOpen) toggleNP(false);
        else if ($('#keysModal').classList.contains('is-open')) $('#keysModal').classList.remove('is-open');
        else if (state.drawerOpen) toggleDrawer(false);
        return;
      }
      if (typing) {
        if (e.key === 'Escape') { e.target.blur(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); P.toggle(); break;
        case 'ArrowRight': P.nudge(e.shiftKey ? 15 : 5); break;
        case 'ArrowLeft': P.nudge(e.shiftKey ? -15 : -5); break;
        case 'ArrowUp': e.preventDefault(); setVolUI(P.volume + 0.05); break;
        case 'ArrowDown': e.preventDefault(); setVolUI(P.volume - 0.05); break;
        case 'n': case 'N': case 'в': P.next(false).then(refreshRows); break;
        case 'p': case 'P': case 'з': P.prev().then(refreshRows); break;
        case 'm': case 'M': case 'ь': P.toggleMute(); $('#player').querySelector('.vol').classList.toggle('is-muted', P.muted); break;
        case 's': case 'S': case 'ы': $('#btnShuffle').click(); break;
        case 'r': case 'R': case 'к': $('#btnRepeat').click(); break;
        case 'q': case 'Q': case 'й': toggleDrawer(); break;
        case 'f': case 'F': case 'а': if (P.current()) toggleNP(); break;
        case 'l': case 'L': case 'д': $('#btnFav').click(); break;
        case '/': case '?': e.preventDefault();
          if (e.key === '/') { input.focus(); input.select(); }
          else $('#keysModal').classList.add('is-open');
          break;
      }
    });

    function setVolUI(v) {
      v = U.clamp(v, 0, 1);
      P.setVolume(v);
      vol.value = Math.round(v * 100);
      paintVol(v);
      $('#player').querySelector('.vol').classList.toggle('is-muted', v === 0);
    }

    /* --- мультимедийные клавиши, проброшенные из меню Electron --- */
    global.addEventListener('aurora:media', function (e) {
      switch (e.detail) {
        case 'toggle': P.toggle(); break;
        case 'next': P.next(false).then(refreshRows); break;
        case 'prev': P.prev().then(refreshRows); break;
      }
    });
  }

  /* ================================================================== *
   * Привязка событий плеера к интерфейсу
   * ================================================================== */
  function wirePlayer() {
    var a = P.audio;

    P.on('track', function (t) {
      paintNowPlaying(t);
      P.updateMediaSession(t);
      $('#tDur').textContent = t && t.duration ? U.fmt(t.duration) : '0:00';
      $('#tCur').textContent = '0:00';
      $('#fillBar').style.transform = 'scaleX(0)';
      $('#bufferBar').style.width = '0%';
      state.lastSecond = -1;
      refreshRows();
      document.title = t ? '▶ ' + t.title + ' — ' + t.artist : 'Aurora · плеер';
    });

    P.on('state', function (s) {
      var playing = s === 'playing';
      $('#btnPlay').classList.toggle('is-playing', playing);
      $('#btnPlay').classList.toggle('is-loading', s === 'loading' || s === 'buffering');
      P.setPlaybackState(s);
      if (playing) { setStatus('playing', 'играет'); startProgress(); }
      else if (s === 'buffering' || s === 'loading') setStatus('loading', 'буферизация…');
      else if (s === 'idle') { setStatus('idle', 'готов'); stopProgress(); }
      else { setStatus('idle', 'пауза'); stopProgress(); }
      var eqs = U.$$('#view .track.is-current .eq');
      eqs.forEach(function (el) { el.classList.toggle('is-paused', !playing); });
    });

    P.on('time', function () { state.lastSecond = -1; });
    P.on('buffer', function (ratio) { $('#bufferBar').style.width = (ratio * 100).toFixed(2) + '%'; });
    P.on('queue', maybeQueue);
    P.on('error', function (e) {
      setStatus('error', 'ошибка');
      U.toast(e && e.message ? e.message : 'Ошибка воспроизведения', { error: true });
    });
    P.on('needtrack', function () { U.toast('Сначала выберите трек'); });
    P.on('mode', function (m) {
      $('#btnShuffle').classList.toggle('is-on', m.shuffle);
      $('#btnRepeat').classList.toggle('is-on', m.repeat > 0);
      $('#btnRepeat').innerHTML = '<svg><use href="#' + (m.repeat === 2 ? 'i-repeat1' : 'i-repeat') + '"/></svg>';
    });
    P.on('volume', function (v) {
      var vol = $('#volRange');
      vol.value = Math.round(v * 100);
      vol.style.setProperty('--p', Math.round(v * 100) + '%');
    });
    P.on('mute', function (m) { $('#player').querySelector('.vol').classList.toggle('is-muted', m); });
    P.on('sleep', function (m) {
      if (m) return;                       // метку ставит сам клик по кнопке
      $('#sleepLabel').textContent = 'выкл';
      $('#btnSleep').classList.remove('is-on');
      sleepIndex = 0;
    });
    P.on('favorites', function () { if (state.view === 'favorites') renderFavorites($('#view')); });

    // точная длительность приходит позже метаданных
    a.addEventListener('loadedmetadata', function () {
      $('#tDur').textContent = U.fmt(a.duration);
      P.updateMediaSession(P.current());
    });
    a.addEventListener('timeupdate', function () {
      // резерв на случай, если rAF-цикл ещё не запущен
      if (a.paused) { state.lastSecond = -1; }
    });
  }

  /* ================================================================== *
   * Старт
   * ================================================================== */
  function boot() {
    P.init();
    wirePlayer();
    wireEvents();

    if (U.store.get('perf', false)) {
      document.body.classList.add('perf');
      $('#btnPerf').classList.add('is-on');
      $('#perfLabel').textContent = 'вкл';
    }
    var vol = U.store.get('volume', 0.8);
    $('#volRange').value = Math.round(vol * 100);
    $('#volRange').style.setProperty('--p', Math.round(vol * 100) + '%');

    $('#keysBody').innerHTML = [
      ['Пробел / K', 'Играть или пауза'],
      ['← / →', 'Перемотать на 5 с (Shift — 15 с)'],
      ['↑ / ↓', 'Громкость'],
      ['N / P', 'Следующий / предыдущий трек'],
      ['S', 'Перемешать'],
      ['R', 'Режим повтора'],
      ['M', 'Выключить звук'],
      ['L', 'В избранное'],
      ['Q', 'Очередь'],
      ['F', 'Полноэкранный режим трека'],
      ['/', 'Перейти к поиску'],
      ['Esc', 'Закрыть панель']
    ].map(function (r) { return '<div class="krow"><b>' + r[1] + '</b><kbd>' + r[0] + '</kbd></div>'; }).join('');

    global.addEventListener('resize', U.throttleRaf(measureBar), { passive: true });

    // Предзагрузка discovery-узла Audius, пока пользователь смотрит на шапку
    S.Audius.init();
    go('home');

    U.toast('Готово. Нажмите ▶ на любом треке', { ms: 3600 });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
