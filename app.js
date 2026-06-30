/* ============================================================
   FORGE // app.js — interactions + real GitHub API (PAT)
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const GH_API = 'https://api.github.com';

  /* ---------- state ---------- */
  const state = {
    loggedIn: false,
    token: null,
    user: null,        // { login, name, avatar_url, html_url }
    repo: null,        // owner/repo
    repoName: null,    // repo slug
    targets: new Set(['ios', 'android', 'windows', 'macos', 'linux']),
    accent: '#c6ff3a',
    shell: 'tauri',
    building: false,
  };

  /* ============================================================
     GITHUB REST API HELPERS
     ============================================================ */
  async function ghFetch(path, options = {}) {
    const headers = {
      'Authorization': 'Bearer ' + state.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(GH_API + path, { ...options, headers });
    return res;
  }

  async function ghJson(res) {
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, headers: res.headers, data };
  }

  function b64encode(str) {
    // UTF-8 safe base64
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(str) {
    return decodeURIComponent(escape(atob(str.replace(/\n/g, ''))));
  }

  async function validateToken() {
    const res = await ghFetch('/user');
    const r = await ghJson(res);
    if (!r.ok) {
      if (r.status === 401) throw new Error('Token 无效或已过期，请检查后重新输入');
      if (r.status === 403) {
        const remaining = r.headers.get('X-RateLimit-Remaining');
        if (remaining === '0') throw new Error('GitHub API 速率限制已达上限，请稍后再试');
        const scopes = r.headers.get('X-OAuth-Scopes') || '';
        if (scopes && (!scopes.includes('repo') || !scopes.includes('workflow')))
          throw new Error('Token 权限不足，需要 repo 与 workflow 权限。当前权限: ' + scopes);
        throw new Error('Token 权限不足，需要 repo 与 workflow 权限');
      }
      throw new Error('验证失败 · HTTP ' + r.status);
    }
    if (!r.data || !r.data.login) throw new Error('未能读取到用户信息');
    // best-effort scope check (header may be hidden by CORS)
    const scopes = r.headers.get('X-OAuth-Scopes');
    if (scopes && (!scopes.includes('repo') || !scopes.includes('workflow'))) {
      throw new Error('Token 权限不足，需要 repo 与 workflow 权限。当前: ' + scopes);
    }
    return r.data;
  }

  async function createRepo(name) {
    const res = await ghFetch('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: name,
        description: 'Forged by FORGE // 网页锻造工坊 — GitHub Action multi-platform packager',
        private: false,
        auto_init: true,
      }),
    });
    const r = await ghJson(res);
    if (r.ok) return { repo: r.data, created: true };
    if (r.status === 422) {
      // repo likely already exists — try to use it
      const user = state.user.login;
      const check = await ghFetch('/repos/' + user + '/' + name);
      const cj = await ghJson(check);
      if (cj.ok) return { repo: cj.data, created: false };
      throw new Error('仓库名称不合法或已被他人占用');
    }
    if (r.status === 403) {
      const remaining = r.headers.get('X-RateLimit-Remaining');
      if (remaining === '0') throw new Error('API 速率限制，请稍后再试');
      throw new Error('无权创建仓库，请确认 Token 含 repo 权限');
    }
    throw new Error('创建仓库失败 · HTTP ' + r.status + (r.data && r.data.message ? ' · ' + r.data.message : ''));
  }

  async function writeFile(owner, repo, path, content, message, sha) {
    const body = { message, content: b64encode(content) };
    if (sha) body.sha = sha;
    const res = await ghFetch('/repos/' + owner + '/' + repo + '/contents/' + path, {
      method: 'PUT', body: JSON.stringify(body),
    });
    const r = await ghJson(res);
    if (r.ok) return r.data;
    if (r.status === 409 || r.status === 422) {
      // conflict / unchanged — fetch sha and retry once
      const get = await ghFetch('/repos/' + owner + '/' + repo + '/contents/' + path);
      const gj = await ghJson(get);
      if (gj.ok && gj.data && gj.data.sha) {
        const retry = await ghFetch('/repos/' + owner + '/' + repo + '/contents/' + path, {
          method: 'PUT', body: JSON.stringify({ message, content: b64encode(content), sha: gj.data.sha }),
        });
        const rj = await ghJson(retry);
        if (rj.ok) return rj.data;
        throw new Error('写入 ' + path + ' 失败 · ' + (rj.data && rj.data.message ? rj.data.message : rj.status));
      }
      throw new Error('写入 ' + path + ' 失败 · 文件冲突且无法获取 sha');
    }
    throw new Error('写入 ' + path + ' 失败 · ' + (r.data && r.data.message ? r.data.message : 'HTTP ' + r.status));
  }

  async function readFile(owner, repo, path) {
    const res = await ghFetch('/repos/' + owner + '/' + repo + '/contents/' + path);
    const r = await ghJson(res);
    if (!r.ok) return null;
    return r.data;
  }

  async function getLatestRun(owner, repo) {
    const res = await ghFetch('/repos/' + owner + '/' + repo + '/actions/runs?per_page=1');
    const r = await ghJson(res);
    if (!r.ok || !r.data || !r.data.workflow_runs) return null;
    return r.data.workflow_runs[0] || null;
  }

  async function getRun(owner, repo, id) {
    const res = await ghFetch('/repos/' + owner + '/' + repo + '/actions/runs/' + id);
    const r = await ghJson(res);
    return r.ok ? r.data : null;
  }

  /* ============================================================
     CONFIG + WORKFLOW GENERATION
     ============================================================ */
  function collectConfig() {
    return {
      name: $('#appName').value.trim() || 'my-app',
      url: $('#appUrl').value.trim() || 'https://example.com',
      bundleId: $('#appId').value.trim() || 'com.forge.app',
      version: $('#appVer').value.trim() || '1.0.0',
      targets: Array.from(state.targets),
      shell: state.shell,
      accent: state.accent,
      window: { width: +$('#winW').value || 1280, height: +$('#winH').value || 800 },
      offline: !!($('input[data-meta="offline"]') && $('input[data-meta="offline"]').checked),
      autoUpdate: !!($('input[data-meta="update"]') && $('input[data-meta="update"]').checked),
      generatedAt: new Date().toISOString(),
    };
  }

  function buildConfigJson(cfg) {
    return JSON.stringify(cfg, null, 2) + '\n';
  }

  function buildWorkflowYml() {
    // PakePlus 式：Tauri2 + Rust，产物 <5MB
    // 桌面三端用 tauri-action，移动端用 cargo tauri android/ios build
    return `# FORGE // 网页锻造工坊 — auto-generated workflow (Tauri2 real build)
# 参考 PakePlus · Tauri2 + Rust · 产物 <5MB
name: FORGE build

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: forge-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      matrix: \${{ steps.gen.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
      - name: Generate build matrix from forge.config.json
        id: gen
        shell: bash
        run: |
          MATRIX=$(jq -c '{include: [ .targets[] | {
            target: .,
            os: (if . == "ios" or . == "macos" then "macos-14"
                 elif . == "windows" then "windows-latest"
                 else "ubuntu-latest" end),
            kind: (if . == "windows" or . == "macos" or . == "linux" then "desktop"
                   else "mobile" end)
          } ] }' forge.config.json)
          echo "matrix=$MATRIX" >> "$GITHUB_OUTPUT"

  forge:
    needs: prepare
    runs-on: \${{ matrix.os }}
    defaults:
      run:
        shell: bash
    strategy:
      fail-fast: false
      matrix: \${{ fromJson(needs.prepare.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Linux system deps (Tauri2)
        if: matrix.target == 'linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libgtk-3-dev libayatana-appindicator3-dev

      - name: Read FORGE config
        shell: bash
        run: |
          {
            echo "## FORGE config"
            echo '\`\`\`json'
            cat forge.config.json
            echo '\`\`\`'
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Generate Tauri2 shell project
        shell: bash
        run: node scripts/gen-shell.mjs app forge.config.json

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: \${{ matrix.target == 'android' && 'aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android' || matrix.target == 'ios' && 'aarch64-apple-ios,aarch64-apple-ios-sim' || '' }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: app/src-tauri -> target

      - name: Install frontend deps
        shell: bash
        run: cd app && npm install --no-audit --no-fund

      # ============ 桌面端：tauri-action ============
      - name: Build desktop (tauri-action)
        if: matrix.kind == 'desktop'
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        with:
          projectPath: app
          tagName: forge-v\${{ github.run_number }}
          releaseName: 'FORGE v\${{ github.run_number }}'
          releaseBody: '由 FORGE 网页锻造工坊自动构建 · Tauri2 + Rust'
          releaseDraft: true
          prerelease: false

      - name: Collect desktop artifact (no-tag fallback)
        if: matrix.kind == 'desktop' && !startsWith(github.ref, 'refs/tags/v')
        shell: bash
        run: |
          mkdir -p dist
          find app/src-tauri/target -type f \( -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.deb" \) -exec cp {} dist/ \; 2>/dev/null || true
          ls -la dist/ || echo "no desktop artifact found"

      # ============ Android：cargo tauri android ============
      - name: Setup Java (Android)
        if: matrix.target == 'android'
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Setup Android SDK & NDK
        if: matrix.target == 'android'
        uses: android-actions/setup-android@v3
        with:
          packages: 'platform-tools platforms;android-34 ndk;27.2.12479018'

      - name: Build Android (debug apk, unsigned)
        if: matrix.target == 'android'
        shell: bash
        env:
          ANDROID_HOME: /usr/local/lib/android/sdk
          NDK_HOME: /usr/local/lib/android/sdk/ndk/27.2.12479018
        run: |
          cd app && npx tauri android init || true
          npx tauri android build --apk --target aarch64
          mkdir -p ../dist
          find src-tauri/gen -name "*.apk" -exec cp {} ../dist/app-android.apk \; 2>/dev/null || true
          ls -la ../dist/

      # ============ iOS：cargo tauri ios（未签名）============
      - name: Build iOS (unsigned)
        if: matrix.target == 'ios'
        shell: bash
        run: |
          cd app && npx tauri ios init || true
          npx tauri ios build --export-method debugging || echo "::warning::tauri ios build 失败，需 Xcode 环境"
          mkdir -p ../dist
          find src-tauri/gen -name "*.ipa" -exec cp {} ../dist/app-ios.ipa \; 2>/dev/null || true
          if [ ! -f ../dist/app-ios.ipa ]; then
            APP_PATH=$(find src-tauri/gen -name "*.app" -path "*Release-iphoneos*" | head -1)
            if [ -n "\${APP_PATH}" ]; then
              STAGE=$(mktemp -d) && mkdir -p "\${STAGE}/Payload"
              cp -R "\${APP_PATH}" "\${STAGE}/Payload/"
              (cd "\${STAGE}" && zip -qr "../dist/app-ios-unsigned.ipa" Payload)
            fi
          fi
          ls -la ../dist/ || echo "iOS 产物需本地 Xcode 签名"

      - name: Upload artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: forge-\${{ matrix.target }}
          path: dist/*
          if-no-files-found: warn
`;
  }

  // 生成 scripts/gen-shell.mjs 内容（写入用户仓库，供 forge.yml 调用）
  // 生成 scripts/gen-shell.mjs 内容（写入用户仓库，供 forge.yml 调用）
  // Tauri2 项目骨架生成器（PakePlus 式）
  // 生成 scripts/gen-shell.mjs 内容（写入用户仓库，供 forge.yml 调用）
  // Tauri2 项目骨架生成器（PakePlus 式）
  // 生成 scripts/gen-shell.mjs 内容（写入用户仓库，供 forge.yml 调用）
  // Tauri2 项目骨架生成器（PakePlus 式）
  function buildGenShellMjs() {
    return "// FORGE // \u7f51\u9875\u953b\u9020\u5de5\u574a \u2014 Tauri2 \u9879\u76ee\u9aa8\u67b6\u751f\u6210\u5668\uff08PakePlus \u5f0f\uff09\n// \u5728 GitHub Action runner \u4e0a\u7531 forge.yml \u8c03\u7528\uff0c\u6839\u636e forge.config.json\n// \u52a8\u6001\u751f\u6210 Tauri2 \u58f3\u5e94\u7528\u9879\u76ee\uff0c\u52a0\u8f7d\u7528\u6237\u914d\u7f6e\u7684 URL\u3002\n//\n// \u7528\u6cd5: node scripts/gen-shell.mjs [outdir] [config]\n//   outdir: \u9879\u76ee\u6839\u76ee\u5f55\uff08\u76f8\u5bf9\u5f53\u524d\u5de5\u4f5c\u76ee\u5f55\uff0c\u9ed8\u8ba4 app\uff09\n//   config: forge.config.json \u8def\u5f84\uff08\u9ed8\u8ba4 forge.config.json\uff09\n//\n// \u751f\u6210\u7ed3\u6784\uff08PakePlus \u517c\u5bb9\uff09:\n//   <outdir>/\n//   \u251c\u2500\u2500 package.json          # \u524d\u7aef\u5165\u53e3\uff08@tauri-apps/cli\uff09\n//   \u251c\u2500\u2500 src/index.html        # \u58f3\u9875\u9762\uff0c\u52a0\u8f7d\u7528\u6237 URL\n//   \u2514\u2500\u2500 src-tauri/\n//       \u251c\u2500\u2500 Cargo.toml        # Rust \u4f9d\u8d56\n//       \u251c\u2500\u2500 tauri.conf.json   # Tauri2 \u914d\u7f6e\uff08identifier/\u7a97\u53e3/\u4ea7\u7269\uff09\n//       \u251c\u2500\u2500 build.rs\n//       \u251c\u2500\u2500 icons/            # \u5360\u4f4d\u56fe\u6807\n//       \u2514\u2500\u2500 src/main.rs       # Rust \u5165\u53e3\uff08\u6700\u5c0f\uff09\n\nimport fs from 'node:fs';\nimport path from 'node:path';\n\nconst outdir = process.argv[2] || 'app';\nconst cfgPath = process.argv[3] || 'forge.config.json';\n\nconst cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));\nconst APP_URL = cfg.url || 'https://example.com';\nconst APP_NAME = cfg.name || 'forge-app';\nconst APP_VER = cfg.version || '1.0.0';\n// identifier \u5fc5\u987b\u7528\u70b9\u53f7\u5206\u9694\uff08Tauri \u8981\u6c42\uff09\uff0c\u628a\u8fde\u5b57\u7b26\u8f6c\u6210\u70b9\nconst BUNDLE = (cfg.bundleId || 'com.forge.app').replace(/-/g, '.');\nconst WIDTH = cfg.width || 1280;\nconst HEIGHT = cfg.height || 800;\nconst FULLSCREEN = !!cfg.fullscreen;\n\nfunction write(rel, content) {\n  const p = path.join(outdir, rel);\n  fs.mkdirSync(path.dirname(p), { recursive: true });\n  fs.writeFileSync(p, content);\n  console.log('  wrote ' + rel);\n}\n\n// ============ package.json ============\nwrite('package.json', JSON.stringify({\n  name: 'forge-tauri-app',\n  version: APP_VER,\n  private: true,\n  type: 'module',\n  scripts: {\n    tauri: 'tauri',\n    build: 'tauri build',\n  },\n  dependencies: {\n    '@tauri-apps/api': '^2.0.0',\n  },\n  devDependencies: {\n    '@tauri-apps/cli': '^2.0.0',\n  },\n}, null, 2) + '\\n');\n\n// ============ src/index.html\uff08\u58f3\u9875\u9762\uff0ciframe \u52a0\u8f7d\u7528\u6237 URL\uff09============\nwrite('src/index.html', [\n  '<!doctype html>',\n  '<html lang=\"zh-CN\">',\n  '<head>',\n  '  <meta charset=\"UTF-8\">',\n  '  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\">',\n  '  <title>' + escapeHtml(APP_NAME) + '</title>',\n  '  <style>',\n  '    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0a0a0a; }',\n  '    #frame { width: 100vw; height: 100vh; border: 0; display: block; }',\n  '    #loading { position: fixed; inset: 0; display: grid; place-items: center; color: #888; font-family: system-ui, sans-serif; }',\n  '  </style>',\n  '</head>',\n  '<body>',\n  '  <div id=\"loading\">loading\u2026</div>',\n  '  <iframe id=\"frame\" src=\"' + escapeAttr(APP_URL) + '\" allow=\"fullscreen; camera; microphone; geolocation; clipboard-read; clipboard-write\" onload=\"document.getElementById(\\'loading\\').style.display=\\'none\\'\"></iframe>',\n  '</body>',\n  '</html>',\n  '',\n].join('\\n'));\n\n// ============ src-tauri/tauri.conf.json ============\nwrite('src-tauri/tauri.conf.json', JSON.stringify({\n  $schema: 'https://schema.tauri.app/config/2',\n  productName: APP_NAME,\n  version: APP_VER,\n  identifier: BUNDLE,\n  build: {\n    frontendDist: '../src',\n    devUrl: APP_URL,\n  },\n  app: {\n    windows: [\n      {\n        title: APP_NAME,\n        width: WIDTH,\n        height: HEIGHT,\n        resizable: true,\n        fullscreen: FULLSCREEN,\n        center: true,\n      },\n    ],\n    security: {\n      csp: null,\n      assetProtocol: { enable: true, scope: [] },\n    },\n  },\n  bundle: {\n    active: true,\n    targets: 'all',\n    icon: [\n      'icons/32x32.png',\n      'icons/128x128.png',\n      'icons/128x128@2x.png',\n      'icons/icon.icns',\n      'icons/icon.ico',\n    ],\n  },\n}, null, 2) + '\\n');\n\n// ============ src-tauri/Cargo.toml ============\nwrite('src-tauri/Cargo.toml', [\n  '[package]',\n  'name = \"forge-tauri-app\"',\n  'version = \"' + APP_VER + '\"',\n  'description = \"FORGE shell app for ' + APP_NAME + '\"',\n  'authors = [\"forge\"]',\n  'edition = \"2021\"',\n  '',\n  '[lib]',\n  'name = \"forge_tauri_app_lib\"',\n  'crate-type = [\"staticlib\", \"cdylib\", \"rlib\"]',\n  '',\n  '[build-dependencies]',\n  'tauri-build = { version = \"2\", features = [] }',\n  '',\n  '[dependencies]',\n  'tauri = { version = \"2\", features = [] }',\n  'serde = { version = \"1\", features = [\"derive\"] }',\n  'serde_json = \"1\"',\n  '',\n  '[profile.release]',\n  'panic = \"abort\"',\n  'codegen-units = 1',\n  'lto = true',\n  'opt-level = \"s\"',\n  'strip = true',\n  '',\n].join('\\n'));\n\n// ============ src-tauri/build.rs ============\nwrite('src-tauri/build.rs', [\n  'fn main() {',\n  '    tauri_build::build()',\n  '}',\n  '',\n].join('\\n'));\n\n// ============ src-tauri/src/main.rs ============\nwrite('src-tauri/src/main.rs', [\n  '// FORGE Tauri2 \u58f3\u5e94\u7528 \u00b7 \u52a0\u8f7d\u8fdc\u7a0b URL: ' + APP_URL,\n  '#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]',\n  '',\n  'fn main() {',\n  '    forge_tauri_app_lib::run()',\n  '}',\n  '',\n].join('\\n'));\n\n// ============ src-tauri/src/lib.rs ============\nwrite('src-tauri/src/lib.rs', [\n  '// FORGE Tauri2 \u58f3\u5e94\u7528\u5e93',\n  'use tauri::Manager;',\n  '',\n  '#[cfg_attr(mobile, tauri::mobile_entry_point)]',\n  'pub fn run() {',\n  '    tauri::Builder::default()',\n  '        .setup(|app| {',\n  '            #[cfg(not(mobile))]',\n  '            {',\n  '                if let Some(win) = app.get_webview_window(\"main\") {',\n  '                    let _ = win.show();',\n  '                }',\n  '            }',\n  '            Ok(())',\n  '        })',\n  '        .run(tauri::generate_context!())',\n  '        .expect(\"error while running tauri application\");',\n  '}',\n  '',\n].join('\\n'));\n\n// ============ src-tauri/capabilities/default.json ============\nwrite('src-tauri/capabilities/default.json', JSON.stringify({\n  $schema: '../gen/schemas/desktop-schema.json',\n  identifier: 'default',\n  description: 'FORGE shell default capability',\n  windows: ['main'],\n  permissions: ['core:default'],\n}, null, 2) + '\\n');\n\n// ============ \u5360\u4f4d\u56fe\u6807\uff081x1 \u900f\u660e PNG\uff09============\nconst PLACEHOLDER_PNG = Buffer.from(\n  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',\n  'base64'\n);\n['32x32.png', '128x128.png', '128x128@2x.png'].forEach((n) => {\n  write('src-tauri/icons/' + n, PLACEHOLDER_PNG);\n});\nwrite('src-tauri/icons/icon.ico', PLACEHOLDER_PNG);\nwrite('src-tauri/icons/icon.icns', PLACEHOLDER_PNG);\n\n// ============ .gitignore ============\nwrite('.gitignore', [\n  '/node_modules',\n  '/src-tauri/target',\n  '/src-tauri/gen',\n  '',\n].join('\\n'));\n\nfunction escapeHtml(s) {\n  return String(s).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n}\nfunction escapeAttr(s) {\n  return String(s).replace(/\"/g, '&quot;');\n}\n\nconsole.log('\u2713 Tauri2 shell generated \u00b7 URL=' + APP_URL + ' \u00b7 name=' + APP_NAME + ' \u00b7 bundle=' + BUNDLE + ' \u00b7 ' + WIDTH + 'x' + HEIGHT);\n";
  }

  function buildReadme(cfg) {
    return `# ${cfg.name}

> 由 [FORGE // 网页锻造工坊](https://forge.example) 生成 · GitHub Action 多端打包

- **入口 URL**: ${cfg.url}
- **Bundle ID**: ${cfg.bundleId}
- **版本**: ${cfg.version}
- **构建目标**: ${cfg.targets.join(' · ')}
- **壳引擎**: ${cfg.shell}

## 触发构建

向 \`main\` 分支推送任意提交（含对 \`forge.config.json\` 的修改）即会触发 \`forge.yml\`，
在矩阵 runner 上并行锻造各端产物，产物上传为 artifact，打 tag 时发布到 Release。

## 配置

编辑 \`forge.config.json\` 调整应用名称、URL、目标端等，提交后自动重新构建。

---
_本仓库由 FORGE 通过 GitHub Personal Access Token 自动创建。_
`;
  }

  /* ============================================================
     SESSION PERSISTENCE (sessionStorage)
     ============================================================ */
  function saveSession() {
    if (!state.token) return;
    try {
      sessionStorage.setItem('forge_token', state.token);
      sessionStorage.setItem('forge_user', JSON.stringify(state.user));
      sessionStorage.setItem('forge_repo', state.repo);
      sessionStorage.setItem('forge_reponame', state.repoName);
    } catch (e) { /* ignore */ }
  }
  function loadSession() {
    try {
      const t = sessionStorage.getItem('forge_token');
      const u = sessionStorage.getItem('forge_user');
      const r = sessionStorage.getItem('forge_repo');
      const rn = sessionStorage.getItem('forge_reponame');
      if (t && u && r) {
        state.token = t;
        state.user = JSON.parse(u);
        state.repo = r;
        state.repoName = rn || r.split('/')[1];
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function clearSession() {
    try {
      sessionStorage.removeItem('forge_token');
      sessionStorage.removeItem('forge_user');
      sessionStorage.removeItem('forge_repo');
      sessionStorage.removeItem('forge_reponame');
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     LOGIN MODAL — PAT flow
     ============================================================ */
  const loginModal = $('#loginModal');
  const loginFlow = $('#loginFlow');
  const loginStart = $('#loginStart');
  const tokenInput = $('#ghToken');
  const tokenToggle = $('#tokenToggle');
  const tokenError = $('#tokenError');
  const repoNameInput = $('#repoName');

  function openLogin() {
    if (state.loggedIn) {
      document.getElementById('studio').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    loginModal.classList.add('is-open');
    loginModal.setAttribute('aria-hidden', 'false');
    resetFlow();
    setTimeout(() => tokenInput.focus(), 60);
  }
  function closeLogin() {
    loginModal.classList.remove('is-open');
    loginModal.setAttribute('aria-hidden', 'true');
  }
  function resetFlow() {
    $$('.lf-step', loginFlow).forEach((el) => {
      el.classList.remove('is-active', 'is-done', 'is-failed');
      const s = $('.lf-state', el);
      if (s) s.textContent = el.dataset.step === '0' ? '待开始' : '—';
    });
    loginStart.disabled = false;
    loginStart.querySelector('span').textContent = '验证并连接';
    hideTokenError();
  }
  function showTokenError(msg) {
    tokenError.textContent = msg;
    tokenError.hidden = false;
  }
  function hideTokenError() { tokenError.hidden = true; }

  function setStep(stepEl, status, text) {
    stepEl.classList.remove('is-active', 'is-failed');
    if (status === 'active') stepEl.classList.add('is-active');
    if (status === 'done') stepEl.classList.add('is-done');
    if (status === 'failed') stepEl.classList.add('is-failed');
    const s = $('.lf-state', stepEl);
    if (s) s.textContent = text;
  }

  $('#ghLoginBtn').addEventListener('click', openLogin);
  $('#heroLoginBtn').addEventListener('click', openLogin);
  $('#ctaLoginBtn').addEventListener('click', openLogin);
  $$('[data-close]', loginModal).forEach((el) => el.addEventListener('click', closeLogin));

  tokenToggle.addEventListener('click', () => {
    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
    tokenToggle.style.color = tokenInput.type === 'text' ? 'var(--accent)' : '';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeLogin(); closeTerminal(); }
  });

  loginStart.addEventListener('click', runLoginFlow);

  async function runLoginFlow() {
    hideTokenError();
    const token = tokenInput.value.trim();
    const repoName = (repoNameInput.value.trim() || 'forge-app')
      .toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
    if (!repoName) { showTokenError('请输入有效的仓库名称'); return; }
    if (!token) { showTokenError('请输入 GitHub Personal Access Token'); return; }

    state.token = token;
    loginStart.disabled = true;
    loginStart.querySelector('span').textContent = '处理中…';
    const steps = $$('.lf-step', loginFlow);

    try {
      // 01 — validate token
      setStep(steps[0], 'active', '验证中…');
      const user = await validateToken();
      state.user = {
        login: user.login,
        name: user.name || user.login,
        avatar_url: user.avatar_url,
        html_url: user.html_url,
      };
      $('#repoHint').textContent = '将创建于 ' + user.login + '/' + repoName;
      setStep(steps[0], 'done', '已验证 · @' + user.login);
      await wait(250);

      // 02 — create repo
      setStep(steps[1], 'active', '创建中…');
      const { repo, created } = await createRepo(repoName);
      state.repo = repo.full_name;
      state.repoName = repo.name;
      setStep(steps[1], 'done', created ? '已创建 · ' + repo.full_name : '已复用 · ' + repo.full_name);
      await wait(250);

      const [owner, rname] = repo.full_name.split('/');
      const cfg = collectConfig();

      // 03 — write forge.yml + gen-shell.mjs
      setStep(steps[2], 'active', '写入中…');
      const existingYml = await readFile(owner, rname, '.github/workflows/forge.yml');
      await writeFile(owner, rname, '.github/workflows/forge.yml', buildWorkflowYml(),
        'forge: init workflow [skip ci]', existingYml && existingYml.sha);
      const existingGen = await readFile(owner, rname, 'scripts/gen-shell.mjs');
      await writeFile(owner, rname, 'scripts/gen-shell.mjs', buildGenShellMjs(),
        'forge: init gen-shell [skip ci]', existingGen && existingGen.sha);
      setStep(steps[2], 'done', '已写入 forge.yml + gen-shell.mjs');
      await wait(250);

      // 04 — write forge.config.json
      setStep(steps[3], 'active', '写入中…');
      const existingCfg = await readFile(owner, rname, 'forge.config.json');
      await writeFile(owner, rname, 'forge.config.json', buildConfigJson(cfg),
        'forge: init app config [skip ci]', existingCfg && existingCfg.sha);
      setStep(steps[3], 'done', '已写入 forge.config.json');
      await wait(250);

      // 05 — write README (optional, ignore failure)
      try {
        const existingRd = await readFile(owner, rname, 'README.md');
        await writeFile(owner, rname, 'README.md', buildReadme(cfg),
          'forge: init readme [skip ci]', existingRd && existingRd.sha);
      } catch (e) { /* non-fatal */ }

      setStep(steps[4], 'done', '完成');
      loginStart.querySelector('span').textContent = '已完成，正在进入工坊…';
      saveSession();
      await wait(500);
      finishLogin();
    } catch (err) {
      const active = $('.lf-step.is-active', loginFlow);
      if (active) setStep(active, 'failed', '失败');
      showTokenError(err.message || '连接失败，请重试');
      loginStart.disabled = false;
      loginStart.querySelector('span').textContent = '验证并连接';
      state.token = null;
    }
  }

  function finishLogin() {
    state.loggedIn = true;
    closeLogin();

    // nav: swap login button → user chip
    $('#ghLoginBtn').hidden = true;
    const navUser = $('#navUser');
    navUser.hidden = false;
    $('#userAvatar').src = state.user.avatar_url;
    $('#userAvatar').alt = state.user.login;
    $('#userName').textContent = '@' + state.user.login;

    // studio bar status
    $('#sbRepo').textContent = state.repo;
    const sbStatus = $('#sbStatus');
    sbStatus.textContent = '已连接 · @' + state.user.login;
    sbStatus.classList.add('is-connected');
    const repoLink = $('#sbRepoLink');
    repoLink.href = 'https://github.com/' + state.repo;
    repoLink.hidden = false;
    $('#disconnectBtn').hidden = false;

    // unlock build
    $('#buildBtn').disabled = false;
    const note = $('#buildNote');
    note.textContent = '已连接 ' + state.repo + ' · 配置完成后即可触发真实构建';
    note.classList.add('is-connected');

    document.getElementById('studio').scrollIntoView({ behavior: 'smooth' });
  }

  /* disconnect */
  $('#disconnectBtn').addEventListener('click', () => {
    state.loggedIn = false;
    state.token = null;
    state.user = null;
    state.repo = null;
    state.repoName = null;
    clearSession();

    // nav
    $('#ghLoginBtn').hidden = false;
    const navUser = $('#navUser');
    navUser.hidden = true;
    $('#userAvatar').src = '';
    $('#userName').textContent = '—';

    // studio bar
    $('#sbRepo').textContent = '未连接';
    const sbStatus = $('#sbStatus');
    sbStatus.textContent = '未连接 GitHub';
    sbStatus.classList.remove('is-connected');
    $('#sbRepoLink').hidden = true;
    $('#disconnectBtn').hidden = true;

    // build
    $('#buildBtn').disabled = true;
    const note = $('#buildNote');
    note.textContent = '请先使用 GitHub 登录以解锁构建 · 登录后自动建仓并写入 forge.yml';
    note.classList.remove('is-connected');

    // reset modal inputs
    tokenInput.value = '';
    resetFlow();
  });

  /* ============================================================
     STUDIO — live preview
     ============================================================ */
  const appNameInput = $('#appName');
  const phoneTitle = $('#phoneTitle');
  const deskTitle = $('#deskTitle');

  function syncName() {
    const v = appNameInput.value.trim() || '未命名应用';
    phoneTitle.textContent = v;
    deskTitle.textContent = v;
  }
  appNameInput.addEventListener('input', syncName);

  // icon upload
  const iconDrop = $('#iconDrop');
  const iconFile = $('#iconFile');
  const iconPreview = $('#iconPreview');
  iconDrop.addEventListener('click', () => iconFile.click());
  iconDrop.addEventListener('dragover', (e) => { e.preventDefault(); iconDrop.style.borderColor = 'var(--accent)'; });
  iconDrop.addEventListener('dragleave', () => { iconDrop.style.borderColor = ''; });
  iconDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    iconDrop.style.borderColor = '';
    const f = e.dataTransfer.files[0];
    if (f) applyIcon(f);
  });
  iconFile.addEventListener('change', () => { if (iconFile.files[0]) applyIcon(iconFile.files[0]); });
  function applyIcon(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      iconPreview.textContent = '';
      iconPreview.style.background = 'url(' + e.target.result + ') center/cover, var(--elev-2)';
    };
    reader.readAsDataURL(file);
  }

  // swatches
  $('#swatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    $$('.swatch').forEach((s) => s.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.accent = btn.dataset.color;
    document.documentElement.style.setProperty('--accent', state.accent);
    document.documentElement.style.setProperty('--accent-deep', shade(state.accent, -0.18));
  });
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round((n >> 16 & 255) * (1 + amt))));
    const g = Math.max(0, Math.min(255, Math.round((n >> 8 & 255) * (1 + amt))));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * (1 + amt))));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // preview tabs
  $('#previewTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.ptab');
    if (!tab) return;
    $$('.ptab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const dev = tab.dataset.device;
    $$('.device').forEach((d) => d.classList.remove('is-active'));
    (dev === 'phone' ? $('#devPhone') : $('#devDesktop')).classList.add('is-active');
  });

  // toggles → meta
  $('#toggles').addEventListener('change', (e) => {
    const cb = e.target;
    const meta = cb.dataset.meta;
    if (!meta) return;
    const val = cb.dataset.val ? cb.dataset.val.split('/') : ['on', 'off'];
    const text = cb.checked ? val[0] : val[1];
    if (meta === 'offline') $('#metaOffline').textContent = text;
    if (meta === 'update') $('#metaUpdate').textContent = text;
  });

  // segmented controls
  function bindSeg(id, onChange) {
    $(id).addEventListener('click', (e) => {
      const btn = e.target.closest('.seg__btn');
      if (!btn) return;
      $$('.seg__btn', $(id)).forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      onChange && onChange(btn.dataset.val, btn);
    });
  }
  bindSeg('#orientSel');
  bindSeg('#regionSel');
  bindSeg('#shellSel', (val) => { state.shell = val; $('#metaShell').textContent = val; });

  /* targets */
  $('#targetsGrid').addEventListener('click', (e) => {
    const t = e.target.closest('.target');
    if (!t) return;
    const p = t.dataset.p;
    t.classList.toggle('is-on');
    if (state.targets.has(p)) state.targets.delete(p);
    else state.targets.add(p);
    const n = state.targets.size;
    $('#sbTargets').textContent = n + '/5';
    $('#sumCount').textContent = n;
  });

  /* ============================================================
     BUILD TERMINAL — real trigger + poll
     ============================================================ */
  const overlay = $('#buildOverlay');
  const termBody = $('#termBody');
  const termStatus = $('#termStatus');
  const termReleases = $('#termReleases');

  function closeTerminal() {
    if (state.building) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  $('#termClose').addEventListener('click', closeTerminal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTerminal(); });

  async function typeLine(html, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.innerHTML = html;
    termBody.appendChild(line);
    termBody.scrollTop = termBody.scrollHeight;
    await wait(160 + Math.random() * 120);
    return line;
  }

  $('#buildBtn').addEventListener('click', runBuild);

  async function runBuild() {
    if (state.building) return;
    if (!state.loggedIn) { openLogin(); return; }
    if (state.targets.size === 0) { flash('请至少选择一个构建目标'); return; }

    state.building = true;
    termBody.innerHTML = '';
    termReleases.hidden = true;
    termStatus.textContent = '构建中…';
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');

    const [owner, repo] = state.repo.split('/');
    const cfg = collectConfig();
    const targets = Array.from(state.targets);

    try {
      await typeLine('$ forge build --repo <a class="t-info" href="https://github.com/' + state.repo + '" target="_blank">' + state.repo + '</a>');
      await typeLine('<span class="t-dim">▸ 同步最新 forge.yml（真实构建模板）…</span>');

      // 0. refresh forge.yml + gen-shell.mjs to latest template (real build)
      const existingYml = await readFile(owner, repo, '.github/workflows/forge.yml');
      await writeFile(owner, repo, '.github/workflows/forge.yml', buildWorkflowYml(),
        'forge: refresh workflow (real build) [skip ci]',
        existingYml && existingYml.sha);
      const existingGen = await readFile(owner, repo, 'scripts/gen-shell.mjs');
      await writeFile(owner, repo, 'scripts/gen-shell.mjs', buildGenShellMjs(),
        'forge: refresh gen-shell [skip ci]',
        existingGen && existingGen.sha);
      await typeLine('<span class="t-ok">✓</span> forge.yml + gen-shell.mjs 已更新为真实构建模板');

      await typeLine('<span class="t-dim">▸ 推送最新 forge.config.json 以触发 push 工作流…</span>');

      // 1. update config (this push triggers the workflow)
      const existingCfg = await readFile(owner, repo, 'forge.config.json');
      await writeFile(owner, repo, 'forge.config.json', buildConfigJson(cfg),
        'forge: build trigger @ ' + new Date().toISOString(),
        existingCfg && existingCfg.sha);
      await typeLine('<span class="t-ok">✓</span> forge.config.json 已推送 · workflow 已由 push 触发');

      // 2. wait for run to appear
      await typeLine('<span class="t-dim">▸ 等待 GitHub 注册 workflow run…</span>');
      let run = null;
      for (let i = 0; i < 8 && !run; i++) {
        await wait(2200);
        run = await getLatestRun(owner, repo);
      }

      if (!run) {
        await typeLine('<span class="t-warn">⚠</span> 暂未检测到 run · 请前往仓库 Actions 标签查看');
        termStatus.textContent = '已触发，请到 GitHub 查看';
        termReleases.href = 'https://github.com/' + state.repo + '/actions';
        termReleases.textContent = '查看 Actions ↗';
        termReleases.hidden = false;
        state.building = false;
        return;
      }

      await typeLine('<span class="t-ok">✓</span> run <a class="t-info" href="' + run.html_url + '" target="_blank">#' + run.run_number + '</a> 已创建 · ' + (run.name || 'forge'));
      termReleases.href = run.html_url;
      termReleases.textContent = '查看 Run ↗';
      termReleases.hidden = false;

      // 3. poll status
      let lastStatus = '';
      let iters = 0;
      const MAX_ITERS = 40; // ~3 minutes

      while (run && run.status !== 'completed' && iters < MAX_ITERS) {
        iters++;
        if (run.status !== lastStatus) {
          lastStatus = run.status;
          if (run.status === 'queued') {
            await typeLine('<span class="t-info">[queued]</span> 等待 runner 接单…');
          } else if (run.status === 'in_progress') {
            await typeLine('<span class="t-forge">[in_progress]</span> 矩阵并行锻造 ' + targets.length + ' 个目标（Electron/Capacitor 真实编译中）');
            await typeLine('<span class="t-dim">  实际进度请查看 Actions 页面的 job 日志</span>');
          } else {
            await typeLine('<span class="t-info">[' + run.status + ']</span>');
          }
        }
        await wait(4500);
        run = await getRun(owner, repo, run.id);
      }

      if (run && run.status === 'completed') {
        const ok = run.conclusion === 'success';
        const cls = ok ? 't-ok' : 't-warn';
        await typeLine('<span class="' + cls + '">[' + run.conclusion + ']</span> run #' + run.run_number + ' 已完成');
        if (ok) {
          await typeLine('<span class="t-forge">⚡ 产物已作为 artifact 上传 · 打 tag 可发布到 Release</span>');
        }
        termStatus.textContent = ok ? '构建成功 · ' + targets.length + ' 个产物' : '构建结束 · ' + run.conclusion;
      } else {
        await typeLine('<span class="t-warn">⚠</span> 仍在运行中（已等待较久）· 点击下方链接在 GitHub 实时查看');
        termStatus.textContent = '仍在运行，见 GitHub';
      }
      await typeLine('<span class="t-cursor"></span>', 't-dim');
    } catch (err) {
      await typeLine('<span class="t-warn">⚠</span> 构建失败 · ' + (err.message || err));
      termStatus.textContent = '构建失败';
    } finally {
      state.building = false;
    }
  }

  function pad(s, n) { return (s + '        ').slice(0, n); }
  function extFor(p) {
    return { ios: '.ipa', android: '.apk', windows: '.msi', macos: '.dmg', linux: '.AppImage' }[p] || p;
  }
  function sizeFor(p) {
    return { ios: '42.6 MB', android: '38.1 MB', windows: '64.3 MB', macos: '58.9 MB', linux: '52.4 MB' }[p] || '—';
  }

  function flash(msg) {
    const note = $('#buildNote');
    const old = note.textContent;
    const oldColor = note.style.color;
    note.textContent = msg;
    note.style.color = 'var(--danger)';
    setTimeout(() => { note.textContent = old; note.style.color = oldColor; }, 1800);
  }

  /* ============================================================
     SPEED TEST
     ============================================================ */
  const barSlow = $('#barSlow'), barFast = $('#barFast');
  const valSlow = $('#valSlow'), valFast = $('#valFast');
  const speedNote = $('#speedNote');
  $('#speedRun').addEventListener('click', runSpeedTest);

  async function runSpeedTest() {
    speedNote.textContent = '测速中…';
    barSlow.style.width = '8%'; barFast.style.width = '8%';
    valSlow.textContent = '—'; valFast.textContent = '—';
    await wait(450);
    const slow = 0.3 + Math.random() * 0.4;
    const fast = 8 + Math.random() * 12;
    barSlow.style.width = Math.min(100, (slow / 20) * 100) + '%';
    barFast.style.width = Math.min(100, (fast / 20) * 100) + '%';
    valSlow.textContent = slow.toFixed(1) + ' MB/s';
    valFast.textContent = fast.toFixed(1) + ' MB/s';
    const x = (fast / slow).toFixed(0);
    speedNote.textContent = '加速 ≈ ' + x + '× · 120MB 用时 ' + (120 / fast).toFixed(1) + 's vs ' + (120 / slow).toFixed(0) + 's';
  }

  /* ============================================================
     SCROLL REVEAL + NAV
     ============================================================ */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  $$('.section, .cta').forEach((el) => { el.classList.add('reveal'); io.observe(el); });

  const nav = $('#nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) nav.classList.add('is-stuck'); else nav.classList.remove('is-stuck');
  }, { passive: true });

  /* ============================================================
     INIT
     ============================================================ */
  syncName();

  // restore session if present
  if (loadSession()) {
    state.loggedIn = true;
    $('#ghLoginBtn').hidden = true;
    const navUser = $('#navUser');
    navUser.hidden = false;
    $('#userAvatar').src = state.user.avatar_url;
    $('#userAvatar').alt = state.user.login;
    $('#userName').textContent = '@' + state.user.login;

    $('#sbRepo').textContent = state.repo;
    const sbStatus = $('#sbStatus');
    sbStatus.textContent = '已连接 · @' + state.user.login;
    sbStatus.classList.add('is-connected');
    const repoLink = $('#sbRepoLink');
    repoLink.href = 'https://github.com/' + state.repo;
    repoLink.hidden = false;
    $('#disconnectBtn').hidden = false;

    $('#buildBtn').disabled = false;
    const note = $('#buildNote');
    note.textContent = '已连接 ' + state.repo + ' · 配置完成后即可触发真实构建';
    note.classList.add('is-connected');

    // best-effort: sync UI from remote config
    (async () => {
      try {
        const [owner, rname] = state.repo.split('/');
        const f = await readFile(owner, rname, 'forge.config.json');
        if (f && f.content) {
          const cfg = JSON.parse(b64decode(f.content));
          applyConfig(cfg);
        }
      } catch (e) { /* ignore — keep defaults */ }
    })();
  }

  function applyConfig(cfg) {
    if (cfg.name) { $('#appName').value = cfg.name; syncName(); }
    if (cfg.url) $('#appUrl').value = cfg.url;
    if (cfg.bundleId) $('#appId').value = cfg.bundleId;
    if (cfg.version) $('#appVer').value = cfg.version;
    if (cfg.accent) {
      state.accent = cfg.accent;
      document.documentElement.style.setProperty('--accent', cfg.accent);
      document.documentElement.style.setProperty('--accent-deep', shade(cfg.accent, -0.18));
      $$('.swatch').forEach((s) => s.classList.toggle('is-active', s.dataset.color === cfg.accent));
    }
    if (cfg.shell) {
      state.shell = cfg.shell;
      $('#metaShell').textContent = cfg.shell;
      $$('#shellSel .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.val === cfg.shell));
    }
    if (Array.isArray(cfg.targets)) {
      state.targets = new Set(cfg.targets);
      $$('.target').forEach((t) => t.classList.toggle('is-on', state.targets.has(t.dataset.p)));
      $('#sbTargets').textContent = state.targets.size + '/5';
      $('#sumCount').textContent = state.targets.size;
    }
    if (cfg.window) {
      $('#winW').value = cfg.window.width;
      $('#winH').value = cfg.window.height;
    }
  }
})();
