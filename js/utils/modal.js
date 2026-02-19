// ============================================
// SOLFACIL - Custom Modal Utility
// Replaces native alert() with styled modals
// ============================================

let infoModal = null;

function ensureInfoModal() {
    if (infoModal) return;
    infoModal = document.getElementById('infoModal');
    if (!infoModal) return;

    // Close on backdrop click
    infoModal.addEventListener('click', (e) => {
        if (e.target === infoModal) {
            closeInfoModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && infoModal.classList.contains('show')) {
            closeInfoModal();
        }
    });
}

/**
 * Show an info/success message in a styled modal (replaces alert())
 * @param {string} title - Modal title
 * @param {string} message - Message content (supports newlines)
 * @param {object} options - { icon: 'info'|'success'|'warning', buttonText: string }
 */
export function showInfoModal(title, message, options = {}) {
    ensureInfoModal();
    if (!infoModal) return;

    const { icon = 'info', buttonText = 'OK' } = options;

    const iconMap = {
        info: { name: 'info', class: 'info-icon' },
        success: { name: 'check_circle', class: 'success-icon' },
        warning: { name: 'warning', class: '' }
    };

    const iconConfig = iconMap[icon] || iconMap.info;

    const titleEl = infoModal.querySelector('.info-modal-title');
    const iconEl = infoModal.querySelector('.info-modal-icon');
    const bodyEl = infoModal.querySelector('.info-modal-body');
    const btnEl = infoModal.querySelector('.info-modal-btn');

    if (titleEl) titleEl.textContent = title;
    if (iconEl) {
        iconEl.textContent = iconConfig.name;
        iconEl.className = `material-icons modal-icon ${iconConfig.class}`;
    }
    if (bodyEl) bodyEl.textContent = message;
    if (btnEl) btnEl.textContent = buttonText;

    infoModal.classList.add('show');
}

export function closeInfoModal() {
    if (infoModal) {
        infoModal.classList.remove('show');
    }
}

/**
 * Show a generic modal by ID
 */
export function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('show');
}

/**
 * Hide a generic modal by ID
 */
export function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
}

/**
 * Setup backdrop click to close for a modal
 */
export function setupBackdropClose(modalId, closeFn) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeFn();
            }
        });
    }
}
