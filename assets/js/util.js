/* Aurora · утилиты. Классические скрипты (без сборщика и модулей),
   поэтому плеер работает и с файловой системы, и с любого статик-хостинга. */
(function (global) {
  'use strict';

  var U = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /** 3661 -> "1:01:01", 65 -> "1:05" */
  U.fmt = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  };

  /** 12400 -> "12.4K" */
  U.compact = function (n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  };

  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  U.throttleRaf = function (fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; fn(); });
    };
  };

  U.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem('aurora.' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('aurora.' + key, JSON.stringify(value)); } catch (e) { /* приватный режим */ }
    }
  };

  /** "01 - Artist - Song.mp3" -> "Song" (убираем номер трека и дублирующегося артиста) */
  U.cleanTitle = function (raw, artist) {
    var t = String(raw || '').replace(/\.(mp3|ogg|flac|wav|m4a|opus|aac)$/i, '');
    t = t.replace(/[_+]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // ведущий номер трека — только если за ним разделитель, иначе «2001 A Space…»
    // превратилось бы в «1 A Space…»
    t = t.replace(/^\s*\d{1,3}[\s.)\-–—]+/, '');
    if (artist) {
      var re = new RegExp('^\\s*' + artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—]\\s*', 'i');
      t = t.replace(re, '');
    }
    t = t.trim();
    return t || String(raw || 'Без названия');
  };

  U.trackNumber = function (f) {
    var raw = f && (f.track || (f['track-number']));
    if (!raw) return 9999;
    var n = parseInt(String(raw).split('/')[0], 10);
    return isNaN(n) ? 9999 : n;
  };

  U.natural = function (a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  };

  /** Тост в правом нижнем углу */
  U.toast = function (text, opts) {
    var host = U.$('#toasts');
    if (!host) return;
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' is-error' : '');
    el.innerHTML = '<svg><use href="#' + (opts.error ? 'i-close' : 'i-zap') + '"/></svg><span>' + U.esc(text) + '</span>';
    host.appendChild(el);
    var life = opts.ms || (opts.error ? 5200 : 2600);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 320);
    }, life);
    // не копим больше четырёх
    while (host.children.length > 4) host.firstChild.remove();
  };

  /** Усреднённый доминирующий цвет обложки -> CSS-переменные темы */
  U.themeFromImage = function (url, apply) {
    if (!url) return;
    var img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var c = document.createElement('canvas');
        var W = 20, H = 20;
        c.width = W; c.height = H;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        var d = ctx.getImageData(0, 0, W, H).data;
        var buckets = Object.create(null);
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 125) continue;
          var r = d[i], g = d[i + 1], b = d[i + 2];
          var max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max < 24 || max > 246) continue;               // отбрасываем почти чёрное/белое
          var sat = max === 0 ? 0 : (max - min) / max;
          if (sat < 0.14) continue;                          // серое
          var key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
          var slot = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0, sat: 0 });
          slot.n++; slot.r += r; slot.g += g; slot.b += b; slot.sat += sat;
        }
        var best = null;
        for (var k in buckets) {
          var s = buckets[k];
          var score = s.n * (0.6 + s.sat / s.n);
          if (!best || score > best.score) best = { score: score, r: s.r / s.n, g: s.g / s.n, b: s.b / s.n };
        }
        if (!best) return;
        apply(Math.round(best.r), Math.round(best.g), Math.round(best.b));
      } catch (e) { /* CORS: оставляем тему по умолчанию */ }
    };
    img.onerror = function () { /* тихо */ };
    img.src = url;
  };

  /** Повышаем насыщенность/яркость, чтобы цвет читался на тёмном фоне */
  U.vivid = function (r, g, b) {
    var max = Math.max(r, g, b) || 1;
    var scale = Math.min(1.9, 210 / max);
    r *= scale; g *= scale; b *= scale;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var mid = (mx + mn) / 2;
    var boost = 1.35;
    r = mid + (r - mid) * boost; g = mid + (g - mid) * boost; b = mid + (b - mid) * boost;
    return [U.clamp(Math.round(r), 0, 255), U.clamp(Math.round(g), 0, 255), U.clamp(Math.round(b), 0, 255)];
  };

  global.U = U;
})(window);
