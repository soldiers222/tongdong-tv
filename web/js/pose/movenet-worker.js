/* 后台识别线程：在 Worker 里用 TF.js 跑 MoveNet（GPU：WebGL + OffscreenCanvas；CPU：WASM），
   主线程只负责画面，游戏更流畅。普通脚本（非模块），用 importScripts 加载本地运行库。 */
/* global importScripts, tf, poseDetection */
var detector = null;

self.tfwebgpu = self.tfwebgpu || {};

function post(m, transfer) { self.postMessage(m, transfer || []); }

function init(base, backend) {
  var gpu = backend === 'webgl';
  try {
    post({ type: 'status', text: '后台线程：加载 TF.js 运行库' });
    if (gpu) importScripts(base + 'vendor/tfjs/tf.min.js', base + 'vendor/tfjs/pose-detection.min.js');
    else importScripts(base + 'vendor/tfjs/tf.min.js', base + 'vendor/tfjs/tf-backend-wasm.min.js', base + 'vendor/tfjs/pose-detection.min.js');
  } catch (e) {
    post({ type: 'error', message: '运行库加载失败：' + (e && e.message ? e.message : e) });
    return;
  }
  if (!gpu) tf.wasm.setWasmPaths(base + 'vendor/tfjs/');
  tf.setBackend(gpu ? 'webgl' : 'wasm').then(function (ok) {
    if (ok === false) throw new Error(gpu ? '后台线程不能用 GPU' : 'WASM 后端不可用');
    return tf.ready();
  }).then(function () {
    post({ type: 'status', text: '后台线程：加载 MoveNet 模型' });
    return poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      modelUrl: base + 'models/movenet-lightning.json',
      enableSmoothing: true
    });
  }).then(function (d) {
    // 预热：第一次识别要编译显卡程序（可能好几秒），放在加载阶段做掉，开始玩时就不卡
    post({ type: 'status', text: '后台线程：预热识别模型' });
    return d.estimatePoses(new ImageData(192, 192), { maxPoses: 1, flipHorizontal: false }).then(function () {
      if (d.reset) d.reset();
      return d;
    });
  }).then(function (d) {
    detector = d;
    post({ type: 'ready', backend: tf.getBackend() });
  }).catch(function (e) {
    post({ type: 'error', message: 'MoveNet 初始化失败：' + (e && e.message ? e.message : e) });
  });
}

function run(m) {
  var t0 = performance.now();
  var bmp = m.bmp;
  detector.estimatePoses(bmp, { maxPoses: 1, flipHorizontal: false }, m.t).then(function (poses) {
    var ms = performance.now() - t0;
    try { bmp.close(); } catch (e) { /* ignore */ }
    var kps = null;
    if (poses && poses.length) {
      kps = poses[0].keypoints.map(function (k) { return { x: k.x, y: k.y, score: k.score, name: k.name }; });
    }
    post({ type: 'pose', keypoints: kps, w: m.w, h: m.h, ms: ms });
  }).catch(function (e) {
    try { bmp.close(); } catch (e2) { /* ignore */ }
    post({ type: 'error', message: '识别出错：' + (e && e.message ? e.message : e) });
  });
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'init') init(m.base, m.backend);
  else if (m.type === 'frame') {
    if (!detector) {
      try { m.bmp.close(); } catch (e2) { /* ignore */ }
      post({ type: 'pose', keypoints: null, w: m.w, h: m.h, ms: 0 });
      return;
    }
    run(m);
  }
};
