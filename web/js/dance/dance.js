// 跟跳练舞 · 画面与流程
//   跟跳：站位 → 音乐响起（前奏数拍子）→ 跟着左边的小老师跳 → 结算（得分、评级分布、最该改的地方）
//   教学：把这支舞用到的舞步一个一个教：先看慢动作示范，再一个一个摆出关键动作（摆像了才往下走）
// 画面：孩子自己的骨骼线框（每段按像不像涂绿 / 黄 / 红）+ 叠在身上的黄色虚线「标准动作」+ 底部节奏条（接下来的动作和拍子）
import { ROUTINES, MOVES, timeline, uniqueMoves } from './routines.js';
import { DanceJudge, coachPose, targetPx, similarity, weightsFor, tipFor, gradeOf } from './dance-logic.js';
import { Player } from '../core/music.js';
import { figure, blend, drawFigure, movingLimbs } from '../core/figure.js';
import { makeSlots, framePlayers, drawSpace, drawHandsUp, Pops, starText } from '../games/arena.js';
import { W, H, roundRect, outlinedText, BODY_FONT, DISPLAY_FONT } from '../core/stage.js';
import { BONES, COLORS } from '../core/skeleton.js';
import { toPixels } from '../core/keypoints.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, clamp, qs } from '../core/util.js';
import { winnerOf, winnerText } from '../games/duo.js';
import { wrapText } from '../training/exercise.js';

var START_DELAY = 1.2;     // 站好后多久开始放音乐（秒）
var SHOW_MS = 1500;        // 教学：慢动作每个关键帧停多久
var MATCH_HOLD = 400;      // 教学：摆像了要保持多久
var MATCH_MIN = 0.7;
var TRY_LIMIT = 8000;

function angleDiff(a, b, c, d) {
  var x1 = b.x - a.x, y1 = b.y - a.y, x2 = d.x - c.x, y2 = d.y - c.y;
  var l = Math.sqrt((x1 * x1 + y1 * y1) * (x2 * x2 + y2 * y2)) || 1;
  return Math.acos(clamp((x1 * x2 + y1 * y2) / l, -1, 1)) * 180 / Math.PI;
}

// 测试用：?short=8 只跳前 8 个舞步（音乐也截短）
function shorten(r, n) {
  var song = r.song;
  var moves = r.moves.slice(0, n);
  var beats = 0;
  for (var i = 0; i < moves.length; i++) beats += MOVES[moves[i]].beats;
  var bars = Math.ceil(beats / 4);
  var s2 = { id: song.id, bpm: song.bpm, intro: song.intro, outro: song.outro,
    bars: song.bars.slice(0, song.intro + bars).concat(song.bars.slice(song.bars.length - song.outro)) };
  return { id: r.id, name: r.name, level: r.level, desc: r.desc, song: s2, moves: moves, end: r.end };
}

export function DanceMode(env, routineId, learn, players) {
  this.env = env;
  this.routine = ROUTINES[routineId] || ROUTINES.twinkle;
  if (Number(qs('short')) > 0) this.routine = shorten(this.routine, Number(qs('short')));
  this.learn = !!learn;
  this.players = this.learn ? 1 : (players === 2 ? 2 : 1);
  this.title = (this.learn ? '舞蹈教学：' : '跟跳：') + this.routine.name + (this.players === 2 ? ' · 双人' : '');
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.keys = timeline(this.routine);
  this.slots = makeSlots(this.players);
  this.pops = new Pops();
  this.music = null;
  this.reset();
}

DanceMode.prototype.fit = 'contain';

DanceMode.prototype.reset = function () {
  if (this.music) this.music.stop();
  this.music = null;
  this.phase = 'space';
  this.phaseStart = 0;
  this.paused = false;
  this.coach = {};
  this.lastBeat = -1;
  this.lastMove = -1;
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i];
    P.judge = null;
    P.px = null;
    P.limb = null;
    P.grade = null;
    P.handsProgress = 0;
    P.gate.reset();
    P.handsUp.reset();
  }
  // 教学
  this.moves = uniqueMoves(this.routine);
  this.mi = 0;
  this.ki = 0;
  this.matchSince = null;
  this.learnLog = [];
  this.sim = null;
};

DanceMode.prototype.begin = function () {
  this.reset();
  speak(this.players === 2 ? '两个人一左一右站好，让全身出现在画面里' : '站到离电视两到三米的地方，让全身出现在画面里');
};

DanceMode.prototype.restart = function () {
  this.reset();
  this._afterSpace(now());
};

DanceMode.prototype.pause = function (v) {
  this.paused = !!v;
  if (this.music) {
    if (v) this.music.pause();
    else this.music.resume();
  }
};

DanceMode.prototype._afterSpace = function (t) {
  if (this.learn) { this._showMove(t); return; }
  this.phase = 'dance';
  this.phaseStart = t;
  this.music = new Player(this.routine.song);
  this.music.start(START_DELAY);
  for (var i = 0; i < this.slots.length; i++) this.slots[i].judge = new DanceJudge(this.keys, this.routine.song.bpm);
  speak('跟着小老师跳');
};

// ---------- 姿势输入 ----------
DanceMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  var kps = framePlayers(frame, st.mirror, this.players);
  var ts = this.music ? this.music.timeAt(frame.t) : null;
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i], kp = kps[i];
    P.kp = kp;
    P.pose = kp ? st.mapKp(kp) : null;
    P.px = kp ? toPixels(kp, frame.w, frame.h) : null;
    if (this.phase === 'space') P.space = P.gate.update(kp, 'full', st.mirror, frame.t, P.region);
    if (this.paused) continue;
    if (this.phase === 'dance' && P.judge && ts !== null) P.judge.add(P.px, ts);
    if (this.phase === 'try' && P.px) this._tryFrame(P, frame.t);
    if (this.phase === 'result' && kp) {
      var h = P.handsUp.update(kp, frame.t);
      P.handsProgress = h.progress;
      if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
    }
  }
};

// 每段肢体和示范差多少：绿 = 像，黄 = 差一点，红 = 差很多
DanceMode.prototype._limbColors = function (P, tgt) {
  var out = {};
  if (!P.px) return out;
  for (var i = 0; i < BONES.length; i++) {
    var a = BONES[i][0], b = BONES[i][1];
    var pa = P.px[a], pb = P.px[b];
    if (!pa || !pb || pa.s < 0.3 || pb.s < 0.3 || a.indexOf('shoulder') > 0 && b.indexOf('shoulder') > 0) continue;
    if ((a === 'left_hip' && b === 'right_hip') || (a.indexOf('shoulder') > 0 && b.indexOf('hip') > 0)) continue;
    var d = angleDiff(pa, pb, tgt[a], tgt[b]);
    out[a + '|' + b] = d < 25 ? COLORS.good : (d < 50 ? COLORS.warn : COLORS.bad);
  }
  return out;
};

// ---------- 教学 ----------
DanceMode.prototype._move = function () { return MOVES[this.moves[this.mi]]; };

DanceMode.prototype._scoredKeys = function () {
  return this._move().keys.filter(function (k) { return k.score; });
};

DanceMode.prototype._showMove = function (t) {
  var mv = this._move();
  this.phase = 'show';
  this.phaseStart = t;
  this.frames = mv.keys.map(function (k) { return k.pose; });
  if (this.frames.length === 1) this.frames = [{}, this.frames[0]];
  this.hi = movingLimbs(this.frames.concat([{}]));
  speak('第' + (this.mi + 1) + '个舞步，' + mv.name + '。' + mv.cue);
};

DanceMode.prototype._tryKey = function (t) {
  this.phase = 'try';
  this.phaseStart = t;
  this.matchSince = null;
  this.sim = null;
  var key = this._scoredKeys()[this.ki];
  this.tgt = targetPx(key.pose);
  this.tw = weightsFor(this.tgt);
  this.bestTry = 0;
  this.tryTip = null;
  if (this.ki === 0) speak('轮到你了，摆出这个动作');
};

DanceMode.prototype._tryFrame = function (P, tCap) {
  var sim = similarity(P.px, this.tgt, this.tw);
  this.sim = sim;
  if (!sim) { this.matchSince = null; return; }
  this.bestTry = Math.max(this.bestTry, sim.score);
  this.tryTip = sim.score < MATCH_MIN ? tipFor(P.px, this.tgt, sim) : null;
  if (sim.score >= MATCH_MIN) {
    if (this.matchSince === null) this.matchSince = tCap;
    if (tCap - this.matchSince >= MATCH_HOLD) this._keyDone(true);
  } else {
    this.matchSince = null;
  }
};

DanceMode.prototype._keyDone = function (ok) {
  var t = now();
  this.learnLog.push({ move: this.moves[this.mi], ki: this.ki, ok: ok, best: this.bestTry });
  if (ok) {
    sfx.star();
    this.pops.add('像了！', 900, 260, '#3FBF6A', 64, t);
  } else {
    sfx.wrong();
    this.pops.add('先往下学', 900, 260, '#FFC928', 50, t);
  }
  this.ki += 1;
  if (this.ki < this._scoredKeys().length) {
    this._tryKey(t);
    return;
  }
  this.ki = 0;
  this.mi += 1;
  if (this.mi < this.moves.length) {
    this.phase = 'between';
    this.phaseStart = t;
  } else {
    this._end();
  }
};

DanceMode.prototype.skip = function () {
  if (this.phase === 'show') this._tryKey(now());
  else if (this.phase === 'try') this._keyDone(false);
};

DanceMode.prototype.canSkip = function () { return this.learn && (this.phase === 'show' || this.phase === 'try'); };

// ---------- 画面 ----------
DanceMode.prototype._coachBox = function () {
  if (this.players === 2) return { x: 500, y: 118, w: 280, h: 500 };
  return { x: 28, y: 118, w: 380, h: 520 };
};

DanceMode.prototype._drawCoach = function (c, pose, label, hi) {
  var b = this._coachBox();
  roundRect(c, b.x, b.y, b.w, b.h, 28);
  c.fillStyle = 'rgba(10,18,36,0.72)';
  c.fill();
  // 舞台地面
  c.fillStyle = 'rgba(31,79,168,0.55)';
  roundRect(c, b.x + 16, b.y + b.h - 60, b.w - 32, 34, 17);
  c.fill();
  if (label) {
    var size = label.length > 6 ? 30 : 36;
    outlinedText(c, label, b.x + b.w / 2, b.y + 46, size, '#FFC928', 'center');
  }
  drawFigure(c, figure(pose), { x: b.x, y: b.y + 66, w: b.w, h: b.h - 96 }, { mirror: this.env.stage.mirror, hi: hi || {}, width: this.players === 2 ? 14 : 18 });
};

// 孩子的骨骼线框（按像不像上色）+ 叠在身上的标准动作虚线
DanceMode.prototype._drawPlayer = function (c, P, pose) {
  var pts = P.pose;
  if (!pts) return;
  var tgt = targetPx(pose);
  var colors = this._limbColors(P, tgt);
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  var i, a, b;
  // 标准动作：按孩子的肩膀位置和身体大小对齐
  var st = this.env.stage;
  var f = figure(pose);
  var fm = {};
  for (var k in f) fm[k] = st.map(f[k].x, f[k].y);
  var pc = { x: (pts.left_shoulder.x + pts.right_shoulder.x) / 2, y: (pts.left_shoulder.y + pts.right_shoulder.y) / 2 };
  var fc = { x: (fm.left_shoulder.x + fm.right_shoulder.x) / 2, y: (fm.left_shoulder.y + fm.right_shoulder.y) / 2 };
  var ph = pts.left_hip && pts.right_hip && pts.left_hip.s >= 0.3 && pts.right_hip.s >= 0.3
    ? { x: (pts.left_hip.x + pts.right_hip.x) / 2, y: (pts.left_hip.y + pts.right_hip.y) / 2 } : null;
  var fh = { x: (fm.left_hip.x + fm.right_hip.x) / 2, y: (fm.left_hip.y + fm.right_hip.y) / 2 };
  if (ph && pts.left_shoulder.s >= 0.3 && pts.right_shoulder.s >= 0.3) {
    var sc = Math.hypot(pc.x - ph.x, pc.y - ph.y) / Math.max(1, Math.hypot(fc.x - fh.x, fc.y - fh.y));
    var gm = function (p) { return { x: pc.x + (p.x - fc.x) * sc, y: pc.y + (p.y - fc.y) * sc }; };
    c.strokeStyle = 'rgba(255,201,40,0.85)';
    c.lineWidth = 6;
    if (c.setLineDash) c.setLineDash([14, 10]);
    for (i = 0; i < BONES.length; i++) {
      a = gm(fm[BONES[i][0]]);
      b = gm(fm[BONES[i][1]]);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    if (c.setLineDash) c.setLineDash([]);
  }
  for (var pass = 0; pass < 2; pass++) {
    for (i = 0; i < BONES.length; i++) {
      a = pts[BONES[i][0]];
      b = pts[BONES[i][1]];
      if (!a || !b || a.s < 0.3 || b.s < 0.3) continue;
      c.strokeStyle = pass ? (colors[BONES[i][0] + '|' + BONES[i][1]] || (this.players === 2 ? P.color : COLORS.plain)) : 'rgba(10,18,36,0.55)';
      c.lineWidth = pass ? 9 : 15;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
  }
  if (pts.nose && pts.nose.s >= 0.3) {
    c.strokeStyle = this.players === 2 ? P.color : COLORS.plain;
    c.lineWidth = 7;
    c.beginPath();
    c.arc(pts.nose.x, pts.nose.y, Math.max(18, Math.abs(pts.left_shoulder.x - pts.right_shoulder.x) * 0.32), 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
};

// 节奏条：接下来要做的动作（小图）从右往左走，走到竖线时就是那一拍
DanceMode.prototype._drawStrip = function (c, beat) {
  var x0 = this.players === 2 ? 120 : 440, x1 = this.players === 2 ? 1160 : 1250;
  var y = 646, h = 66;
  var nowX = x0 + 70, ppb = 115;
  roundRect(c, x0, y, x1 - x0, h, 33);
  c.fillStyle = 'rgba(10,18,36,0.75)';
  c.fill();
  c.save();
  c.beginPath();
  c.rect(x0, y - 70, x1 - x0, h + 70);
  c.clip();
  // 拍点
  var first = Math.ceil(beat - (nowX - x0) / ppb);
  for (var b = first; b < beat + (x1 - nowX) / ppb; b++) {
    var bx = nowX + (b - beat) * ppb;
    c.fillStyle = b % 4 === 0 ? 'rgba(247,245,239,0.75)' : 'rgba(247,245,239,0.35)';
    c.beginPath();
    c.arc(bx, y + h / 2, b % 4 === 0 ? 7 : 4, 0, Math.PI * 2);
    c.fill();
  }
  // 动作小图
  for (var i = 0; i < this.keys.length; i++) {
    var k = this.keys[i];
    if (!k.score) continue;
    var kx = nowX + (k.beat - beat) * ppb;
    if (kx < x0 - 40) continue;
    if (kx > x1 + 40) break;
    var near = Math.abs(k.beat - beat) < 0.5;
    c.globalAlpha = kx < nowX ? 0.35 : 1;
    drawFigure(c, figure(k.pose), { x: kx - 32, y: y - 52, w: 64, h: 112 }, { mirror: this.env.stage.mirror, width: 6, color: near ? '#FFC928' : '#F7F5EF' });
    c.globalAlpha = 1;
  }
  c.restore();
  // 「现在」竖线，跟着拍子跳一下
  var pulse = 1 - (beat - Math.floor(beat));
  c.strokeStyle = '#FFC928';
  c.lineWidth = 5 + 5 * pulse * pulse;
  c.beginPath();
  c.moveTo(nowX, y - 58);
  c.lineTo(nowX, y + h + 4);
  c.stroke();
};

DanceMode.prototype._gradePop = function (P, e, t) {
  var cx = this.players === 2 ? P.x + P.w / 2 + (P.i === 0 ? -60 : 60) : 860;
  P.grade = { g: e.grade, tip: e.tip, t: t };
  if (e.grade.id === 'perfect') sfx.star();
  else if (e.grade.id === 'great') sfx.tick();
  if (e.combo > 0 && e.combo % 10 === 0) {
    sfx.combo(4);
    this.pops.add(e.combo + ' 连击', cx, 300, '#FFC928', 54, t);
  }
};

DanceMode.prototype._drawGrades = function (c, tn) {
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i], g = P.grade;
    if (!g || tn - g.t > 1400) continue;
    var a = (tn - g.t) / 1400;
    var cx = this.players === 2 ? (P.i === 0 ? 250 : 1030) : 860;
    var size = Math.round((this.players === 2 ? 60 : 84) * (1 + 0.25 * Math.max(0, 1 - a * 5)));
    c.globalAlpha = 1 - a * a;
    outlinedText(c, g.g.text + (g.g.id === 'miss' ? '' : '！'), cx, 210, size, g.g.color, 'center');
    if (g.tip) outlinedText(c, g.tip, cx, 268, this.players === 2 ? 28 : 36, '#F7F5EF', 'center', BODY_FONT);
    c.globalAlpha = 1;
  }
};

DanceMode.prototype._drawHUD = function (c, beat) {
  var song = this.routine.song;
  var total = song.bars.length * 4;
  var f = clamp(beat / total, 0, 1);
  roundRect(c, 440, 30, 400, 20, 10);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  if (f > 0) {
    roundRect(c, 440, 30, Math.max(20, 400 * f), 20, 10);
    c.fillStyle = '#FFC928';
    c.fill();
  }
  outlinedText(c, this.routine.name, 640, 92, 34, '#F7F5EF', 'center');
  for (var i = 0; i < this.slots.length; i++) {
    var P = this.slots[i], j = P.judge;
    if (!j) continue;
    var right = this.players === 1 || i === 1;
    var x = right ? W - 36 : 36, align = right ? 'right' : 'left';
    outlinedText(c, this.players === 2 ? P.name : '得分', x, 46, 26, this.players === 2 ? P.color : 'rgba(247,245,239,0.9)', align, BODY_FONT);
    outlinedText(c, String(j.points), x, 118, 70, '#F7F5EF', align);
    if (j.combo >= 3) outlinedText(c, j.combo + ' 连击', x, 160, 30, '#FFC928', align);
  }
};

DanceMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  var tn = now();
  if (this.env.mock) st.drawMockBackground();
  else st.drawVideo(this.env.video, this.phase === 'space' ? 0.12 : 0.4);
  var i;
  if (this.phase === 'space') {
    for (i = 0; i < this.slots.length; i++) if (this.slots[i].pose) this._drawPlayer(c, this.slots[i], {});
    var ok = drawSpace(c, this.slots, this.players === 2
      ? '两个人一左一右，各站一半，头和脚都要在画面里，手臂伸开不要碰到对方'
      : '头和脚都要在画面里，两手伸开碰不到东西');
    if (ok) this._afterSpace(t);
  } else if (this.phase === 'dance') {
    this._frameDance(c, t, tn);
  } else if (this.phase === 'show' || this.phase === 'try' || this.phase === 'between') {
    this._frameLearn(c, t, tn);
  } else if (this.phase === 'result') {
    for (i = 0; i < this.slots.length; i++) if (this.slots[i].pose) this._drawPlayer(c, this.slots[i], this.coach);
    drawHandsUp(c, this.slots);
  }
  this.pops.draw(c, tn);
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

DanceMode.prototype._frameDance = function (c, t, tn) {
  var m = this.music;
  var beat = m.beat();
  var start = this.routine.song.intro * 4;
  // 前奏：小老师跟着拍子轻轻点头（膝盖一弹一弹）
  var pose;
  if (beat < start - 0.5) {
    var bounce = Math.abs(Math.sin(Math.max(0, beat) * Math.PI));
    pose = blend({}, { squat: 0.12 }, bounce);
  } else {
    pose = coachPose(this.keys, beat);
  }
  this.coach = pose;
  // 当前舞步的名字
  var cur = null;
  for (var i = 0; i < this.keys.length; i++) {
    if (this.keys[i].beat <= beat + 0.6) cur = this.keys[i];
    else break;
  }
  var label = beat < start - 1 ? (beat < 0 ? '准备' : '数拍子 ' + (Math.floor(beat) % 4 + 1)) : (cur ? MOVES[cur.move].name : '');
  if (cur && cur.idx !== this.lastMove && beat >= start - 1) {
    this.lastMove = cur.idx;
  }
  if (this.env.mock) window.__tdMockHint = { pose: pose };
  for (i = 0; i < this.slots.length; i++) this._drawPlayer(c, this.slots[i], pose);
  this._drawCoach(c, pose, label);
  if (!this.paused) {
    var now2 = m.time();
    for (i = 0; i < this.slots.length; i++) {
      var P = this.slots[i];
      var ev = P.judge.update(now2);
      for (var k = 0; k < ev.length; k++) this._gradePop(P, ev[k], tn);
    }
    if (beat >= start && beat < this.keys[this.keys.length - 1].beat) this.env.onActive(Math.min(50, tn - (this._lastTn || tn)));
  }
  this._lastTn = tn;
  this._drawGrades(c, tn);
  this._drawHUD(c, beat);
  this._drawStrip(c, beat);
  if (beat < start) {
    var left = Math.ceil(start - beat);
    if (left <= 4 && beat >= 0) outlinedText(c, String(left), this.players === 2 ? 640 : 860, 420, 150, '#FFC928', 'center');
    if (Math.floor(beat) !== this.lastBeat && beat >= 0) {
      this.lastBeat = Math.floor(beat);
    }
  }
  if (m.done()) this._end();
};

DanceMode.prototype._frameLearn = function (c, t, tn) {
  var mv = this._move();
  var P = this.slots[0];
  var el = t - this.phaseStart;
  var n = this.moves.length;
  roundRect(c, 440, 26, 800, 72, 36);
  c.fillStyle = 'rgba(10,18,36,0.78)';
  c.fill();
  if (this.env.mock) window.__tdMockHint = this.phase === 'try' ? { pose: this._scoredKeys()[this.ki].pose } : null;
  if (this.phase === 'show') {
    // 慢动作示范：每个关键帧停一会儿，平滑过渡
    var per = SHOW_MS;
    var cyc = this.frames.length * per;
    var ph = (el % cyc) / per;
    var a = Math.floor(ph), f = ph - a;
    var e = f < 0.45 ? 0 : (f - 0.45) / 0.55;
    e = e * e * (3 - 2 * e);
    var pose = blend(this.frames[a], this.frames[(a + 1) % this.frames.length], e);
    this.coach = pose;
    this._drawPlayer(c, P, pose);
    this._drawCoach(c, pose, mv.name, this.hi);
    outlinedText(c, '第 ' + (this.mi + 1) + ' / ' + n + ' 个舞步：先看小老师做', 840, 74, 34, '#F7F5EF', 'center');
    var lines = wrapText(c, mv.cue, 760, 40);
    for (var i = 0; i < lines.length; i++) outlinedText(c, lines[i], 840, 520 + i * 54, 40, '#FFC928', 'center');
    if (el >= Math.max(4500, 2 * this.frames.length * per)) this._tryKey(t);
  } else if (this.phase === 'try') {
    var key = this._scoredKeys()[this.ki];
    this.coach = key.pose;
    this._drawPlayer(c, P, key.pose);
    this._drawCoach(c, key.pose, mv.name, null);
    var total = this._scoredKeys().length;
    outlinedText(c, '摆出这个动作' + (total > 1 ? '（' + (this.ki + 1) + ' / ' + total + '）' : ''), 840, 74, 36, '#F7F5EF', 'center');
    // 像不像的进度条
    var s = this.sim ? this.sim.score : 0;
    roundRect(c, 560, 600, 560, 26, 13);
    c.fillStyle = 'rgba(10,18,36,0.7)';
    c.fill();
    roundRect(c, 560, 600, Math.max(26, 560 * clamp(s / MATCH_MIN, 0, 1)), 26, 13);
    c.fillStyle = s >= MATCH_MIN ? '#3FBF6A' : (s >= 0.5 ? '#FFC928' : '#E5484D');
    c.fill();
    outlinedText(c, '像不像', 540, 622, 28, '#F7F5EF', 'right', BODY_FONT);
    if (this.tryTip) outlinedText(c, this.tryTip, 840, 570, 40, '#FFC928', 'center');
    var left = Math.ceil((TRY_LIMIT - el) / 1000);
    if (left <= 4) outlinedText(c, left + ' 秒后先往下学', 840, 680, 28, '#F7F5EF', 'center', BODY_FONT);
    if (el >= TRY_LIMIT) this._keyDone(false);
    this.env.onActive(16);
  } else {
    this._drawCoach(c, {}, '', null);
    outlinedText(c, '学会一个！下一个：' + this._move().name, 840, 74, 34, '#3FBF6A', 'center');
    if (el >= 1600) this._showMove(t);
  }
};

DanceMode.prototype._end = function () {
  if (this.phase === 'result') return;
  var wasLearn = this.learn;
  this.phase = 'result';
  if (this.music) {
    this.music.stop();
  }
  for (var i = 0; i < this.slots.length; i++) this.slots[i].handsUp.reset();
  sfx.success();
  if (wasLearn) {
    var ok = 0;
    for (var k = 0; k < this.learnLog.length; k++) if (this.learnLog[k].ok) ok++;
    var frac = this.learnLog.length ? ok / this.learnLog.length : 0;
    this.env.finish({ type: 'dancelearn', routine: this.routine.id, name: this.routine.name, age: this.age, ok: ok, total: this.learnLog.length, log: this.learnLog, stars: frac >= 0.9 ? 3 : (frac >= 0.6 ? 2 : (frac >= 0.3 ? 1 : 0)) });
    return;
  }
  for (i = 0; i < this.slots.length; i++) this.slots[i].judge.finish();
  if (this.players === 2) {
    var a = this.slots[0].judge.result(), b = this.slots[1].judge.result();
    this.env.finish({ type: 'dance', players: 2, routine: this.routine.id, age: this.age, results: [a, b], scores: [a.points, b.points], winner: winnerOf(a.points, b.points) });
    return;
  }
  var r = this.slots[0].judge.result();
  r.type = 'dance';
  r.routine = this.routine.id;
  r.name = this.routine.name;
  r.age = this.age;
  r.score = r.points;
  r.bestKey = 'dance-' + this.routine.id;
  r.bestValue = r.points;
  this.env.finish(r);
};

function countsText(cn) {
  return '完美 ' + cn.perfect + '　很棒 ' + cn.great + '　不错 ' + cn.good + '　加油 ' + cn.miss;
}

DanceMode.prototype.resultHTML = function (rec, newBest, best) {
  if (rec.type === 'dancelearn') {
    var rows = '';
    var seen = {};
    for (var i = 0; i < rec.log.length; i++) {
      var l = rec.log[i];
      if (seen[l.move]) { if (!l.ok) seen[l.move].ok = false; continue; }
      seen[l.move] = { ok: l.ok };
    }
    var good = [], again = [];
    for (var id in seen) (seen[id].ok ? good : again).push(MOVES[id].name);
    rows = '<div class="lines">' + (good.length ? '学会了：' + good.join('、') : '') +
      (again.length ? '<br>还要多练：' + again.join('、') : '<br>每个舞步都摆像了！') + '</div>';
    return '<h2>舞蹈教学：' + rec.name + '</h2><div class="stars big-stars">' + starText(rec.stars) + '</div>' + rows +
      '<div class="lines">学完了就去跟着音乐跳一遍吧。</div>';
  }
  if (rec.players === 2) {
    var cols = '';
    for (var p = 0; p < 2; p++) {
      var r = rec.results[p];
      var win = rec.winner === (p ? 'right' : 'left');
      cols += '<div class="duo-p' + (win ? ' win' : '') + '"><div class="who" style="color:' + this.slots[p].color + '">' + this.slots[p].name + '</div>' +
        '<div class="big">' + r.points + '<small>分</small></div>' +
        '<div class="stars">' + starText(r.stars) + '</div>' +
        '<div class="lines">' + countsText(r.counts) + '</div></div>';
    }
    return '<h2>跟跳：' + this.routine.name + ' · 双人</h2><div class="lines winner">' + winnerText(rec.winner) + '</div><div class="duo">' + cols + '</div>';
  }
  var advice = rec.tip ? '最该注意：' + rec.tip + (rec.tipN > 1 ? '（' + rec.tipN + ' 次）' : '') : (rec.stars >= 3 ? '跳得太棒了！' : '多跳几遍，动作会越来越像。');
  return '<h2>跟跳：' + rec.name + '</h2>' +
    '<div class="big">' + rec.points + '<small>分</small>' + (newBest ? '<span class="new">新纪录</span>' : '') + '</div>' +
    '<div class="stars">' + starText(rec.stars) + '</div>' +
    '<div class="lines">' + countsText(rec.counts) + '，最多连击 ' + rec.maxCombo + '<br>' + advice + (best ? '<br>最好成绩 ' + best + ' 分' : '') + '</div>';
};

// 教学结束后：直接去跟着音乐跳
DanceMode.prototype.extraButton = function () {
  if (!this.learn) return null;
  var id = this.routine.id;
  return { label: '跟着音乐跳', mode: { mode: 'dance', routine: id } };
};

DanceMode.prototype.dispose = function () {
  if (this.music) this.music.stop();
  this.music = null;
  if (this.env.mock) window.__tdMockHint = null;
};
