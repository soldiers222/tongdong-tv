// 跟着视频跳 · 画面与流程
//   视频放在左边一大块，孩子自己在右边一小块（摄像头画面 + 骨架线），下面一条是老师、进度、评级、得分。
//   加载（视频准备好，孩子站好）→ 3、2、1 → 放视频，每 2 秒评一次 → 放完出结算。
//   遥控器：返回键暂停（暂停菜单里可以镜像画面、提前结束）；左右键快退 / 快进 10 秒；加载时按确定直接开始。
import { VideoJudge } from './video-logic.js';
import { NativeVideo, FrameVideo, HtmlVideo, MockVideo, nativeVideoAvailable } from './sources.js';
import { NativeCoach, WebCoach, MockCoach, NoCoach, nativeCoachAvailable } from './coach.js';
import { fmtDur, videoKey, catName } from './videos.js';
import { makeSlots, Pops, starText } from '../games/arena.js';
import { W, H, roundRect, outlinedText, BODY_FONT } from '../core/stage.js';
import { BONES, COLORS } from '../core/skeleton.js';
import { GRADES } from '../dance/dance-logic.js';
import * as store from '../core/store.js';
import { showRest, ui } from '../ui/ui.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, clamp } from '../core/util.js';

export var VIDEO_RECT = { x: 16, y: 16, w: 880, h: 495 };   // 画布逻辑坐标（1280×720）
export var PANEL_RECT = { x: 912, y: 16, w: 352, h: 495 };
var BAR_Y = 527;
var WAIT_MAX = 25000;     // 视频准备好以后，最多等孩子站好这么久
var LOAD_MAX = 45000;     // 视频最多等这么久还没准备好就算打不开
var APP_ORIGIN = 'https://appassets.androidplatform.net/';

// 进入参数 → 要放的视频
export function entryFromParams(p) {
  var e = { title: p.title || '视频', cat: p.cat || '', p: Number(p.p) || 1 };
  if (p.bv) e.bv = p.bv;
  if (p.local) { e.local = p.local; e.src = p.src || (APP_ORIGIN + 'media/' + p.local); }
  if (p.src && !p.local) { e.local = 'file'; e.src = p.src; }
  if (p.demo) e.routine = p.demo;
  if (p.dur) e.dur = Number(p.dur);
  if (p.duration) e.meta = { duration: Number(p.duration) };
  return e;
}

function makeSource(e) {
  if (e.routine) return new MockVideo(e);
  if (e.src) return new HtmlVideo(e, e.src);
  if (nativeVideoAvailable()) return new NativeVideo(e);
  return new FrameVideo(e);
}

export function VideoDanceMode(env, params) {
  this.env = env;
  this.params = params || {};
  this.entry = entryFromParams(this.params);
  this.players = 1;
  this.title = '跟着视频跳：' + this.entry.title;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.slots = makeSlots(1);
  this.pops = new Pops();
  this.host = document.getElementById('vd-host');
  this.source = null;
  this.coach = null;
  this.judge = null;
  this.mirror = !!store.get().videos.mirror;
  env.stage.setViewport(PANEL_RECT);
  this.phase = 'load';
}

VideoDanceMode.prototype.fit = 'cover';
VideoDanceMode.prototype.resultClass = 'vd-result';

VideoDanceMode.prototype._open = function (t0) {
  var self = this;
  if (this.source) this.source.close();
  if (this.coach) this.coach.stop();
  this.source = makeSource(this.entry);
  // 网页版的 iframe、<video> 放在画布上面的这个框里；视频层（在网页下层）按这个框的位置摆，框是透明的；
  // 画出来的演示视频直接画在画布上，不用它
  this.host.classList.toggle('show', this.source.kind !== 'mock');
  this.host.classList.toggle('native', this.source.kind === 'native');
  this.source.open(this.host, { t: t0 || 0 });
  this.source.setMirror(this.mirror);
  var onPose = function (kp, t, w, h) { self._coachPose(kp, t, w, h); };
  var k = this.source.kind;
  if (k === 'mock') this.coach = new MockCoach(onPose, this.source);
  else if (k === 'native') this.coach = nativeCoachAvailable() ? new NativeCoach(onPose, this.source, 'video') : new NoCoach('这个版本看不到视频里的老师');
  else if (k === 'html') this.coach = nativeCoachAvailable() ? new NativeCoach(onPose, this.source, 'main') : new WebCoach(onPose, this.source);
  else this.coach = new NoCoach('网页版看不到B站视频里的老师，按运动量打分');
  this.coach.start();
  this.judge = new VideoJudge({ noCoach: this.coach instanceof NoCoach });
};

VideoDanceMode.prototype.reset = function () {
  this.phase = 'load';
  this.phaseStart = now();
  this.readyAt = 0;
  this.paused = false;
  this.skipWait = false;
  this.started = false;
  this.lastGrade = null;
  this.gradeAt = 0;
  this.lastTip = null;
  this.coachKp = null;
  this.coachWH = [1, 1];
  this.childSeenAt = 0;
  this.stallSince = 0;
  this.lastCount = -1;
  this.endT = 0;
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i];
    P.handsProgress = 0;
    P.space = null;
    P.gate.reset();
    P.handsUp.reset();
  }
};

VideoDanceMode.prototype.begin = function () {
  this.reset();
  var t0 = Number(this.params.resumeAt) || 0;
  delete this.params.resumeAt;
  this.t0 = t0;
  this._open(t0);
  speak('站到电视前，让全身出现在右边的小画面里。准备好就跟着视频里的老师一起跳');
};

VideoDanceMode.prototype.restart = function () {
  this.reset();
  this.t0 = 0;
  if (!this.source) { this._open(0); return; }
  this.source.pause();
  this.source.seek(0);
  if (this.judge) this.judge.reset();
  this.readyAt = now();
  this.skipWait = true; // 刚跳过一遍，直接倒数
};

VideoDanceMode.prototype.pause = function (v) {
  this.paused = !!v;
  if (!this.source) return;
  if (v) {
    this.source.pause();
    if (this.judge) this._grades(this.judge.gap());
  } else if (this.phase === 'play') {
    this.source.play();
  }
};

// 暂停菜单里多加的按钮
VideoDanceMode.prototype.menuButtons = function (resume) {
  var self = this;
  var out = [{ label: this.mirror ? '画面不镜像' : '画面左右镜像', fn: function () { self.setMirror(!self.mirror); resume(); } }];
  if (this.phase === 'play') out.push({ label: '结束，看成绩', fn: function () { resume(); self._end(); } });
  return out;
};

VideoDanceMode.prototype.setMirror = function (b) {
  this.mirror = !!b;
  store.get().videos.mirror = this.mirror;
  store.save();
  if (this.source) this.source.setMirror(this.mirror);
};

// 遥控器按键（返回 true 表示用掉了）
VideoDanceMode.prototype.onKey = function (name) {
  if (this.paused) return false;
  if (name === 'enter' && this.phase === 'load') {
    this.skipWait = true;
    return true;
  }
  if ((name === 'left' || name === 'right') && this.phase === 'play' && this.source) {
    var st = this.source.state();
    if (!st.canControl) return true;
    var to = clamp(st.t + (name === 'left' ? -10 : 10), 0, Math.max(0, (st.dur || 1e9) - 1));
    this._grades(this.judge.gap());
    this.source.seek(to);
    ui.toast((name === 'left' ? '快退' : '快进') + ' 10 秒：' + fmtDur(to), 1500);
    return true;
  }
  return false;
};

// ---------- 姿势输入 ----------
VideoDanceMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  var P = this.slots[0];
  var kp = frame.kp || null;
  P.kp = kp;
  P.pose = kp ? st.mapKp(kp) : null;
  if (kp && kp.left_shoulder && kp.left_shoulder.s >= 0.3 && kp.right_shoulder && kp.right_shoulder.s >= 0.3) this.childSeenAt = now();
  if (this.phase === 'load' || this.phase === 'count') P.space = P.gate.update(kp, 'full', st.mirror, frame.t, null);
  if (this.phase === 'play' && !this.paused && this.judge) this.judge.addChild(kp, frame.t / 1000, frame.w, frame.h);
  if (this.phase === 'result' && kp) {
    var h = P.handsUp.update(kp, frame.t);
    P.handsProgress = h.progress;
    if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
  }
};

VideoDanceMode.prototype._coachPose = function (kp, t, w, h) {
  if (kp) {
    this.coachKp = kp;
    this.coachWH = [w, h];
  }
  if (this.phase === 'play' && !this.paused && this.judge) this.judge.addCoach(kp, t, w, h);
};

// ---------- 流程 ----------
VideoDanceMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  var tn = now();
  var src = this.source;
  if (src) src.tick();
  if (this.coach) this.coach.tick();
  var vs = src ? src.state() : { ready: false, t: 0, dur: 0 };
  this._drawBack(c);
  this._drawVideoArea(c, vs, tn);
  this._drawChild(c);
  if (this.phase === 'load') this._frameLoad(c, vs, tn);
  else if (this.phase === 'count') this._frameCount(c, tn);
  else if (this.phase === 'play') this._framePlay(c, vs, tn, dt);
  this._drawBar(c, vs, tn);
  if (this.phase === 'result') this._drawHandsUp(c);
  this.pops.draw(c, tn);
  if (this.env.settings.perf) outlinedText(c, this._perf(), 20, 712, 18, '#F7F5EF', 'left', BODY_FONT);
};

VideoDanceMode.prototype._frameLoad = function (c, vs, tn) {
  var src = this.source;
  if (vs.error) { this._fail(vs.error); return; }
  if (!vs.ready && tn - this.phaseStart > LOAD_MAX) {
    this._fail('视频一直没出来：可能没联网，或者这个视频不能在外面播放。');
    return;
  }
  // B站播放器加载好会自己开始放：视频层会马上停住（NativeVideo.tick），等孩子站好
  if (vs.ready && !this.readyAt) this.readyAt = tn;
  var P = this.slots[0];
  var stood = P.space && P.space.passed;
  if (this.readyAt && (stood || this.skipWait || tn - this.readyAt > WAIT_MAX)) {
    if (!vs.canControl) {
      // 网页版的 iframe：管不了暂停，直接开始
      this._startPlay();
      return;
    }
    this.phase = 'count';
    this.phaseStart = tn;
    this.lastCount = -1;
  }
};

VideoDanceMode.prototype._frameCount = function (c, tn) {
  var el = tn - this.phaseStart;
  var idx = Math.floor(el / 800);
  if (idx !== this.lastCount) {
    this.lastCount = idx;
    if (idx < 3) sfx.tick();
    else if (idx === 3) sfx.go();
  }
  var r = PANEL_RECT;
  if (idx < 3) {
    var f = (el % 800) / 800;
    c.globalAlpha = 1 - f * 0.5;
    outlinedText(c, String(3 - idx), r.x + r.w / 2, r.y + r.h / 2 + 70, Math.round(200 * (1.15 - 0.15 * f)), '#FFC928', 'center');
    c.globalAlpha = 1;
    return;
  }
  this._startPlay();
};

VideoDanceMode.prototype._startPlay = function () {
  this.phase = 'play';
  this.phaseStart = now();
  // 自动播放可能已经放了一两秒：第一次开始前回到开头（或者接着上次的地方）
  if (!this.started && this.source.state().canControl) this.source.seek(this.t0 || 0);
  this.started = true;
  this.source.play();
  if (this.judge) this.judge.reset();
  this.pops.add('开始！', PANEL_RECT.x + PANEL_RECT.w / 2, 220, '#FFC928', 72, now());
};

VideoDanceMode.prototype._framePlay = function (c, vs, tn, dt) {
  if (this.paused) return;
  if (this.env.mock) window.__tdMockHint = this.source.poseAt ? { pose: this.source.poseAt(vs.t) } : null;
  if (this.judge) this._grades(this.judge.update(tn / 1000));
  // 孩子在画面里才算运动时间
  if (tn - this.childSeenAt < 1500) this.env.onActive(Math.min(50, dt));
  // 视频卡住了（缓冲）
  if (!vs.playing && !vs.ended) {
    if (!this.stallSince) this.stallSince = tn;
  } else {
    this.stallSince = 0;
  }
  if (vs.error) { this._fail(vs.error); return; }
  if (vs.ended || (vs.dur > 1 && vs.t >= vs.dur - 0.3)) {
    this._end();
    return;
  }
  // 运动时间到了家长设的提醒时间：先停下休息（长视频中途也提醒）
  var lim = store.settings().limitMin;
  if (lim > 0 && store.sessionSeconds() >= lim * 60) this._rest(lim);
};

VideoDanceMode.prototype._rest = function (lim) {
  var self = this;
  this.pause(true);
  showRest(lim, 60, function (choice) {
    store.resetSession();
    if (self.env.focus) self.env.focus();
    if (choice === 'home') {
      self._end();
      return;
    }
    self.pause(false);
  });
};

VideoDanceMode.prototype._grades = function (events) {
  var tn = now();
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (e.type !== 'grade') continue;
    this.lastGrade = e;
    this.gradeAt = tn;
    if (e.tip) this.lastTip = { text: e.tip, at: tn };
    if (e.grade.id === 'perfect') sfx.star();
    else if (e.grade.id === 'great') sfx.tick();
    if (e.combo > 0 && e.combo % 10 === 0) {
      sfx.combo(4);
      this.pops.add('连续 ' + e.combo + ' 次', PANEL_RECT.x + PANEL_RECT.w / 2, 300, '#FFC928', 48, tn);
    }
  }
};

VideoDanceMode.prototype._fail = function (msg) {
  if (this.phase === 'fail') return;
  var self = this;
  this.phase = 'fail';
  if (this.source) this.source.pause();
  var btns = [
    { label: '重试', primary: true, fn: function () { ui.hideLoading(); self.begin(); } },
    { label: '换一个视频', fn: function () { ui.hideLoading(); self.env.leave(); } }
  ];
  ui.loading('视频放不了', msg + (this.entry.bv ? '（' + this.entry.bv + '）' : ''), btns, function () { ui.hideLoading(); self.env.leave(); });
};

VideoDanceMode.prototype._end = function () {
  if (this.phase === 'result') return;
  var vs = this.source ? this.source.state() : { t: 0 };
  this.phase = 'result';
  this.endT = vs.t;
  if (this.source) this.source.pause();
  if (this.judge) this._grades(this.judge.finish());
  window.__tdMockHint = null;
  this.slots[0].handsUp.reset();
  sfx.success();
  var r = this.judge ? this.judge.result() : { score: 0, stars: 0, counts: {} };
  var e = this.entry;
  r.type = 'video';
  r.video = videoKey(e);
  r.title = e.title;
  r.cat = e.cat;
  if (e.bv) { r.bv = e.bv; r.p = e.p; }
  r.age = this.age;
  var cs = this.coach ? this.coach.status() : { mode: 'none', why: '' };
  r.coach = cs.mode;
  if (cs.why) r.coachWhy = cs.why;
  r.watched = Math.round(vs.t || 0);
  r.bestKey = 'video-' + r.video;
  r.bestValue = r.score;
  this.env.finish(r);
};

// ---------- 画面 ----------
VideoDanceMode.prototype._drawBack = function (c) {
  var st = this.env.stage;
  if (this.env.mock) {
    c.fillStyle = '#0F1D36';
    c.fillRect(0, 0, W, H);
    var r = PANEL_RECT;
    c.fillStyle = '#23633E';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = 'rgba(247,245,239,0.35)';
    c.font = '20px ' + BODY_FONT;
    c.textAlign = 'center';
    c.fillText('模拟模式（不用摄像头）', r.x + r.w / 2, r.y + r.h - 16);
    c.textAlign = 'left';
  } else {
    st.drawVideo(this.env.video, this.phase === 'result' ? 0.35 : 0);
  }
  // 孩子画面的框
  c.save();
  c.lineWidth = 6;
  c.strokeStyle = '#FFC928';
  roundRect(c, PANEL_RECT.x - 3, PANEL_RECT.y - 3, PANEL_RECT.w + 6, PANEL_RECT.h + 6, 18);
  c.stroke();
  c.restore();
};

VideoDanceMode.prototype._drawVideoArea = function (c, vs, tn) {
  var r = VIDEO_RECT, src = this.source;
  if (!src) return;
  if (src.kind === 'native') {
    // 视频在网页下层：这一块留透明
    c.clearRect(r.x, r.y, r.w, r.h);
  } else if (src.kind === 'mock') {
    src.draw(c, r);
  } else {
    c.fillStyle = '#000';
    c.fillRect(r.x, r.y, r.w, r.h);
  }
  // 还在加载、卡住了：在视频上写一行字（视频没在放，不会被当成老师的画面）
  var msg = null;
  if (this.phase === 'load' && !vs.ready) msg = '视频加载中…';
  else if (this.phase === 'play' && this.stallSince && tn - this.stallSince > 1500 && !this.paused) msg = '视频在缓冲，等一下…';
  if (msg) {
    c.fillStyle = 'rgba(10,18,36,0.75)';
    roundRect(c, r.x + r.w / 2 - 220, r.y + r.h / 2 - 46, 440, 92, 46);
    c.fill();
    outlinedText(c, msg, r.x + r.w / 2, r.y + r.h / 2 + 16, 40, '#F7F5EF', 'center');
  }
};

// 孩子的骨架线：最近一次评级每条胳膊、腿的颜色（像 = 绿，差一点 = 黄，差很多 = 红）
VideoDanceMode.prototype._drawChild = function (c) {
  var P = this.slots[0];
  var pts = P.pose;
  var r = PANEL_RECT;
  c.save();
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.clip();
  if (pts && this.env.settings.skeleton !== false) {
    c.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < BONES.length; i++) {
        var a = pts[BONES[i][0]], b = pts[BONES[i][1]];
        if (!a || !b || a.s < 0.3 || b.s < 0.3) continue;
        c.strokeStyle = pass ? COLORS.plain : 'rgba(10,18,36,0.55)';
        c.lineWidth = pass ? 6 : 11;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
    }
  }
  // 站位提示
  if (this.phase === 'load' || this.phase === 'count') {
    var sp = P.space;
    var msg = sp && sp.passed ? '站好了！' : (sp ? sp.msg : '站到电视前，让摄像头看到你');
    c.fillStyle = 'rgba(10,18,36,0.8)';
    roundRect(c, r.x + 12, r.y + r.h - 96, r.w - 24, 80, 24);
    c.fill();
    var size = msg.length > 10 ? 26 : 32;
    outlinedText(c, msg, r.x + r.w / 2, r.y + r.h - 46, size, sp && sp.ok ? '#FFC928' : '#F7F5EF', 'center', BODY_FONT);
    if (sp && sp.ok && !sp.passed) {
      c.fillStyle = '#3FBF6A';
      roundRect(c, r.x + 40, r.y + r.h - 30, (r.w - 80) * sp.progress, 6, 3);
      c.fill();
    }
  }
  // 刚出的评级：大字压在孩子画面上
  var g = this.lastGrade;
  if (g && this.phase === 'play') {
    var age = (now() - this.gradeAt) / 1300;
    if (age < 1) {
      c.globalAlpha = 1 - age * age;
      var sz = Math.round(70 * (1 + 0.25 * Math.max(0, 1 - age * 5)));
      outlinedText(c, g.grade.text + (g.grade.id === 'miss' ? '' : '！'), r.x + r.w / 2, r.y + 110, sz, g.grade.color, 'center');
      c.globalAlpha = 1;
    }
  }
  c.restore();
};

// 结算时：孩子画面下面一条「举起双手再跳一遍」的进度
VideoDanceMode.prototype._drawHandsUp = function (c) {
  var r = PANEL_RECT, p = this.slots[0].handsProgress;
  c.fillStyle = 'rgba(10,18,36,0.8)';
  roundRect(c, r.x + 12, r.y + r.h - 92, r.w - 24, 76, 24);
  c.fill();
  outlinedText(c, '举起双手 2 秒，再跳一遍', r.x + r.w / 2, r.y + r.h - 54, 24, '#F7F5EF', 'center', BODY_FONT);
  roundRect(c, r.x + 40, r.y + r.h - 38, r.w - 80, 10, 5);
  c.fillStyle = 'rgba(247,245,239,0.25)';
  c.fill();
  if (p > 0) {
    roundRect(c, r.x + 40, r.y + r.h - 38, (r.w - 80) * p, 10, 5);
    c.fillStyle = '#3FBF6A';
    c.fill();
  }
};

function statusText(s) {
  if (s.mode === 'none' || s.mode === 'error') return '按运动量计分';
  if (s.mode === 'start') return '准备看老师';
  return s.seeing ? 'AI 看着老师' : '找老师…';
}

// 左下角：AI 看到的老师（小骨架）
VideoDanceMode.prototype._drawCoachBox = function (c, x, y, w, h) {
  c.fillStyle = 'rgba(10,18,36,0.8)';
  roundRect(c, x, y, w, h, 18);
  c.fill();
  var s = this.coach ? this.coach.status() : { mode: 'none' };
  var kp = this.coachKp;
  if (kp && s.seeing && s.mode !== 'none') {
    // 只画老师这个人（按看得清的关节框出来，放大到小框里）
    var cw = this.coachWH[0] || 1, ch = this.coachWH[1] || 1;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, k;
    for (k in kp) {
      if (kp[k].s < 0.3) continue;
      x0 = Math.min(x0, kp[k].x * cw); x1 = Math.max(x1, kp[k].x * cw);
      y0 = Math.min(y0, kp[k].y * ch); y1 = Math.max(y1, kp[k].y * ch);
    }
    var bw = w - 24, bh = h - 54;
    var pw = Math.max(1, x1 - x0) * 1.15, ph = Math.max(1, y1 - y0) * 1.1;
    var sc = Math.min(bw / pw, bh / ph);
    var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    var cx = x + w / 2, cy = y + 12 + bh / 2;
    var mir = this.mirror ? -1 : 1;
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = '#7FD6FF';
    c.lineWidth = 5;
    for (var i = 0; i < BONES.length; i++) {
      var a = kp[BONES[i][0]], b = kp[BONES[i][1]];
      if (!a || !b || a.s < 0.3 || b.s < 0.3) continue;
      c.beginPath();
      c.moveTo(cx + (a.x * cw - mx) * sc * mir, cy + (a.y * ch - my) * sc);
      c.lineTo(cx + (b.x * cw - mx) * sc * mir, cy + (b.y * ch - my) * sc);
      c.stroke();
    }
    c.restore();
  } else {
    outlinedText(c, s.mode === 'none' || s.mode === 'error' ? '—' : '?', x + w / 2, y + h / 2 + 8, 44, 'rgba(247,245,239,0.6)', 'center');
  }
  outlinedText(c, statusText(s), x + w / 2, y + h - 14, 20, s.seeing ? '#7FD6FF' : 'rgba(247,245,239,0.8)', 'center', BODY_FONT);
};

VideoDanceMode.prototype._drawBar = function (c, vs, tn) {
  var y = BAR_Y;
  this._drawCoachBox(c, 16, y, 150, 177);
  // 标题、进度
  var x0 = 182, x1 = 1096;
  c.fillStyle = 'rgba(10,18,36,0.8)';
  roundRect(c, x0, y, x1 - x0, 177, 18);
  c.fill();
  var name = this.entry.title + (this.entry.p > 1 ? '（第 ' + this.entry.p + ' 集）' : '');
  c.font = '28px ' + BODY_FONT;
  c.fillStyle = '#F7F5EF';
  c.textAlign = 'left';
  var maxW = x1 - x0 - 230;
  while (name.length > 2 && c.measureText(name).width > maxW) name = name.slice(0, -2) + '…';
  c.fillText(name, x0 + 20, y + 40);
  var tm = fmtDur(vs.t) + (vs.dur > 0 ? ' / ' + fmtDur(vs.dur) : '');
  c.textAlign = 'right';
  c.fillStyle = 'rgba(247,245,239,0.85)';
  c.fillText(tm, x1 - 20, y + 40);
  c.textAlign = 'left';
  var px = x0 + 20, pw = x1 - x0 - 40;
  roundRect(c, px, y + 54, pw, 12, 6);
  c.fillStyle = 'rgba(247,245,239,0.18)';
  c.fill();
  if (vs.dur > 0) {
    roundRect(c, px, y + 54, Math.max(12, pw * clamp(vs.t / vs.dur, 0, 1)), 12, 6);
    c.fillStyle = '#FFC928';
    c.fill();
  }
  // 评级和提示
  var g = this.lastGrade;
  if (this.phase === 'play' || this.phase === 'result') {
    if (g) {
      outlinedText(c, g.grade.text + (g.grade.id === 'miss' ? '' : '！'), x0 + 20, y + 128, 52, g.grade.color, 'left');
      var tip = this.lastTip && tn - this.lastTip.at < 6000 ? this.lastTip.text : (g.kind === 'move' ? '看不清老师，按你动得多不多打分' : '');
      if (tip) outlinedText(c, tip, x0 + 190, y + 122, 30, '#F7F5EF', 'left', BODY_FONT);
    } else {
      outlinedText(c, '跟着老师跳，每 2 秒评一次', x0 + 20, y + 122, 30, '#F7F5EF', 'left', BODY_FONT);
    }
    // 最近的评级：一排小圆点
    var hist = this.judge ? this.judge.history : [];
    var n = Math.min(hist.length, 34);
    for (var i = 0; i < n; i++) {
      var hgr = hist[hist.length - n + i];
      c.fillStyle = gradeColor(hgr.g);
      c.beginPath();
      c.arc(x0 + 30 + i * 25, y + 158, 8, 0, Math.PI * 2);
      c.fill();
    }
  } else if (this.phase === 'load') {
    var sub = this.readyAt ? '视频准备好了，站好就开始（按确定直接开始）' : '正在打开视频…';
    outlinedText(c, sub, x0 + 20, y + 122, 30, '#F7F5EF', 'left', BODY_FONT);
  }
  // 得分
  var s0 = 1112;
  c.fillStyle = 'rgba(10,18,36,0.8)';
  roundRect(c, s0, y, W - 16 - s0, 177, 18);
  c.fill();
  var j = this.judge;
  outlinedText(c, '得分', s0 + (W - 16 - s0) / 2, y + 36, 24, 'rgba(247,245,239,0.85)', 'center', BODY_FONT);
  outlinedText(c, String(j ? j.points : 0), s0 + (W - 16 - s0) / 2, y + 108, 60, '#F7F5EF', 'center');
  if (j && j.combo >= 3) outlinedText(c, '连续 ' + j.combo, s0 + (W - 16 - s0) / 2, y + 152, 26, '#FFC928', 'center', BODY_FONT);
};

function gradeColor(id) {
  for (var i = 0; i < GRADES.length; i++) if (GRADES[i].id === id) return id === 'miss' ? 'rgba(247,245,239,0.35)' : GRADES[i].color;
  return '#F7F5EF';
}

VideoDanceMode.prototype._perf = function () {
  var s = this.coach ? this.coach.status() : {};
  var tm = this.judge ? this.judge.timing() : null;
  return this.env.perfText() + '｜老师：' + (s.mode || '') + ' ' + (s.frames || 0) + ' 帧' + (s.why ? '（' + s.why + '）' : '') +
    (tm ? '｜慢 ' + tm.lag + ' 秒' + (tm.mirror ? '，照镜子' : '') : '');
};

// ---------- 结算 ----------
function countsText(cn) {
  return '完美 ' + (cn.perfect || 0) + '　很棒 ' + (cn.great || 0) + '　不错 ' + (cn.good || 0) + '　加油 ' + (cn.miss || 0);
}

VideoDanceMode.prototype.resultHTML = function (rec, newBest, best) {
  var lines = [];
  lines.push(countsText(rec.counts) + (rec.maxCombo ? '，最多连续 ' + rec.maxCombo + ' 次' : ''));
  var how = rec.graded ? (rec.aiBlocks >= rec.moveBlocks ? 'AI 看着视频里的老师打的分' : '看不清视频里的老师，按动得多不多打的分' + (rec.coachWhy ? '（' + esc(rec.coachWhy) + '）' : '')) : '还没跳够，先多跳一会儿';
  lines.push('跳了 ' + fmtDur(rec.activeSec) + '，' + how);
  if (rec.lag != null && rec.aiBlocks >= 3) {
    var lagText = rec.lag <= 0.2 ? '和老师几乎同时做' : (rec.lag <= 0.8 ? '比老师慢 ' + rec.lag + ' 秒，跟得很紧' : '比老师慢 ' + rec.lag + ' 秒，可以再跟紧一点');
    lines.push(lagText + (rec.mirror ? '，是照镜子跳的' : ''));
  }
  if (rec.tip) lines.push('最该注意：' + rec.tip + (rec.tipN > 1 ? '（' + rec.tipN + ' 次）' : ''));
  else if (rec.stars >= 3) lines.push('跳得太棒了！');
  if (best) lines.push('这个视频最好成绩 ' + best + ' 分');
  return '<h2>跟着视频跳</h2><div class="vd-res-title">' + esc(rec.title) + (catName(rec.cat) ? '<small>' + catName(rec.cat) + '</small>' : '') + '</div>' +
    '<div class="big">' + rec.score + '<small>分</small>' + (newBest ? '<span class="new">新纪录</span>' : '') + '</div>' +
    '<div class="stars">' + starText(rec.stars) + '</div>' +
    '<div class="lines">' + lines.join('<br>') + '</div>';
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
}

VideoDanceMode.prototype.dispose = function () {
  // 切到后台再回来时，从刚才的地方接着放（往回 3 秒）
  if ((this.phase === 'play' || this.phase === 'count') && this.source) {
    var t = this.source.state().t;
    if (t > 5) this.params.resumeAt = Math.max(0, t - 3);
  }
  if (this.coach) this.coach.stop();
  if (this.source) this.source.close();
  this.coach = null;
  this.source = null;
  this.host.classList.remove('show');
  this.host.classList.remove('native');
  this.host.innerHTML = '';
  this.env.stage.setViewport(null);
  window.__tdMockHint = null;
};
