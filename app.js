/* ============================================================
   FORGE // app.js — interactions
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- state ---------- */
  const state = {
    loggedIn: false,
    user: null,
    repo: null,
    targets: new Set(['ios', 'android', 'windows', 'macos', 'linux']),
    accent: '#c6ff3a',
    shell: 'capacitor',
    building: false,
  };

  /* ============================================================
     LOGIN MODAL + simulated GitHub OAuth
     ============================================================ */
  const loginModal = $('#loginModal');
  const loginFlow = $('#loginFlow');
  const loginStart = $('#loginStart');

  function openLogin() {
    if (state.loggedIn) {
      document.getElementById('studio').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    loginModal.classList.add('is-open');
    loginModal.setAttribute('aria-hidden', 'false');
    resetFlow();
  }
  function closeLogin() {
    loginModal.classList.remove('is-open');
    loginModal.setAttribute('aria-hidden', 'true');
  }
  function resetFlow() {
    $$('.lf-step', loginFlow).forEach((el) => {
      el.classList.remove('is-active', 'is-done');
      const stateEl = $('.lf-state', el);
      if (stateEl) stateEl.textContent = el.dataset.step === '0' ? '待开始' : '—';
    });
    loginStart.disabled = false;
    loginStart.querySelector('span').textContent = '授权并开始';
  }

  $('#ghLoginBtn').addEventListener('click', openLogin);
  $('#heroLoginBtn').addEventListener('click', openLogin);
  $('#ctaLoginBtn').addEventListener('click', openLogin);
  $$('[data-close]', loginModal).forEach((el) => el.addEventListener('click', closeLogin));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeLogin(); closeTerminal(); }
  });

  loginStart.addEventListener('click', async () => {
    loginStart.disabled = true;
    const steps = $$('.lf-step', loginFlow);
    const labels = ['授权中…', '创建仓库…', '写入 workflow…', '注入加速…', '完成'];
    for (let i = 0; i < steps.length; i++) {
      steps.forEach((s) => s.classList.remove('is-active'));
      const prev = steps[i - 1];
      if (prev) { prev.classList.add('is-done'); $('.lf-state', prev).textContent = '完成'; }
      const cur = steps[i];
      cur.classList.add('is-active');
      $('.lf-state', cur).textContent = labels[i];
      loginStart.querySelector('span').textContent = labels[i];
      await wait(620 + Math.random() * 360);
    }
    steps.forEach((s) => s.classList.remove('is-active'));
    steps[steps.length - 1].classList.add('is-done');
    $('.lf-state', steps[steps.length - 1]).textContent = '完成';
    loginStart.querySelector('span').textContent = '已完成，正在进入工坊…';
    await wait(700);
    finishLogin();
  });

  function finishLogin() {
    state.loggedIn = true;
    state.user = { login: 'forge-builder', name: 'Forge Builder' };
    state.repo = 'forge-app/my-app';

    // swap nav button → user chip
    $('#ghLoginBtn').hidden = true;
    const navUser = $('#navUser');
    navUser.hidden = false;
    $('#userAvatar').src = 'https://avatars.githubusercontent.com/u/9919?v=4';
    $('#userAvatar').alt = state.user.login;
    $('#userName').textContent = '@' + state.user.login;

    // studio status
    $('#sbRepo').textContent = state.repo;
    const sbStatus = $('#sbStatus');
    sbStatus.textContent = '已连接 · ' + state.user.login;
    sbStatus.classList.add('is-connected');

    // unlock build
    $('#buildBtn').disabled = false;
    const note = $('#buildNote');
    note.textContent = '已连接 ' + state.repo + ' · 配置完成后即可触发构建';
    note.classList.add('is-connected');

    closeLogin();
    document.getElementById('studio').scrollIntoView({ behavior: 'smooth' });
  }

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
      iconPreview.style.backgroundImage = 'url(' + e.target.result + ')';
      iconPreview.textContent = '';
      iconPreview.style.background = 'url(' + e.target.result + ') center/cover';
    };
    reader.readAsDataURL(file);
  }

  // swatches — change accent globally
  $('#swatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    $$('.swatch').forEach((s) => s.classList.remove('is-active'));
    btn.classList.add('is-active');
    const c = btn.dataset.color;
    state.accent = c;
    document.documentElement.style.setProperty('--accent', c);
    // recompute accent-deep roughly
    document.documentElement.style.setProperty('--accent-deep', shade(c, -0.18));
  });
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amt * (amt < 0 ? 0 : 0) + (amt < 0 ? r * amt : 0));
    g = Math.round(g + (255 - g) * amt * (amt < 0 ? 0 : 0) + (amt < 0 ? g * amt : 0));
    b = Math.round(b + (255 - b) * amt * (amt < 0 ? 0 : 0) + (amt < 0 ? b * amt : 0));
    if (amt < 0) { r = Math.round((n >> 16 & 255) * (1 + amt)); g = Math.round((n >> 8 & 255) * (1 + amt)); b = Math.round((n & 255) * (1 + amt)); }
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
    if (dev === 'phone') $('#devPhone').classList.add('is-active');
    else $('#devDesktop').classList.add('is-active');
  });

  // toggles → meta
  $('#toggles').addEventListener('change', (e) => {
    const cb = e.target;
    const meta = cb.dataset.meta;
    if (!meta) return;
    const val = cb.dataset.val ? cb.dataset.val.split('/') : ['on', 'off'];
    const text = cb.checked ? val[0] : val[1];
    const map = { offline: 'metaOffline', update: 'metaUpdate' };
    if (map[meta]) $('#' + map[meta]).textContent = text;
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
  bindSeg('#shellSel', (val, btn) => {
    state.shell = val;
    $('#metaShell').textContent = val;
  });

  /* ============================================================
     TARGETS — build matrix
     ============================================================ */
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
     BUILD TERMINAL
     ============================================================ */
  const overlay = $('#buildOverlay');
  const termBody = $('#termBody');
  const termStatus = $('#termStatus');
  const termReleases = $('#termReleases');

  function closeTerminal() {
    if (state.building) return; // don't close mid-build
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  $('#termClose').addEventListener('click', closeTerminal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTerminal(); });

  async function typeLine(html, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    termBody.appendChild(line);
    // parse simple html by setting innerHTML
    line.innerHTML = html;
    termBody.scrollTop = termBody.scrollHeight;
    await wait(180 + Math.random() * 140);
    return line;
  }

  $('#buildBtn').addEventListener('click', async () => {
    if (state.building) return;
    if (!state.loggedIn) { openLogin(); return; }
    if (state.targets.size === 0) { flash('请至少选择一个构建目标'); return; }

    state.building = true;
    termBody.innerHTML = '';
    termReleases.hidden = true;
    termStatus.textContent = '构建中…';
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');

    const targets = Array.from(state.targets);
    const app = appNameInput.value.trim() || 'my-app';
    const ver = $('#appVer').value.trim() || '1.0.0';

    await typeLine('$ forge build --repo <span class="t-info">' + state.repo + '</span> --targets ' + targets.join(','), '');
    await typeLine('<span class="t-dim">▸ triggering github actions workflow…</span>');
    await typeLine('<span class="t-ok">✓</span> workflow run #42 dispatched · <span class="t-dim">main@' + shortSha() + '</span>');
    await typeLine('<span class="t-dim">▸ clone via gitclone mirror (cn) — accelerated</span>');
    await typeLine('<span class="t-ok">✓</span> checkout complete in 3.1s');
    await typeLine('<span class="t-info">▸ setup: node 20 · rust 1.78 · jdk 17 · xcode 15</span>');
    await typeLine('<span class="t-ok">✓</span> webview shell injected · ' + state.shell + ' · icon set');
    await typeLine('<span class="t-forge">⟡ matrix build — ' + targets.length + ' targets in parallel</span>');

    for (const t of targets) {
      await wait(420 + Math.random() * 380);
      await typeLine('  <span class="t-dim">└</span> ' + pad(t, 8) + ' <span class="t-ok">built</span> ' + extFor(t) + ' · ' + sizeFor(t), 't-dim');
    }

    await typeLine('<span class="t-ok">✓</span> signing / notarization complete');
    await typeLine('<span class="t-warn">⚠</span> ios ad-hoc only — set signing secrets for App Store');
    await typeLine('<span class="t-info">▸ uploading release assets…</span>');
    await typeLine('<span class="t-ok">✓</span> published Release <span class="t-info">v' + ver + '</span> · ' + app);
    await typeLine('<span class="t-forge">⚡ CDN + mirror links generated · download 5–20× faster</span>');
    await typeLine('<span class="t-ok">✓</span> done in 6m 41s', '');
    await typeLine('<span class="t-cursor"></span>', 't-dim');

    termStatus.textContent = '构建成功 · ' + targets.length + ' 个产物';
    termReleases.hidden = false;
    state.building = false;
  });

  function shortSha() { return Math.random().toString(16).slice(2, 9); }
  function pad(s, n) { return (s + '        ').slice(0, n); }
  function extFor(p) {
    return { ios: 'my-app.ipa', android: 'my-app.apk', windows: 'my-app.msi', macos: 'my-app.dmg', linux: 'my-app.AppImage' }[p] || p;
  }
  function sizeFor(p) {
    return { ios: '42.6 MB', android: '38.1 MB', windows: '64.3 MB', macos: '58.9 MB', linux: '52.4 MB' }[p] || '—';
  }

  // simple flash note
  function flash(msg) {
    const note = $('#buildNote');
    const old = note.textContent;
    note.textContent = msg;
    note.style.color = 'var(--danger)';
    setTimeout(() => { note.textContent = old; note.style.color = ''; }, 1800);
  }

  /* ============================================================
     SPEED TEST
     ============================================================ */
  const barSlow = $('#barSlow'), barFast = $('#barFast');
  const valSlow = $('#valSlow'), valFast = $('#valFast');
  const speedNote = $('#speedNote');
  $('#speedRun').addEventListener('click', () => runSpeedTest());

  async function runSpeedTest() {
    speedNote.textContent = '测速中…';
    barSlow.style.width = '8%'; barFast.style.width = '8%';
    valSlow.textContent = '—'; valFast.textContent = '—';
    await wait(450);
    const slow = 0.3 + Math.random() * 0.4;       // 0.3–0.7 MB/s
    const fast = 8 + Math.random() * 12;          // 8–20 MB/s
    // scale: 20MB/s = 100%
    barSlow.style.width = Math.min(100, (slow / 20) * 100) + '%';
    barFast.style.width = Math.min(100, (fast / 20) * 100) + '%';
    valSlow.textContent = slow.toFixed(1) + ' MB/s';
    valFast.textContent = fast.toFixed(1) + ' MB/s';
    const x = (fast / slow).toFixed(0);
    speedNote.textContent = '加速 ≈ ' + x + '× · 120MB 用时 ' + (120 / fast).toFixed(1) + 's vs ' + (120 / slow).toFixed(0) + 's';
  }

  /* ============================================================
     SCROLL REVEAL
     ============================================================ */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  $$('.section, .cta').forEach((el) => {
    el.classList.add('reveal');
    io.observe(el);
  });

  /* ============================================================
     NAV scroll state
     ============================================================ */
  const nav = $('#nav');
  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > 20) nav.classList.add('is-stuck'); else nav.classList.remove('is-stuck');
    lastY = y;
  }, { passive: true });

  /* init */
  syncName();
})();
