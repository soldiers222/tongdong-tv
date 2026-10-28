// 页面切换与返回键。摄像头在离开运动页 45 秒后自动关闭（升降摄像头会缩回去）。
import { setScope, setInterceptor } from './core/nav.js';
import { feed } from './pose/feed.js';
import { closeCamera } from './pose/camera.js';
import { ui } from './ui/ui.js';

var screens = {};
var current = null;
var currentName = null;
var currentParams = null;
var camTimer = null;
var suspended = false;
var CAMERA_SCREENS = { play: true, day0: true };

export function register(name, screen) { screens[name] = screen; }

export function currentName_() { return currentName; }

export function go(name, params) {
  var screen = screens[name];
  if (!screen) return;
  if (current && current.exit) current.exit();
  ui.hideLoading();
  var all = document.querySelectorAll('.screen');
  for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
  var el = document.getElementById('screen-' + name);
  el.classList.add('active');
  document.body.className = name === 'home' ? 'on-home' : (name === 'play' ? 'on-play' : 'on-page');
  current = screen;
  currentName = name;
  currentParams = params || {};
  suspended = false;
  setInterceptor(null);
  if (screen.enter) screen.enter(params || {});
  if (!screen.manageFocus) setScope(el);
  if (CAMERA_SCREENS[name]) {
    clearTimeout(camTimer);
    camTimer = null;
  } else {
    feed.stop();
    clearTimeout(camTimer);
    camTimer = setTimeout(function () { closeCamera(document.getElementById('cam')); }, 45000);
  }
}

// 返回 true 表示已处理；false 表示已经在首页（电视外壳会据此退出应用）
export function back() {
  if (ui.backOverlay()) return true;
  if (current && current.onBack && current.onBack() === true) return true;
  // 二级页面回到它的入口页（比如从体感游戏里进的切水果，回到体感游戏）
  var to = current && current.backTo ? current.backTo() : null;
  if (to) {
    go(to[0], to[1]);
    return true;
  }
  if (currentName !== 'home') {
    go('home');
    return true;
  }
  return false;
}

export function onHide() {
  if (current && current.onHide) current.onHide();
}

// 电视外壳切到后台（按了主页键等）：马上停识别、关摄像头，升降摄像头会缩回去
export function suspend() {
  if (suspended) return;
  if (current && current.onHide) current.onHide();
  if (CAMERA_SCREENS[currentName]) {
    suspended = true;
    if (current && current.exit) current.exit();
  }
  feed.stop();
  clearTimeout(camTimer);
  camTimer = null;
  closeCamera(document.getElementById('cam'));
}

// 回到前台：运动页和设备测试页重新进入（重新开摄像头、重新开始这一局）
export function wake() {
  if (!suspended) return;
  suspended = false;
  go(currentName, currentParams);
}
