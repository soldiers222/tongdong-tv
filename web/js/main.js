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
import { VERSION } from './version.js';

var app = document.getElementById('app');

// 1920×1080 设计画布等比缩放到屏幕
function fit() {
  var w = window.innerWidth, h = window.innerHeight;
  var s = Math.min(w / 1920, h / 1080);
  var x = (w - 1920 * s) / 2, y = (h - 1080 * s) / 2;
  app.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
}

function waitFont() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  var p = document.fonts.load('48px "TD Display"').catch(function () {});
  var t = new Promise(function (resolve) { setTimeout(resolve, 2500); });
  return Promise.race([p, t]);
}

function boot() {
  store.load();
  var s = store.settings();
  var age = qs('age');
  if (age === '6-8' || age === '9-12') store.setSetting('age', age);
  setSoundEnabled(s.sound);
  setVoiceEnabled(s.voice);
  fit();
  window.addEventListener('resize', fit);
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

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-go],[data-back]') : null;
    if (!t) return;
    if (t.hasAttribute('data-back')) { go('home'); return; }
    var dest = t.getAttribute('data-go');
    if (dest === 'fruit' || dest === 'balance') go('play', { mode: dest });
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
  window.TD = { go: go, store: store, feed: feed, version: VERSION, play: playScreen, day0: day0Screen };

  waitFont().then(function () {
    var start = qs('screen');
    if (start === 'fruit' || start === 'balance') go('play', { mode: start });
    else go(start && start !== 'play' ? start : 'home');
  });
}

boot();
