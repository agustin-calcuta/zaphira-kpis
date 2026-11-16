import {copyFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(root, 'public'), {recursive: true});
copyFileSync(join(root, '..', 'index.html'), join(root, 'public', 'index.html'));
copyFileSync(join(root, 'pages', '_worker.js'), join(root, 'public', '_worker.js'));
copyFileSync(join(root, 'pages', '.assetsignore'), join(root, 'public', '.assetsignore'));
