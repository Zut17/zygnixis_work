/** @odoo-module **/

import { formatAmount } from "@camlait_dashboard/js/utils/dashboard_format";

const { Component } = owl;
const { xml } = owl.tags;

// Carte "Achats" (onglet Tab 2). Voir stock_card.js pour le principe :
// aucune donnee locale, tout vient de comp.state (comp = composant
// principal, passe en prop), les actions restent centralisees sur comp.
export class AchatsCard extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
        this.formatAmount = formatAmount;
    }
}

AchatsCard.template = xml`
<div class="camlait_cards_grid">
    <t t-if="!state.achats.has_data">
        <div class="camlait_card camlait_card_wide"><div class="camlait_no_data"><i class="fa fa-info-circle"/> Aucune donnee sur cette periode</div></div>
    </t>
    <t t-else="">
    <div class="camlait_card camlait_card_wide">
        <div class="camlait_card_header">
            <div class="camlait_card_icon_wrap"><i class="fa fa-shopping-cart"/></div>
            <h3>Achats - Bons de commande</h3>
        </div>
        <div class="camlait_kpi_grid">
            <div class="camlait_kpi_btn camlait_kpi_green" t-on-click="() => comp.openPurchaseConfirmed()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-check"/></span><span class="camlait_kpi_label">BdC valides ce mois</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.achats.bdc_valides"/></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_orange" t-on-click="() => comp.openPurchaseDraft()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-clock-o"/></span><span class="camlait_kpi_label">En attente validation</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.achats.bdc_en_attente"/></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_red" t-on-click="() => comp.openPurchaseLate()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-exclamation-triangle"/></span><span class="camlait_kpi_label">En retard fournisseur</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.achats.bdc_en_retard"/></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_blue camlait_kpi_wide" t-on-click="() => comp.openPurchaseAnalysis()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-money"/></span><span class="camlait_kpi_label">Montant total engage</span></div>
                <span class="camlait_kpi_value camlait_kpi_large"><t t-esc="formatAmount(state.achats.montant_total_engage)"/><span class="camlait_kpi_unit">FCFA</span></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_neutral" t-on-click="() => comp.openSuppliers()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-building"/></span><span class="camlait_kpi_label">Fournisseurs actifs</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.achats.fournisseurs_actifs"/></span>
            </div>
        </div>
        <div class="camlait_progress_section">
            <div class="camlait_progress_item">
                <div class="camlait_progress_label"><span><i class="fa fa-truck"/> Taux reception dans delais</span><span class="camlait_progress_pct"><t t-esc="state.achats.taux_reception_delais"/>%</span></div>
                <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_green" t-att-style="'width:' + state.achats.taux_reception_delais + '%'"/></div>
            </div>
            <div class="camlait_progress_item">
                <div class="camlait_progress_label"><span><i class="fa fa-pie-chart"/> Budget achats consomme</span><span class="camlait_progress_pct"><t t-esc="state.achats.budget_consomme"/>%</span></div>
                <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_blue" t-att-style="'width:' + state.achats.budget_consomme + '%'"/></div>
            </div>
        </div>
    </div>

    <div class="camlait_row3">
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-file-text"/></div>
                <h3>Bons de commande recents</h3>
                <span class="camlait_link" t-on-click="() => comp.openRecentPurchaseOrders()">Voir tout</span>
            </div>
            <table class="camlait_table">
                <thead><tr><th>N</th><th>FOURNISSEUR</th><th class="camlait_th_right">MONTANT</th><th>STATUT</th></tr></thead>
                <tbody>
                    <t t-foreach="state.bons_commande_recents" t-as="po">
                        <tr>
                            <td class="camlait_link_cell"><t t-esc="po.name"/></td>
                            <td><t t-esc="po.fournisseur"/></td>
                            <td class="camlait_td_right"><t t-esc="formatAmount(po.montant)"/></td>
                            <td><span t-attf-class="camlait_statut camlait_statut_{{po.statut==='recu'?'livre':(po.statut==='attente'?'en_cours':(po.statut==='annule'?'annule':'en_cours'))}}"><t t-esc="po.label"/></span></td>
                        </tr>
                    </t>
                </tbody>
            </table>
        </div>
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-tags"/></div>
                <h3>Achats par categorie</h3>
            </div>
            <div class="camlait_progress_section" style="margin-top:0; padding-top:0; border-top:none;">
                <t t-foreach="state.achats_categories" t-as="cat">
                    <div class="camlait_progress_item">
                        <div class="camlait_progress_label"><span><t t-esc="cat.label"/></span><span class="camlait_progress_pct"><t t-esc="cat.pct"/>%</span></div>
                        <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_blue" t-att-style="'width:' + cat.pct + '%'"/></div>
                    </div>
                </t>
                <t t-if="!state.achats_categories.length"><div class="camlait_empty">Aucune categorie de produit renseignee.</div></t>
            </div>
        </div>
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-bell"/></div>
                <h3>Alertes achats</h3>
                <span class="camlait_badge_urgence" t-if="state.alertes_achats.length"><t t-esc="state.alertes_achats.length"/> urgentes</span>
            </div>
            <div class="camlait_alertes_list">
                <t t-foreach="state.alertes_achats" t-as="al">
                    <div t-attf-class="camlait_alerte camlait_alerte_{{al.type}}">
                        <i t-attf-class="fa {{al.icon}} camlait_alerte_icon"/>
                        <span class="camlait_alerte_msg"><t t-esc="al.msg"/></span>
                    </div>
                </t>
                <t t-if="!state.alertes_achats.length"><div class="camlait_empty">Aucune alerte achats.</div></t>
            </div>
        </div>
    </div>
    </t>
</div>
`;
