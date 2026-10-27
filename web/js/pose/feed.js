// 识别循环：一帧识别完再取下一帧（不排队），把最新骨架推给当前页面。
// 同时统计识别耗时、识别帧率，供设备测试和性能信息使用。
import { createEngine } from './engines.js';
import { now, raf, sleep, keepLast, percentile } from '../core/util.js';

export var feed = {
  video: null,
  mock: null,          // 模拟脚本名（?mock=…），有值时不用摄像头
  engine: null,
  engineId: null,
  running: false,
  gen: 0,
  latest: null,
  listeners: [],
  infer: [],
  stamps: [],
  errors: 0,
  lastError: null,
  // 每次识别完让画面先刷新几帧再识别下一帧。0 = 自动：
  // 主线程引擎识别时会卡住画面，留 2 帧（识别略慢一点，画面顺很多）；后台线程引擎留 1 帧。
  yieldFrames: 0
};

feed.setVideo = function (v) { feed.video = v; };

feed.useEngine = function (id, onStatus) {
  var want = feed.mock ? 'mock:' + feed.mock : id;
  if (feed.engine && feed.engineId === want) return Promise.resolve(feed.engine);
  feed.stop();
  if (feed.engine) {
    try { feed.engine.dispose(); } catch (e) { /* ignore */ }
  }
  feed.engine = null;
  feed.engineId = null;
  var eng = createEngine(want);
  return eng.init(onStatus).then(function () {
    feed.engine = eng;
    feed.engineId = want;
    feed.resetStats();
    return eng;
  }, function (e) {
    try { eng.dispose(); } catch (e2) { /* ignore */ }
    throw e;
  });
};

feed.release = function () {
  feed.stop();
  if (feed.engine) {
    try { feed.engine.dispose(); } catch (e) { /* ignore */ }
  }
  feed.engine = null;
  feed.engineId = null;
};

feed.on = function (fn) {
  feed.listeners.push(fn);
  return function () {
    var i = feed.listeners.indexOf(fn);
    if (i >= 0) feed.listeners.splice(i, 1);
  };
};

feed.resetStats = function () {
  feed.statsFrom = now();
  feed.infer = [];
  feed.stamps = [];
  feed.errors = 0;
  feed.lastError = null;
};

// 最近 windowMs 内的识别帧率与耗时分位数
feed.stats = function (windowMs) {
  var w = windowMs || 3000;
  var t = now();
  // 刚开始识别不到 w 毫秒时按实际经过的时间算，不然刚开局会把快设备误判成慢设备
  var span = Math.max(200, Math.min(w, t - (feed.statsFrom || 0)));
  var n = 0;
  for (var i = feed.stamps.length - 1; i >= 0; i--) {
    if (t - feed.stamps[i] <= w) n++;
    else break;
  }
  var recent = feed.infer.slice(-Math.max(1, n));
  return {
    fps: n / (span / 1000),
    p50: percentile(recent, 0.5),
    p95: percentile(recent, 0.95),
    n: n
  };
};

feed.start = function () {
  if (feed.running) return;
  // 识别帧率只算这次开始以后的（停过一阵再开始，不能把中间停的时间也算进去）
  feed.statsFrom = now();
  feed.stamps = [];
  feed.infer = [];
  feed.running = true;
  feed.gen += 1;
  loop(feed.gen);
};

feed.stop = function () {
  feed.running = false;
  feed.gen += 1;
};

// 用 while 循环而不是递归 Promise 链，长时间运行也不会越积越多
async function loop(gen) {
  var lastTime = -1;
  while (feed.running && gen === feed.gen) {
    var eng = feed.engine;
    if (!eng) { await sleep(60); continue; }
    var v = feed.video;
    var mock = !!feed.mock;
    var nat = eng.usesVideo === false; // 原生识别不用网页的摄像头
    if (!mock && !nat) {
      if (!v || v.readyState < 2 || !v.videoWidth) { await raf(); continue; }
      if (v.currentTime === lastTime) { await raf(); continue; }
      lastTime = v.currentTime;
    }
    var t0 = now();
    var kp = null;
    try {
      kp = await eng.estimate(mock || nat ? null : v, t0);
    } catch (e) {
      feed.errors += 1;
      feed.lastError = e;
      if (window.console) console.warn('识别出错', e);
      await sleep(250);
      continue;
    }
    if (gen !== feed.gen) break;
    var t1 = now();
    // 原生识别：这边量到的是等下一组关键点的时间，单帧耗时用安卓里实测的
    feed.infer.push(nat && eng.lastMs != null ? eng.lastMs : t1 - t0);
    keepLast(feed.infer, 400);
    feed.stamps.push(t1);
    keepLast(feed.stamps, 400);
    // 双人时引擎返回 [左半边的人, 右半边的人]（摄像头画面的左右）
    var kps = Array.isArray(kp) ? kp : null;
    feed.latest = {
      kp: kps ? null : kp,
      kps: kps,
      t: nat && eng.captureTime != null ? eng.captureTime : t0, // 画面拍下的时间，用来做延迟补偿
      t1: t1,
      w: nat ? eng.frameW : (mock ? 1280 : v.videoWidth),
      h: nat ? eng.frameH : (mock ? 720 : v.videoHeight)
    };
    for (var i = 0; i < feed.listeners.length; i++) {
      try { feed.listeners[i](feed.latest); } catch (e2) { if (window.console) console.error(e2); }
    }
    // 原生识别不占网页主线程，不用让画面；关键点来了就送出去
    var frames = nat ? 0 : (feed.yieldFrames > 0 ? feed.yieldFrames : (eng.mainThread ? 2 : 1));
    for (var k = 0; k < frames && feed.running && gen === feed.gen; k++) await raf();
  }
}
