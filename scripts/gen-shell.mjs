// FORGE // 网页锻造工坊 — Tauri2 项目骨架生成器（PakePlus 式）
// 在 GitHub Action runner 上由 forge.yml 调用，根据 forge.config.json
// 动态生成 Tauri2 壳应用项目，加载用户配置的 URL。
//
// 用法: node scripts/gen-shell.mjs [outdir] [config]
//   outdir: 项目根目录（相对当前工作目录，默认 app）
//   config: forge.config.json 路径（默认 forge.config.json）
//
// 生成结构（PakePlus 兼容）:
//   <outdir>/
//   ├── package.json          # 前端入口（@tauri-apps/cli）
//   ├── src/index.html        # 壳页面，加载用户 URL
//   └── src-tauri/
//       ├── Cargo.toml        # Rust 依赖
//       ├── tauri.conf.json   # Tauri2 配置（identifier/窗口/产物）
//       ├── build.rs
//       ├── icons/            # 占位图标
//       └── src/main.rs       # Rust 入口（最小）

import fs from 'node:fs';
import path from 'node:path';

const outdir = process.argv[2] || 'app';
const cfgPath = process.argv[3] || 'forge.config.json';

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const APP_URL = cfg.url || 'https://example.com';
const APP_NAME = cfg.name || 'forge-app';
const APP_VER = cfg.version || '1.0.0';
// identifier 必须用点号分隔（Tauri 要求），把连字符转成点
const BUNDLE = (cfg.bundleId || 'com.forge.app').replace(/-/g, '.');
const WIDTH = cfg.width || 1280;
const HEIGHT = cfg.height || 800;
const FULLSCREEN = !!cfg.fullscreen;

function write(rel, content) {
  const p = path.join(outdir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  console.log('  wrote ' + rel);
}

// ============ package.json ============
write('package.json', JSON.stringify({
  name: 'forge-tauri-app',
  version: APP_VER,
  private: true,
  type: 'module',
  scripts: {
    tauri: 'tauri',
    build: 'tauri build',
  },
  dependencies: {
    '@tauri-apps/api': '^2.0.0',
  },
  devDependencies: {
    '@tauri-apps/cli': '^2.0.0',
  },
}, null, 2) + '\n');

// ============ src/index.html（壳页面，iframe 加载用户 URL）============
write('src/index.html', [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
  '  <title>' + escapeHtml(APP_NAME) + '</title>',
  '  <style>',
  '    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0a0a0a; }',
  '    #frame { width: 100vw; height: 100vh; border: 0; display: block; }',
  '    #loading { position: fixed; inset: 0; display: grid; place-items: center; color: #888; font-family: system-ui, sans-serif; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <div id="loading">loading…</div>',
  '  <iframe id="frame" src="' + escapeAttr(APP_URL) + '" allow="fullscreen; camera; microphone; geolocation; clipboard-read; clipboard-write" onload="document.getElementById(\'loading\').style.display=\'none\'"></iframe>',
  '</body>',
  '</html>',
  '',
].join('\n'));

// ============ src-tauri/tauri.conf.json ============
write('src-tauri/tauri.conf.json', JSON.stringify({
  $schema: 'https://schema.tauri.app/config/2',
  productName: APP_NAME,
  version: APP_VER,
  identifier: BUNDLE,
  build: {
    frontendDist: '../src',
    devUrl: APP_URL,
  },
  app: {
    windows: [
      {
        title: APP_NAME,
        width: WIDTH,
        height: HEIGHT,
        resizable: true,
        fullscreen: FULLSCREEN,
        center: true,
      },
    ],
    security: {
      csp: null,
      assetProtocol: { enable: true, scope: [] },
    },
  },
  bundle: {
    active: true,
    targets: 'all',
    icon: [
      'icons/32x32.png',
      'icons/128x128.png',
      'icons/128x128@2x.png',
      'icons/icon.icns',
      'icons/icon.ico',
    ],
  },
}, null, 2) + '\n');

// ============ src-tauri/Cargo.toml ============
write('src-tauri/Cargo.toml', [
  '[package]',
  'name = "forge-tauri-app"',
  'version = "' + APP_VER + '"',
  'description = "FORGE shell app for ' + APP_NAME + '"',
  'authors = ["forge"]',
  'edition = "2021"',
  '',
  '[lib]',
  'name = "forge_tauri_app_lib"',
  'crate-type = ["staticlib", "cdylib", "rlib"]',
  '',
  '[build-dependencies]',
  'tauri-build = { version = "2", features = [] }',
  '',
  '[dependencies]',
  'tauri = { version = "2", features = [] }',
  'serde = { version = "1", features = ["derive"] }',
  'serde_json = "1"',
  '',
  '[profile.release]',
  'panic = "abort"',
  'codegen-units = 1',
  'lto = true',
  'opt-level = "s"',
  'strip = true',
  '',
].join('\n'));

// ============ src-tauri/build.rs ============
write('src-tauri/build.rs', [
  'fn main() {',
  '    tauri_build::build()',
  '}',
  '',
].join('\n'));

// ============ src-tauri/src/main.rs ============
write('src-tauri/src/main.rs', [
  '// FORGE Tauri2 壳应用 · 加载远程 URL: ' + APP_URL,
  '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]',
  '',
  'fn main() {',
  '    forge_tauri_app_lib::run()',
  '}',
  '',
].join('\n'));

// ============ src-tauri/src/lib.rs ============
write('src-tauri/src/lib.rs', [
  '// FORGE Tauri2 壳应用库',
  'use tauri::Manager;',
  '',
  '#[cfg_attr(mobile, tauri::mobile_entry_point)]',
  'pub fn run() {',
  '    tauri::Builder::default()',
  '        .setup(|app| {',
  '            #[cfg(not(mobile))]',
  '            {',
  '                if let Some(win) = app.get_webview_window("main") {',
  '                    let _ = win.show();',
  '                }',
  '            }',
  '            Ok(())',
  '        })',
  '        .run(tauri::generate_context!())',
  '        .expect("error while running tauri application");',
  '}',
  '',
].join('\n'));

// ============ src-tauri/capabilities/default.json ============
write('src-tauri/capabilities/default.json', JSON.stringify({
  $schema: '../gen/schemas/desktop-schema.json',
  identifier: 'default',
  description: 'FORGE shell default capability',
  windows: ['main'],
  permissions: ['core:default'],
}, null, 2) + '\n');

// ============ 占位图标（1x1 透明 PNG）============
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
['32x32.png', '128x128.png', '128x128@2x.png'].forEach((n) => {
  write('src-tauri/icons/' + n, PLACEHOLDER_PNG);
});
write('src-tauri/icons/icon.ico', PLACEHOLDER_PNG);
write('src-tauri/icons/icon.icns', PLACEHOLDER_PNG);

// ============ .gitignore ============
write('.gitignore', [
  '/node_modules',
  '/src-tauri/target',
  '/src-tauri/gen',
  '',
].join('\n'));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

console.log('✓ Tauri2 shell generated · URL=' + APP_URL + ' · name=' + APP_NAME + ' · bundle=' + BUNDLE + ' · ' + WIDTH + 'x' + HEIGHT);
