// ============================================
// SOLFACIL - Trades Module
// Trade table population and trade modal logic
// ============================================

import { t } from '../utils/i18n.js';
import { showInfoModal, hideModal, setupBackdropClose } from '../utils/modal.js';
import { getTrades } from './data.js';

export function populateTrades() {
    const table = document.getElementById('tradeTable');
    if (!table) return;

    const trades = getTrades();

    trades.forEach(trade => {
        const row = document.createElement('tr');
        const opText = t(trade.operacao);
        const opClass = trade.operacao.includes('buy') ? 'op-buy' :
                        trade.operacao.includes('sell') ? 'op-sell' : 'op-hold';
        const statusClass = trade.status === 'executed' ? 'status-done' :
                           trade.status === 'executing' ? 'status-active' : 'status-pending';
        const tariffText = t(trade.tarifa);
        const tariffCssClass = trade.tarifa === 'peak' ? 'tariff-ponta' :
                               trade.tarifa === 'off_peak' ? 'tariff-fora-ponta' : 'tariff-intermediaria';

        row.innerHTML = `
            <td>${trade.time}</td>
            <td><span class="tariff-badge ${tariffCssClass}">${tariffText}</span></td>
            <td><span class="op-badge ${opClass}">${opText}</span></td>
            <td>${trade.preco}</td>
            <td>${trade.volume}</td>
            <td class="${trade.resultado.startsWith('+') ? 'profit-text' : trade.resultado.startsWith('-') ? 'cost-text' : ''}">${trade.resultado}</td>
            <td><span class="trade-status ${statusClass}">${t(trade.status)}</span></td>
        `;
        table.appendChild(row);
    });
}

export function refreshTrades() {
    const table = document.getElementById('tradeTable');
    if (table) {
        table.innerHTML = '';
        populateTrades();
    }
}

// ============================================
// Trade Opportunity Modal
// ============================================

export function simulateTradeOpportunity() {
    const modal = document.getElementById('tradeModal');
    if (modal) modal.classList.add('show');
}

export function acceptTrade() {
    const title = t('trade_executed_msg');
    const msg = `${t('selling_detail')}\n${t('profit_estimate_10k')}\n\n${t('operation_registered')}`;
    hideModal('tradeModal');
    showInfoModal(title, msg, { icon: 'success' });
}

export function viewDetails() {
    const sep = '━━━━━━━━━━━━━━━━━━━━━━━━';
    const title = t('opportunity_details_title');
    const msg = `${sep}\n` +
        `${t('detail_capacity')}\n` +
        `${t('detail_assets_online')}\n` +
        `${t('detail_avg_soc')}\n` +
        `${t('detail_spot_price')}\n` +
        `${t('detail_avg_charge')}\n` +
        `${t('detail_gross_margin')}\n` +
        `${t('detail_est_revenue')}\n` +
        `${t('detail_est_net_profit')}`;
    showInfoModal(title, msg, { icon: 'info' });
}

export function rejectTrade() {
    hideModal('tradeModal');
}

export function setupTradeModal() {
    setupBackdropClose('tradeModal', () => hideModal('tradeModal'));
}
