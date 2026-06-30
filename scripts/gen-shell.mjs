// FORGE // 网页锻造工坊 — 项目骨架生成器
// 在 GitHub Action runner 上由 forge.yml 调用，根据 forge.config.json
// 动态生成 Electron 或 Capacitor 壳应用项目，加载用户配置的 URL。
//
// 用法: node scripts/gen-shell.mjs <stack> <outdir>
//   stack:  electron | capacitor
//   outdir: 项目根目录（相对当前工作目录）

import fs from 'node:fs';
import path from 'node:path';

const stack = process.argv[2];
const outdir = process.argv[3] || 'app';
const cfgPath = process.argv[4] || 'forge.config.json';

if (!stack) {
  console.error('Usage: node scripts/gen-shell.mjs <electron|capacitor> [outdir] [config]');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const APP_URL = cfg.url || 'https://example.com';
const APP_NAME = cfg.name || 'forge-app';
const APP_VER = cfg.version || '1.0.0';
const BUNDLE = cfg.bundleId || 'com.forge.app';

fs.mkdirSync(outdir, { recursive: true });

function write(rel, content) {
  const p = path.join(outdir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  console.log('  wrote ' + rel);
}

if (stack === 'electron') {
  // ---- Electron 壳应用（桌面 Windows/macOS/Linux）----
  write('package.json', JSON.stringify({
    name: 'forge-electron',
    version: APP_VER,
    main: 'main.js',
    scripts: { dist: 'electron-builder' },
    devDependencies: {
      electron: '^30.0.0',
      'electron-builder': '^24.13.0',
    },
    build: {
      appId: BUNDLE,
      productName: APP_NAME,
      directories: { output: 'release' },
      files: ['main.js'],
      win: { target: ['nsis'] },
      mac: { target: ['dmg'], category: 'public.app-category.utilities' },
      linux: { target: ['AppImage'], category: 'Utility' },
    },
  }, null, 2) + '\n');

  write('main.js', [
    `// FORGE 壳应用 · 加载远程 URL: ${APP_URL}`,
    "const { app, BrowserWindow } = require('electron');",
    `const APP_URL = ${JSON.stringify(APP_URL)};`,
    '',
    'function createWindow() {',
    '  const win = new BrowserWindow({',
    '    width: 1280, height: 800, autoHideMenuBar: true,',
    `    title: ${JSON.stringify(APP_NAME)},`,
    '  });',
    '  win.loadURL(APP_URL);',
    '}',
    '',
    'app.whenReady().then(createWindow);',
    "app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });",
    "app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });",
    '',
  ].join('\n'));

} else if (stack === 'capacitor') {
  // ---- Capacitor 壳应用（iOS / Android）----
  write('package.json', JSON.stringify({
    name: 'forge-capacitor',
    version: APP_VER,
    dependencies: {
      '@capacitor/core': '^6.0.0',
      '@capacitor/cli': '^6.0.0',
      '@capacitor/android': '^6.0.0',
      '@capacitor/ios': '^6.0.0',
    },
  }, null, 2) + '\n');

  write('capacitor.config.json', JSON.stringify({
    appId: BUNDLE,
    appName: APP_NAME,
    webDir: 'www',
    server: { url: APP_URL, cleartext: true },
    ios: { contentInset: 'always' },
    android: { allowMixedContent: true },
  }, null, 2) + '\n');

  // www 兜底页面（实际启动后由 server.url 直接加载远程 URL）
  write('www/index.html', [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${APP_NAME}</title>`,
    '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '</head>',
    '<body>',
    '  <p style="font-family:sans-serif">loading…</p>',
    `  <script>location.replace(${JSON.stringify(APP_URL)})</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n'));

} else {
  console.error('Unknown stack: ' + stack);
  process.exit(1);
}

console.log(`✓ ${stack} shell generated · URL=${APP_URL} · name=${APP_NAME} · bundle=${BUNDLE}`);
