/* ============================================
   SOLFACIL Admin Portal — P3: Energy Behavior
   Container page: Gateway selector → Asset resolution →
   Tab switch between AssetEnergyPage / AssetHealthPage sub-modules.
   ============================================ */

var EnergyPage = {
  _gateways: [],
  _currentGateway: null,
  _currentAssetId: null,
  _activeTab: "energy", // "energy" | "health"

  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  init: async function () {
    var self = this;
    var container = document.getElementById("energy-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      self._gateways = await DataSource.devices.gateways();
    } catch (err) {
      showErrorBoundary("energy-content", err);
      return;
    }

    // Check for URL params (?gw=...&tab=...)
    var params = self._parseHashParams();
    var requestedGw = params.gw || null;
    var requestedTab = params.tab || "energy";

    if (requestedGw && self._gateways.some(function (g) { return g.gatewayId === requestedGw; })) {
      self._currentGateway = requestedGw;
    } else {
      self._currentGateway = self._gateways.length ? self._gateways[0].gatewayId : null;
    }
    self._activeTab = requestedTab === "health" ? "health" : "energy";

    container.innerHTML = self._buildContent();
    self._setupEventListeners();

    if (self._currentGateway) {
      await self._resolveAssetAndRender();
    }
  },

  onRoleChange: function () {},

  // =========================================================
  // URL PARAM HELPERS
  // =========================================================

  _parseHashParams: function () {
    var hash = location.hash || "";
    var qIdx = hash.indexOf("?");
    if (qIdx === -1) return {};
    var qs = hash.substring(qIdx + 1);
    var params = {};
    qs.split("&").forEach(function (pair) {
      var parts = pair.split("=");
      if (parts.length === 2) {
        params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
      }
    });
    return params;
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return [
      '<div class="p3-home-selector-wrap"><div class="skeleton" style="width:260px;height:40px;border-radius:6px"></div></div>',
      '<div class="skeleton" style="width:300px;height:36px;border-radius:6px;margin:12px 0"></div>',
      Components.skeletonChart(),
      '<div style="margin-top:16px">' + Components.skeletonChart() + "</div>",
    ].join("");
  },

  // =========================================================
  // CONTENT BUILDER
  // =========================================================

  _buildContent: function () {
    return [
      this._buildGatewaySelector(),
      this._buildTabs(),
      '<div id="p3-sub-content"></div>',
    ].join("");
  },

  _buildGatewaySelector: function () {
    var gateways = this._gateways || [];
    var currentGw = this._currentGateway;
    var options = gateways
      .map(function (gw) {
        var selected = gw.gatewayId === currentGw ? " selected" : "";
        return (
          '<option value="' +
          gw.gatewayId +
          '"' +
          selected +
          ">" +
          gw.name +
          " (" +
          gw.gatewayId +
          ")</option>"
        );
      })
      .join("");

    return (
      '<div class="p3-home-selector-wrap">' +
      '<label class="p3-selector-label">' +
      t("energy.gatewayLabel") +
      "</label>" +
      '<select id="p3-home-select" class="p3-home-select">' +
      options +
      "</select>" +
      "</div>"
    );
  },

  _buildTabs: function () {
    var energyCls = this._activeTab === "energy" ? " active" : "";
    var healthCls = this._activeTab === "health" ? " active" : "";
    return (
      '<div class="p3ah-tabs">' +
      '<button class="p3ah-tab p3-container-tab' + energyCls + '" data-tab="energy">' +
      t("p3ae.energyFlow") +
      "</button>" +
      '<button class="p3ah-tab p3-container-tab' + healthCls + '" data-tab="health">' +
      t("p3ah.title") +
      "</button>" +
      "</div>"
    );
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupEventListeners: function () {
    var self = this;
    var select = document.getElementById("p3-home-select");
    if (select) {
      select.addEventListener("change", function () {
        self._switchGateway(select.value);
      });
    }

    document.querySelectorAll(".p3-container-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.dataset.tab;
        if (tab !== self._activeTab) {
          self._switchTab(tab);
        }
      });
    });
  },

  // =========================================================
  // GATEWAY → ASSET RESOLUTION
  // =========================================================

  _resolveAssetAndRender: async function () {
    var self = this;
    if (!self._currentGateway) return;

    try {
      var result = await DataSource.devices.gatewayDevices(self._currentGateway);
      var devices = result.devices || [];
      var inverterBattery = devices.find(function (d) {
        return d.assetType === "INVERTER_BATTERY";
      });
      self._currentAssetId = inverterBattery ? inverterBattery.assetId : null;
    } catch (err) {
      console.error("[Energy] Gateway device resolution failed:", err);
      self._currentAssetId = null;
    }

    self._renderActiveTab();
  },

  // =========================================================
  // TAB / GATEWAY SWITCHING
  // =========================================================

  _switchGateway: function (gatewayId) {
    this._currentGateway = gatewayId;
    this._disposeCurrentTab();
    this._resolveAssetAndRender();
  },

  _switchTab: function (tab) {
    this._disposeCurrentTab();
    this._activeTab = tab;

    // Update tab button active state
    document.querySelectorAll(".p3-container-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    this._renderActiveTab();
  },

  _disposeCurrentTab: function () {
    if (this._activeTab === "energy" && typeof AssetEnergyPage !== "undefined") {
      AssetEnergyPage.dispose();
    } else if (this._activeTab === "health" && typeof AssetHealthPage !== "undefined") {
      AssetHealthPage.dispose();
    }
  },

  _renderActiveTab: function () {
    var subContent = document.getElementById("p3-sub-content");
    if (!subContent) return;

    if (!this._currentAssetId) {
      subContent.innerHTML =
        '<div class="empty-state-detail">' + t("shared.noData") + "</div>";
      return;
    }

    if (this._activeTab === "energy" && typeof AssetEnergyPage !== "undefined") {
      AssetEnergyPage.init(this._currentAssetId, "p3-sub-content");
    } else if (this._activeTab === "health" && typeof AssetHealthPage !== "undefined") {
      AssetHealthPage.init(this._currentAssetId, "p3-sub-content");
    }
  },

  // =========================================================
  // PUBLIC: select gateway from external navigation (P2 links)
  // =========================================================

  selectGateway: function (gatewayId, tab) {
    this._currentGateway = gatewayId;
    if (tab) this._activeTab = tab;

    // Update dropdown if already rendered
    var select = document.getElementById("p3-home-select");
    if (select) select.value = gatewayId;

    // Update tabs
    document.querySelectorAll(".p3-container-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === (tab || "energy"));
    });

    this._disposeCurrentTab();
    this._resolveAssetAndRender();
  },
};
