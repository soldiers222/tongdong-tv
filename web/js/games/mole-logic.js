// 敏捷摸球 · 逻辑（纯逻辑，可在 Node 里测试）
// 球出现在孩子身边、伸手够得到的地方，用手去摸：越快摸到分越高。
//   写着「左」「右」的球要用那只手摸（练左右分辨）；两个连着的「双手球」要两只手同时摸；
//   金球分高；炸弹球（9–12 岁）别碰。连续摸中会加快，连续漏掉会放慢。
// 坐标都是画布坐标（已镜像，和孩子在屏幕上看到的一致），时间是毫秒。
import { rng } from '../core/util.js';

export var MOLE_AGE = {
  '6-8': { durationMs: 60000, interval: 1500, life: 2900, minInterval: 750, minLife: 1500, maxBalls: 2, r: 48, bomb: 0, hand: 0.15, pair: 0.08, gold: 0.06 },
  '9-12': { durationMs: 60000, interval: 1150, life: 2300, minInterval: 600, minLife: 1200, maxBalls: 3, r: 42, bomb: 0.12, hand: 0.3, pair: 0.12, gold: 0.06 }
};

var HAND_R = 30;       // 手的判定半径
var PAIR_MS = 600;     // 双手球两只手前后相差多久以内算同时
var UP_AFTER = 6;      // 连续摸中几个加快
var DOWN_AFTER = 3;    // 连续漏掉几个放慢

// opts: age, seed, rect {x, w}（这个人的那块屏幕，双人时一人一半）, H, durationMs,
//       mirror（画面是否镜像：镜像时孩子的左手在屏幕左边）
export function MoleWorld(opts) {
  opts = opts || {};
  this.mirror = opts.mirror !== false;
  this.age = opts.age === '9-12' ? '9-12' : '6-8';
  this.cfg = MOLE_AGE[this.age];
  this.rand = rng(opts.seed || 1);
  this.rect = opts.rect || { x: 0, w: 1280 };
  this.H = opts.H || 720;
  this.durationMs = opts.durationMs || this.cfg.durationMs;
  this.t = 0;
  this.balls = [];
  this.nextSpawn = 600;
  this.nextId = 1;
  this.score = 0;
  this.hits = 0;
  this.misses = 0;
  this.bombsHit = 0;
  this.combo = 0;
  this.maxCombo = 0;
  this.streakMiss = 0;
  this.level = 0;
  this.interval = this.cfg.interval;
  this.life = this.cfg.life;
  this.reactions = [];
  this.events = [];
  this.over = false;
}

MoleWorld.prototype.drainEvents = function () {
  var e = this.events;
  this.events = [];
  return e;
};

// 在身体周围找一个放球的位置：肩膀中点为圆心，0.6–1.15 个躯干长，左右和上方（略低于肩也行）
MoleWorld.prototype._place = function (body, hands, r) {
  var x0 = this.rect.x + r + 12, x1 = this.rect.x + this.rect.w - r - 12;
  var y0 = 70 + r, y1 = this.H - 60 - r;
  for (var k = 0; k < 16; k++) {
    var a = (-200 + this.rand() * 220) * Math.PI / 180;
    var d = (0.6 + this.rand() * 0.55) * body.reach;
    var x = body.x + Math.cos(a) * d, y = body.y + Math.sin(a) * d;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    var ok = true;
    for (var i = 0; i < this.balls.length && ok; i++) {
      var b = this.balls[i];
      if ((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) < Math.pow(b.r + r + 40, 2)) ok = false;
    }
    // 别正好放在手上，要伸手去够
    for (var h in hands) {
      var p = hands[h];
      if (ok && p && (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < Math.pow(r + HAND_R + 60, 2)) ok = false;
    }
    // 别压在脸上
    if (ok && body.head && (body.head.x - x) * (body.head.x - x) + (body.head.y - y) * (body.head.y - y) < Math.pow(r + body.reach * 0.35, 2)) ok = false;
    if (ok) return { x: x, y: y };
  }
  return null;
};

MoleWorld.prototype._spawn = function (body, hands) {
  var c = this.cfg, r = c.r;
  var roll = this.rand();
  var kind = 'ball';
  if (roll < c.bomb) kind = 'bomb';
  else if (roll < c.bomb + c.pair) kind = 'pair';
  else if (roll < c.bomb + c.pair + c.gold) kind = 'gold';
  else if (roll < c.bomb + c.pair + c.gold + c.hand) kind = 'hand';
  var free = c.maxBalls - this.balls.length;
  if (kind === 'pair') {
    if (free < 2) kind = 'ball';
    else {
      // 一左一右，在肩膀两侧差不多高的位置
      var y = body.y - body.reach * (0.1 + this.rand() * 0.5);
      var dx = body.reach * (0.75 + this.rand() * 0.25);
      var lx = body.x - dx, rx = body.x + dx;
      var lo = this.rect.x + r + 12, hi = this.rect.x + this.rect.w - r - 12;
      if (lx < lo || rx > hi || y < 70 + r) kind = 'ball';
      else {
        var id = this.nextId++;
        this.balls.push({ id: this.nextId++, pair: id, kind: 'pair', x: lx, y: y, r: r, born: this.t, life: this.life * 1.3, touchT: null });
        this.balls.push({ id: this.nextId++, pair: id, kind: 'pair', x: rx, y: y, r: r, born: this.t, life: this.life * 1.3, touchT: null });
        this.events.push({ type: 'spawn', kind: 'pair' });
        return;
      }
    }
  }
  var pos = this._place(body, hands, r);
  if (!pos) return;
  var ball = { id: this.nextId++, kind: kind, x: pos.x, y: pos.y, r: r, born: this.t, life: kind === 'bomb' ? this.life * 0.9 : this.life, need: null, wrongT: -1e9 };
  if (kind === 'hand') {
    // 一般用同一边的手（镜像画面里左手在屏幕左边），9–12 岁偶尔反过来练交叉
    var near = (pos.x < body.x) === this.mirror ? 'left' : 'right';
    var cross = this.age === '9-12' && this.rand() < 0.35;
    ball.need = cross ? (near === 'left' ? 'right' : 'left') : near;
  }
  this.balls.push(ball);
  this.events.push({ type: 'spawn', kind: kind });
};

function touching(b, p) {
  if (!p) return false;
  var rr = b.r + HAND_R;
  return (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y) <= rr * rr;
}

MoleWorld.prototype._hit = function (b, hand, extra) {
  var reaction = this.t - b.born;
  var pts = 10;
  if (reaction <= 700) pts += 10;
  else if (reaction <= 1200) pts += 5;
  if (b.kind === 'gold') pts += 20;
  if (b.kind === 'hand') pts += 5;
  if (extra) pts += extra;
  this.combo += 1;
  this.maxCombo = Math.max(this.maxCombo, this.combo);
  pts += 2 * Math.min(this.combo - 1, 5);
  this.score += pts;
  this.hits += 1;
  this.streakMiss = 0;
  this.reactions.push(reaction);
  this.events.push({ type: 'hit', x: b.x, y: b.y, pts: pts, reaction: reaction, hand: hand, kind: b.kind, combo: this.combo });
  if (this.combo > 0 && this.combo % UP_AFTER === 0) this._level(1);
};

MoleWorld.prototype._miss = function (b) {
  this.misses += 1;
  this.combo = 0;
  this.streakMiss += 1;
  this.events.push({ type: 'miss', x: b.x, y: b.y, kind: b.kind });
  if (this.streakMiss >= DOWN_AFTER) {
    this.streakMiss = 0;
    this._level(-1);
  }
};

MoleWorld.prototype._level = function (d) {
  var c = this.cfg;
  if (d > 0) {
    if (this.interval <= c.minInterval && this.life <= c.minLife) return;
    this.level += 1;
    this.interval = Math.max(c.minInterval, this.interval * 0.88);
    this.life = Math.max(c.minLife, this.life * 0.9);
  } else {
    if (this.level <= 0) return;
    this.level -= 1;
    this.interval = Math.min(c.interval, this.interval / 0.88);
    this.life = Math.min(c.life, this.life / 0.9);
  }
  this.events.push({ type: 'level', up: d > 0, level: this.level });
};

// hands: {left: {x,y}|null, right: {x,y}|null}；body: {x, y, reach, head}|null（肩膀中点、够得着的距离、头）
MoleWorld.prototype.update = function (dt, hands, body) {
  if (this.over) return;
  this.t += dt;
  hands = hands || {};
  var keep = [];
  var pairDone = {};
  for (var i = 0; i < this.balls.length; i++) {
    var b = this.balls[i];
    var hand = touching(b, hands.left) ? 'left' : (touching(b, hands.right) ? 'right' : null);
    if (b.kind === 'bomb') {
      if (hand) {
        this.score = Math.max(0, this.score - 10);
        this.bombsHit += 1;
        this.combo = 0;
        this.events.push({ type: 'bomb', x: b.x, y: b.y });
        continue;
      }
      if (this.t - b.born >= b.life) { this.events.push({ type: 'gone', x: b.x, y: b.y }); continue; }
      keep.push(b);
      continue;
    }
    if (b.kind === 'pair') {
      if (hand) b.touchT = this.t;
      keep.push(b);
      continue;
    }
    if (hand && b.need && hand !== b.need) {
      // 另一只手也碰到了就算对
      var other = b.need === 'left' ? hands.left : hands.right;
      if (touching(b, other)) hand = b.need;
      else {
        if (this.t - b.wrongT > 800) {
          this.events.push({ type: 'wrongHand', need: b.need, x: b.x, y: b.y });
          b.wrongT = this.t;
        }
        hand = null;
      }
    }
    if (hand) { this._hit(b, hand); continue; }
    if (this.t - b.born >= b.life) { this._miss(b); continue; }
    keep.push(b);
  }
  // 双手球：两只球都在 PAIR_MS 以内被摸到
  var out = [];
  for (var j = 0; j < keep.length; j++) {
    var p = keep[j];
    if (p.kind !== 'pair' || pairDone[p.pair]) { if (!pairDone[p.pair]) out.push(p); continue; }
    var mate = null;
    for (var k = 0; k < keep.length; k++) if (keep[k] !== p && keep[k].pair === p.pair) mate = keep[k];
    if (mate && p.touchT !== null && mate.touchT !== null && Math.abs(p.touchT - mate.touchT) <= PAIR_MS) {
      pairDone[p.pair] = true;
      this._hit({ x: (p.x + mate.x) / 2, y: p.y, born: p.born, kind: 'pair' }, 'both', 20);
      continue;
    }
    if (this.t - p.born >= p.life) {
      pairDone[p.pair] = true;
      this._miss({ x: (p.x + (mate ? mate.x : p.x)) / 2, y: p.y, kind: 'pair' });
      continue;
    }
    out.push(p);
  }
  this.balls = out.filter(function (b) { return !(b.kind === 'pair' && pairDone[b.pair]); });
  if (this.t >= this.nextSpawn && this.t < this.durationMs - 800) {
    if (body && this.balls.length < this.cfg.maxBalls) this._spawn(body, hands);
    this.nextSpawn = this.t + this.interval * (0.8 + this.rand() * 0.4);
  }
  if (this.t >= this.durationMs) {
    this.over = true;
    this.balls = [];
    this.events.push({ type: 'over' });
  }
};

MoleWorld.prototype.accuracy = function () {
  var n = this.hits + this.misses;
  return n ? this.hits / n : 0;
};

MoleWorld.prototype.result = function () {
  var acc = this.accuracy();
  var avg = 0;
  for (var i = 0; i < this.reactions.length; i++) avg += this.reactions[i];
  avg = this.reactions.length ? avg / this.reactions.length : 0;
  var best = this.reactions.length ? Math.min.apply(null, this.reactions) : 0;
  var stars = this.hits >= 10 && acc >= 0.8 ? 3 : (acc >= 0.6 && this.hits >= 6 ? 2 : (acc >= 0.35 && this.hits >= 3 ? 1 : 0));
  return {
    score: this.score,
    hits: this.hits,
    misses: this.misses,
    bombs: this.bombsHit,
    accuracy: acc,
    avgMs: Math.round(avg),
    bestMs: Math.round(best),
    maxCombo: this.maxCombo,
    level: this.level + 1,
    stars: stars
  };
};
