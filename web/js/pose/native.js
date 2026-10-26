// 电视版 APK 的原生识别：摄像头和 MoveNet 都在安卓里跑（多核 CPU），网页只收关键点。
// 摄像头画面由安卓显示在网页下层，网页把画面区域做成透明（html/body 加 native-cam 类）。

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
