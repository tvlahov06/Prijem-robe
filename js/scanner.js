const Scanner = {
  _audioCtx: null, _onScan: null, _inputEl: null, _bannerEl: null, _bannerTimer: null,

  init(inputSel, bannerSel, onScan) {
    this._inputEl = document.querySelector(inputSel);
    this._bannerEl = document.querySelector(bannerSel);
    this._onScan = onScan;
    if (!this._inputEl) return;
    this._inputEl.focus();

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.qty-input-inline, button, a, select, input, .btn')) this._inputEl.focus();
    });

    this._inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const bc = this._inputEl.value.trim(); if (bc) { const r = this._onScan(bc); this._showBanner(r); } this._inputEl.value = ''; }
    });
  },

  _showBanner(r) {
    if (!this._bannerEl) return;
    clearTimeout(this._bannerTimer);
    let html = '', cls = '';
    if (r.status === 'ok') { cls = 'success'; html = `<div class="banner-icon">✓</div><div class="banner-text"><h4>${r.naziv}</h4><p>${r.skenirano} / ${r.ocekivano} kom</p></div>`; this._beep('ok'); }
    else if (r.status === 'complete') { cls = 'success'; html = `<div class="banner-icon">★</div><div class="banner-text"><h4>${r.naziv}</h4><p>KOMPLET — ${r.skenirano} / ${r.ocekivano} kom</p></div>`; this._beep('complete'); }
    else if (r.status === 'over') { cls = 'warning'; html = `<div class="banner-icon">!</div><div class="banner-text"><h4>VIŠAK: ${r.naziv}</h4><p>${r.skenirano} / ${r.ocekivano} kom</p></div>`; this._beep('warning'); }
    else if (r.status === 'not_found') { cls = 'error'; html = `<div class="banner-icon">✗</div><div class="banner-text"><h4>Barkod nije na popisu!</h4><p>${r.barcode}</p></div>`; this._beep('error'); }
    this._bannerEl.className = `scan-banner ${cls}`; this._bannerEl.innerHTML = html;
    this._bannerTimer = setTimeout(() => { this._bannerEl.className = 'scan-banner'; this._bannerEl.innerHTML = ''; }, 3500);
  },

  _beep(type) {
    try {
      if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const c = this._audioCtx, o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination);
      if (type === 'ok') { o.frequency.value = 880; o.type = 'sine'; g.gain.value = .25; o.start(); o.stop(c.currentTime + .1); }
      else if (type === 'complete') { o.frequency.value = 1000; o.type = 'sine'; g.gain.value = .25; o.start(); o.stop(c.currentTime + .1); setTimeout(() => { const o2 = c.createOscillator(), g2 = c.createGain(); o2.connect(g2); g2.connect(c.destination); o2.frequency.value = 1300; o2.type = 'sine'; g2.gain.value = .25; o2.start(); o2.stop(c.currentTime + .15); }, 150); }
      else if (type === 'warning') { o.frequency.value = 600; o.type = 'triangle'; g.gain.value = .3; o.start(); o.stop(c.currentTime + .3); }
      else if (type === 'error') { o.frequency.value = 300; o.type = 'square'; g.gain.value = .15; o.start(); o.stop(c.currentTime + .4); }
    } catch {}
  },

  refocus() { if (this._inputEl) { this._inputEl.value = ''; this._inputEl.focus(); } }
};
