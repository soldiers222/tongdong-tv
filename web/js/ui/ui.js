// 公共界面：加载遮罩、轻提示、休息提醒
import { setScope, getScope, setInterceptor } from '../core/nav.js';
import { speak } from '../core/voice.js';
import { sfx } from '../core/sfx.js';

function $(id) { return document.getElementById(id); }

var loadingOpen = false;
var loadingBack = null;
var prevScope = null;
var prevFocus = null;
var toastTimer = null;

function makeButtons(row, buttons) {
  row.innerHTML = '';
  var first = null, primary = null;
  for (var i = 0; i < (buttons || []).length; i++) {
    var b = buttons[i];
    var el = document.createElement('button');
    el.className = 'btn focusable' + (b.primary ? ' primary' : '');
    el.textContent = b.label;
    el.addEventListener('click', b.fn);
    row.appendChild(el);
    if (b.primary && !primary) primary = el;
    if (!first) first = el;
  }
  return primary || first;
}

export var ui = {
  loading: function (title, sub, buttons, onBack) {
    $('loading-t').textContent = title;
    $('loading-s').textContent = sub || '';
    var first = makeButtons($('loading-btns'), buttons);
    if (!loadingOpen) {
      prevScope = getScope();
      prevFocus = document.activeElement;
    }
    $('loading').classList.add('show');
    loadingOpen = true;
    loadingBack = onBack || null;
    setScope($('loading'), first);
  },

  loadingSub: function (text) { $('loading-s').textContent = text; },

  hideLoading: function () {
    if (!loadingOpen) return;
    $('loading').classList.remove('show');
    loadingOpen = false;
    loadingBack = null;
    if (prevScope) setScope(prevScope, prevFocus);
  },

  isLoading: function () { return loadingOpen; },

  // 返回键优先交给遮罩处理
  backOverlay: function () {
    if (loadingOpen && loadingBack) {
      loadingBack();
      return true;
    }
    return false;
  },

  toast: function (text, ms) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }
};

// 休息提醒：倒计时结束前不能继续，返回键直接回首页
export function showRest(limitMin, restSec, onChoice) {
  var box = $('rest');
  var left = restSec || 60;
  $('rest-p').textContent = '已经运动 ' + limitMin + ' 分钟了。看看窗外远处，喝口水，一会儿再玩。';
  $('rest-count').textContent = String(left);
  $('rest-count').style.display = '';
  $('rest-btns').innerHTML = '';
  box.classList.add('show');
  speak('运动' + limitMin + '分钟了，休息一下吧');
  var done = false;
  function finish(choice) {
    if (done) return;
    done = true;
    clearInterval(timer);
    box.classList.remove('show');
    setInterceptor(null);
    onChoice(choice);
  }
  setInterceptor(function (name) {
    if (name === 'back') { finish('home'); return true; }
    return left > 0; // 倒计时期间吞掉其他按键
  });
  var timer = setInterval(function () {
    left -= 1;
    $('rest-count').textContent = String(Math.max(0, left));
    if (left <= 0) {
      clearInterval(timer);
      sfx.success();
      $('rest-count').style.display = 'none';
      var first = makeButtons($('rest-btns'), [
        { label: '继续玩', primary: true, fn: function () { finish('continue'); } },
        { label: '回首页', fn: function () { finish('home'); } }
      ]);
      setScope(box, first);
    }
  }, 1000);
  return { cancel: function () { finish('home'); } };
}
