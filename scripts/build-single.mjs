// Bundle the app into one self-contained HTML file (dist/hum-to-notes.html),
// plus a body-only fragment for embedding (dist/embed.html).
// Usage: node scripts/build-single.mjs  (needs esbuild: npx esbuild or npm i -D esbuild)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(root + 'index.html', 'utf8');
const css = readFileSync(root + 'styles.css', 'utf8');
const js = (await build({ entryPoints: [root + 'src/app.js'], bundle: true, format: 'iife', minify: true, write: false })).outputFiles[0].text;
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const body = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->'));

mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/hum-to-notes.html', html
  .replace(/<link rel="(manifest|icon)"[^>]*>\n/g, '')
  .replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="src/app.js"></script>', `<script>${js}</script>`));
writeFileSync(root + 'dist/embed.html', `<title>Hum to Notes</title>\n${fonts}\n<style>${css}</style>\n${body}\n<script>${js.replace(/<\/script/gi, '<\\/script')}</script>\n`);
console.log('built dist/hum-to-notes.html and dist/embed.html');
