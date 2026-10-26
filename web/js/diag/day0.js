// 设备测试（Day-0）：摄像头、各识别引擎的速度、全身入镜，给出走路线 A 还是 B 的结论。
import { feed } from '../pose/feed.js';
import { openCamera, closeCamera, cameraOpen, cameraErrorText } from '../pose/camera.js';
import * as native from '../pose/native.js';
import { ENGINES, unsupportedReason, engineInfo } from '../pose/engines.js';
import { Stage } from '../core/stage.js';
import { drawSkeleton } from '../core/skeleton.js';
import { checkSpace } from '../core/space.js';
import { countVisible } from '../core/keypoints.js';
import * as store from '../core/store.js';
import { now, sleep, mean, keepLast, dayKey, pad2, qs } from '../core/util.js';
import { setInterceptor, setScope } from '../core/nav.js';
import { VERSION } from '../version.js';

function $(id) { return document.getElementById(id); }

var FAST = qs('bench') === 'fast'; // 自动化测试用：缩短测速时间
var WARM_MS = FAST ? 800 : 2500;
var WARM_MAX_MS = FAST ? 60000 : 25000; // 预热最多等这么久（第一次识别可能要编译显卡程序）
var MEASURE_MS = FAST ? 3000 : 10000;
// ?engines=native,mn-wasm：只测这几个引擎（调试用）
var ONLY = qs('engines') ? qs('engines').split(',') : null;
function benchEngines() {
  return ENGINES.filter(function (e) { return !ONLY || ONLY.indexOf(e.id) >= 0; });
}

var stage = null;
var rafId = 0;
var active = false;
var benching = false;
var renders = [];
var lastPoseT = 0;
var kpSamples = [];
var camInfo = null;   // 网页摄像头
var camFps = null;
var nativeCam = null; // 原生摄像头（电视版 APK）
var device = null;
var results = [];
var lastFit = null;
var showSummary = false;
var gen = 0; // 每次进入或离开页面加 1；进行中的测速看到编号变了就停下，不会在后台继续跑
var baseFps = null; // 不识别时画面每秒刷新几次（空载帧率）

function viewText() {
  var v = window.TD && window.TD.view ? window.TD.view() : null;
  if (!v) return '';
  var d = device || {};
  return v.w + '×' + v.h + '，像素比 ' + (Math.round(v.dpr * 100) / 100) + '，缩放 ' + v.s.toFixed(3) +
    (Math.abs(v.zoom - 1) > 0.01 ? '，页面被放大 ' + v.zoom.toFixed(2) + ' 倍' : '') +
    (d.native && d.native.lowRes ? '，低分辨率渲染' : '') +
    (baseFps !== null ? '，空载 ' + Math.round(baseFps) + ' 帧/秒' : '');
}

function deviceInfo() {
  var ua = navigator.userAgent || '';
  var native = null;
  try {
    if (window.TongdongNative && window.TongdongNative.info) native = JSON.parse(window.TongdongNative.info());
  } catch (e) { native = null; }
  var gl = '未知';
  try {
    var c = document.createElement('canvas');
    var g = c.getContext('webgl');
    if (!g) gl = '不支持 WebGL';
    else {
      var ext = g.getExtension('WEBGL_debug_renderer_info');
      gl = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
    }
  } catch (e2) { gl = '未知'; }
  return {
    shell: !!native,
    native: native,
    model: native ? (native.manufacturer + ' ' + native.model) : ((/;\s*([^;()]+?)\s+Build\//.exec(ua) || [])[1] || ''),
    android: native ? native.android : ((/Android\s([\d.]+)/.exec(ua) || [])[1] || ''),
    chrome: (/Chrome\/([\d.]+)/.exec(ua) || [])[1] || '',
    webview: native ? native.webview : '',
    cores: navigator.hardwareConcurrency || null,
    mem: navigator.deviceMemory || null,
    gl: gl,
    ua: ua,
    screen: Math.round(window.screen.width * (window.devicePixelRatio || 1)) + '×' + Math.round(window.screen.height * (window.devicePixelRatio || 1))
  };
}

function measureCamFps(video, ms) {
  return new Promise(function (resolve) {
    var n = 0, start = now();
    if (video.requestVideoFrameCallback) {
      var cb = function () {
        n++;
        if (now() - start < ms) video.requestVideoFrameCallback(cb);
        else resolve(n / ((now() - start) / 1000));
      };
      video.requestVideoFrameCallback(cb);
    } else {
      var last = -1;
      var tick = function () {
        if (video.currentTime !== last) { last = video.currentTime; n++; }
        if (now() - start < ms) requestAnimationFrame(tick);
        else resolve(n / ((now() - start) / 1000));
      };
      tick();
    }
  });
}

function row(id) { return document.querySelector('#d0-bench tr[data-id="' + id + '"]'); }

function setRow(id, cells, cls) {
  var tr = row(id);
  if (!tr) return;
  var tds = tr.querySelectorAll('td');
  for (var i = 0; i < cells.length && i + 1 < tds.length; i++) tds[i + 1].textContent = cells[i];
  tr.className = cls || '';
}

function buildTable() {
  var html = '';
  var list = benchEngines();
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var why = unsupportedReason(e.id);
    html += '<tr data-id="' + e.id + '"><td>' + e.label + '</td><td>' + (why ? '不可用' : '—') + '</td><td>' + (why ? why : '—') + '</td><td>—</td></tr>';
  }
  $('d0-bench').innerHTML = html;
}

function fmtRes(r) {
  if (r.error) return ['失败', r.error, '—'];
  return [r.fps.toFixed(1) + ' 帧/秒', Math.round(r.p50) + ' / ' + Math.round(r.p95) + ' 毫秒', Math.round(r.renderFps) + ' 帧/秒'];
}

// 选引擎：先看识别速度，和最快的差不到两成的都算候选；候选里挑画面最流畅的。
export function pickBest(list) {
  var ok = list.filter(function (r) { return !r.error && r.fps > 0; });
  if (!ok.length) return null;
  var maxFps = Math.max.apply(null, ok.map(function (r) { return r.fps; }));
  var pool = ok.filter(function (r) { return r.fps >= maxFps * 0.8; });
  pool.sort(function (a, b) { return ((b.renderFps || 0) - (a.renderFps || 0)) || (b.fps - a.fps) || (b.kpAvg - a.kpAvg); });
  return pool[0];
}

export function verdictFor(best) {
  if (!best) {
    return { route: 'B', title: '路线 B：用手机当摄像头', text: '这台设备没能跑起任何识别引擎。请在手机上打开网页版，再投屏到电视。' };
  }
  var f = best.fps.toFixed(1);
  if (best.fps >= 15) return { route: 'A', title: '路线 A：电视直接玩，全部功能', text: '最快的是「' + best.label + '」，每秒识别 ' + f + ' 次，够用。' };
  if (best.fps >= 8) return { route: 'A-slow', title: '路线 A：电视直接玩，慢节奏', text: '最快的是「' + best.label + '」，每秒识别 ' + f + ' 次。切水果会自动放慢，金鸡独立不受影响。' };
  return { route: 'B', title: '路线 B：用手机当摄像头', text: '最快也只有每秒 ' + f + ' 次，电视算力不够。请在手机上打开网页版，再投屏到电视。' };
}

function showVerdict(v) {
  $('d0-verdict').innerHTML = v ? '<b>' + v.title + '</b>' + v.text : '';
}

function stamp() {
  var d = new Date();
  return dayKey(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function summaryText() {
  var d = device || deviceInfo();
  var lines = [];
  lines.push('童动乐园 设备测试结果（' + VERSION + '，' + stamp() + '）');
  lines.push('运行环境：' + (d.shell ? 'APK 外壳' + (d.native && d.native.app ? ' ' + d.native.app : '') : '浏览器') + (d.webview ? '，WebView ' + d.webview : (d.chrome ? '，Chrome ' + d.chrome : '')) + '，多线程' + (window.crossOriginIsolated ? '可用' : '不可用'));
  lines.push('设备：' + (d.model || '未知型号') + (d.native && d.native.harmony ? '，HarmonyOS ' + d.native.harmony : '') + (d.android ? '，Android ' + d.android : '') + '，' + (d.cores || '?') + ' 核' + (d.mem ? '，内存约 ' + d.mem + ' GB' : '') + '，图形 ' + d.gl);
  if (nativeCam) {
    var nf = native.info() || {};
    lines.push('原生摄像头：' + nativeCam.label + '，识别 ' + nativeCam.width + '×' + nativeCam.height + (nativeCam.preview ? '，预览 ' + nativeCam.preview : '') + (nf.fpsRange ? '，帧率范围 ' + nf.fpsRange : '') + (nf.error ? '，上次出错：' + nf.error : ''));
  }
  lines.push((nativeCam ? '网页摄像头：' : '摄像头：') + (camInfo ? camInfo.label + '，' + camInfo.width + '×' + camInfo.height + (camFps ? '，实测 ' + camFps.toFixed(0) + ' 帧/秒' : '') : '未打开'));
  lines.push('画面：' + viewText());
  lines.push('识别测速（识别帧率 / 单帧耗时中位数 / 95 分位 / 画面帧率 / 平均关键点）：');
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.error) lines.push('  ' + r.label + '：' + r.error);
    else lines.push('  ' + r.label + '：' + r.fps.toFixed(1) + ' 帧/秒，' + Math.round(r.p50) + ' / ' + Math.round(r.p95) + ' 毫秒，画面 ' + Math.round(r.renderFps) + ' 帧/秒，' + r.kpAvg.toFixed(1) + ' 点，加载 ' + (r.loadMs / 1000).toFixed(1) + ' 秒' + (r.grabMs ? '，取帧 ' + Math.round(r.grabMs) + ' 毫秒' : '') + (r.threads > 1 ? '，' + r.threads + ' 线程' : ''));
  }
  var best = pickBest(results);
  var v = verdictFor(best);
  lines.push('结论：' + v.title);
  lines.push('全身入镜：' + (lastFit ? (lastFit.ok ? '合格，身体约占画面 ' + Math.round((lastFit.frac || 0) * 100) + '%' : lastFit.msg) : '未检测'));
  lines.push('第 6、7 项（后台取帧、手机路线延迟）本版不测。');
  return lines.join('\n');
}

function previewLoop(t) {
  if (!active) return;
  renders.push(t);
  keepLast(renders, 2000); // 测速一次 10 秒，60 帧/秒要 600 条；原来只留 200 条，最多只能算出 20 帧/秒
  var st = stage, c = st.ctx;
  if (feed.mock) st.drawMockBackground();
  else st.drawVideo($('cam'), 0);
  var p = feed.latest;
  if (p && p.kp && feed.running) {
    if (p.t1 !== lastPoseT) {
      lastPoseT = p.t1;
      kpSamples.push(countVisible(p.kp, 0.4));
      keepLast(kpSamples, 600);
      lastFit = checkSpace(p.kp, 'full', st.mirror);
    }
    drawSkeleton(c, st.mapKp(p.kp), { width: 7 });
  }
  if (lastFit && feed.running) {
    $('d0-fit').textContent = lastFit.ok ? '全身入镜合格，身体约占画面 ' + Math.round((lastFit.frac || 0) * 100) + '%' : lastFit.msg;
  }
  if (feed.running) {
    var s = feed.stats(2000);
    $('d0-livefps').textContent = '当前：' + ((engineInfo(feed.engineId) || {}).label || '模拟') + '，识别 ' + s.fps.toFixed(1) + ' 帧/秒，画面 ' + renderCount(1000) + ' 帧/秒';
  }
  rafId = requestAnimationFrame(previewLoop);
}

function renderCount(ms) {
  var t = now(), n = 0;
  for (var i = renders.length - 1; i >= 0; i--) {
    if (t - renders[i] <= ms) n++;
    else break;
  }
  return n * 1000 / ms;
}

function withTimeout(p, ms, msg) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error(msg)); }, ms);
    p.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
  });
}

// 原生识别和网页摄像头不能同时占用摄像头：切换前先让出来
function nativeView(on) {
  if (!stage) return;
  stage.transparentVideo = !!on;
  if (on) native.previewOn($('d0-canvas'), 'contain', stage.mirror);
  else native.previewOff();
}

function noteNativeCam() {
  var ni = native.info() || {};
  var eng = feed.engine || {};
  nativeCam = {
    label: 'Camera2 #' + (ni.camera || '?') + (ni.facing === 'front' ? ' 前置' : ' 后置') + (ni.level ? ' ' + ni.level : '') + (ni.rotation ? '（传感器转 ' + ni.rotation + '°）' : ''),
    width: ni.w || eng.frameW,
    height: ni.h || eng.frameH,
    preview: ni.pw ? ni.pw + '×' + ni.ph : ''
  };
}

function nativeCamText() {
  var ni = native.info() || {};
  return (ni.w ? ni.w + '×' + ni.h : '?') + '（原生）' + (ni.pw ? '，预览 ' + ni.pw + '×' + ni.ph : '');
}

async function startNative(my, onStatus) {
  closeCamera($('cam'));
  await feed.useEngine('native', onStatus);
  if (my !== gen) return;
  var eng = feed.engine;
  stage.setVideoSize(eng.frameW, eng.frameH);
  noteNativeCam();
  nativeView(true);
}

async function ensureWebCamera(my) {
  if (feed.engine && feed.engine.native) feed.release();
  nativeView(false);
  if (cameraOpen()) return true;
  // 原生识别刚放开摄像头时，网页可能要等一下才打得开
  for (var i = 0; i < 3; i++) {
    try {
      var info = await openCamera($('cam'));
      if (my !== gen) return false;
      camInfo = info;
      stage.setVideoSize(info.width, info.height);
      return true;
    } catch (e) {
      if (my !== gen) return false;
      await sleep(800);
    }
  }
  return false;
}

// 空载帧率：不跑识别时画面每秒能刷新几次（看电视本身画 4K 画面的能力）
async function measureBase(my, ms) {
  var t0 = now();
  await sleep(ms);
  if (my !== gen) return null;
  var n = 0;
  for (var i = 0; i < renders.length; i++) if (renders[i] > t0) n++;
  return n / ((now() - t0) / 1000);
}

// 预热：至少跑完 3 次识别、并且过了 WARM_MS 才开始计时，最多等 WARM_MAX_MS
async function warmUp(my) {
  var t0 = now();
  while (my === gen) {
    var el = now() - t0;
    if (el >= WARM_MS && feed.stamps.length >= 3) return;
    if (el >= WARM_MAX_MS) return;
    await sleep(200);
  }
}

async function runBench() {
  if (benching) return;
  var my = gen;
  benching = true;
  results = [];
  buildTable();
  showVerdict(null);
  var btn = $('d0-run');
  btn.textContent = '测速中，约 2 分钟';
  btn.disabled = true;
  // 先测空载帧率，再逐个测引擎；测引擎时每次识别只留 1 帧，测的是引擎本身的速度
  feed.stop();
  var b = await measureBase(my, FAST ? 1000 : 3000);
  if (my !== gen) return;
  baseFps = b;
  $('d0-view').textContent = viewText();
  feed.yieldFrames = 1;
  var list = benchEngines();
  for (var i = 0; i < list.length; i++) {
    if (my !== gen) return;
    var e = list[i];
    var why = unsupportedReason(e.id);
    if (why) {
      results.push({ id: e.id, label: e.label, error: '不支持（' + why + '）' });
      continue;
    }
    var isNative = e.kind === 'native';
    setRow(e.id, ['加载中', '—', '—'], 'running');
    if (isNative) closeCamera($('cam'));
    else {
      var camOk = await ensureWebCamera(my);
      if (my !== gen) return;
      if (!camOk) {
        results.push({ id: e.id, label: e.label, error: '网页摄像头打不开' });
        setRow(e.id, ['失败', '网页摄像头打不开', '—']);
        continue;
      }
    }
    var t0 = now();
    try {
      await withTimeout(feed.useEngine(e.id, function (txt) { setRow(e.id, [txt, '—', '—'], 'running'); }), 90000, '加载超时');
      if (isNative && my === gen) {
        stage.setVideoSize(feed.engine.frameW, feed.engine.frameH);
        noteNativeCam();
        nativeView(true);
      }
    } catch (err) {
      if (my !== gen) return;
      var msg = (err && err.message ? err.message : String(err)).slice(0, 40);
      results.push({ id: e.id, label: e.label, error: msg });
      setRow(e.id, ['失败', msg, '—']);
      continue;
    }
    if (my !== gen) return;
    var loadMs = now() - t0;
    feed.start();
    setRow(e.id, ['预热中', '—', '—'], 'running');
    await warmUp(my);
    if (my !== gen) return;
    feed.resetStats();
    kpSamples = [];
    var tStart = now();
    var rStart = renders.length ? renders[renders.length - 1] : tStart;
    setRow(e.id, ['测量中', '—', '—'], 'running');
    await sleep(MEASURE_MS);
    if (my !== gen) return;
    var st = feed.stats(MEASURE_MS); // 原生识别的单帧耗时是安卓里实测的（见 feed.js）
    var rCount = 0;
    for (var k = 0; k < renders.length; k++) if (renders[k] > rStart) rCount++;
    var r = {
      id: e.id,
      label: e.label,
      fps: st.fps,
      p50: st.p50,
      p95: st.p95,
      renderFps: rCount / ((now() - tStart) / 1000),
      kpAvg: kpSamples.length ? mean(kpSamples) : 0,
      loadMs: loadMs,
      grabMs: feed.engine && feed.engine.grabMs ? feed.engine.grabMs : null,
      threads: feed.engine && feed.engine.threads ? feed.engine.threads : null,
      errors: feed.errors
    };
    feed.stop();
    if (isNative) {
      feed.release();
      nativeView(false);
    }
    results.push(r);
    setRow(e.id, fmtRes(r));
  }
  if (my !== gen) return;
  feed.yieldFrames = 0;
  benching = false;
  btn.disabled = false;
  btn.textContent = '重新测速';
  var best = pickBest(results);
  var v = verdictFor(best);
  showVerdict(v);
  if (best) {
    var tr = row(best.id);
    if (tr) tr.className = 'best';
  }
  store.setDay0({
    at: Date.now(),
    version: VERSION,
    best: best ? best.id : null,
    route: v.route,
    baseFps: baseFps,
    camera: camInfo,
    camFps: camFps,
    results: results.map(function (x) {
      return { id: x.id, fps: x.fps || 0, p50: x.p50 || 0, p95: x.p95 || 0, renderFps: x.renderFps || 0, kpAvg: x.kpAvg || 0, grabMs: x.grabMs || null, threads: x.threads || null, error: x.error || null };
    })
  });
  // 用最快的引擎继续做全身入镜检查
  if (best) {
    try {
      if (best.id === 'native') await startNative(my);
      else {
        await ensureWebCamera(my);
        await feed.useEngine(best.id);
      }
      if (my === gen) feed.start();
    } catch (e3) { /* ignore */ }
  }
}

function toggleSummary() {
  showSummary = !showSummary;
  var el = $('d0-summary');
  if (showSummary) {
    el.textContent = summaryText();
    el.classList.add('show');
    $('d0-summary-btn').textContent = '关闭摘要';
  } else {
    el.classList.remove('show');
    $('d0-summary-btn').textContent = '结果摘要';
  }
}

function restorePrevious() {
  var d0 = store.get().day0;
  if (!d0 || !d0.results) return;
  if (typeof d0.baseFps === 'number') baseFps = d0.baseFps;
  for (var i = 0; i < d0.results.length; i++) {
    var r = d0.results[i];
    var info = engineInfo(r.id);
    if (!info) continue;
    var full = { id: r.id, label: info.label, fps: r.fps, p50: r.p50, p95: r.p95, renderFps: r.renderFps, kpAvg: r.kpAvg, loadMs: 0, grabMs: r.grabMs || null, threads: r.threads || null, error: r.error };
    results.push(full);
    setRow(r.id, fmtRes(full), r.id === d0.best ? 'best' : '');
  }
  showVerdict(verdictFor(pickBest(results)));
  $('d0-run').textContent = '重新测速';
}

export var day0Screen = {
  manageFocus: true,
  enter: function () {
    gen++;
    active = true;
    benching = false;
    feed.yieldFrames = 0;
    showSummary = false;
    results = [];
    baseFps = null;
    lastFit = null;
    $('d0-summary').classList.remove('show');
    $('d0-summary-btn').textContent = '结果摘要';
    $('d0-run').textContent = '开始测速';
    $('d0-run').disabled = false;
    $('d0-livefps').textContent = '';
    $('d0-fit').textContent = '站到电视前 2 到 3 米，让全身出现在画面里';
    buildTable();
    showVerdict(null);
    restorePrevious();
    if (!stage) stage = new Stage($('d0-canvas'), { alpha: native.available() });
    stage.transparentVideo = false;
    stage.mirror = !!store.settings().mirror;
    stage.setFit('contain');
    device = deviceInfo();
    $('d0-env').textContent = (device.shell ? 'APK 外壳' + (device.webview ? '，WebView ' + device.webview : '') : '浏览器' + (device.chrome ? '，Chrome ' + device.chrome : '')) + (window.crossOriginIsolated ? '，多线程可用' : '');
    var gl = String(device.gl);
    $('d0-dev').textContent = (device.model || '未知型号') + '，' + (device.cores || '?') + ' 核，' + (gl.length > 34 ? gl.slice(0, 33) + '…' : gl);
    $('d0-view').textContent = viewText();
    $('d0-run').onclick = runBench;
    $('d0-summary-btn').onclick = toggleSummary;
    setInterceptor(function (name) {
      if (name === 'back' && showSummary) { toggleSummary(); return true; }
      return false;
    });
    setScope($('screen-day0'), $('d0-run'));
    rafId = requestAnimationFrame(previewLoop);
    if (feed.mock) {
      camInfo = { label: '模拟模式', width: 1280, height: 720 };
      stage.setVideoSize(1280, 720);
      $('d0-cam').innerHTML = '<span class="dot ok"></span>模拟模式（不用摄像头）';
      return;
    }
    $('d0-cam').innerHTML = '<span class="dot"></span>正在打开摄像头';
    var my = gen;
    // 电视版 APK：用原生摄像头和识别做实时预览
    if (native.available()) {
      startNative(my, null).then(function () {
        if (my !== gen) return;
        $('d0-cam').innerHTML = '<span class="dot ok"></span>' + nativeCamText();
        feed.start();
      }).catch(function () {
        if (my !== gen) return;
        nativeView(false);
        openWebPreview(my);
      });
      return;
    }
    openWebPreview(my);
  },
  exit: function () {
    gen++;
    active = false;
    benching = false;
    feed.yieldFrames = 0;
    feed.stop();
    if (feed.engine && feed.engine.native) feed.release();
    nativeView(false);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    setInterceptor(null);
  },
  debug: function () { return { results: results, benching: benching, lastFit: lastFit, camInfo: camInfo, camFps: camFps, summary: summaryText() }; }
};

// 网页摄像头做实时预览（浏览器、或原生识别不可用时）
function openWebPreview(my) {
  openCamera($('cam')).then(function (info) {
    if (my !== gen) return;
    camInfo = info;
    stage.setVideoSize(info.width, info.height);
    $('d0-cam').innerHTML = '<span class="dot ok"></span>' + info.width + '×' + info.height + '，测帧率中';
    return measureCamFps($('cam'), 2000).then(function (f) {
      if (my !== gen) return;
      camFps = f;
      $('d0-cam').innerHTML = '<span class="dot ok"></span>' + info.width + '×' + info.height + '，' + Math.round(f) + ' 帧/秒';
    });
  }).catch(function (e) {
    if (my !== gen) return;
    $('d0-cam').innerHTML = '<span class="dot bad"></span>' + cameraErrorText(e);
    $('d0-fit').textContent = '摄像头打不开，先按上面的提示处理';
  });
}
