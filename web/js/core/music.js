// 舞曲播放：用 Web Audio 现场合成鼓、贝斯、和弦和旋律，不需要音频文件。
// 舞步的节拍以音频时钟为准；静音或音频还没解锁时改用系统时钟，照样能跳（只是没声音）。
//
// 曲子的写法（见 dance/songs.js）：
//   bpm、bars（小节列表）。每个小节：
//     drums: 鼓型名（'four' 四拍、'pop' 流行、'half' 半拍、'count' 数拍子、'none'）
//     chords: 和弦，每个占两拍，如 ['C', 'G']；一个就占整小节
//     mel: 旋律，8 个八分音符，如 'E5 . G5 - A5 G5 E5 .'（. 休止，- 延长前一个音）
//     bass: 'root'（默认，跟和弦根音）或 'none'
import { audio } from './sfx.js';
import { now } from './util.js';

var NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

export function midi(name) {
  var m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
}

function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

var CHORD = {
  C: [0, 4, 7], Cm: [0, 3, 7], D: [2, 6, 9], Dm: [2, 5, 9], E: [4, 8, 11], Em: [4, 7, 11],
  F: [5, 9, 12], G: [7, 11, 14], G7: [7, 11, 14, 17], A: [9, 13, 16], Am: [9, 12, 16], Bb: [10, 14, 17]
};

var DRUMS = {
  four: { kick: 'x...x...x...x...', snare: '................', hat: '..x...x...x...x.' },
  pop: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  drive: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx' },
  half: { kick: 'x.......x.......', snare: '........x.......', hat: 'x...x...x...x...' },
  count: { kick: '................', snare: '................', hat: '................', clap: 'x...x...x...x...' },
  gong: { kick: 'x.......x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '............x...' },
  none: { kick: '', snare: '', hat: '' }
};

// 把小节展开成按 16 分音符排的事件表
export function compile(song) {
  var ev = [];
  for (var b = 0; b < song.bars.length; b++) {
    var bar = song.bars[b];
    var base = b * 16;
    var d = DRUMS[bar.drums || 'pop'] || DRUMS.pop;
    ['kick', 'snare', 'hat', 'clap'].forEach(function (k) {
      var pat = d[k] || '';
      for (var i = 0; i < pat.length; i++) if (pat[i] === 'x') ev.push({ step: base + i, k: k });
    });
    var chords = bar.chords || [];
    for (var c = 0; c < chords.length; c++) {
      var span = 16 / chords.length;
      var notes = CHORD[chords[c]];
      if (!notes) continue;
      // 和弦：每拍后半拍轻轻弹一下（反拍），贝斯走根音八分音符
      for (var s = 0; s < span; s += 4) ev.push({ step: base + c * span + s + 2, k: 'chord', notes: notes, len: 2 });
      if (bar.bass !== 'none') {
        for (var q = 0; q < span; q += 2) ev.push({ step: base + c * span + q, k: 'bass', note: 36 + notes[0] % 12, len: 2 });
      }
    }
    if (bar.mel) {
      var toks = bar.mel.trim().split(/\s+/);
      for (var j = 0; j < toks.length; j++) {
        var tk = toks[j];
        if (tk === '.' || tk === '-') continue;
        var m = midi(tk);
        if (m === null) continue;
        var len = 1;
        while (j + len < toks.length && toks[j + len] === '-') len++;
        ev.push({ step: base + j * 2, k: 'lead', note: m, len: len * 2 });
      }
    }
  }
  ev.sort(function (a, b2) { return a.step - b2.step; });
  return ev;
}

export function Player(song) {
  this.song = song;
  this.bpm = song.bpm;
  this.stepSec = 60 / song.bpm / 4;
  this.events = compile(song);
  this.lengthSec = song.bars.length * 16 * this.stepSec;
  this.ctx = null;
  this.out = null;
  this.t0 = 0;
  this.idx = 0;
  this.timer = null;
  this.pausedAt = null;
  this.lat = 0;
}

Player.prototype._clock = function () { return this.ctx ? this.ctx.currentTime : now() / 1000; };

// delaySec 秒后开始（给孩子看一眼第一个动作）
Player.prototype.start = function (delaySec) {
  this.stop();
  var a = audio();
  this.ctx = a ? a.ctx : null;
  if (this.ctx) {
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.7;
    var comp = this.ctx.createDynamicsCompressor ? this.ctx.createDynamicsCompressor() : null;
    if (comp) {
      this.out.connect(comp);
      comp.connect(a.out);
      this.comp = comp;
    } else {
      this.out.connect(a.out);
    }
    this.lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }
  this.t0 = this._clock() + (delaySec || 0);
  this.idx = 0;
  this.pausedAt = null;
  var self = this;
  this.timer = setInterval(function () { self._tick(); }, 25);
  this._tick();
};

// 歌曲时间（秒，开始前是负数）：按耳朵听到的时刻算
Player.prototype.time = function () {
  var t = this.pausedAt !== null ? this.pausedAt : this._clock();
  return t - this.t0 - this.lat;
};

Player.prototype.beat = function () { return this.time() * this.bpm / 60; };

// 某个系统时刻（performance.now 毫秒，比如摄像头拍下这一帧的时刻）对应的歌曲时间
Player.prototype.timeAt = function (tMs) { return this.time() - (now() - tMs) / 1000; };

Player.prototype.done = function () { return this.time() >= this.lengthSec; };

Player.prototype._tick = function () {
  if (this.pausedAt !== null) return;
  var horizon = this._clock() + 0.15;
  while (this.idx < this.events.length) {
    var e = this.events[this.idx];
    var at = this.t0 + e.step * this.stepSec;
    if (at > horizon) break;
    this.idx += 1;
    if (this.ctx && at >= this._clock() - 0.02) this._play(e, Math.max(at, this._clock()));
  }
  if (this.idx >= this.events.length && this._clock() > this.t0 + this.lengthSec + 1) {
    clearInterval(this.timer);
    this.timer = null;
  }
};

Player.prototype.pause = function () {
  if (this.pausedAt !== null) return;
  this.pausedAt = this._clock();
  if (this.out) this.out.gain.setTargetAtTime(0.0001, this._clock(), 0.03);
};

Player.prototype.resume = function () {
  if (this.pausedAt === null) return;
  var gap = this._clock() - this.pausedAt;
  this.t0 += gap;
  this.pausedAt = null;
  // 暂停前排进去的音已经静音了，从当前位置往后重新排
  var cur = (this._clock() - this.t0) / this.stepSec;
  this.idx = 0;
  while (this.idx < this.events.length && this.events[this.idx].step < cur) this.idx++;
  if (this.out) this.out.gain.setTargetAtTime(0.7, this._clock(), 0.03);
};

Player.prototype.stop = function () {
  if (this.timer) clearInterval(this.timer);
  this.timer = null;
  if (this.out) {
    try {
      this.out.gain.setTargetAtTime(0.0001, this._clock(), 0.05);
      var o = this.out, cp = this.comp;
      setTimeout(function () { try { o.disconnect(); if (cp) cp.disconnect(); } catch (e) { /* ignore */ } }, 400);
    } catch (e) { /* ignore */ }
  }
  this.out = null;
  this.comp = null;
};

// ---------- 乐器 ----------
Player.prototype._env = function (t, peak, attack, decay) {
  var g = this.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(this.out);
  return g;
};

Player.prototype._noise = function () {
  if (this._nb) return this._nb;
  var len = this.ctx.sampleRate;
  var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  this._nb = buf;
  return buf;
};

Player.prototype._play = function (e, t) {
  var c = this.ctx, o, g, f, src;
  var step = this.stepSec;
  if (e.k === 'kick') {
    o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g = this._env(t, 0.9, 0.004, 0.26);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.32);
  } else if (e.k === 'snare' || e.k === 'clap' || e.k === 'hat') {
    src = c.createBufferSource();
    src.buffer = this._noise();
    f = c.createBiquadFilter();
    if (e.k === 'hat') { f.type = 'highpass'; f.frequency.value = 7000; }
    else { f.type = 'bandpass'; f.frequency.value = e.k === 'clap' ? 1300 : 1900; f.Q.value = 0.8; }
    g = this._env(t, e.k === 'hat' ? 0.16 : (e.k === 'clap' ? 0.45 : 0.4), 0.002, e.k === 'hat' ? 0.045 : 0.16);
    src.connect(f);
    f.connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.25);
    if (e.k === 'snare') {
      o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      var g2 = this._env(t, 0.25, 0.002, 0.09);
      o.connect(g2);
      o.start(t);
      o.stop(t + 0.15);
    }
  } else if (e.k === 'bass') {
    o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(hz(e.note), t);
    f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    g = this._env(t, 0.32, 0.006, step * e.len * 0.9);
    o.connect(f);
    f.connect(g);
    o.start(t);
    o.stop(t + step * e.len + 0.05);
  } else if (e.k === 'chord') {
    f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    g = this._env(t, 0.13, 0.008, step * e.len * 1.4);
    f.connect(g);
    for (var i = 0; i < e.notes.length; i++) {
      o = c.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(hz(60 + e.notes[i]), t);
      o.detune.setValueAtTime((i - 1) * 6, t);
      o.connect(f);
      o.start(t);
      o.stop(t + step * e.len * 1.5 + 0.05);
    }
  } else if (e.k === 'lead') {
    o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(hz(e.note), t);
    var o2 = c.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(hz(e.note), t);
    var mix = c.createGain();
    mix.gain.value = 0.25;
    o2.connect(mix);
    var dur = step * e.len;
    g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.setTargetAtTime(0.18, t + 0.02, 0.08);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.92, 0.03);
    g.connect(this.out);
    o.connect(g);
    mix.connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.2);
    o2.stop(t + dur + 0.2);
  }
};
