// AI 动作训练 · 判定（纯逻辑，可在 Node 里测试）。两类：
//   计次（rep）：动作到位（active）→ 回到预备（rest）算一次，比如下蹲、开合跳、冲拳；
//               分左右的动作（sides）左右各自计数，提醒左右轮流；
//   保持（hold）：所有要点同时满足时计时，比如瑜伽、马步、单脚平衡。
// 输入是像素坐标的关键点（横纵同一尺度）和时间（毫秒）。动作定义见 exercises.js。
import { has, Baseline } from '../core/body.js';

var MIN_ACTIVE_MS = 120;  // 到位要保持这么久才算（去抖）
var MIN_REP_MS = 350;     // 两次之间至少隔这么久
var LOST_MSG = '请站进画面里，让摄像头看到全身';

export function RepJudge(def, opts) {
  opts = opts || {};
  this.def = def;
  this.age = opts.age === '9-12' ? '9-12' : '6-8';
  this.target = opts.target || def.target[this.age];
  this.limitMs = opts.limitMs || Math.max(45000, this.target * 4000);
  this.base = opts.base || new Baseline();
  this.reason = null;
  this.reps = 0;
  this.good = 0;
  this.counts = { left: 0, right: 0, both: 0 };
  this.st = { left: 'rest', right: 'rest', both: 'rest' };
  this.since = { left: null, right: null, both: null };
  this.peak = { left: null, right: null, both: null };
  this.started = { left: null, right: null, both: null };
  this.lastRepT = -1e9;
  this.lastSide = null;
  this.sameSide = 0;
  this.msg = def.cue;
  this.tip = null;       // 最近一次动作的纠正提示
  this.tipT = 0;
  this.done = false;
  this.okNow = false;
  this.startT = null;
  this.endT = null;
}

RepJudge.prototype._repDone = function (side, t) {
  var d = this.def;
  var fault = d.quality ? d.quality(this.peak[side], this.age, side, this.started[side], t) : null;
  this.reps += 1;
  this.counts[side] += 1;
  this.lastRepT = t;
  if (!fault) this.good += 1;
  // 左右轮流的动作：同一边连做三次提醒换边（弓步这类不分左右计数的，由 sideOf 说出这次是哪边）
  var which = d.sides ? side : (d.sideOf ? d.sideOf(this.peak[side]) : null);
  if (which && d.alternate) {
    if (this.lastSide === which) this.sameSide += 1;
    else this.sameSide = 0;
    this.lastSide = which;
    if (!fault && this.sameSide >= 2) fault = '换另一边';
  }
  this.tip = fault;
  this.tipT = t;
  this.events.push({ type: 'rep', side: which || side, n: this.reps, good: !fault, tip: fault });
  if (this.reps >= this.target) {
    this.done = true;
    this.endT = t;
    this.reason = 'target';
  }
};

RepJudge.prototype._step = function (side, m, t) {
  var d = this.def;
  var cur = m[side] || m;
  if (this.st[side] === 'rest') {
    if (d.active(cur, this.age)) {
      if (this.since[side] === null) {
        this.since[side] = t;
        this.peak[side] = cur;
      }
      if (d.better && d.better(cur, this.peak[side])) this.peak[side] = cur;
      if (t - this.since[side] >= MIN_ACTIVE_MS) this.st[side] = 'active';
    } else {
      this.since[side] = null;
      // 动作开始的时刻（太极要量出手的快慢）
      if (d.moving && d.moving(cur)) {
        if (this.started[side] === null) this.started[side] = t;
      } else {
        this.started[side] = null;
      }
    }
  } else {
    if (d.better && d.better(cur, this.peak[side])) this.peak[side] = cur;
    if (d.rest(cur, this.age)) {
      this.st[side] = 'rest';
      this.since[side] = null;
      if (t - this.lastRepT >= MIN_REP_MS) this._repDone(side, t);
      this.started[side] = null;
    }
  }
  return this.st[side] === 'active';
};

RepJudge.prototype.update = function (kp, t) {
  this.events = [];
  if (this.done) return this.state();
  if (this.startT === null) this.startT = t;
  if (t - this.startT >= this.limitMs) {
    // 时间到了还没做完：按做了多少算
    this.done = true;
    this.endT = t;
    this.reason = 'time';
    return this.state();
  }
  var d = this.def;
  if (!kp || !has(kp, d.need)) {
    this.okNow = false;
    this.msg = d.needMsg || LOST_MSG;
    return this.state();
  }
  this.base.add(kp);
  var m = d.measure(kp, this.base, this.age);
  if (!m) {
    this.msg = d.needMsg || LOST_MSG;
    this.okNow = false;
    return this.state();
  }
  var active = false;
  if (d.sides) {
    var a = this._step('left', m, t);
    var b = this._step('right', m, t);
    active = a || b;
  } else {
    active = this._step('both', m, t);
  }
  this.okNow = active;
  if (this.tip && t - this.tipT < 2500) this.msg = this.tip;
  else this.msg = d.cue;
  return this.state();
};

RepJudge.prototype.state = function () {
  return {
    kind: 'rep',
    reps: this.reps,
    good: this.good,
    target: this.target,
    counts: this.counts,
    msg: this.msg,
    okNow: this.okNow,
    done: this.done,
    events: this.events || []
  };
};

RepJudge.prototype.result = function () {
  var acc = this.reps ? this.good / this.reps : 0;
  var stars = this.reps >= this.target ? (acc >= 0.8 ? 3 : 2) : (this.reps >= this.target / 2 ? 1 : 0);
  return {
    id: this.def.id,
    kind: 'rep',
    reps: this.reps,
    good: this.good,
    target: this.target,
    accuracy: acc,
    stars: stars,
    reason: this.reason,
    ms: this.endT !== null && this.startT !== null ? this.endT - this.startT : null
  };
};

// ---------- 保持 ----------
var GRACE_MS = 300;   // 偶尔一两帧没认准不中断计时

export function HoldJudge(def, opts) {
  opts = opts || {};
  this.def = def;
  this.age = opts.age === '9-12' ? '9-12' : '6-8';
  this.side = opts.side || null;
  this.holdMs = opts.holdMs || def.hold[this.age];
  this.limitMs = opts.limitMs || Math.max(30000, this.holdMs * 3);
  this.base = opts.base || new Baseline();
  this.held = 0;
  this.lastT = null;
  this.badSince = null;
  this.startT = null;
  this.msg = def.cue;
  this.okNow = false;
  this.done = false;
  this.reason = null;
  this.events = [];
}

HoldJudge.prototype.update = function (kp, t) {
  this.events = [];
  if (this.done) return this.state();
  if (this.startT === null) this.startT = t;
  var dt = this.lastT === null ? 0 : Math.max(0, Math.min(200, t - this.lastT));
  this.lastT = t;
  var d = this.def;
  var fail = null;
  if (!kp || !has(kp, d.need)) fail = d.needMsg || LOST_MSG;
  else {
    this.base.add(kp);
    var checks = d.checks(kp, this.side, this.age, this.base);
    for (var i = 0; i < checks.length; i++) {
      if (!checks[i][0]) { fail = checks[i][1]; break; }
    }
  }
  if (!fail) {
    this.badSince = null;
    this.okNow = true;
    this.held += dt;
    this.msg = '保持住！';
  } else {
    if (this.badSince === null) this.badSince = t;
    if (t - this.badSince < GRACE_MS && this.okNow) {
      this.held += dt;
    } else {
      this.okNow = false;
      this.msg = fail;
    }
  }
  if (this.held >= this.holdMs) {
    this.held = this.holdMs;
    this.done = true;
    this.reason = 'target';
    this.events.push({ type: 'done' });
  } else if (t - this.startT >= this.limitMs) {
    this.done = true;
    this.reason = 'time';
    this.events.push({ type: 'done' });
  }
  return this.state();
};

HoldJudge.prototype.state = function () {
  return {
    kind: 'hold',
    held: this.held,
    target: this.holdMs,
    msg: this.msg,
    okNow: this.okNow,
    done: this.done,
    events: this.events
  };
};

HoldJudge.prototype.result = function () {
  var f = this.held / this.holdMs;
  var stars = f >= 1 ? 3 : (f >= 0.6 ? 2 : (f >= 0.25 ? 1 : 0));
  return { id: this.def.id, kind: 'hold', side: this.side, holdMs: Math.round(this.held), target: this.holdMs, reason: this.reason, stars: stars };
};

export function makeJudge(def, opts) {
  return def.kind === 'hold' ? new HoldJudge(def, opts) : new RepJudge(def, opts);
}
