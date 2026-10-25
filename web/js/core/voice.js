// 语音提示：用系统自带的中文语音朗读。电视没有中文语音时自动静音，界面上始终有同样的文字。
var enabled = true;
var chosen = null;

export function setVoiceEnabled(v) {
  enabled = !!v;
  if (!enabled) cancel();
}

function pickVoice() {
  if (chosen) return chosen;
  var s = window.speechSynthesis;
  if (!s || !s.getVoices) return null;
  var list = s.getVoices() || [];
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    if (/zh[-_]?CN|cmn/i.test(v.lang) || /Chinese|中文|普通话/.test(v.name)) {
      chosen = v;
      break;
    }
  }
  return chosen;
}

export function speak(text) {
  if (!enabled) return;
  var s = window.speechSynthesis;
  if (!s || typeof window.SpeechSynthesisUtterance === 'undefined') return;
  try {
    s.cancel();
    var u = new window.SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.0;
    u.pitch = 1.1;
    var v = pickVoice();
    if (v) u.voice = v;
    s.speak(u);
  } catch (e) { /* 没有语音引擎时忽略 */ }
}

export function cancel() {
  try {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch (e) { /* ignore */ }
}
