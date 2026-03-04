/* ============================================
   SOLFACIL Admin Portal — Shared UI Components
   KPI card generator, table generator, skeleton screens
   ============================================ */

const Components = {
  /**
   * Create a KPI card HTML string
   * @param {Object} opts - { value, label, color, suffix, prefix }
   */
  kpiCard(opts) {
    const colorClass = opts.color || "";
    const prefix = opts.prefix || "";
    const suffix = opts.suffix || "";
    const valueClass = colorClass
      ? `kpi-value no-prefix ${colorClass}`
      : "kpi-value no-prefix";

    return `
      <div class="kpi-card">
        <div class="${valueClass}">${prefix}${opts.value}${suffix}</div>
        <div class="kpi-label">${opts.label}</div>
      </div>
    `;
  },

  /**
   * Create a data table HTML string
   * @param {Object} opts - { columns: [{key, label, align, format}], rows: [...], emptyText }
   */
  dataTable(opts) {
    const columns = opts.columns || [];
    const rows = opts.rows || [];
    const emptyText = opts.emptyText || "No data available";

    let html = '<div class="data-table-wrapper"><table class="data-table">';

    // Header
    html += "<thead><tr>";
    columns.forEach((col) => {
      const alignClass = col.align === "right" ? ' class="text-right"' : "";
      html += `<th${alignClass}>${col.label}</th>`;
    });
    html += "</tr></thead>";

    // Body
    html += "<tbody>";
    if (rows.length === 0) {
      html += `<tr><td colspan="${columns.length}" class="table-empty">${emptyText}</td></tr>`;
    } else {
      rows.forEach((row) => {
        html += "<tr>";
        columns.forEach((col) => {
          const val = row[col.key];
          const alignClass = col.align === "right" ? " text-right" : "";
          const dataClass = col.mono ? " font-data" : "";
          const formatted = col.format
            ? col.format(val, row)
            : val !== undefined
              ? val
              : "—";
          html += `<td class="${alignClass}${dataClass}">${formatted}</td>`;
        });
        html += "</tr>";
      });
    }
    html += "</tbody></table></div>";

    return html;
  },

  /**
   * Create skeleton KPI cards
   * @param {number} count
   */
  skeletonKPIs(count) {
    let html = '<div class="kpi-grid kpi-grid-6">';
    for (let i = 0; i < count; i++) {
      html +=
        '<div class="kpi-card"><div class="skeleton skeleton-heading"></div><div class="skeleton skeleton-text short"></div></div>';
    }
    html += "</div>";
    return html;
  },

  /**
   * Create skeleton table
   * @param {number} rows
   */
  skeletonTable(rows) {
    let html = '<div class="skeleton-table">';
    html += '<div class="skeleton skeleton-table-header"></div>';
    for (let i = 0; i < rows; i++) {
      html += '<div class="skeleton skeleton-table-row"></div>';
    }
    html += "</div>";
    return html;
  },

  /**
   * Create skeleton chart
   */
  skeletonChart() {
    return '<div class="skeleton skeleton-chart"></div>';
  },

  /**
   * Status badge HTML
   * @param {string} status - 'online' | 'offline' | 'warning' | 'neutral'
   * @param {string} text
   */
  statusBadge(status, text) {
    return `<span class="status-badge status-${status}">${text}</span>`;
  },

  /**
   * Create a section card with header and body
   * @param {string} title
   * @param {string} bodyHTML
   * @param {Object} opts - { headerRight, dataRole }
   */
  sectionCard(title, bodyHTML, opts) {
    opts = opts || {};
    const roleAttr = opts.dataRole ? ` data-role="${opts.dataRole}"` : "";
    const rightHTML = opts.headerRight || "";
    return `
      <div class="section-card"${roleAttr}>
        <div class="section-card-header">
          <h3>${title}</h3>
          ${rightHTML ? `<div>${rightHTML}</div>` : ""}
        </div>
        <div class="section-card-body">
          ${bodyHTML}
        </div>
      </div>
    `;
  },

  /**
   * Render content into a container with skeleton loading animation
   * Shows skeleton for 500ms, then renders real content
   * @param {HTMLElement} container
   * @param {string} skeletonHTML
   * @param {string} realHTML
   * @param {Function} afterRender - callback after real content is rendered
   */
  renderWithSkeleton(container, skeletonHTML, realHTML, afterRender) {
    container.innerHTML = skeletonHTML;
    setTimeout(() => {
      container.innerHTML = realHTML;
      if (afterRender) afterRender();
    }, 500);
  },
};
