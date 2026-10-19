// Stamps every local script/style/import with the commit about to ship, so
// browsers inside apps (APTV) never keep last version's files in cache.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const version = execSync('git rev-parse --short HEAD').toString().trim() + '-' + Date.now().toString(36);
const stamp = (s) =>
  s
    .replace(/((?:src|href)="(?:js\/[\w-]+\.js|styles\.css))(?:\?v=[\w-]+)?"/g, `$1?v=${version}"`)
    .replace(/(from '\.\/[\w-]+\.js)(?:\?v=[\w-]+)?'/g, `$1?v=${version}'`);

for (const file of ['index.html', ...readdirSync('js').map((f) => `js/${f}`)]) {
  const before = readFileSync(file, 'utf8');
  const after = stamp(before);
  if (after !== before) writeFileSync(file, after);
}
writeFileSync('version.json', `${JSON.stringify({ v: version })}\n`);
console.log(`stamped ${version}`);
