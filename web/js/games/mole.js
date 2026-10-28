// 敏捷摸球 · 画面与流程：站位 → 倒计时 → 摸球 60 秒 → 结算。单人整屏，双人一人一半（两边出球的节奏一样）。
import { MoleWorld, MOLE_AGE } from './mole-logic.js';
import { makeSlots, framePlayers, drawSpace, drawCount, drawDivider, drawHandsUp, drawTimer, Pops, starText } from './arena.js';
import { W, H, outlinedText, BODY_FONT } from '../core/stage.js';
import { drawSkeleton } from '../core/skeleton.js';
import { handTip } from '../core/keypoints.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, qs, clamp } from '../core/util.js';
import { winnerOf, winnerText } from './duo.js';

var HAND_COLORS = { left: '#7FD6FF', right: '#FFC928' };
var BALL_COLORS = ['#3FBF6A', '#FF8A5B', '#C77DFF', '#5BC0FF', '#FF5C8A'];

export function MoleMode(env, players) {
  this.env = env;
  this.players = players === 2 ? 2 : 1;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.durationMs = (Number(qs('dur')) || 0) * 1000 || MOLE_AGE[this.age].durationMs;
  this.title = '敏捷摸球' + (this.players === 2 ? ' · 双人' : '');
  this.slots = makeSlots(this.players);
  this.pops = new Pops();
  this.reset();
}

MoleMode.prototype.fit = 'cover';

MoleMode.prototype.reset = function () {
  this.phase = 'space';
  this.countStart = 0;
  this.count = { lastCount: -1 };
  this.paused = false;
  this.rings = [];
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i];
    P.world = null;
    P.hands = { left: null, right: null };
    P.body = null;
    P.flash = 0;
    P.handsProgress = 0;
    P.gate.reset();
    P.handsUp.reset();
  }
};

MoleMode.prototype.begin = function () {
  this.reset();
  speak(this.players === 2 ? '两个人一左一右站好，准备摸球' : '站到电视前面，准备摸球');
};

MoleMode.prototype.restart = function () {
  this.reset();
  this._startCount(now());
};

MoleMode.prototype.pause = function (v) { this.paused = !!v; };

MoleMode.prototype._startCount = function (t) {
  this.phase = 'count';
  this.countStart = t;
  this.count = { lastCount: -1 };
};

MoleMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  var kps = framePlayers(frame, st.mirror, this.players);
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i], kp = kps[i];
    P.kp = kp;
    P.pose = kp ? st.mapKp(kp) : null;
    if (this.phase === 'space') P.space = P.gate.update(kp, 'upper', st.mirror, frame.t, P.region);
    if (!P.pose) { P.hands = { left: null, right: null }; continue; }
    var pts = P.pose;
    for (var s = 0; s < 2; s++) {
      var side = s ? 'right' : 'left';
      var tip = handTip(pts, side);
      P.hands[side] = tip && tip.s >= 0.3 ? { x: tip.x, y: tip.y } : null;
    }
    var ls = pts.left_shoulder, rs = pts.right_shoulder, lh = pts.left_hip, rh = pts.right_hip;
    if (ls && rs && ls.s >= 0.3 && rs.s >= 0.3) {
      var cx = (ls.x + rs.x) / 2, cy = (ls.y + rs.y) / 2;
      var torso = lh && rh && lh.s >= 0.3 && rh.s >= 0.3 ? Math.abs((lh.y + rh.y) / 2 - cy) : Math.abs(ls.x - rs.x) * 1.5;
      var reach = clamp(torso * 1.05, 90, 330);
      var head = pts.nose && pts.nose.s >= 0.3 ? { x: pts.nose.x, y: pts.nose.y } : null;
      // 平滑一下，别让球的位置跟着识别抖动
      if (!P.body) P.body = { x: cx, y: cy, reach: reach, head: head };
      else {
        P.body.x += (cx - P.body.x) * 0.3;
        P.body.y += (cy - P.body.y) * 0.3;
        P.body.reach += (reach - P.body.reach) * 0.1;
        P.body.head = head;
      }
    }
    if (this.phase === 'result' && kp) {
      var h = P.handsUp.update(kp, frame.t);
      P.handsProgress = h.progress;
      if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
    }
  }
};

MoleMode.prototype._events = function (P, t) {
  var ev = P.world.drainEvents();
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (e.type === 'hit') {
      sfx.star();
      this.rings.push({ x: e.x, y: e.y, born: t, color: e.kind === 'gold' ? '#FFC928' : '#F7F5EF' });
      var label = '+' + e.pts;
      if (e.kind === 'pair') label = '双手 +' + e.pts;
      else if (e.reaction <= 700) label = '真快 +' + e.pts;
      this.pops.add(label, e.x, e.y - 50, e.kind === 'gold' ? '#FFC928' : '#F7F5EF', this.players === 2 ? 38 : 46, t);
      if (e.combo >= 5 && e.combo % 5 === 0) {
        sfx.combo(Math.min(5, e.combo / 5 + 2));
        this.pops.add(e.combo + ' 连中', P.x + P.w / 2, 210, P.color, 60, t);
      }
    } else if (e.type === 'miss') {
      this.pops.add('没摸到', e.x, e.y - 40, 'rgba(247,245,239,0.8)', 32, t);
    } else if (e.type === 'bomb') {
      sfx.bomb();
      P.flash = 1;
      this.pops.add('炸弹 −10', e.x, e.y - 40, '#E5484D', 50, t);
    } else if (e.type === 'wrongHand') {
      sfx.wrong();
      this.pops.add(e.need === 'left' ? '要用左手' : '要用右手', e.x, e.y - 70, HAND_COLORS[e.need], 40, t);
    } else if (e.type === 'level' && e.up) {
      this.pops.add('加快一点', P.x + P.w / 2, 190, '#7FD6FF', 36, t);
    }
  }
};

MoleMode.prototype._drawBall = function (c, b, wt, t) {
  var lifeLeft = clamp(1 - (wt - b.born) / b.life, 0, 1);
  var grow = clamp((wt - b.born) / 180, 0, 1);
  var r = b.r * (0.4 + 0.6 * grow);
  var fill = BALL_COLORS[b.id % BALL_COLORS.length];
  if (b.kind === 'gold') fill = '#FFC928';
  if (b.kind === 'bomb') fill = '#24314D';
  if (b.kind === 'hand') fill = HAND_COLORS[b.need];
  if (b.kind === 'pair') fill = '#FF5C8A';
  c.save();
  // 剩余时间的圆弧
  c.lineWidth = 8;
  c.strokeStyle = 'rgba(10,18,36,0.55)';
  c.beginPath();
  c.arc(b.x, b.y, r + 12, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = lifeLeft < 0.3 ? '#E5484D' : '#F7F5EF';
  c.beginPath();
  c.arc(b.x, b.y, r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lifeLeft);
  c.stroke();
  c.beginPath();
  c.arc(b.x, b.y, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = 'rgba(10,18,36,0.75)';
  c.stroke();
  // 高光
  c.beginPath();
  c.arc(b.x - r * 0.35, b.y - r * 0.35, r * 0.22, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fill();
  c.restore();
  if (b.kind === 'hand') outlinedText(c, b.need === 'left' ? '左' : '右', b.x, b.y + r * 0.36, Math.round(r * 1.05), '#13213C', 'center');
  else if (b.kind === 'gold') outlinedText(c, '★', b.x, b.y + r * 0.36, Math.round(r * 1.1), '#F7F5EF', 'center', BODY_FONT);
  else if (b.kind === 'bomb') {
    outlinedText(c, '×', b.x, b.y + r * 0.4, Math.round(r * 1.3), '#E5484D', 'center', BODY_FONT);
    c.fillStyle = Math.random() < 0.5 ? '#FFC928' : '#FF7A1A';
    c.beginPath();
    c.arc(b.x + r * 0.55, b.y - r * 1.05, 5 + Math.random() * 5, 0, Math.PI * 2);
    c.fill();
  }
};

MoleMode.prototype._drawWorld = function (c, P, t) {
  var w = P.world;
  c.save();
  c.beginPath();
  c.rect(P.x, 0, P.w, H);
  c.clip();
  // 双手球：两个球之间连一条虚线
  var pairs = {};
  for (var i = 0; i < w.balls.length; i++) {
    var b = w.balls[i];
    if (b.kind !== 'pair') continue;
    if (pairs[b.pair]) {
      var a = pairs[b.pair];
      c.save();
      c.strokeStyle = 'rgba(255,92,138,0.9)';
      c.lineWidth = 6;
      if (c.setLineDash) c.setLineDash([16, 12]);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      c.restore();
      outlinedText(c, '两只手一起摸', (a.x + b.x) / 2, a.y - a.r - 26, 32, '#FF5C8A', 'center');
    } else {
      pairs[b.pair] = b;
    }
  }
  for (var j = 0; j < w.balls.length; j++) this._drawBall(c, w.balls[j], w.t, t);
  c.restore();
};

MoleMode.prototype._drawHands = function (c) {
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i];
    for (var s = 0; s < 2; s++) {
      var side = s ? 'right' : 'left';
      var h = P.hands[side];
      if (!h) continue;
      c.beginPath();
      c.arc(h.x, h.y, 22, 0, Math.PI * 2);
      c.fillStyle = HAND_COLORS[side];
      c.globalAlpha = 0.9;
      c.fill();
      c.globalAlpha = 1;
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(10,18,36,0.75)';
      c.stroke();
    }
  }
};

MoleMode.prototype._drawRings = function (c, t) {
  var keep = [];
  for (var i = 0; i < this.rings.length; i++) {
    var r = this.rings[i];
    var a = (t - r.born) / 450;
    if (a >= 1) continue;
    keep.push(r);
    c.globalAlpha = 1 - a;
    c.lineWidth = 10 * (1 - a) + 2;
    c.strokeStyle = r.color;
    c.beginPath();
    c.arc(r.x, r.y, 40 + a * 70, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
  this.rings = keep;
};

MoleMode.prototype._drawHUD = function (c) {
  var w0 = this.slots[0].world;
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i], w = P.world;
    var right = i === 1;
    var x = right ? W - 36 : 36, align = right ? 'right' : 'left';
    outlinedText(c, this.players === 2 ? P.name : '得分', x, 46, 26, this.players === 2 ? P.color : 'rgba(247,245,239,0.9)', align, BODY_FONT);
    outlinedText(c, String(w.score), x, 124, 84, '#F7F5EF', align);
    if (w.combo >= 2) outlinedText(c, w.combo + ' 连中', x, 166, 30, '#FFC928', align);
  }
  drawTimer(c, w0.durationMs - w0.t, w0.durationMs);
  if (this.players === 1) outlinedText(c, '第 ' + (w0.level + 1) + ' 级', W - 36, 70, 38, '#F7F5EF', 'right');
};

MoleMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  var dtc = Math.min(dt, 50);
  var tn = now();
  if (this.env.mock) st.drawMockBackground();
  else st.drawVideo(this.env.video, this.phase === 'play' ? 0.3 : 0.12);
  var i, P;
  if (this.env.settings.skeleton) {
    for (i = 0; i < this.slots.length; i++) {
      if (this.slots[i].pose) drawSkeleton(c, this.slots[i].pose, { alpha: this.phase === 'play' ? 0.45 : 0.9, width: this.phase === 'play' ? 6 : 8, joints: this.phase !== 'play', color: this.players === 2 ? this.slots[i].color : null });
    }
  }
  if (this.players === 2) drawDivider(c);
  if (this.phase === 'space') {
    var ok = drawSpace(c, this.slots, this.players === 2
      ? '两个人一左一右，各站一半，离电视 2 米左右，两只手都在画面里'
      : '站到离电视 2 米左右，上半身和两只手都在画面里就行');
    if (ok) this._startCount(t);
  } else if (this.phase === 'count') {
    if (drawCount(c, t - this.countStart, this.count)) {
      this.phase = 'play';
      var seed = (Date.now() & 0xffff) + 1;
      for (i = 0; i < this.slots.length; i++) {
        P = this.slots[i];
        P.world = new MoleWorld({ age: this.age, seed: seed, rect: { x: P.x, w: P.w }, H: H, durationMs: this.durationMs, mirror: st.mirror });
      }
    }
  } else if (this.phase === 'play') {
    var over = true;
    if (this.env.mock) {
      window.__tdMockHint = this.slots.map(function (S) {
        return { balls: S.world.balls.map(function (b) { return { x: b.x, y: b.y, kind: b.kind, need: b.need, pair: b.pair }; }) };
      });
    }
    for (i = 0; i < this.slots.length; i++) {
      P = this.slots[i];
      if (!this.paused) {
        P.world.update(dtc, P.hands, P.body);
        this._events(P, tn);
        if (P.flash > 0) P.flash = Math.max(0, P.flash - dtc / 330);
      }
      this._drawWorld(c, P, tn);
      if (!P.world.over) over = false;
      if (P.flash > 0) {
        c.globalAlpha = P.flash * 0.35;
        c.fillStyle = '#E5484D';
        c.fillRect(P.x, 0, P.w, H);
        c.globalAlpha = 1;
      }
    }
    if (!this.paused) this.env.onActive(dtc);
    this._drawRings(c, tn);
    this._drawHUD(c);
    if (over) this._end();
  } else if (this.phase === 'result') {
    drawHandsUp(c, this.slots);
  }
  this._drawHands(c);
  this.pops.draw(c, tn);
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

MoleMode.prototype._end = function () {
  this.phase = 'result';
  for (var i = 0; i < this.slots.length; i++) this.slots[i].handsUp.reset();
  sfx.success();
  if (this.players === 2) {
    var a = this.slots[0].world.result(), b = this.slots[1].world.result();
    this.env.finish({ type: 'mole', players: 2, age: this.age, results: [a, b], scores: [a.score, b.score], winner: winnerOf(a.score, b.score) });
    return;
  }
  var r = this.slots[0].world.result();
  r.type = 'mole';
  r.age = this.age;
  r.bestKey = 'mole-' + this.age;
  r.bestValue = r.score;
  this.env.finish(r);
};

function reactionText(ms) { return ms ? (ms / 1000).toFixed(2) + ' 秒' : '—'; }

MoleMode.prototype.resultHTML = function (rec, newBest, best) {
  if (rec.players === 2) {
    var cols = '';
    for (var i = 0; i < 2; i++) {
      var r = rec.results[i];
      var win = rec.winner === (i ? 'right' : 'left');
      cols += '<div class="duo-p' + (win ? ' win' : '') + '"><div class="who" style="color:' + this.slots[i].color + '">' + this.slots[i].name + '</div>' +
        '<div class="big">' + r.score + '<small>分</small></div>' +
        '<div class="stars">' + starText(r.stars) + '</div>' +
        '<div class="lines">摸中 ' + r.hits + ' 个，最快 ' + reactionText(r.bestMs) + '</div></div>';
    }
    return '<h2>敏捷摸球 · 双人</h2><div class="lines winner">' + winnerText(rec.winner) + '</div><div class="duo">' + cols + '</div>';
  }
  var lines = [
    '摸中 ' + rec.hits + ' 个，漏掉 ' + rec.misses + ' 个' + (rec.bombs ? '，碰到炸弹 ' + rec.bombs + ' 次' : ''),
    rec.hits ? '平均 ' + reactionText(rec.avgMs) + ' 摸到，最快 ' + reactionText(rec.bestMs) : '',
    '最多连中 ' + rec.maxCombo + ' 个，最高到第 ' + rec.level + ' 级'
  ];
  return '<h2>敏捷摸球</h2>' +
    '<div class="big">' + rec.score + '<small>分</small>' + (newBest ? '<span class="new">新纪录</span>' : '') + '</div>' +
    '<div class="stars">' + starText(rec.stars) + '</div>' +
    '<div class="lines">' + lines.filter(Boolean).join('<br>') + (best ? '<br>最好成绩 ' + best + ' 分' : '') + '</div>';
};

MoleMode.prototype.dispose = function () { if (this.env.mock) window.__tdMockHint = null; };
