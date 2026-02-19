// ============================================
// SOLFACIL - Formatting Utilities
// Currency, number, and date formatting
// ============================================

export function formatCurrency(value) {
    return 'R$ ' + value.toLocaleString('pt-BR');
}

export function formatCurrencyK(value) {
    return 'R$ ' + (value / 1000).toFixed(0) + 'k';
}

export function formatCurrencyM(value) {
    return 'R$ ' + (value / 1000000).toFixed(1) + 'M';
}

export function formatPercent(value) {
    return value.toFixed(1) + '%';
}

export function formatNumber(value) {
    return value.toLocaleString('pt-BR');
}

export function formatDate(locale) {
    const now = new Date();
    const localeMap = { 'zh': 'zh-CN', 'en': 'en-US', 'pt': 'pt-BR' };
    const resolvedLocale = localeMap[locale] || 'pt-BR';
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return now.toLocaleDateString(resolvedLocale, options);
}
