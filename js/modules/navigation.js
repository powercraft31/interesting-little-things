// ============================================
// SOLFACIL - Navigation Module
// Tab navigation and section switching
// ============================================

export function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSection = item.getAttribute('data-section');
            navigateTo(targetSection);
        });
    });
}

export function navigateTo(sectionId) {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');

    navItems.forEach(nav => {
        nav.classList.remove('active');
        if (nav.getAttribute('data-section') === sectionId) {
            nav.classList.add('active');
        }
    });

    sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === sectionId) {
            section.classList.add('active');
        }
    });
}
