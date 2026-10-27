// 西瓜切切切 · 双人：屏幕左右各一半，两个人各切各的水果（两边出的水果一样），时间到比谁分高。
// 规则、分龄、难度自适应都和单人一样（每半边一个 FruitWorld，宽 640），画面按半边平移、裁剪。
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
import { DUO, HALF, screenPlayers, winnerOf, winnerText } from './duo.js';

var COUNT_MS = 800;
var HAND_COLORS = { left: '#7FD6FF', right: '#FFC928' };

export function FruitDuoMode(env) {
  this.env = env;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.cfg = AGE[this.age];
  this.sprites = makeSprites(this.cfg.sizeScale);
  this.durationMs = (Number(qs('dur')) || 0) * 1000 || this.cfg.durationMs;
  this.p = null;
  this.reset();
}

FruitDuoMode.prototype.title = '西瓜切切切 · 双人';
FruitDuoMode.prototype.fit = 'cover';
FruitDuoMode.prototype.players = 2;

FruitDuoMode.prototype._player = function (i) {
  var old = this.p && this.p[i];
  return {
    i: i,
    d: DUO[i],
    gate: old ? old.gate : new SpaceGate(800),
    handsUp: old ? old.handsUp : new HandsUp(1500),
    space: null,
    pose: old ? old.pose : null,
    world: null,
    hands: { left: { prev: null, trail: [] }, right: { prev: null, trail: [] } },
    flash: 0,
    handsProgress: 0
  };
};

FruitDuoMode.prototype.reset = function () {
  this.phase = 'space';
  this.p = [this._player(0), this._player(1)];
  this.halves = [];
  this.drops = [];
  this.pops = [];
  this.countStart = 0;
  this.lastCount = -1;
  this.slow = false;
  this.paused = false;
  this.slowChecked = false;
};

FruitDuoMode.prototype.begin = function () {
  this.reset();
  for (var i = 0; i < 2; i++) {
    this.p[i].gate.reset();
    this.p[i].pose = null;
  }
  speak('两个人一左一右站好，举起手，准备切水果');
};

FruitDuoMode.prototype.restart = function () {
  this.reset();
  for (var i = 0; i < 2; i++) this.p[i].handsUp.reset();
  this._startCount(now());
};

FruitDuoMode.prototype.pause = function (v) { this.paused = !!v; };

FruitDuoMode.prototype._startCount = function (t) {
  var fps = this.env.poseFps();
  this.slow = fps > 0 && fps < 12;
  this.phase = 'count';
  this.countStart = t;
  this.lastCount = -1;
};

FruitDuoMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  var kps = screenPlayers(frame, st.mirror);
  for (var i = 0; i < 2; i++) {
    var P = this.p[i], kp = kps[i];
    if (!kp) {
      P.pose = null;
      P.hands.left.prev = null;
      P.hands.right.prev = null;
      if (this.phase === 'space') P.space = P.gate.update(null, 'upper', st.mirror, frame.t, P.d.region);
      continue;
    }
    var pts = st.mapKp(kp);
    P.pose = pts;
    if (this.phase === 'space') {
      P.space = P.gate.update(kp, 'upper', st.mirror, frame.t, P.d.region);
    } else if (this.phase === 'play' && P.world && !this.paused) {
      this._track(P, pts, frame.t);
    } else if (this.phase === 'result') {
      // 两个人谁举起双手 2 秒都能再来一局
      var h = P.handsUp.update(kp, frame.t);
      P.handsProgress = h.progress;
      if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
    }
    if (this.phase !== 'play') this._trailOnly(P, pts, frame.t);
  }
};

FruitDuoMode.prototype._trailOnly = function (P, pts, tCap) {
  var sides = ['left', 'right'];
  for (var i = 0; i < sides.length; i++) {
    var hd = P.hands[sides[i]];
    var tip = handTip(pts, sides[i]);
    if (!tip || tip.s < 0.3) continue;
    hd.trail.push({ x: tip.x, y: tip.y, wall: tCap });
    while (hd.trail.length && tCap - hd.trail[0].wall > 300) hd.trail.shift();
  }
};

// 手的位置换成这半边水果世界的坐标（世界宽 640，从 x0 开始）
FruitDuoMode.prototype._track = function (P, pts, tCap) {
  var w = P.world;
  var tw = w.t - (now() - tCap); // 这帧画面被拍下时对应的游戏时间
  var sides = ['left', 'right'];
  for (var i = 0; i < sides.length; i++) {
    var side = sides[i];
    var hd = P.hands[side];
    var tip = handTip(pts, side);
    if (!tip || tip.s < 0.3) { hd.prev = null; continue; }
    var cur = { x: tip.x - P.d.x0, y: tip.y, t: tw };
    if (hd.prev && cur.t > hd.prev.t) w.blade(side, hd.prev, cur);
    hd.prev = cur;
    hd.trail.push({ x: tip.x, y: tip.y, wall: tCap });
    while (hd.trail.length && tCap - hd.trail[0].wall > 300) hd.trail.shift();
  }
};

FruitDuoMode.prototype._pop = function (text, x, y, color, size) {
  this.pops.push({ text: text, x: x, y: y, color: color || '#F7F5EF', size: size || 42, born: now() });
};

FruitDuoMode.prototype._events = function (P) {
  var ev = P.world.drainEvents();
  var x0 = P.d.x0, cx = x0 + HALF / 2;
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (e.type === 'slice') {
      sfx.slice();
      sfx.splat();
      this._spawnHalves(e, x0, P.world.gravity());
      if (e.golden) {
        sfx.star();
        this._pop((e.hand === 'right' ? '右手' : '左手') + '交叉切 +3', x0 + e.x, e.y - 40, '#FFC928', 44);
      } else {
        this._pop('+1', x0 + e.x, e.y - 30, '#F7F5EF', 40);
      }
    } else if (e.type === 'combo') {
      sfx.combo(e.n);
      this._pop(e.n + ' 连切 +' + e.bonus, cx, 230, P.d.color, 60);
    } else if (e.type === 'bomb') {
      sfx.bomb();
      P.flash = 1;
      this._pop('炸弹 −5', x0 + e.x, e.y - 30, '#E5484D', 50);
    } else if (e.type === 'wrongHand') {
      sfx.wrong();
      this._pop(e.need === 'right' ? '要用右手切' : '要用左手切', x0 + e.x, e.y - 60, '#FFC928', 40);
    } else if (e.type === 'level' && e.up) {
      this._pop('加快一点', cx, 190, '#7FD6FF', 34);
    }
  }
};

FruitDuoMode.prototype._spawnHalves = function (e, x0, g) {
  var nx = -Math.sin(e.angle), ny = Math.cos(e.angle);
  var x = x0 + e.x;
  for (var s = -1; s <= 1; s += 2) {
    this.halves.push({
      type: e.fruit, x: x, y: e.y,
      vx: e.vx * 0.6 + nx * 150 * s, vy: Math.min(e.vy, 0) * 0.4 + ny * 150 * s - 80,
      angle: e.angle, rot: 0, vrot: s * (2 + Math.random() * 2), side: s, g: g
    });
  }
  var juice = { melon: '#E8414B', orange: '#FFA62B', apple: '#FFF2D0', kiwi: '#9BD14A', star: '#FFC928' }[e.fruit] || '#FFFFFF';
  for (var i = 0; i < 12; i++) {
    var a = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 320;
    this.drops.push({ x: x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: 4 + Math.random() * 6, color: juice, life: 1 });
  }
  if (this.drops.length > 200) this.drops.splice(0, this.drops.length - 200);
};

FruitDuoMode.prototype._physics = function (dtMs) {
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
  for (var k = 0; k < 2; k++) {
    if (this.p[k].flash > 0) this.p[k].flash = Math.max(0, this.p[k].flash - dt * 3);
  }
};

FruitDuoMode.prototype._drawSprite = function (k, x, y, rot) {
  var c = this.env.stage.ctx;
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.drawImage(k.c, -k.size / 2, -k.size / 2);
  c.restore();
};

// 这半边的水果：平移到这半边，并且只画在这半边里
FruitDuoMode.prototype._drawWorld = function (P) {
  var c = this.env.stage.ctx;
  var w = P.world;
  c.save();
  c.beginPath();
  c.rect(P.d.x0, 0, HALF, H);
  c.clip();
  c.translate(P.d.x0, 0);
  for (var i = 0; i < w.items.length; i++) {
    var it = w.items[i];
    var p = w.posAt(it, w.t);
    var rot = it.spin * (w.t - it.t0) / 1000;
    var spr = this.sprites[it.type];
    this._drawSprite(spr.whole, p.x, p.y, it.golden ? 0 : rot);
    if (it.golden && it.needHand) {
      outlinedText(c, it.needHand === 'right' ? '右手切' : '左手切', p.x, p.y - spr.R - 16, 30, '#FFC928', 'center');
    }
    if (it.bomb) {
      var lx = spr.R * 0.5, ly = -spr.R * 1.2;
      var sx = p.x + lx * Math.cos(rot) - ly * Math.sin(rot), sy = p.y + lx * Math.sin(rot) + ly * Math.cos(rot);
      c.fillStyle = Math.random() < 0.5 ? '#FFC928' : '#FF7A1A';
      c.beginPath();
      c.arc(sx, sy, 6 + Math.random() * 6, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
};

FruitDuoMode.prototype._drawPieces = function () {
  var c = this.env.stage.ctx;
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

FruitDuoMode.prototype._drawPops = function () {
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

FruitDuoMode.prototype._drawBlades = function () {
  var c = this.env.stage.ctx;
  var tNow = now();
  var sides = ['left', 'right'];
  for (var pi = 0; pi < 2; pi++) {
    for (var s = 0; s < sides.length; s++) {
      var tr = this.p[pi].hands[sides[s]].trail;
      while (tr.length && tNow - tr[0].wall > 450) tr.shift();
      if (!tr.length) continue;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (var i = 1; i < tr.length; i++) {
        var f = i / tr.length;
        c.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.6 * f) + ')';
        c.lineWidth = 4 + 14 * f;
        c.beginPath();
        c.moveTo(tr[i - 1].x, tr[i - 1].y);
        c.lineTo(tr[i].x, tr[i].y);
        c.stroke();
      }
      var last = tr[tr.length - 1];
      c.fillStyle = HAND_COLORS[sides[s]];
      c.strokeStyle = 'rgba(10,18,36,0.7)';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(last.x, last.y, 13, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
};

// 中间的分界线：各站各的半边
FruitDuoMode.prototype._drawDivider = function () {
  var c = this.env.stage.ctx;
  c.save();
  c.strokeStyle = 'rgba(247,245,239,0.55)';
  c.lineWidth = 4;
  if (c.setLineDash) c.setLineDash([18, 14]);
  c.beginPath();
  c.moveTo(HALF, 150);
  c.lineTo(HALF, H);
  c.stroke();
  c.restore();
};

FruitDuoMode.prototype._drawHUD = function () {
  var c = this.env.stage.ctx;
  for (var i = 0; i < 2; i++) {
    var P = this.p[i], w = P.world;
    var right = i === 1;
    var x = right ? W - 36 : 36, align = right ? 'right' : 'left';
    outlinedText(c, P.d.name, x, 46, 28, P.d.color, align);
    outlinedText(c, String(w.score), x, 124, 84, '#F7F5EF', align);
    outlinedText(c, '第 ' + (w.level + 1) + ' 级', x, 164, 26, '#F7F5EF', align, BODY_FONT);
  }
  var w0 = this.p[0].world;
  var left = Math.max(0, w0.durationMs - w0.t);
  var frac = left / w0.durationMs;
  roundRect(c, 440, 26, 400, 26, 13);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  if (frac > 0) {
    roundRect(c, 444, 30, Math.max(18, 392 * frac), 18, 9);
    c.fillStyle = frac < 0.2 ? '#E5484D' : '#FFC928';
    c.fill();
  }
  outlinedText(c, Math.ceil(left / 1000) + ' 秒', HALF, 96, 40, '#F7F5EF', 'center');
  if (w0.slow) outlinedText(c, '慢节奏', HALF, 136, 28, '#FFC928', 'center');
};

FruitDuoMode.prototype._drawSpace = function () {
  var c = this.env.stage.ctx;
  for (var i = 0; i < 2; i++) {
    var P = this.p[i], sp = P.space;
    var cx = P.d.x0 + HALF / 2;
    var okNow = sp && sp.ok;
    roundRect(c, P.d.x0 + 28, 34, HALF - 56, 96, 36);
    c.fillStyle = 'rgba(10,18,36,0.78)';
    c.fill();
    var msg = sp && sp.passed ? '准备好了' : (sp ? sp.msg : '站到这半边来');
    outlinedText(c, msg, cx, 84, 34, okNow ? '#FFC928' : '#F7F5EF', 'center');
    outlinedText(c, P.d.name, cx, 120, 24, P.d.color, 'center', BODY_FONT);
    if (okNow) {
      roundRect(c, P.d.x0 + 90, 128, (HALF - 180) * sp.progress, 8, 4);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
  }
  outlinedText(c, '两个人一左一右，各站一半，离电视 2 米左右，上半身和两只手都在画面里', HALF, 690, 26, '#F7F5EF', 'center', BODY_FONT);
};

FruitDuoMode.prototype._drawCount = function (t) {
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
    // 两边用同一个随机种子：出一样的水果，公平
    var seed = (Date.now() & 0xffff) + 1;
    for (var i = 0; i < 2; i++) {
      this.p[i].world = new FruitWorld({ W: HALF, H: H, age: this.age, slow: this.slow, durationMs: this.durationMs, seed: seed });
      this.p[i].hands.left.prev = null;
      this.p[i].hands.right.prev = null;
    }
    return;
  }
  var f = (el % COUNT_MS) / COUNT_MS;
  var text = idx < 3 ? String(3 - idx) : '开始！';
  var size = (idx < 3 ? 240 : 160) * (1.15 - 0.15 * f);
  c.globalAlpha = idx < 3 ? 1 - f * 0.5 : 1;
  outlinedText(c, text, W / 2, H / 2 + size * 0.35, Math.round(size), '#FFC928', 'center');
  c.globalAlpha = 1;
  if (this.slow) outlinedText(c, '这台设备识别较慢，已开慢节奏', W / 2, 660, 30, '#F7F5EF', 'center', BODY_FONT);
};

FruitDuoMode.prototype._drawHandsUp = function () {
  var c = this.env.stage.ctx;
  var p = Math.max(this.p[0].handsProgress, this.p[1].handsProgress);
  roundRect(c, 440, 662, 400, 16, 8);
  c.fillStyle = 'rgba(10,18,36,0.7)';
  c.fill();
  if (p > 0) {
    roundRect(c, 440, 662, 400 * p, 16, 8);
    c.fillStyle = '#3FBF6A';
    c.fill();
  }
};

FruitDuoMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  var dtc = Math.min(dt, 50);
  if (this.env.mock) st.drawMockBackground();
  else st.drawVideo(this.env.video, this.phase === 'play' ? 0.32 : 0.12);
  this._drawDivider();
  for (var i = 0; i < 2; i++) {
    var P = this.p[i];
    if (P.pose && this.env.settings.skeleton) {
      drawSkeleton(c, P.pose, { color: P.d.color, alpha: this.phase === 'play' ? 0.45 : 0.9, width: this.phase === 'play' ? 5 : 7, joints: this.phase !== 'play' });
    }
  }
  if (this.phase === 'space') {
    this._drawSpace();
    if (this.p[0].space && this.p[0].space.passed && this.p[1].space && this.p[1].space.passed) this._startCount(t);
  } else if (this.phase === 'count') {
    this._drawCount(t);
  } else if (this.phase === 'play') {
    if (!this.paused) {
      for (var k = 0; k < 2; k++) {
        this.p[k].world.update(dtc);
        this._events(this.p[k]);
      }
      this._physics(dtc);
      this.env.onActive(dtc);
      if (!this.slowChecked && this.p[0].world.t > 5000) {
        this.slowChecked = true;
        var fps = this.env.poseFps();
        if (!this.p[0].world.slow && fps > 0 && fps < 12) {
          this.p[0].world.setSlow(true);
          this.p[1].world.setSlow(true);
          this._pop('识别较慢，已开慢节奏', W / 2, 250, '#7FD6FF', 34);
        }
      }
    }
    this._drawWorld(this.p[0]);
    this._drawWorld(this.p[1]);
    this._drawPieces();
    this._drawPops();
    this._drawHUD();
    if (this.p[0].world.over && this.p[1].world.over) this._end();
  } else if (this.phase === 'result') {
    this._drawHandsUp();
  }
  this._drawBlades();
  for (var m = 0; m < 2; m++) {
    var fl = this.p[m].flash;
    if (fl > 0) {
      c.globalAlpha = fl * 0.35;
      c.fillStyle = '#E5484D';
      c.fillRect(this.p[m].d.x0, 0, HALF, H);
      c.globalAlpha = 1;
    }
  }
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

FruitDuoMode.prototype._end = function () {
  var a = this.p[0].world, b = this.p[1].world;
  this.phase = 'result';
  for (var i = 0; i < 2; i++) this.p[i].handsUp.reset();
  sfx.success();
  var winner = winnerOf(a.score, b.score);
  speak(winnerText(winner));
  this.env.finish({
    type: 'fruit',
    players: 2,
    age: this.age,
    scores: [a.score, b.score],
    sliced: [a.sliced, b.sliced],
    stars: [a.stars, b.stars],
    maxCombo: [a.maxCombo, b.maxCombo],
    bombs: [a.bombsHit, b.bombsHit],
    winner: winner,
    slow: a.slow,
    durationMs: a.durationMs
  });
};

FruitDuoMode.prototype.resultHTML = function (rec) {
  var cols = '';
  for (var i = 0; i < 2; i++) {
    var d = DUO[i];
    var win = rec.winner === d.side;
    cols += '<div class="duo-p' + (win ? ' win' : '') + '">' +
      '<div class="who" style="color:' + d.color + '">' + d.name + (win ? '<span class="new">赢了</span>' : '') + '</div>' +
      '<div class="big">' + rec.scores[i] + '<small>分</small></div>' +
      '<div class="lines">切中 ' + rec.sliced[i] + ' 个，星星 ' + rec.stars[i] + ' 个<br>最多一刀连切 ' + rec.maxCombo[i] + ' 个' +
      (rec.bombs[i] ? '，炸弹 ' + rec.bombs[i] + ' 次' : '') + '</div></div>';
  }
  return '<h2>西瓜切切切 · 双人</h2><div class="duo">' + cols + '</div><div class="lines winner">' + winnerText(rec.winner) + '</div>';
};

FruitDuoMode.prototype.dispose = function () {};
