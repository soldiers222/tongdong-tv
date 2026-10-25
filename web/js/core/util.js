// 通用小工具。只用 ES2017 语法，兼容较老的电视 WebView。

export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

export function mean(arr) {
  if (!arr.length) return 0;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

export function std(arr) {
  if (arr.length < 2) return 0;
  var m = mean(arr), s = 0;
  for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
  return Math.sqrt(s / (arr.length - 1));
}

// p 取 0–1；线性插值分位数
export function percentile(arr, p) {
  if (!arr.length) return 0;
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var idx = (a.length - 1) * p;
  var lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

// 可复现的伪随机数（mulberry32），测试时用固定种子
export function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pad2(n) { return (n < 10 ? '0' : '') + n; }

export function dayKey(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function fmtSec(ms, digits) {
  var d = digits == null ? 1 : digits;
  return (Math.max(0, ms) / 1000).toFixed(d);
}

// 运动分钟数的显示：动过但不足 1 分钟时显示「不到 1」，不让孩子看到 0
export function minutesText(sec) {
  if (!sec || sec <= 0) return '0';
  if (sec < 60) return '不到 1';
  return String(Math.round(sec / 60));
}

export function raf() {
  return new Promise(function (resolve) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function (t) { resolve(t); });
    else setTimeout(function () { resolve(now()); }, 16);
  });
}

export function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

export function qs(name) {
  if (typeof location === 'undefined') return null;
  var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}

// 只保留数组末尾 n 项（原地）
export function keepLast(arr, n) {
  if (arr.length > n) arr.splice(0, arr.length - n);
  return arr;
}
