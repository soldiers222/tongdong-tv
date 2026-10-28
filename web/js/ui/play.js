// 运动页总控：摄像头 → 识别引擎 → 运动模式（切水果 / 金鸡独立）→ 结算 → 休息提醒
import { Stage } from '../core/stage.js';
import { feed } from '../pose/feed.js';
import { openCamera, closeCamera, cameraErrorText } from '../pose/camera.js';
import * as native from '../pose/native.js';
import { unsupportedReason, engineInfo, setPlayers as setEnginePlayers } from '../pose/engines.js';
import * as store from '../core/store.js';
import { setScope, setInterceptor } from '../core/nav.js';
import { ui, showRest } from './ui.js';
import { FruitMode } from '../games/fruit.js';
import { FruitDuoMode } from '../games/fruit-duo.js';
import { BalanceMode } from '../training/balance.js';
import { BalanceDuoMode } from '../training/balance-duo.js';
import { ExerciseMode } from '../training/exercise.js';
import { MoleMode } from '../games/mole.js';
import { DodgeMode } from '../games/dodge.js';
import { DanceMode } from '../dance/dance.js';
import { ratingOf, afterSession } from '../core/growth.js';
import { now, keepLast } from '../core/util.js';
import { cancel as cancelVoice } from '../core/voice.js';
import { go } from '../router.js';

function $(id) { return document.getElementById(id); }

var stage = null;
var mode = null;
var modeName = null;
var rafId = 0;
var unsub = null;
var running = false;
var paused = false;
var lastT = 0;
var renders = [];
var activeMs = 0;
var token = 0;
var showingResult = false;
var lastRec = null;
var params = {};

// 各种玩法：画面怎么铺（cover 铺满裁边 / contain 全看到）、能不能双人、怎么创建
var MODES = {
  fruit: { fit: 'cover', duo: true, make: function (env, p, n) { return n === 2 ? new FruitDuoMode(env) : new FruitMode(env); } },
  balance: { fit: 'contain', duo: true, make: function (env, p, n) { return n === 2 ? new BalanceDuoMode(env) : new BalanceMode(env); } },
  exercise: { fit: 'contain', duo: false, make: function (env, p) { return new ExerciseMode(env, p.course); } },
  mole: { fit: 'cover', duo: true, make: function (env, p, n) { return new MoleMode(env, n); } },
  dodge: { fit: 'cover', duo: true, make: function (env, p, n) { return new DodgeMode(env, p.variant, n); } },
  dance: { fit: 'contain', duo: true, make: function (env, p, n) { return new DanceMode(env, p.routine, p.learn, n); } }
};

export function supportsDuo(p) {
  var m = MODES[p && p.mode];
  return !!(m && m.duo && !(p.mode === 'dance' && p.learn));
}

// 识别引擎的尝试顺序：家长指定 → 设备测试最优 → 默认顺序；跳过本机不支持的
export function engineOrder() {
  var s = store.settings();
  var order = [];
  if (s.engine && s.engine !== 'auto') order.push(s.engine);
  else order.push('native'); // 电视版 APK：原生识别最快（网页版不支持，会被下面过滤掉）
  var d0 = store.get().day0;
  if (d0 && d0.best) order.push(d0.best);
  order.push('native', 'mn-worker-gl', 'mp-lite', 'mn-webgl', 'mn-worker', 'mn-wasm', 'mp-full');
  var out = [];
  for (var i = 0; i < order.length; i++) {
    if (out.indexOf(order[i]) < 0 && engineInfo(order[i]) && !unsupportedReason(order[i])) out.push(order[i]);
  }
  return out;
}

function renderFps() {
  var t = now(), n = 0;
  for (var i = renders.length - 1; i >= 0; i--) {
    if (t - renders[i] <= 1000) n++;
    else break;
  }
  return n;
}

function flushActive() {
  if (activeMs > 0) {
    store.addActiveSeconds(activeMs / 1000);
    activeMs = 0;
  }
}

var env = {
  stage: null,
  video: null,
  settings: null,
  mock: false,
  poseFps: function () { return feed.stats(2500).fps; },
  perfText: function () {
    var st = feed.stats(2000);
    var info = engineInfo(feed.engineId) || { label: feed.engineId || '' };
    return '识别 ' + st.fps.toFixed(1) + ' 帧/秒，单帧 ' + Math.round(st.p50) + ' 毫秒，画面 ' + renderFps() + ' 帧/秒（' + info.label + '）';
  },
  onActive: function (ms) {
    activeMs += ms;
    if (activeMs >= 5000) flushActive();
  },
  finish: function (rec) { onFinish(rec); },
  onHandsUp: function () { if (showingResult) replay(); }
};

function loop(t) {
  if (!running) return;
  var dt = lastT ? t - lastT : 16;
  lastT = t;
  renders.push(t);
  keepLast(renders, 150);
  try {
    mode.frame(t, dt);
  } catch (e) {
    if (window.console) console.error(e);
  }
  rafId = requestAnimationFrame(loop);
}

function goHome() { go('home'); }

function stopAll() {
  token += 1;
  running = false;
  paused = false;
  showingResult = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (unsub) unsub();
  unsub = null;
  feed.stop();
  // 原生识别占着摄像头：离开运动页就停掉（升降摄像头会缩回去）
  if (feed.engine && feed.engine.native) feed.release();
  native.previewOff();
  if (stage) stage.transparentVideo = false;
  flushActive();
  if (mode && mode.dispose) mode.dispose();
  mode = null;
  $('result').classList.remove('show');
  cancelVoice();
  setInterceptor(null);
}

async function start(p) {
  stopAll();
  var my = token;
  params = p || {};
  var name = MODES[params.mode] ? params.mode : 'fruit';
  params.mode = name;
  modeName = name;
  var def = MODES[name];
  var s = store.settings();
  var players = s.players === 2 && supportsDuo(params) ? 2 : 1;
  var notice = '';
  if (!stage) stage = new Stage($('stage'), { alpha: native.available() });
  stage.mirror = !!s.mirror;
  stage.setResolution(s.hd ? 1.5 : 1);
  env.stage = stage;
  env.video = $('cam');
  env.settings = s;
  env.mock = !!feed.mock;
  mode = null;
  stage.setFit(def.fit);
  // 先画一帧背景，避免黑屏
  stage.drawVideo(null, 0);
  setEnginePlayers(players);

  var order = engineOrder();
  var loaded = false, lastErr = null, usedNative = false;
  // 原生识别优先：先把网页摄像头让出来，再启动安卓里的摄像头和识别
  if (!feed.mock && order[0] === 'native') {
    ui.loading('准备中', '正在启动识别…', [{ label: backLabel(), fn: goBack }], goBack);
    closeCamera($('cam'));
    try {
      await feed.useEngine('native', function (txt) { if (my === token) ui.loadingSub(txt + '…'); });
      loaded = true;
      usedNative = true;
    } catch (e0) {
      lastErr = e0;
      if (window.console) console.warn('原生识别启动失败，改用网页识别', e0);
    }
    if (my !== token) return;
  }
  order = order.filter(function (id) { return id !== 'native'; });

  if (usedNative) {
    stage.setVideoSize(feed.engine.frameW, feed.engine.frameH);
    stage.transparentVideo = true;
  } else if (!feed.mock) {
    ui.loading('准备中', '正在打开摄像头…', [{ label: backLabel(), fn: goBack }], goBack);
    try {
      var info = await openCamera($('cam'));
      if (my !== token) return;
      stage.setVideoSize(info.width, info.height);
    } catch (e) {
      if (my !== token) return;
      ui.loading('摄像头打不开', cameraErrorText(e), [
        { label: '重试', primary: true, fn: function () { start(params); } },
        { label: backLabel(), fn: goBack }
      ], goBack);
      return;
    }
  } else {
    stage.setVideoSize(1280, 720);
  }

  for (var i = 0; i < order.length && !loaded; i++) {
    var label = (engineInfo(order[i]) || {}).label || order[i];
    ui.loading('准备中', '正在加载识别模型：' + label + '（第一次大约 10 到 30 秒）', [{ label: backLabel(), fn: goBack }], goBack);
    try {
      await feed.useEngine(order[i], function (txt) { if (my === token) ui.loadingSub(txt + '…'); });
      loaded = true;
    } catch (e) {
      lastErr = e;
      if (window.console) console.warn('引擎加载失败', order[i], e);
    }
    if (my !== token) return;
  }
  if (feed.mock && !loaded) {
    try { await feed.useEngine('mock'); loaded = true; } catch (e2) { lastErr = e2; }
  }
  if (!loaded) {
    ui.loading('识别模型加载失败', '这台设备没能跑起识别模型（' + (lastErr && lastErr.message ? lastErr.message : '未知原因') + '）。可以先做一次设备测试看看原因。', [
      { label: '重试', primary: true, fn: function () { start(params); } },
      { label: '设备测试', fn: function () { go('day0'); } },
      { label: backLabel(), fn: goBack }
    ], goBack);
    return;
  }

  // 双人要识别引擎支持（电视版的原生识别；网页里的识别一次只认一个人）
  if (players === 2 && !(feed.engine && feed.engine.supportsPlayers >= 2)) {
    players = 1;
    setEnginePlayers(1);
    notice = '双人模式要用电视版的原生识别，这次先按单人玩';
  }
  if (feed.engine && feed.engine.setPlayers) feed.engine.setPlayers(players);
  env.players = players;
  mode = def.make(env, params, players);

  ui.hideLoading();
  if (notice) ui.toast(notice, 4500);
  if (usedNative) native.previewOn($('stage'), stage.fit, stage.mirror);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  setScope($('screen-play'));
  unsub = feed.on(function (p) { if (mode && !paused) mode.onPose(p); });
  feed.start();
  running = true;
  lastT = 0;
  mode.begin();
  rafId = requestAnimationFrame(loop);
}

function pause() {
  if (!running || paused || showingResult) return;
  paused = true;
  if (mode.pause) mode.pause(true);
  var btns = [{ label: '继续', primary: true, fn: resume }];
  // 训练和舞蹈教学：可以跳过做不来的动作
  if (mode.skip && mode.canSkip && mode.canSkip()) {
    btns.push({ label: '跳过这个动作', fn: function () { resume(); mode.skip(); } });
  }
  btns.push({ label: '重新开始', fn: function () { ui.hideLoading(); paused = false; if (mode.pause) mode.pause(false); mode.restart(); } });
  btns.push({ label: backLabel(), fn: goBack });
  ui.loading('暂停了', mode.title, btns, resume);
}

// 从哪个入口进来的，就回哪个入口
function backLabel() { return params.from === 'growth' ? '回成长中心' : (params.from ? '回上一页' : '回首页'); }
function backTarget() {
  if (params.from === 'growth') return ['growth', {}];
  if (params.from) return ['hub', { id: params.from }];
  return null;
}
function goBack() {
  var b = backTarget();
  if (b) go(b[0], b[1]);
  else goHome();
}

function resume() {
  if (!paused) return;
  paused = false;
  if (mode.pause) mode.pause(false);
  ui.hideLoading();
  setScope($('screen-play'));
  lastT = 0;
}

function replay() {
  if (!mode) return;
  showingResult = false;
  $('result').classList.remove('show');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  setScope($('screen-play'));
  mode.restart();
}

// 存进记录的精简版本（不存大数组）
function slim(rec) {
  var out = {};
  for (var k in rec) {
    if (k === 'log' || k === 'series' || k === 'results' || k === 'legs') continue;
    out[k] = rec[k];
  }
  if (rec.steps) {
    out.steps = rec.steps.map(function (r) {
      return { id: r.id, side: r.side || null, kind: r.kind, reps: r.reps, good: r.good, target: r.target, holdMs: r.holdMs, stars: r.stars, skipped: !!r.skipped };
    });
  }
  return out;
}

function onFinish(rec) {
  flushActive();
  var s = store.get();
  var newBest = false, best;
  rec.rating = ratingOf(rec);
  if (rec.players === 2) {
    store.recordSession({ type: rec.type, players: 2, age: rec.age, winner: rec.winner, scores: rec.scores || null, totals: rec.totals || null, routine: rec.routine || null, rating: rec.rating, engine: feed.engineId });
  } else if (rec.type === 'fruit') {
    newBest = store.recordSession({ type: 'fruit', age: rec.age, score: rec.score, sliced: rec.sliced, maxCombo: rec.maxCombo, stars: rec.stars, accuracy: rec.accuracy, rating: rec.rating, engine: feed.engineId }).newBest;
    best = s.best.fruit[rec.age] || 0;
  } else if (rec.type === 'balance') {
    for (var i = 0; i < rec.legs.length; i++) {
      var l = rec.legs[i];
      var r = store.recordSession({ type: 'balance', age: rec.age, stand: l.stand, holdMs: l.holdMs, stars: l.stars, rating: l.stars, reason: l.reason, engine: feed.engineId });
      if (r.newBest) { l.newBest = true; newBest = true; }
    }
    best = s.best.balance;
  } else {
    var rr = store.recordSession(slim(rec));
    newBest = rr.newBest;
    best = rr.best;
  }
  var news = afterSession(store);
  lastRec = rec;
  var box = $('result');
  var extra = mode.extraButton ? mode.extraButton() : null;
  box.innerHTML = mode.resultHTML(rec, newBest, best) +
    (news.length ? '<div class="news">' + news.map(function (n) { return '<span class="news-item">' + n + '</span>'; }).join('') + '</div>' : '') +
    '<div class="btn-row">' + (extra ? '<button class="btn primary focusable" id="btn-extra">' + extra.label + '</button>' : '') +
    '<button class="btn' + (extra ? '' : ' primary') + ' focusable" id="btn-again">' + (extra ? '再学一遍' : '再来一局') + '</button>' +
    '<button class="btn focusable" id="btn-home">' + backLabel() + '</button></div>' +
    '<div class="hint">' + (rec.players === 2 ? '任何一个人举起双手 2 秒' : '也可以站在原地举起双手 2 秒') + '，直接' + (extra ? '再学一遍' : '再来一局') + '</div>';
  if (extra) {
    $('btn-extra').addEventListener('click', function () {
      var p2 = {};
      for (var k in extra.mode) p2[k] = extra.mode[k];
      p2.from = params.from;
      go('play', p2);
    });
  }
  $('btn-again').addEventListener('click', replay);
  $('btn-home').addEventListener('click', goBack);
  box.classList.add('show');
  showingResult = true;
  if (mode.afterResult) mode.afterResult(box, rec);
  setScope(box, extra ? $('btn-extra') : $('btn-again'));
  var lim = store.settings().limitMin;
  if (lim > 0 && store.sessionSeconds() >= lim * 60) {
    showRest(lim, 60, function (choice) {
      store.resetSession();
      if (choice === 'home') goBack();
      else setScope(box, $('btn-again'));
    });
  }
}

export var playScreen = {
  manageFocus: true,
  enter: function (p) { start(p || {}); },
  exit: function () { stopAll(); },
  onBack: function () {
    if (showingResult) return false;
    if (paused) { resume(); return true; }
    if (running) { pause(); return true; }
    return false;
  },
  onHide: function () { if (running && !showingResult) pause(); },
  backTo: function () { return backTarget(); },
  debug: function () { return { mode: modeName, params: params, players: mode ? (mode.players || 1) : null, running: running, paused: paused, showingResult: showingResult, lastRec: lastRec, phase: mode ? mode.phase : null }; },
  mode: function () { return mode; }
};
