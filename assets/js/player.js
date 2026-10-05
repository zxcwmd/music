/* Aurora · движок воспроизведения.
   Один <audio>, ленивый Web Audio (анализатор создаётся только когда CORS
   действительно разрешён — иначе браузер заглушил бы звук), визуализатор
   с потолком 30 к/с и остановкой на скрытой вкладке.
*/
(function (global) {
  'use strict';

  var U = global.U;
  var Sources = global.Sources;

  /* ------------------------------------------------------------------ *
   * Визуализатор
   * ------------------------------------------------------------------ */
  var Viz = {
    bars: null, ring: null,
    barsCtx: null, ringCtx: null,
    data: null, peaks: null,
    raf: 0, last: 0, running: false,
    fps: 30,
    dpr: 1,
    barsW: 0, barsH: 0, ringW: 0, ringH: 0,

    attach: function (barsCanvas, ringCanvas) {
      this.bars = barsCanvas;
      this.ring = ringCanvas;
      this.barsCtx = barsCanvas && barsCanvas.getContext('2d');
      this.ringCtx = ringCanvas && ringCanvas.getContext('2d');
      this.dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.resize();
      var onResize = U.throttleRaf(function () { Viz.resize(); });
      global.addEventListener('resize', onResize, { passive: true });
    },

    resize: function () {
      var d = this.dpr;
      if (this.bars) {
        var r = this.bars.getBoundingClientRect();
        this.barsW = Math.max(1, Math.round(r.width)); this.barsH = Math.max(1, Math.round(r.height));
        this.bars.width = this.barsW * d; this.bars.height = this.barsH * d;
      }
      if (this.ring) {
        var r2 = this.ring.getBoundingClientRect();
        this.ringW = Math.max(1, Math.round(r2.width)); this.ringH = Math.max(1, Math.round(r2.height));
        this.ring.width = this.ringW * d; this.ring.height = this.ringH * d;
      }
      this._grad = null;                 // градиент зависит от высоты
      if (!this.running) { this.clear(); }
    },

    bind: function (analyser) {
      this.analyser = analyser;
      this.data = new Uint8Array(analyser.frequencyBinCount);
      this.peaks = new Float32Array(64);
    },

    clear: function () {
      if (this.barsCtx) this.barsCtx.clearRect(0, 0, this.bars.width, this.bars.height);
      if (this.ringCtx) this.ringCtx.clearRect(0, 0, this.ring.width, this.ring.height);
    },

    start: function () {
      if (this.running || document.body.classList.contains('perf')) return;
      this.running = true;
      this.last = 0;
      var self = this;
      var step = function (ts) {
        if (!self.running) return;
        self.raf = requestAnimationFrame(step);
        if (ts - self.last < 1000 / self.fps) return;
        self.last = ts;
        self.draw(ts);
      };
      this.raf = requestAnimationFrame(step);
    },

    stop: function () {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.clear();
    },

    /** 64 полосы логарифмически, со сглаживанием спада (без аллокаций в кадре) */
    levels: function (t) {
      var out = this._out || (this._out = new Float32Array(64));
      // peaks аллоцируется здесь, а не в bind(): без Web Audio (старый браузер,
      // эконом-режим, закрытый CORS) этот метод всё равно вызывается каждый кадр
      var peaks = this.peaks || (this.peaks = new Float32Array(64));
      var a = this.analyser;
      if (a && this.data) {
        a.getByteFrequencyData(this.data);
        var n = this.data.length;             // 64 при fftSize=128
        var live = 0;
        for (var i = 0; i < 64; i++) {
          var lo = Math.floor(Math.pow(i / 64, 1.7) * (n - 1));
          var hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / 64, 1.7) * (n - 1)));
          var sum = 0;
          for (var j = lo; j < hi; j++) sum += this.data[j];
          var v = (sum / (hi - lo)) / 255;
          live += v;
          var p = peaks[i] || 0;
          v = v > p ? v : p * 0.86 + v * 0.14;   // быстрый подъём, мягкий спад
          peaks[i] = v;
          out[i] = v;
        }
        if (live > 0.4) return out;            // анализатор живой
      }
      // CORS закрыл анализатор — рисуем спокойную декоративную волну.
      // Обязателен Math.max: отрицательный уровень дал бы Math.pow(v,1.25) = NaN,
      // и полосы просто исчезли бы.
      for (var k = 0; k < 64; k++) {
        var w = 0.10 + 0.07 * Math.sin(t / 620 + k * 0.34) + 0.05 * Math.sin(t / 300 + k * 0.11);
        peaks[k] = out[k] = w < 0 ? 0 : w;
      }
      return out;
    },

    /** Читаем CSS-переменные только когда они реально сменились */
    colors: function () {
      var sig = this._sig;
      var cs = getComputedStyle(document.documentElement);
      var a1 = (cs.getPropertyValue('--accent') || '#7c5cff').trim();
      var a2 = (cs.getPropertyValue('--accent-2') || '#22d3ee').trim();
      if (sig !== a1 + '|' + a2) {
        this._sig = a1 + '|' + a2;
        this._accent = a1; this._accent2 = a2;
        this._grad = null;
      }
      return this;
    },

    draw: function (t) {
      var lv = this.levels(t);
      this.colors();

      /* --- полосы в плеере --- */
      var c = this.barsCtx;
      if (c && this.barsW) {
        var d = this.dpr;
        c.setTransform(d, 0, 0, d, 0, 0);
        c.clearRect(0, 0, this.barsW, this.barsH);
        var N = 40;
        var gap = 2;
        var w = (this.barsW - gap * (N - 1)) / N;
        if (w < 0.6) w = 0.6;
        var grad = this._grad;
        if (!grad) {
          grad = c.createLinearGradient(0, this.barsH, 0, 0);
          grad.addColorStop(0, this._accent);
          grad.addColorStop(1, this._accent2);
          this._grad = grad;
        }
        c.fillStyle = grad;
        for (var i = 0; i < N; i++) {
          var v = lv[Math.floor(i / N * 58)] || 0;
          var h = Math.max(2, Math.pow(v, 1.25) * this.barsH);
          var x = i * (w + gap);
          var y = this.barsH - h;
          var r = Math.min(w / 2, 2);
          c.beginPath();
          c.moveTo(x, this.barsH);
          c.lineTo(x, y + r);
          c.quadraticCurveTo(x, y, x + r, y);
          c.lineTo(x + w - r, y);
          c.quadraticCurveTo(x + w, y, x + w, y + r);
          c.lineTo(x + w, this.barsH);
          c.closePath();
          c.globalAlpha = 0.35 + 0.65 * Math.min(1, v * 1.6);
          c.fill();
        }
        c.globalAlpha = 1;
      }

      /* --- кольцо в полноэкранном режиме --- */
      var r2 = this.ringCtx;
      if (r2 && this.ringW && this.ringOpen) {
        var d2 = this.dpr;
        r2.setTransform(d2, 0, 0, d2, 0, 0);
        r2.clearRect(0, 0, this.ringW, this.ringH);
        var cx = this.ringW / 2, cy = this.ringH / 2;
        var R = Math.min(cx, cy) * 0.84;
        var BARS = 96;
        r2.lineCap = 'round';
        for (var k = 0; k < BARS; k++) {
          var v2 = lv[Math.floor(k / BARS * 60)] || 0;
          var ang = (k / BARS) * Math.PI * 2 - Math.PI / 2;
          var len = 6 + Math.pow(v2, 1.3) * Math.min(cx, cy) * 0.28;
          r2.strokeStyle = this._accent;
          r2.globalAlpha = 0.18 + 0.6 * Math.min(1, v2 * 1.7);
          r2.lineWidth = 2.2;
          r2.beginPath();
          r2.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
          r2.lineTo(cx + Math.cos(ang) * (R + len), cy + Math.sin(ang) * (R + len));
          r2.stroke();
        }
        r2.globalAlpha = 1;
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Плеер
   * ------------------------------------------------------------------ */
  var P = {
    audio: null,
    queue: [],
    index: -1,
    order: [],
    orderPos: -1,
    shuffle: false,
    repeat: 0,                    // 0 выкл · 1 очередь · 2 трек
    volume: 0.8,
    muted: false,
    corsOK: true,                 // пробуем crossOrigin, откатываемся при ошибке
    ctx: null, analyser: null,
    retries: 0,
    listeners: {},
    sleepTimer: 0,
    sleepFade: 0,

    on: function (name, fn) {
      (this.listeners[name] || (this.listeners[name] = [])).push(fn);
    },
    emit: function (name, payload) {
      (this.listeners[name] || []).forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error(e); }
      });
    },

    init: function () {
      var a = new Audio();
      a.preload = 'metadata';
      a.volume = this.volume;
      this.audio = a;

      var self = this;

      a.addEventListener('playing', function () {
        if (a.crossOrigin) self.ensureAudioGraph();
        self.emit('state', 'playing');
        Viz.start();
        self.pushHistory();
      });
      a.addEventListener('pause', function () {
        self.emit('state', 'paused');
        // даём полосам красиво опасть и выключаем цикл
        clearTimeout(self._vizStop);
        self._vizStop = setTimeout(function () {
          if (self.audio.paused) Viz.stop();
        }, 900);
      });
      a.addEventListener('waiting', function () { self.emit('state', 'buffering'); });
      a.addEventListener('ended', function () { self.onEnded(); });
      a.addEventListener('durationchange', function () { self.emit('meta', self.current()); });
      a.addEventListener('progress', function () { self.emit('buffer', self.buffered()); });
      a.addEventListener('error', function () { self.onError(); });

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) Viz.stop();
        else if (!a.paused) Viz.start();
      });

      this.restore();
      this.bindMediaSession();
      Viz.attach(U.$('#viz'), U.$('#ringViz'));
    },

    /* ---------------- CORS / Web Audio ---------------- */
    ensureAudioGraph: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      if (document.body.classList.contains('perf')) return;
      try {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        var src = this.ctx.createMediaElementSource(this.audio);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 128;                 // 64 бинов — дёшево
        this.analyser.smoothingTimeConstant = 0.72;
        src.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        Viz.bind(this.analyser);
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) {
        this.ctx = null; this.analyser = null;
      }
    },

    /* ---------------- очередь ---------------- */
    setQueue: function (tracks, startIndex) {
      this.queue = tracks.slice();
      this.rebuildOrder();
      if (startIndex != null) this.index = U.clamp(startIndex, 0, this.queue.length - 1);
      this.emit('queue', this.queue);
    },
    appendQueue: function (tracks) {
      var wasEmpty = this.queue.length === 0;
      this.queue = this.queue.concat(tracks);
      this.rebuildOrder();
      this.emit('queue', this.queue);
      return wasEmpty;
    },
    removeFromQueue: function (i) {
      if (i === this.index) return;
      this.queue.splice(i, 1);
      if (i < this.index) this.index--;
      this.rebuildOrder();
      this.emit('queue', this.queue);
    },
    clearQueue: function () {
      this.queue = []; this.index = -1; this.order = []; this.orderPos = -1;
      this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
      this.emit('queue', this.queue);
      this.emit('track', null);
      this.emit('state', 'idle');
    },
    rebuildOrder: function () {
      var n = this.queue.length;
      var arr = [];
      for (var i = 0; i < n; i++) arr.push(i);
      if (this.shuffle) {
        for (var j = arr.length - 1; j > 0; j--) {
          var k = Math.floor(Math.random() * (j + 1));
          var t = arr[j]; arr[j] = arr[k]; arr[k] = t;
        }
        var at = arr.indexOf(this.index);
        if (at > 0) { arr.splice(at, 1); arr.unshift(this.index); }
      }
      this.order = arr;
      this.orderPos = Math.max(0, arr.indexOf(this.index));
    },
    toggleShuffle: function () {
      this.shuffle = !this.shuffle;
      this.rebuildOrder();
      this.emit('mode', { shuffle: this.shuffle, repeat: this.repeat });
      return this.shuffle;
    },
    cycleRepeat: function () {
      this.repeat = (this.repeat + 1) % 3;
      this.emit('mode', { shuffle: this.shuffle, repeat: this.repeat });
      return this.repeat;
    },

    current: function () {
      return this.index >= 0 && this.index < this.queue.length ? this.queue[this.index] : null;
    },

    /** Ставит и играет трек по индексу очереди */
    playAt: function (i) {
      if (i < 0 || i >= this.queue.length) return Promise.resolve();
      this.index = i;
      this.orderPos = this.order.indexOf(i);
      this.retries = 0;
      return this.load(this.queue[i], true);
    },

    playTrack: function (track, list, index) {
      if (list) { this.setQueue(list, index != null ? index : 0); this.index = index != null ? index : 0; }
      this.orderPos = this.order.indexOf(this.index);
      this.retries = 0;
      return this.load(track, true);
    },

    next: function (auto) {
      if (!this.queue.length) return Promise.resolve();
      if (this.repeat === 2 && auto) return this.load(this.current(), true);
      var np = this.orderPos + 1;
      if (np >= this.order.length) {
        if (this.repeat === 1 || !auto) np = 0;
        else { this.emit('state', 'paused'); this.audio.pause(); return Promise.resolve(); }
      }
      this.orderPos = np;
      return this.playAt(this.order[np]);
    },
    prev: function () {
      if (this.audio.currentTime > 4) { this.audio.currentTime = 0; this.emit('time', 0); return Promise.resolve(); }
      if (!this.queue.length) return Promise.resolve();
      var np = this.orderPos - 1;
      if (np < 0) np = this.order.length - 1;
      this.orderPos = np;
      return this.playAt(this.order[np]);
    },

    /* ---------------- загрузка ---------------- */
    load: function (track, autoplay) {
      var self = this;
      if (!track) return Promise.resolve();
      this.emit('track', track);
      this.emit('state', 'loading');

      var ready = track.streamUrl
        ? Promise.resolve(track)
        : Sources.Audius.refresh(track.remoteId).then(function (fresh) {
            track.streamUrl = fresh.streamUrl;
            return track;
          });

      return ready.then(function (t) {
        var a = self.audio;
        if (self.corsOK) a.setAttribute('crossorigin', 'anonymous');
        else a.removeAttribute('crossorigin');
        a.src = t.streamUrl;
        a.load();
        if (autoplay) {
          var pr = a.play();
          if (pr && pr.catch) pr.catch(function (e) {
            if (e && e.name === 'NotAllowedError') self.emit('state', 'paused');
          });
        }
        return t;
      }).catch(function (e) {
        self.emit('error', e);
      });
    },

    /** CORS не дал загрузить поток — пробуем ещё раз без crossorigin */
    onError: function () {
      var self = this;
      var a = this.audio;
      if (!this.current()) return;
      if (this.corsOK && a.getAttribute('crossorigin')) {
        // сервер не отдал Access-Control-Allow-Origin — пробуем без crossorigin.
        // Звук останется, но анализатор спектра работать не будет.
        this.corsOK = false;
        this.ctx = null; this.analyser = null;
        Viz.analyser = null;
        Viz.data = null;
        this.retries++;
        if (this.retries <= 2) {
          var t = this.current();
          if (t.source === 'audius') t.streamUrl = null;   // ссылка могла протухнуть
          this.load(t, true);
          return;
        }
      }
      if (this.retries < 2 && this.current() && this.current().source === 'audius') {
        this.retries++;
        var cur = this.current();
        Sources.Audius.refresh(cur.remoteId).then(function (fresh) {
          cur.streamUrl = fresh.streamUrl;
          return self.load(cur, true);
        }).catch(function (e) { self.emit('error', e); });
        return;
      }
      this.emit('error', new Error('Не удалось загрузить поток'));
    },

    onEnded: function () {
      if (this.repeat === 2) { this.audio.currentTime = 0; this.audio.play(); return; }
      this.next(true);
    },

    toggle: function () {
      var a = this.audio;
      if (!this.current()) { this.emit('needtrack'); return; }
      if (a.paused) {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function () {});
      } else a.pause();
    },

    seek: function (ratio) {
      var a = this.audio;
      if (!isFinite(a.duration) || !a.duration) return;
      a.currentTime = U.clamp(ratio, 0, 1) * a.duration;
      this.emit('time', a.currentTime);
    },
    nudge: function (sec) {
      var a = this.audio;
      if (!isFinite(a.duration)) return;
      a.currentTime = U.clamp(a.currentTime + sec, 0, a.duration);
      this.emit('time', a.currentTime);
    },

    setVolume: function (v) {
      this.volume = U.clamp(v, 0, 1);
      this.audio.volume = this.volume;
      if (this.volume > 0) this.muted = false;
      this.persist();
      this.emit('volume', this.volume);
    },
    toggleMute: function () {
      this.muted = !this.muted;
      this.audio.muted = this.muted;
      this.emit('mute', this.muted);
    },

    buffered: function () {
      var a = this.audio;
      try {
        if (a.buffered && a.buffered.length && isFinite(a.duration) && a.duration) {
          return a.buffered.end(a.buffered.length - 1) / a.duration;
        }
      } catch (e) {}
      return 0;
    },

    /* ---------------- избранное / история ---------------- */
    favorites: function () { return U.store.get('favorites', []); },
    isFavorite: function (track) {
      return !!track && this.favorites().some(function (f) { return f.id === track.id; });
    },
    toggleFavorite: function (track) {
      if (!track) return false;
      var favs = this.favorites();
      var at = favs.findIndex(function (f) { return f.id === track.id; });
      if (at >= 0) favs.splice(at, 1); else favs.unshift(this.slim(track));
      U.store.set('favorites', favs.slice(0, 400));
      this.emit('favorites', favs);
      return at < 0;
    },
    history: function () { return U.store.get('history', []); },
    pushHistory: function () {
      var t = this.current();
      if (!t) return;
      var h = this.history().filter(function (x) { return x.id !== t.id; });
      h.unshift(this.slim(t));
      U.store.set('history', h.slice(0, 120));
      this.emit('history', h);
    },
    slim: function (t) {
      return {
        id: t.id, source: t.source, remoteId: t.remoteId, identifier: t.identifier,
        title: t.title, artist: t.artist, album: t.album, duration: t.duration,
        cover: t.cover, coverBig: t.coverBig, pageUrl: t.pageUrl,
        // ссылка на поток у Audius протухает — храним только если это стабильный archive.org
        streamUrl: t.source === 'archive' ? t.streamUrl : null
      };
    },

    persist: function () {
      U.store.set('volume', this.volume);
      U.store.set('prefs', { shuffle: this.shuffle, repeat: this.repeat, corsOK: this.corsOK });
    },
    restore: function () {
      var v = U.store.get('volume', null);
      if (v != null) { this.volume = v; this.audio.volume = v; }
      var p = U.store.get('prefs', null);
      if (p) { this.shuffle = !!p.shuffle; this.repeat = p.repeat | 0; this.corsOK = p.corsOK !== false; }
      this.emit('mode', { shuffle: this.shuffle, repeat: this.repeat });
      this.emit('volume', this.volume);
    },

    /* ---------------- таймер сна ---------------- */
    setSleep: function (minutes) {
      clearTimeout(this.sleepTimer);
      clearInterval(this.sleepFade);
      this.sleepUntil = 0;
      if (!minutes) { this.emit('sleep', 0); return 0; }
      this.sleepUntil = Date.now() + minutes * 60000;
      var self = this;
      this.sleepTimer = setTimeout(function () {
        var from = self.audio.volume;
        var step = from / 40;
        self.sleepFade = setInterval(function () {
          self.audio.volume = Math.max(0, self.audio.volume - step);
          if (self.audio.volume <= 0.001) {
            clearInterval(self.sleepFade);
            self.audio.pause();
            self.audio.volume = self.volume;
            self.sleepUntil = 0;
            self.emit('sleep', 0);
            U.toast('Таймер сна: плеер остановлен');
          }
        }, 400);
      }, minutes * 60000);
      this.emit('sleep', minutes);
      return minutes;
    },
    sleepLeft: function () {
      return this.sleepUntil ? Math.max(0, Math.round((this.sleepUntil - Date.now()) / 1000)) : 0;
    },

    /* ---------------- Media Session (системные кнопки/шторка) ---------------- */
    bindMediaSession: function () {
      if (!('mediaSession' in navigator)) return;
      var self = this;
      var ms = navigator.mediaSession;
      var safe = function (name, fn) {
        try { ms.setActionHandler(name, fn); } catch (e) {}
      };
      safe('play', function () { self.toggle(); });
      safe('pause', function () { self.toggle(); });
      safe('previoustrack', function () { self.prev(); });
      safe('nexttrack', function () { self.next(); });
      safe('seekbackward', function (d) { self.nudge(-(d.seekOffset || 10)); });
      safe('seekforward', function (d) { self.nudge(d.seekOffset || 10); });
      safe('seekto', function (d) { if (d.seekTime != null) { self.audio.currentTime = d.seekTime; self.emit('time', d.seekTime); } });
    },
    updateMediaSession: function (t) {
      if (!('mediaSession' in navigator) || !t) return;
      try {
        var art = [];
        if (t.cover) art.push({ src: t.cover, sizes: '480x480', type: 'image/jpeg' });
        if (t.coverBig && t.coverBig !== t.cover) art.push({ src: t.coverBig, sizes: '1000x1000', type: 'image/jpeg' });
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.title, artist: t.artist, album: t.album || '', artwork: art
        });
      } catch (e) {}
    },
    setPlaybackState: function (s) {
      if (!('mediaSession' in navigator)) return;
      try {
        navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : (s === 'loading' ? 'playing' : 'paused');
        if (this.audio && isFinite(this.audio.duration)) {
          navigator.mediaSession.setPositionState({
            duration: this.audio.duration,
            playbackRate: 1,
            position: U.clamp(this.audio.currentTime, 0, this.audio.duration)
          });
        }
      } catch (e) {}
    }
  };

  P.Viz = Viz;
  global.Player = P;
})(window);
