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
      : window.SOLFACIL_API_BASE || window.location.origin;
  var API_BASE = rawBase.replace(/\/api\/?$/, "");
  var USE_LIVE_API =
    typeof CONFIG !== "undefined" && CONFIG.USE_MOCK === true ? false : true;

  // ── Helpers ───────────────────────────────────────────────
  function getAuthHeader() {
    var token = localStorage.getItem("solfacil_jwt");
    if (!token) {
      window.location.href = "login.html";
      return "";
    }
    return "Bearer " + token;
  }

  function apiGet(path) {
    return fetch(API_BASE + path, {
      headers: { Authorization: getAuthHeader() },
    })
      .then(function (res) {
        if (res.status === 401) {
          localStorage.removeItem("solfacil_jwt");
          window.location.href = "login.html";
          return;
        }
        if (!res.ok) throw new Error("API " + res.status);
        return res.json();
      })
      .then(function (envelope) {
        if (!envelope) return;
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
        if (res.status === 401) {
          localStorage.removeItem("solfacil_jwt");
          window.location.href = "login.html";
          return;
        }
        if (!res.ok) throw new Error("API " + res.status);
        return res.json();
      })
      .then(function (envelope) {
        if (!envelope) return;
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
        if (res.status === 401) {
          localStorage.removeItem("solfacil_jwt");
          window.location.href = "login.html";
          return;
        }
        if (!res.ok) {
          var err = new Error("API " + res.status);
          err.status = res.status;
          throw err;
        }
        return res.json();
      })
      .then(function (envelope) {
        if (!envelope) return;
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

  // ── Fleet (P1 → v6.1 gateway-first) ─────────────────────
  var fleet = {
    overview: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/overview");
        },
        typeof FLEET !== "undefined" ? FLEET : {},
      );
    },
    charts: function () {
      return withFallback(
        function () {
          return apiGet("/api/fleet/charts");
        },
        {
          gatewayStatus: { online: 0, offline: 0 },
          inverterBrandDistribution: [],
        },
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
    offlineEvents: function (limit) {
      return withFallback(
        function () {
          var qs = limit ? "?limit=" + limit : "";
          return apiGet("/api/fleet/offline-events" + qs).then(function (d) {
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
    gatewayDetail: function (gatewayId) {
      return withFallback(
        function () {
          return apiGet("/api/gateways/" + gatewayId + "/detail");
        },
        function () {
          return typeof MOCK_GATEWAY_DETAIL !== "undefined"
            ? MOCK_GATEWAY_DETAIL
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
    putDevice: function (assetId, config) {
      if (!USE_LIVE_API) {
        return Promise.resolve({ success: true });
      }
      return apiPut("/api/devices/" + assetId, config);
    },
    getSchedule: function (gatewayId) {
      return withFallback(
        function () {
          return apiGet("/api/gateways/" + gatewayId + "/schedule");
        },
        function () {
          return typeof MOCK_DEVICE_SCHEDULE !== "undefined"
            ? MOCK_DEVICE_SCHEDULE
            : { syncStatus: "unknown", slots: [] };
        },
      );
    },
    putSchedule: function (gatewayId, config) {
      if (!USE_LIVE_API) {
        return Promise.resolve({
          commandId: 99,
          status: "pending",
          message: "Schedule submitted. Waiting for gateway confirmation.",
        });
      }
      return apiPut("/api/gateways/" + gatewayId + "/schedule", config);
    },
  };

  // ── Energy (P3) ───────────────────────────────────────────
  var energy = {
    // v6.3: Gateway-level 24h energy behavior (288 x 5-min points + summary)
    gateway24h: function (gatewayId, date) {
      var qs = date ? "?date=" + date : "";
      return withFallback(
        function () {
          return apiGet("/api/gateways/" + gatewayId + "/energy-24h" + qs);
        },
        function () {
          return typeof MOCK_ENERGY_24H !== "undefined"
            ? MOCK_ENERGY_24H
            : {
                points: [],
                summary: {
                  batteryChargeKwh: 0,
                  batteryDischargeKwh: 0,
                  gridImportKwh: 0,
                  gridExportKwh: 0,
                },
              };
        },
      );
    },
    // v6.3: Gateway-level energy statistics (7d/30d/12m buckets + totals)
    gatewayStats: function (gatewayId, window, endDate) {
      var qs =
        "?window=" +
        encodeURIComponent(window) +
        "&endDate=" +
        encodeURIComponent(endDate);
      return withFallback(
        function () {
          return apiGet("/api/gateways/" + gatewayId + "/energy-stats" + qs);
        },
        function () {
          return typeof MOCK_ENERGY_STATS !== "undefined"
            ? MOCK_ENERGY_STATS
            : {
                buckets: [],
                totals: {
                  pvGenerationKwh: 0,
                  loadConsumptionKwh: 0,
                  gridImportKwh: 0,
                  gridExportKwh: 0,
                  batteryChargeKwh: 0,
                  batteryDischargeKwh: 0,
                  selfConsumptionPct: 0,
                  selfSufficiencyPct: 0,
                  peakDemandKw: 0,
                },
              };
        },
      );
    },
    // Legacy methods (kept for asset-energy submodule compatibility)
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
    batchDispatch: function (params) {
      return withFallback(
        function () {
          return apiPost("/api/hems/batch-dispatch", params);
        },
        {
          batchId: "mock-batch-1",
          results: [],
          summary: { total: 0, pending: 0, skipped: 0 },
        },
      );
    },
    batchHistory: function (limit) {
      return withFallback(
        function () {
          return apiGet("/api/hems/batch-history?limit=" + (limit || 20));
        },
        typeof MOCK_DATA !== "undefined" && MOCK_DATA.BATCH_HISTORY
          ? MOCK_DATA.BATCH_HISTORY
          : { batches: [] },
      );
    },
    gatewayTargeting: function () {
      return withFallback(
        function () {
          return apiGet("/api/hems/targeting");
        },
        typeof MOCK_DATA !== "undefined" && MOCK_DATA.HEMS_TARGETING
          ? MOCK_DATA.HEMS_TARGETING
          : { gateways: [] },
      );
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

  // ── P5 Strategy Triggers ────────────────────────────────────
  var p5 = {
    overview: function () {
      return withFallback(
        function () {
          return apiGet("/api/p5/overview");
        },
        {
          hero: {
            posture: "calm",
            dominant_driver: "",
            governance_mode: "observe",
            governance_summary: "Loading...",
            override_active: false,
            conflict_active: false,
            operator_action_needed: false,
          },
          calm_explanation: {
            reason: "no_conditions_detected",
            detail: "Loading...",
            contributing_factors: [],
          },
          need_decision_now: [],
          platform_acting: [],
          watch_next: [],
          context: {
            operating_posture: {},
            dominant_protector: null,
            recent_handoffs: [],
            suppressed_count: 0,
            deferred_count: 0,
          },
        },
      );
    },
    intentDetail: function (intentId) {
      return apiGet("/api/p5/intents/" + intentId);
    },
    intentAction: function (intentId, action, body) {
      return apiPost("/api/p5/intents/" + intentId + "/" + action, body || {});
    },
    createOverride: function (body) {
      return apiPost("/api/p5/posture-override", body);
    },
    cancelOverride: function (overrideId, body) {
      return apiPost(
        "/api/p5/posture-override/" + overrideId + "/cancel",
        body || {},
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

  // ── Asset (P3 History) ───────────────────────────────────
  var asset = {
    telemetry: function (assetId, from, to, resolution) {
      var qs =
        "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
      if (resolution) qs += "&resolution=" + encodeURIComponent(resolution);
      return withFallback(
        function () {
          return apiGet("/api/assets/" + assetId + "/telemetry" + qs);
        },
        { points: [], summary: {} },
      );
    },
    health: function (assetId, from, to) {
      var qs =
        "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
      return withFallback(function () {
        return apiGet("/api/assets/" + assetId + "/health" + qs);
      }, {});
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
    p5: p5,
    performance: performance,
    asset: asset,
  };
})();
