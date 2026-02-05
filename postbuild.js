import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, 'dist');
const indexPath = path.join(distDir, 'index.html');

// Read index.html
let html = fs.readFileSync(indexPath, 'utf-8');

// Fix manifest path: ./assets/manifest-*.json -> ./manifest.json
html = html.replace(
          /href="\.\/assets\/manifest-[^"]+\.json"/g,
          'href="./manifest.json"'
);

// Write back
fs.writeFileSync(indexPath, html, 'utf-8');

console.log('✓ Fixed manifest.json path in dist/index.html');
