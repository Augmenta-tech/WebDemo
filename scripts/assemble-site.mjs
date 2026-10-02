import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, '_site');
const rev = (process.env.GITHUB_SHA || 'local').slice(0, 12);
const sdkOut = join(out, 'vendor', 'AugmentaClientSDK-JS', rev, 'dist', 'esm');

function requirePath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

requirePath(join(root, 'vendor', 'AugmentaClientSDK-JS', 'dist', 'esm'), 'built Augmenta SDK');
requirePath(join(root, 'vendor', 'qrcode-generator', 'qrcode.js'), 'vendored QR generator');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'src'), { recursive: true });
mkdirSync(sdkOut, { recursive: true });
mkdirSync(join(out, 'vendor', 'qrcode-generator'), { recursive: true });

copyFileSync(join(root, 'index.html'), join(out, 'index.html'));
copyFileSync(join(root, 'augmenta-favicon.png'), join(out, 'augmenta-favicon.png'));

for (const name of readdirSync(join(root, 'src'))) {
  if (!name.endsWith('.js') && name !== 'styles.css') continue;
  copyFileSync(join(root, 'src', name), join(out, 'src', name));
}

// Put the SDK under a revisioned directory rather than versioning only its
// entrypoint with a query string. Its internal relative imports then inherit
// the revisioned path too, so a deployment cannot mix old/new SDK modules.
cpSync(
  join(root, 'vendor', 'AugmentaClientSDK-JS', 'dist', 'esm'),
  sdkOut,
  { recursive: true }
);
copyFileSync(
  join(root, 'vendor', 'qrcode-generator', 'qrcode.js'),
  join(out, 'vendor', 'qrcode-generator', 'qrcode.js')
);


const indexPath = join(out, 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html
  .replace('  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n', '')
  .replace(
    './vendor/AugmentaClientSDK-JS/dist/esm/index.js',
    `./vendor/AugmentaClientSDK-JS/${rev}/dist/esm/index.js`
  )
  .replaceAll('./src/styles.css', `./src/styles.css?v=${rev}`)
  .replaceAll('./src/qr.js', `./src/qr.js?v=${rev}`)
  .replaceAll('./src/main.js', `./src/main.js?v=${rev}`);

writeFileSync(indexPath, html);

for (const name of readdirSync(join(out, 'src')).filter((name) => name.endsWith('.js'))) {
  const path = join(out, 'src', name);
  const source = readFileSync(path, 'utf8').replace(
    /(from\s+['"])(\.\.?(?:\/[^'"]+)+\.js)(['"])/g,
    `$1$2?v=${rev}$3`
  );
  writeFileSync(path, source);
}

writeFileSync(join(out, '.nojekyll'), '');
console.log(`Assembled self-contained Pages artifact for revision ${rev}`);
