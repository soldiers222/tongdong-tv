// 首页：两条运动跑道 + 工具道 + 今日数据
import * as store from '../core/store.js';
import { fmtSec, minutesText } from '../core/util.js';
import { setScope } from '../core/nav.js';

function $(id) { return document.getElementById(id); }

var lastFocus = null;

export var homeScreen = {
  manageFocus: true,
  enter: function () {
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
