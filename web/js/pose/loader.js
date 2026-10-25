// 按需加载第三方脚本（只加载一次）
var cache = {};

export function loadScript(src) {
  if (cache[src]) return cache[src];
  cache[src] = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = function () { resolve(); };
    s.onerror = function () {
      delete cache[src];
      reject(new Error('脚本加载失败：' + src));
    };
    document.head.appendChild(s);
  });
  return cache[src];
}
