import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const outfile = 'dist/vendor/solana-web3-1.98.4.js';

await build({
  entryPoints: ['scripts/solana-entry.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  outfile,
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.BROWSER': '"true"',
  },
  banner: {
    js: '/* @solana/web3.js@1.98.4 MIT. Vendored browser build. No secrets or private keys. */',
  },
});

const source = readFileSync(outfile);
if (/\beval\s*\(/.test(source.toString('utf8')) || /new Function\s*\(/.test(source.toString('utf8'))) {
  throw new Error('Vendored build contains eval or new Function');
}
const hash = createHash('sha384').update(source).digest('base64');
writeFileSync('dist/vendor/INTEGRITY.txt', [
  '@solana/web3.js@1.98.4',
  'file: solana-web3-1.98.4.js',
  'sri: sha384-' + hash,
  'bytes: ' + source.length,
  'Built with esbuild from scripts/vendor-solana.mjs. GitHub Pages serves this file as-is.',
  '',
].join('\n'));
copyFileSync('node_modules/@solana/web3.js/LICENSE', 'dist/vendor/LICENSE-solana-web3.txt');
console.log('sha384-' + hash);
console.log(source.length + ' bytes');
