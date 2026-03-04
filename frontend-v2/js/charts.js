/* ============================================
   SOLFACIL Admin Portal — ECharts Factory

   CRITICAL RULES:
   1. All charts MUST go through createChart() — never direct echarts.init()
   2. Before init, check echarts.getInstanceByDom() — reuse if exists
   3. Bind ResizeObserver to auto chart.resize()
   4. NEVER init when container has display:none — defer via requestAnimationFrame
   5. activatePageCharts(pageId) called by router after page switch
   ============================================ */

const Charts = {
  // Registry of chart containers by page
  _registry: {}, // { pageId: [containerId, ...] }
  _observers: {}, // { containerId: ResizeObserver }
  _pendingOptions: {}, // { containerId: { option, opts } }

  /**
   * Get theme-aware color overrides for ECharts.
   * Applied AFTER the base option so charts look correct in both dark and light modes.
   */
  _getThemeOverrides() {
    var isLight = document.body.dataset.theme === "light";
    if (isLight) {
      return {
        tooltip: {
          backgroundColor: "#ffffff",
          borderColor: "#e2e4e9",
          textStyle: { color: "#1a1d27" },
          extraCssText:
            "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.12);",
        },
        legend: {
          textStyle: { color: "#6b7280" },
        },
      };
    }
    // Dark theme — explicit overrides to reset from light
    return {
      tooltip: {
        backgroundColor: "#1a1d27",
        borderColor: "#2a2d3a",
        textStyle: { color: "#e4e4e7" },
        extraCssText:
          "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);",
      },
      legend: {
        textStyle: { color: "#9ca3af" },
      },
    };
  },

  /**
   * Get axis overrides for current theme
   */
  _getAxisOverrides() {
    var isLight = document.body.dataset.theme === "light";
    if (isLight) {
      return {
        axisLine: { lineStyle: { color: "#e2e4e9" } },
        axisTick: { lineStyle: { color: "#e2e4e9" } },
        axisLabel: { color: "#6b7280" },
        splitLine: { lineStyle: { color: "rgba(226, 228, 233, 0.8)" } },
        nameTextStyle: { color: "#6b7280" },
      };
    }
    return {
      axisLine: { lineStyle: { color: "#2a2d3a" } },
      axisTick: { lineStyle: { color: "#2a2d3a" } },
      axisLabel: { color: "#9ca3af" },
      splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
      nameTextStyle: { color: "#9ca3af" },
    };
  },

  /**
   * Register a chart container for a page
   */
  register(pageId, containerId) {
    if (!this._registry[pageId]) this._registry[pageId] = [];
    if (!this._registry[pageId].includes(containerId)) {
      this._registry[pageId].push(containerId);
    }
  },

  /**
   * Create or update a chart
   * Singleton: reuse existing instance, never duplicate init
   */
  createChart(containerId, option, opts) {
    opts = opts || {};
    var container = document.getElementById(containerId);
    if (!container) {
      console.warn("[Charts] container not found:", containerId);
      return null;
    }

    // Register for page activation
    if (opts.pageId) {
      this.register(opts.pageId, containerId);
    }

    // Store option for deferred init
    this._pendingOptions[containerId] = { option: option, opts: opts };

    // Check if container is visible (not display:none)
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      return null;
    }

    return this._initOrUpdate(containerId, option);
  },

  /**
   * Dispose all charts for a page before re-init (prevents DOM orphans)
   */
  disposePageCharts(pageId) {
    var containerIds = this._registry[pageId] || [];
    var self = this;
    containerIds.forEach(function (id) {
      var container = document.getElementById(id);
      if (container) {
        var chart = echarts.getInstanceByDom(container);
        if (chart) chart.dispose();
      }
      // Disconnect stale observer — will be rebound on next init
      if (self._observers[id]) {
        self._observers[id].disconnect();
        delete self._observers[id];
      }
      delete self._pendingOptions[id];
    });
  },

  /**
   * Internal: init or update chart instance, then apply theme overrides
   */
  _initOrUpdate(containerId, option) {
    var container = document.getElementById(containerId);
    if (!container) return null;

    // Singleton: check for existing instance — but verify it's on the SAME DOM node
    var chart = echarts.getInstanceByDom(container);
    if (chart) {
      chart.setOption(option, { notMerge: false });
    } else {
      // New init
      chart = echarts.init(container, null, { renderer: "canvas" });
      chart.setOption(option);
    }

    // Always (re)bind ResizeObserver to the CURRENT DOM node
    if (this._observers[containerId]) {
      this._observers[containerId].disconnect();
    }
    var observer = new ResizeObserver(function () {
      var inst = echarts.getInstanceByDom(container);
      if (inst) inst.resize();
    });
    observer.observe(container);
    this._observers[containerId] = observer;

    // Apply theme overrides (tooltip, legend colors)
    var themeOverrides = this._getThemeOverrides();
    chart.setOption(themeOverrides, { notMerge: false });

    // Apply axis overrides if chart has xAxis/yAxis
    var axisOverrides = this._getAxisOverrides();
    var axisOption = {};

    // Detect if chart has xAxis/yAxis by checking the option
    if (option.xAxis) {
      axisOption.xAxis = Array.isArray(option.xAxis)
        ? option.xAxis.map(function () {
            return axisOverrides;
          })
        : axisOverrides;
    }
    if (option.yAxis) {
      axisOption.yAxis = Array.isArray(option.yAxis)
        ? option.yAxis.map(function () {
            return axisOverrides;
          })
        : axisOverrides;
    }
    if (axisOption.xAxis || axisOption.yAxis) {
      chart.setOption(axisOption, { notMerge: false });
    }

    chart.resize();
    return chart;
  },

  /**
   * Activate all charts for a page after it becomes visible
   * Called by router AFTER page section display:block
   */
  activatePageCharts(pageId) {
    var containerIds = this._registry[pageId] || [];
    if (containerIds.length === 0) return;
    var self = this;

    // Use rAF to wait for layout reflow after display:block
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        containerIds.forEach(function (id) {
          var pending = self._pendingOptions[id];
          if (pending) {
            self._initOrUpdate(id, pending.option);
            // Keep in _pendingOptions for theme refresh — but mark as initialized
          } else {
            // Just resize existing
            var container = document.getElementById(id);
            if (container) {
              var chart = echarts.getInstanceByDom(container);
              if (chart) chart.resize();
            }
          }
        });
      });
    });
  },

  /**
   * Refresh all visible charts with current theme colors.
   * Called after role/theme switch.
   */
  refreshTheme() {
    var self = this;
    Object.keys(this._pendingOptions).forEach(function (id) {
      var container = document.getElementById(id);
      if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        var pending = self._pendingOptions[id];
        if (pending) {
          self._initOrUpdate(id, pending.option);
        }
      }
    });
  },
};
