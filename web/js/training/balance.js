// 金鸡独立 · 画面与流程：全身站位 → 左脚站一轮 → 右脚站一轮 → 对比结算
import { BalanceJudge, BALANCE_AGE, REASON_TEXT, sideName } from './balance-logic.js';
import { W, H, roundRect, outlinedText, BODY_FONT } from '../core/stage.js';
import { drawSkeleton, COLORS } from '../core/skeleton.js';
import { toPixels } from '../core/keypoints.js';
import { SpaceGate } from '../core/space.js';
import { HandsUp } from '../core/gestures.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, qs, fmtSec, clamp } from '../core/util.js';

var INTRO_MS = 2600;
var BETWEEN_MS = 3200;

export function BalanceMode(env) {
  this.env = env;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.cfg = BALANCE_AGE[this.age];
  this.targetMs = (Number(qs('target')) || 0) * 1000 || this.cfg.targetMs;
  this.gate = new SpaceGate(900);
  this.handsUp = new HandsUp(1500);
  this.reset();
}

BalanceMode.prototype.title = '金鸡独立';
BalanceMode.prototype.fit = 'contain';

BalanceMode.prototype.reset = function () {
  this.phase = 'space';
  this.space = null;
  this.pose = null;
  this.legs = ['left', 'right'];
  this.legIdx = 0;
  this.judge = null;
  this.state = null;
  this.results = [];
  this.phaseStart = 0;
  this.lastSec = -1;
  this.paused = false;
  this.handsProgress = 0;
};

BalanceMode.prototype.begin = function () {
  this.reset();
  this.gate.reset();
  speak('站到离电视两到三米的地方，让全身出现在画面里');
};

BalanceMode.prototype.restart = function () {
  var keep = this.pose;
  this.reset();
  this.pose = keep;
  this.handsUp.reset();
  this._intro(now());
};

BalanceMode.prototype.pause = function (v) { this.paused = !!v; };

BalanceMode.prototype._stand = function () { return this.legs[this.legIdx]; };

BalanceMode.prototype._intro = function (t) {
  var stand = this._stand();
  var lift = stand === 'left' ? 'right' : 'left';
  this.phase = 'intro';
  this.phaseStart = t;
  this.judge = null;
  this.state = null;
  speak('第' + (this.legIdx + 1) + '轮，用' + sideName(stand) + '脚站稳，把' + sideName(lift) + '边膝盖抬到腰那么高');
};

BalanceMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  this.pose = frame.kp ? st.mapKp(frame.kp) : null;
  if (this.phase === 'space') {
    this.space = this.gate.update(frame.kp, 'full', st.mirror, frame.t);
  } else if (this.phase === 'judge' && this.judge && !this.paused) {
    var before = this.judge.phase;
    this.state = this.judge.update(frame.kp ? toPixels(frame.kp, frame.w, frame.h) : null, frame.t);
    if (before === 'ready' && this.state.phase === 'hold') {
      sfx.go();
      speak('很好，坚持住');
    }
    if (this.state.phase === 'done') this._legDone(this.state.result);
  } else if (this.phase === 'result' && frame.kp) {
    var h = this.handsUp.update(frame.kp, frame.t);
    this.handsProgress = h.progress;
    if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
  }
};

BalanceMode.prototype._legDone = function (r) {
  this.results.push(r);
  if (r.reason === 'target') sfx.success();
  else sfx.fail();
  speak(sideName(r.stand) + '脚站了' + fmtSec(r.holdMs) + '秒');
  this.phase = 'between';
  this.phaseStart = now();
};

BalanceMode.prototype._colorFor = function () {
  var self = this;
  var m = this.state && this.state.metrics;
  var stand = this.judge ? this.judge.stand : null;
  var lift = this.judge ? this.judge.lift : null;
  var sway = Math.abs(this.state ? this.state.sway : 0);
  return function (a, b) {
    if (!m || !stand) return COLORS.plain;
    var key = a + '|' + b;
    if (key === stand + '_hip|' + stand + '_knee' || key === stand + '_knee|' + stand + '_ankle') {
      return m.standStraight ? COLORS.good : COLORS.warn;
    }
    if (key === lift + '_hip|' + lift + '_knee' || key === lift + '_knee|' + lift + '_ankle') {
      if (m.footDown) return COLORS.bad;
      return m.liftOk ? COLORS.good : COLORS.warn;
    }
    if (a.indexOf('hip') > 0 || b.indexOf('hip') > 0) {
      if (sway < self.cfg.swayGood * 1.5) return COLORS.good;
      return sway < 0.45 ? COLORS.warn : COLORS.bad;
    }
    return COLORS.plain;
  };
};

// 右下角示范小人：和镜子里的孩子同一侧抬腿
BalanceMode.prototype._drawDemo = function (t) {
  var c = this.env.stage.ctx;
  var stand = this._stand();
  var standLeft = (stand === 'left') === this.env.stage.mirror;
  var x0 = 1040, y0 = 380, w = 210, h = 300;
  roundRect(c, x0, y0, w, h, 24);
  c.fillStyle = 'rgba(10,18,36,0.72)';
  c.fill();
  outlinedText(c, '照着做', x0 + w / 2, y0 + 40, 28, '#FFC928', 'center');
  var cx = x0 + w / 2, top = y0 + 64;
  var bob = Math.sin(t / 400) * 3;
  c.strokeStyle = '#F7F5EF';
  c.lineWidth = 8;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.arc(cx, top + 16 + bob, 16, 0, Math.PI * 2);
  c.stroke();
  var hipY = top + 108 + bob, shY = top + 44 + bob;
  var sd = standLeft ? -1 : 1; // 支撑腿在屏幕哪一侧
  c.beginPath();
  c.moveTo(cx, shY); c.lineTo(cx, hipY);
  c.moveTo(cx - 52, shY + 10); c.lineTo(cx + 52, shY + 10);
  c.moveTo(cx + sd * 12, hipY); c.lineTo(cx + sd * 14, top + 214);
  c.stroke();
  c.strokeStyle = '#3FBF6A';
  c.beginPath();
  c.moveTo(cx - sd * 12, hipY);
  c.lineTo(cx - sd * 40, hipY - 4);
  c.lineTo(cx - sd * 36, hipY + 52);
  c.stroke();
  c.fillStyle = '#FFC928';
  c.beginPath();
  c.arc(cx - sd * 40, hipY - 4, 9, 0, Math.PI * 2);
  c.fill();
  outlinedText(c, '膝盖到腰高', cx, y0 + h - 18, 24, '#F7F5EF', 'center', BODY_FONT);
};

BalanceMode.prototype._drawBanner = function (msg, color) {
  var c = this.env.stage.ctx;
  roundRect(c, 180, 30, 920, 90, 45);
  c.fillStyle = 'rgba(10,18,36,0.78)';
  c.fill();
  outlinedText(c, msg, 640, 92, 46, color || '#F7F5EF', 'center');
};

BalanceMode.prototype._drawTimer = function () {
  var c = this.env.stage.ctx;
  var s = this.state;
  var hold = s ? s.holdMs : 0;
  var target = this.judge.targetMs;
  outlinedText(c, fmtSec(hold), 640, 262, 130, s && s.phase === 'hold' ? '#FFC928' : '#F7F5EF', 'center');
  outlinedText(c, '秒', 640 + 30 + c.measureText(fmtSec(hold)).width / 2, 262, 44, '#F7F5EF', 'left');
  var f = clamp(hold / target, 0, 1);
  roundRect(c, 440, 288, 400, 18, 9);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  if (f > 0) {
    roundRect(c, 440, 288, Math.max(18, 400 * f), 18, 9);
    c.fillStyle = '#3FBF6A';
    c.fill();
  }
  outlinedText(c, '目标 ' + Math.round(target / 1000) + ' 秒', 640, 340, 28, '#F7F5EF', 'center', BODY_FONT);
  outlinedText(c, '第 ' + (this.legIdx + 1) + ' 轮：' + sideName(this._stand()) + '脚站', 36, 172, 34, '#F7F5EF', 'left');
};

BalanceMode.prototype._drawSway = function () {
  var c = this.env.stage.ctx;
  var v = this.state ? this.state.sway : 0;
  var cx = 640, y = 662, half = 260, scale = 400;
  var good = this.cfg.swayGood * 1.5 * scale;
  roundRect(c, cx - half, y - 14, half * 2, 28, 14);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  roundRect(c, cx - good, y - 14, good * 2, 28, 14);
  c.fillStyle = 'rgba(63,191,106,0.45)';
  c.fill();
  var dx = clamp(v * scale * (this.env.stage.mirror ? -1 : 1), -half, half);
  var a = Math.abs(v);
  c.fillStyle = a < this.cfg.swayGood * 1.5 ? '#3FBF6A' : (a < 0.45 ? '#FFC928' : '#E5484D');
  c.beginPath();
  c.arc(cx + dx, y, 18, 0, Math.PI * 2);
  c.fill();
  outlinedText(c, '晃动', cx - half - 18, y + 10, 28, '#F7F5EF', 'right', BODY_FONT);
};

BalanceMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  if (this.env.mock) st.drawMockBackground();
  else st.drawVideo(this.env.video, 0.1);
  if (this.pose && this.env.settings.skeleton) {
    drawSkeleton(c, this.pose, { width: 9, colorFor: this.phase === 'judge' ? this._colorFor() : null });
  }
  if (this.phase === 'space') {
    var sp = this.space;
    this._drawBanner(sp ? sp.msg : '请站到电视正前方，让摄像头看到你', sp && sp.ok ? '#FFC928' : '#F7F5EF');
    if (sp && sp.ok) {
      roundRect(c, 340, 104, 600 * sp.progress, 10, 5);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
    outlinedText(c, '金鸡独立要看到全身：头和脚都在画面里', 640, 690, 28, '#F7F5EF', 'center', BODY_FONT);
    if (sp && sp.passed) this._intro(t);
  } else if (this.phase === 'intro') {
    var stand = this._stand(), lift = stand === 'left' ? 'right' : 'left';
    this._drawBanner('第 ' + (this.legIdx + 1) + ' 轮：用' + sideName(stand) + '脚站', '#FFC928');
    outlinedText(c, '把' + sideName(lift) + '边膝盖抬到腰那么高', 640, 330, 56, '#F7F5EF', 'center');
    this._drawDemo(t);
    if (t - this.phaseStart >= INTRO_MS) {
      this.phase = 'judge';
      this.judge = new BalanceJudge({ stand: stand, age: this.age, targetMs: this.targetMs });
      this.lastSec = -1;
    }
  } else if (this.phase === 'judge') {
    var s = this.state;
    this._drawBanner(s ? s.msg : '准备', s && s.phase === 'hold' ? '#3FBF6A' : '#F7F5EF');
    this._drawTimer();
    this._drawSway();
    this._drawDemo(t);
    if (s && s.phase === 'hold' && !this.paused) {
      this.env.onActive(Math.min(dt, 100));
      var sec = Math.floor(s.holdMs / 1000);
      if (sec !== this.lastSec && sec > 0 && sec % 5 === 0) sfx.tick();
      this.lastSec = sec;
    }
  } else if (this.phase === 'between') {
    var r = this.results[this.results.length - 1];
    this._drawBanner(sideName(r.stand) + '脚站了 ' + fmtSec(r.holdMs) + ' 秒', '#FFC928');
    outlinedText(c, REASON_TEXT[r.reason] || '', 640, 250, 44, '#F7F5EF', 'center');
    var stars = '';
    for (var i = 0; i < 3; i++) stars += i < r.stars ? '★' : '☆';
    outlinedText(c, stars, 640, 380, 110, '#FFC928', 'center', BODY_FONT);
    if (this.legIdx < this.legs.length - 1) outlinedText(c, '休息一下，马上换另一只脚', 640, 470, 40, '#F7F5EF', 'center');
    if (now() - this.phaseStart >= BETWEEN_MS) {
      if (this.legIdx < this.legs.length - 1) {
        this.legIdx += 1;
        this._intro(t);
      } else {
        this._end();
      }
    }
  } else if (this.phase === 'result') {
    roundRect(c, 440, 662, 400, 16, 8);
    c.fillStyle = 'rgba(10,18,36,0.7)';
    c.fill();
    if (this.handsProgress > 0) {
      roundRect(c, 440, 662, 400 * this.handsProgress, 16, 8);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
  }
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

BalanceMode.prototype._end = function () {
  this.phase = 'result';
  this.handsUp.reset();
  this.env.finish({ type: 'balance', age: this.age, legs: this.results });
};

function starText(n) {
  var s = '';
  for (var i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s;
}

BalanceMode.prototype.resultHTML = function (rec, newBest, best) {
  var cards = '';
  for (var i = 0; i < rec.legs.length; i++) {
    var l = rec.legs[i];
    cards += '<div class="leg-card"><div class="t">' + sideName(l.stand) + '脚站（' + (REASON_TEXT[l.reason] || '') + '）' +
      (l.newBest ? '<span class="new">新纪录</span>' : '') + '</div>' +
      '<div class="n">' + fmtSec(l.holdMs) + '<small>秒</small></div>' +
      '<div class="stars">' + starText(l.stars) + '</div>' +
      '<canvas width="440" height="90" data-leg="' + i + '"></canvas></div>';
  }
  var advice = '';
  if (rec.legs.length === 2) {
    var a = rec.legs[0], b = rec.legs[1];
    var hi = Math.max(a.holdMs, b.holdMs), lo = Math.min(a.holdMs, b.holdMs);
    if (hi > 0 && (hi - lo) / hi > 0.3) {
      var weak = a.holdMs < b.holdMs ? a.stand : b.stand;
      advice = sideName(weak) + '脚站的时间短一些，平时可以多练' + sideName(weak) + '腿。';
    } else {
      advice = '两条腿差不多稳，继续保持。';
    }
  }
  return '<h2>金鸡独立</h2><div class="legs">' + cards + '</div>' +
    '<div class="lines">' + advice + '<br>最好成绩：左脚 ' + fmtSec(best.left || 0) + ' 秒，右脚 ' + fmtSec(best.right || 0) + ' 秒。小图是站立时身体左右晃动的幅度。</div>';
};

// 结算页的小晃动曲线
BalanceMode.prototype.afterResult = function (box, rec) {
  var cs = box.querySelectorAll('canvas[data-leg]');
  for (var i = 0; i < cs.length; i++) {
    var l = rec.legs[Number(cs[i].getAttribute('data-leg'))];
    var g = cs[i].getContext('2d');
    var w = cs[i].width, h = cs[i].height;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(247,245,239,0.3)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    var sr = l.series;
    if (!sr || sr.length < 2) continue;
    var tMax = sr[sr.length - 1].t || 1;
    g.strokeStyle = '#FFC928';
    g.lineWidth = 3;
    g.beginPath();
    for (var k = 0; k < sr.length; k++) {
      var x = sr[k].t / tMax * w;
      var y = h / 2 - clamp(sr[k].v, -0.5, 0.5) * h;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
};

BalanceMode.prototype.dispose = function () {};
