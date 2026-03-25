const Auth = {
  _session: null,
  init() { const s = sessionStorage.getItem('prijem_session'); if (s) try { this._session = JSON.parse(s); } catch {} },
  isLoggedIn() { return !!this._session; },
  getSession() { return this._session; },
  getPoslovnica() { return this._session?.poslovnica; },
  getPoslovnicaId() { return this._session?.poslovnicaId; },
  async login(id, pin) {
    const data = await GitHubStorage.readFile('data/poslovnice.json');
    if (!data) throw new Error('Ne mogu dohvatiti poslovnice');
    const p = data.content.poslovnice.find(p => p.id === id);
    if (!p) throw new Error('Poslovnica nije pronađena');
    if (p.pin !== pin) throw new Error('Pogrešan PIN');
    this._session = { poslovnicaId: p.id, poslovnica: p.naziv, loginTime: new Date().toISOString() };
    sessionStorage.setItem('prijem_session', JSON.stringify(this._session));
  },
  logout() { this._session = null; sessionStorage.removeItem('prijem_session'); window.location.href = 'index.html'; },
  requireAuth() { if (!this.isLoggedIn()) { window.location.href = 'index.html'; return false; } return true; }
};
Auth.init();
