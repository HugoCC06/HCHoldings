// Copies the built single-file app to ./index.html so it can be opened directly
// (double-click) or served by GitHub Pages from the repository root.
import fs from 'node:fs';
const html = fs.readFileSync('dist/app.html', 'utf8');
if (/<script[^>]+src=/.test(html)) throw new Error('Build is not self-contained (external script found).');
fs.writeFileSync('index.html', html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB) — open it in Chrome.`);
