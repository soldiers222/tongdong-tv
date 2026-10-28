// 跟着视频跳 · 视频里「老师」的动作从哪来：
//   NativeCoach  电视版 APK：安卓截视频画面（或者网页把画面送过去）用 MoveNet 识别，关键点从 window.__tdCoachPose 回来。
//                视频层（B站播放器）由安卓自己找画面；网页里的 <video>（电视里存的视频）要网页告诉它位置，
//                截不到画面时网页自己画到小画布上送过去。
//   WebCoach     网页版播放自己的视频文件时：网页里的 MoveNet（后台线程）直接看 <video>。
//   MockCoach    测试：MockVideo 里小人的姿势就是老师的动作。
// 统一接口：start() / tick() / stop() / status()；识别出来的每一帧交给 onPose(kp, t 秒, w, h)。
import { CORE } from '../core/keypoints.js';
import { figure } from '../core/figure.js';
import { createEngine } from '../pose/engines.js';
import { now } from '../core/util.js';

function bridge() {
  var n = window.TongdongNative;
  return n && typeof n.coachStart === 'function' ? n : null;
}

export function nativeCoachAvailable() { return !!bridge(); }

function parse(json) {
  if (!json) return null;
  if (typeof json !== 'string') return json;
  try { return JSON.parse(json); } catch (e) { return null; }
}

// 看得清几个关节
function seenCount(kp) {
  var n = 0;
  for (var k in kp) if (kp[k].s >= 0.3) n++;
  return n;
}

function Base(onPose) {
  this.onPose = onPose;
  this.mode = 'start';   // start / copy / push / web / mock / none / error
  this.why = '';
  this.frames = 0;
  this.seenAt = 0;       // 上一次看清老师的时间
}

Base.prototype._emit = function (kp, t, w, h) {
  this.frames++;
  if (kp && seenCount(kp) >= 8) this.seenAt = now();
  this.onPose(kp, t, w, h);
};

// 现在的状态：{mode, why, seeing（最近 1.5 秒看清了老师）}
Base.prototype.status = function () {
  return { mode: this.mode, why: this.why, seeing: now() - this.seenAt < 1500, frames: this.frames };
};

/* ---------- 电视版：安卓识别 ---------- */
// target：video（视频层）| main（网页里的 <video>，source 要有 contentRect()）
export function NativeCoach(onPose, source, target) {
  Base.call(this, onPose);
  this.source = source;
  this.target = target === 'main' ? 'main' : 'video';
  this.pushTimer = 0;
  this.canvas = null;
  this.lastUpdate = 0;
}
NativeCoach.prototype = Object.create(Base.prototype);

NativeCoach.prototype.start = function () {
  var n = bridge();
  var self = this;
  window.__tdCoachPose = function (m) { self._pose(m); };
  window.__tdCoachEvent = function (e) { self._event(parse(e)); };
  var r;
  try { r = parse(n.coachStart(JSON.stringify({ target: this.target, fps: 8, threads: 1 }))); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  if (!r || !r.ok) {
    this.mode = 'error';
    this.why = (r && r.error) || '启动失败';
  }
};

NativeCoach.prototype._pose = function (m) {
  if (!m || !m.k) return;
  var kp = {};
  for (var i = 0; i < CORE.length; i++) {
    var x = m.k[i * 3], y = m.k[i * 3 + 1], s = m.k[i * 3 + 2];
    var inFrame = x > -0.02 && x < 1.02 && y > -0.02 && y < 1.02;
    kp[CORE[i]] = { x: x, y: y, s: inFrame ? s : Math.min(s, 0.1) };
  }
  if (this.mode === 'start') this.mode = m.src === 'push' ? 'push' : 'copy';
  this._emit(kp, (now() - (m.age || 0)) / 1000, m.w || 1, m.h || 1);
};

NativeCoach.prototype._event = function (e) {
  if (!e) return;
  if (e.type === 'mode') {
    this.mode = e.mode || this.mode;
    if (e.why) this.why = e.why;
    if (this.target === 'main') this._push(e.mode === 'push');
  } else if (e.type === 'error') {
    this.mode = 'error';
    this.why = e.msg || e.error || '';
  }
};

// 网页里的 <video>：截不到画面时，自己把画面画到小画布上送给安卓（同源视频，画得出来）
NativeCoach.prototype._push = function (on) {
  clearInterval(this.pushTimer);
  this.pushTimer = 0;
  if (!on) return;
  var self = this;
  this.pushTimer = setInterval(function () { self._pushOne(); }, 125);
};

NativeCoach.prototype._pushOne = function () {
  var n = bridge();
  var v = this.source && this.source.v;
  if (!n || !v || v.paused || v.ended || v.readyState < 2 || !v.videoWidth) return;
  var w = 384, h = Math.max(16, Math.round(w * v.videoHeight / v.videoWidth));
  if (!this.canvas) this.canvas = document.createElement('canvas');
  if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  try {
    this.canvas.getContext('2d').drawImage(v, 0, 0, w, h);
    n.coachFrame(this.canvas.toDataURL('image/jpeg', 0.72), v.currentTime, Date.now());
  } catch (e) {
    this.mode = 'none';
    this.why = '画面送不过去';
    this._push(false);
  }
};

// 每帧调用：网页里的 <video> 要告诉安卓它在哪、在不在放（视频层安卓自己知道）
NativeCoach.prototype.tick = function () {
  if (this.target !== 'main') return;
  var n = bridge();
  var t = now();
  if (!n || t - this.lastUpdate < 250) return;
  this.lastUpdate = t;
  var r = this.source.contentRect ? this.source.contentRect() : null;
  var st = this.source.state();
  if (!r) return;
  try { n.coachUpdate(JSON.stringify({ x: r.x, y: r.y, w: r.w, h: r.h, playing: st.playing, t: st.t })); } catch (e) { /* 忽略 */ }
};

NativeCoach.prototype.stop = function () {
  var n = bridge();
  this._push(false);
  if (n) {
    try { n.coachStop(); } catch (e) { /* 忽略 */ }
  }
  window.__tdCoachPose = null;
  window.__tdCoachEvent = null;
};

// 安卓那边的统计（设备测试、调试用）
NativeCoach.prototype.info = function () {
  var n = bridge();
  if (!n || typeof n.coachInfo !== 'function') return null;
  try { return JSON.parse(n.coachInfo()); } catch (e) { return null; }
};

/* ---------- 网页版：网页里的 MoveNet 看 <video> ---------- */
export function WebCoach(onPose, source) {
  Base.call(this, onPose);
  this.source = source;
  this.engine = null;
  this.busy = false;
  this.stopped = false;
  this.lastAt = 0;
  this.mode = 'start';
}
WebCoach.prototype = Object.create(Base.prototype);

WebCoach.prototype.start = function () {
  var self = this;
  var eng;
  try { eng = createEngine('mn-worker'); } catch (e) { this.mode = 'none'; this.why = '这个浏览器用不了'; return; }
  eng.init().then(function () {
    if (self.stopped) { eng.dispose(); return; }
    self.engine = eng;
    self.mode = 'web';
  }, function (e) {
    self.mode = 'none';
    self.why = '识别模型加载失败：' + (e && e.message ? e.message : '');
    try { eng.dispose(); } catch (e2) { /* 忽略 */ }
  });
};

// 每秒看 6 帧左右（还要留算力给孩子的识别）
WebCoach.prototype.tick = function () {
  var v = this.source && this.source.v;
  var t = now();
  if (!this.engine || this.busy || !v || v.paused || v.readyState < 2 || !v.videoWidth || t - this.lastAt < 160) return;
  var self = this;
  this.busy = true;
  this.lastAt = t;
  this.engine.estimate(v, t).then(function (kp) {
    self.busy = false;
    if (self.stopped) return;
    self._emit(kp || null, t / 1000, v.videoWidth, v.videoHeight);
  }, function () { self.busy = false; });
};

WebCoach.prototype.stop = function () {
  this.stopped = true;
  if (this.engine) {
    try { this.engine.dispose(); } catch (e) { /* 忽略 */ }
  }
  this.engine = null;
};

/* ---------- 测试：画出来的小人 ---------- */
export function MockCoach(onPose, source) {
  Base.call(this, onPose);
  this.source = source;
  this.lastAt = 0;
}
MockCoach.prototype = Object.create(Base.prototype);
MockCoach.prototype.start = function () { this.mode = 'mock'; };
MockCoach.prototype.tick = function () {
  var t = now();
  var st = this.source.state();
  if (!st.playing || t - this.lastAt < 100) return;
  this.lastAt = t;
  this._emit(figure(this.source.poseAt(st.t)), t / 1000, 1280, 720);
};
MockCoach.prototype.stop = function () {};

/* ---------- 看不到老师（网页版的B站视频）：只按运动量 ---------- */
export function NoCoach(why) {
  Base.call(this, function () {});
  this.mode = 'none';
  this.why = why || '';
}
NoCoach.prototype = Object.create(Base.prototype);
NoCoach.prototype.start = function () {};
NoCoach.prototype.tick = function () {};
NoCoach.prototype.stop = function () {};
