/* ============================================
   SOLFACIL Admin Portal — Data Source Adapter (v5.19)
   Dual-Source Pattern: mock ↔ live API toggle.

   Usage:
     DataSource.USE_LIVE_API = true;  // switch to live
     const data = await DataSource.fleet.overview();

   When USE_LIVE_API is false, returns mock data from mock-data.js.
   When true, fetches from the BFF API — errors propagate (no fallback).
   ============================================ */

// eslint-disable-next-line no-unused-vars
var DataSource = (function () {
  // ── Configuration ─────────────────────────────────────────
  var rawBase =
    typeof CONFIG !== "undefined" && CONFIG.BFF_API_URL
      ? CONFIG.BFF_API_URL
      : window.SOLFACIL_API_BASE || "http://localhost:3000";
  var API_BASE = rawBase.replace(/\/api\/?$/, "");
  var USE_LIVE_API =
    typeof CONFIG !== "undefined" && CONFIG.USE_MOCK === true ? false : true;

  // ── Helpers ───────────────────────────────────────────────
  function getAuthHeader() {
    return JSON.stringify({
      userId: "demo-user",
      orgId: "ORG_ENERGIA_001",
      role: "SOLFACIL_ADMIN",
    });
  }

  function apiGet(path) {
    return fetch(API_BASE + path, {
      headers: { Authorization: getAuthHeader() },
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
        Authorization: getAuthHeader(),
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

  function apiPut(path, body) {
    return fetch(API_BASE + path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: getAuthHeader(),
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
    // v5.19 iron rule:
    // Mock mode → 100% mock, never call API
    if (!USE_LIVE_API) {
      return Promise.resolve(
        typeof mockData === "function" ? mockData() : mockData,
      );
    }
    // DB mode → 100% API, no fallback — errors propagate
    return apiCall();
  }

  // ── Fleet (P1) ────────────────────────────────────────────
  var fleet = {
    overview: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/overview");
        },
        typeof FLEET !== "undefined" ? FLEET : {},
      );
    },
    integradores: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/integradores").then(function (d) {
            return d.integradores;
          });
        },
        typeof INTEGRADORES !== "undefined" ? INTEGRADORES : [],
      );
    },
    offlineEvents: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/offline-events").then(function (d) {
            return d.events;
          });
        },
        typeof OFFLINE_EVENTS !== "undefined" ? OFFLINE_EVENTS : [],
      );
    },
    uptimeTrend: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/uptime-trend").then(function (d) {
            return d.trend;
          });
        },
        typeof uptimeTrendData !== "undefined"
          ? uptimeTrendData
          : (typeof DemoStore !== "undefined" &&
              DemoStore.get("uptimeTrend")) ||
              [],
      );
    },
  };

  // ── Devices (P2) ──────────────────────────────────────────
  var devices = {
    list: function (filters) {
      var qs = "";
      if (filters) {
        var parts = [];
        if (filters.type)
          parts.push("type=" + encodeURIComponent(filters.type));
        if (filters.status)
          parts.push("status=" + encodeURIComponent(filters.status));
        if (filters.search)
          parts.push("search=" + encodeURIComponent(filters.search));
        if (parts.length) qs = "?" + parts.join("&");
      }
      return withFallback(
        function () {
          return apiGet("/api/devices" + qs).then(function (d) {
            return d.devices;
          });
        },
        typeof DEVICES !== "undefined" ? DEVICES : [],
      );
    },
    gateways: function () {
      return withFallback(
        function () {
          return apiGet("/api/gateways").then(function (d) {
            return d.gateways;
          });
        },
        typeof GATEWAYS !== "undefined" ? GATEWAYS : [],
      );
    },
    gatewayDevices: function (gatewayId) {
      return withFallback(
        function () {
          return apiGet("/api/gateways/" + gatewayId + "/devices");
        },
        function () {
          return typeof MOCK_GW_DEVICES !== "undefined" &&
            MOCK_GW_DEVICES[gatewayId]
            ? MOCK_GW_DEVICES[gatewayId]
            : { gateway: { gatewayId: gatewayId }, devices: [] };
        },
      );
    },
    deviceDetail: function (assetId) {
      return withFallback(
        function () {
          return apiGet("/api/devices/" + assetId);
        },
        function () {
          return typeof MOCK_DEVICE_DETAIL !== "undefined"
            ? MOCK_DEVICE_DETAIL
            : {};
        },
      );
    },
    updateDevice: function (assetId, config) {
      if (!USE_LIVE_API) {
        return Promise.resolve({ assetId: assetId, updated: true });
      }
      return apiPut("/api/devices/" + assetId, config);
    },
    getSchedule: function (assetId) {
      return withFallback(
        function () {
          return apiGet("/api/devices/" + assetId + "/schedule");
        },
        function () {
          return typeof MOCK_DEVICE_SCHEDULE !== "undefined"
            ? MOCK_DEVICE_SCHEDULE
            : { syncStatus: "unknown", slots: [] };
        },
      );
    },
    putSchedule: function (assetId, slots) {
      if (!USE_LIVE_API) {
        return Promise.resolve({
          commandId: 99,
          status: "pending_dispatch",
          message: "Schedule submitted. Waiting for gateway confirmation.",
        });
      }
      return apiPut("/api/devices/" + assetId + "/schedule", { slots: slots });
    },
  };

  // ── Energy (P3) ───────────────────────────────────────────
  var energy = {
    gatewayEnergy: function (gatewayId, date) {
      var qs = date ? "?date=" + date : "";
      return withFallback(
        function () {
          return apiGet("/api/gateways/" + gatewayId + "/energy" + qs);
        },
        typeof getGatewayEnergyMock === "function"
          ? getGatewayEnergyMock(gatewayId)
          : {},
      );
    },
    summary: function (date) {
      var qs = date ? "?date=" + date : "";
      return withFallback(function () {
        return apiGet("/api/gateways/summary" + qs).then(function (d) {
          return d.summary;
        });
      }, []);
    },
    baCompare: function (gatewayId) {
      return withFallback(
        function () {
          return apiGet("/api/gateways/" + gatewayId + "/ba-compare");
        },
        typeof BA_COMPARE !== "undefined"
          ? BA_COMPARE[gatewayId] || BA_COMPARE[0] || {}
          : {},
      );
    },
  };

  // ── HEMS (P4) ─────────────────────────────────────────────
  var hems = {
    overview: function () {
      return withFallback(
        function () {
          return apiGet("/api/hems/overview");
        },
        function () {
          // Full mock structure matching what pages expect
          return {
            modeDistribution:
              typeof MODE_DISTRIBUTION !== "undefined"
                ? MODE_DISTRIBUTION
                : {
                    self_consumption: 22,
                    peak_valley_arbitrage: 18,
                    peak_shaving: 7,
                  },
            tarifaRates:
              typeof TARIFA_RATES !== "undefined"
                ? TARIFA_RATES
                : {
                    disco: "CEMIG",
                    peak: 0.89,
                    intermediate: 0.62,
                    offPeak: 0.41,
                    effectiveDate: "01/01/2026",
                    peakHours: "17:00-20:00",
                    intermediateHours: "16:00-17:00 & 20:00-21:00",
                  },
            lastDispatch:
              typeof LAST_DISPATCH !== "undefined"
                ? LAST_DISPATCH
                : {
                    timestamp: "03/03/2026 14:30",
                    fromMode: "peak_valley_arbitrage",
                    toMode: "peak_shaving",
                    affectedDevices: 7,
                    successRate: 100,
                  },
            integradores:
              typeof INTEGRADORES !== "undefined" ? INTEGRADORES : [],
          };
        },
      );
    },
    dispatch: function (targetMode, filters) {
      return apiPost("/api/hems/dispatch", {
        targetMode: targetMode,
        filters: filters,
      });
    },
  };

  // ── Tariffs ────────────────────────────────────────────────
  var tariffs = {
    get: function () {
      return withFallback(
        function () {
          return apiGet("/api/tariffs");
        },
        function () {
          return typeof TARIFA_RATES !== "undefined"
            ? TARIFA_RATES
            : {
                disco: "CEMIG",
                peak: 0.89,
                intermediate: 0.62,
                offPeak: 0.41,
                effectiveDate: "01/01/2026",
                peakHours: "17:00-20:00",
                intermediateHours: "16:00-17:00 & 20:00-21:00",
              };
        },
      );
    },
  };

  // ── VPP (P5) ──────────────────────────────────────────────
  var vpp = {
    capacity: function () {
      return withFallback(
        function () {
          return apiGet("/api/vpp/capacity");
        },
        typeof VPP_CAPACITY !== "undefined" ? VPP_CAPACITY : {},
      );
    },
    latency: function () {
      return withFallback(
        function () {
          return apiGet("/api/vpp/latency").then(function (d) {
            return d.tiers;
          });
        },
        typeof LATENCY_TIERS !== "undefined" ? LATENCY_TIERS : [],
      );
    },
    drEvents: function () {
      return withFallback(
        function () {
          return apiGet("/api/vpp/dr-events").then(function (d) {
            return d.events;
          });
        },
        typeof DR_EVENTS !== "undefined" ? DR_EVENTS : [],
      );
    },
  };

  // ── Performance (P6) ──────────────────────────────────────
  var performance = {
    scorecard: function () {
      return withFallback(
        function () {
          return apiGet("/api/performance/scorecard");
        },
        typeof SCORECARD !== "undefined" ? SCORECARD : {},
      );
    },
    savings: function (period) {
      var qs = period ? "?period=" + period : "";
      return withFallback(
        function () {
          return apiGet("/api/performance/savings" + qs).then(function (d) {
            return d.savings;
          });
        },
        typeof SAVINGS_BY_HOME !== "undefined" ? SAVINGS_BY_HOME : [],
      );
    },
  };

  // ── Public API ────────────────────────────────────────────
  return {
    get USE_LIVE_API() {
      return USE_LIVE_API;
    },
    set USE_LIVE_API(val) {
      USE_LIVE_API = !!val;
    },
    get API_BASE() {
      return API_BASE;
    },
    set API_BASE(val) {
      API_BASE = val;
    },
    fleet: fleet,
    devices: devices,
    energy: energy,
    hems: hems,
    tariffs: tariffs,
    vpp: vpp,
    performance: performance,
  };
})();
