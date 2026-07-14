/** @odoo-module **/

import { formatAmount, formatQty } from "@camlait_dashboard/js/utils/dashboard_format";

const { Component } = owl;
const { xml } = owl.tags;

// Carte "Stock" (onglet Tab 3 du dashboard). Extrait de dashboard_main.js
// (qui faisait ~1900 lignes dans un seul composant OWL) pour isoler la
// logique et le template propres au stock du reste du dashboard.
//
// Ce composant ne recalcule et ne detient aucune donnee lui-meme : il
// recoit le composant principal via la prop `comp` et lit son state
// (comp.state), qui reste le meme objet reactif useState() cree dans
// dashboard_main.js -- donc toujours a jour, sans copie ni etat local
// duplique. Les actions (ouvrir une liste filtree, etc.) restent
// implementees une seule fois sur le composant principal et sont
// simplement appelees d'ici via `comp.xxx()`.
export class StockCard extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
        this.formatAmount = formatAmount;
        this.formatQty = formatQty;
    }
}

StockCard.template = xml`
<div class="camlait_cards_grid">
    <div class="camlait_card camlait_card_wide">
        <div class="camlait_card_header">
            <div class="camlait_card_icon_wrap"><i class="fa fa-cubes"/></div>
            <h3>Etat du stock</h3>
        </div>
        <div class="camlait_stock_grid">
            <div class="camlait_kpi_btn camlait_kpi_blue" t-on-click="() => comp.openStock()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-database"/></span><span class="camlait_kpi_label">Produits en stock</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.stock.produits_en_stock"/><span class="camlait_kpi_unit">ref.</span></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_orange" t-on-click="() => comp.openStockAlert()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-arrow-down"/></span><span class="camlait_kpi_label">Sous seuil minimum</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.stock.sous_seuil"/><span class="camlait_kpi_unit">ref.</span></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_red" t-on-click="() => comp.openStockRuptures()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-times-circle"/></span><span class="camlait_kpi_label">Ruptures</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.stock.ruptures"/><span class="camlait_kpi_unit">ref.</span></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_neutral" t-on-click="() => comp.openStockRotation()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-refresh"/></span><span class="camlait_kpi_label">Rotation moy. stock</span></div>
                <span class="camlait_kpi_value"><t t-esc="state.stock.rotation_stock"/><span class="camlait_kpi_unit">j</span></span>
            </div>
            <div class="camlait_kpi_btn camlait_kpi_green camlait_kpi_wide" t-on-click="() => comp.openStock()">
                <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-money"/></span><span class="camlait_kpi_label">Valeur totale du stock</span></div>
                <span class="camlait_kpi_value camlait_kpi_large"><t t-esc="formatAmount(state.stock.valeur_stock)"/><span class="camlait_kpi_unit">FCFA</span></span>
            </div>
        </div>
        <div class="camlait_progress_section">
            <div class="camlait_progress_item">
                <div class="camlait_progress_label"><span><i class="fa fa-check-circle"/> Taux de disponibilite</span><span class="camlait_progress_pct"><t t-esc="state.stock.taux_dispo"/>%</span></div>
                <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_green" t-att-style="'width:' + state.stock.taux_dispo + '%'"/></div>
            </div>
            <div class="camlait_progress_item">
                <div class="camlait_progress_label"><span><i class="fa fa-exclamation-triangle"/> Produits perimes / a surveiller</span><span class="camlait_progress_pct"><t t-esc="state.stock.pct_perime"/>%</span></div>
                <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_red" t-att-style="'width:' + state.stock.pct_perime + '%'"/></div>
            </div>
        </div>
        <div class="camlait_statuts_section">
            <div class="camlait_statuts_title"><i class="fa fa-building"/> Statuts entrepots</div>
            <div class="camlait_statuts_list">
                <t t-foreach="state.stock.statuts" t-as="s">
                    <span t-att-class="'camlait_statut_badge camlait_statut_' + s.statut"><t t-esc="s.label"/></span>
                </t>
            </div>
        </div>
    </div>

    <div class="camlait_row3">
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-exclamation-triangle"/></div>
                <h3>Produits sous seuil / en rupture</h3>
                <span class="camlait_link" t-on-click="() => comp.openStockAlert()">Voir tout</span>
            </div>
            <table class="camlait_table">
                <thead><tr><th>PRODUIT</th><th class="camlait_th_right">STOCK</th><th class="camlait_th_right">SEUIL</th><th>STATUT</th></tr></thead>
                <tbody>
                    <t t-foreach="state.produits_sous_seuil_liste" t-as="p">
                        <tr>
                            <td><t t-esc="p.product"/></td>
                            <td class="camlait_td_right"><t t-esc="formatQty(p.stock)"/></td>
                            <td class="camlait_td_right"><t t-esc="formatQty(p.seuil)"/></td>
                            <td><span t-attf-class="camlait_statut_badge camlait_statut_{{p.statut==='rupture'?'danger':(p.statut==='critique'?'danger':'warn')}}"><t t-esc="p.label"/></span></td>
                        </tr>
                    </t>
                </tbody>
            </table>
            <t t-if="!state.produits_sous_seuil_liste.length"><div class="camlait_empty">Aucun produit sous le seuil.</div></t>
        </div>
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-warehouse"/></div>
                <h3>Etat par emplacement</h3>
            </div>
            <div class="camlait_statuts_list">
                <t t-foreach="state.stock_emplacements" t-as="e">
                    <span t-attf-class="camlait_statut_badge camlait_statut_{{e.statut}}"><t t-esc="e.label"/> - <t t-esc="e.statut_label"/></span>
                </t>
                <t t-if="!state.stock_emplacements.length"><div class="camlait_empty">Aucun emplacement detaille.</div></t>
            </div>
        </div>
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-bell"/></div>
                <h3>Alertes stock</h3>
                <span class="camlait_badge_urgence" t-if="state.alertes_stock.length"><t t-esc="state.alertes_stock.length"/> urgentes</span>
            </div>
            <div class="camlait_alertes_list">
                <t t-foreach="state.alertes_stock" t-as="al">
                    <div t-attf-class="camlait_alerte camlait_alerte_{{al.type}}">
                        <i t-attf-class="fa {{al.icon}} camlait_alerte_icon"/>
                        <span class="camlait_alerte_msg"><t t-esc="al.msg"/></span>
                    </div>
                </t>
                <t t-if="!state.alertes_stock.length"><div class="camlait_empty">Aucune alerte stock.</div></t>
            </div>
        </div>
    </div>
</div>
`;
