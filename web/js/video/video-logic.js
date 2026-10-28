// 跟着视频跳 · 判定（纯逻辑，可在 Node 里测试）
//
// 视频里老师的动作（MoveNet 识别）和孩子的动作（摄像头）比四肢的方向，和跟跳练舞用同一套相似度。
// 难点是时间对不上：孩子看到老师做了才跟着做，总要慢半拍到一拍；跳熟了的孩子还会抢拍。
// 办法：同时试很多种「孩子比视频慢多少」（-0.3 到 1.6 秒，每 0.1 秒一档），再分「照镜子跳」和「同一边跳」，
// 每种假设看最近 8 秒像不像，选最像的那种；每一帧取这个延迟前后 0.3 秒里最像的老师动作打分。
// 这样站着不动的孩子拿不到高分：他只在老师刚好站着的那几刻像，不管假设慢多少都一样。
// 每 2 秒出一次评级（完美 / 很棒 / 不错 / 加油），和跟跳练舞一样计分、连击。
// 老师站在原地不怎么动、又是普通站姿（在说话、等音乐）的那 2 秒不评；视频里看不到老师时按孩子的运动量评。
import { similarity, weightsFor, tipFor, gradeOf, targetPx } from '../dance/dance-logic.js';

export var BLOCK = 2;            // 秒：多久出一次评级
export var LAG_MIN = -0.3;       // 秒：孩子比视频慢多少（负数 = 抢拍）
export var LAG_MAX = 1.6;
var LAG_STEP = 0.1;
var LAG_SLACK = 0.2;             // 每一帧在最佳延迟前后这么多秒里找最像的
var TAU = 8;                     // 秒：最佳延迟看最近多久的表现
var NEAREST = 0.16;              // 秒：某一刻老师的动作 = 前后这么多秒里最近的一帧
var DELAY = 0.6;                 // 秒：孩子的一帧要等老师那边的画面都到了再打分
var KEEP = 7;                    // 秒：老师的动作留多久

var SWAP = {
  left_eye: 'right_eye', right_eye: 'left_eye', left_ear: 'right_ear', right_ear: 'left_ear',
  left_shoulder: 'right_shoulder', right_shoulder: 'left_shoulder', left_elbow: 'right_elbow', right_elbow: 'left_elbow',
  left_wrist: 'right_wrist', right_wrist: 'left_wrist', left_hip: 'right_hip', right_hip: 'left_hip',
  left_knee: 'right_knee', right_knee: 'left_knee', left_ankle: 'right_ankle', right_ankle: 'left_ankle'
};
var ENDS = ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
var ARMS = [['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'], ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist']];
var T = 0.3;

function vis(p) { return p && p.s >= T; }

// 归一化关键点 → 像素坐标（方向要在像素里算，横竖比例才对）
export function toPx(kp, w, h) {
  if (!kp) return null;
  var out = {};
  for (var k in kp) out[k] = { x: kp[k].x * w, y: kp[k].y * h, s: kp[k].s };
  return out;
}

// 照镜子：左右对调再水平翻转（w 是画面宽，像素）
export function mirrorPx(px, w) {
  if (!px) return null;
  var out = {};
  for (var k in px) {
    var to = SWAP[k] || k;
    out[to] = { x: w - px[k].x, y: px[k].y, s: px[k].s };
  }
  return out;
}

// 躯干长（肩中点到髋中点），看不全时用肩宽估
function torso(px) {
  var ls = px.left_shoulder, rs = px.right_shoulder, lh = px.left_hip, rh = px.right_hip;
  if (vis(ls) && vis(rs) && vis(lh) && vis(rh)) {
    var dx = (ls.x + rs.x - lh.x - rh.x) / 2, dy = (ls.y + rs.y - lh.y - rh.y) / 2;
    return Math.sqrt(dx * dx + dy * dy);
  }
  if (vis(ls) && vis(rs)) return Math.abs(ls.x - rs.x) * 1.4;
  return 0;
}

// 运动量：一段帧（{t, px}）里，四肢末端平均每秒移动几个躯干长。
// 隔 0.2 秒以上取一对帧比（帧率高低不影响结果，识别的小抖动也不会越加越多）。帧太少返回 null
export function motion(frames) {
  var sum = 0, span = 0, n = 0;
  var prev = null;
  for (var i = 0; i < frames.length; i++) {
    var b = frames[i];
    if (!b.px) continue;
    if (!prev) { prev = b; continue; }
    var dt = b.t - prev.t;
    if (dt < 0.2) continue;
    if (dt > 0.6) { prev = b; continue; }
    var tl = torso(b.px);
    if (tl >= 4) {
      var d = 0, m = 0;
      for (var j = 0; j < ENDS.length; j++) {
        var p = prev.px[ENDS[j]], q = b.px[ENDS[j]];
        if (!vis(p) || !vis(q)) continue;
        d += Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y)) / tl;
        m++;
      }
      if (m) {
        sum += d / m;
        span += dt;
        n++;
      }
    }
    prev = b;
  }
  if (n < 2 || span <= 0) return null;
  return sum / span;
}

// 是不是普通站姿（两手垂着）：胳膊各段和竖直向下差不到 30°
export function neutralArms(px) {
  if (!px) return false;
  var n = 0;
  for (var i = 0; i < ARMS.length; i++) {
    var a = px[ARMS[i][0]], b = px[ARMS[i][1]];
    if (!vis(a) || !vis(b)) continue;
    var dx = b.x - a.x, dy = b.y - a.y;
    var l = Math.sqrt(dx * dx + dy * dy) || 1;
    var ang = Math.acos(Math.max(-1, Math.min(1, dy / l))) * 180 / Math.PI;
    if (ang > 30) return false;
    n++;
  }
  return n >= 2;
}

// 老师这一帧「摆着姿势」的程度（0 = 普通站姿，1 = 四肢都和站姿差很远）。
// 一支舞里老师常常回到普通站姿（两拍之间、换动作时），站着不动的孩子那几刻也「像」；
// 所以每一帧按老师摆姿势的程度加权：老师在摆动作的那些帧才算数。
var SEGS = [
  ['left_shoulder', 'left_elbow', 1], ['left_elbow', 'left_wrist', 1],
  ['right_shoulder', 'right_elbow', 1], ['right_elbow', 'right_wrist', 1],
  ['left_hip', 'left_knee', 0.6], ['left_knee', 'left_ankle', 0.5],
  ['right_hip', 'right_knee', 0.6], ['right_knee', 'right_ankle', 0.5]
];
var NEUTRAL = null;
function unit(a, b) {
  var dx = b.x - a.x, dy = b.y - a.y;
  var l = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / l, y: dy / l };
}
export function posedness(px) {
  if (!px) return 0;
  if (!NEUTRAL) NEUTRAL = targetPx({});
  var sum = 0, wsum = 0;
  for (var i = 0; i < SEGS.length; i++) {
    var s = SEGS[i], a = px[s[0]], b = px[s[1]];
    if (!vis(a) || !vis(b)) continue;
    var u = unit(a, b), n = unit(NEUTRAL[s[0]], NEUTRAL[s[1]]);
    var ang = Math.acos(Math.max(-1, Math.min(1, u.x * n.x + u.y * n.y))) * 180 / Math.PI;
    sum += s[2] * Math.min(1, Math.max(0, ang - 8) / 37);
    wsum += s[2];
  }
  return wsum ? sum / wsum : 0;
}

// 只按运动量打分（看不到老师时）：四肢平均每秒动 0.9 个躯干长以上算「完美」，站着不动是零
export function activityScore(m) {
  if (m == null) return 0;
  return Math.max(0, Math.min(1, (m - 0.2) / 0.8));
}

function lagCount() { return Math.round((LAG_MAX - LAG_MIN) / LAG_STEP) + 1; }
export function lagOf(i) { return Math.round((LAG_MIN + i * LAG_STEP) * 10) / 10; }

// opts.noCoach：一开始就知道看不到老师（只按运动量评）
export function VideoJudge(opts) {
  opts = opts || {};
  this.noCoach = !!opts.noCoach;
  this.reset();
}

VideoJudge.prototype.reset = function () {
  var n = lagCount();
  this.coach = [];      // {t, px, pm 镜像, w, wm, ok}
  this.pending = [];    // 还没打分的孩子帧 {t, px}
  this.frames = [];     // 打过分的帧 {t, s, px, cpx, sim}
  this.hyp = [];        // [lag 档][0 同一边 / 1 照镜子] → {sum, n}
  for (var i = 0; i < n; i++) this.hyp.push([{ sum: 0, n: 0 }, { sum: 0, n: 0 }]);
  this.lastDecay = null;
  this.best = null;     // {i, m}
  this.blockStart = null;
  this.points = 0;
  this.combo = 0;
  this.maxCombo = 0;
  this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  this.graded = 0;
  this.aiBlocks = 0;
  this.moveBlocks = 0;
  this.skipped = 0;
  this.moveStarted = false;
  this.scores = [];
  this.history = [];    // 每次评级 {grade id, score, kind: ai|move}
  this.tips = {};
  this.activeSec = 0;
  this.coachSeen = 0;   // 收到过几帧看得清的老师
};

// 视频里老师的一帧：kp 归一化关键点（可为 null），t 拍下的时间（秒），w/h 画面像素
VideoJudge.prototype.addCoach = function (kp, t, w, h) {
  if (this.coach.length && t <= this.coach[this.coach.length - 1].t) return;
  var px = kp ? toPx(kp, w, h) : null;
  var ok = !!px && torso(px) > 4;
  var f = { t: t, px: ok ? px : null, ok: ok };
  if (ok) {
    f.pm = mirrorPx(px, w);
    f.w = weightsFor(px);
    f.wm = weightsFor(f.pm);
    f.pz = 0.1 + posedness(px);
    this.coachSeen++;
  }
  this.coach.push(f);
  while (this.coach.length && this.coach[0].t < t - KEEP) this.coach.shift();
};

// 孩子的一帧：kp 归一化关键点（摄像头原始画面，可为 null），t 拍下的时间（秒）
VideoJudge.prototype.addChild = function (kp, t, w, h) {
  if (this.pending.length && t <= this.pending[this.pending.length - 1].t) return;
  this.pending.push({ t: t, px: kp ? toPx(kp, w, h) : null });
};

// 某一刻老师的动作：前后 NEAREST 秒里最近的一帧（没有或看不清返回 null）
VideoJudge.prototype._coachAt = function (t) {
  var c = this.coach, lo = 0, hi = c.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (c[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  var best = null, bd = NEAREST;
  for (var k = Math.max(0, lo - 1); k <= Math.min(c.length - 1, lo); k++) {
    var d = Math.abs(c[k].t - t);
    if (d <= bd) { bd = d; best = c[k]; }
  }
  return best && best.ok ? best : null;
};

VideoJudge.prototype._scoreFrame = function (f) {
  var n = this.hyp.length;
  var sims = [];
  var any = false;
  for (var i = 0; i < n; i++) {
    var co = this._coachAt(f.t - lagOf(i));
    if (!co || !f.px) { sims.push(null); continue; }
    var sd = similarity(f.px, co.px, co.w), sm = similarity(f.px, co.pm, co.wm);
    sims.push([sd, sm, co]);
    if (sd || sm) any = true;
  }
  // 各种假设的成绩随时间慢慢淡忘（只看最近 TAU 秒）
  if (this.lastDecay !== null) {
    var k = Math.exp(-Math.max(0, f.t - this.lastDecay) / TAU);
    for (var a = 0; a < n; a++) for (var b = 0; b < 2; b++) { this.hyp[a][b].sum *= k; this.hyp[a][b].n *= k; }
  }
  this.lastDecay = f.t;
  if (!any) return { t: f.t, s: null, px: f.px };
  for (i = 0; i < n; i++) {
    if (!sims[i]) continue;
    var pz = sims[i][2].pz;
    for (var m = 0; m < 2; m++) {
      var s = sims[i][m];
      if (!s) continue;
      this.hyp[i][m].sum += s.score * pz;
      this.hyp[i][m].n += pz;
    }
  }
  // 最像的假设（先有足够的帧）；还没有就用这一帧自己最像的
  var bi = -1, bm = 0, bv = -1;
  for (i = 0; i < n; i++) {
    for (m = 0; m < 2; m++) {
      var h = this.hyp[i][m];
      if (h.n < 1.5) continue;
      var v = h.sum / h.n;
      if (v > bv) { bv = v; bi = i; bm = m; }
    }
  }
  if (bi >= 0) this.best = { i: bi, m: bm };
  var slack = Math.round(LAG_SLACK / LAG_STEP);
  var top = null;
  for (i = 0; i < n; i++) {
    if (!sims[i]) continue;
    if (bi >= 0 && Math.abs(i - bi) > slack) continue;
    for (m = 0; m < 2; m++) {
      if (bi >= 0 && m !== bm) continue;
      var sm2 = sims[i][m];
      if (sm2 && (!top || sm2.score > top.sim.score)) top = { sim: sm2, co: sims[i][2], m: m };
    }
  }
  if (!top) return { t: f.t, s: null, px: f.px };
  return { t: f.t, s: top.sim.score, w: top.co.pz, sim: top.sim, px: f.px, cpx: top.m ? top.co.pm : top.co.px };
};

// 现在的时间（秒）；返回这次新出的评级 [{type:'grade', grade, score, kind, tip, combo}] 或 [{type:'skip', why}]
VideoJudge.prototype.update = function (now) {
  var events = [];
  while (this.pending.length && this.pending[0].t <= now - DELAY) {
    var f = this.pending.shift();
    if (this.blockStart === null) this.blockStart = f.t;
    while (f.t >= this.blockStart + BLOCK) {
      var ev = this._settle(this.blockStart, this.blockStart + BLOCK);
      if (ev) events.push(ev);
      this.blockStart += BLOCK;
    }
    var sc = this.noCoach ? { t: f.t, s: null, px: f.px } : this._scoreFrame(f);
    this.frames.push(sc);
  }
  // 老的帧不要了（当前这一段之前的）
  while (this.frames.length && this.blockStart !== null && this.frames[0].t < this.blockStart - 1) this.frames.shift();
  return events;
};

// 中途停下（暂停、重新开始）：这一段够 1 秒就评，不够就不算；之后的帧从新的一段开始
VideoJudge.prototype.gap = function () {
  var events = [];
  for (var i = 0; i < this.pending.length; i++) {
    var sc = this.noCoach ? { t: this.pending[i].t, s: null, px: this.pending[i].px } : this._scoreFrame(this.pending[i]);
    if (this.blockStart === null) this.blockStart = sc.t;
    this.frames.push(sc);
  }
  this.pending = [];
  if (this.blockStart !== null) {
    var last = this.frames.length ? this.frames[this.frames.length - 1].t : this.blockStart;
    if (last - this.blockStart >= 1) {
      var ev = this._settle(this.blockStart, last + 0.001);
      if (ev) events.push(ev);
    }
  }
  this.blockStart = null;
  this.frames = [];
  return events;
};

VideoJudge.prototype.finish = function () { return this.gap(); };

// 一段（t0–t1）里老师的动作：运动量、平均摆姿势的程度、看得清的帧数
VideoJudge.prototype._coachInfo = function (t0, t1) {
  var list = [];
  for (var i = 0; i < this.coach.length; i++) {
    var c = this.coach[i];
    if (c.t >= t0 && c.t < t1) list.push(c);
  }
  var seen = 0, pz = 0;
  for (var j = 0; j < list.length; j++) {
    if (!list[j].ok) continue;
    seen++;
    pz += list[j].pz - 0.1;
  }
  return { frames: list.length, seen: seen, motion: motion(list), posed: seen ? pz / seen : 0 };
};

VideoJudge.prototype._settle = function (t0, t1) {
  var list = [];
  for (var i = 0; i < this.frames.length; i++) {
    var f = this.frames[i];
    if (f.t >= t0 && f.t < t1) list.push(f);
  }
  if (!list.length) return null;
  var visible = list.filter(function (x) { return !!x.px && torso(x.px) > 4; });
  var cm = motion(list);
  this.activeSec += t1 - t0;
  var lag = this.best ? lagOf(this.best.i) : 0.5;
  var ci = this.noCoach ? null : this._coachInfo(t0 - lag, t1 - lag);
  var scored = list.filter(function (x) { return x.s != null; });
  var kind, score, tip = null;
  if (ci && ci.seen >= 3 && scored.length >= 3) {
    // 老师在原地站着（说话、等前奏）：这一段不评
    if (ci.posed < 0.15 && (ci.motion == null || ci.motion < 0.35)) {
      this.skipped++;
      return { type: 'skip', why: 'rest' };
    }
    kind = 'ai';
    var sum = 0, wsum = 0;
    for (var k = 0; k < scored.length; k++) { sum += scored[k].s * scored[k].w; wsum += scored[k].w; }
    score = wsum ? sum / wsum : 0;
    // 老师动得很欢，孩子却几乎没动：最多「加油」
    if (ci.motion != null && ci.motion > 0.6 && (cm == null || cm < Math.max(0.25, ci.motion * 0.3))) score = Math.min(score, 0.45);
    if (score < 0.7) {
      scored.sort(function (a, b) { return a.s - b.s; });
      var mid = scored[Math.floor(scored.length / 2)];
      if (mid.cpx && vis(mid.cpx.left_shoulder) && vis(mid.cpx.right_shoulder) && vis(mid.cpx.left_hip) && vis(mid.cpx.right_hip)) {
        tip = tipFor(mid.px, mid.cpx, mid.sim);
      }
    }
  } else if (visible.length >= 3) {
    // 看不到老师（或者一开始就知道看不到）：按运动量。开头孩子还没动起来的几段（前奏）不评
    kind = 'move';
    score = activityScore(cm);
    if (!this.moveStarted && score < 0.3) {
      this.skipped++;
      return { type: 'skip', why: 'warmup' };
    }
    this.moveStarted = true;
    if (score < 0.5) tip = '跟着视频动起来';
  } else {
    // 看不到孩子
    if (ci && ci.seen < 3) {
      this.skipped++;
      return { type: 'skip', why: 'nobody' };
    }
    kind = this.noCoach ? 'move' : 'ai';
    score = 0;
    tip = '站到摄像头前面来';
  }
  var g = gradeOf(score);
  this.graded++;
  if (kind === 'ai') this.aiBlocks++;
  else this.moveBlocks++;
  this.counts[g.id] += 1;
  this.points += g.pts;
  this.scores.push(score);
  if (g.id === 'miss') this.combo = 0;
  else {
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
  }
  if (tip && (g.id === 'good' || g.id === 'miss')) this.tips[tip] = (this.tips[tip] || 0) + 1;
  else if (g.id !== 'good' && g.id !== 'miss') tip = null;
  this.history.push({ g: g.id, s: score, kind: kind });
  if (this.history.length > 400) this.history.shift();
  return { type: 'grade', grade: g, score: score, kind: kind, tip: tip, combo: this.combo };
};

// 现在认为孩子比视频慢多少秒、是不是照镜子跳的（还不知道时返回 null）
VideoJudge.prototype.timing = function () {
  if (!this.best) return null;
  return { lag: lagOf(this.best.i), mirror: this.best.m === 1 };
};

VideoJudge.prototype.result = function () {
  var n = this.graded;
  var frac = n ? this.points / (n * 100) : 0;
  var stars = n < 6 ? 0 : (frac >= 0.7 ? 3 : (frac >= 0.5 ? 2 : (frac >= 0.3 ? 1 : 0)));
  var top = null, topN = 0;
  for (var k in this.tips) if (this.tips[k] > topN) { top = k; topN = this.tips[k]; }
  var tm = this.timing();
  return {
    points: this.points,
    max: n * 100,
    frac: frac,
    score: Math.round(frac * 100),
    counts: this.counts,
    graded: n,
    aiBlocks: this.aiBlocks,
    moveBlocks: this.moveBlocks,
    skipped: this.skipped,
    maxCombo: this.maxCombo,
    stars: stars,
    tip: top,
    tipN: topN,
    activeSec: Math.round(this.activeSec),
    lag: tm ? tm.lag : null,
    mirror: tm ? tm.mirror : null
  };
};
