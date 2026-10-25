// 家长设置：选中一行后左右键切换，确定键也能往后切换
import * as store from '../core/store.js';
import { ENGINES, unsupportedReason, engineInfo } from '../pose/engines.js';
import { setSoundEnabled, sfx } from '../core/sfx.js';
import { setVoiceEnabled } from '../core/voice.js';
import { ui } from './ui.js';
import { VERSION } from '../version.js';
import { setScope } from '../core/nav.js';

function $(id) { return document.getElementById(id); }

var ONOFF = [{ v: true, t: '开' }, { v: false, t: '关' }];

function engineOptions() {
  var opts = [{ v: 'auto', t: '自动（按设备测试结果）' }];
  for (var i = 0; i < ENGINES.length; i++) {
    var e = ENGINES[i];
    var why = unsupportedReason(e.id);
    opts.push({ v: e.id, t: e.label + (why ? '（不可用）' : '') });
  }
  return opts;
}

function rows() {
  return [
    { key: 'age', label: '年龄段', opts: [{ v: '6-8', t: '6–8 岁' }, { v: '9-12', t: '9–12 岁' }] },
    { key: 'limitMin', label: '运动多久提醒休息', opts: [{ v: 10, t: '10 分钟' }, { v: 15, t: '15 分钟' }, { v: 20, t: '20 分钟' }, { v: 30, t: '30 分钟' }, { v: 0, t: '不提醒' }] },
    { key: 'engine', label: '识别引擎', opts: engineOptions() },
    { key: 'mirror', label: '镜像画面（像照镜子）', opts: ONOFF },
    { key: 'skeleton', label: '显示骨架线', opts: ONOFF },
    { key: 'sound', label: '音效', opts: ONOFF },
    { key: 'voice', label: '语音提示', opts: ONOFF },
    { key: 'hd', label: '高清画面（较慢的电视请关）', opts: ONOFF },
    { key: 'perf', label: '显示识别帧率', opts: ONOFF },
    { key: '_clear', label: '清空运动记录', action: true }
  ];
}

function indexOf(opts, v) {
  for (var i = 0; i < opts.length; i++) if (opts[i].v === v) return i;
  return 0;
}

function apply(key, v) {
  store.setSetting(key, v);
  if (key === 'sound') setSoundEnabled(v);
  if (key === 'voice') setVoiceEnabled(v);
}

var clearArmed = false;

export var settingsScreen = {
  manageFocus: true,
  enter: function () {
    clearArmed = false;
    var list = $('set-list');
    list.innerHTML = '';
    var s = store.settings();
    var data = rows();
    data.forEach(function (row) {
      var el = document.createElement('button');
      el.className = 'set-row focusable' + (row.action ? ' action' : '');
      if (!row.action) el.setAttribute('data-lr', '');
      var lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = row.label;
      var val = document.createElement('span');
      val.className = 'val';
      el.appendChild(lbl);
      el.appendChild(val);
      if (row.action) {
        val.textContent = '按确定';
        el.addEventListener('click', function () {
          if (!clearArmed) {
            clearArmed = true;
            val.textContent = '再按一次确定清空';
            return;
          }
          store.clearRecords();
          clearArmed = false;
          val.textContent = '已清空';
          sfx.fail();
          ui.toast('运动记录已清空');
        });
      } else {
        var idx = indexOf(row.opts, s[row.key]);
        var render = function () { val.textContent = row.opts[idx].t; };
        render();
        var change = function (d) {
          idx = (idx + d + row.opts.length) % row.opts.length;
          render();
          apply(row.key, row.opts[idx].v);
          sfx.select();
          if (row.key === 'engine' && row.opts[idx].v !== 'auto') {
            var why = unsupportedReason(row.opts[idx].v);
            ui.toast(why ? '这台设备' + why + '，会自动换用其他引擎' : '已选择 ' + engineInfo(row.opts[idx].v).label);
          }
        };
        el.addEventListener('td-adjust', function (e) { change(e.detail); });
        el.addEventListener('click', function () { change(1); });
      }
      list.appendChild(el);
    });
    $('set-note').textContent = '选中一项后按左右键修改。所有记录只保存在这台设备上，不会上传。版本 ' + VERSION;
    setScope($('screen-settings'), list.querySelector('.set-row'));
  }
};
