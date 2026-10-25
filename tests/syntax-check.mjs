// 语法兼容检查：自己写的代码只允许 ES2017（电视 WebView 可能较老），
// 发现 ?. ?? 类字段、动态 import 等新语法就报错。第三方 vendor/ 不检查。
import { parse } from 'acorn';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../web/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'vendor') walk(p); continue; }
    if (p.endsWith('.js')) files.push(p);
  }
})(root);

const banned = [
  [/\?\.[^\d]/, '可选链 ?.'],
  [/\?\?/, '空值合并 ??'],
  [/\.replaceAll\(/, 'String.replaceAll'],
  [/\.at\(-?\d/, 'Array.at'],
  [/Object\.fromEntries/, 'Object.fromEntries'],
  [/\.flatMap\(/, 'Array.flatMap']
];

let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const isWorker = f.endsWith('-worker.js');
  try {
    parse(src, { ecmaVersion: 2017, sourceType: isWorker ? 'script' : 'module', allowHashBang: false });
  } catch (e) {
    bad++;
    console.log('✗ ' + relative(root, f) + '：' + e.message);
    continue;
  }
  for (const [re, what] of banned) {
    // 去掉注释和字符串里的误报：只粗查代码行
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    if (re.test(code)) { bad++; console.log('✗ ' + relative(root, f) + '：用了 ' + what); }
  }
}
console.log(bad ? `发现 ${bad} 处问题` : `✓ ${files.length} 个文件都符合 ES2017`);
process.exit(bad ? 1 : 0);
