// 电视版 APK 的原生识别：摄像头和 MoveNet 都在安卓里跑（多核 CPU），网页只收关键点。
// 摄像头画面由安卓显示在网页下层，网页把画面区域做成透明（html/body 加 native-cam 类）。
//
// 识别方式 { accel, threads, workers }：accel 是 cpu / gpu / nnapi，threads 是每个识别器几个线程，
// workers 是同时开几个识别器（几帧一起算）。设备测试里逐个实测，选最合适的存起来，游戏开始时用。
import * as store from '../core/store.js';

var shown = null; // 当前预览参数 { el, fit, mirror }

export function bridge() {
  var n = window.TongdongNative;
  return n && typeof n.poseStart === 'function' ? n : null;
}

export function available() {
  var n = bridge();
  if (!n || typeof n.poseAvailable !== 'function') return false;
  try { return !!n.poseAvailable(); } catch (e) { return false; }
}

export function info() {
  var n = bridge();
  if (!n || typeof n.poseInfo !== 'function') return null;
  try { return JSON.parse(n.poseInfo()); } catch (e) { return null; }
}

function send(el, fit, mirror) {
  var n = bridge();
  if (!n) return;
  var r = el.getBoundingClientRect();
  n.preview(JSON.stringify({ show: true, x: r.left, y: r.top, w: r.width, h: r.height, fit: fit, mirror: !!mirror }));
}

// 把摄像头画面放到 el 所在的位置（fit：cover 裁满 / contain 留边）
export function previewOn(el, fit, mirror) {
  if (!el || !bridge()) return;
  shown = { el: el, fit: fit || 'cover', mirror: !!mirror };
  document.documentElement.classList.add('native-cam');
  document.body.classList.add('native-cam');
  send(el, shown.fit, shown.mirror);
}

export function previewOff() {
  shown = null;
  document.documentElement.classList.remove('native-cam');
  document.body.classList.remove('native-cam');
  var n = bridge();
  if (n) {
    try { n.preview('{"show":false}'); } catch (e) { /* ignore */ }
  }
}

export function previewActive() { return !!shown; }

// 设备测试选好的识别方式（没测过返回 null，安卓用默认方式）。
// 双人时每帧要算两次（左右半边），要的算力翻倍，单独选一套
export function savedConfig(players) {
  var d0 = store.get().day0;
  if (!d0) return null;
  if (players !== 2) return d0.nativeConfig || null;
  if (d0.nativeConfig2) return d0.nativeConfig2;
  // 0.2.1 测的结果里还没有双人的：用存下来的调优数据现选
  var t = d0.nativeTune;
  if (!t || !t.list) return null;
  var list = [];
  for (var i = 0; i < t.list.length; i++) {
    var r = t.list[i];
    var cfg = r.cfg || parseLabel(r.label);
    if (cfg) list.push({ ok: r.ok, fps: r.fps, p50: r.p50, renderFps: r.renderFps, cfg: cfg });
  }
  var best = pickConfig(list, d0.baseFps, (t.camFps || 25) * 2);
  return best ? best.cfg : null;
}

// configLabel 的反过程（旧版存的调优结果只有文字）
export function parseLabel(label) {
  if (!label) return null;
  var w = /(\d+) 路/.exec(label), t = /(\d+) 线程/.exec(label);
  var workers = w ? Number(w[1]) : 1;
  if (label.indexOf('GPU') === 0) return { accel: 'gpu', threads: 2, workers: workers };
  if (label.indexOf('NNAPI') === 0) return { accel: 'nnapi', threads: 2, workers: workers };
  if (label.indexOf('CPU') === 0 && t) return { accel: 'cpu', threads: Number(t[1]), workers: workers };
  return null;
}

export function configLabel(c) {
  if (!c) return '默认';
  var w = c.workers > 1 ? c.workers + ' 路' : '';
  if (c.accel === 'gpu') return 'GPU' + (w ? ' ' + w : '');
  if (c.accel === 'nnapi') return 'NNAPI' + (w ? ' ' + w : '');
  return 'CPU ' + (w ? w + '×' : '') + c.threads + ' 线程';
}

// 正在跑的识别换成 cfg 的方式，返回 { ok, error }
export function configure(cfg) {
  var n = bridge();
  if (!n || typeof n.poseConfig !== 'function') return { ok: false, error: '这个版本的外壳不支持' };
  try { return JSON.parse(n.poseConfig(JSON.stringify(cfg))); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// 测 cfg 这种方式最快能算多快（不等摄像头，拿最近一帧反复算 ms 毫秒）。
// 结果 { ok, fps, p50, p95, cpu（进程平均用了几个核）, error }
var benchWaiter = null;
window.__tdNativeBench = function (r) {
  var w = benchWaiter;
  benchWaiter = null;
  if (w) w(r);
};
export function bench(cfg, ms) {
  var n = bridge();
  if (!n || typeof n.poseBench !== 'function') return Promise.resolve({ ok: false, error: '这个版本的外壳不支持测速' });
  return new Promise(function (resolve) {
    var done = false;
    var timer = 0;
    function finish(r) {
      if (done) return;
      done = true;
      benchWaiter = null;
      clearTimeout(timer);
      resolve(r || { ok: false, error: '没有结果' });
    }
    benchWaiter = finish;
    // GPU / NNAPI 第一次要编译模型，多给点时间
    timer = setTimeout(function () { finish({ ok: false, error: '超时' }); }, ms + 40000);
    try {
      n.poseBench(JSON.stringify({ accel: cfg.accel, threads: cfg.threads, workers: cfg.workers, ms: ms }));
    } catch (e) {
      finish({ ok: false, error: String(e && e.message || e) });
    }
  });
}

// 要试的识别方式：CPU 不同的线程数和并行路数（总线程不超过核数），再加 GPU、NNAPI
export function variants(cores) {
  var c = cores || 4;
  var cpu = [[4, 1], [8, 1], [2, 2], [3, 2], [4, 2], [2, 3], [2, 4]];
  var list = [];
  for (var i = 0; i < cpu.length; i++) {
    var t = Math.min(cpu[i][0], c), w = cpu[i][1];
    if (t * w > c) continue;
    var dup = list.some(function (x) { return x.threads === t && x.workers === w; });
    if (!dup) list.push({ accel: 'cpu', threads: t, workers: w });
  }
  list.push({ accel: 'gpu', threads: 2, workers: 1 });
  list.push({ accel: 'nnapi', threads: 2, workers: 1 });
  return list;
}

// 选识别方式：画面别被拖慢（不低于空载的 85%）、单帧不超过 150 毫秒；
// 算力够跟上摄像头（多留 15%）的里面选延迟最低的；都跟不上就选最快的
export function pickConfig(list, baseFps, camFps) {
  var ok = list.filter(function (r) { return r.ok && r.fps > 0; });
  if (!ok.length) return null;
  var good = ok.filter(function (r) { return (!baseFps || !r.renderFps || r.renderFps >= baseFps * 0.85) && r.p50 <= 150; });
  var pool = good.length ? good : ok;
  var target = (camFps > 0 ? camFps : 30) * 1.15;
  var enough = pool.filter(function (r) { return r.fps >= target; });
  if (enough.length) {
    enough.sort(function (a, b) { return a.p50 - b.p50; });
    return enough[0];
  }
  pool.sort(function (a, b) { return b.fps - a.fps; });
  var close = pool.filter(function (r) { return r.fps >= pool[0].fps * 0.95; });
  close.sort(function (a, b) { return a.p50 - b.p50; });
  return close[0];
}

// CPU 核心概况，比如「4×A73 2.0GHz + 4×A53 1.4GHz」
export function cpuText(cpus) {
  if (!cpus || !cpus.length) return '';
  var groups = [];
  for (var i = 0; i < cpus.length; i++) {
    var c = cpus[i];
    var g = null;
    for (var j = 0; j < groups.length; j++) if (groups[j].part === (c.part || '') && groups[j].mhz === (c.mhz || 0)) g = groups[j];
    if (!g) {
      g = { part: c.part || '', mhz: c.mhz || 0, n: 0 };
      groups.push(g);
    }
    g.n++;
  }
  groups.sort(function (a, b) { return b.mhz - a.mhz; });
  return groups.map(function (g) {
    return g.n + '×' + (g.part || '核') + (g.mhz ? ' ' + (g.mhz / 1000).toFixed(1) + 'GHz' : '');
  }).join(' + ');
}

// 页面刚加载（包括菜单里的「重新加载」）：上一个页面可能还开着原生识别和预览层，先关掉
(function () {
  var n = bridge();
  if (!n || typeof n.poseStop !== 'function') return;
  try { n.poseStop(); } catch (e) { /* ignore */ }
})();

// 画面缩放变化后重新对齐
window.addEventListener('resize', function () {
  if (shown) setTimeout(function () { if (shown) send(shown.el, shown.fit, shown.mirror); }, 50);
});
