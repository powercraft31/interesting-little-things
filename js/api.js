/* ═══════════════════════════════════════════════════════════════════
   SOLFACIL VPP — API Client
   Phase 6.3: Data Dictionary API methods
   ═══════════════════════════════════════════════════════════════════ */

var SolfacilAPI = {
  baseUrl: "/api",

  /**
   * GET /api/admin/data-dictionary — fetch all dictionary fields
   * @returns {Promise<{ok: boolean, data?: Array, error?: string}>}
   */
  getDictionary: function () {
    return fetch(this.baseUrl + "/admin/data-dictionary", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": typeof generateUUID === "function" ? generateUUID() : "",
      },
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            return { ok: false, error: "HTTP " + res.status + ": " + body };
          });
        }
        return res.json().then(function (data) {
          return { ok: true, data: data };
        });
      })
      .catch(function (err) {
        return { ok: false, error: err.message || "Network error" };
      });
  },

  /**
   * POST /api/admin/data-dictionary — create a new dictionary field
   * @param {Object} fieldData - { domain, fieldId, displayName, valueType }
   * @returns {Promise<{ok: boolean, data?: Object, error?: string}>}
   */
  createDictionaryField: function (fieldData) {
    return fetch(this.baseUrl + "/admin/data-dictionary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": typeof generateUUID === "function" ? generateUUID() : "",
      },
      body: JSON.stringify(fieldData),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            return { ok: false, error: "HTTP " + res.status + ": " + body };
          });
        }
        return res.json().then(function (data) {
          return { ok: true, data: data };
        });
      })
      .catch(function (err) {
        return { ok: false, error: err.message || "Network error" };
      });
  },

  /**
   * POST /api/admin/parser-rules — deploy a dynamic parser rule to the engine
   * @param {Object} rule - ParserRule shape: { ruleId, parserType, iterator?, deviceIdPath?, mappings }
   * @returns {Promise<{ok: boolean, data?: Object, error?: string}>}
   */
  deployParserRules: function (rule) {
    return fetch(this.baseUrl + "/admin/parser-rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": typeof generateUUID === "function" ? generateUUID() : "",
      },
      body: JSON.stringify(rule),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            return { ok: false, error: "HTTP " + res.status + ": " + body };
          });
        }
        return res.json().then(function (data) {
          return { ok: true, data: data };
        });
      })
      .catch(function (err) {
        return { ok: false, error: err.message || "Network error" };
      });
  },
};
