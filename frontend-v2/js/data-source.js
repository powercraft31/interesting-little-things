/* ============================================
   SOLFACIL Admin Portal — Data Source Adapter (v5.12)
   Dual-Source Pattern: mock ↔ live API toggle.

   Usage:
     DataSource.USE_LIVE_API = true;  // switch to live
     const data = await DataSource.fleet.overview();

   When USE_LIVE_API is false, returns mock data from mock-data.js.
   When true, fetches from the BFF API and falls back to mock on error.
   ============================================ */

// eslint-disable-next-line no-unused-vars
var DataSource = (function () {
  // ── Configuration ─────────────────────────────────────────
  var API_BASE = window.SOLFACIL_API_BASE || "http://localhost:3000";
  var USE_LIVE_API = false; // Toggle: false = mock, true = live API

  // ── Helpers ───────────────────────────────────────────────
  function apiGet(path) {
    return fetch(API_BASE + path, {
      headers: {
        Authorization: JSON.stringify({
          userId: "demo-user",
          orgId: "ORG_SOLFACIL",
          role: "SOLFACIL_ADMIN",
        }),
      },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("API " + res.status);
        return res.json();
      })
      .then(function (envelope) {
        if (envelope.success) return envelope.data;
        throw new Error(envelope.error || "API error");
      });
  }

  function apiPost(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: JSON.stringify({
          userId: "demo-user",
          orgId: "ORG_SOLFACIL",
          role: "SOLFACIL_ADMIN",
        }),
      },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("API " + res.status);
        return res.json();
      })
      .then(function (envelope) {
        if (envelope.success) return envelope.data;
        throw new Error(envelope.error || "API error");
      });
  }

  function withFallback(apiCall, mockData) {
    if (!USE_LIVE_API) return Promise.resolve(mockData);
    return apiCall().catch(function (err) {
      console.warn("[DataSource] API failed, using mock:", err.message);
      return mockData;
    });
  }

  // ── Fleet (P1) ────────────────────────────────────────────
  var fleet = {
    overview: function () {
      return withFallback(
        function () { return apiGet("/api/fleet/overview"); },
        typeof FLEET !== "undefined" ? FLEET : {}
      );
    },
    integradores: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/integradores").then(function (d) { return d.integradores; });
        },
        typeof INTEGRADORES !== "undefined" ? INTEGRADORES : []
      );
    },
    offlineEvents: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/offline-events").then(function (d) { return d.events; });
        },
        typeof OFFLINE_EVENTS !== "undefined" ? OFFLINE_EVENTS : []
      );
    },
    uptimeTrend: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/uptime-trend").then(function (d) { return d.trend; });
        },
        typeof uptimeTrendData !== "undefined" ? uptimeTrendData : []
      );
    },
  };

  // ── Devices (P2) ──────────────────────────────────────────
  var devices = {
    list: function (filters) {
      var qs = "";
      if (filters) {
        var parts = [];
        if (filters.type) parts.push("type=" + encodeURIComponent(filters.type));
        if (filters.status) parts.push("status=" + encodeURIComponent(filters.status));
        if (filters.search) parts.push("search=" + encodeURIComponent(filters.search));
        if (parts.length) qs = "?" + parts.join("&");
      }
      return withFallback(
        function () {
          return apiGet("/api/devices" + qs).then(function (d) { return d.devices; });
        },
        typeof DEVICES !== "undefined" ? DEVICES : []
      );
    },
    homes: function () {
      return withFallback(
        function () {
          return apiGet("/api/homes").then(function (d) { return d.homes; });
        },
        typeof HOMES !== "undefined" ? HOMES : []
      );
    },
  };

  // ── Energy (P3) ───────────────────────────────────────────
  var energy = {
    homeEnergy: function (homeId, date) {
      var qs = date ? "?date=" + date : "";
      return withFallback(
        function () { return apiGet("/api/homes/" + homeId + "/energy" + qs); },
        {}
      );
    },
    summary: function (date) {
      var qs = date ? "?date=" + date : "";
      return withFallback(
        function () {
          return apiGet("/api/homes/summary" + qs).then(function (d) { return d.summary; });
        },
        []
      );
    },
  };

  // ── HEMS (P4) ─────────────────────────────────────────────
  var hems = {
    overview: function () {
      return withFallback(
        function () { return apiGet("/api/hems/overview"); },
        {}
      );
    },
    dispatch: function (targetMode, filters) {
      return apiPost("/api/hems/dispatch", {
        targetMode: targetMode,
        filters: filters,
      });
    },
  };

  // ── VPP (P5) ──────────────────────────────────────────────
  var vpp = {
    capacity: function () {
      return withFallback(
        function () { return apiGet("/api/vpp/capacity"); },
        typeof VPP_CAPACITY !== "undefined" ? VPP_CAPACITY : {}
      );
    },
    latency: function () {
      return withFallback(
        function () {
          return apiGet("/api/vpp/latency").then(function (d) { return d.tiers; });
        },
        typeof LATENCY_TIERS !== "undefined" ? LATENCY_TIERS : []
      );
    },
    drEvents: function () {
      return withFallback(
        function () {
          return apiGet("/api/vpp/dr-events").then(function (d) { return d.events; });
        },
        typeof DR_EVENTS !== "undefined" ? DR_EVENTS : []
      );
    },
  };

  // ── Performance (P6) ──────────────────────────────────────
  var performance = {
    scorecard: function () {
      return withFallback(
        function () { return apiGet("/api/performance/scorecard"); },
        typeof SCORECARD !== "undefined" ? SCORECARD : {}
      );
    },
    savings: function (period) {
      var qs = period ? "?period=" + period : "";
      return withFallback(
        function () {
          return apiGet("/api/performance/savings" + qs).then(function (d) { return d.savings; });
        },
        typeof SAVINGS_BY_HOME !== "undefined" ? SAVINGS_BY_HOME : []
      );
    },
  };

  // ── Public API ────────────────────────────────────────────
  return {
    get USE_LIVE_API() { return USE_LIVE_API; },
    set USE_LIVE_API(val) { USE_LIVE_API = !!val; },
    get API_BASE() { return API_BASE; },
    set API_BASE(val) { API_BASE = val; },
    fleet: fleet,
    devices: devices,
    energy: energy,
    hems: hems,
    vpp: vpp,
    performance: performance,
  };
})();
