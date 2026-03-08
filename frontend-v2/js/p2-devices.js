/* ============================================
   SOLFACIL Admin Portal — P2: Device Management
   Device list table, drill-down panel, commissioning wizard,
   commissioning history.
   ============================================ */

const DevicesPage = {
  _filters: { type: "all", status: "all", search: "" },

  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  async init() {
    const self = this;
    const container = document.getElementById("devices-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      const [devices, homes] = await Promise.all([
        DataSource.devices.list(),
        DataSource.devices.homes(),
      ]);
      self._devices = devices;
      self._homes = homes;
    } catch (err) {
      showErrorBoundary("devices-content", err);
      return;
    }

    container.innerHTML = self._buildContent(currentRole);
    self._setupEventListeners();
  },

  onRoleChange(role) {
    this._filters = { type: "all", status: "all", search: "" };
    const tableWrap = document.getElementById("p2-device-table-wrap");
    if (tableWrap) {
      tableWrap.innerHTML = this._buildDeviceTable(role);
      this._updateDeviceCount(role);
      this._attachRowListeners();
    }
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton() {
    return `
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <div class="skeleton" style="width:160px;height:38px;border-radius:6px"></div>
        <div class="skeleton" style="width:160px;height:38px;border-radius:6px"></div>
        <div class="skeleton" style="width:220px;height:38px;border-radius:6px"></div>
      </div>
      ${Components.skeletonTable(10)}
      <div style="margin-top:24px">${Components.skeletonTable(3)}</div>
    `;
  },

  // =========================================================
  // CONTENT
  // =========================================================

  _buildContent(role) {
    return `
      ${this._buildFilterBar()}
      <div class="p2-device-count" id="p2-device-count"></div>
      ${Components.sectionCard(
        t("devices.list"),
        '<div id="p2-device-table-wrap">' +
          this._buildDeviceTable(role) +
          "</div>",
      )}
      ${this._buildCommissioningHistoryCard()}
    `;
  },

  // =========================================================
  // FILTER BAR
  // =========================================================

  _buildFilterBar() {
    const typeOptions = [
      { value: "all", label: t("devices.allTypes") },
      { value: "Inverter + Battery", label: t("dtype.Inverter + Battery") },
      { value: "Smart Meter", label: t("dtype.Smart Meter") },
      { value: "AC", label: t("dtype.AC") },
      { value: "EV Charger", label: t("dtype.EV Charger") },
    ];

    const statusOptions = [
      { value: "all", label: t("devices.allStatus") },
      { value: "online", label: t("shared.online") },
      { value: "offline", label: t("shared.offline") },
    ];

    return `
      <div class="p2-filter-bar">
        <select id="p2-filter-type">
          ${typeOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
        <select id="p2-filter-status">
          ${statusOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
        <input type="text" id="p2-filter-search" placeholder="${t("devices.searchPlaceholder")}">
        <div class="filter-spacer"></div>
        <button class="p2-btn-commission" id="p2-btn-commission" data-role="admin">${t("devices.commission")}</button>
      </div>
    `;
  },

  // =========================================================
  // DEVICE TABLE
  // =========================================================

  _getFilteredDevices(role) {
    let list = this._devices || DEVICES;

    if (role === "integrador") {
      list = list.filter((d) => d.orgId === "org-001");
    }

    if (this._filters.type !== "all") {
      list = list.filter((d) => d.type === this._filters.type);
    }

    if (this._filters.status !== "all") {
      list = list.filter((d) => d.status === this._filters.status);
    }

    if (this._filters.search) {
      const q = this._filters.search.toLowerCase();
      list = list.filter(
        (d) =>
          d.deviceId.toLowerCase().includes(q) ||
          d.homeName.toLowerCase().includes(q),
      );
    }

    return list;
  },

  _buildDeviceTable(role) {
    const devices = this._getFilteredDevices(role);

    if (devices.length === 0) {
      return (
        '<div class="table-empty" style="padding:24px;text-align:center;color:var(--muted)">' +
        t("devices.noMatch") +
        "</div>"
      );
    }

    let html =
      '<div class="data-table-wrapper"><table class="data-table p2-device-table">';
    html += "<thead><tr>";
    html +=
      "<th>" +
      t("devices.col.deviceId") +
      "</th>" +
      "<th>" +
      t("devices.col.type") +
      "</th>" +
      "<th>" +
      t("devices.col.brand") +
      "</th>" +
      "<th>" +
      t("devices.col.home") +
      "</th>" +
      "<th>" +
      t("devices.col.status") +
      "</th>" +
      "<th>" +
      t("devices.col.lastSeen") +
      "</th>";
    html += "</tr></thead><tbody>";

    devices.forEach((d) => {
      const statusBadge =
        d.status === "online"
          ? Components.statusBadge("online", t("devices.status.online"))
          : Components.statusBadge("offline", t("devices.status.offline"));

      html += `<tr data-device-id="${d.deviceId}">`;
      html += `<td class="font-data">${d.deviceId}</td>`;
      html += `<td>${t("dtype." + d.type)}</td>`;
      html += `<td>${d.brand}</td>`;
      html += `<td>${d.homeName}</td>`;
      html += `<td>${statusBadge}</td>`;
      html += `<td class="font-data">${d.lastSeen}</td>`;
      html += "</tr>";
    });

    html += "</tbody></table></div>";
    return html;
  },

  _updateDeviceCount(role) {
    const el = document.getElementById("p2-device-count");
    if (!el) return;
    const devices = this._getFilteredDevices(role);
    const allDevices = this._devices || DEVICES;
    const total =
      role === "integrador"
        ? allDevices.filter((d) => d.orgId === "org-001").length
        : allDevices.length;
    el.textContent = t("devices.showing")
      .replace("{0}", devices.length)
      .replace("{1}", total);
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupEventListeners() {
    const typeEl = document.getElementById("p2-filter-type");
    const statusEl = document.getElementById("p2-filter-status");
    const searchEl = document.getElementById("p2-filter-search");

    if (typeEl) {
      typeEl.addEventListener("change", () => {
        this._filters.type = typeEl.value;
        this._refreshTable(currentRole);
      });
    }
    if (statusEl) {
      statusEl.addEventListener("change", () => {
        this._filters.status = statusEl.value;
        this._refreshTable(currentRole);
      });
    }
    if (searchEl) {
      searchEl.addEventListener("input", () => {
        this._filters.search = searchEl.value;
        this._refreshTable(currentRole);
      });
    }

    const commBtn = document.getElementById("p2-btn-commission");
    if (commBtn) {
      commBtn.addEventListener("click", () => this._openWizard());
    }

    this._attachRowListeners();
    this._updateDeviceCount(currentRole);
  },

  _refreshTable(role) {
    const tableWrap = document.getElementById("p2-device-table-wrap");
    if (tableWrap) {
      tableWrap.innerHTML = this._buildDeviceTable(role);
      this._updateDeviceCount(role);
      this._attachRowListeners();
    }
  },

  _attachRowListeners() {
    document
      .querySelectorAll(".p2-device-table tr[data-device-id]")
      .forEach((row) => {
        row.addEventListener("click", () => {
          const id = row.dataset.deviceId;
          const allDevices = this._devices || DEVICES;
          const device = allDevices.find((d) => d.deviceId === id);
          if (device) this._openDrillDown(device);
        });
      });
  },

  // =========================================================
  // DEVICE DRILL-DOWN PANEL
  // =========================================================

  _openDrillDown(device) {
    this._closeDrillDown();

    const overlay = document.createElement("div");
    overlay.className = "device-panel-overlay";
    overlay.id = "device-panel-overlay";
    overlay.innerHTML = `
      <div class="device-panel" id="device-panel">
        <div class="device-panel-header">
          <h3>${t("devices.panel.title")}</h3>
          <button class="panel-close" id="panel-close">&times;</button>
        </div>
        <div class="device-panel-body" id="device-panel-body">
          ${this._buildDrillDownContent(device)}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this._closeDrillDown();
    });

    const closeBtn = overlay.querySelector("#panel-close");
    if (closeBtn)
      closeBtn.addEventListener("click", () => this._closeDrillDown());

    requestAnimationFrame(() => overlay.classList.add("open"));
  },

  _closeDrillDown() {
    const overlay = document.getElementById("device-panel-overlay");
    if (overlay) {
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), 250);
    }
  },

  _buildDrillDownContent(device) {
    const typeIcons = {
      "Inverter + Battery": "\u{1F50B}",
      "Smart Meter": "\u{1F4CA}",
      AC: "\u{2744}\u{FE0F}",
      "EV Charger": "\u{1F50C}",
    };

    const statusBadge =
      device.status === "online"
        ? Components.statusBadge("online", t("devices.status.online"))
        : Components.statusBadge("offline", t("devices.status.offline"));

    let html = `
      <div class="panel-device-header">
        <span class="panel-device-type-icon">${typeIcons[device.type] || ""}</span>
        <span class="panel-device-id">${device.deviceId}</span>
        ${statusBadge}
      </div>

      <div class="panel-info-grid">
        <div class="panel-info-item">
          <div class="panel-info-label">${t("devices.panel.type")}</div>
          <div class="panel-info-value">${t("dtype." + device.type)}</div>
        </div>
        <div class="panel-info-item">
          <div class="panel-info-label">${t("devices.panel.brandModel")}</div>
          <div class="panel-info-value">${device.brand} ${device.model}</div>
        </div>
        <div class="panel-info-item">
          <div class="panel-info-label">${t("devices.panel.home")}</div>
          <div class="panel-info-value">${device.homeName}</div>
        </div>
        <div class="panel-info-item">
          <div class="panel-info-label">${t("devices.panel.org")}</div>
          <div class="panel-info-value">${device.orgName}</div>
        </div>
        <div class="panel-info-item">
          <div class="panel-info-label">${t("devices.panel.commissioned")}</div>
          <div class="panel-info-value">${device.commissionDate}</div>
        </div>
        <div class="panel-info-item">
          <div class="panel-info-label">${t("devices.panel.lastSeen")}</div>
          <div class="panel-info-value">${device.lastSeen}</div>
        </div>
      </div>

      <div class="panel-section-title">${t("devices.panel.telemetry")}</div>
      ${this._buildTelemetrySection(device)}
    `;

    return html;
  },

  _buildTelemetrySection(device) {
    const telem = device.telemetry;

    if (telem.status === "offline") {
      return `<div style="padding:16px;text-align:center;color:var(--muted);font-size:0.88rem">
        ${t("devices.telem.noData")}
      </div>`;
    }

    let items = [];

    switch (device.type) {
      case "Inverter + Battery":
        items = [
          {
            value: formatNumber(telem.pvPower, 2) + " kW",
            label: t("devices.telem.pvPower"),
            color: "var(--positive)",
          },
          {
            value: telem.batterySoc + "%",
            label: t("devices.telem.batterySoc"),
            color: "var(--neutral)",
          },
          {
            value: formatNumber(telem.chargeRate, 2) + " kW",
            label: t("devices.telem.chargeRate"),
            color: "var(--neutral)",
          },
          {
            value: formatNumber(telem.gridExport, 2) + " kW",
            label: t("devices.telem.gridExport"),
            color: "var(--accent)",
          },
        ];
        break;
      case "Smart Meter":
        items = [
          {
            value: formatNumber(telem.consumption, 2) + " kW",
            label: t("devices.telem.consumption"),
            color: "var(--text)",
          },
          {
            value: formatNumber(telem.voltage, 1) + " V",
            label: t("devices.telem.voltage"),
            color: "var(--amber)",
          },
          {
            value: formatNumber(telem.current, 1) + " A",
            label: t("devices.telem.current"),
            color: "var(--accent)",
          },
          {
            value: formatNumber(telem.powerFactor, 2),
            label: t("devices.telem.powerFactor"),
            color: "var(--positive)",
          },
        ];
        break;
      case "AC":
        items = [
          {
            value: telem.on ? t("devices.telem.on") : t("devices.telem.off"),
            label: t("devices.telem.status"),
            color: telem.on ? "var(--positive)" : "var(--negative)",
          },
          {
            value: telem.setTemp + "\u00B0C",
            label: t("devices.telem.setTemp"),
            color: "var(--accent)",
          },
          {
            value: formatNumber(telem.roomTemp, 1) + "\u00B0C",
            label: t("devices.telem.roomTemp"),
            color: "var(--text)",
          },
          {
            value: formatNumber(telem.powerDraw, 2) + " kW",
            label: t("devices.telem.powerDraw"),
            color: "var(--amber)",
          },
        ];
        break;
      case "EV Charger":
        items = [
          {
            value: telem.charging
              ? t("devices.telem.charging")
              : t("devices.telem.idle"),
            label: t("devices.telem.status"),
            color: telem.charging ? "var(--positive)" : "var(--muted)",
          },
          {
            value: formatNumber(telem.chargeRate, 1) + " kW",
            label: t("devices.telem.chargeRate"),
            color: "var(--accent)",
          },
          {
            value: formatNumber(telem.sessionEnergy, 1) + " kWh",
            label: t("devices.telem.sessionEnergy"),
            color: "var(--neutral)",
          },
          {
            value: telem.evSoc + "%",
            label: t("devices.telem.evSoc"),
            color: "var(--positive)",
          },
        ];
        break;
    }

    return `<div class="panel-telemetry-grid">
      ${items
        .map(
          (item) => `
        <div class="panel-telemetry-item">
          <div class="panel-telemetry-value" style="color:${item.color}">${item.value}</div>
          <div class="panel-telemetry-label">${item.label}</div>
        </div>
      `,
        )
        .join("")}
    </div>`;
  },

  // =========================================================
  // COMMISSIONING WIZARD
  // =========================================================

  _wizardStep: 1,
  _wizardData: {},
  _wizardTimers: [],

  _openWizard() {
    this._wizardStep = 1;
    this._wizardData = {
      homeId: "HOME-001",
      gatewaySn: "",
      selectedDevices: UNASSIGNED_DEVICES.map((d) => d.deviceId),
      testResults: {},
    };
    this._wizardTimers = [];

    const overlay = document.createElement("div");
    overlay.className = "wizard-overlay";
    overlay.id = "commission-wizard";
    overlay.innerHTML = `
      <div class="wizard-header">
        <h2>${t("devices.wizard.title")}</h2>
        <button class="wizard-close" id="wizard-close">&times;</button>
      </div>
      <div class="wizard-progress" id="wizard-progress"></div>
      <div class="wizard-body" id="wizard-body"></div>
      <div class="wizard-footer" id="wizard-footer"></div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector("#wizard-close");
    closeBtn.addEventListener("click", () => this._closeWizard());

    requestAnimationFrame(() => {
      overlay.classList.add("open");
      this._renderWizardStep();
    });
  },

  _closeWizard() {
    this._wizardTimers.forEach((timer) => clearTimeout(timer));
    this._wizardTimers = [];

    const overlay = document.getElementById("commission-wizard");
    if (overlay) {
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), 250);
    }
  },

  _renderWizardStep() {
    this._renderProgressBar();
    this._renderStepContent();
    this._renderFooterButtons();
  },

  _renderProgressBar() {
    const container = document.getElementById("wizard-progress");
    if (!container) return;

    const stepKeys = [
      "devices.wizard.step.home",
      "devices.wizard.step.gateway",
      "devices.wizard.step.discover",
      "devices.wizard.step.test",
      "devices.wizard.step.done",
    ];
    let html = "";

    stepKeys.forEach((key, i) => {
      const num = i + 1;
      let circleClass = "wizard-step-circle";
      if (num < this._wizardStep) circleClass += " completed";
      else if (num === this._wizardStep) circleClass += " active";

      html += `<div class="wizard-step-item">
        <div class="${circleClass}">${num < this._wizardStep ? "\u2713" : num}</div>
      </div>`;

      if (i < stepKeys.length - 1) {
        const lineClass =
          num < this._wizardStep
            ? "wizard-step-line completed"
            : "wizard-step-line";
        html += `<div class="${lineClass}"></div>`;
      }
    });

    container.innerHTML = html;
  },

  _renderStepContent() {
    const body = document.getElementById("wizard-body");
    if (!body) return;

    switch (this._wizardStep) {
      case 1:
        this._renderStep1(body);
        break;
      case 2:
        this._renderStep2(body);
        break;
      case 3:
        this._renderStep3(body);
        break;
      case 4:
        this._renderStep4(body);
        break;
      case 5:
        this._renderStep5(body);
        break;
    }
  },

  _renderFooterButtons() {
    const footer = document.getElementById("wizard-footer");
    if (!footer) return;

    const step = this._wizardStep;
    let html = "";

    if (step > 1 && step < 5) {
      html +=
        '<button class="wizard-btn-back" id="wizard-back">' +
        t("shared.back") +
        "</button>";
    }

    if (step < 5) {
      const disabled = step === 3 || step === 4 ? " disabled" : "";
      html +=
        '<button class="wizard-btn-next" id="wizard-next"' +
        disabled +
        ">" +
        t("shared.next") +
        "</button>";
    } else {
      html +=
        '<button class="wizard-btn-done" id="wizard-done">' +
        t("shared.done") +
        "</button>";
    }

    footer.innerHTML = html;

    const backBtn = footer.querySelector("#wizard-back");
    const nextBtn = footer.querySelector("#wizard-next");
    const doneBtn = footer.querySelector("#wizard-done");

    if (backBtn) backBtn.addEventListener("click", () => this._wizardBack());
    if (nextBtn) nextBtn.addEventListener("click", () => this._wizardNext());
    if (doneBtn) doneBtn.addEventListener("click", () => this._wizardDone());
  },

  _wizardBack() {
    this._wizardTimers.forEach((timer) => clearTimeout(timer));
    this._wizardTimers = [];

    if (this._wizardStep > 1) {
      this._wizardStep--;
      this._renderWizardStep();
    }
  },

  _wizardNext() {
    if (this._wizardStep < 5) {
      this._wizardStep++;
      this._renderWizardStep();
    }
  },

  _wizardDone() {
    DemoStore.set("lastCommission", {
      homeId: this._wizardData.homeId,
      devices: this._wizardData.selectedDevices,
      timestamp: "04/03/2026 14:32",
    });
    this._closeWizard();
  },

  // ---- Step 1: Home Selection ----
  _renderStep1(body) {
    body.innerHTML = `
      <div class="wizard-step-content">
        <h3>${t("devices.wizard.s1.title")}</h3>
        <p>${t("devices.wizard.s1.desc")}</p>
        <div class="wizard-input-group">
          <label for="wizard-home-id">${t("devices.wizard.s1.label")}</label>
          <input type="text" id="wizard-home-id" value="${this._wizardData.homeId}" placeholder="HOME-001">
        </div>
      </div>
    `;

    const input = body.querySelector("#wizard-home-id");
    if (input) {
      input.addEventListener("input", () => {
        this._wizardData.homeId = input.value;
      });
    }
  },

  // ---- Step 2: Gateway Scan ----
  _renderStep2(body) {
    body.innerHTML = `
      <div class="wizard-step-content">
        <h3>${t("devices.wizard.s2.title")}</h3>
        <p>${t("devices.wizard.s2.desc")}</p>
        <div class="wizard-input-row">
          <div class="wizard-input-group">
            <label for="wizard-gateway-sn">${t("devices.wizard.s2.label")}</label>
            <input type="text" id="wizard-gateway-sn" value="${this._wizardData.gatewaySn}" placeholder="GW-2026-XXXX">
          </div>
          <button class="wizard-btn-scan" title="QR scan requires mobile device">${t("devices.wizard.s2.scan")}</button>
        </div>
      </div>
    `;

    const input = body.querySelector("#wizard-gateway-sn");
    if (input) {
      input.addEventListener("input", () => {
        this._wizardData.gatewaySn = input.value;
      });
    }
  },

  // ---- Step 3: Device Discovery (animated) ----
  _renderStep3(body) {
    body.innerHTML = `
      <div class="wizard-step-content">
        <h3>${t("devices.wizard.s3.title")}</h3>
        <p>${t("devices.wizard.s3.scanning")}</p>
        <div class="wizard-spinner">
          <div class="wizard-spinner-ring"></div>
          <div class="wizard-spinner-text">${t("devices.wizard.s3.discovering")}</div>
        </div>
      </div>
    `;

    const timer = setTimeout(() => {
      const content = body.querySelector(".wizard-step-content");
      if (!content) return;

      content.innerHTML = `
        <h3>${t("devices.wizard.s3.title")}</h3>
        <p>${t("devices.wizard.s3.found").replace("{n}", UNASSIGNED_DEVICES.length)}</p>
        <div class="wizard-device-list">
          ${UNASSIGNED_DEVICES.map(
            (d) => `
            <div class="wizard-device-item">
              <input type="checkbox" data-device-id="${d.deviceId}"
                ${this._wizardData.selectedDevices.includes(d.deviceId) ? "checked" : ""}>
              <div class="wizard-device-info">
                <div class="dev-id">${d.deviceId}</div>
                <div class="dev-detail">${t("dtype." + d.type)} \u2014 ${d.brand} ${d.model}</div>
              </div>
            </div>
          `,
          ).join("")}
        </div>
      `;

      content.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", () => {
          const id = cb.dataset.deviceId;
          if (cb.checked) {
            if (!this._wizardData.selectedDevices.includes(id)) {
              this._wizardData.selectedDevices = [
                ...this._wizardData.selectedDevices,
                id,
              ];
            }
          } else {
            this._wizardData.selectedDevices =
              this._wizardData.selectedDevices.filter((x) => x !== id);
          }
        });
      });

      const nextBtn = document.getElementById("wizard-next");
      if (nextBtn) nextBtn.disabled = false;
    }, 2000);

    this._wizardTimers.push(timer);
  },

  // ---- Step 4: Communication Test (animated) ----
  _renderStep4(body) {
    const devices = UNASSIGNED_DEVICES.filter((d) =>
      this._wizardData.selectedDevices.includes(d.deviceId),
    );

    body.innerHTML = `
      <div class="wizard-step-content">
        <h3>${t("devices.wizard.s4.title")}</h3>
        <p>${t("devices.wizard.s4.testing")}</p>
        <div class="wizard-progress-bar">
          <div class="wizard-progress-fill" id="wizard-test-progress" style="width:0%"></div>
        </div>
        <div id="wizard-test-results">
          ${devices
            .map(
              (d) => `
            <div class="wizard-test-item" id="test-${d.deviceId}">
              <span class="wizard-test-id">${d.deviceId}</span>
              <span>${t("dtype." + d.type)}</span>
              <span class="wizard-test-status pending" id="test-status-${d.deviceId}">${t("devices.wizard.s4.testingStatus")}</span>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;

    const delays = [1000, 1500, 2000, 3000];
    let completed = 0;

    devices.forEach((d, i) => {
      const delay = delays[i] || 1000 + i * 1000;
      const timer = setTimeout(() => {
        const statusEl = document.getElementById("test-status-" + d.deviceId);
        if (statusEl) {
          statusEl.className = "wizard-test-status pass";
          statusEl.textContent = t("devices.wizard.s4.pass");
        }
        this._wizardData.testResults[d.deviceId] = "pass";

        completed++;
        const progressEl = document.getElementById("wizard-test-progress");
        if (progressEl) {
          progressEl.style.width =
            Math.round((completed / devices.length) * 100) + "%";
        }

        if (completed === devices.length) {
          const nextBtn = document.getElementById("wizard-next");
          if (nextBtn) nextBtn.disabled = false;
        }
      }, delay);

      this._wizardTimers.push(timer);
    });
  },

  // ---- Step 5: Result Report ----
  _renderStep5(body) {
    const devices = UNASSIGNED_DEVICES.filter((d) =>
      this._wizardData.selectedDevices.includes(d.deviceId),
    );

    body.innerHTML = `
      <div class="wizard-step-content">
        <div class="wizard-success">
          <div class="wizard-success-icon">\u2705</div>
          <h3>${t("devices.wizard.s5.complete")}</h3>
          <p><strong>${t("devices.wizard.s5.home")}</strong> ${this._wizardData.homeId}</p>
          <p><strong>${t("devices.wizard.s5.devicesCom")}</strong> ${devices.length}</p>
          <p><strong>${t("devices.wizard.s5.elapsed")}</strong> 92 min</p>
        </div>

        <div class="wizard-result-list">
          ${devices
            .map(
              (d) => `
            <div class="wizard-result-item">
              <span>\u2705</span>
              <span class="dev-id">${d.deviceId}</span>
              <span>${t("dtype." + d.type)}</span>
              <span style="margin-left:auto;color:var(--positive);font-weight:600">${t("shared.online")}</span>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  },

  // =========================================================
  // COMMISSIONING HISTORY TABLE
  // =========================================================

  _buildCommissioningHistoryCard() {
    const table = Components.dataTable({
      columns: [
        {
          key: "homeId",
          label: t("devices.commHistory.col.homeId"),
          mono: true,
        },
        { key: "integrador", label: t("devices.commHistory.col.integrador") },
        { key: "start", label: t("devices.commHistory.col.start") },
        { key: "complete", label: t("devices.commHistory.col.complete") },
        {
          key: "durationMin",
          label: t("devices.commHistory.col.duration"),
          align: "right",
          mono: true,
          format: (val) => {
            const icon = val > 120 ? "\u26A0\uFE0F" : "\u2705";
            const cls = val > 120 ? "duration-warn" : "duration-ok";
            return `<span class="${cls}">${val} min ${icon}</span>`;
          },
        },
        {
          key: "devices",
          label: t("devices.commHistory.col.devices"),
          align: "right",
          mono: true,
        },
        {
          key: "firstTelemetry",
          label: t("devices.commHistory.col.firstTelemetry"),
        },
      ],
      rows: COMMISSIONING_HISTORY,
    });

    return Components.sectionCard(t("devices.commHistory"), table);
  },
};
