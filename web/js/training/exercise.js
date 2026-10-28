// AI 动作训练 · 画面与流程：站位 →（武术先讲安全）→ 每个动作：看示范 → 跟着做（计次 / 计时，边做边纠错）
// → 小结星星 → 全部做完结算。单个动作也按「只有一步的课程」来跑。
import { EXERCISES, COURSES, SAFETY, sideName } from './exercises.js';
import { makeJudge } from './exercise-logic.js';
import { Baseline } from '../core/body.js';
import { figure, animate, drawFigure, movingLimbs } from '../core/figure.js';
import { roundRect, outlinedText, BODY_FONT, DISPLAY_FONT } from '../core/stage.js';
import { drawSkeleton, COLORS } from '../core/skeleton.js';
import { toPixels } from '../core/keypoints.js';
import { SpaceGate } from '../core/space.js';
import { HandsUp } from '../core/gestures.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';
import { now, fmtSec, clamp, qs } from '../core/util.js';

var INTRO_MS = 5200;
var SAFETY_MS = 11000;
var STEP_DONE_MS = 2600;

// 左右对调（示范是按「左边」写的：左脚站、左腿在前……右边就把参数镜像过来）
var SWAP = { liftLeft: 'liftRight', kickLeft: 'kickRight', footOnLeft: 'footOnRight', bendLeft: 'bendRight', lungeLeft: 'lungeRight', punchLeft: 'punchRight', leftHand: 'rightHand' };
function flip(o) {
  var out = {};
  for (var k in o) {
    var v = o[k];
    var to = k;
    for (var a in SWAP) {
      if (k === a) to = SWAP[a];
      else if (k === SWAP[a]) to = a;
    }
    if (v && typeof v === 'object' && v.x != null) v = { x: 1 - v.x, y: v.y };
    if (k === 'sway' || k === 'cx') v = k === 'cx' ? 1 - v : -v;
    out[to] = v;
  }
  return out;
}

// 中文按宽度折行
export function wrapText(c, text, maxW, size, font) {
  c.font = size + 'px ' + (font || BODY_FONT);
  var lines = [], line = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (c.measureText(line + ch).width > maxW && line) {
      // 标点不放行首
      if ('，。、；：！？）'.indexOf(ch) >= 0) { line += ch; continue; }
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function stepLabel(step) {
  var def = EXERCISES[step.id];
  if (!step.side) return def.name;
  if (def.perSide) return def.name + '（' + sideName(step.side) + (def.id === 'warrior2' ? '腿在前' : '脚站') + '）';
  return def.name;
}

export function ExerciseMode(env, courseId) {
  this.env = env;
  this.course = COURSES[courseId] || COURSES.squat;
  this.title = this.course.name;
  this.age = env.settings.age === '9-12' ? '9-12' : '6-8';
  this.gate = new SpaceGate(900);
  this.handsUp = new HandsUp(1500);
  // 单边的保持动作没指定哪边，就左右各做一次
  this.steps = [];
  for (var i = 0; i < this.course.steps.length; i++) {
    var st = this.course.steps[i];
    var def = EXERCISES[st.id];
    if (def.perSide && !st.side) {
      this.steps.push({ id: st.id, side: 'left' });
      this.steps.push({ id: st.id, side: 'right' });
    } else {
      this.steps.push({ id: st.id, side: st.side || null });
    }
  }
  // 测试用：?hold=3 把保持动作缩短到 3 秒，?reps=3 把计次目标改成 3 次
  this.holdOverride = (Number(qs('hold')) || 0) * 1000;
  this.repsOverride = Number(qs('reps')) || 0;
  this.reset();
}

ExerciseMode.prototype.fit = 'contain';

ExerciseMode.prototype.reset = function () {
  this.phase = 'space';
  this.space = null;
  this.pose = null;
  this.idx = 0;
  this.judge = null;
  this.state = null;
  this.results = [];
  this.tips = {};
  this.base = new Baseline();
  this.phaseStart = 0;
  this.paused = false;
  this.flash = null;
  this.lastSpoken = 0;
  this.lastTipSpoken = 0;
  this.wasOk = false;
  this.lastSec = -1;
  this.safetyShown = false;
  this.handsProgress = 0;
  this.badSince = null;
  this.badMsg = null;
};

ExerciseMode.prototype.begin = function () {
  this.reset();
  this.gate.reset();
  speak('站到离电视两到三米的地方，让全身出现在画面里');
};

ExerciseMode.prototype.restart = function () {
  var keep = this.pose;
  this.reset();
  this.pose = keep;
  this.safetyShown = true;
  this.handsUp.reset();
  this._intro(now());
};

ExerciseMode.prototype.pause = function (v) { this.paused = !!v; };

ExerciseMode.prototype._step = function () { return this.steps[this.idx]; };
ExerciseMode.prototype._def = function () { return EXERCISES[this._step().id]; };

ExerciseMode.prototype._demoFrames = function (step) {
  var def = EXERCISES[step.id];
  var frames = def.demo || [{}];
  if (step.side === 'right' && def.perSide) frames = frames.map(flip);
  // 保持类：从站立慢慢做到位，停一会儿
  if (frames.length === 1) frames = [{}, frames[0], frames[0], frames[0]];
  return frames;
};

ExerciseMode.prototype._intro = function (t) {
  var step = this._step();
  var def = EXERCISES[step.id];
  this.phase = 'intro';
  this.phaseStart = t;
  this.judge = null;
  this.state = null;
  this.frames = this._demoFrames(step);
  this.hi = movingLimbs(this.frames);
  var target = def.kind === 'hold' ? '保持' + Math.round(this._holdMs(def) / 1000) + '秒' : '做' + this._target(def) + '次';
  var side = step.side && def.perSide ? '，' + sideName(step.side) + (def.id === 'warrior2' ? '腿在前' : '脚站') : '';
  speak(def.name + side + '。' + def.cue + '。' + target);
};

ExerciseMode.prototype._holdMs = function (def) { return this.holdOverride || def.hold[this.age]; };
ExerciseMode.prototype._target = function (def) { return this.repsOverride || def.target[this.age]; };

ExerciseMode.prototype._go = function (t) {
  var step = this._step();
  var def = EXERCISES[step.id];
  this.phase = 'go';
  this.phaseStart = t;
  this.judge = makeJudge(def, {
    age: this.age,
    side: step.side,
    base: this.base,
    holdMs: def.kind === 'hold' ? this._holdMs(def) : undefined,
    target: def.kind === 'rep' ? this._target(def) : undefined
  });
  this.state = this.judge.state();
  this.wasOk = false;
  this.lastSec = -1;
  this.flash = null;
  this.badSince = null;
  this.badMsg = null;
  sfx.go();
  speak('开始');
};

ExerciseMode.prototype.onPose = function (frame) {
  var st = this.env.stage;
  this.pose = frame.kp ? st.mapKp(frame.kp) : null;
  if (this.paused) return;
  if (this.phase === 'space') {
    this.space = this.gate.update(frame.kp, 'full', st.mirror, frame.t);
  } else if (this.phase === 'intro') {
    // 看示范时一般站着：顺便记下站立的样子（判断下蹲深度用）
    if (frame.kp) this.base.add(toPixels(frame.kp, frame.w, frame.h));
  } else if (this.phase === 'go' && this.judge) {
    this.state = this.judge.update(frame.kp ? toPixels(frame.kp, frame.w, frame.h) : null, frame.t);
    this._feedback(this.state, frame.t);
    if (this.state.done) this._stepDone();
  } else if (this.phase === 'result' && frame.kp) {
    var h = this.handsUp.update(frame.kp, frame.t);
    this.handsProgress = h.progress;
    if (h.fire && this.env.onHandsUp) this.env.onHandsUp();
  }
};

// 声音和文字反馈：计次的每一下报数，做得不对就说怎么改；保持的到位时提示「保持住」，最后三秒倒数
ExerciseMode.prototype._feedback = function (s, t) {
  var tn = now();
  var ev = s.events || [];
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (e.type !== 'rep') continue;
    this.flash = { t: tn, good: e.good, text: e.good ? '+1' : e.tip, side: e.side };
    if (e.tip) this.tips[e.tip] = (this.tips[e.tip] || 0) + 1;
    if (e.good) sfx.star(); else sfx.wrong();
    if (!e.good && e.tip && tn - this.lastTipSpoken > 3500) {
      speak(e.tip);
      this.lastTipSpoken = tn;
      this.lastSpoken = tn;
    } else if (tn - this.lastSpoken > 1100) {
      speak(String(e.n));
      this.lastSpoken = tn;
    }
  }
  if (s.kind === 'hold') {
    if (s.okNow && !this.wasOk) {
      sfx.go();
      if (tn - this.lastSpoken > 2500) { speak('保持住'); this.lastSpoken = tn; }
    }
    this.wasOk = s.okNow;
    if (s.okNow) {
      this.badSince = null;
      var left = Math.ceil((s.target - s.held) / 1000);
      if (left !== this.lastSec && left > 0) {
        if (left <= 3) speak(String(left));
        else sfx.tick();
      }
      this.lastSec = left;
    } else {
      // 同一条提示持续 1.5 秒还没改过来，就说出来（最多 4 秒说一次）
      if (s.msg !== this.badMsg) { this.badMsg = s.msg; this.badSince = tn; }
      if (this.badSince !== null && tn - this.badSince > 1500 && tn - this.lastTipSpoken > 4000) {
        speak(s.msg);
        this.lastTipSpoken = tn;
        this.lastSpoken = tn;
        if (s.msg) this.tips[s.msg] = (this.tips[s.msg] || 0) + 1;
      }
    }
  }
};

ExerciseMode.prototype._stepDone = function () {
  var r = this.judge.result();
  var step = this._step();
  r.side = step.side;
  r.name = stepLabel(step);
  this.results.push(r);
  this.phase = 'stepdone';
  this.phaseStart = now();
  if (r.stars >= 2) sfx.success(); else sfx.fail();
  speak(r.stars >= 3 ? '太棒了' : (r.stars >= 1 ? '完成' : '没关系，下次再来'));
};

// 暂停菜单里的「跳过这个动作」
ExerciseMode.prototype.skip = function () {
  if (this.phase === 'intro') { this._go(now()); }
  if (this.phase === 'go' && this.judge) {
    var r = this.judge.result();
    r.skipped = true;
    this.judge.done = true;
    var step = this._step();
    r.side = step.side;
    r.name = stepLabel(step);
    this.results.push(r);
    this.phase = 'stepdone';
    this.phaseStart = now();
  }
};

ExerciseMode.prototype.canSkip = function () { return this.phase === 'intro' || this.phase === 'go'; };

// ---------- 画面 ----------
ExerciseMode.prototype._banner = function (msg, color) {
  var c = this.env.stage.ctx;
  roundRect(c, 150, 26, 980, 92, 46);
  c.fillStyle = 'rgba(10,18,36,0.8)';
  c.fill();
  var size = 46;
  c.font = size + 'px ' + DISPLAY_FONT;
  while (size > 30 && c.measureText(msg).width > 920) { size -= 2; c.font = size + 'px ' + DISPLAY_FONT; }
  outlinedText(c, msg, 640, 88, size, color || '#F7F5EF', 'center');
};

ExerciseMode.prototype._progress = function (y) {
  var c = this.env.stage.ctx;
  var n = this.steps.length;
  if (n < 2) return;
  var gap = 34, x0 = 640 - (n - 1) * gap / 2;
  for (var i = 0; i < n; i++) {
    c.beginPath();
    c.arc(x0 + i * gap, y, i === this.idx ? 11 : 8, 0, Math.PI * 2);
    if (i < this.idx) { c.fillStyle = '#FFC928'; c.fill(); }
    else if (i === this.idx) { c.lineWidth = 4; c.strokeStyle = '#F7F5EF'; c.stroke(); }
    else { c.fillStyle = 'rgba(247,245,239,0.35)'; c.fill(); }
  }
};

ExerciseMode.prototype._demo = function (t, box, label) {
  var c = this.env.stage.ctx;
  roundRect(c, box.x, box.y, box.w, box.h, 24);
  c.fillStyle = 'rgba(10,18,36,0.72)';
  c.fill();
  var top = box.y;
  if (label) {
    outlinedText(c, label, box.x + box.w / 2, box.y + 38, 28, '#FFC928', 'center');
    top += 44;
  }
  var def = this._def();
  var period = def.kind === 'hold' ? 4800 : (def.demoPeriod || 1100 * this.frames.length);
  var o = animate(this.frames, period, t);
  var pad = box.h * 0.04;
  drawFigure(c, figure(o), { x: box.x, y: top + pad, w: box.w, h: box.y + box.h - top - pad * 2 }, { mirror: this.env.stage.mirror, hi: this.hi });
};

ExerciseMode.prototype.frame = function (t, dt) {
  var st = this.env.stage, c = st.ctx;
  // 模拟模式：告诉模拟骨架现在该做哪个动作（自动化测试用）
  if (this.env.mock) window.__tdMockHint = this.phase === 'go' ? { exercise: this._step().id, side: this._step().side } : null;
  var dim = this.phase === 'intro' || this.phase === 'safety' ? 0.6 : 0.12;
  if (this.env.mock) {
    st.drawMockBackground();
    if (dim > 0.3) { c.fillStyle = 'rgba(8,14,28,0.55)'; c.fillRect(0, 0, 1280, 720); }
  } else {
    st.drawVideo(this.env.video, dim);
  }
  if (this.pose && this.env.settings.skeleton && this.phase !== 'safety') {
    var s = this.state;
    var ok = this.phase === 'go' && s && s.okNow;
    var fl = this.flash && now() - this.flash.t < 400 && this.flash.good;
    drawSkeleton(c, this.pose, { width: 9, color: ok || fl ? COLORS.good : null, alpha: this.phase === 'intro' ? 0.5 : 1 });
  }
  var tn = now();
  if (this.phase === 'space') {
    var sp = this.space;
    this._banner(sp ? sp.msg : '请站到电视正前方，让摄像头看到你', sp && sp.ok ? '#FFC928' : '#F7F5EF');
    if (sp && sp.ok) {
      roundRect(c, 340, 104, 600 * sp.progress, 10, 5);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
    outlinedText(c, this.course.name + '要看到全身：头和脚都在画面里', 640, 690, 28, '#F7F5EF', 'center', BODY_FONT);
    if (sp && sp.passed) {
      if (this.course.safety && !this.safetyShown) this._safety(t);
      else this._intro(t);
    }
  } else if (this.phase === 'safety') {
    this._drawSafety(t);
    if (t - this.phaseStart >= SAFETY_MS) {
      this.safetyShown = true;
      this._intro(t);
    }
  } else if (this.phase === 'intro') {
    this._drawIntro(t);
    if (t - this.phaseStart >= INTRO_MS) this._go(t);
  } else if (this.phase === 'go') {
    this._drawGo(t, dt, tn);
  } else if (this.phase === 'stepdone') {
    var r = this.results[this.results.length - 1];
    this._banner(r.name + (r.skipped ? '：跳过了' : '：完成！'), '#FFC928');
    var line = r.kind === 'rep' ? r.reps + ' / ' + r.target + ' 次' + (r.reps ? '，做对 ' + r.good + ' 次' : '') : '保持了 ' + fmtSec(r.holdMs) + ' 秒';
    outlinedText(c, line, 640, 270, 56, '#F7F5EF', 'center');
    var stars = '';
    for (var i = 0; i < 3; i++) stars += i < r.stars ? '★' : '☆';
    outlinedText(c, stars, 640, 420, 120, '#FFC928', 'center', BODY_FONT);
    if (this.idx < this.steps.length - 1) {
      outlinedText(c, '下一个：' + stepLabel(this.steps[this.idx + 1]), 640, 520, 40, '#F7F5EF', 'center');
    }
    this._progress(600);
    if (tn - this.phaseStart >= STEP_DONE_MS) {
      if (this.idx < this.steps.length - 1) {
        this.idx += 1;
        this._intro(t);
      } else {
        this._end();
      }
    }
  } else if (this.phase === 'result') {
    roundRect(c, 440, 662, 400, 16, 8);
    c.fillStyle = 'rgba(10,18,36,0.7)';
    c.fill();
    if (this.handsProgress > 0) {
      roundRect(c, 440, 662, 400 * this.handsProgress, 16, 8);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
  }
  if (this.env.settings.perf) outlinedText(c, this.env.perfText(), 20, 708, 22, '#F7F5EF', 'left', BODY_FONT);
};

ExerciseMode.prototype._safety = function (t) {
  this.phase = 'safety';
  this.phaseStart = t;
  speak('练武术之前，先记住：' + SAFETY.join('。'));
};

ExerciseMode.prototype._drawSafety = function (t) {
  var c = this.env.stage.ctx;
  this._banner('练武术之前，先记住', '#FFC928');
  var el = t - this.phaseStart;
  for (var i = 0; i < SAFETY.length; i++) {
    var appear = 600 + i * 1800;
    if (el < appear) break;
    var a = clamp((el - appear) / 400, 0, 1);
    c.save();
    c.globalAlpha = a;
    var y = 210 + i * 110;
    roundRect(c, 150, y - 62, 980, 90, 22);
    c.fillStyle = 'rgba(31,79,168,0.85)';
    c.fill();
    outlinedText(c, String(i + 1), 200, y, 52, '#FFC928', 'center');
    var lines = wrapText(c, SAFETY[i], 860, 34);
    outlinedText(c, lines[0], 250, lines.length > 1 ? y - 18 : y - 2, 34, '#F7F5EF', 'left', BODY_FONT);
    if (lines[1]) outlinedText(c, lines[1], 250, y + 22, 34, '#F7F5EF', 'left', BODY_FONT);
    c.restore();
  }
  var left = Math.max(0, Math.ceil((SAFETY_MS - el) / 1000));
  outlinedText(c, left + ' 秒后开始', 640, 690, 28, '#F7F5EF', 'center', BODY_FONT);
};

ExerciseMode.prototype._drawIntro = function (t) {
  var c = this.env.stage.ctx;
  var step = this._step();
  var def = EXERCISES[step.id];
  var n = this.steps.length;
  this._banner(n > 1 ? '第 ' + (this.idx + 1) + ' 个动作，共 ' + n + ' 个' : '先看示范', '#F7F5EF');
  var label = stepLabel(step);
  outlinedText(c, label, 90, 230, label.length > 8 ? 52 : (label.length > 6 ? 64 : 84), '#FFC928', 'left');
  var lines = wrapText(c, def.cue, 560, 36);
  for (var i = 0; i < lines.length && i < 4; i++) outlinedText(c, lines[i], 90, 300 + i * 52, 36, '#F7F5EF', 'left', BODY_FONT);
  var goal = def.kind === 'hold' ? '保持 ' + Math.round(this._holdMs(def) / 1000) + ' 秒' : '目标 ' + this._target(def) + ' 次';
  outlinedText(c, goal, 90, 540, 56, '#F7F5EF', 'left');
  // 倒计时条
  var f = clamp((t - this.phaseStart) / INTRO_MS, 0, 1);
  roundRect(c, 90, 580, 520, 14, 7);
  c.fillStyle = 'rgba(247,245,239,0.25)';
  c.fill();
  roundRect(c, 90, 580, Math.max(14, 520 * f), 14, 7);
  c.fillStyle = '#FFC928';
  c.fill();
  this._demo(t, { x: 700, y: 140, w: 480, h: 520 }, '照着做');
  this._progress(690);
};

ExerciseMode.prototype._drawGo = function (t, dt, tn) {
  var c = this.env.stage.ctx;
  var s = this.state;
  var def = this._def();
  var step = this._step();
  var flash = this.flash && tn - this.flash.t < 2500 ? this.flash : null;
  this._banner(s ? s.msg : def.cue, s && s.okNow ? '#3FBF6A' : (flash && !flash.good ? '#FFC928' : '#F7F5EF'));
  if (s && s.kind === 'rep') {
    var big = String(s.reps);
    outlinedText(c, big, 80, 290, 150, '#FFC928', 'left');
    c.font = '150px ' + DISPLAY_FONT;
    var bw = c.measureText(big).width;
    outlinedText(c, '/ ' + s.target + ' 次', 80 + bw + 16, 290, 48, '#F7F5EF', 'left');
    if (def.sides) outlinedText(c, '左 ' + s.counts.left + '　右 ' + s.counts.right, 84, 350, 34, '#F7F5EF', 'left', BODY_FONT);
    if (flash && tn - flash.t < 700) {
      var rise = (tn - flash.t) / 700;
      c.save();
      c.globalAlpha = 1 - rise;
      outlinedText(c, flash.good ? '+1' : '再标准一点', 360, 250 - rise * 60, 64, flash.good ? '#3FBF6A' : '#FFC928', 'left');
      c.restore();
    }
    if (s.okNow || (flash && tn - flash.t < 300)) this.env.onActive(Math.min(dt, 100));
    else if (s.reps > 0) this.env.onActive(Math.min(dt, 100) * 0.6);
  } else if (s) {
    outlinedText(c, fmtSec(s.held), 80, 290, 150, s.okNow ? '#3FBF6A' : '#F7F5EF', 'left');
    c.font = '150px ' + DISPLAY_FONT;
    var tw = c.measureText(fmtSec(s.held)).width;
    outlinedText(c, '/ ' + Math.round(s.target / 1000) + ' 秒', 80 + tw + 16, 290, 48, '#F7F5EF', 'left');
    var fr = clamp(s.held / s.target, 0, 1);
    roundRect(c, 84, 320, 420, 18, 9);
    c.fillStyle = 'rgba(10,18,36,0.65)';
    c.fill();
    if (fr > 0) {
      roundRect(c, 84, 320, Math.max(18, 420 * fr), 18, 9);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
    if (s.okNow) this.env.onActive(Math.min(dt, 100));
  }
  outlinedText(c, stepLabel(step), 84, 690, 34, '#F7F5EF', 'left');
  this._progress(676);
  this._demo(t, { x: 1030, y: 360, w: 220, h: 320 }, '照着做');
};

ExerciseMode.prototype._end = function () {
  this.phase = 'result';
  this.handsUp.reset();
  var stars = 0;
  for (var i = 0; i < this.results.length; i++) stars += this.results[i].stars;
  var avg = this.results.length ? stars / this.results.length : 0;
  var top = null, topN = 0;
  for (var k in this.tips) if (this.tips[k] > topN && k !== '换另一边') { top = k; topN = this.tips[k]; }
  this.env.finish({
    type: 'exercise',
    course: this.course.id,
    name: this.course.name,
    group: this.course.group || EXERCISES[this.steps[0].id].group,
    age: this.age,
    steps: this.results,
    stars: Math.round(avg),
    tip: top,
    tipN: topN
  });
};

function starText(n) {
  var s = '';
  for (var i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s;
}

ExerciseMode.prototype.resultHTML = function (rec) {
  var rows = '';
  for (var i = 0; i < rec.steps.length; i++) {
    var r = rec.steps[i];
    var v = r.kind === 'rep' ? r.reps + ' / ' + r.target + ' 次' : fmtSec(r.holdMs) + ' / ' + Math.round(r.target / 1000) + ' 秒';
    if (r.skipped) v += '（跳过）';
    else if (r.kind === 'rep' && r.reps) v += '，做对 ' + r.good;
    rows += '<li><span class="n">' + r.name + '</span><span class="v">' + v + '</span><span class="stars">' + starText(r.stars) + '</span></li>';
  }
  var advice = rec.tip
    ? '最需要注意：' + rec.tip + (rec.tipN > 1 ? '（提醒了 ' + rec.tipN + ' 次）' : '')
    : (rec.stars >= 3 ? '每个动作都很标准，继续保持！' : '动作做得不错，慢慢来，越做越标准。');
  return '<h2>' + rec.name + '</h2><div class="stars big-stars">' + starText(rec.stars) + '</div>' +
    '<ul class="ex-rows">' + rows + '</ul><div class="lines">' + advice + '</div>';
};

ExerciseMode.prototype.dispose = function () { if (this.env.mock) window.__tdMockHint = null; };
