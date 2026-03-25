const GitHubStorage = {
  _token: null, _repo: 'Prijem-robe', _owner: null,

  init() {
    this._token = localStorage.getItem('gh_token');
    this._repo = localStorage.getItem('gh_repo') || 'Prijem-robe';
    this._owner = localStorage.getItem('gh_owner') || '';
  },

  isConfigured() { return !!(this._token && this._owner && this._repo); },

  async saveToken(token) {
    // Auto-detect owner from token
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error('Neispravan token');
    const user = await res.json();
    this._token = token;
    this._owner = user.login;
    this._repo = 'Prijem-robe';
    localStorage.setItem('gh_token', token);
    localStorage.setItem('gh_owner', this._owner);
    localStorage.setItem('gh_repo', this._repo);
    return this._owner;
  },

  getConfig() { return { token: this._token, owner: this._owner, repo: this._repo }; },

  clearConfig() {
    this._token = null; this._owner = null;
    localStorage.removeItem('gh_token'); localStorage.removeItem('gh_owner');
  },

  async _api(endpoint, method = 'GET', body = null) {
    const url = `https://api.github.com/repos/${this._owner}/${this._repo}${endpoint}`;
    const headers = { 'Authorization': `token ${this._token}`, 'Accept': 'application/vnd.github.v3+json' };
    if (body) headers['Content-Type'] = 'application/json';
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok && res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API: ${res.status}`);
    }
    if (res.status === 404) return null;
    return res.json();
  },

  async readFile(path) {
    const data = await this._api(`/contents/${path}`);
    if (!data) return null;
    try { return { content: JSON.parse(atob(data.content.replace(/\n/g, ''))), sha: data.sha }; }
    catch { return null; }
  },

  async writeFile(path, content, message, sha = null) {
    const body = { message: message || `Update ${path}`, content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))) };
    if (sha) body.sha = sha;
    return this._api(`/contents/${path}`, 'PUT', body);
  },

  async deleteFile(path, sha, message) {
    return this._api(`/contents/${path}`, 'DELETE', { message: message || `Delete ${path}`, sha });
  },

  async listFiles(path) {
    const data = await this._api(`/contents/${path}`);
    if (!data || !Array.isArray(data)) return [];
    return data.map(f => ({ name: f.name, path: f.path, type: f.type, sha: f.sha }));
  },

  async testConnection() {
    try {
      const res = await fetch(`https://api.github.com/repos/${this._owner}/${this._repo}`, {
        headers: { 'Authorization': `token ${this._token}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      return res.ok;
    } catch { return false; }
  },

  async ensureDataStructure() {
    const existing = await this.readFile('data/poslovnice.json');
    if (!existing) {
      await this.writeFile('data/poslovnice.json', {
        poslovnice: [
          { id: 'split-cco', naziv: 'BB Split CCO', pin: '4020' },
          { id: 'zadar', naziv: 'BB Zadar', pin: '4050' }
        ]
      }, 'Init');
    }
  }
};
GitHubStorage.init();
