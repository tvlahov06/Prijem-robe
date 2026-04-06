var Auth = {
  _session: null,
  init: function() { var s = localStorage.getItem("prijem_session"); if (s) try { this._session = JSON.parse(s); } catch(e) {} },
  isLoggedIn: function() { return !!this._session; },
  getSession: function() { return this._session; },
  getPoslovnica: function() { return this._session ? this._session.poslovnica : null; },
  getPoslovnicaId: function() { return this._session ? this._session.poslovnicaId : null; },
  login: function(id, pin) {
    var self = this;
    return GitHubStorage.readFile("data/poslovnice.json").then(function(data) {
      if (!data) throw new Error("Ne mogu dohvatiti poslovnice");
      var p = null;
      for (var i = 0; i < data.content.poslovnice.length; i++) { if (data.content.poslovnice[i].id === id) { p = data.content.poslovnice[i]; break; } }
      if (!p) throw new Error("Poslovnica nije prona\u0111ena");
      if (p.pin !== pin) throw new Error("Pogre\u0161an PIN");
      self._session = { poslovnicaId: p.id, poslovnica: p.naziv, loginTime: new Date().toISOString() };
      localStorage.setItem("prijem_session", JSON.stringify(self._session));
    });
  },
  logout: function() { this._session = null; localStorage.removeItem("prijem_session"); window.location.href = "index.html"; },
  requireAuth: function() { if (!this.isLoggedIn()) { window.location.href = "index.html"; return false; } return true; }
};
Auth.init();
