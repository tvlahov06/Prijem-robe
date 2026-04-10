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
      const c = this._audioCtx;
      if (c.state === 'suspended') c.resume();
      const t = c.currentTime;

      if (type === 'ok') {
        // Single short high beep
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.frequency.value = 1200; o.type = 'sine'; g.gain.value = 0.3;
        o.start(t); o.stop(t + 0.08);
      }
      else if (type === 'complete') {
        // Three ascending tones - celebratory
        [1000, 1300, 1600].forEach(function(freq, i) {
          var o = c.createOscillator(), g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.frequency.value = freq; o.type = 'sine'; g.gain.value = 0.3;
          o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.1);
        });
      }
      else if (type === 'warning') {
        // Two medium tones - attention
        [800, 800].forEach(function(freq, i) {
          var o = c.createOscillator(), g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.frequency.value = freq; o.type = 'triangle'; g.gain.value = 0.35;
          o.start(t + i * 0.2); o.stop(t + i * 0.2 + 0.15);
        });
      }
      else if (type === 'error') {
        // Three fast descending harsh tones - clearly bad
        [900, 700, 500].forEach(function(freq, i) {
          var o = c.createOscillator(), g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.frequency.value = freq; o.type = 'square'; g.gain.value = 0.2;
          o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.1);
        });
      }
    } catch(e) {}
  },

  refocus() { if (this._inputEl) { this._inputEl.value = ''; this._inputEl.focus(); } }
};
