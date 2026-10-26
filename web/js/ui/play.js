// 运动页总控：摄像头 → 识别引擎 → 运动模式（切水果 / 金鸡独立）→ 结算 → 休息提醒
import { Stage } from '../core/stage.js';
import { feed } from '../pose/feed.js';
import { openCamera, closeCamera, cameraErrorText } from '../pose/camera.js';
import * as native from '../pose/native.js';
import { unsupportedReason, engineInfo } from '../pose/engines.js';
import * as store from '../core/store.js';
import { setScope, setInterceptor } from '../core/nav.js';
import { ui, showRest } from './ui.js';
import { FruitMode } from '../games/fruit.js';
import { BalanceMode } from '../training/balance.js';
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

async function start(name) {
  stopAll();
  var my = token;
  modeName = name;
  var s = store.settings();
  if (!stage) stage = new Stage($('stage'), { alpha: native.available() });
  stage.mirror = !!s.mirror;
  stage.setResolution(s.hd ? 1.5 : 1);
  env.stage = stage;
  env.video = $('cam');
  env.settings = s;
  env.mock = !!feed.mock;
  mode = name === 'balance' ? new BalanceMode(env) : new FruitMode(env);
  stage.setFit(mode.fit);
  // 先画一帧背景，避免黑屏
  stage.drawVideo(null, 0);

  var order = engineOrder();
  var loaded = false, lastErr = null, usedNative = false;
  // 原生识别优先：先把网页摄像头让出来，再启动安卓里的摄像头和识别
  if (!feed.mock && order[0] === 'native') {
    ui.loading('准备中', '正在启动识别…', [{ label: '回首页', fn: goHome }], goHome);
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
    ui.loading('准备中', '正在打开摄像头…', [{ label: '回首页', fn: goHome }], goHome);
    try {
      var info = await openCamera($('cam'));
      if (my !== token) return;
      stage.setVideoSize(info.width, info.height);
    } catch (e) {
      if (my !== token) return;
      ui.loading('摄像头打不开', cameraErrorText(e), [
        { label: '重试', primary: true, fn: function () { start(name); } },
        { label: '回首页', fn: goHome }
      ], goHome);
      return;
    }
  } else {
    stage.setVideoSize(1280, 720);
  }

  for (var i = 0; i < order.length && !loaded; i++) {
    var label = (engineInfo(order[i]) || {}).label || order[i];
    ui.loading('准备中', '正在加载识别模型：' + label + '（第一次大约 10 到 30 秒）', [{ label: '回首页', fn: goHome }], goHome);
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
      { label: '重试', primary: true, fn: function () { start(name); } },
      { label: '设备测试', fn: function () { go('day0'); } },
      { label: '回首页', fn: goHome }
    ], goHome);
    return;
  }

  ui.hideLoading();
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
  ui.loading('暂停了', mode.title, [
    { label: '继续', primary: true, fn: resume },
    { label: '重新开始', fn: function () { ui.hideLoading(); paused = false; if (mode.pause) mode.pause(false); mode.restart(); } },
    { label: '回首页', fn: goHome }
  ], resume);
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

function onFinish(rec) {
  flushActive();
  var s = store.get();
  var newBest = false, best;
  if (rec.type === 'fruit') {
    newBest = store.recordSession({ type: 'fruit', age: rec.age, score: rec.score, sliced: rec.sliced, maxCombo: rec.maxCombo, stars: rec.stars, engine: feed.engineId }).newBest;
    best = s.best.fruit[rec.age] || 0;
  } else {
    for (var i = 0; i < rec.legs.length; i++) {
      var l = rec.legs[i];
      var r = store.recordSession({ type: 'balance', age: rec.age, stand: l.stand, holdMs: l.holdMs, stars: l.stars, reason: l.reason, engine: feed.engineId });
      if (r.newBest) { l.newBest = true; newBest = true; }
    }
    best = s.best.balance;
  }
  lastRec = rec;
  var box = $('result');
  box.innerHTML = mode.resultHTML(rec, newBest, best) +
    '<div class="btn-row"><button class="btn primary focusable" id="btn-again">再来一局</button><button class="btn focusable" id="btn-home">回首页</button></div>' +
    '<div class="hint">也可以站在原地举起双手 2 秒，直接再来一局</div>';
  $('btn-again').addEventListener('click', replay);
  $('btn-home').addEventListener('click', goHome);
  box.classList.add('show');
  showingResult = true;
  if (mode.afterResult) mode.afterResult(box, rec);
  setScope(box, $('btn-again'));
  var lim = store.settings().limitMin;
  if (lim > 0 && store.sessionSeconds() >= lim * 60) {
    showRest(lim, 60, function (choice) {
      store.resetSession();
      if (choice === 'home') goHome();
      else setScope(box, $('btn-again'));
    });
  }
}

export var playScreen = {
  manageFocus: true,
  enter: function (params) { start(params.mode || 'fruit'); },
  exit: function () { stopAll(); },
  onBack: function () {
    if (showingResult) return false;
    if (paused) { resume(); return true; }
    if (running) { pause(); return true; }
    return false;
  },
  onHide: function () { if (running && !showingResult) pause(); },
  debug: function () { return { mode: modeName, running: running, paused: paused, showingResult: showingResult, lastRec: lastRec, phase: mode ? mode.phase : null }; }
};
