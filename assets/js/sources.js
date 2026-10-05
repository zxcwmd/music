/* Aurora · источники музыки.
   Оба — свободные и без рекламы, ключей API не требуют:
     • Audius          — децентрализованная музыкальная платформа, полные треки
     • Internet Archive — нетлейблы, живые концерты, CC-альбомы
*/
(function (global) {
  'use strict';

  var U = global.U;
  var APP = 'AuroraWebPlayer';

  /* ------------------------------------------------------------------ *
   * Общий HTTP-хелпер с таймаутом
   * ------------------------------------------------------------------ */
  function getJSON(url, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || 15000);
    return fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) {
        clearTimeout(timer);
        throw e.name === 'AbortError' ? new Error('Сервер не ответил вовремя') : e;
      });
  }

  /* ================================================================== *
   * AUDIUS
   * ================================================================== */
  var Audius = {
    host: null,
    _hostPromise: null,

    genres: [
      { id: '', label: 'Всё' },
      { id: 'Electronic', label: 'Электроника' },
      { id: 'Hip-Hop/Rap', label: 'Хип-хоп' },
      { id: 'House', label: 'House' },
      { id: 'Techno', label: 'Techno' },
      { id: 'Rock', label: 'Рок' },
      { id: 'Pop', label: 'Поп' },
      { id: 'R&B/Soul', label: 'R&B / Soul' },
      { id: 'Ambient', label: 'Эмбиент' },
      { id: 'Jazz', label: 'Джаз' },
      { id: 'Classical', label: 'Классика' },
      { id: 'Drum & Bass', label: 'Drum & Bass' },
      { id: 'Trap', label: 'Trap' },
      { id: 'Metal', label: 'Метал' }
    ],

    /** Разово узнаём живой discovery-узел */
    init: function () {
      if (this._hostPromise) return this._hostPromise;
      this._hostPromise = getJSON('https://api.audius.co', 12000)
        .then(function (j) {
          var hosts = (j && j.data) || [];
          Audius.host = hosts[0] || 'https://api.audius.co';
          return Audius.host;
        })
        .catch(function () { Audius.host = 'https://api.audius.co'; return Audius.host; });
      return this._hostPromise;
    },

    _q: function (params) {
      var p = new URLSearchParams(params);
      p.set('app_name', APP);
      return p.toString();
    },

    trending: function (genre) {
      var self = this;
      return this.init().then(function () {
        var q = { limit: '48' };
        if (genre) q.genre = genre;
        return getJSON(self.host + '/v1/tracks/trending?' + self._q(q));
      }).then(function (j) {
        return ((j && j.data) || []).map(Audius.normalize).filter(Boolean);
      });
    },

    search: function (query) {
      var self = this;
      return this.init().then(function () {
        return getJSON(self.host + '/v1/tracks/search?' + self._q({ query: query, limit: '60' }));
      }).then(function (j) {
        return ((j && j.data) || []).map(Audius.normalize).filter(Boolean);
      });
    },

    /** Полный объект трека — нужен, чтобы освежить протухшую ссылку на поток */
    refresh: function (id) {
      var self = this;
      return this.init().then(function () {
        return getJSON(self.host + '/v1/tracks/' + encodeURIComponent(id) + '?' + self._q({}));
      }).then(function (j) {
        var t = Audius.normalize(j && j.data);
        if (!t) throw new Error('Трек недоступен');
        if (!t.streamUrl) {
          return getJSON(self.host + '/v1/tracks/' + encodeURIComponent(id) + '/stream?' + self._q({}))
            .then(function (s) { t.streamUrl = s && s.data && s.data.url; return t; });
        }
        return t;
      });
    },

    normalize: function (t) {
      if (!t || !t.id) return null;
      var art = t.artwork || null;
      var cover = art ? (art['480x480'] || art['150x150'] || art['1000x1000']) : null;
      var coverBig = art ? (art['1000x1000'] || art['480x480']) : null;
      return {
        id: 'audius:' + t.id,
        source: 'audius',
        remoteId: t.id,
        title: t.title || 'Без названия',
        artist: (t.user && (t.user.name || t.user.handle)) || 'Неизвестный исполнитель',
        album: t.genre || 'Audius',
        duration: t.duration || 0,
        cover: cover,
        coverBig: coverBig,
        streamUrl: t.stream && t.stream.url ? t.stream.url : null,
        plays: t.play_count || 0,
        likes: t.favorite_count || 0,
        genre: t.genre || '',
        pageUrl: 'https://audius.co' + (t.permalink || '')
      };
    }
  };

  /* ================================================================== *
   * INTERNET ARCHIVE
   * ================================================================== */
  var Archive = {
    /** Подборки, в которых действительно лежит музыка (без аудиокниг) */
    shelves: [
      { id: 'netlabels', label: 'Нетлейблы' },
      { id: 'etree', label: 'Живые концерты' },
      { id: 'audio_music', label: 'Вся музыка' },
      { id: 'audio_foreign', label: 'Мировая музыка' },
      { id: '78rpm_kusik', label: '78 оборотов' }
    ],

    /** Поиск по альбомам/сборникам */
    search: function (query, shelf) {
      var parts = ['mediatype:(audio)'];
      var collections = (shelf ? [shelf] : ['netlabels', 'etree', 'audio_music'])
        .map(function (c) { return 'collection:' + c; })
        .join(' OR ');
      parts.push('(' + collections + ')');
      if (query && query.trim()) parts.push('(' + query.trim().replace(/["\\]/g, '') + ')');

      // собираем строку вручную: advancedsearch ждёт повторяющиеся fl[]=… , а
      // URLSearchParams склеил бы массив в «fl[]=a,b»
      var fields = ['identifier', 'title', 'creator', 'downloads', 'year'];
      var url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(parts.join(' AND ')) +
        fields.map(function (f) { return '&fl%5B%5D=' + f; }).join('') +
        '&sort%5B%5D=' + encodeURIComponent('downloads desc') +
        '&rows=60&page=1&output=json';

      return getJSON(url, 20000)
        .then(function (j) {
          var docs = (j && j.response && j.response.docs) || [];
          return docs.map(function (d) {
            return {
              id: 'arch:' + d.identifier,
              identifier: d.identifier,
              title: d.title || d.identifier,
              artist: Array.isArray(d.creator) ? d.creator[0] : (d.creator || 'Internet Archive'),
              year: d.year || '',
              downloads: d.downloads || 0,
              cover: 'https://archive.org/services/img/' + d.identifier,
              pageUrl: 'https://archive.org/details/' + d.identifier
            };
          });
        });
    },

    /** Список треков внутри предмета */
    item: function (identifier) {
      return getJSON('https://archive.org/metadata/' + encodeURIComponent(identifier), 20000)
        .then(function (meta) {
          var files = (meta && meta.files) || [];
          var info = (meta && meta.metadata) || {};
          var album = info.title || identifier;
          var artist = Array.isArray(info.creator) ? info.creator[0] : (info.creator || info.collection || 'Internet Archive');

          var tracks = Archive.pickAudio(files).map(function (f, i) {
            return {
              id: 'arch:' + identifier + '#' + f.name,
              source: 'archive',
              identifier: identifier,
              title: U.cleanTitle(f.title || f.name, artist),
              artist: f.artist || artist,
              album: f.album || album,
              duration: parseFloat(f.length) || 0,
              cover: 'https://archive.org/services/img/' + identifier,
              coverBig: 'https://archive.org/services/img/' + identifier,
              streamUrl: 'https://archive.org/download/' + identifier + '/' +
                encodeURIComponent(f.name),
              format: f.format || '',
              plays: 0, likes: 0,
              pageUrl: 'https://archive.org/details/' + identifier,
              index: i
            };
          });

          return {
            identifier: identifier,
            title: album,
            artist: artist,
            description: Archive.shortDescription(info.description),
            license: info.licenseurl || '',
            cover: 'https://archive.org/services/img/' + identifier,
            pageUrl: 'https://archive.org/details/' + identifier,
            tracks: tracks
          };
        });
    },

    /** Оставляем только то, что браузер реально умеет играть */
    pickAudio: function (files) {
      var SKIP = /(_files\.xml|_meta\.xml|_spectrogram|_spectrogram\.png|\.ffp|\.torrent|\.zip|\.cue|\.txt|\.jpg|\.jpeg|\.png|\.gif|\.pdf|\.md5|\.sha1)$/i;
      var MP3 = /^(vbr mp3|mp3|\d+kbps mp3)$/i;

      var ok = files.filter(function (f) {
        if (!f.name || SKIP.test(f.name)) return false;
        return MP3.test(f.format || '');
      });

      // нет MP3 — берём ogg (его понимают Chrome/Firefox/Edge)
      if (!ok.length) {
        ok = files.filter(function (f) {
          return f.name && !SKIP.test(f.name) && /^ogg( vorbis)?$/i.test(f.format || '');
        });
      }
      if (!ok.length) {
        ok = files.filter(function (f) {
          return f.name && !SKIP.test(f.name) && /^(m4a|mp4|aac)$/i.test(f.format || '');
        });
      }

      // оригиналы приятнее по качеству, чем производные
      ok.sort(function (a, b) {
        var an = U.trackNumber(a), bn = U.trackNumber(b);
        if (an !== bn) return an - bn;
        var as = a.source === 'original' ? 0 : 1;
        var bs = b.source === 'original' ? 0 : 1;
        if (as !== bs) return as - bs;
        return U.natural(a.name, b.name);
      });

      return ok.slice(0, 120);
    },

    shortDescription: function (d) {
      if (!d) return '';
      var t = String(d).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return t.length > 320 ? t.slice(0, 320) + '…' : t;
    }
  };

  global.Sources = { Audius: Audius, Archive: Archive, getJSON: getJSON };
})(window);
