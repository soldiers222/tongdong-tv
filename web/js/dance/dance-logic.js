// 跟跳练舞 · 判定（纯逻辑，可在 Node 里测试）
//   动作相似度：比较大臂、小臂、大腿、小腿的方向（摄像头只看得到正面，比方向比比位置可靠，也不受高矮胖瘦影响）
//   卡点：每个要打分的关键帧，在节拍前后一小段时间里取最像的一帧（识别有延迟，往后多给一点）
//   纠错：最不像的那条胳膊或腿，说清楚往哪边改
import { figure, blend } from '../core/figure.js';

var SEGS = [
  ['left_shoulder', 'left_elbow', 1, 'leftArm'], ['left_elbow', 'left_wrist', 1, 'leftArm'],
  ['right_shoulder', 'right_elbow', 1, 'rightArm'], ['right_elbow', 'right_wrist', 1, 'rightArm'],
  ['left_hip', 'left_knee', 0.6, 'leftLeg'], ['left_knee', 'left_ankle', 0.5, 'leftLeg'],
  ['right_hip', 'right_knee', 0.6, 'rightLeg'], ['right_knee', 'right_ankle', 0.5, 'rightLeg']
];
var T = 0.3;

export var GRADES = [
  { min: 0.85, id: 'perfect', text: '完美', pts: 100, color: '#FFC928' },
  { min: 0.7, id: 'great', text: '很棒', pts: 70, color: '#3FBF6A' },
  { min: 0.5, id: 'good', text: '不错', pts: 40, color: '#7FD6FF' },
  { min: -1, id: 'miss', text: '加油', pts: 0, color: '#F7F5EF' }
];

export function gradeOf(score) {
  for (var i = 0; i < GRADES.length; i++) if (score >= GRADES[i].min) return GRADES[i];
  return GRADES[GRADES.length - 1];
}

function vis(p) { return p && p.s >= T; }

function dir(a, b) {
  var dx = b.x - a.x, dy = b.y - a.y;
  var l = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / l, y: dy / l };
}

// 示范姿势（figure 参数）→ 像素关键点（1280×720 的画面里）
export function targetPx(pose) {
  var f = figure(pose);
  var out = {};
  for (var k in f) out[k] = { x: f[k].x * 1280, y: f[k].y * 720, s: 1 };
  return out;
}

function angle(a, b, c, d) {
  var d1 = dir(a, b), d2 = dir(c, d);
  var dot = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y));
  return Math.acos(dot) * 180 / Math.PI;
}

var NEUTRAL = null;

// 每段肢体的权重：和自然站立差得越多的越重要（这个舞步要动的就是它们）
export function weightsFor(tgt) {
  if (!NEUTRAL) NEUTRAL = targetPx({});
  var w = [];
  for (var i = 0; i < SEGS.length; i++) {
    var s = SEGS[i];
    var diff = angle(NEUTRAL[s[0]], NEUTRAL[s[1]], tgt[s[0]], tgt[s[1]]);
    w.push(s[2] * (0.4 + 3.6 * Math.min(1, diff / 35)));
  }
  return w;
}

// kp：孩子的像素关键点（摄像头原始画面，未镜像）；tgt：targetPx() 的结果；weights：weightsFor(tgt)，可省略
// 返回 {score 0–1, groups: {leftArm, rightArm, leftLeg, rightLeg}}；看到的关节太少返回 null
export function similarity(kp, tgt, weights) {
  if (!kp) return null;
  var tot = 0, wsum = 0, base = 0, g = {}, gw = {};
  for (var i = 0; i < SEGS.length; i++) {
    var s = SEGS[i];
    var a = kp[s[0]], b = kp[s[1]];
    if (!vis(a) || !vis(b)) continue;
    var ang = angle(a, b, tgt[s[0]], tgt[s[1]]);
    // 差 12° 以内满分，差 60° 以上零分
    var sc = Math.max(0, Math.min(1, 1 - (ang - 12) / 48));
    var w = weights ? weights[i] : s[2];
    tot += sc * w;
    wsum += w;
    base += s[2];
    g[s[3]] = (g[s[3]] || 0) + sc * w;
    gw[s[3]] = (gw[s[3]] || 0) + w;
  }
  if (base < 2.5) return null;
  var groups = {};
  for (var k in g) groups[k] = g[k] / gw[k];
  return { score: tot / wsum, groups: groups };
}

var NAMES = { leftArm: '左手', rightArm: '右手', leftLeg: '左腿', rightLeg: '右腿' };

// 纠错提示：比较最不像的那条胳膊 / 腿的末端位置（以肩或髋为原点，躯干长为单位）
export function tipFor(kp, tgt, sim) {
  if (!sim) return null;
  var worst = null, ws = 1;
  for (var k in sim.groups) if (sim.groups[k] < ws) { ws = sim.groups[k]; worst = k; }
  if (!worst || ws >= 0.6) return null;
  var side = worst.indexOf('left') === 0 ? 'left' : 'right';
  var arm = worst.indexOf('Arm') > 0;
  function frame(p) {
    var sh = { x: (p.left_shoulder.x + p.right_shoulder.x) / 2, y: (p.left_shoulder.y + p.right_shoulder.y) / 2 };
    var hp = { x: (p.left_hip.x + p.right_hip.x) / 2, y: (p.left_hip.y + p.right_hip.y) / 2 };
    var tor = Math.max(1, Math.sqrt((sh.x - hp.x) * (sh.x - hp.x) + (sh.y - hp.y) * (sh.y - hp.y)));
    return { o: arm ? sh : hp, tor: tor };
  }
  if (!vis(kp.left_shoulder) || !vis(kp.right_shoulder) || !vis(kp.left_hip) || !vis(kp.right_hip)) return null;
  var fp = frame(kp), ft = frame(tgt);
  var end = arm ? side + '_wrist' : side + '_knee';
  var foot = side + '_ankle';
  if (!vis(kp[end])) return null;
  var p = { x: (kp[end].x - fp.o.x) / fp.tor, y: (kp[end].y - fp.o.y) / fp.tor };
  var q = { x: (tgt[end].x - ft.o.x) / ft.tor, y: (tgt[end].y - ft.o.y) / ft.tor };
  var name = NAMES[worst];
  if (arm) {
    if (p.y - q.y > 0.3) return name + '再举高一点';
    if (q.y - p.y > 0.3) return name + '放低一点';
    if (Math.abs(q.x) - Math.abs(p.x) > 0.3) return name + '往外伸开';
    if (Math.abs(p.x) - Math.abs(q.x) > 0.3) return name + '往里收一点';
    return name + '的样子再像一点';
  }
  if (p.y - q.y > 0.25) return (side === 'left' ? '左' : '右') + '膝盖抬起来';
  if (q.y - p.y > 0.25) return (side === 'left' ? '左' : '右') + '脚放下来';
  if (vis(kp[foot])) {
    var pf = (kp[foot].x - fp.o.x) / fp.tor, qf = (tgt[foot].x - ft.o.x) / ft.tor;
    if (Math.abs(qf) - Math.abs(pf) > 0.3) return (side === 'left' ? '左' : '右') + '脚往外迈';
    if (Math.abs(pf) - Math.abs(qf) > 0.3) return '两脚收回来一点';
  }
  if (sim.groups[worst] < 0.4) return name + '的样子再像一点';
  return null;
}

function smooth(f) { return f * f * (3 - 2 * f); }

// 示范小人在第 beat 拍的姿势：每个关键帧卡在拍子上，前半拍开始过渡
export function coachPose(keys, beat) {
  if (!keys.length) return {};
  if (beat <= keys[0].beat) {
    var f0 = 1 - Math.min(1, (keys[0].beat - beat) / 0.5);
    return blend({}, keys[0].pose, smooth(Math.max(0, f0)));
  }
  var i = 0;
  while (i + 1 < keys.length && keys[i + 1].beat <= beat) i++;
  if (i + 1 >= keys.length) return keys[i].pose;
  var a = keys[i], b = keys[i + 1];
  var tr = Math.min(0.5, (b.beat - a.beat) * 0.5);
  var f = (beat - (b.beat - tr)) / tr;
  if (f <= 0) return a.pose;
  return blend(a.pose, b.pose, smooth(Math.min(1, f)));
}

// ---------- 整支舞的打分 ----------
var WIN_BEFORE = 0.25, WIN_AFTER = 0.45; // 秒

// keys：timeline() 的结果；bpm
export function DanceJudge(keys, bpm) {
  this.keys = keys;
  this.spb = 60 / bpm;
  this.slots = [];
  for (var i = 0; i < keys.length; i++) {
    if (!keys[i].score) continue;
    var tgt = targetPx(keys[i].pose);
    this.slots.push({ i: i, t: keys[i].beat * this.spb, tgt: tgt, w: weightsFor(tgt), best: null, bestKp: null, done: false, grade: null, tip: null });
  }
  this.next = 0;
  this.points = 0;
  this.combo = 0;
  this.maxCombo = 0;
  this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  this.tips = {};
  this.scores = [];
  this.events = [];
}

// 收到一帧：kp 像素关键点（可为 null），ts 这一帧对应的歌曲时间（秒）
DanceJudge.prototype.add = function (kp, ts) {
  for (var j = this.next; j < this.slots.length; j++) {
    var s = this.slots[j];
    if (ts < s.t - WIN_BEFORE) break;
    if (s.done || ts > s.t + WIN_AFTER) continue;
    var sim = similarity(kp, s.tgt, s.w);
    if (sim && (!s.best || sim.score > s.best.score)) {
      s.best = sim;
      s.bestKp = kp;
    }
  }
};

// now：现在的歌曲时间（秒）。窗口结束后再等一会儿（迟到的帧）才出结果
DanceJudge.prototype.update = function (now) {
  this.events = [];
  while (this.next < this.slots.length) {
    var s = this.slots[this.next];
    if (now < s.t + WIN_AFTER + 0.25) break;
    this._settle(s);
    this.next += 1;
  }
  return this.events;
};

DanceJudge.prototype._settle = function (s) {
  s.done = true;
  var score = s.best ? s.best.score : 0;
  var g = gradeOf(score);
  s.grade = g.id;
  this.counts[g.id] += 1;
  this.points += g.pts;
  this.scores.push(score);
  if (g.id === 'miss') this.combo = 0;
  else {
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
  }
  if (g.id === 'good' || g.id === 'miss') {
    s.tip = s.best ? tipFor(s.bestKp, s.tgt, s.best) : '跟着示范做动作';
    if (s.tip) this.tips[s.tip] = (this.tips[s.tip] || 0) + 1;
  }
  this.events.push({ type: 'grade', grade: g, score: score, tip: s.tip, combo: this.combo, key: this.keys[s.i] });
};

// 跳完了（或中途结束）把剩下的都结算
DanceJudge.prototype.finish = function () {
  while (this.next < this.slots.length) {
    this._settle(this.slots[this.next]);
    this.next += 1;
  }
};

DanceJudge.prototype.result = function () {
  var n = this.slots.length;
  var frac = n ? this.points / (n * 100) : 0;
  var top = null, topN = 0;
  for (var k in this.tips) if (this.tips[k] > topN) { top = k; topN = this.tips[k]; }
  return {
    points: this.points,
    max: n * 100,
    frac: frac,
    counts: this.counts,
    maxCombo: this.maxCombo,
    stars: frac >= 0.75 ? 3 : (frac >= 0.55 ? 2 : (frac >= 0.3 ? 1 : 0)),
    tip: top,
    tipN: topN
  };
};
