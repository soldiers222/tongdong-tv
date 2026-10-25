// 水果贴图：用 Canvas 程序绘制，开局前预渲染一次，游戏中只做 drawImage，省电视算力。
import { FRUIT } from './fruit-logic.js';

function makeCanvas(R) {
  var size = Math.ceil(R * 2.7 + 16); // 留出果柄、叶子、引信的空间
  var c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  var g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  return { c: c, g: g, size: size };
}

function circle(g, r) {
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
}

function radial(g, r, inner, outer) {
  var grd = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  return grd;
}

function highlight(g, r) {
  g.save();
  g.globalAlpha = 0.28;
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.ellipse(-r * 0.38, -r * 0.42, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function leaf(g, x, y, w, h, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = '#3FA34D';
  g.strokeStyle = '#1F5E2B';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}

function drawWhole(type, R) {
  var k = makeCanvas(R), g = k.g;
  g.lineWidth = 3;
  if (type === 'melon') {
    circle(g, R);
    g.fillStyle = radial(g, R, '#5DB24E', '#1F6B2C');
    g.fill();
    g.save();
    circle(g, R);
    g.clip();
    g.strokeStyle = '#14512A';
    g.lineWidth = R * 0.13;
    for (var i = -3; i <= 3; i++) {
      var x = i * R * 0.3;
      g.beginPath();
      g.moveTo(x * 0.6, -R);
      g.bezierCurveTo(x + R * 0.12, -R * 0.4, x - R * 0.12, R * 0.4, x * 0.6, R);
      g.stroke();
    }
    g.restore();
    circle(g, R);
    g.strokeStyle = '#0E3A1C';
    g.lineWidth = 3;
    g.stroke();
    highlight(g, R);
  } else if (type === 'orange') {
    circle(g, R);
    g.fillStyle = radial(g, R, '#FFC15E', '#EE7A12');
    g.fill();
    g.fillStyle = 'rgba(160, 70, 0, 0.22)';
    for (var d = 0; d < 26; d++) {
      var a = d * 2.4, rr = R * (0.2 + 0.7 * ((d * 37) % 10) / 10);
      g.beginPath();
      g.arc(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.035, 0, Math.PI * 2);
      g.fill();
    }
    circle(g, R);
    g.strokeStyle = '#B4560A';
    g.stroke();
    leaf(g, R * 0.18, -R * 0.95, R * 0.3, R * 0.14, -0.4);
    highlight(g, R);
  } else if (type === 'apple') {
    g.beginPath();
    g.moveTo(0, -R * 0.72);
    g.bezierCurveTo(R * 0.6, -R * 1.05, R * 1.12, -R * 0.45, R * 0.95, R * 0.25);
    g.bezierCurveTo(R * 0.82, R * 0.85, R * 0.3, R * 1.02, 0, R * 0.86);
    g.bezierCurveTo(-R * 0.3, R * 1.02, -R * 0.82, R * 0.85, -R * 0.95, R * 0.25);
    g.bezierCurveTo(-R * 1.12, -R * 0.45, -R * 0.6, -R * 1.05, 0, -R * 0.72);
    g.closePath();
    g.fillStyle = radial(g, R, '#FF6B6B', '#B0182A');
    g.fill();
    g.strokeStyle = '#7A0F1C';
    g.stroke();
    g.strokeStyle = '#6B4226';
    g.lineWidth = R * 0.08;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -R * 0.7);
    g.lineTo(R * 0.08, -R * 1.02);
    g.stroke();
    leaf(g, R * 0.32, -R * 0.92, R * 0.26, R * 0.12, -0.5);
    highlight(g, R);
  } else if (type === 'kiwi') {
    g.beginPath();
    g.ellipse(0, 0, R, R * 0.86, 0.3, 0, Math.PI * 2);
    g.fillStyle = radial(g, R, '#A47A4E', '#5E3B22');
    g.fill();
    g.fillStyle = 'rgba(255, 230, 190, 0.18)';
    for (var f = 0; f < 40; f++) {
      var b = f * 2.39, rb = R * 0.85 * Math.sqrt(((f * 53) % 40) / 40);
      g.fillRect(Math.cos(b) * rb, Math.sin(b) * rb * 0.86, 2, 2);
    }
    g.strokeStyle = '#3B2414';
    g.stroke();
  } else if (type === 'star') {
    starPath(g, R, R * 0.5);
    var grd = g.createLinearGradient(0, -R, 0, R);
    grd.addColorStop(0, '#FFE680');
    grd.addColorStop(1, '#FFB000');
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = '#C97A00';
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.stroke();
    starPath(g, R * 0.55, R * 0.28);
    g.fillStyle = 'rgba(255, 255, 255, 0.45)';
    g.fill();
  } else if (type === 'bomb') {
    circle(g, R);
    g.fillStyle = radial(g, R, '#4A5263', '#0D1117');
    g.fill();
    g.strokeStyle = '#000';
    g.stroke();
    g.fillStyle = '#2A2F3A';
    g.fillRect(-R * 0.22, -R * 1.08, R * 0.44, R * 0.26);
    g.strokeStyle = '#8B5A2B';
    g.lineWidth = R * 0.08;
    g.beginPath();
    g.moveTo(0, -R * 1.05);
    g.quadraticCurveTo(R * 0.25, -R * 1.35, R * 0.5, -R * 1.2);
    g.stroke();
    g.fillStyle = '#E5484D';
    g.font = 'bold ' + Math.round(R * 0.9) + 'px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('!', 0, R * 0.08);
    highlight(g, R);
  }
  return k;
}

function starPath(g, ro, ri) {
  g.beginPath();
  for (var i = 0; i < 10; i++) {
    var r = i % 2 === 0 ? ro : ri;
    var a = -Math.PI / 2 + i * Math.PI / 5;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}

// 切面：切开后看到的果肉
function drawFace(type, R) {
  var k = makeCanvas(R), g = k.g;
  if (type === 'melon') {
    circle(g, R); g.fillStyle = '#1F6B2C'; g.fill();
    circle(g, R * 0.9); g.fillStyle = '#F2F7E4'; g.fill();
    circle(g, R * 0.82); g.fillStyle = '#E8414B'; g.fill();
    circle(g, R * 0.5); g.fillStyle = 'rgba(255, 120, 130, 0.45)'; g.fill();
    g.fillStyle = '#1B1B1B';
    for (var i = 0; i < 10; i++) {
      var a = i * Math.PI / 5;
      g.save();
      g.translate(Math.cos(a) * R * 0.52, Math.sin(a) * R * 0.52);
      g.rotate(a);
      g.beginPath();
      g.ellipse(0, 0, R * 0.07, R * 0.04, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  } else if (type === 'orange') {
    circle(g, R); g.fillStyle = '#EE7A12'; g.fill();
    circle(g, R * 0.9); g.fillStyle = '#FFF1D6'; g.fill();
    circle(g, R * 0.84); g.fillStyle = '#FFA62B'; g.fill();
    g.strokeStyle = '#FFF1D6';
    g.lineWidth = 3;
    for (var s = 0; s < 10; s++) {
      var b = s * Math.PI / 5;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(b) * R * 0.84, Math.sin(b) * R * 0.84);
      g.stroke();
    }
  } else if (type === 'apple') {
    circle(g, R * 0.95); g.fillStyle = '#C81E32'; g.fill();
    circle(g, R * 0.86); g.fillStyle = '#FFF2D0'; g.fill();
    g.fillStyle = '#5A3A1A';
    for (var p = 0; p < 5; p++) {
      var c = p * Math.PI * 2 / 5;
      g.beginPath();
      g.ellipse(Math.cos(c) * R * 0.2, Math.sin(c) * R * 0.2, R * 0.07, R * 0.035, c, 0, Math.PI * 2);
      g.fill();
    }
  } else if (type === 'kiwi') {
    circle(g, R); g.fillStyle = '#6B4628'; g.fill();
    circle(g, R * 0.9); g.fillStyle = '#8BC34A'; g.fill();
    circle(g, R * 0.6); g.fillStyle = '#A5D46A'; g.fill();
    circle(g, R * 0.24); g.fillStyle = '#F4F9E8'; g.fill();
    g.fillStyle = '#1B1B1B';
    for (var q = 0; q < 22; q++) {
      var d = q * Math.PI * 2 / 22;
      g.beginPath();
      g.arc(Math.cos(d) * R * 0.38, Math.sin(d) * R * 0.38, R * 0.03, 0, Math.PI * 2);
      g.fill();
    }
  } else if (type === 'star') {
    starPath(g, R, R * 0.5);
    g.fillStyle = '#FFF1B0';
    g.fill();
    g.strokeStyle = '#E09B00';
    g.lineWidth = 4;
    g.stroke();
  } else {
    circle(g, R);
    g.fillStyle = '#333';
    g.fill();
  }
  return k;
}

export function makeSprites(sizeScale) {
  var out = {};
  for (var type in FRUIT) {
    var R = FRUIT[type].r * sizeScale;
    out[type] = { R: R, whole: drawWhole(type, R), face: drawFace(type, R) };
  }
  return out;
}
