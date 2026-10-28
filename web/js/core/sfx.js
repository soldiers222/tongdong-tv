// 音效：全部用 Web Audio 现场合成，不需要音频文件。
var AC = null;
var master = null;
var noiseBuf = null;
var enabled = true;

export function setSoundEnabled(v) { enabled = !!v; }

export function unlockAudio() {
  try {
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      AC = new C();
      master = AC.createGain();
      master.gain.value = 0.55;
      master.connect(AC.destination);
    }
    if (AC.state === 'suspended') AC.resume();
  } catch (e) { AC = null; }
}

function ready() { return AC && enabled && AC.state === 'running'; }

// 给舞曲用：音频环境和总音量节点（静音或还没解锁时为 null）
export function audio() { return ready() ? { ctx: AC, out: master } : null; }

function tone(freq, dur, type, peak, freqEnd, delay) {
  if (!ready()) return;
  var t0 = AC.currentTime + (delay || 0);
  var o = AC.createOscillator();
  var g = AC.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak || 0.3, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function getNoise() {
  if (noiseBuf) return noiseBuf;
  var len = AC.sampleRate;
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
  var d = noiseBuf.getChannelData(0);
  for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function noise(dur, peak, fFrom, fTo, delay, filterType) {
  if (!ready()) return;
  var t0 = AC.currentTime + (delay || 0);
  var src = AC.createBufferSource();
  src.buffer = getNoise();
  var f = AC.createBiquadFilter();
  f.type = filterType || 'bandpass';
  f.frequency.setValueAtTime(fFrom, t0);
  f.frequency.exponentialRampToValueAtTime(fTo, t0 + dur);
  f.Q.value = 0.9;
  var g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export var sfx = {
  slice: function () { noise(0.16, 0.4, 5200, 1100, 0, 'bandpass'); },
  splat: function () {
    noise(0.14, 0.28, 1000, 260, 0.02, 'lowpass');
    tone(190, 0.12, 'sine', 0.16, 95, 0.02);
  },
  bomb: function () {
    noise(0.55, 0.7, 700, 50, 0, 'lowpass');
    tone(95, 0.5, 'sawtooth', 0.22, 38);
  },
  combo: function (n) {
    var k = Math.min(n || 3, 5);
    for (var i = 0; i < k; i++) tone(660 * Math.pow(1.122, i * 2), 0.12, 'triangle', 0.22, null, i * 0.07);
  },
  star: function () {
    tone(880, 0.1, 'triangle', 0.25);
    tone(1320, 0.2, 'triangle', 0.22, null, 0.08);
  },
  tick: function () { tone(880, 0.09, 'square', 0.12); },
  go: function () { tone(1320, 0.3, 'square', 0.16); },
  select: function () { tone(520, 0.05, 'triangle', 0.1); },
  success: function () {
    var notes = [523, 659, 784, 1047];
    for (var i = 0; i < notes.length; i++) tone(notes[i], 0.18, 'triangle', 0.22, null, i * 0.1);
  },
  fail: function () {
    tone(330, 0.2, 'sawtooth', 0.14, 220);
    tone(220, 0.3, 'sawtooth', 0.12, 150, 0.18);
  },
  wrong: function () { tone(300, 0.12, 'square', 0.1, 260); }
};
