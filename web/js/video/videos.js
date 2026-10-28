// 跟着视频跳 · 视频库（纯数据和小工具，可在 Node 里测试）
//
// 视频都在B站，用B站官方的外链播放器打开（player.bilibili.com），童动乐园不下载、不保存、不转发视频。
// 下面这些是按标题从网上搜出来的公开视频：广播体操和武术操的镜面示范、儿童律动舞、居家健身操。
// 视频可能被作者删掉或改成不公开；电视版会联网查一下标题和时长，查不到的会标出来，家长也可以在视频详情里隐藏它。
// 家长可以自己添加：输入 BV 号（视频网址里 BV 开头的 12 位），或者 b23.tv 的分享短链接。

export var CATS = [
  { id: 'school', name: '学校里的操', desc: '广播体操、武术操的镜面示范，和学校里做的一样' },
  { id: 'dance', name: '儿童律动舞', desc: '跟着老师跳儿童舞蹈、手势舞，大多是对着镜子跳的' },
  { id: 'fit', name: '健身操', desc: '居家健身操，出汗、长个子，全家可以一起跳' },
  { id: 'mine', name: '我添加的', desc: '家长输入 BV 号添加的视频' },
  { id: 'local', name: '电视里的视频', desc: '存在电视里、U 盘里的舞蹈视频' }
];

// by：上传的人（搜到的标题里写着的）；tags：镜面 = 老师对着镜子示范，照着做就行；分解 = 一个动作一个动作教
export var VIDEOS = [
  // ---------- 学校里的操 ----------
  { bv: 'BV1iPH8zmEyB', cat: 'school', title: '七彩阳光', note: '第三套全国小学生广播体操，镜面示范', tags: ['镜面'] },
  { bv: 'BV1eY4y1h7wU', cat: 'school', title: '七彩阳光（宽屏）', note: '第三套全国小学生广播体操，镜面示范', tags: ['镜面'] },
  { bv: 'BV1T44y1K7fb', cat: 'school', title: '七彩阳光（原版）', note: '第三套全国小学生广播体操，原版示范' },
  { bv: 'BV1F44y1P7Ug', cat: 'school', title: '七彩阳光（分节）', note: '完整示范加每一节单独示范', tags: ['分解'] },
  { bv: 'BV1cAt6eGEJP', cat: 'school', title: '希望风帆', note: '第三套全国小学生广播体操，全套镜面示范', tags: ['镜面'] },
  { bv: 'BV1G441127qx', cat: 'school', title: '希望风帆（镜面）', note: '第三套全国小学生广播体操', tags: ['镜面'] },
  { bv: 'BV15v411u7gg', cat: 'school', title: '希望风帆（一年级）', note: '一年级学的版本，镜面示范', tags: ['镜面'] },
  { bv: 'BV1DB4y117Vv', cat: 'school', title: '希望风帆（完整）', note: '完整版，动作流畅' },
  { bv: 'BV1RE411576o', cat: 'school', title: '世界真美好', note: '第二套全国儿童广播体操，镜面版，小一点的孩子', tags: ['镜面'] },
  { bv: 'BV1zd4y1r7ua', cat: 'school', title: '旭日东升', note: '全国中小学生武术健身操，镜面示范', tags: ['镜面', '武术'] },
  { bv: 'BV1vL4y1P7tU', cat: 'school', title: '精忠报国（第一节）', note: '武术操第一节，分解动作，镜面示范', tags: ['分解', '武术'] },
  { bv: 'BV19G4y1i7So', cat: 'school', title: '少年中国说', note: '幼儿武术操', tags: ['武术'] },
  { bv: 'BV1mL411Y7eR', cat: 'school', title: '功夫', note: '儿童武术韵律操', tags: ['武术'] },

  // ---------- 儿童律动舞 ----------
  { bv: 'BV11J411i7ac', cat: 'dance', title: '海草舞', by: '波波星球', note: '对镜完整版', tags: ['镜面'] },
  { bv: 'BV1zJ411i7Wn', cat: 'dance', title: '隔壁泰山', by: '波波星球', note: '对镜完整版', tags: ['镜面'] },
  { bv: 'BV1Pa41187wb', cat: 'dance', title: '小小兵香蕉舞', by: '波波星球' },
  { bv: 'BV1eCeBzTE87', cat: 'dance', title: '小马哒哒哒', by: '波波星球' },
  { bv: 'BV1WJ411R7H5', cat: 'dance', title: '加油歌', by: '波波星球' },
  { bv: 'BV13v411H7Ho', cat: 'dance', title: '热爱105°C的你', by: '波波星球', note: '舞蹈教程', tags: ['分解'] },
  { bv: 'BV1hJ411e7hH', cat: 'dance', title: '小毛驴（教程）', by: '波波星球', note: '舞蹈教程', tags: ['分解'] },
  { bv: 'BV1uy4y1178S', cat: 'dance', title: '小毛驴', note: '幼儿园儿童律动舞蹈' },
  { bv: 'BV1da4y1e7Uw', cat: 'dance', title: '无敌小可爱', note: '儿童律动' },
  { bv: 'BV1Su4y1V7rS', cat: 'dance', title: '科目三（幼儿版）', note: '儿童律动' },
  { bv: 'BV1754y1i7Eo', cat: 'dance', title: '棒棒糖', note: '儿童律动' },
  { bv: 'BV1et411N7G5', cat: 'dance', title: '爸爸去哪儿', by: '甜果亲子', note: '亲子舞蹈' },
  { bv: 'BV1tt411M7Ri', cat: 'dance', title: '奇迹再现', by: '甜果亲子', note: '幼儿舞蹈' },
  { bv: 'BV1T5411M7oi', cat: 'dance', title: '奇迹再现（动感版）', note: '奥特曼主题曲儿童舞蹈' },
  { bv: 'BV1X24y1A7xQ', cat: 'dance', title: '孤勇者', note: '儿童舞蹈完整版' },
  { bv: 'BV1AF41147DA', cat: 'dance', title: '孤勇者（手势舞）', note: '只动手，站着就能跳', tags: ['手势舞'] },
  { bv: 'BV1LQ4y1e74n', cat: 'dance', title: '青春修炼手册', note: '幼儿舞蹈' },
  { bv: 'BV1QC4y1H742', cat: 'dance', title: '青春修炼手册（少儿）', note: '少儿舞蹈' },
  { bv: 'BV1A741187Ha', cat: 'dance', title: '小苹果', note: '儿童舞蹈' },
  { bv: 'BV1vZF2eSEa4', cat: 'dance', title: '游啊游', note: '儿童舞蹈完整版' },
  { bv: 'BV18E411A74s', cat: 'dance', title: '听我说谢谢你', note: '小学生手势舞完整版', tags: ['手势舞'] },
  { bv: 'BV1pLw9eJETy', cat: 'dance', title: '兔子舞', note: '校园课间操' },

  // ---------- 健身操 ----------
  { bv: 'BV1Ba4y1i7FW', cat: 'fit', title: '10 分钟居家健身操', by: '小小运动家', note: '儿童趣味健身，顺便学英语' },
  { bv: 'BV1pK411p7m2', cat: 'fit', title: '20 分钟全身燃脂操', by: '小小运动家', note: '儿童全身燃脂' },
  { bv: 'BV1ce411W7rq', cat: 'fit', title: '15 分钟燃脂挑战', by: '小小运动家', note: '小胖墩燃脂挑战' },
  { bv: 'BV1n84y1q7iL', cat: 'fit', title: '10 分钟全家欢有氧', note: '全家一起跳的有氧操', tags: ['全家'] },
  { bv: 'BV1ta4y147d7', cat: 'fit', title: '亲子健身 25 分钟', note: '专门给孩子和爸爸妈妈设计', tags: ['全家'] },
  { bv: 'BV1JE41157Yf', cat: 'fit', title: '15 分钟和孩子一起练', note: '青少年友好，有不用跳的选择', tags: ['全家'] },
  { bv: 'BV18v4y1N7tB', cat: 'fit', title: '长高操', note: '超级飞侠儿童长高操' },
  { bv: 'BV1ui4y1m7kp', cat: 'fit', title: '本草纲目毽子操（儿童）', note: '儿童长高版毽子操' },
  { bv: 'BV1WS4y1c7ji', cat: 'fit', title: '本草纲目毽子操', by: '刘畊宏', note: '15 分钟完整版，强度大', tags: ['全家'] },
  { bv: 'BV1PU8vzaEKL', cat: 'fit', title: '10 分钟亲子瑜伽', note: '舒展身体，慢慢做', tags: ['全家'] }
];

export var BV_RE = /BV[0-9A-Za-z]{10}/;

export function catName(id) {
  for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i].name;
  return '';
}

export function findVideo(bv) {
  for (var i = 0; i < VIDEOS.length; i++) if (VIDEOS[i].bv === bv) return VIDEOS[i];
  return null;
}

// 家长输入的东西 → {bv, p} / {b23: 短码} / null
// 认得：BV 号、视频网址（可以带 ?p=2）、b23.tv 短链接、只输入了 BV 后面的 10 位
export function parseInput(text) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return null;
  var m = BV_RE.exec(s);
  if (m) {
    var p = /[?&]p=(\d+)/.exec(s);
    return { bv: m[0], p: p ? Math.max(1, Number(p[1])) : 1 };
  }
  var b = /b23\.tv\/([0-9A-Za-z]{4,16})/.exec(s);
  if (b) return { b23: b[1] };
  if (/^[0-9A-Za-z]{10}$/.test(s)) return { bv: 'BV' + s, p: 1 };
  return null;
}

// B站外链播放器的地址（官方参数：bvid、p 第几集、autoplay 自动播放、t 从第几秒开始、danmaku 弹幕、muted 静音）
export function embedUrl(v, o) {
  o = o || {};
  var q = ['isOutside=true', 'bvid=' + v.bv, 'p=' + (v.p || 1), 'autoplay=' + (o.autoplay === false ? 0 : 1), 'danmaku=0', 'high_quality=1'];
  if (o.t > 0) q.push('t=' + Math.floor(o.t));
  if (o.muted) q.push('muted=1');
  return 'https://player.bilibili.com/player.html?' + q.join('&');
}

// 在B站上的网址（给家长看出处）
export function pageUrl(v) {
  return 'https://www.bilibili.com/video/' + v.bv + (v.p > 1 ? '?p=' + v.p : '');
}

// 秒 → 「3:05」「1:02:03」
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

// 记录、最好成绩用的键：同一个视频的不同集分开记
export function videoKey(v) {
  if (v.local) return 'local:' + v.local;
  if (v.routine) return 'demo:' + v.routine;
  return v.bv + (v.p > 1 ? '-p' + v.p : '');
}
