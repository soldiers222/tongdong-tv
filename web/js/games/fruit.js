// 西瓜切切切 · 画面与流程：站位 → 倒计时 → 切水果 → 结算
import { FruitWorld, AGE } from './fruit-logic.js';
import { makeSprites } from './fruit-art.js';
import { W, H, roundRect, outlinedText, BODY_FONT } from '../core/stage.js';
import { drawSkeleton } from '../core/skeleton.js';
import { handTip } from '../core/keypoints.js';
import { SpaceGate } from '../core/space.js';
import { HandsUp } from '../core/gestures.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, qs } from '../core/util.js';

var COUNT_MS = 800;
var HAND_COLORS = { left: '#7FD6FF', right: '#FFC928' };

export function FruitMode(env) {
  this.env = env;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.cfg = AGE[this.age];
  this.sprites = makeSprites(this.cfg.sizeScale);
  this.durationMs = (Number(qs('dur')) || 0) * 1000 || this.cfg.durationMs;
  this.gate = new SpaceGate(800);
  this.handsUp = new HandsUp(1500);
  this.reset();
}

FruitMode.prototype.title = '西瓜切切切';
FruitMode.prototype.fit = 'cover';

FruitMode.prototype.reset = function () {
  this.phase = 'space';
  this.space = null;
  this.pose = null;
  this.world = null;
  this.hands = { left: { prev: null, trail: [] }, right: { prev: null, trail: [] } };
  this.halves = [];
  this.drops = [];
  this.pops = [];
  this.flash = 0;
  this.flashColor = '#E5484D';
  this.shake = 0;
  this.countStart = 0;
  this.lastCount = -1;
  this.slow = false;
  this.paused = false;
  this.handsProgress = 0;
  this.slowChecked = false;
};

FruitMode.prototype.begin = function () {
  this.reset();
  this.gate.reset();
  speak('站到电视前面，举起手，准备切水果');
};

FruitMode.prototype.restart = function () {
  var keepPose = this.pose;
  this.reset();
  this.pose = keepPose;
  this.handsUp.reset();
  this._startCount(now());
};

FruitMode.prototype.pause = function (v) { this.paused = !!v; };

FruitMode.prototype._startCount = function (t) {
  var fps = this.env.poseFps();
  this.slow = fps > 0 && fps < 12;
  this.phase = 'count';
  this.countStart = t;
  this.lastCount = -1;
};

FruitMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  if (!frame.kp) {
    this.pose = null;
    this.hands.left.prev = null;
    this.hands.right.prev = null;
    if (this.phase === 'space') this.space = this.gate.update(null, 'upper', st.mirror, frame.t);
    return;
  }
  var pts = st.mapKp(frame.kp);
  this.pose = pts;
  if (this.phase === 'space') {
    this.space = this.gate.update(frame.kp, 'upper', st.mirror, frame.t);
  } else if (this.phase === 'play' && this.world && !this.paused) {
    this._track(pts, frame.t);
  } else if (this.phase === 'result') {
    var h = this.handsUp.update(frame.kp, frame.t);
    this.handsProgress = h.progress;
    if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
  }
  if (this.phase !== 'play') this._trailOnly(pts, frame.t);
};

FruitMode.prototype._trailOnly = function (pts, tCap) {
  var sides = ['left', 'right'];
  for (var i = 0; i < sides.length; i++) {
    var hd = this.hands[sides[i]];
    var tip = handTip(pts, sides[i]);
    if (!tip || tip.s < 0.3) continue;
    hd.trail.push({ x: tip.x, y: tip.y, wall: tCap });
    while (hd.trail.length && tCap - hd.trail[0].wall > 300) hd.trail.shift();
  }
};

FruitMode.prototype._track = function (pts, tCap) {
  var w = this.world;
  var tw = w.t - (now() - tCap); // 这帧画面被拍下时对应的游戏时间
  var sides = ['left', 'right'];
  for (var i = 0; i < sides.length; i++) {
    var side = sides[i];
    var hd = this.hands[side];
    var tip = handTip(pts, side);
    if (!tip || tip.s < 0.3) { hd.prev = null; continue; }
    var cur = { x: tip.x, y: tip.y, t: tw };
    if (hd.prev && cur.t > hd.prev.t) w.blade(side, hd.prev, cur);
    hd.prev = cur;
    hd.trail.push({ x: tip.x, y: tip.y, wall: tCap });
    while (hd.trail.length && tCap - hd.trail[0].wall > 300) hd.trail.shift();
  }
};

FruitMode.prototype._pop = function (text, x, y, color, size) {
  this.pops.push({ text: text, x: x, y: y, color: color || '#F7F5EF', size: size || 46, born: now() });
};

FruitMode.prototype._events = function () {
  var ev = this.world.drainEvents();
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (e.type === 'slice') {
      sfx.slice();
      sfx.splat();
      this._spawnHalves(e);
      if (e.golden) {
        sfx.star();
        this._pop((e.hand === 'right' ? '右手' : '左手') + '交叉切 +3', e.x, e.y - 40, '#FFC928', 50);
      } else {
        this._pop('+1', e.x, e.y - 30, '#F7F5EF', 44);
      }
    } else if (e.type === 'combo') {
      sfx.combo(e.n);
      this._pop(e.n + ' 连切 +' + e.bonus, W / 2, 210, '#FFC928', 72);
      speak(e.n + '连切');
    } else if (e.type === 'bomb') {
      sfx.bomb();
      this.flash = 1;
      this.flashColor = '#E5484D';
      this.shake = 1;
      this._pop('炸弹 −5', e.x, e.y - 30, '#E5484D', 56);
    } else if (e.type === 'wrongHand') {
      sfx.wrong();
      this._pop(e.need === 'right' ? '要用右手切' : '要用左手切', e.x, e.y - 60, '#FFC928', 44);
    } else if (e.type === 'level' && e.up) {
      this._pop('加快一点', W / 2, 170, '#7FD6FF', 40);
    }
  }
};

FruitMode.prototype._spawnHalves = function (e) {
  var nx = -Math.sin(e.angle), ny = Math.cos(e.angle);
  var g = this.world.gravity();
  for (var s = -1; s <= 1; s += 2) {
    this.halves.push({
      type: e.fruit, x: e.x, y: e.y,
      vx: e.vx * 0.6 + nx * 150 * s, vy: Math.min(e.vy, 0) * 0.4 + ny * 150 * s - 80,
      angle: e.angle, rot: 0, vrot: s * (2 + Math.random() * 2), side: s, g: g, born: now()
    });
  }
  var juice = { melon: '#E8414B', orange: '#FFA62B', apple: '#FFF2D0', kiwi: '#9BD14A', star: '#FFC928' }[e.fruit] || '#FFFFFF';
  for (var i = 0; i < 14; i++) {
    var a = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 340;
    this.drops.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: 4 + Math.random() * 6, color: juice, life: 1 });
  }
  if (this.drops.length > 160) this.drops.splice(0, this.drops.length - 160);
};

FruitMode.prototype._physics = function (dtMs) {
  var dt = dtMs / 1000;
  var keep = [];
  for (var i = 0; i < this.halves.length; i++) {
    var h = this.halves[i];
    h.vy += h.g * dt;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.rot += h.vrot * dt;
    if (h.y < H + 200) keep.push(h);
  }
  this.halves = keep;
  var d2 = [];
  for (var j = 0; j < this.drops.length; j++) {
    var d = this.drops[j];
    d.vy += 900 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.life -= dt * 1.6;
    if (d.life > 0) d2.push(d);
  }
  this.drops = d2;
  if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
  if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);
};

FruitMode.prototype._drawSprite = function (k, x, y, rot) {
  var c = this.env.stage.ctx;
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.drawImage(k.c, -k.size / 2, -k.size / 2);
  c.restore();
};

FruitMode.prototype._drawWorld = function () {
  var c = this.env.stage.ctx;
  var w = this.world;
  for (var i = 0; i < w.items.length; i++) {
    var it = w.items[i];
    var p = w.posAt(it, w.t);
    var rot = it.spin * (w.t - it.t0) / 1000;
    var spr = this.sprites[it.type];
    this._drawSprite(spr.whole, p.x, p.y, it.golden ? 0 : rot);
    if (it.golden && it.needHand) {
      outlinedText(c, it.needHand === 'right' ? '右手切' : '左手切', p.x, p.y - spr.R - 16, 34, '#FFC928', 'center');
    }
    if (it.bomb) {
      // 引信末端（贴图坐标 0.5R, -1.2R）跟着炸弹一起转
      var lx = spr.R * 0.5, ly = -spr.R * 1.2;
      var sx = p.x + lx * Math.cos(rot) - ly * Math.sin(rot), sy = p.y + lx * Math.sin(rot) + ly * Math.cos(rot);
      c.fillStyle = Math.random() < 0.5 ? '#FFC928' : '#FF7A1A';
      c.beginPath();
      c.arc(sx, sy, 6 + Math.random() * 6, 0, Math.PI * 2);
      c.fill();
    }
  }
  for (var j = 0; j < this.halves.length; j++) {
    var h = this.halves[j];
    var k = this.sprites[h.type].face;
    c.save();
    c.translate(h.x, h.y);
    c.rotate(h.angle + h.rot);
    c.beginPath();
    if (h.side < 0) c.rect(-k.size / 2, -k.size / 2, k.size, k.size / 2);
    else c.rect(-k.size / 2, 0, k.size, k.size / 2);
    c.clip();
    c.drawImage(k.c, -k.size / 2, -k.size / 2);
    c.restore();
  }
  for (var m = 0; m < this.drops.length; m++) {
    var d = this.drops[m];
    c.globalAlpha = Math.max(0, d.life);
    c.fillStyle = d.color;
    c.beginPath();
    c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
};

FruitMode.prototype._drawPops = function () {
  var c = this.env.stage.ctx;
  var t = now();
  var keep = [];
  for (var i = 0; i < this.pops.length; i++) {
    var p = this.pops[i];
    var age = (t - p.born) / 900;
    if (age >= 1) continue;
    keep.push(p);
    c.globalAlpha = 1 - age * age;
    outlinedText(c, p.text, p.x, p.y - age * 60, p.size, p.color, 'center');
  }
  c.globalAlpha = 1;
  this.pops = keep;
};

FruitMode.prototype._drawBlades = function (t) {
  var c = this.env.stage.ctx;
  var tNow = now();
  var sides = ['left', 'right'];
  for (var s = 0; s < sides.length; s++) {
    var tr = this.hands[sides[s]].trail;
    while (tr.length && tNow - tr[0].wall > 450) tr.shift();
    if (!tr.length) continue;
    var color = HAND_COLORS[sides[s]];
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (var i = 1; i < tr.length; i++) {
      var f = i / tr.length;
      c.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.6 * f) + ')';
      c.lineWidth = 4 + 16 * f;
      c.beginPath();
      c.moveTo(tr[i - 1].x, tr[i - 1].y);
      c.lineTo(tr[i].x, tr[i].y);
      c.stroke();
    }
    var last = tr[tr.length - 1];
    c.fillStyle = color;
    c.strokeStyle = 'rgba(10,18,36,0.7)';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(last.x, last.y, 15, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
};

FruitMode.prototype._drawHUD = function () {
  var c = this.env.stage.ctx;
  var w = this.world;
  outlinedText(c, '得分', 36, 46, 26, 'rgba(247,245,239,0.9)', 'left', BODY_FONT);
  outlinedText(c, String(w.score), 36, 124, 84, '#F7F5EF');
  var left = Math.max(0, w.durationMs - w.t);
  var frac = left / w.durationMs;
  roundRect(c, 440, 26, 400, 26, 13);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  if (frac > 0) {
    roundRect(c, 444, 30, Math.max(18, 392 * frac), 18, 9);
    c.fillStyle = frac < 0.2 ? '#E5484D' : '#FFC928';
    c.fill();
  }
  outlinedText(c, Math.ceil(left / 1000) + ' 秒', 640, 96, 40, '#F7F5EF', 'center');
  outlinedText(c, '第 ' + (w.level + 1) + ' 级', 1244, 70, 38, '#F7F5EF', 'right');
  if (w.slow) outlinedText(c, '慢节奏', 1244, 112, 30, '#FFC928', 'right');
};

FruitMode.prototype._drawSpace = function () {
  var c = this.env.stage.ctx;
  var sp = this.space;
  var msg = sp ? sp.msg : '请站到电视正前方，让摄像头看到你';
  var okNow = sp && sp.ok;
  roundRect(c, 200, 34, 880, 96, 48);
  c.fillStyle = 'rgba(10,18,36,0.78)';
  c.fill();
  outlinedText(c, msg, 640, 98, 48, okNow ? '#FFC928' : '#F7F5EF', 'center');
  if (okNow) {
    roundRect(c, 340, 112, 600 * sp.progress, 10, 5);
    c.fillStyle = '#3FBF6A';
    c.fill();
  }
  outlinedText(c, '站到离电视 2 米左右，上半身和两只手都在画面里就行', 640, 690, 28, '#F7F5EF', 'center', BODY_FONT);
};

FruitMode.prototype._drawCount = function (t) {
  var c = this.env.stage.ctx;
  var el = t - this.countStart;
  var idx = Math.floor(el / COUNT_MS);
  if (idx !== this.lastCount) {
    this.lastCount = idx;
    if (idx < 3) sfx.tick();
    else if (idx === 3) { sfx.go(); speak('开始'); }
  }
  if (idx >= 4) {
    this.phase = 'play';
    this.world = new FruitWorld({ age: this.age, slow: this.slow, durationMs: this.durationMs, seed: (Date.now() & 0xffff) + 1 });
    this.hands.left.prev = null;
    this.hands.right.prev = null;
    return;
  }
  var f = (el % COUNT_MS) / COUNT_MS;
  var text = idx < 3 ? String(3 - idx) : '开始！';
  var size = (idx < 3 ? 260 : 170) * (1.15 - 0.15 * f);
  c.globalAlpha = idx < 3 ? 1 - f * 0.5 : 1;
  outlinedText(c, text, W / 2, H / 2 + size * 0.35, Math.round(size), '#FFC928', 'center');
  c.globalAlpha = 1;
  if (this.slow) outlinedText(c, '这台设备识别较慢，已开慢节奏', W / 2, 660, 30, '#F7F5EF', 'center', BODY_FONT);
};

FruitMode.prototype._drawHandsUp = function () {
  var c = this.env.stage.ctx;
  var p = this.handsProgress;
  roundRect(c, 440, 662, 400, 16, 8);
  c.fillStyle = 'rgba(10,18,36,0.7)';
  c.fill();
  if (p > 0) {
    roundRect(c, 440, 662, 400 * p, 16, 8);
    c.fillStyle = '#3FBF6A';
    c.fill();
  }
};

FruitMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  var dtc = Math.min(dt, 50);
  c.save();
  if (this.shake > 0) c.translate((Math.random() - 0.5) * 18 * this.shake, (Math.random() - 0.5) * 18 * this.shake);
  if (this.env.mock) st.drawMockBackground();
  else st.drawVideo(this.env.video, this.phase === 'play' ? 0.32 : 0.12);
  if (this.pose && this.env.settings.skeleton) {
    drawSkeleton(c, this.pose, { alpha: this.phase === 'play' ? 0.4 : 0.9, width: this.phase === 'play' ? 5 : 8, joints: this.phase !== 'play' });
  }
  if (this.phase === 'space') {
    this._drawSpace();
    if (this.space && this.space.passed) this._startCount(t);
  } else if (this.phase === 'count') {
    this._drawCount(t);
  } else if (this.phase === 'play') {
    var w = this.world;
    if (!this.paused) {
      w.update(dtc);
      this._events();
      this._physics(dtc);
      this.env.onActive(dtc);
      if (!this.slowChecked && w.t > 5000) {
        this.slowChecked = true;
        var fps = this.env.poseFps();
        if (!w.slow && fps > 0 && fps < 12) {
          w.setSlow(true);
          this._pop('识别较慢，已开慢节奏', W / 2, 250, '#7FD6FF', 36);
        }
      }
    }
    this._drawWorld();
    this._drawPops();
    this._drawHUD();
    if (w.over) this._end();
  } else if (this.phase === 'result') {
    this._drawHandsUp();
  }
  this._drawBlades(t);
  if (this.flash > 0) {
    c.globalAlpha = this.flash * 0.35;
    c.fillStyle = this.flashColor;
    c.fillRect(-20, -20, W + 40, H + 40);
    c.globalAlpha = 1;
  }
  c.restore();
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

FruitMode.prototype._end = function () {
  var w = this.world;
  this.phase = 'result';
  this.handsUp.reset();
  sfx.success();
  this.env.finish({
    type: 'fruit',
    age: this.age,
    score: w.score,
    sliced: w.sliced,
    stars: w.stars,
    maxCombo: w.maxCombo,
    bombs: w.bombsHit,
    missed: w.missed,
    level: w.level + 1,
    accuracy: w.accuracy(),
    slow: w.slow,
    durationMs: w.durationMs
  });
};

FruitMode.prototype.resultHTML = function (rec, newBest, best) {
  var lines = [
    '切中 ' + rec.sliced + ' 个水果，其中交叉手星星 ' + rec.stars + ' 个',
    '最多一刀连切 ' + rec.maxCombo + ' 个，最高到第 ' + rec.level + ' 级',
    rec.sliced + rec.missed > 0 ? '命中率 ' + Math.round(rec.accuracy * 100) + '%' + (rec.bombs ? '，碰到炸弹 ' + rec.bombs + ' 次' : '') : ''
  ];
  return '<h2>西瓜切切切</h2>' +
    '<div class="big">' + rec.score + '<small>分</small>' + (newBest ? '<span class="new">新纪录</span>' : '') + '</div>' +
    '<div class="lines">' + lines.filter(Boolean).join('<br>') + '<br>最好成绩 ' + best + ' 分（' + (rec.age === '9-12' ? '9–12 岁' : '6–8 岁') + '）</div>';
};

FruitMode.prototype.dispose = function () {};
