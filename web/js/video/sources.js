// 跟着视频跳 · 视频从哪来（统一接口，模式不用管是哪一种）：
//   NativeVideo  电视版 APK：B站外链播放器放在网页下层的「视频层」（安卓的第二个 WebView）里，网页把那块做成透明。
//                能暂停、跳转、镜像，知道放到第几秒；视频里老师的动作由安卓识别（见 coach.js）。
//   FrameVideo   网页版：B站外链播放器放在 iframe 里。跨域，不能暂停、也不知道放到哪了，只能按运动量计分。
//   HtmlVideo    网页自己的 <video>：电视里存的视频（APK 的 /media/…）、网页版自己选的文件。
//   MockVideo    测试和演示：画一个跳舞的小人当视频（它的姿势就是「老师的动作」，不用识别）。
// 接口：open(el, {t}) / layout() / tick() / play() / pause() / seek(秒) / setMirror(是否) / close() / state()
//   state() → { ready, playing, t, dur, ended, error, loading, canControl }
import { embedUrl } from './videos.js';
import { ROUTINES, timeline } from '../dance/routines.js';
import { coachPose } from '../dance/dance-logic.js';
import { figure, drawFigure } from '../core/figure.js';
import { roundRect } from '../core/stage.js';
import { now } from '../core/util.js';

function bridge() {
  var n = window.TongdongNative;
  return n && typeof n.videoOpen === 'function' ? n : null;
}

export function nativeVideoAvailable() { return !!bridge(); }

function rectOf(el) {
  var r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function parse(json) {
  if (!json) return null;
  if (typeof json !== 'string') return json;
  try { return JSON.parse(json); } catch (e) { return null; }
}

/* ---------- 电视版：视频层 ---------- */
export function NativeVideo(entry) {
  this.entry = entry;
  this.kind = 'native';
  this.canCoach = true;
  this.s = null;
  this.at = 0;
  this.err = null;
  this.el = null;
  this.mirror = false;
  this.wantPlay = false;
  this.lastCmdAt = 0;
  this.openAt = 0;
  this.loadedAt = 0;
}

NativeVideo.prototype.open = function (el, opts) {
  var n = bridge();
  var self = this;
  this.el = el;
  this.openAt = now();
  this.loadedAt = 0;
  this.s = null;
  this.err = null;
  window.__tdVideo = function (json) { self._state(json); };
  window.__tdVideoEvent = function (json) { self._event(json); };
  document.documentElement.classList.add('native-video');
  document.body.classList.add('native-video');
  var r = rectOf(el);
  n.videoOpen(JSON.stringify({ url: embedUrl(this.entry, { t: opts && opts.t }), x: r.x, y: r.y, w: r.w, h: r.h }));
};

NativeVideo.prototype._state = function (json) {
  var s = parse(json);
  if (!s) return;
  this.s = s;
  this.at = now();
  // 镜像以网页为准（视频层页面刷新过就要再告诉它一次）
  if (s.ok && !!s.mirror !== this.mirror) this._cmd('mirror', this.mirror ? 1 : 0);
};

NativeVideo.prototype._event = function (json) {
  var e = parse(json);
  if (!e) return;
  if (e.type === 'error' || e.type === 'crash') this.err = e.msg || '视频打不开';
  if (e.type === 'loaded') this.loadedAt = now();
};

NativeVideo.prototype._cmd = function (c, v) {
  var n = bridge();
  if (!n) return;
  try { n.videoCmd(JSON.stringify({ c: c, v: v || 0 })); } catch (e) { /* 忽略 */ }
};

NativeVideo.prototype.layout = function () {
  var n = bridge();
  if (!n || !this.el) return;
  n.videoLayout(JSON.stringify(rectOf(this.el)));
};

// 每帧调用：想放却停着（比如播放器刚加载好又自己停了），隔一秒再叫一次
NativeVideo.prototype.tick = function () {
  var s = this.s;
  if (!s || !s.ok) return;
  var t = now();
  if (t - this.lastCmdAt < 1200) return;
  if (this.wantPlay && s.paused && !s.ended && s.ready >= 1) { this.lastCmdAt = t; this._cmd('play'); }
  if (!this.wantPlay && !s.paused) { this.lastCmdAt = t; this._cmd('pause'); }
};

NativeVideo.prototype.play = function () { this.wantPlay = true; this.lastCmdAt = now(); this._cmd('play'); };
NativeVideo.prototype.pause = function () { this.wantPlay = false; this.lastCmdAt = now(); this._cmd('pause'); };
NativeVideo.prototype.seek = function (t) {
  this._cmd('seek', t);
  if (this.s) { this.s.t = t; this.at = now(); }
};
NativeVideo.prototype.setMirror = function (b) { this.mirror = !!b; this._cmd('mirror', b ? 1 : 0); };

NativeVideo.prototype.close = function () {
  var n = bridge();
  if (n) {
    try { n.videoClose(); } catch (e) { /* 忽略 */ }
  }
  window.__tdVideo = null;
  window.__tdVideoEvent = null;
  document.documentElement.classList.remove('native-video');
  document.body.classList.remove('native-video');
};

NativeVideo.prototype.state = function () {
  var s = this.s;
  var err = this.err || (s && s.err ? '视频放不了（出错代码 ' + s.err + '）' : null);
  // 播放器页面打开 20 秒了还没有视频：多半是视频没了、不让在外面放，或者要登录
  if (!err && (!s || !s.ok) && this.loadedAt && now() - this.loadedAt > 20000) err = '这个视频打不开：可能被作者删了，或者不让在外面播放';
  if (!s || !s.ok) return { ready: false, playing: false, t: 0, dur: 0, ended: false, error: err, loading: true, canControl: true };
  var playing = !s.paused && !s.ended && s.ready >= 2;
  var t = s.t + (playing ? Math.min(1, (now() - this.at) / 1000) * (s.rate || 1) : 0);
  if (s.dur > 0) t = Math.min(t, s.dur);
  return {
    ready: s.ready >= 2 || s.t > 0, playing: playing, t: t, dur: s.dur || 0, ended: !!s.ended, error: err,
    loading: s.ready < 3 && !s.paused, canControl: true, vw: s.vw, vh: s.vh, buf: s.buf
  };
};

/* ---------- 网页版：iframe ---------- */
export function FrameVideo(entry) {
  this.entry = entry;
  this.kind = 'frame';
  this.canCoach = false;
  this.frame = null;
  this.loadedAt = 0;
  this.playFrom = 0;
  this.playedSec = 0;
  this.playing = false;
}

FrameVideo.prototype.open = function (el, opts) {
  var f = document.createElement('iframe');
  var self = this;
  f.className = 'vd-frame';
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
  f.setAttribute('allowfullscreen', 'true');
  f.setAttribute('scrolling', 'no');
  f.setAttribute('frameborder', '0');
  // 网页开了跨源隔离（COEP）时，只有「无凭据」的 iframe 才能嵌别的网站
  f.setAttribute('credentialless', '');
  f.addEventListener('load', function () { self.loadedAt = now(); });
  f.src = embedUrl(this.entry, { t: opts && opts.t });
  el.innerHTML = '';
  el.appendChild(f);
  this.frame = f;
  this.el = el;
  this.openAt = now();
};

FrameVideo.prototype.layout = function () {};
FrameVideo.prototype.tick = function () {};
// 管不了 iframe 里的视频：只是记一下「在放」的时间
FrameVideo.prototype.play = function () {
  if (!this.playing) { this.playing = true; this.playFrom = now(); }
};
FrameVideo.prototype.pause = function () {
  if (this.playing) { this.playedSec += (now() - this.playFrom) / 1000; this.playing = false; }
};
FrameVideo.prototype.seek = function () {};
FrameVideo.prototype.setMirror = function (b) {
  if (this.frame) this.frame.style.transform = b ? 'scaleX(-1)' : '';
};
FrameVideo.prototype.close = function () {
  if (this.frame && this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
  this.frame = null;
};
FrameVideo.prototype.state = function () {
  var ready = this.loadedAt > 0 && now() - this.loadedAt > 1500;
  var t = this.playedSec + (this.playing ? (now() - this.playFrom) / 1000 : 0);
  var err = !this.loadedAt && now() - this.openAt > 25000 ? '视频打不开（网页版可能放不了B站视频）' : null;
  return { ready: ready, playing: this.playing && ready, t: t, dur: (this.entry.meta && this.entry.meta.duration) || 0, ended: false, error: err, loading: !ready, canControl: false };
};

/* ---------- 网页自己的 <video> ---------- */
export function HtmlVideo(entry, src) {
  this.entry = entry;
  this.src = src;
  this.kind = 'html';
  this.canCoach = true;
  this.v = null;
  this.wantPlay = false;
}

HtmlVideo.prototype.open = function (el, opts) {
  var v = document.createElement('video');
  v.className = 'vd-video';
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.src = this.src;
  if (opts && opts.t > 0) {
    v.addEventListener('loadedmetadata', function () { try { v.currentTime = opts.t; } catch (e) { /* 忽略 */ } }, { once: true });
  }
  el.innerHTML = '';
  el.appendChild(v);
  this.v = v;
  this.el = el;
};

HtmlVideo.prototype.layout = function () {};
HtmlVideo.prototype.tick = function () {
  var v = this.v;
  if (!v) return;
  if (this.wantPlay && v.paused && !v.ended && v.readyState >= 2) {
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* 等下一次 */ });
  }
};
HtmlVideo.prototype.play = function () {
  this.wantPlay = true;
  if (this.v) {
    var p = this.v.play();
    if (p && p.catch) p.catch(function () { /* 等 tick 再试 */ });
  }
};
HtmlVideo.prototype.pause = function () { this.wantPlay = false; if (this.v) this.v.pause(); };
HtmlVideo.prototype.seek = function (t) { if (this.v) { try { this.v.currentTime = t; } catch (e) { /* 忽略 */ } } };
HtmlVideo.prototype.setMirror = function (b) { if (this.v) this.v.style.transform = b ? 'scaleX(-1)' : ''; };
HtmlVideo.prototype.close = function () {
  var v = this.v;
  if (v) {
    v.pause();
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* 忽略 */ }
    if (v.parentNode) v.parentNode.removeChild(v);
  }
  this.v = null;
};
HtmlVideo.prototype.state = function () {
  var v = this.v;
  if (!v) return { ready: false, playing: false, t: 0, dur: 0, ended: false, error: null, loading: true, canControl: true };
  var err = v.error ? '这个视频放不了（格式不支持或文件坏了）' : null;
  return {
    ready: v.readyState >= 2, playing: !v.paused && !v.ended && v.readyState >= 2, t: v.currentTime || 0,
    dur: isFinite(v.duration) ? v.duration : 0, ended: v.ended, error: err, loading: v.readyState < 3 && !v.paused,
    canControl: true, vw: v.videoWidth, vh: v.videoHeight
  };
};

// 视频画面在网页里的位置（CSS 像素，去掉黑边）
HtmlVideo.prototype.contentRect = function () {
  var v = this.v;
  if (!v) return null;
  var r = v.getBoundingClientRect();
  var vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return { x: r.left, y: r.top, w: r.width, h: r.height };
  var s = Math.min(r.width / vw, r.height / vh);
  var w = vw * s, h = vh * s;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w: w, h: h };
};

/* ---------- 测试和演示：画出来的跳舞小人 ---------- */
// 用跟跳练舞的一支舞当「视频」：老师的动作直接就是小人的姿势（MockCoach 用 poseAt 拿）
export function MockVideo(entry) {
  this.entry = entry;
  this.kind = 'mock';
  this.canCoach = true;
  var ro = ROUTINES[entry.routine] || ROUTINES.beat;
  this.keys = timeline(ro);
  this.spb = 60 / ro.song.bpm;
  var last = this.keys[this.keys.length - 1];
  this.dur = entry.dur || (last.beat * this.spb + 1.5);
  this.t = 0;
  this.playing = false;
  this.from = 0;
  this.openAt = 0;
  this.mirror = false;
}

MockVideo.prototype.open = function (el, opts) {
  this.openAt = now();
  this.t = (opts && opts.t) || 0;
};
MockVideo.prototype.layout = function () {};
MockVideo.prototype.tick = function () {};
MockVideo.prototype._now = function () {
  var t = this.t + (this.playing ? (now() - this.from) / 1000 : 0);
  return Math.min(t, this.dur);
};
MockVideo.prototype.play = function () {
  if (this.playing) return;
  this.playing = true;
  this.from = now();
};
MockVideo.prototype.pause = function () {
  if (!this.playing) return;
  this.t = this._now();
  this.playing = false;
};
MockVideo.prototype.seek = function (t) { this.t = Math.max(0, t); this.from = now(); };
MockVideo.prototype.setMirror = function (b) { this.mirror = !!b; };
MockVideo.prototype.close = function () { this.playing = false; };
MockVideo.prototype.state = function () {
  var ready = now() - this.openAt > 300;
  var t = this._now();
  return { ready: ready, playing: this.playing && ready && t < this.dur, t: t, dur: this.dur, ended: t >= this.dur, error: null, loading: !ready, canControl: true };
};
// 视频里 t 秒时老师的姿势（figure 参数）
MockVideo.prototype.poseAt = function (t) { return coachPose(this.keys, t / this.spb); };
// 画进画布（逻辑坐标 r = {x, y, w, h}）
MockVideo.prototype.draw = function (c, r) {
  c.save();
  c.fillStyle = '#1F4FA8';
  c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = 'rgba(247,245,239,0.08)';
  for (var i = 1; i < 6; i++) c.fillRect(r.x + (r.w * i) / 6 - 1, r.y, 2, r.h);
  c.fillStyle = 'rgba(19,33,60,0.5)';
  roundRect(c, r.x + r.w * 0.2, r.y + r.h * 0.86, r.w * 0.6, r.h * 0.08, r.h * 0.04);
  c.fill();
  var pose = this.poseAt(this._now());
  drawFigure(c, figure(pose), { x: r.x, y: r.y + r.h * 0.04, w: r.w, h: r.h * 0.92 }, { mirror: this.mirror, width: 14, color: '#F7F5EF' });
  c.restore();
};
