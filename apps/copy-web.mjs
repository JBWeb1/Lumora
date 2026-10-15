// Copies the web app (the same files GitHub Pages serves) into a folder for the
// Android and desktop packages, so both run fully offline with no server.
//   node apps/copy-web.mjs <target folder, relative to the current directory>
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? 'www');
const FILES = ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'assets', 'src'];

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const f of FILES) cpSync(join(root, f), join(target, f), { recursive: true });
console.log(`Copied the Lumora web app to ${target}`);
