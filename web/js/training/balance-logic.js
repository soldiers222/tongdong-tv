// 金鸡独立 · 判定逻辑（纯逻辑，可在 Node 里测试）
// 输入：像素坐标关键点（横纵同一尺度）+ 时间（毫秒）。
// 口径（建议值，等体育老师标定后再调）：
//   姿势达标：支撑腿膝角 ≥ 160°（6–8 岁 ≥ 150°），抬起腿的膝盖接近或高过髋，脚明显离地
//   失稳：抬起的脚落地 ≥ 0.3 秒，或身体横向偏离 > 0.6 个肩宽 ≥ 0.5 秒
//   晃动：髋部中点相对起始位置的横向偏移 ÷ 肩宽
import { angleAt, dist, mid } from '../core/geometry.js';
import { mean } from '../core/util.js';

var T = 0.35;

export var BALANCE_AGE = {
  '6-8': { targetMs: 20000, kneeMin: 150, liftTol: 0.32, swayGood: 0.12 },
  '9-12': { targetMs: 40000, kneeMin: 160, liftTol: 0.14, swayGood: 0.09 }
};

var READY_MS = 400;
var DOWN_MS = 300;
var OUT_MS = 500;
var OUT_RATIO = 0.6;
var LOST_MS = 1500;

function vis(kp, name) { var p = kp[name]; return !!p && p.s >= T; }

export function sideName(side) { return side === 'left' ? '左' : '右'; }

export function BalanceJudge(opts) {
  opts = opts || {};
  this.stand = opts.stand === 'right' ? 'right' : 'left';
  this.lift = this.stand === 'left' ? 'right' : 'left';
  this.cfg = BALANCE_AGE[opts.age] || BALANCE_AGE['6-8'];
  this.targetMs = opts.targetMs || this.cfg.targetMs;
  this.phase = 'ready';
  this.okSince = null;
  this.holdStart = null;
  this.holdMs = 0;
  this.pausedMs = 0;
  this.lostSince = null;
  this.downSince = null;
  this.outSince = null;
  this.baseX = null;
  this.series = [];     // {t, v} 晃动（带符号，单位：肩宽）
  this.lowLiftMs = 0;
  this.lastT = null;
  this.result = null;
  this.msg = '';
  this.metrics = null;
}

BalanceJudge.prototype.measure = function (kp) {
  var s = this.stand, l = this.lift;
  var need = [s + '_hip', s + '_knee', s + '_ankle', l + '_hip', l + '_knee', l + '_ankle', 'left_shoulder', 'right_shoulder'];
  for (var i = 0; i < need.length; i++) if (!vis(kp, need[i])) return null;
  var shMid = mid(kp.left_shoulder, kp.right_shoulder);
  var hipMid = mid(kp.left_hip, kp.right_hip);
  var torso = Math.max(1, dist(shMid, hipMid));
  var shoulderW = Math.max(1, dist(kp.left_shoulder, kp.right_shoulder));
  var legLen = Math.max(1, dist(kp[s + '_hip'], kp[s + '_knee']) + dist(kp[s + '_knee'], kp[s + '_ankle']));
  var kneeAngle = angleAt(kp[s + '_hip'], kp[s + '_knee'], kp[s + '_ankle']);
  var liftKnee = kp[l + '_knee'], liftHip = kp[l + '_hip'], liftAnk = kp[l + '_ankle'], standAnk = kp[s + '_ankle'];
  var kneeOver = (liftHip.y + this.cfg.liftTol * torso) - liftKnee.y; // ≥ 0 表示抬够高
  return {
    kneeAngle: kneeAngle,
    standStraight: kneeAngle >= this.cfg.kneeMin,
    liftOk: kneeOver >= 0,
    kneeOver: kneeOver / torso,
    footUp: liftAnk.y < standAnk.y - 0.1 * legLen,
    footDown: liftAnk.y >= standAnk.y - 0.04 * legLen,
    hipX: hipMid.x,
    shoulderW: shoulderW,
    torso: torso
  };
};

BalanceJudge.prototype.hint = function (m) {
  if (!m) return '请全身站进画面里';
  if (!m.footUp) return '用' + sideName(this.stand) + '脚站稳，把' + sideName(this.lift) + '脚抬起来';
  if (!m.liftOk) return sideName(this.lift) + '膝盖再抬高一点，抬到腰那么高';
  if (!m.standStraight) return sideName(this.stand) + '腿站直';
  return '保持住！';
};

BalanceJudge.prototype._finish = function (reason, t) {
  this.phase = 'done';
  var vals = [];
  for (var i = 0; i < this.series.length; i++) vals.push(Math.abs(this.series[i].v));
  var avgSway = vals.length ? mean(vals) : 0;
  var hold = this.holdMs;
  var target = this.targetMs;
  // 1 星：站到目标的 25%；2 星：站满目标；3 星：站满且晃动小
  var stars = hold >= target * 0.25 ? 1 : 0;
  if (hold >= target) stars = avgSway <= this.cfg.swayGood ? 3 : 2;
  this.result = {
    stand: this.stand,
    holdMs: Math.round(hold),
    targetMs: target,
    reason: reason,
    avgSway: avgSway,
    stars: stars,
    lowLiftMs: Math.round(this.lowLiftMs),
    series: this.series.slice()
  };
  this.endT = t;
  return this.result;
};

BalanceJudge.prototype.update = function (kp, t) {
  var dt = this.lastT === null ? 0 : Math.max(0, Math.min(200, t - this.lastT));
  this.lastT = t;
  if (this.phase === 'done') return this.state();
  var m = kp ? this.measure(kp) : null;
  this.metrics = m;

  if (this.phase === 'ready') {
    var good = m && m.footUp && m.liftOk && m.standStraight;
    this.msg = this.hint(m);
    if (good) {
      if (this.okSince === null) this.okSince = t;
      if (t - this.okSince >= READY_MS) {
        this.phase = 'hold';
        this.holdStart = t;
        this.holdMs = 0;
        this.pausedMs = 0;
        this.baseX = m.hipX;
        this.msg = '保持住！';
      }
    } else {
      this.okSince = null;
    }
    return this.state();
  }

  // hold 阶段
  if (!m) {
    if (this.lostSince === null) this.lostSince = t;
    this.pausedMs += dt;
    this.msg = '看不到你的腿了，请全身站进画面里';
    if (t - this.lostSince >= LOST_MS) this._finish('lost', t);
    return this.state();
  }
  this.lostSince = null;
  this.holdMs = t - this.holdStart - this.pausedMs;

  var v = (m.hipX - this.baseX) / m.shoulderW;
  this.series.push({ t: Math.round(this.holdMs), v: v });

  if (m.footDown) {
    if (this.downSince === null) this.downSince = t;
    if (t - this.downSince >= DOWN_MS) {
      this.holdMs = Math.max(0, this.downSince - this.holdStart - this.pausedMs);
      this._finish('down', t);
      return this.state();
    }
  } else {
    this.downSince = null;
  }

  if (Math.abs(v) > OUT_RATIO) {
    if (this.outSince === null) this.outSince = t;
    if (t - this.outSince >= OUT_MS) {
      this._finish('sway', t);
      return this.state();
    }
  } else {
    this.outSince = null;
  }

  if (!m.liftOk && !m.footDown) {
    this.lowLiftMs += dt;
    this.msg = sideName(this.lift) + '膝盖再抬高一点';
  } else if (Math.abs(v) > this.cfg.swayGood * 2) {
    this.msg = '站稳，别晃';
  } else {
    this.msg = '保持住！';
  }

  if (this.holdMs >= this.targetMs) {
    this.holdMs = this.targetMs;
    this._finish('target', t);
  }
  return this.state();
};

BalanceJudge.prototype.state = function () {
  var last = this.series.length ? this.series[this.series.length - 1].v : 0;
  return {
    phase: this.phase,
    holdMs: this.holdMs,
    targetMs: this.targetMs,
    msg: this.msg,
    sway: last,
    metrics: this.metrics,
    result: this.result
  };
};

export var REASON_TEXT = {
  down: '脚落地了',
  sway: '身体歪出去了',
  lost: '离开画面了',
  target: '达到目标时间'
};
