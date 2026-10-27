// 金鸡独立 · 双人：两个人一左一右同时单脚站。第 1 轮左脚站、第 2 轮右脚站，
// 每个人各自判定（和单人同样的口径），两个人都结束这一轮才进下一轮；两轮加起来比总时间。
import { BalanceJudge, BALANCE_AGE, REASON_TEXT, sideName } from './balance-logic.js';
import { W, H, roundRect, outlinedText, BODY_FONT } from '../core/stage.js';
import { drawSkeleton, COLORS } from '../core/skeleton.js';
import { toPixels } from '../core/keypoints.js';
import { SpaceGate } from '../core/space.js';
import { HandsUp } from '../core/gestures.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, qs, fmtSec, clamp } from '../core/util.js';
import { DUO, HALF, screenPlayers, winnerOf, winnerText } from '../games/duo.js';

var INTRO_MS = 2600;
var BETWEEN_MS = 3600;

export function BalanceDuoMode(env) {
  this.env = env;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.cfg = BALANCE_AGE[this.age];
  this.targetMs = (Number(qs('target')) || 0) * 1000 || this.cfg.targetMs;
  this.p = null;
  this.reset();
}

BalanceDuoMode.prototype.title = '金鸡独立 · 双人';
BalanceDuoMode.prototype.fit = 'contain';
BalanceDuoMode.prototype.players = 2;

BalanceDuoMode.prototype._player = function (i) {
  var old = this.p && this.p[i];
  return {
    i: i,
    d: DUO[i],
    gate: old ? old.gate : new SpaceGate(900),
    handsUp: old ? old.handsUp : new HandsUp(1500),
    space: null,
    pose: old ? old.pose : null,
    judge: null,
    state: null,
    results: [],
    lastSec: -1,
    handsProgress: 0
  };
};

BalanceDuoMode.prototype.reset = function () {
  this.phase = 'space';
  this.p = [this._player(0), this._player(1)];
  this.legs = ['left', 'right'];
  this.legIdx = 0;
  this.phaseStart = 0;
  this.paused = false;
};

BalanceDuoMode.prototype.begin = function () {
  this.reset();
  for (var i = 0; i < 2; i++) {
    this.p[i].gate.reset();
    this.p[i].pose = null;
  }
  speak('两个人一左一右，站到离电视两到三米的地方，让全身出现在画面里');
};

BalanceDuoMode.prototype.restart = function () {
  this.reset();
  for (var i = 0; i < 2; i++) this.p[i].handsUp.reset();
  this._intro(now());
};

BalanceDuoMode.prototype.pause = function (v) { this.paused = !!v; };

BalanceDuoMode.prototype._stand = function () { return this.legs[this.legIdx]; };

BalanceDuoMode.prototype._intro = function (t) {
  var stand = this._stand();
  var lift = stand === 'left' ? 'right' : 'left';
  this.phase = 'intro';
  this.phaseStart = t;
  for (var i = 0; i < 2; i++) {
    this.p[i].judge = null;
    this.p[i].state = null;
    this.p[i].lastSec = -1;
  }
  speak('第' + (this.legIdx + 1) + '轮，两个人都用' + sideName(stand) + '脚站稳，把' + sideName(lift) + '边膝盖抬到腰那么高');
};

BalanceDuoMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  var kps = screenPlayers(frame, st.mirror);
  for (var i = 0; i < 2; i++) {
    var P = this.p[i], kp = kps[i];
    P.pose = kp ? st.mapKp(kp) : null;
    if (this.phase === 'space') {
      P.space = P.gate.update(kp, 'full', st.mirror, frame.t, P.d.region);
    } else if (this.phase === 'judge' && P.judge && P.judge.phase !== 'done' && !this.paused) {
      var before = P.judge.phase;
      P.state = P.judge.update(kp ? toPixels(kp, frame.w, frame.h) : null, frame.t);
      if (before === 'ready' && P.state.phase === 'hold') sfx.go();
      if (P.state.phase === 'done') this._playerDone(P);
    } else if (this.phase === 'result' && kp) {
      var h = P.handsUp.update(kp, frame.t);
      P.handsProgress = h.progress;
      if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
    }
  }
};

BalanceDuoMode.prototype._playerDone = function (P) {
  var r = P.state.result;
  P.results.push(r);
  if (r.reason === 'target') sfx.success();
  else sfx.fail();
  var a = this.p[0], b = this.p[1];
  if (a.results.length > this.legIdx && b.results.length > this.legIdx) {
    // 两个人这一轮都结束了
    var ra = a.results[this.legIdx], rb = b.results[this.legIdx];
    var w = winnerOf(ra.holdMs, rb.holdMs);
    speak(w === 'tie' ? '这一轮两个人一样久' : '这一轮' + (w === 'left' ? '左边' : '右边') + '站得久');
    this.phase = 'between';
    this.phaseStart = now();
  }
};

// 骨架颜色：绿 = 到位，黄 = 接近，红 = 偏差大（同单人）
BalanceDuoMode.prototype._colorFor = function (P) {
  var self = this;
  var m = P.state && P.state.metrics;
  var stand = P.judge ? P.judge.stand : null;
  var lift = P.judge ? P.judge.lift : null;
  var sway = Math.abs(P.state ? P.state.sway : 0);
  return function (a, b) {
    if (!m || !stand) return P.d.color;
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
    return P.d.color;
  };
};

BalanceDuoMode.prototype._drawDivider = function () {
  var c = this.env.stage.ctx;
  c.save();
  c.strokeStyle = 'rgba(247,245,239,0.55)';
  c.lineWidth = 4;
  if (c.setLineDash) c.setLineDash([18, 14]);
  c.beginPath();
  c.moveTo(HALF, 140);
  c.lineTo(HALF, H);
  c.stroke();
  c.restore();
};

// 半边顶上的横幅；timer 有值时提示放左边、秒数放右边（不挡住孩子的头）
BalanceDuoMode.prototype._banner = function (P, msg, color, timer, timerColor) {
  var c = this.env.stage.ctx;
  var cx = P.d.x0 + HALF / 2;
  roundRect(c, P.d.x0 + 24, 30, HALF - 48, 84, 36);
  c.fillStyle = 'rgba(10,18,36,0.78)';
  c.fill();
  if (timer) {
    outlinedText(c, msg, P.d.x0 + 54, 86, msg.length > 12 ? 24 : 30, color || '#F7F5EF', 'left');
    outlinedText(c, timer, P.d.x0 + HALF - 54, 94, 62, timerColor || '#F7F5EF', 'right');
  } else {
    outlinedText(c, msg, cx, 84, 34, color || '#F7F5EF', 'center');
    // 站位时标上「左边 / 右边」；单脚站时不标，免得挡住头（骨架颜色已经分得出）
    outlinedText(c, P.d.name, cx, 150, 26, P.d.color, 'center');
  }
};

// 整屏的横幅（引导语）
BalanceDuoMode.prototype._wideBanner = function (msg, color) {
  var c = this.env.stage.ctx;
  roundRect(c, 180, 30, 920, 90, 45);
  c.fillStyle = 'rgba(10,18,36,0.78)';
  c.fill();
  outlinedText(c, msg, W / 2, 92, 46, color || '#F7F5EF', 'center');
};

// 横幅下面的进度条：站了多久 / 目标
BalanceDuoMode.prototype._progress = function (P) {
  var c = this.env.stage.ctx;
  var s = P.state;
  var f = clamp((s ? s.holdMs : 0) / this.targetMs, 0, 1);
  var x = P.d.x0 + 60, w = HALF - 120;
  roundRect(c, x, 120, w, 10, 5);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  if (f > 0) {
    roundRect(c, x, 120, Math.max(10, w * f), 10, 5);
    c.fillStyle = '#3FBF6A';
    c.fill();
  }
};

BalanceDuoMode.prototype._sway = function (P) {
  var c = this.env.stage.ctx;
  var v = P.state ? P.state.sway : 0;
  var cx = P.d.x0 + HALF / 2, y = 664, half = 200, scale = 320;
  var good = this.cfg.swayGood * 1.5 * scale;
  roundRect(c, cx - half, y - 12, half * 2, 24, 12);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  roundRect(c, cx - good, y - 12, good * 2, 24, 12);
  c.fillStyle = 'rgba(63,191,106,0.45)';
  c.fill();
  var dx = clamp(v * scale * (this.env.stage.mirror ? -1 : 1), -half, half);
  var a = Math.abs(v);
  c.fillStyle = a < this.cfg.swayGood * 1.5 ? '#3FBF6A' : (a < 0.45 ? '#FFC928' : '#E5484D');
  c.beginPath();
  c.arc(cx + dx, y, 15, 0, Math.PI * 2);
  c.fill();
};

// 中间的示范小人：和镜子里的孩子同一侧抬腿
BalanceDuoMode.prototype._demo = function (t) {
  var c = this.env.stage.ctx;
  var stand = this._stand();
  var standLeft = (stand === 'left') === this.env.stage.mirror;
  var w = 190, h = 270, x0 = W / 2 - w / 2, y0 = 390;
  roundRect(c, x0, y0, w, h, 24);
  c.fillStyle = 'rgba(10,18,36,0.8)';
  c.fill();
  outlinedText(c, '照着做', x0 + w / 2, y0 + 38, 26, '#FFC928', 'center');
  var cx = x0 + w / 2, top = y0 + 56;
  var bob = Math.sin(t / 400) * 3;
  c.strokeStyle = '#F7F5EF';
  c.lineWidth = 7;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.arc(cx, top + 14 + bob, 14, 0, Math.PI * 2);
  c.stroke();
  var hipY = top + 96 + bob, shY = top + 40 + bob;
  var sd = standLeft ? -1 : 1;
  c.beginPath();
  c.moveTo(cx, shY); c.lineTo(cx, hipY);
  c.moveTo(cx - 46, shY + 9); c.lineTo(cx + 46, shY + 9);
  c.moveTo(cx + sd * 11, hipY); c.lineTo(cx + sd * 13, top + 190);
  c.stroke();
  c.strokeStyle = '#3FBF6A';
  c.beginPath();
  c.moveTo(cx - sd * 11, hipY);
  c.lineTo(cx - sd * 36, hipY - 4);
  c.lineTo(cx - sd * 32, hipY + 46);
  c.stroke();
  c.fillStyle = '#FFC928';
  c.beginPath();
  c.arc(cx - sd * 36, hipY - 4, 8, 0, Math.PI * 2);
  c.fill();
};

BalanceDuoMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  if (this.env.mock) st.drawMockBackground();
  else st.drawVideo(this.env.video, 0.1);
  this._drawDivider();
  for (var i = 0; i < 2; i++) {
    var P = this.p[i];
    if (P.pose && this.env.settings.skeleton) {
      drawSkeleton(c, P.pose, { width: 8, color: P.d.color, colorFor: this.phase === 'judge' ? this._colorFor(P) : null });
    }
  }
  var stand = this._stand(), lift = stand === 'left' ? 'right' : 'left';
  if (this.phase === 'space') {
    for (var k = 0; k < 2; k++) {
      var sp = this.p[k].space;
      var msg = sp && sp.passed ? '准备好了' : (sp ? sp.msg : '站到这半边来');
      this._banner(this.p[k], msg, sp && sp.ok ? '#FFC928' : '#F7F5EF');
      if (sp && sp.ok) {
        roundRect(c, this.p[k].d.x0 + 80, 118, (HALF - 160) * sp.progress, 8, 4);
        c.fillStyle = '#3FBF6A';
        c.fill();
      }
    }
    outlinedText(c, '金鸡独立要看到全身：两个人一左一右，头和脚都在画面里', W / 2, 700, 26, '#F7F5EF', 'center', BODY_FONT);
    if (this.p[0].space && this.p[0].space.passed && this.p[1].space && this.p[1].space.passed) this._intro(t);
  } else if (this.phase === 'intro') {
    this._wideBanner('第 ' + (this.legIdx + 1) + ' 轮：两个人都用' + sideName(stand) + '脚站', '#FFC928');
    outlinedText(c, '把' + sideName(lift) + '边膝盖抬到腰那么高', W / 2, 300, 50, '#F7F5EF', 'center');
    this._demo(t);
    if (t - this.phaseStart >= INTRO_MS) {
      this.phase = 'judge';
      for (var j = 0; j < 2; j++) {
        this.p[j].judge = new BalanceJudge({ stand: stand, age: this.age, targetMs: this.targetMs });
        this.p[j].state = null;
      }
    }
  } else if (this.phase === 'judge') {
    var anyHold = false;
    for (var m = 0; m < 2; m++) {
      var Q = this.p[m], s = Q.state;
      var done = s && s.phase === 'done';
      if (done) {
        this._banner(Q, (REASON_TEXT[s.result.reason] || '这一轮结束') + '，等另一边', '#F7F5EF', fmtSec(s.result.holdMs) + ' 秒', '#FFC928');
      } else {
        this._banner(Q, s ? s.msg : '准备', s && s.phase === 'hold' ? '#3FBF6A' : '#F7F5EF', fmtSec(s ? s.holdMs : 0), s && s.phase === 'hold' ? '#FFC928' : '#F7F5EF');
        this._sway(Q);
      }
      this._progress(Q);
      if (s && s.phase === 'hold' && !this.paused) {
        anyHold = true;
        var sec = Math.floor(s.holdMs / 1000);
        if (sec !== Q.lastSec && sec > 0 && sec % 5 === 0) sfx.tick();
        Q.lastSec = sec;
      }
    }
    if (anyHold && !this.paused) this.env.onActive(Math.min(dt, 100));
    outlinedText(c, '第 ' + (this.legIdx + 1) + ' 轮：' + sideName(stand) + '脚站 · 目标 ' + Math.round(this.targetMs / 1000) + ' 秒', W / 2, 708, 26, '#F7F5EF', 'center', BODY_FONT);
  } else if (this.phase === 'between') {
    var ra = this.p[0].results[this.legIdx], rb = this.p[1].results[this.legIdx];
    var w = winnerOf(ra.holdMs, rb.holdMs);
    this._wideBanner(w === 'tie' ? '这一轮一样久' : '这一轮' + (w === 'left' ? '左边' : '右边') + '站得久', '#FFC928');
    for (var q = 0; q < 2; q++) {
      var R = this.p[q].results[this.legIdx];
      var cx = this.p[q].d.x0 + HALF / 2;
      outlinedText(c, this.p[q].d.name, cx, 200, 36, this.p[q].d.color, 'center');
      outlinedText(c, fmtSec(R.holdMs) + ' 秒', cx, 300, 88, '#F7F5EF', 'center');
      outlinedText(c, REASON_TEXT[R.reason] || '', cx, 356, 30, '#F7F5EF', 'center', BODY_FONT);
      var stars = '';
      for (var z = 0; z < 3; z++) stars += z < R.stars ? '★' : '☆';
      outlinedText(c, stars, cx, 450, 80, '#FFC928', 'center', BODY_FONT);
    }
    if (this.legIdx < this.legs.length - 1) outlinedText(c, '休息一下，马上换另一只脚', W / 2, 560, 38, '#F7F5EF', 'center');
    if (now() - this.phaseStart >= BETWEEN_MS) {
      if (this.legIdx < this.legs.length - 1) {
        this.legIdx += 1;
        this._intro(t);
      } else {
        this._end();
      }
    }
  } else if (this.phase === 'result') {
    var hp = Math.max(this.p[0].handsProgress, this.p[1].handsProgress);
    roundRect(c, 440, 662, 400, 16, 8);
    c.fillStyle = 'rgba(10,18,36,0.7)';
    c.fill();
    if (hp > 0) {
      roundRect(c, 440, 662, 400 * hp, 16, 8);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
  }
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

function total(results) {
  var s = 0;
  for (var i = 0; i < results.length; i++) s += results[i].holdMs;
  return s;
}

BalanceDuoMode.prototype._end = function () {
  this.phase = 'result';
  for (var i = 0; i < 2; i++) this.p[i].handsUp.reset();
  var totals = [total(this.p[0].results), total(this.p[1].results)];
  var winner = winnerOf(totals[0], totals[1]);
  speak(winnerText(winner));
  this.env.finish({
    type: 'balance',
    players: 2,
    age: this.age,
    sides: [this.p[0].results, this.p[1].results],
    totals: totals,
    winner: winner
  });
};

function starText(n) {
  var s = '';
  for (var i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s;
}

BalanceDuoMode.prototype.resultHTML = function (rec) {
  var cols = '';
  for (var i = 0; i < 2; i++) {
    var d = DUO[i];
    var win = rec.winner === d.side;
    var legs = '';
    var rs = rec.sides[i];
    for (var j = 0; j < rs.length; j++) {
      legs += sideName(rs[j].stand) + '脚 ' + fmtSec(rs[j].holdMs) + ' 秒 <span class="stars">' + starText(rs[j].stars) + '</span><br>';
    }
    cols += '<div class="duo-p' + (win ? ' win' : '') + '">' +
      '<div class="who" style="color:' + d.color + '">' + d.name + (win ? '<span class="new">赢了</span>' : '') + '</div>' +
      '<div class="big">' + fmtSec(rec.totals[i]) + '<small>秒</small></div>' +
      '<div class="lines">' + legs + '</div></div>';
  }
  return '<h2>金鸡独立 · 双人</h2><div class="duo">' + cols + '</div><div class="lines winner">' + winnerText(rec.winner) + '（两轮加起来比总时间）</div>';
};

BalanceDuoMode.prototype.dispose = function () {};
