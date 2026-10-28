const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the 344-character description stays the public wording', () => {
  const description = 'VECTRA is building the operations layer for Solana treasuries. Plan USDC payouts, coordinate approvals, and explore Solana-only routing in a clear workspace. Our non-custodial approach keeps signing authority with treasury teams. This interactive demo previews the workflow; live wallet, Squads, and MultiHopper integrations are on the roadmap.';
  assert.equal(description.length, 344);
  assert.equal(read('DESCRIPTION.txt').trim(), description);
  assert.ok(read('README.md').includes(description));
});

test('the page CSP allows the vendored library and blocks eval', () => {
  const html = read('dist/index.html');
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src https:\/\/api\.devnet\.solana\.com/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.doesNotMatch(html, /script-src[^;]*unsafe-inline/);
  const integrity = html.match(/integrity="(sha384-[^"]+)"/);
  assert.ok(integrity);
  const file = fs.readFileSync(path.join(root, 'dist/vendor/solana-web3-1.98.4.js'));
  const hash = 'sha384-' + createHash('sha384').update(file).digest('base64');
  assert.equal(integrity[1], hash);
  assert.doesNotMatch(file.toString('utf8'), /\beval\s*\(/);
  assert.doesNotMatch(file.toString('utf8'), /new Function\s*\(/);
});

test('app source does not call eval or embed a secret key', () => {
  for (const file of ['dist/app.js', 'dist/core.js', 'dist/chain.js', 'dist/wallet.js', 'dist/routing.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /\beval\s*\(/);
    assert.doesNotMatch(source, /new Function\s*\(/);
    assert.doesNotMatch(source, /secretKey/);
    assert.doesNotMatch(source, /privateKey/);
  }
});
