// 遥控器导航：方向键按位置找最近的可选项，确定键点击，返回键回上一页。
// 页面可注册拦截器，自己处理按键（比如游戏中按返回 = 暂停）。
import { sfx } from './sfx.js';

var scope = null;
var interceptor = null;
var onBackCb = null;
var onAnyKeyCb = null;

var KEYCODES = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down',
  13: 'enter',
  27: 'back', 8: 'back', 4: 'back', 166: 'back', 10009: 'back', 461: 'back'
};

export function keyName(e) {
  var k = e.key;
  if (k === 'ArrowLeft' || k === 'Left') return 'left';
  if (k === 'ArrowRight' || k === 'Right') return 'right';
  if (k === 'ArrowUp' || k === 'Up') return 'up';
  if (k === 'ArrowDown' || k === 'Down') return 'down';
  if (k === 'Enter' || k === 'NumpadEnter' || k === 'Select') return 'enter';
  if (k === 'Escape' || k === 'Esc' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack') return 'back';
  return KEYCODES[e.keyCode] || null;
}

function isVisible(el) {
  if (el.disabled) return false;
  if (el.offsetParent === null) return false;
  var r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusables(root) {
  if (!root) return [];
  var all = root.querySelectorAll('.focusable');
  var out = [];
  for (var i = 0; i < all.length; i++) if (isVisible(all[i])) out.push(all[i]);
  return out;
}

export function setScope(root, preferred) {
  scope = root;
  var target = preferred && isVisible(preferred) ? preferred : focusables(root)[0];
  if (target) target.focus();
}

export function getScope() { return scope; }

export function setInterceptor(fn) { interceptor = fn; }

export function onAnyKey(fn) { onAnyKeyCb = fn; }

export function move(dir) {
  var list = focusables(scope);
  if (!list.length) return;
  var cur = document.activeElement;
  if (list.indexOf(cur) < 0) {
    list[0].focus();
    return;
  }
  var hint = cur.getAttribute && cur.getAttribute('data-nav-' + dir);
  if (hint) {
    var target = document.getElementById(hint);
    if (target && list.indexOf(target) >= 0) {
      target.focus();
      sfx.select();
      return;
    }
  }
  var r = cur.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  var best = null, bestScore = Infinity;
  for (var i = 0; i < list.length; i++) {
    var el = list[i];
    if (el === cur) continue;
    var q = el.getBoundingClientRect();
    var x = q.left + q.width / 2, y = q.top + q.height / 2;
    var dx = x - cx, dy = y - cy, primary, secondary;
    if (dir === 'up') { if (dy >= -2) continue; primary = -dy; secondary = Math.abs(dx); }
    else if (dir === 'down') { if (dy <= 2) continue; primary = dy; secondary = Math.abs(dx); }
    else if (dir === 'left') { if (dx >= -2) continue; primary = -dx; secondary = Math.abs(dy); }
    else { if (dx <= 2) continue; primary = dx; secondary = Math.abs(dy); }
    var score = primary + secondary * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) {
    best.focus();
    sfx.select();
  }
}

function onKey(e) {
  var name = keyName(e);
  if (onAnyKeyCb) onAnyKeyCb(name, e);
  if (!name) return;
  if (interceptor && interceptor(name, e) === true) {
    e.preventDefault();
    return;
  }
  if (name === 'back') {
    e.preventDefault();
    if (onBackCb) onBackCb();
    return;
  }
  var el = document.activeElement;
  if (name === 'enter') {
    if (el && el.classList && el.classList.contains('focusable')) {
      e.preventDefault();
      el.click();
    }
    return;
  }
  if ((name === 'left' || name === 'right') && el && el.hasAttribute && el.hasAttribute('data-lr')) {
    e.preventDefault();
    el.dispatchEvent(new CustomEvent('td-adjust', { detail: name === 'left' ? -1 : 1 }));
    return;
  }
  e.preventDefault();
  move(name);
}

// 电视外壳（APK）的返回键走这里：先给页面拦截器处理，再走普通返回。
// 返回 false 表示已经在首页、没有可返回的了。
export function backKey() {
  if (interceptor && interceptor('back', null) === true) return true;
  return onBackCb ? onBackCb() !== false : false;
}

export function initNav(onBack) {
  onBackCb = onBack;
  document.addEventListener('keydown', onKey, true);
}
