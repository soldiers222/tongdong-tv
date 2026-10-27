// 端到端测试：本机 Chrome 无头模式 + 假摄像头。
// 用法：cd tests && npm install && FAKE_CAMERA=/path/person.y4m node e2e.mjs
//   FAKE_CAMERA 可选：提供一段 y4m 全身视频（见 make-fixture.py）时，会用真实识别模型跑设备测试。
//   CHROME 可选：Chrome 路径，默认 /opt/google/chrome/chrome。
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB = join(ROOT, 'web');
const OUT = process.env.E2E_OUT || join(ROOT, 'tests', 'out');
const FIXTURE = process.env.FAKE_CAMERA || '';
const CHROME = process.env.CHROME || '/opt/google/chrome/chrome';
const PORT = Number(process.env.PORT || 8765);
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? '✓ ' : '✗ ') + name + (detail ? '：' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 静态服务器。默认带跨源隔离响应头，和电视版 APK 一样（ISOLATE=0 时不带，和网页版一样）
const ISOLATE = process.env.ISOLATE !== '0';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(WEB, p));
  const headers = ISOLATE ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } : {};
  if (!file.startsWith(WEB)) { res.writeHead(403, headers); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', ...headers });
    res.end(data);
  } catch (e) {
    res.writeHead(404, headers);
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log('跨源隔离：' + (ISOLATE ? '开（同电视版 APK）' : '关（同网页版）'));

const args = [
  '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
  '--window-size=1920,1080'
];
if (FIXTURE) args.push('--use-file-for-fake-video-capture=' + FIXTURE);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, protocolTimeout: 300000 });

// 模拟电视版 APK 的安卓接口（TongdongNative）：原生识别每秒推 25 组关键点（站着的人，右手左右挥）
function nativeStub() {
  var timer = null;
  var t0 = 0;
  var log = { starts: 0, stops: 0, previews: [], startOpts: [], configs: [], benches: [] };
  var config = { accel: 'cpu', threads: 3, workers: 2 };
  window.__nativeLog = log;
  // 模拟算力：单次耗时 = 40 + 30/线程数 毫秒，几路并行就快几倍；GPU 不在兼容列表；NNAPI 每秒 15 次
  function benchResult(c) {
    if (c.accel === 'gpu') return { ok: false, accel: 'gpu', error: 'GPU 不在 TensorFlow Lite 的兼容列表里' };
    var ms = c.accel === 'nnapi' ? 66 : 40 + 30 / c.threads;
    return { ok: true, accel: c.accel, threads: c.threads, workers: c.workers, fps: c.workers * 1000 / ms, p50: ms, p95: ms * 1.2, cpu: c.threads * c.workers * 0.9, model: 'movenet_lightning_int8.tflite' };
  }
  function pose(t) {
    var p = [
      [0.50, 0.20], [0.49, 0.19], [0.51, 0.19], [0.48, 0.20], [0.52, 0.20],
      [0.45, 0.30], [0.55, 0.30], [0.42, 0.42], [0.58, 0.40],
      [0.40, 0.52], [0.60, 0.40], [0.46, 0.55], [0.54, 0.55],
      [0.46, 0.72], [0.54, 0.72], [0.46, 0.90], [0.54, 0.90]
    ];
    var ph = t / 1000 * Math.PI * 2 * 0.7;
    p[10] = [0.5 + 0.3 * Math.sin(ph), 0.32 + 0.08 * Math.cos(ph * 2)];
    p[8] = [0.55 + 0.12 * Math.sin(ph), 0.38];
    var k = [];
    for (var i = 0; i < 17; i++) k.push(p[i][0], p[i][1], 0.8);
    return k;
  }
  window.TongdongNative = {
    poseAvailable: function () { return true; },
    hasCameraPermission: function () { return true; },
    poseStart: function (opts) {
      log.starts++;
      var o = JSON.parse(opts || '{}');
      log.startOpts.push(o);
      if (o.accel) config = { accel: o.accel, threads: o.threads, workers: o.workers };
      if (!timer) {
        t0 = performance.now();
        timer = setInterval(function () {
          if (window.__tdNativePose) window.__tdNativePose({ k: pose(performance.now() - t0), w: 640, h: 480, age: 30, ms: 18.5 });
        }, 40);
      }
      return JSON.stringify({ ok: true, w: 640, h: 480 });
    },
    poseStop: function () { log.stops++; clearInterval(timer); timer = null; },
    poseInfo: function () {
      var t = performance.now();
      return JSON.stringify({ camera: '0', facing: 'back', level: 'EXTERNAL', w: 640, h: 480, pw: 1440, ph: 1080, rotation: 0, threads: config.threads * config.workers, config: config, input: 'UINT8', running: !!timer, p50: 18.5, p95: 22, fps: 25, camFps: 25, sampleMs: 0.6, cpuMs: Math.round(t * 2.5), wallMs: Math.round(t), bad: [], error: '' });
    },
    poseConfig: function (json) {
      var c = JSON.parse(json);
      log.configs.push(c);
      config = { accel: c.accel, threads: c.threads, workers: c.workers };
      return JSON.stringify({ ok: true });
    },
    poseBench: function (json) {
      var c = JSON.parse(json);
      log.benches.push(c);
      setTimeout(function () { if (window.__tdNativeBench) window.__tdNativeBench(benchResult(c)); }, c.ms || 300);
    },
    cameraSizes: function () { return '[]'; },
    preview: function (json) { log.previews.push(JSON.parse(json)); },
    info: function () {
      var cpus = [];
      for (var i = 0; i < 8; i++) cpus.push({ i: i, mhz: i < 4 ? 1800 : 1400, part: i < 4 ? 'A73' : 'A53' });
      return JSON.stringify({ manufacturer: 'HUAWEI', model: 'FREU-560B', android: '12', sdk: 31, harmony: '4.3.0', app: 'stub', webview: 'stub', cameraPermission: true, nativePose: true, cpus: cpus });
    }
  };
}

const external = [];
const pageErrors = [];
async function open(path, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  if (opts && opts.nativeStub) await page.evaluateOnNewDocument(nativeStub);
  page.on('request', (req) => {
    const u = req.url();
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.on('pageerror', (e) => pageErrors.push(path + ' → ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(path + ' → console: ' + m.text()); });
  await page.goto(BASE + path, { waitUntil: 'load' });
  return page;
}
async function waitFor(page, fn, timeout, arg) {
  try { await page.waitForFunction(fn, { timeout, polling: 250 }, arg); return true; } catch (e) { return false; }
}
const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.png') });

try {
  // 1. 首页与遥控器导航
  {
    const page = await open('/');
    check('首页显示', await waitFor(page, () => document.querySelector('#screen-home.active'), 8000));
    check('展示字体已加载', await page.evaluate(() => document.fonts.check('48px "TD Display"')));
    await sleep(300);
    await shot(page, '01-home');
    const id = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    check('默认焦点在西瓜切切切', (await id()) === 'lane-fruit');
    await page.keyboard.press('ArrowDown');
    check('下键到金鸡独立', (await id()) === 'lane-balance');
    await page.keyboard.press('ArrowDown');
    check('再下键到设备测试', (await id()) === 'tool-day0');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    check('右键两次进入家长设置', await waitFor(page, () => document.querySelector('#screen-settings.active'), 3000));
    const before = await page.evaluate(() => document.activeElement.querySelector('.val').textContent);
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => document.activeElement.querySelector('.val').textContent);
    check('左右键修改年龄段', before !== after, before + ' → ' + after);
    await page.keyboard.press('ArrowLeft');
    await shot(page, '06-settings');
    await page.keyboard.press('Escape');
    check('返回键回首页', await waitFor(page, () => document.querySelector('#screen-home.active'), 3000));
    check('首页返回返回 false（外壳据此退出）', (await page.evaluate(() => window.__tdBack())) === false);
    await page.close();
  }

  // 1b. 电视视口：像素比 1.75 的小视口；WebView 先把页面缩小又恢复（华为电视上出现过画面被放大裁掉）
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1097, height: 617, deviceScaleFactor: 1.75 });
    const cdp = await page.target().createCDPSession();
    page.on('pageerror', (e) => pageErrors.push('tv → ' + e.message));
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.571 });
    await page.goto(BASE + '/?mock=still&screen=day0', { waitUntil: 'load' });
    await waitFor(page, () => document.querySelector('#screen-day0.active'), 8000);
    await sleep(600);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await sleep(400);
    // 焦点移到最下面的按钮，再按一次方向键
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await sleep(200);
    const box = await page.evaluate(() => {
      const r = document.getElementById('app').getBoundingClientRect();
      const de = document.documentElement;
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, cw: de.clientWidth, ch: de.clientHeight, sx: window.scrollX, sy: window.scrollY, view: window.TD.view() };
    });
    const fits = Math.abs(box.l) < 2 && Math.abs(box.t) < 2 && Math.abs(box.r - box.cw) < 2 && Math.abs(box.b - box.ch) < 2;
    check('电视视口下画布正好铺满屏幕', fits, JSON.stringify(box));
    check('焦点移动不滚动页面', box.sx === 0 && box.sy === 0);
    check('设备测试显示画面信息', /像素比/.test(await page.evaluate(() => document.getElementById('d0-view').textContent)));
    await shot(page, '00-tv-viewport');
    await page.close();
  }

  // 2. 西瓜切切切（模拟骨架）
  {
    const page = await open('/?mock=fruit&screen=fruit&dur=12');
    await sleep(9000);
    await shot(page, '02-fruit-play');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('切水果一局结束并出结算', done && rec && rec.type === 'fruit');
    check('模拟挥手切中水果得分', rec && rec.score > 0, rec ? `得分 ${rec.score}，切中 ${rec.sliced}，连切 ${rec.maxCombo}` : '');
    await sleep(400);
    await shot(page, '03-fruit-result');
    check('结算页焦点在「再来一局」', (await page.evaluate(() => document.activeElement.id)) === 'btn-again');
    await page.keyboard.press('Enter');
    check('再来一局重新倒计时', await waitFor(page, () => window.TD.play.debug().phase === 'count' || window.TD.play.debug().phase === 'play', 3000));
    // 电视外壳切到后台 / 回到前台
    await page.evaluate(() => window.__tdPause());
    check('切到后台时停止运动', (await page.evaluate(() => window.TD.play.debug().running)) === false);
    await page.evaluate(() => window.__tdResume());
    check('回到前台重新开始这一局', await waitFor(page, () => window.TD.play.debug().running === true, 8000));
    await page.close();
  }

  // 3. 金鸡独立（模拟骨架：左脚站约 5 秒、右脚站约 4.5 秒，最后举双手）
  {
    const page = await open('/?mock=balance&screen=balance&target=30');
    await sleep(7500);
    await shot(page, '04-balance-hold');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 45000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    await shot(page, '05-balance-result');
    check('金鸡独立两轮结束并出结算', done && rec && rec.legs && rec.legs.length === 2);
    if (rec && rec.legs) {
      const [a, b] = rec.legs;
      check('左脚站计时合理（3–7 秒）', a.stand === 'left' && a.holdMs > 3000 && a.holdMs < 7000, a.holdMs + ' 毫秒，' + a.reason);
      check('右脚站计时合理（3–7 秒）', b.stand === 'right' && b.holdMs > 3000 && b.holdMs < 7000, b.holdMs + ' 毫秒，' + b.reason);
      check('脚落地判定为失稳', a.reason === 'down' && b.reason === 'down');
    }
    const replay = await waitFor(page, () => ['intro', 'judge'].indexOf(window.TD.play.debug().phase) >= 0 && !window.TD.play.debug().showingResult, 8000);
    check('举起双手自动再来一局', replay);
    await page.close();
  }

  // 4. 设备测试（真实识别模型 + 假摄像头视频）
  if (FIXTURE) {
    const page = await open('/?screen=day0&bench=fast');
    check('设备测试打开摄像头', await waitFor(page, () => /×/.test(document.getElementById('d0-cam').textContent), 15000));
    await page.click('#d0-run');
    const ok = await waitFor(page, () => !window.TD.day0.debug().benching && window.TD.day0.debug().results.length === 7, 330000);
    const dbg = await page.evaluate(() => window.TD.day0.debug());
    check('七个引擎都测完', ok, dbg.results.map((r) => r.id + (r.error ? '（' + r.error + '）' : ' ' + r.fps.toFixed(1) + 'fps/' + r.kpAvg.toFixed(1) + '点')).join('；'));
    const nat = dbg.results.find((x) => x.id === 'native');
    check('浏览器里原生识别标为不支持', nat && /只有电视版 APK 能用/.test(nat.error || ''), nat ? nat.error : '无结果');
    for (const id of ['mn-worker-gl', 'mn-worker', 'mp-lite', 'mn-webgl', 'mn-wasm']) {
      const r = dbg.results.find((x) => x.id === id);
      check(id + ' 识别到人体', r && !r.error && r.fps > 0 && r.kpAvg >= 8, r ? (r.error || r.kpAvg.toFixed(1) + ' 个关键点') : '无结果');
    }
    await sleep(2500);
    const fit = await page.evaluate(() => window.TD.day0.debug().lastFit);
    check('全身入镜检测有结果', !!fit, fit ? fit.msg : '');
    await shot(page, '07-day0');
    await page.click('#d0-summary-btn');
    await sleep(300);
    await shot(page, '08-day0-summary');
    writeFileSync(join(OUT, 'day0-summary.txt'), dbg.summary);
    await page.close();
  }

  // 4c. 电视版原生识别（模拟安卓接口）：设备测试
  {
    const page = await open('/?screen=day0&bench=fast&engines=native,mn-wasm', { nativeStub: true });
    check('原生识别：设备测试直接用原生摄像头', await waitFor(page, () => /原生/.test(document.getElementById('d0-cam').textContent), 8000),
      await page.evaluate(() => document.getElementById('d0-cam').textContent));
    check('原生识别：收到关键点', await waitFor(page, () => window.TD.feed.engineId === 'native' && window.TD.feed.latest && window.TD.feed.latest.kp, 5000));
    const lay = await page.evaluate(() => {
      const p = window.__nativeLog.previews.filter((x) => x.show).pop();
      const r = document.querySelector('.d0-preview').getBoundingClientRect();
      return { p, r: { x: r.left, y: r.top, w: r.width, h: r.height }, cls: document.body.classList.contains('native-cam') };
    });
    const near = (a, b) => Math.abs(a - b) < 2;
    check('原生识别：网页变透明，预览层对准画面框', lay.cls && lay.p && near(lay.p.x, lay.r.x) && near(lay.p.y, lay.r.y) && near(lay.p.w, lay.r.w) && lay.p.fit === 'contain', JSON.stringify(lay));
    await sleep(800);
    await shot(page, '11-native-day0');
    await page.click('#d0-run');
    const ok = await waitFor(page, () => !window.TD.day0.debug().benching && window.TD.day0.debug().results.length === 2, 150000);
    const dbg = await page.evaluate(() => window.TD.day0.debug());
    const nat = dbg.results.find((x) => x.id === 'native');
    const wasm = dbg.results.find((x) => x.id === 'mn-wasm');
    const tune = await page.evaluate(() => ({ benches: window.__nativeLog.benches, configs: window.__nativeLog.configs, saved: window.TD.store.get().day0.nativeConfig }));
    check('原生识别：调优试了 CPU 和 GPU', tune.benches.length === 3 && tune.benches.some((b) => b.accel === 'gpu'), JSON.stringify(tune.benches));
    check('原生识别：选了跟得上摄像头、延迟最低的方式并换上', tune.saved && tune.saved.accel === 'cpu' && tune.saved.threads === 4 && tune.saved.workers === 2 && tune.configs.length === 1, JSON.stringify(tune.saved));
    check('原生识别：测速完成，速度接近每秒 25 次', ok && nat && !nat.error && nat.fps > 18 && nat.fps < 30, nat ? (nat.error || nat.fps.toFixed(1) + ' 帧/秒，画面 ' + Math.round(nat.renderFps) + ' 帧/秒') : '无结果');
    check('原生识别：单帧耗时用安卓里实测的', nat && nat.p50 > 18 && nat.p50 < 19, nat ? String(nat.p50) : '');
    check('原生识别：关键点数量', nat && nat.kpAvg >= 15, nat ? nat.kpAvg.toFixed(1) : '');
    check('原生识别让出摄像头后，网页摄像头能打开', wasm && !wasm.error, wasm ? (wasm.error || wasm.fps.toFixed(1) + ' 帧/秒') : '无结果');
    check('测速后接着用最快的原生识别', await waitFor(page, () => window.TD.feed.engineId === 'native' && document.body.classList.contains('native-cam'), 8000));
    const summary = await page.evaluate(() => window.TD.day0.debug().summary);
    check('结果摘要里有原生识别和两路摄像头', /原生识别（多核 CPU）：\d/.test(summary) && /原生摄像头：Camera2 #0 后置 EXTERNAL，识别 640×480，预览 1440×1080/.test(summary) && /网页摄像头：/.test(summary),
      summary.split('\n').filter((l) => /原生|摄像头/.test(l)).join(' / '));
    check('结果摘要里有 CPU、调优结果和进程占用', /CPU：4×A73 1\.8GHz \+ 4×A53 1\.4GHz/.test(summary) && /GPU：GPU 不在/.test(summary) && /选用：CPU 2 路×4 线程/.test(summary) && /进程用了 2\.5 核/.test(summary) && /摄像头 25 帧\/秒/.test(summary),
      summary.split('\n').filter((l) => /CPU|调优|选用|进程/.test(l)).join(' / '));
    writeFileSync(join(OUT, 'day0-native-summary.txt'), summary);
    await sleep(600);
    await shot(page, '12-native-day0-done');
    const stops0 = await page.evaluate(() => window.__nativeLog.stops);
    await page.evaluate(() => window.__tdBack());
    check('离开设备测试：停掉原生识别、收起预览层', await waitFor(page, (n) => {
      const log = window.__nativeLog;
      const last = log.previews[log.previews.length - 1];
      return document.querySelector('#screen-home.active') && !document.body.classList.contains('native-cam') && log.stops > n && last && last.show === false && !window.TD.feed.engine;
    }, 3000, stops0));
    await page.close();
  }

  // 4d. 电视版原生识别（模拟安卓接口）：切水果
  {
    const page = await open('/?screen=fruit&dur=10', { nativeStub: true });
    check('原生识别：切水果用原生识别', await waitFor(page, () => window.TD.feed.engineId === 'native' && window.TD.play.debug().running, 10000), await page.evaluate(() => window.TD.feed.engineId));
    const opts = await page.evaluate(() => window.__nativeLog.startOpts.slice(-1)[0]);
    check('原生识别：游戏用设备测试选好的方式', opts && opts.accel === 'cpu' && opts.threads === 4 && opts.workers === 2, JSON.stringify(opts));
    const lay = await page.evaluate(() => ({ p: window.__nativeLog.previews.filter((x) => x.show).pop(), cls: document.body.classList.contains('native-cam') }));
    check('原生识别：运动页透明，预览层铺满全屏', lay.cls && lay.p && lay.p.fit === 'cover' && Math.abs(lay.p.w - 1920) < 2 && Math.abs(lay.p.h - 1080) < 2, JSON.stringify(lay.p));
    await sleep(5000);
    await shot(page, '13-native-fruit');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('原生识别：切水果一局结束', done && rec && rec.type === 'fruit', rec ? `得分 ${rec.score}，切中 ${rec.sliced}` : '');
    const stops = await page.evaluate(() => window.__nativeLog.stops);
    await page.evaluate(() => window.__tdPause());
    check('切到后台：停掉原生识别', await page.evaluate((n) => window.__nativeLog.stops > n && !document.body.classList.contains('native-cam'), stops));
    const starts = await page.evaluate(() => window.__nativeLog.starts);
    await page.evaluate(() => window.__tdResume());
    check('回到前台：重新启动原生识别', await waitFor(page, (n) => window.__nativeLog.starts > n && window.TD.play.debug().running && document.body.classList.contains('native-cam'), 8000, starts));
    await page.evaluate(() => window.TD.go('home'));
    check('回首页：停掉原生识别', await waitFor(page, () => document.querySelector('#screen-home.active') && !document.body.classList.contains('native-cam') && !window.TD.feed.engine, 4000));
    await page.close();
  }

  // 4b. 外壳返回键：页面里有弹层时先关弹层
  {
    const page = await open('/?mock=still&screen=day0');
    await waitFor(page, () => document.querySelector('#screen-day0.active'), 8000);
    await page.click('#d0-summary-btn');
    const opened = await page.evaluate(() => document.getElementById('d0-summary').classList.contains('show'));
    const handled = await page.evaluate(() => window.__tdBack());
    const stillOpen = await page.evaluate(() => document.getElementById('d0-summary').classList.contains('show'));
    const onDay0 = await page.evaluate(() => !!document.querySelector('#screen-day0.active'));
    check('外壳返回键先关掉结果摘要', opened && handled === true && !stillOpen && onDay0);
    check('外壳返回键再按回首页', (await page.evaluate(() => window.__tdBack())) === true && await waitFor(page, () => document.querySelector('#screen-home.active'), 3000));
    await page.close();
  }

  // 5. 运动记录
  {
    const page = await open('/?screen=records');
    check('运动记录页显示', await waitFor(page, () => document.querySelectorAll('#rec-bars li').length === 7, 5000));
    await shot(page, '09-records');
    await page.close();
  }

  const home = await open('/');
  await waitFor(home, () => document.querySelector('#screen-home.active'), 8000);
  await sleep(300);
  await shot(home, '10-home-after');
  await home.close();

  check('没有访问外网', external.length === 0, external.slice(0, 5).join(' '));
  check('没有脚本报错', pageErrors.length === 0, pageErrors.slice(0, 6).join(' | '));
} catch (e) {
  check('测试脚本执行', false, e && e.stack ? e.stack : String(e));
} finally {
  await browser.close();
  server.close();
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 项未通过` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
