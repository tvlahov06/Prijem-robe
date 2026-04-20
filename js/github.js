var GitHubStorage = {
  _token: null,
  _owner: null,
  _repo: "Prijem-robe",
  _proxy: "https://prijem-proxy.tomislav-2c0.workers.dev/api/",

  init: function() {
    this._token = localStorage.getItem("github_token");
    this._owner = localStorage.getItem("github_owner");
  },

  isConfigured: function() {
    // Configured if either token exists OR proxy is available
    return !!(this._token || this._proxy);
  },

  setToken: function(token) {
    this._token = token;
    localStorage.setItem("github_token", token);
    // Detect owner from token
    var self = this;
    return this._request("GET", "user").then(function(data) {
      self._owner = data.login;
      localStorage.setItem("github_owner", data.login);
      return data;
    });
  },

  getToken: function() { return this._token; },
  getOwner: function() { return this._owner; },

  _request: function(method, endpoint, body) {
    var url, headers;

    if (this._token) {
      // Direct GitHub API with token
      url = "https://api.github.com/" + endpoint;
      headers = {
        "Authorization": "Bearer " + this._token,
        "Accept": "application/vnd.github.v3+json"
      };
    } else {
      // Via proxy (no token needed)
      url = this._proxy + endpoint;
      headers = {
        "Accept": "application/vnd.github.v3+json"
      };
    }

    if (body) headers["Content-Type"] = "application/json";

    return fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function(resp) {
      if (resp.status === 404) return null;
      if (!resp.ok) return resp.text().then(function(t) { throw new Error("GitHub API error: " + resp.status + " " + t); });
      if (resp.status === 204) return {};
      return resp.json();
    });
  },

  _getOwner: function() {
    if (this._owner) return Promise.resolve(this._owner);
    if (this._token) {
      var self = this;
      return this._request("GET", "user").then(function(data) {
        self._owner = data.login;
        localStorage.setItem("github_owner", data.login);
        return data.login;
      });
    }
    // Via proxy - detect owner
    var self = this;
    return this._request("GET", "user").then(function(data) {
      if (data && data.login) {
        self._owner = data.login;
        localStorage.setItem("github_owner", data.login);
        return data.login;
      }
      throw new Error("Cannot detect owner");
    });
  },

  readFile: function(path) {
    var self = this;
    return this._getOwner().then(function(owner) {
      return self._request("GET", "repos/" + owner + "/" + self._repo + "/contents/" + path);
    }).then(function(data) {
      if (!data) return null;
      try {
        var content = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
        return { content: content, sha: data.sha };
      } catch(e) {
        return null;
      }
    });
  },

  writeFile: function(path, content, message, sha) {
    var self = this;
    return this._getOwner().then(function(owner) {
      var body = {
        message: message || "Update " + path,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))))
      };
      if (sha) body.sha = sha;
      return self._request("PUT", "repos/" + owner + "/" + self._repo + "/contents/" + path, body);
    });
  },

  deleteFile: function(path, sha, message) {
    var self = this;
    return this._getOwner().then(function(owner) {
      return self._request("DELETE", "repos/" + owner + "/" + self._repo + "/contents/" + path, {
        message: message || "Delete " + path,
        sha: sha
      });
    });
  },

  listFiles: function(path) {
    var self = this;
    return this._getOwner().then(function(owner) {
      return self._request("GET", "repos/" + owner + "/" + self._repo + "/contents/" + path);
    }).then(function(data) {
      if (!data || !Array.isArray(data)) return [];
      return data;
    }).catch(function() { return []; });
  }
};

GitHubStorage.init();
