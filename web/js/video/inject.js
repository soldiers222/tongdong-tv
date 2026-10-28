// 电视版 APK 的「视频层」专用：安卓把这个文件读出来，注入到B站外链播放器的页面里（不是童动乐园网页的模块）。
// 视频层是网页下层的第二个 WebView，只放播放器页面；童动乐园的网页在上层，把视频那块做成透明。
//   __tdv.state()     播放状态：放到第几秒、总长、暂停没有、视频画面在页面里的位置……（安卓每 1/4 秒取一次，转给网页）
//   __tdv.cmd(c, v)   play / pause / seek 秒 / mirror 0|1 / mute 0|1 / unmute 0|1 / rate 倍速 / push 0|1
// 画面推送（push）：把视频画面画到小画布上转成 JPEG，交给安卓识别视频里老师的动作（TdCoach.frame）。
// 安卓直接截屏截不到视频画面时才用；跨域的视频画不到画布上（taint），就告诉安卓放弃。
(function () {
  if (window.__tdv) return;
  var S = {
    mirror: false, unmute: true, push: false, pushFps: 8, pushW: 384, timer: 0,
    taint: false, pushErr: '', pushed: 0, lastPushT: -1, canvas: null, ctx: null, playErr: '',
    since: Date.now(), poked: 0
  };
  var root = document.documentElement;

  // 页面里最大的那个视频（播放器里可能还有预览小视频）
  function vid() {
    var list = document.querySelectorAll('video, bwp-video');
    var best = null, area = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect ? list[i].getBoundingClientRect() : { width: 0, height: 0 };
      var a = r.width * r.height;
      if (!best || a > area) { best = list[i]; area = a; }
    }
    return best;
  }

  // 只留视频：其他东西（标题栏、控制条、弹幕、推荐）都藏起来，视频铺满、等比例放在正中
  function css() {
    if (document.getElementById('__tdv_css')) return;
    var st = document.createElement('style');
    st.id = '__tdv_css';
    st.textContent = [
      'html,body{background:#000!important;overflow:hidden!important;margin:0!important}',
      'body *{visibility:hidden!important;transition:none!important;animation:none!important}',
      'body *:not(video):not(bwp-video){transform:none!important;filter:none!important;will-change:auto!important;contain:none!important;perspective:none!important}',
      'html body video,html body bwp-video{visibility:visible!important;position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;' +
        'width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;' +
        'object-fit:contain!important;z-index:2147483647!important;background:#000!important;opacity:1!important;transform:none!important}',
      'html.__tdv_m body video,html.__tdv_m body bwp-video{transform:scaleX(-1)!important}'
    ].join('\n');
    (document.head || root).appendChild(st);
  }

  // 播放器没有自动开始（页面上只有一个大的播放按钮、还没有视频）：帮着点一下播放按钮（最多两次）
  function poke() {
    if (S.poked >= 2 || Date.now() - S.since < 3500 * (S.poked + 1)) return;
    S.poked += 1;
    var list = document.querySelectorAll('[class*="play"], [class*="Play"], button, [role="button"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var cls = String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '');
      if (!/play|start|begin/i.test(cls + ' ' + (el.getAttribute('aria-label') || ''))) continue;
      if (/next|list|rate|speed|setting|danmaku|dm|full|wide|pip|volume|mute/i.test(cls)) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) continue;
      try { el.click(); } catch (e) { /* 忽略 */ }
      return;
    }
  }

  function applyMirror() {
    if (S.mirror) root.classList.add('__tdv_m');
    else root.classList.remove('__tdv_m');
  }

  // object-fit: contain 时视频画面实际在哪（页面 CSS 像素）
  function contentRect(v) {
    var r = v.getBoundingClientRect();
    var vw = v.videoWidth || 0, vh = v.videoHeight || 0;
    if (!vw || !vh || !r.width || !r.height) return [r.left, r.top, r.width, r.height];
    var s = Math.min(r.width / vw, r.height / vh);
    var w = vw * s, h = vh * s;
    return [r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h];
  }

  function pushOne() {
    var v = vid();
    if (!v || String(v.tagName).toLowerCase() !== 'video') return;
    if (v.paused || v.ended || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
    if (v.currentTime === S.lastPushT) return;
    var feed = window.TdCoach;
    if (!feed || typeof feed.frame !== 'function') return;
    var w = S.pushW, h = Math.max(16, Math.round(w * v.videoHeight / v.videoWidth));
    if (h > w * 1.5) { h = Math.round(w * 1.5); w = Math.max(16, Math.round(h * v.videoWidth / v.videoHeight)); }
    if (!S.canvas) S.canvas = document.createElement('canvas');
    if (S.canvas.width !== w || S.canvas.height !== h || !S.ctx) {
      S.canvas.width = w;
      S.canvas.height = h;
      S.ctx = S.canvas.getContext('2d');
    }
    try {
      S.ctx.drawImage(v, 0, 0, w, h);
      var url = S.canvas.toDataURL('image/jpeg', 0.72);
      S.lastPushT = v.currentTime;
      S.pushed += 1;
      feed.frame(url, v.currentTime, Date.now());
    } catch (e) {
      // 跨域视频：画布被「污染」，读不出像素
      S.taint = true;
      S.pushErr = String((e && (e.name || e.message)) || e);
      setPush(false);
    }
  }

  function setPush(on) {
    S.push = !!on && !S.taint;
    clearInterval(S.timer);
    S.timer = 0;
    if (S.push) S.timer = setInterval(pushOne, Math.round(1000 / S.pushFps));
  }

  window.__tdv = {
    state: function () {
      css();
      applyMirror();
      var v = vid();
      if (!v) poke();
      var o = {
        ok: !!v, url: String(location.href).slice(0, 300), title: String(document.title || '').slice(0, 120),
        W: window.innerWidth, H: window.innerHeight, wall: Date.now(),
        mirror: S.mirror, push: S.push, taint: S.taint, pushed: S.pushed, pushErr: S.pushErr, playErr: S.playErr
      };
      if (!v) return o;
      if (S.unmute && v.muted) {
        try { v.muted = false; } catch (e) { /* 忽略 */ }
      }
      o.tag = String(v.tagName).toLowerCase();
      o.t = Number(v.currentTime) || 0;
      o.dur = isFinite(v.duration) ? Number(v.duration) : 0;
      o.paused = !!v.paused;
      o.ended = !!v.ended;
      o.ready = Number(v.readyState) || 0;
      o.vw = Number(v.videoWidth) || 0;
      o.vh = Number(v.videoHeight) || 0;
      o.rect = contentRect(v);
      o.err = v.error ? (v.error.code || 1) : 0;
      o.rate = Number(v.playbackRate) || 1;
      o.muted = !!v.muted;
      o.buf = 0;
      try {
        var b = v.buffered;
        for (var i = 0; i < b.length; i++) {
          if (b.start(i) <= o.t + 0.2 && b.end(i) >= o.t) o.buf = Math.round((b.end(i) - o.t) * 10) / 10;
        }
      } catch (e) { /* 忽略 */ }
      return o;
    },

    cmd: function (c, val) {
      if (c === 'mirror') { S.mirror = !!val; applyMirror(); return true; }
      if (c === 'push') { setPush(!!val); return true; }
      if (c === 'unmute') { S.unmute = !!val; return true; }
      var v = vid();
      if (!v) return false;
      try {
        if (c === 'play') {
          var p = v.play();
          if (p && typeof p.catch === 'function') p.catch(function (e) { S.playErr = String((e && (e.name || e.message)) || e); });
        } else if (c === 'pause') {
          v.pause();
        } else if (c === 'seek') {
          v.currentTime = Math.max(0, Number(val) || 0);
        } else if (c === 'mute') {
          S.unmute = !val;
          v.muted = !!val;
        } else if (c === 'rate') {
          v.playbackRate = Math.max(0.25, Math.min(2, Number(val) || 1));
        }
      } catch (e) {
        S.playErr = String((e && e.message) || e);
        return false;
      }
      return true;
    }
  };
  css();
})();
