// 左右闪避 / 太空躲障碍 · 逻辑（纯逻辑，可在 Node 里测试）
// 三条跑道，障碍物从远处滚过来：
//   左右闪避（side）：大球占住一两条道，往旁边跨一步躲开；星星在空着的道上，站过去就能吃到。
//   太空躲障碍（space）：陨石占道（左右躲）、激光横在头的高度（蹲下）、能量栏贴着地面（跳起来）。
// 判定看障碍到达那一刻前后一小段时间里孩子的状态（识别有延迟，给一点宽限）。
import { rng } from '../core/util.js';

export var DODGE_AGE = {
  '6-8': { durationMs: 60000, travel: 3200, minTravel: 2100, interval: 2300, minInterval: 1400, lives: 3, double: 0.15, duck: 0.25, jump: 0.15 },
  '9-12': { durationMs: 75000, travel: 2700, minTravel: 1650, interval: 1900, minInterval: 1050, lives: 3, double: 0.35, duck: 0.25, jump: 0.25 }
};

// 判定窗口（相对到达时刻，毫秒）
var WIN = {
  block: [-60, 110],   // 这段时间里只要有一刻不在那条道上就算躲开
  coin: [-180, 120],
  laser: [-380, 140],
  bar: [-380, 140]
};
var JUDGE_AFTER = 150;
var HIT_GRACE_MS = 1200; // 被撞后短暂无敌

// opts: variant 'side' | 'space', age, seed, durationMs
export function DodgeWorld(opts) {
  opts = opts || {};
  this.variant = opts.variant === 'space' ? 'space' : 'side';
  this.age = opts.age === '9-12' ? '9-12' : '6-8';
  this.cfg = DODGE_AGE[this.age];
  this.rand = rng(opts.seed || 1);
  this.durationMs = opts.durationMs || this.cfg.durationMs;
  this.t = 0;
  this.objects = [];
  this.history = [];
  this.nextSpawn = 1500;
  this.lastArrive = 0;
  this.lastLane = 1;
  this.lives = this.cfg.lives;
  this.score = 0;
  this.coins = 0;
  this.dodged = 0;
  this.hitsTaken = 0;
  this.safeUntil = -1;
  this.events = [];
  this.over = false;
  this.reason = null;
  this.counts = { block: 0, laser: 0, bar: 0 };
}

DodgeWorld.prototype.drainEvents = function () {
  var e = this.events;
  this.events = [];
  return e;
};

// 难度随时间慢慢加：障碍飞过来的时间变短、间隔变短
DodgeWorld.prototype.progress = function () { return Math.min(1, this.t / this.durationMs); };
DodgeWorld.prototype.travel = function () {
  var c = this.cfg;
  return c.travel + (c.minTravel - c.travel) * this.progress();
};
DodgeWorld.prototype._interval = function () {
  var c = this.cfg;
  return c.interval + (c.minInterval - c.interval) * this.progress();
};

DodgeWorld.prototype._add = function (kind, lane, travel) {
  var o = { kind: kind, lane: lane, t0: this.t, arrive: this.t + travel, judged: false };
  this.objects.push(o);
  return o;
};

DodgeWorld.prototype._spawn = function () {
  var c = this.cfg;
  var travel = this.travel();
  var r = this.rand();
  var kind = 'block';
  if (this.variant === 'space') {
    if (r < c.duck) kind = 'laser';
    else if (r < c.duck + c.jump) kind = 'bar';
  }
  // 开头几个总是单个占道，先熟悉
  if (this.counts.block + this.counts.laser + this.counts.bar < 3) kind = 'block';
  this.counts[kind] += 1;
  if (kind === 'block') {
    var lanes = [0, 1, 2];
    // 优先挡住孩子现在站的道，逼他动起来
    var first = this.rand() < 0.6 ? this.lastLane : lanes[Math.floor(this.rand() * 3)];
    this._add('block', first, travel);
    var free = [0, 1, 2].filter(function (l) { return l !== first; });
    if (this.rand() < c.double * (0.5 + this.progress())) {
      var second = free[Math.floor(this.rand() * 2)];
      this._add('block', second, travel);
      free = free.filter(function (l) { return l !== second; });
    }
    // 空着的道上放星星
    if (this.rand() < 0.7) this._add('coin', free[Math.floor(this.rand() * free.length)], travel);
  } else {
    this._add(kind, null, travel);
  }
  this.lastArrive = this.t + travel;
};

// 这段时间里孩子的状态
DodgeWorld.prototype._window = function (from, to) {
  var out = [];
  for (var i = 0; i < this.history.length; i++) {
    var h = this.history[i];
    if (h.t >= from && h.t <= to) out.push(h);
  }
  // 窗口里一帧都没有（识别卡了）：用窗口之前最近的一帧
  if (!out.length) {
    for (var j = this.history.length - 1; j >= 0; j--) {
      if (this.history[j].t < from) { out.push(this.history[j]); break; }
    }
  }
  return out;
};

DodgeWorld.prototype._judge = function (o) {
  var w = WIN[o.kind];
  var list = this._window(o.arrive + w[0], o.arrive + w[1]);
  var ok = false, i;
  if (o.kind === 'block') {
    ok = list.length === 0;
    for (i = 0; i < list.length; i++) if (list[i].lane !== o.lane) ok = true;
  } else if (o.kind === 'coin') {
    for (i = 0; i < list.length; i++) if (list[i].lane === o.lane) ok = true;
  } else if (o.kind === 'laser') {
    for (i = 0; i < list.length; i++) if (list[i].duck) ok = true;
  } else if (o.kind === 'bar') {
    for (i = 0; i < list.length; i++) if (list[i].air) ok = true;
  }
  if (o.kind === 'coin') {
    if (ok) {
      o.got = true;
      this.coins += 1;
      this.score += 5;
      this.events.push({ type: 'coin', lane: o.lane });
    }
    return;
  }
  if (ok) {
    this.dodged += 1;
    this.score += 10;
    this.events.push({ type: 'dodge', kind: o.kind, lane: o.lane });
  } else if (this.t < this.safeUntil) {
    this.events.push({ type: 'graze', kind: o.kind, lane: o.lane });
  } else {
    this.lives -= 1;
    this.hitsTaken += 1;
    this.safeUntil = this.t + HIT_GRACE_MS;
    this.events.push({ type: 'hit', kind: o.kind, lane: o.lane, lives: this.lives });
    if (this.lives <= 0) {
      this.over = true;
      this.reason = 'lives';
      this.events.push({ type: 'over', reason: 'lives' });
    }
  }
};

// input: {lane: 0|1|2|null, duck, air}（当前这一刻孩子的状态；lane 为 null 表示没认出来，按上一次算）
DodgeWorld.prototype.update = function (dt, input) {
  if (this.over) return;
  this.t += dt;
  input = input || {};
  var lane = input.lane == null ? this.lastLane : input.lane;
  this.lastLane = lane;
  this.history.push({ t: this.t, lane: lane, duck: !!input.duck, air: !!input.air });
  while (this.history.length && this.history[0].t < this.t - 1500) this.history.shift();
  var keep = [];
  for (var i = 0; i < this.objects.length; i++) {
    var o = this.objects[i];
    if (!o.judged && this.t >= o.arrive + JUDGE_AFTER) {
      o.judged = true;
      this._judge(o);
      if (this.over) return;
    }
    // 过了玩家之后再飞一会儿出画面
    if (this.t < o.arrive + 900) keep.push(o);
  }
  this.objects = keep;
  // 下一个障碍：到达时间和上一个至少隔开一段，不会同时要躲又要跳
  if (this.t >= this.nextSpawn && this.t < this.durationMs - this.travel() - 300) {
    var travel = this.travel();
    if (this.t + travel - this.lastArrive >= this._interval() * 0.8) this._spawn();
    this.nextSpawn = this.t + this._interval() * (0.85 + this.rand() * 0.3);
  }
  if (this.t >= this.durationMs) {
    this.over = true;
    this.reason = 'time';
    this.events.push({ type: 'over', reason: 'time' });
  }
};

// 物体离孩子还有多远：1 = 刚出现（最远），0 = 到了，负数 = 已经过去
DodgeWorld.prototype.depth = function (o) {
  var travel = o.arrive - o.t0;
  return (o.arrive - this.t) / travel;
};

DodgeWorld.prototype.result = function () {
  var total = this.dodged + this.hitsTaken;
  var survived = this.reason === 'time';
  var stars = survived ? (this.hitsTaken === 0 ? 3 : (this.hitsTaken === 1 ? 2 : 1)) : (this.dodged >= 10 ? 1 : 0);
  return {
    variant: this.variant,
    score: this.score,
    dodged: this.dodged,
    hits: this.hitsTaken,
    coins: this.coins,
    lives: this.lives,
    survived: survived,
    timeMs: Math.round(Math.min(this.t, this.durationMs)),
    accuracy: total ? this.dodged / total : 0,
    stars: stars
  };
};

// ---------- 站在哪条道：以开始时站的位置为中间道，往旁边跨大约一个肩宽换道 ----------
export function LaneTracker() {
  this.x0 = null;
  this.sw0 = null;
  this.lane = 1;
}

LaneTracker.prototype.calibrate = function (x, sw) {
  this.x0 = x;
  this.sw0 = Math.max(1, sw);
  this.lane = 1;
};

LaneTracker.prototype.ready = function () { return this.x0 !== null; };

// x：髋部中点在屏幕上的横坐标（已镜像）；返回 0 左、1 中、2 右（屏幕上的左右）
LaneTracker.prototype.update = function (x) {
  if (this.x0 === null || x == null) return null;
  var d = (x - this.x0) / this.sw0;
  var IN = 0.8, OUT = 0.5; // 迟滞：进旁边的道要跨够，回中间稍微回来一点就行
  if (this.lane === 1) {
    if (d < -IN) this.lane = 0;
    else if (d > IN) this.lane = 2;
  } else if (this.lane === 0) {
    if (d > IN) this.lane = 2;
    else if (d > -OUT) this.lane = 1;
  } else {
    if (d < -IN) this.lane = 0;
    else if (d < OUT) this.lane = 1;
  }
  return this.lane;
};

// 偏离中间道多少（单位：一条道），画小人用
LaneTracker.prototype.offset = function (x) {
  if (this.x0 === null || x == null) return 0;
  return (x - this.x0) / this.sw0 / 1.0;
};
