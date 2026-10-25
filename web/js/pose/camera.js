// 摄像头：打开一次后整个会话复用，避免升降摄像头反复升降。
var stream = null;
var info = null;
var pending = null; // 正在打开中的请求，重复调用时共用
var gen = 0;        // closeCamera 时加 1：关掉之后才拿到的画面流直接停掉，不会让摄像头一直开着

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function waitForSize(video, ms) {
  return new Promise(function (resolve) {
    var start = Date.now();
    (function check() {
      if (video.videoWidth > 0 && video.videoHeight > 0) return resolve(true);
      if (Date.now() - start > ms) return resolve(false);
      setTimeout(check, 50);
    })();
  });
}

export function openCamera(video, deviceId) {
  if (stream && stream.active && video.srcObject === stream) return Promise.resolve(info);
  if (pending) return pending;
  var my = gen;
  if (!cameraSupported()) {
    var err = new Error('unsupported');
    err.code = window.isSecureContext === false ? 'insecure' : 'unsupported';
    return Promise.reject(err);
  }
  var v = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
  if (deviceId) v.deviceId = { exact: deviceId };
  else v.facingMode = 'user';
  pending = navigator.mediaDevices.getUserMedia({ audio: false, video: v }).catch(function (e) {
    if (e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError' || e.name === 'NotFoundError')) {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    throw e;
  }).then(function (s) {
    if (my !== gen) {
      stopTracks(s);
      var ab = new Error('closed');
      ab.code = 'closed';
      throw ab;
    }
    stream = s;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.srcObject = s;
    var p = video.play();
    return (p && p.catch ? p.catch(function () {}) : Promise.resolve()).then(function () {
      return waitForSize(video, 5000);
    });
  }).then(function () {
    var track = stream.getVideoTracks()[0];
    var st = track && track.getSettings ? track.getSettings() : {};
    info = {
      label: (track && track.label) || '摄像头',
      width: video.videoWidth,
      height: video.videoHeight,
      fps: st.frameRate ? Math.round(st.frameRate) : null,
      deviceId: st.deviceId || null
    };
    pending = null;
    return info;
  }, function (e) {
    pending = null;
    throw e;
  });
  return pending;
}

function stopTracks(s) {
  var tracks = s ? s.getTracks() : [];
  for (var i = 0; i < tracks.length; i++) tracks[i].stop();
}

export function closeCamera(video) {
  gen++;
  pending = null;
  stopTracks(stream);
  stream = null;
  info = null;
  if (video) video.srcObject = null;
}

export function cameraOpen() { return !!(stream && stream.active); }
export function cameraInfo() { return info; }

export function cameraErrorText(e) {
  var n = e && (e.code || e.name);
  if (n === 'insecure') return '摄像头需要用 https 网址打开。请用网页版的 https 地址，或用电视版 APK。';
  if (n === 'unsupported') return '这个浏览器不能使用摄像头。请改用电视版 APK，或在手机上打开后投屏到电视。';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') {
    return '没有拿到摄像头权限。请在弹窗里选「允许」；没有弹窗的话，到系统设置里给这个应用打开相机权限。';
  }
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return '没有找到摄像头。请确认电视摄像头能正常升起，或换一台带摄像头的设备。';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') {
    return '摄像头被别的应用占用了。请关掉视频通话、AI 健身等正在用摄像头的应用后再试。';
  }
  return '摄像头打开失败（' + (n || (e && e.message) || '未知原因') + '）。';
}
