// 童动乐园 · 入口
import * as store from './core/store.js';
import { initNav, backKey } from './core/nav.js';
import { unlockAudio, setSoundEnabled } from './core/sfx.js';
import { setVoiceEnabled } from './core/voice.js';
import { qs } from './core/util.js';
import { feed } from './pose/feed.js';
import { register, go, back, onHide, suspend, wake } from './router.js';
import { homeScreen } from './ui/home.js';
import { day0Screen } from './diag/day0.js';
import { playScreen } from './ui/play.js';
import { recordsScreen } from './ui/records.js';
import { settingsScreen } from './ui/settings.js';
import { hubScreen } from './ui/hub.js';
import { growthScreen } from './ui/growth.js';
import { VERSION } from './version.js';

var app = document.getElementById('app');

// 1920×1080 设计画布等比缩放到屏幕。
// 用布局视口（documentElement.clientWidth/Height）计算：电视的 WebView 可能先把页面整体缩放，
// innerWidth 会跟着变，按它算会放大一大截、四边被裁掉。
var fitState = { w: 0, h: 0, s: 1 };
function viewSize() {
  var de = document.documentElement;
  return { w: de.clientWidth || window.innerWidth, h: de.clientHeight || window.innerHeight };
}
function fit() {
  var v = viewSize();
  if (!v.w || !v.h) return;
  var s = Math.min(v.w / 1920, v.h / 1080);
  var x = (v.w - 1920 * s) / 2, y = (v.h - 1080 * s) / 2;
  app.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  fitState = { w: v.w, h: v.h, s: s };
  resetScroll();
}
function resetScroll() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  var se = document.scrollingElement;
  if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0; }
  if (document.body.scrollTop || document.body.scrollLeft) { document.body.scrollTop = 0; document.body.scrollLeft = 0; }
}
export function viewInfo() {
  var vv = window.visualViewport;
  return {
    w: fitState.w,
    h: fitState.h,
    s: fitState.s,
    dpr: window.devicePixelRatio || 1,
    iw: window.innerWidth,
    ih: window.innerHeight,
    zoom: vv && vv.scale ? vv.scale : 1
  };
}

function waitFont() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  var p = document.fonts.load('48px "TD Display"').catch(function () {});
  var t = new Promise(function (resolve) { setTimeout(resolve, 2500); });
  return Promise.race([p, t]);
}

// 直接打开某个玩法（测试用）：?screen=play&mode=dodge&variant=space、&course=yoga、&routine=beat&learn=1
function startParams() {
  var p = { mode: qs('mode') || 'fruit' };
  ['course', 'variant', 'routine', 'from'].forEach(function (k) { if (qs(k)) p[k] = qs(k); });
  if (qs('learn') === '1') p.learn = true;
  return p;
}

function boot() {
  store.load();
  var s = store.settings();
  var age = qs('age');
  if (age === '6-8' || age === '9-12') store.setSetting('age', age);
  var pl = qs('players');
  if (pl === '1' || pl === '2') store.setSetting('players', Number(pl));
  setSoundEnabled(s.sound);
  setVoiceEnabled(s.voice);
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  window.addEventListener('load', fit);
  window.addEventListener('scroll', resetScroll);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  // 电视 WebView 启动后视口可能还会变一两次，前几秒多校准几次
  [300, 1000, 2500, 5000].forEach(function (ms) { setTimeout(fit, ms); });
  initNav(function () { return back(); });
  document.addEventListener('keydown', unlockAudio, true);
  document.addEventListener('click', unlockAudio, true);
  document.addEventListener('touchstart', unlockAudio, true);

  feed.setVideo(document.getElementById('cam'));
  var mock = qs('mock');
  if (mock) feed.mock = mock;

  register('home', homeScreen);
  register('day0', day0Screen);
  register('play', playScreen);
  register('records', recordsScreen);
  register('settings', settingsScreen);
  register('hub', hubScreen);
  register('growth', growthScreen);

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-go],[data-back]') : null;
    if (!t) return;
    if (t.hasAttribute('data-back')) { back(); return; }
    var dest = t.getAttribute('data-go');
    if (dest === 'fruit' || dest === 'balance') go('play', { mode: dest });
    else if (dest === 'hub') go('hub', { id: t.getAttribute('data-hub') });
    else go(dest);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) onHide();
  });

  // 电视外壳（APK）调用的接口：
  //   __tdBack   按返回键。返回 false 表示已在首页，外壳提示「再按一次退出」
  //   __tdPause  切到后台，马上关摄像头
  //   __tdResume 回到前台
  window.__tdBack = function () { return backKey(); };
  window.__tdPause = function () { suspend(); };
  window.__tdResume = function () { wake(); };
  window.TD = { go: go, store: store, feed: feed, version: VERSION, play: playScreen, day0: day0Screen, view: viewInfo };

  waitFont().then(function () {
    var start = qs('screen');
    if (start === 'fruit' || start === 'balance') go('play', { mode: start });
    else if (start === 'play') go('play', startParams());
    else if (start === 'hub') go('hub', { id: qs('hub') || 'games' });
    else go(start || 'home');
  });
}

boot();
