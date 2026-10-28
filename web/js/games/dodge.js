// 左右闪避 / 太空躲障碍 · 画面与流程：站位 → 站好别动（记下中间道的位置）→ 学一下怎么躲 → 倒计时 → 玩 → 结算。
// 画面上是一条三道的跑道（太空版是隧道），孩子的骨架小人站在跑道最前面，跟着孩子左右换道、下蹲、起跳。
import { DodgeWorld, DODGE_AGE, LaneTracker } from './dodge-logic.js';
import { makeSlots, framePlayers, drawSpace, drawCount, drawDivider, drawHandsUp, drawTimer, Pops, starText } from './arena.js';
import { W, H, roundRect, outlinedText, BODY_FONT } from '../core/stage.js';
import { BONES } from '../core/skeleton.js';
import { Baseline, thighRatio, has, LOWER } from '../core/body.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, qs, clamp, rng } from '../core/util.js';
import { winnerOf, winnerText } from './duo.js';

var CALIB_MS = 1200;
var LEARN_HOLD_MS = 250;
var LEARN_TIMEOUT = 9000;
var HORIZON = 168, GROUND = 690;

var LEARN = {
  side: [
    { msg: '往左边跨一大步', test: function (s) { return s.lane === 0; }, lane: 0 },
    { msg: '往右边跨一大步', test: function (s) { return s.lane === 2; }, lane: 2 },
    { msg: '回到中间', test: function (s) { return s.lane === 1; }, lane: 1 }
  ],
  space: [
    { msg: '往左边跨一大步', test: function (s) { return s.lane === 0; }, lane: 0 },
    { msg: '往右边跨一大步', test: function (s) { return s.lane === 2; }, lane: 2 },
    { msg: '回到中间', test: function (s) { return s.lane === 1; }, lane: 1 },
    { msg: '激光来了要蹲下：蹲一下试试', test: function (s) { return s.duck; } },
    { msg: '地上的能量栏要跳过去：跳一下试试', test: function (s) { return s.air; } }
  ]
};

// ---------- 透视：z = 1 最远（地平线），0 = 孩子站的地方，负数 = 已经过去 ----------
function persp(z) {
  var s = 1 / (1 + 4 * Math.max(-0.2, z)), s1 = 1 / 5;
  return (s - s1) / (1 - s1);
}

export function DodgeMode(env, variant, players) {
  this.env = env;
  this.variant = variant === 'space' ? 'space' : 'side';
  this.players = players === 2 ? 2 : 1;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.durationMs = (Number(qs('dur')) || 0) * 1000 || DODGE_AGE[this.age].durationMs;
  this.title = (this.variant === 'space' ? '太空躲障碍' : '左右闪避') + (this.players === 2 ? ' · 双人' : '');
  this.slots = makeSlots(this.players);
  this.pops = new Pops();
  this.stars = [];
  var r = rng(7);
  for (var i = 0; i < 90; i++) this.stars.push({ a: r() * Math.PI * 2, d: r(), v: 0.15 + r() * 0.5, s: 1 + r() * 2.5 });
  this.rocks = [];
  for (var k = 0; k < 6; k++) {
    var pts = [];
    for (var j = 0; j < 9; j++) pts.push(0.75 + r() * 0.35);
    this.rocks.push(pts);
  }
  this.learned = false;
  this.reset();
}

DodgeMode.prototype.fit = 'cover';

DodgeMode.prototype.reset = function () {
  this.phase = 'space';
  this.phaseStart = 0;
  this.count = { lastCount: -1 };
  this.paused = false;
  this.shake = 0;
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i];
    P.world = null;
    P.lanes = P.lanes || new LaneTracker();
    P.base = P.base || new Baseline();
    P.state = { lane: null, duck: false, air: false };
    P.calib = [];
    P.learnIdx = 0;
    P.learnSince = null;
    P.learnStart = 0;
    P.flash = 0;
    P.avX = null;
    P.handsProgress = 0;
    P.gate.reset();
    P.handsUp.reset();
  }
};

DodgeMode.prototype.begin = function () {
  this.reset();
  for (var i = 0; i < this.slots.length; i++) {
    this.slots[i].lanes = new LaneTracker();
    this.slots[i].base = new Baseline();
  }
  this.learned = false;
  speak(this.players === 2 ? '两个人一左一右站好，让全身出现在画面里' : '站到离电视两到三米的地方，让全身出现在画面里');
};

DodgeMode.prototype.restart = function () {
  this.reset();
  this._phase('calib', now());
};

DodgeMode.prototype.pause = function (v) { this.paused = !!v; };

DodgeMode.prototype._phase = function (name, t) {
  this.phase = name;
  this.phaseStart = t;
  var i;
  if (name === 'calib') {
    for (i = 0; i < this.slots.length; i++) this.slots[i].calib = [];
    speak('站在中间，别动');
  } else if (name === 'learn') {
    for (i = 0; i < this.slots.length; i++) {
      this.slots[i].learnIdx = 0;
      this.slots[i].learnSince = null;
      this.slots[i].learnStart = t;
    }
    speak(LEARN[this.variant][0].msg);
  } else if (name === 'count') {
    this.count = { lastCount: -1 };
  }
};

function hipX(pts) { return (pts.left_hip.x + pts.right_hip.x) / 2; }

DodgeMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  var kps = framePlayers(frame, st.mirror, this.players);
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i], kp = kps[i];
    P.kp = kp;
    P.pose = kp ? st.mapKp(kp) : null;
    if (this.phase === 'space') P.space = P.gate.update(kp, 'full', st.mirror, frame.t, P.region);
    if (this.phase === 'result' && kp) {
      var h = P.handsUp.update(kp, frame.t);
      P.handsProgress = h.progress;
      if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
    }
    var pts = P.pose;
    if (!pts || !has(pts, LOWER) || !has(pts, ['left_shoulder', 'right_shoulder'])) {
      P.state = { lane: null, duck: false, air: false };
      continue;
    }
    P.base.add(pts);
    var sw = Math.abs(pts.left_shoulder.x - pts.right_shoulder.x);
    if (this.phase === 'calib') {
      var ank = (pts.left_ankle.y + pts.right_ankle.y) / 2;
      var top = pts.nose && pts.nose.s >= 0.3 ? pts.nose.y : (pts.left_shoulder.y + pts.right_shoulder.y) / 2 - sw * 0.6;
      P.calib.push({ x: hipX(pts), sw: sw, ank: ank, h: ank - top });
    }
    var drop = P.base.drop(pts), rise = P.base.rise(pts);
    var depth = clamp((1 - (thighRatio(pts, 'left') + thighRatio(pts, 'right')) / 2) / 0.7, 0, 1);
    P.state = {
      lane: P.lanes.ready() ? P.lanes.update(hipX(pts)) : null,
      duck: (drop != null && drop >= 0.14) || depth >= 0.35,
      air: rise != null && rise >= 0.08,
      x: hipX(pts)
    };
  }
};

DodgeMode.prototype._finishCalib = function () {
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i];
    var n = P.calib.length;
    var x = 0, sw = 0, ank = 0, hh = 0;
    for (var k = 0; k < n; k++) { x += P.calib[k].x; sw += P.calib[k].sw; ank += P.calib[k].ank; hh += P.calib[k].h; }
    if (n) {
      P.lanes.calibrate(x / n, sw / n);
      P.ankBase = ank / n;
      P.bodyH = Math.max(80, hh / n);
    } else {
      // 没认到人：按半边中间算
      P.lanes.calibrate(P.x + P.w / 2, P.w * 0.1);
      P.ankBase = 640;
      P.bodyH = 420;
    }
    P.avX = this._laneX(P, 1, 0);
  }
};

// ---------- 跑道几何（每个槽自己一条跑道） ----------
DodgeMode.prototype._road = function (P) {
  var cx = P.x + P.w / 2;
  return { cx: cx, bottom: P.w * 0.42, top: P.w * 0.05 };
};

DodgeMode.prototype._half = function (P, z) {
  var r = this._road(P);
  return r.top + (r.bottom - r.top) * persp(z);
};

DodgeMode.prototype._laneX = function (P, lane, z) {
  return this._road(P).cx + (lane - 1) * (2 * this._half(P, z) / 3);
};

DodgeMode.prototype._y = function (z) { return HORIZON + (GROUND - HORIZON) * persp(z); };

DodgeMode.prototype._avatarH = function () { return this.players === 2 ? 250 : 290; };

DodgeMode.prototype._drawBackground = function (c, P, tn) {
  var space = this.variant === 'space';
  var r = this._road(P);
  c.save();
  c.beginPath();
  c.rect(P.x, 0, P.w, H);
  c.clip();
  if (space) {
    c.fillStyle = '#0B1426';
    c.fillRect(P.x, 0, P.w, H);
    // 星星从中间往外飞
    var vx = r.cx, vy = HORIZON;
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      var d = ((s.d + tn / 1000 * s.v * (this.phase === 'play' ? 1 : 0.3)) % 1);
      var rad = d * d * P.w * 0.9;
      var x = vx + Math.cos(s.a) * rad, y = vy + Math.sin(s.a) * rad * 0.8;
      c.fillStyle = 'rgba(247,245,239,' + (0.25 + 0.75 * d) + ')';
      c.fillRect(x, y, s.s * (0.5 + d), s.s * (0.5 + d));
    }
  }
  // 跑道
  var yb = H + 40, zb = -0.2;
  var hb = this._half(P, zb), ht = r.top;
  c.beginPath();
  c.moveTo(r.cx - ht, HORIZON);
  c.lineTo(r.cx + ht, HORIZON);
  c.lineTo(r.cx + hb, yb);
  c.lineTo(r.cx - hb, yb);
  c.closePath();
  c.fillStyle = space ? 'rgba(31,79,168,0.35)' : 'rgba(181,68,58,0.92)';
  c.fill();
  // 道线
  c.strokeStyle = space ? 'rgba(127,214,255,0.85)' : 'rgba(247,245,239,0.95)';
  c.lineWidth = space ? 3 : 5;
  for (var l = 0; l <= 3; l++) {
    var f = l / 3 * 2 - 1;
    c.beginPath();
    c.moveTo(r.cx + f * ht, HORIZON);
    c.lineTo(r.cx + f * hb, yb);
    c.stroke();
  }
  // 横线往前流动，看起来在往前跑
  var speed = this.phase === 'play' ? 1 : 0.25;
  for (var k = 0; k < 8; k++) {
    var z = 1 - ((k / 8 + tn / 1000 * 0.45 * speed) % 1);
    var y2 = this._y(z), hw = this._half(P, z);
    c.strokeStyle = space ? 'rgba(127,214,255,' + (0.15 + 0.35 * persp(z)) + ')' : 'rgba(247,245,239,' + (0.12 + 0.25 * persp(z)) + ')';
    c.lineWidth = 2 + 3 * persp(z);
    c.beginPath();
    c.moveTo(r.cx - hw, y2);
    c.lineTo(r.cx + hw, y2);
    c.stroke();
  }
  c.restore();
};

// 骨架小人：按孩子真实的动作画，水平位置贴着当前的道，脚踩在跑道最前面
DodgeMode.prototype._drawAvatar = function (c, P, dt) {
  var pts = P.pose;
  if (!pts || P.ankBase == null || !has(pts, LOWER)) return;
  var lane = P.state.lane == null ? 1 : P.state.lane;
  var target = this._laneX(P, lane, 0);
  if (P.avX == null) P.avX = target;
  P.avX += (target - P.avX) * Math.min(1, dt / 90);
  var k = this._avatarH() / P.bodyH;
  var hx = hipX(pts);
  var hit = P.flash > 0 && Math.floor(P.flash * 10) % 2 === 0;
  function map(p) { return { x: P.avX + (p.x - hx) * k, y: GROUND - 6 - (P.ankBase - p.y) * k }; }
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  var color = hit ? '#E5484D' : (this.players === 2 ? P.color : '#F7F5EF');
  // 影子
  c.fillStyle = 'rgba(10,18,36,0.35)';
  c.beginPath();
  c.ellipse(P.avX, GROUND - 2, 70 * k * 0.6 + 30, 14, 0, 0, Math.PI * 2);
  c.fill();
  for (var pass = 0; pass < 2; pass++) {
    for (var i = 0; i < BONES.length; i++) {
      var a = pts[BONES[i][0]], b = pts[BONES[i][1]];
      if (!a || !b || a.s < 0.3 || b.s < 0.3) continue;
      var A = map(a), B = map(b);
      c.strokeStyle = pass ? color : 'rgba(10,18,36,0.6)';
      c.lineWidth = pass ? 12 : 18;
      c.beginPath();
      c.moveTo(A.x, A.y);
      c.lineTo(B.x, B.y);
      c.stroke();
    }
  }
  if (pts.nose && pts.nose.s >= 0.3) {
    var n = map(pts.nose);
    var hr = Math.max(16, Math.abs(pts.left_shoulder.x - pts.right_shoulder.x) * k * 0.32);
    c.beginPath();
    c.arc(n.x, n.y, hr, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(10,18,36,0.6)';
    c.stroke();
  }
  c.restore();
};

DodgeMode.prototype._drawObject = function (c, P, o, z) {
  var p = persp(z);
  var y = this._y(z);
  var lw = 2 * this._half(P, z) / 3;
  var space = this.variant === 'space';
  var avH = this._avatarH() * (0.2 + 0.8 * p);
  c.save();
  if (o.kind === 'block') {
    var x = this._laneX(P, o.lane, z);
    var R = lw * 0.36;
    if (space) {
      var pts = this.rocks[(o.lane + Math.floor(o.t0 / 100)) % this.rocks.length];
      var rot = o.t0 / 300 + (1 - z) * 2;
      c.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var a = rot + i / pts.length * Math.PI * 2;
        var px = x + Math.cos(a) * R * pts[i], py = y - R + Math.sin(a) * R * pts[i];
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fillStyle = '#8A7A6A';
      c.fill();
      c.lineWidth = Math.max(2, 5 * p);
      c.strokeStyle = 'rgba(10,18,36,0.8)';
      c.stroke();
      c.fillStyle = 'rgba(10,18,36,0.3)';
      c.beginPath();
      c.arc(x - R * 0.25, y - R * 1.15, R * 0.22, 0, Math.PI * 2);
      c.arc(x + R * 0.3, y - R * 0.8, R * 0.15, 0, Math.PI * 2);
      c.fill();
    } else {
      // 滚过来的大球
      var colors = ['#1F4FA8', '#7C6CF2', '#2E9E5B']; // 不用黄色：黄色是要吃的星星
      c.beginPath();
      c.arc(x, y - R, R, 0, Math.PI * 2);
      c.fillStyle = colors[o.lane];
      c.fill();
      c.lineWidth = Math.max(2, 6 * p);
      c.strokeStyle = 'rgba(10,18,36,0.8)';
      c.stroke();
      var spin = (1 - z) * 9;
      c.strokeStyle = 'rgba(247,245,239,0.85)';
      c.lineWidth = Math.max(2, 7 * p);
      c.beginPath();
      c.ellipse(x, y - R, R * Math.abs(Math.cos(spin)), R, 0, 0, Math.PI * 2);
      c.stroke();
    }
  } else if (o.kind === 'coin') {
    if (o.got) { c.restore(); return; }
    var cx2 = this._laneX(P, o.lane, z), cy2 = y - avH * 0.45;
    var s = lw * 0.18;
    c.translate(cx2, cy2);
    c.beginPath();
    if (space) {
      c.moveTo(0, -s * 1.3); c.lineTo(s * 0.8, 0); c.lineTo(0, s * 1.3); c.lineTo(-s * 0.8, 0);
    } else {
      for (var j = 0; j < 10; j++) {
        var ang = -Math.PI / 2 + j * Math.PI / 5, rr = j % 2 ? s * 0.45 : s;
        if (j === 0) c.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        else c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
    }
    c.closePath();
    c.fillStyle = space ? '#7FD6FF' : '#FFC928';
    c.fill();
    c.lineWidth = Math.max(2, 4 * p);
    c.strokeStyle = 'rgba(10,18,36,0.75)';
    c.stroke();
  } else {
    // 激光（头的高度，要蹲）、能量栏（贴地，要跳）：横跨整条跑道
    var hw = this._half(P, z);
    var cx3 = this._road(P).cx;
    var by = o.kind === 'laser' ? y - avH * 0.78 : y - avH * 0.06;
    var thick = Math.max(4, 22 * p);
    var col = o.kind === 'laser' ? '#FF4D5E' : '#7FD6FF';
    c.fillStyle = 'rgba(10,18,36,0.6)';
    c.fillRect(cx3 - hw - 8 * p, by - avH * 0.02 - thick, 10 * p + 4, (y - by) + thick);
    c.fillRect(cx3 + hw - 2 * p, by - avH * 0.02 - thick, 10 * p + 4, (y - by) + thick);
    c.globalAlpha = 0.35;
    c.fillStyle = col;
    c.fillRect(cx3 - hw, by - thick * 1.4, hw * 2, thick * 2.8);
    c.globalAlpha = 1;
    c.fillStyle = col;
    c.fillRect(cx3 - hw, by - thick / 2, hw * 2, thick);
    if (z < 0.75 && z > -0.05) {
      outlinedText(c, o.kind === 'laser' ? '蹲下！' : '跳！', cx3, by - thick - 10, Math.round(26 + 34 * p), col, 'center');
    }
  }
  c.restore();
};

DodgeMode.prototype._drawScene = function (c, P, tn, dt) {
  var w = P.world;
  var objs = w ? w.objects.slice() : [];
  var self = this;
  c.save();
  c.beginPath();
  c.rect(P.x, 0, P.w, H);
  c.clip();
  objs.sort(function (a, b) { return w.depth(b) - w.depth(a); });
  var i = 0;
  // 远处的先画，小人画在已经到了的东西前面
  for (; i < objs.length && w.depth(objs[i]) > 0.02; i++) self._drawObject(c, P, objs[i], w.depth(objs[i]));
  this._drawAvatar(c, P, dt);
  for (; i < objs.length; i++) self._drawObject(c, P, objs[i], w.depth(objs[i]));
  c.restore();
};

DodgeMode.prototype._events = function (P, tn) {
  var ev = P.world.drainEvents();
  var cx = P.x + P.w / 2;
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (e.type === 'hit') {
      sfx.bomb();
      P.flash = 1;
      this.shake = 1;
      this.pops.add(e.kind === 'laser' ? '要蹲下！' : (e.kind === 'bar' ? '要跳起来！' : '撞到了！'), cx, 300, '#E5484D', 54, tn);
      if (this.players === 1) speak(e.kind === 'laser' ? '蹲下' : (e.kind === 'bar' ? '跳' : '哎呀'));
    } else if (e.type === 'dodge') {
      sfx.tick();
      this.pops.add('+10', cx, 380, '#3FBF6A', 40, tn);
    } else if (e.type === 'coin') {
      sfx.star();
      this.pops.add('+5', this._laneX(P, e.lane, 0), GROUND - this._avatarH() * 0.6, '#FFC928', 44, tn);
    }
  }
};

DodgeMode.prototype._drawHUD = function (c) {
  var w0 = this.slots[0].world;
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i], w = P.world;
    var right = i === 1;
    var x = right ? W - 36 : 36, align = right ? 'right' : 'left';
    outlinedText(c, this.players === 2 ? P.name : '得分', x, 46, 26, this.players === 2 ? P.color : 'rgba(247,245,239,0.9)', align, BODY_FONT);
    outlinedText(c, String(w.score), x, 124, 84, '#F7F5EF', align);
    var hearts = '';
    for (var k = 0; k < DODGE_AGE[this.age].lives; k++) hearts += k < w.lives ? '♥' : '♡';
    outlinedText(c, hearts, x, 172, 40, '#E5484D', align, BODY_FONT);
  }
  drawTimer(c, w0.durationMs - w0.t, w0.durationMs);
};

DodgeMode.prototype._drawLearn = function (c, tn) {
  var steps = LEARN[this.variant];
  var done = true;
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i];
    var cx = P.x + P.w / 2;
    if (P.learnIdx >= steps.length) {
      outlinedText(c, '学会了！', cx, 110, this.players === 2 ? 44 : 56, '#3FBF6A', 'center');
      continue;
    }
    done = false;
    var st = steps[P.learnIdx];
    roundRect(c, P.x + 28, 30, P.w - 56, 100, 40);
    c.fillStyle = 'rgba(10,18,36,0.8)';
    c.fill();
    var size = this.players === 2 ? 30 : 46;
    outlinedText(c, st.msg, cx, 96, size, '#FFC928', 'center');
    // 目标道高亮
    if (st.lane != null) {
      var x0 = this._laneX(P, st.lane, 0), hw = this._half(P, 0) / 3;
      c.fillStyle = 'rgba(255,201,40,0.28)';
      c.fillRect(x0 - hw, GROUND - 40, hw * 2, 40);
    }
    var ok = st.test(P.state);
    if (ok) {
      if (P.learnSince === null) P.learnSince = tn;
      if (tn - P.learnSince >= LEARN_HOLD_MS) this._learnNext(P, tn, true);
    } else {
      P.learnSince = null;
      if (tn - P.learnStart > LEARN_TIMEOUT) this._learnNext(P, tn, false);
    }
  }
  return done;
};

DodgeMode.prototype._learnNext = function (P, tn, ok) {
  var steps = LEARN[this.variant];
  P.learnIdx += 1;
  P.learnSince = null;
  P.learnStart = tn;
  if (ok) sfx.success();
  if (P.learnIdx < steps.length) {
    if (this.players === 1) speak((ok ? '很好。' : '') + steps[P.learnIdx].msg);
  } else if (this.players === 1) {
    speak('学会了');
  }
};

// 模拟模式：算出每个人现在该站哪条道、要不要蹲、要不要跳（自动化测试用）
DodgeMode.prototype._mockHint = function () {
  var self = this;
  window.__tdMockHint = this.slots.map(function (P) {
    if (self.phase === 'learn') {
      var st = LEARN[self.variant][P.learnIdx];
      if (!st) return { lane: 1 };
      return { lane: st.lane == null ? 1 : st.lane, duck: /蹲/.test(st.msg), jump: /跳/.test(st.msg) };
    }
    var w = P.world;
    if (self.phase !== 'play' || !w) return { lane: 1 };
    var next = null;
    for (var i = 0; i < w.objects.length; i++) {
      var o = w.objects[i];
      if (o.judged || o.kind === 'coin') continue;
      if (!next || o.arrive < next.arrive) next = o;
    }
    if (!next) return { lane: P.hintLane == null ? 1 : P.hintLane };
    var dtA = next.arrive - w.t;
    if (next.kind === 'laser') return { lane: P.hintLane == null ? 1 : P.hintLane, duck: dtA < 700 && dtA > -200 };
    if (next.kind === 'bar') return { lane: P.hintLane == null ? 1 : P.hintLane, jump: dtA < 250 && dtA > -150 };
    var blocked = {};
    for (var j = 0; j < w.objects.length; j++) {
      var b = w.objects[j];
      if (b.kind === 'block' && !b.judged && Math.abs(b.arrive - next.arrive) < 50) blocked[b.lane] = true;
    }
    var cur = P.hintLane == null ? 1 : P.hintLane;
    if (blocked[cur] && dtA < 1500) {
      for (var l = 0; l < 3; l++) if (!blocked[l]) { cur = l; break; }
    }
    P.hintLane = cur;
    return { lane: cur };
  });
};

DodgeMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  if (this.env.mock) this._mockHint();
  var dtc = Math.min(dt, 50);
  var tn = now();
  var i, P;
  c.save();
  if (this.shake > 0) c.translate((Math.random() - 0.5) * 20 * this.shake, (Math.random() - 0.5) * 20 * this.shake);
  var showVideo = this.phase === 'space' || this.phase === 'calib';
  if (this.env.mock) st.drawMockBackground();
  else st.drawVideo(this.env.video, showVideo ? 0.12 : 0.55);
  if (showVideo) {
    for (i = 0; i < this.slots.length; i++) {
      if (this.slots[i].pose) {
        var bones = this.slots[i].pose;
        c.save();
        c.globalAlpha = 0.9;
        c.lineCap = 'round';
        for (var b = 0; b < BONES.length; b++) {
          var a1 = bones[BONES[b][0]], b1 = bones[BONES[b][1]];
          if (!a1 || !b1 || a1.s < 0.35 || b1.s < 0.35) continue;
          c.strokeStyle = this.players === 2 ? this.slots[i].color : '#F7F5EF';
          c.lineWidth = 8;
          c.beginPath();
          c.moveTo(a1.x, a1.y);
          c.lineTo(b1.x, b1.y);
          c.stroke();
        }
        c.restore();
      }
    }
  } else {
    for (i = 0; i < this.slots.length; i++) {
      this._drawBackground(c, this.slots[i], tn);
      this._drawScene(c, this.slots[i], tn, dtc);
    }
  }
  if (this.players === 2) drawDivider(c);
  if (this.phase === 'space') {
    var ok = drawSpace(c, this.slots, this.players === 2
      ? '两个人一左一右，各站一半，头和脚都要在画面里，左右留出跨步的地方'
      : '头和脚都要在画面里，左右各留出一大步的空地');
    if (ok) this._phase('calib', t);
  } else if (this.phase === 'calib') {
    roundRect(c, 240, 30, 800, 96, 48);
    c.fillStyle = 'rgba(10,18,36,0.8)';
    c.fill();
    outlinedText(c, '站在中间，别动', 640, 96, 48, '#FFC928', 'center');
    var f = clamp((t - this.phaseStart) / CALIB_MS, 0, 1);
    roundRect(c, 340, 112, 600 * f, 10, 5);
    c.fillStyle = '#3FBF6A';
    c.fill();
    if (f >= 1) {
      this._finishCalib();
      if (this.learned) this._phase('count', t);
      else this._phase('learn', t);
    }
  } else if (this.phase === 'learn') {
    if (this._drawLearn(c, tn)) {
      this.learned = true;
      this._phase('count', t);
    }
  } else if (this.phase === 'count') {
    if (drawCount(c, t - this.phaseStart, this.count)) {
      this.phase = 'play';
      var seed = (Date.now() & 0xffff) + 1;
      for (i = 0; i < this.slots.length; i++) {
        this.slots[i].world = new DodgeWorld({ variant: this.variant, age: this.age, seed: seed, durationMs: this.durationMs });
      }
    }
  } else if (this.phase === 'play') {
    var over = true;
    for (i = 0; i < this.slots.length; i++) {
      P = this.slots[i];
      if (!this.paused && !P.world.over) {
        P.world.update(dtc, P.state);
        this._events(P, tn);
      }
      if (!P.world.over) over = false;
      if (P.flash > 0) P.flash = Math.max(0, P.flash - dtc / 600);
    }
    if (!this.paused) this.env.onActive(dtc);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dtc / 300);
    this._drawHUD(c);
    if (over) this._end();
  } else if (this.phase === 'result') {
    drawHandsUp(c, this.slots);
  }
  this.pops.draw(c, tn);
  c.restore();
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

DodgeMode.prototype._end = function () {
  this.phase = 'result';
  for (var i = 0; i < this.slots.length; i++) this.slots[i].handsUp.reset();
  sfx.success();
  var type = this.variant === 'space' ? 'space' : 'dodge';
  if (this.players === 2) {
    var a = this.slots[0].world.result(), b = this.slots[1].world.result();
    // 都撑到最后比分数；有人先没命了，比谁撑得久
    var sa = a.score + (a.survived ? 10000 : a.timeMs / 100), sb = b.score + (b.survived ? 10000 : b.timeMs / 100);
    this.env.finish({ type: type, players: 2, age: this.age, results: [a, b], scores: [a.score, b.score], winner: winnerOf(sa, sb) });
    return;
  }
  var r = this.slots[0].world.result();
  r.type = type;
  r.age = this.age;
  r.bestKey = type + '-' + this.age;
  r.bestValue = r.score;
  this.env.finish(r);
};

DodgeMode.prototype.resultHTML = function (rec, newBest, best) {
  var name = this.variant === 'space' ? '太空躲障碍' : '左右闪避';
  if (rec.players === 2) {
    var cols = '';
    for (var i = 0; i < 2; i++) {
      var r = rec.results[i];
      var win = rec.winner === (i ? 'right' : 'left');
      cols += '<div class="duo-p' + (win ? ' win' : '') + '"><div class="who" style="color:' + this.slots[i].color + '">' + this.slots[i].name + '</div>' +
        '<div class="big">' + r.score + '<small>分</small></div>' +
        '<div class="stars">' + starText(r.stars) + '</div>' +
        '<div class="lines">躲开 ' + r.dodged + ' 次，被撞 ' + r.hits + ' 次' + (r.survived ? '' : '，' + Math.round(r.timeMs / 1000) + ' 秒时没命了') + '</div></div>';
    }
    return '<h2>' + name + ' · 双人</h2><div class="lines winner">' + winnerText(rec.winner) + '</div><div class="duo">' + cols + '</div>';
  }
  var lines = [
    rec.survived ? '坚持到了最后' + (rec.hits ? '，被撞了 ' + rec.hits + ' 次' : '，一次都没被撞到') : '坚持了 ' + Math.round(rec.timeMs / 1000) + ' 秒',
    '躲开 ' + rec.dodged + ' 次，' + (this.variant === 'space' ? '能量晶石' : '星星') + ' ' + rec.coins + ' 个'
  ];
  return '<h2>' + name + '</h2>' +
    '<div class="big">' + rec.score + '<small>分</small>' + (newBest ? '<span class="new">新纪录</span>' : '') + '</div>' +
    '<div class="stars">' + starText(rec.stars) + '</div>' +
    '<div class="lines">' + lines.join('<br>') + (best ? '<br>最好成绩 ' + best + ' 分' : '') + '</div>';
};

DodgeMode.prototype.dispose = function () { if (this.env.mock) window.__tdMockHint = null; };
