// 首页：两条运动跑道 + 工具道 + 今日数据。跑道上按左右键切换单人 / 双人（两个游戏共用一个设置）
import * as store from '../core/store.js';
import { fmtSec, minutesText } from '../core/util.js';
import { setScope } from '../core/nav.js';
import { sfx } from '../core/sfx.js';
import { ui } from './ui.js';

function $(id) { return document.getElementById(id); }

var lastFocus = null;
var bound = false;

function players() { return store.settings().players === 2 ? 2 : 1; }

function renderPlayers() {
  var n = players();
  var opts = document.querySelectorAll('#screen-home .lane-mode .opt');
  for (var i = 0; i < opts.length; i++) {
    opts[i].classList.toggle('on', Number(opts[i].getAttribute('data-p')) === n);
  }
}

function setPlayers(n) {
  if (n === players()) return;
  store.setSetting('players', n);
  renderPlayers();
  sfx.select();
  ui.toast(n === 2 ? '双人：两个人一左一右站在电视前，各玩各的半边' : '单人', 2200);
}

function bind() {
  if (bound) return;
  bound = true;
  var lanes = document.querySelectorAll('#screen-home .lane');
  for (var i = 0; i < lanes.length; i++) {
    // 遥控器左右键
    lanes[i].addEventListener('td-adjust', function () { setPlayers(players() === 2 ? 1 : 2); });
  }
  // 鼠标、触屏直接点「单人」「双人」
  var opts = document.querySelectorAll('#screen-home .lane-mode .opt');
  for (var j = 0; j < opts.length; j++) {
    opts[j].addEventListener('click', function (e) {
      e.stopPropagation();
      setPlayers(Number(this.getAttribute('data-p')));
    });
  }
}

export var homeScreen = {
  manageFocus: true,
  enter: function () {
    bind();
    renderPlayers();
    var s = store.get();
    var age = s.settings.age;
    $('rec-fruit').innerHTML = '<b>' + (s.best.fruit[age] || 0) + ' 分</b>最好成绩（' + (age === '9-12' ? '9–12 岁' : '6–8 岁') + '）';
    var l = s.best.balance.left || 0, r = s.best.balance.right || 0;
    $('rec-balance').innerHTML = (l || r)
      ? '<b>' + fmtSec(Math.max(l, r)) + ' 秒</b>站得最久'
      : '<b>还没站过</b>试试看';
    $('stat-today').textContent = minutesText(store.todaySeconds());
    $('stat-week').textContent = String(store.activeDaysThisWeek());
    $('badge-day0').style.display = s.day0 ? 'none' : '';
    var target = lastFocus && document.body.contains(lastFocus) ? lastFocus : $('lane-fruit');
    setScope($('screen-home'), target);
  },
  exit: function () {
    if (document.activeElement && document.activeElement.classList.contains('focusable')) lastFocus = document.activeElement;
  }
};
