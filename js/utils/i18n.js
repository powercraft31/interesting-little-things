// ============================================
// SOLFACIL - Internationalization (i18n) Module
// Manages translations and language switching
// ============================================

const translations = {};
let currentLanguage = localStorage.getItem('solfacilLanguage') || 'zh';
const changeListeners = [];

export async function loadTranslations() {
    const langs = ['zh', 'en', 'pt'];
    const results = await Promise.all(
        langs.map(lang =>
            fetch(`js/i18n/${lang}.json`)
                .then(res => res.json())
                .then(data => ({ lang, data }))
        )
    );
    results.forEach(({ lang, data }) => {
        translations[lang] = data;
    });
}

export function t(key) {
    return (translations[currentLanguage] && translations[currentLanguage][key])
        || (translations['pt'] && translations['pt'][key])
        || key;
}

export function getLanguage() {
    return currentLanguage;
}

export function setLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('solfacilLanguage', lang);
    updateAllTranslations();
    changeListeners.forEach(fn => fn(lang));
}

export function onLanguageChange(fn) {
    changeListeners.push(fn);
}

export function updateAllTranslations() {
    // Update all elements with data-translate attribute
    document.querySelectorAll('[data-translate]').forEach(elem => {
        const key = elem.getAttribute('data-translate');
        const translation = translations[currentLanguage] && translations[currentLanguage][key];
        if (translation) {
            elem.textContent = translation;
        }
    });

    // Subtitle (compound text)
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) subtitle.textContent = `${t('energy_management')} | ${t('fintech_solar')}`;

    // Language buttons active state
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLanguage);
    });

    // Page language attribute and title
    const langMap = { 'zh': 'zh-CN', 'en': 'en', 'pt': 'pt-BR' };
    document.documentElement.lang = langMap[currentLanguage] || 'pt-BR';
    document.title = `${t('solfacil')} - ${t('energy_management')}`;
}
