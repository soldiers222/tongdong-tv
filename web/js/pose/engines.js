// 姿态识别引擎。统一接口：init(onStatus) → estimate(video, t) → 关键点表（见 keypoints.js）或 null。
// 所有模型和运行库都在本地 vendor/、models/ 目录，不访问外网。
import { loadScript } from './loader.js';
import { fromMediaPipe, fromMoveNet } from '../core/keypoints.js';
import { sleep } from '../core/util.js';
import { MOCK_SCRIPTS } from './mock.js';

// 网站根目录（index.html 所在目录）。不用 import.meta，兼容更老的 WebView
export var BASE = new URL('.', document.baseURI || location.href).href;

// 后台线程的引擎在 Worker 里识别，主线程只管画面，游戏更流畅；
// 主线程的引擎识别时会卡住画面（慢设备上画面帧率≈识别帧率）。
export var ENGINES = [
  { id: 'mn-worker-gl', label: 'MoveNet 闪电（后台 GPU）', points: 17, kind: 'movenet-worker', backend: 'webgl' },
  { id: 'mn-worker', label: 'MoveNet 闪电（后台 CPU）', points: 17, kind: 'movenet-worker', backend: 'wasm' },
  { id: 'mp-lite', label: 'MediaPipe 精简', points: 33, kind: 'mediapipe', complexity: 0 },
  { id: 'mn-webgl', label: 'MoveNet 闪电（GPU）', points: 17, kind: 'movenet', backend: 'webgl' },
  { id: 'mn-wasm', label: 'MoveNet 闪电（CPU）', points: 17, kind: 'movenet', backend: 'wasm' },
  { id: 'mp-full', label: 'MediaPipe 标准', points: 33, kind: 'mediapipe', complexity: 1 }
];

export function engineInfo(id) {
  for (var i = 0; i < ENGINES.length; i++) if (ENGINES[i].id === id) return ENGINES[i];
  return null;
}

var glCache = null;
function hasWebGL() {
  if (glCache !== null) return glCache;
  try {
    var c = document.createElement('canvas');
    glCache = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { glCache = false; }
  return glCache;
}

// 后台线程能不能用 GPU：OffscreenCanvas 要能拿到 WebGL
var offGlCache = null;
function hasOffscreenWebGL() {
  if (offGlCache !== null) return offGlCache;
  try {
    var c = new OffscreenCanvas(1, 1);
    offGlCache = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { offGlCache = false; }
  return offGlCache;
}

// 返回 null 表示可以用；否则返回不能用的原因
export function unsupportedReason(id) {
  var info = engineInfo(id);
  if (!info) return '未知引擎';
  if (typeof WebAssembly !== 'object') return '不支持 WebAssembly';
  if (info.kind === 'mediapipe' || info.backend === 'webgl') {
    if (!hasWebGL()) return '不支持 WebGL';
  }
  if (info.kind === 'movenet-worker') {
    if (typeof Worker !== 'function') return '不支持后台线程';
    if (typeof createImageBitmap !== 'function') return '不支持 createImageBitmap';
    if (typeof OffscreenCanvas !== 'function') return '不支持 OffscreenCanvas';
    if (info.backend === 'webgl' && !hasOffscreenWebGL()) return '后台线程不能用 GPU';
  }
  return null;
}

export function createEngine(id) {
  if (id && id.indexOf('mock:') === 0) return new MockEngine(id.slice(5));
  var info = engineInfo(id);
  if (!info) throw new Error('未知引擎：' + id);
  if (info.kind === 'mediapipe') return new MediaPipeEngine(info);
  if (info.kind === 'movenet') return new MoveNetEngine(info);
  return new MoveNetWorkerEngine(info);
}

/* ---------- MediaPipe Pose（33 点，主线程 WASM） ---------- */
function MediaPipeEngine(info) {
  this.info = info;
  this.pose = null;
  this.latest = null;
}

MediaPipeEngine.prototype.mainThread = true;

MediaPipeEngine.prototype.init = function (onStatus) {
  var self = this;
  var dir = BASE + 'vendor/mediapipe-pose/';
  if (onStatus) onStatus('加载 MediaPipe 运行库');
  return loadScript(dir + 'pose.js').then(function () {
    var Pose = window.Pose;
    if (!Pose) throw new Error('MediaPipe 未就绪');
    var pose = new Pose({ locateFile: function (f) { return dir + f; } });
    pose.setOptions({
      modelComplexity: self.info.complexity,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      selfieMode: false
    });
    pose.onResults(function (r) { self.latest = r; });
    self.pose = pose;
    if (onStatus) onStatus('加载 MediaPipe 模型');
    return pose.initialize();
  });
};

MediaPipeEngine.prototype.estimate = function (video) {
  var self = this;
  self.latest = null;
  return self.pose.send({ image: video }).then(function () {
    var r = self.latest;
    if (!r || !r.poseLandmarks) return null;
    return fromMediaPipe(r.poseLandmarks);
  });
};

MediaPipeEngine.prototype.dispose = function () {
  if (this.pose) {
    try { this.pose.close(); } catch (e) { /* ignore */ }
  }
  this.pose = null;
};

/* ---------- MoveNet（17 点，主线程 TF.js：GPU 或 CPU） ---------- */
function loadTfjs(withWasm) {
  var dir = BASE + 'vendor/tfjs/';
  return loadScript(dir + 'tf.min.js').then(function () {
    if (withWasm) return loadScript(dir + 'tf-backend-wasm.min.js');
  }).then(function () {
    if (!window.tfwebgpu) window.tfwebgpu = {};
    return loadScript(dir + 'pose-detection.min.js');
  });
}

function MoveNetEngine(info) {
  this.info = info;
  this.detector = null;
}

MoveNetEngine.prototype.mainThread = true;

MoveNetEngine.prototype.init = function (onStatus) {
  var self = this;
  var wasm = self.info.backend === 'wasm';
  if (onStatus) onStatus('加载 TF.js 运行库');
  return loadTfjs(wasm).then(function () {
    var tf = window.tf;
    if (wasm) tf.wasm.setWasmPaths(BASE + 'vendor/tfjs/');
    return tf.setBackend(self.info.backend);
  }).then(function (okBackend) {
    if (okBackend === false) throw new Error(self.info.backend + ' 后端不可用');
    return window.tf.ready();
  }).then(function () {
    if (onStatus) onStatus('加载 MoveNet 模型');
    var pd = window.poseDetection;
    return pd.createDetector(pd.SupportedModels.MoveNet, {
      modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
      modelUrl: BASE + 'models/movenet-lightning.json',
      enableSmoothing: true
    });
  }).then(function (det) {
    self.detector = det;
  });
};

MoveNetEngine.prototype.estimate = function (video, t) {
  return this.detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false }, t).then(function (poses) {
    if (!poses || !poses.length) return null;
    return fromMoveNet(poses[0].keypoints, video.videoWidth, video.videoHeight);
  });
};

MoveNetEngine.prototype.dispose = function () {
  if (this.detector) {
    try { this.detector.dispose(); } catch (e) { /* ignore */ }
  }
  this.detector = null;
};

/* ---------- MoveNet 后台线程（在 Worker 里跑 GPU 或 CPU，主线程只管画面，游戏更流畅） ---------- */
function MoveNetWorkerEngine(info) {
  this.info = info;
  this.worker = null;
  this.pending = null;
  this.workerMs = 0;
  this.grabMs = 0; // 主线程从摄像头取一帧（createImageBitmap）的平均耗时
  this.resizeOk = true;
}

MoveNetWorkerEngine.prototype.mainThread = false;

MoveNetWorkerEngine.prototype.init = function (onStatus) {
  var self = this;
  if (onStatus) onStatus('启动后台识别线程');
  return new Promise(function (resolve, reject) {
    var w;
    try {
      w = new Worker(BASE + 'js/pose/movenet-worker.js');
    } catch (e) { reject(e); return; }
    self.worker = w;
    var timer = setTimeout(function () { reject(new Error('后台线程加载超时')); }, 90000);
    w.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === 'status' && onStatus) onStatus(m.text);
      else if (m.type === 'ready') { clearTimeout(timer); self.threads = m.threads || 1; self.workerInfo = m; resolve(); }
      else if (m.type === 'error') {
        clearTimeout(timer);
        if (self.pending) { self.pending.reject(new Error(m.message)); self.pending = null; }
        else reject(new Error(m.message));
      } else if (m.type === 'pose' && self.pending) {
        var p = self.pending;
        self.pending = null;
        self.workerMs = m.ms;
        p.resolve(m.keypoints ? fromMoveNet(m.keypoints, m.w, m.h) : null);
      }
    };
    w.onerror = function (e) {
      clearTimeout(timer);
      reject(new Error('后台线程出错：' + (e.message || '')));
    };
    w.postMessage({ type: 'init', base: BASE, backend: self.info.backend || 'wasm' });
  });
};

MoveNetWorkerEngine.prototype._bitmap = function (video, tw, th) {
  var self = this;
  if (self.resizeOk) {
    return createImageBitmap(video, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'low' }).catch(function () {
      self.resizeOk = false;
      return createImageBitmap(video);
    });
  }
  return createImageBitmap(video);
};

MoveNetWorkerEngine.prototype.estimate = function (video, t) {
  var self = this;
  var vw = video.videoWidth, vh = video.videoHeight;
  var tw = Math.min(640, vw), th = Math.round(tw * vh / vw);
  var g0 = performance.now();
  return self._bitmap(video, tw, th).then(function (bmp) {
    var g = performance.now() - g0;
    self.grabMs = self.grabMs ? self.grabMs * 0.8 + g * 0.2 : g;
    return new Promise(function (resolve, reject) {
      self.pending = { resolve: resolve, reject: reject };
      self.worker.postMessage({ type: 'frame', bmp: bmp, w: bmp.width, h: bmp.height, t: t }, [bmp]);
    });
  });
};

MoveNetWorkerEngine.prototype.dispose = function () {
  if (this.worker) this.worker.terminate();
  this.worker = null;
  if (this.pending) {
    this.pending.reject(new Error('已停止'));
    this.pending = null;
  }
};

/* ---------- 模拟引擎：按脚本生成骨架，测试和演示用 ---------- */
function MockEngine(name) {
  this.script = MOCK_SCRIPTS[name] || MOCK_SCRIPTS.still;
  this.t0 = null;
  this.latency = 35;
}

MockEngine.prototype.mainThread = false;

MockEngine.prototype.init = function () { return Promise.resolve(); };

MockEngine.prototype.estimate = function (video, t) {
  var self = this;
  if (self.t0 === null) self.t0 = t;
  var kp = self.script(t - self.t0);
  return sleep(self.latency).then(function () { return kp; });
};

MockEngine.prototype.dispose = function () {};
