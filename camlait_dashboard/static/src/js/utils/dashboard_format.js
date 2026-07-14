/** @odoo-module **/

// Formatage partage entre le composant principal (dashboard_main.js) et
// les sous-composants de carte (stock_card.js, achats_card.js,
// ventes_card.js) et les modales. Avant le decoupage en sous-composants,
// formatAmount/formatQty etaient des methodes du seul composant
// CamlaitDashboard ; en les sortant ici, on garantit qu'il n'existe
// qu'une seule implementation, utilisee partout de la meme facon.

export function formatAmount(val) {
    if (!val && val !== 0) return '0';
    if (val >= 1000000) return (val / 1000000).toFixed(1) + ' M';
    if (val >= 1000) return new Intl.NumberFormat('fr-FR').format(Math.round(val));
    return String(Math.round(val));
}

export function formatQty(v) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(v || 0));
}
