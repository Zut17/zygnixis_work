/** @odoo-module **/

import { formatAmount, formatQty } from "@camlait_dashboard/js/utils/dashboard_format";

const { Component } = owl;
const { xml } = owl.tags;

// Carte "Ventes" (onglet Tab 1). Voir stock_card.js pour le principe :
// aucune donnee locale, tout vient de comp.state (comp = composant
// principal, passe en prop), les actions restent centralisees sur comp.
// Contient aussi les 2 canvas Chart.js (evolution CA / repartition par
// canal) : les instances Chart.js elles-memes restent gerees et dessinees
// par le composant principal (_drawCharts()), qui cible ces <canvas> par
// id apres le rendu -- aucun changement de comportement necessaire ici.
export class VentesCard extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
        this.formatAmount = formatAmount;
        this.formatQty = formatQty;
    }
}

VentesCard.template = xml`
<div class="camlait_cards_grid">
    <t t-if="!state.ventes.has_data">
        <div class="camlait_card camlait_card_wide"><div class="camlait_no_data"><i class="fa fa-info-circle"/> Aucune donnee sur cette periode</div></div>
    </t>
    <t t-else="">
    <div class="camlait_card camlait_card_wide">
        <div class="camlait_kpi_row4" style="margin-bottom:0;">
            <div class="camlait_kpi4_card" t-on-click="() => comp.openSaleAnalysis()">
                <div class="camlait_kpi4_header"><span class="camlait_kpi4_label">Chiffre d affaires</span><span class="camlait_kpi4_icon camlait_icon_purple"><i class="fa fa-line-chart"/></span></div>
                <div class="camlait_kpi4_value"><t t-esc="formatAmount(state.ventes.ca_total)"/></div>
                <div t-att-class="'camlait_kpi4_delta ' + (state.ventes.ca_delta>=0?'pos':'neg')">
                    <i t-att-class="'fa ' + (state.ventes.ca_delta>=0?'fa-arrow-up':'fa-arrow-down')"/>
                    <t t-esc="(state.ventes.ca_delta>=0?'+':'') + state.ventes.ca_delta"/>% vs periode prec.
                </div>
                <div class="camlait_kpi4_progress"><div class="camlait_kpi4_progress_fill camlait_prog_purple" t-att-style="'width:' + Math.min(100, Math.round(state.ventes.ca_total/state.ventes.objectif_ca*100)) + '%'"/></div>
                <div class="camlait_kpi4_sub"><t t-esc="Math.round(state.ventes.ca_total/state.ventes.objectif_ca*100)"/>% de l objectif mensuel</div>
            </div>
            <div class="camlait_kpi4_card" t-on-click="() => comp.openSaleConfirmed()">
                <div class="camlait_kpi4_header"><span class="camlait_kpi4_label">Commandes confirmees</span><span class="camlait_kpi4_icon camlait_icon_green"><i class="fa fa-check"/></span></div>
                <div class="camlait_kpi4_value"><t t-esc="state.ventes.commandes_confirmees"/></div>
                <div t-att-class="'camlait_kpi4_delta ' + (state.ventes.cmd_delta>=0?'pos':'neg')">
                    <i t-att-class="'fa ' + (state.ventes.cmd_delta>=0?'fa-arrow-up':'fa-arrow-down')"/>
                    <t t-esc="(state.ventes.cmd_delta>=0?'+':'') + state.ventes.cmd_delta"/>% vs periode prec.
                </div>
                <div class="camlait_kpi4_sub"><t t-esc="state.ventes.commandes_livrees"/> livrees</div>
            </div>
            <div class="camlait_kpi4_card">
                <div class="camlait_kpi4_header"><span class="camlait_kpi4_label">Panier moyen</span><span class="camlait_kpi4_icon camlait_icon_orange"><i class="fa fa-shopping-cart"/></span></div>
                <div class="camlait_kpi4_value"><t t-esc="formatAmount(state.ventes.panier_moyen)"/></div>
                <div t-att-class="'camlait_kpi4_delta ' + (state.ventes.panier_delta>=0?'pos':'neg')">
                    <i t-att-class="'fa ' + (state.ventes.panier_delta>=0?'fa-arrow-up':'fa-arrow-down')"/>
                    <t t-esc="(state.ventes.panier_delta>=0?'+':'') + state.ventes.panier_delta"/>% vs periode prec.
                </div>
                <div class="camlait_kpi4_sub">En FCFA</div>
            </div>
            <div class="camlait_kpi4_card" t-on-click="() => comp.openTauxLivraisonDetail()" title="Voir le calcul du taux et les livraisons en retard / en attente">
                <div class="camlait_kpi4_header"><span class="camlait_kpi4_label">Taux de livraison</span><span class="camlait_kpi4_icon camlait_icon_blue"><i class="fa fa-truck"/></span></div>
                <div class="camlait_kpi4_value"><t t-esc="state.ventes.taux_livraison"/>%</div>
                <div class="camlait_kpi4_delta neu camlait_kpi4_sublink" t-on-click.stop="() => comp.openSaleQuotesLate()" title="Voir les devis en retard de relance">
                    <t t-esc="state.ventes.en_retard"/> devis en retard de relance
                </div>
                <div class="camlait_kpi4_progress"><div class="camlait_kpi4_progress_fill camlait_prog_blue" t-att-style="'width:' + state.ventes.taux_livraison + '%'"/></div>
                <div class="camlait_kpi4_sub camlait_kpi4_sublink" t-on-click.stop="() => comp.openSaleWaiting()" title="Voir les devis en attente de confirmation">
                    <t t-esc="state.ventes.en_attente"/> devis en attente de confirmation
                </div>
            </div>
        </div>
    </div>

    <div class="camlait_row2">
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-area-chart"/></div>
                <h3>Evolution CA - <t t-esc="comp.graphPeriodLabel()"/> (FCFA)</h3>
                <div class="camlait_card_header_right">
                    <select class="camlait_period_select camlait_graph_period_select" t-att-value="state.graphPeriod" t-on-change="(ev) => comp.setGraphPeriod(ev.target.value)">
                        <option value="6mois" t-att-selected="state.graphPeriod==='6mois'">6 derniers mois</option>
                        <option value="annee" t-att-selected="state.graphPeriod==='annee'">Cet Annee</option>
                        <option value="mois" t-att-selected="state.graphPeriod==='mois'">Ce mois</option>
                        <option value="6semaines" t-att-selected="state.graphPeriod==='6semaines'">6 derniers semaines</option>
                        <option value="7jours" t-att-selected="state.graphPeriod==='7jours'">7 derniers jours</option>
                    </select>
                    <span class="camlait_link" t-on-click="() => comp.exportCsv()">Exporter</span>
                </div>
            </div>
            <div class="camlait_chart_wrap"><canvas id="camlait_evolution_chart"/></div>
        </div>
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-pie-chart"/></div>
                <h3>CA par canal</h3>
            </div>
            <div class="camlait_donut_wrap">
                <div class="camlait_donut_canvas_wrap">
                    <canvas id="camlait_ventes_donut"/>
                    <div class="camlait_donut_center">
                        <div class="camlait_donut_pct">100%</div>
                        <div class="camlait_donut_pct_label">total</div>
                    </div>
                </div>
                <div class="camlait_donut_legend">
                    <t t-foreach="state.repartition_canal" t-as="c">
                        <div class="camlait_donut_item">
                            <span class="camlait_dot" t-att-style="'background:' + c.color"/>
                            <span><t t-esc="c.label"/></span>
                            <strong><t t-esc="c.pct"/>%</strong>
                        </div>
                    </t>
                </div>
            </div>
        </div>
    </div>

    <div class="camlait_row2">
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-star"/></div>
                <h3>Top 5 produits vendus</h3>
                <span class="camlait_link" t-on-click="() => comp.openTopProducts()">Voir tout</span>
            </div>
            <table class="camlait_table">
                <thead><tr><th>PRODUIT</th><th class="camlait_th_right">QTE</th><th class="camlait_th_right">CA</th><th class="camlait_th_right">TENDANCE</th></tr></thead>
                <tbody>
                    <t t-foreach="state.ventes.top5" t-as="prod">
                        <tr>
                            <td><t t-esc="prod.name"/></td>
                            <td class="camlait_td_right"><t t-esc="formatQty(prod.qty)"/></td>
                            <td class="camlait_td_right"><span class="camlait_badge_ca"><t t-esc="formatAmount(prod.ca)"/></span></td>
                            <td class="camlait_td_right">
                                <span t-att-class="'camlait_delta ' + (prod.tendance>=0?'pos':'neg')">
                                    <i t-att-class="'fa ' + (prod.tendance>0?'fa-arrow-up':(prod.tendance&lt;0?'fa-arrow-down':'fa-minus'))"/>
                                    <t t-esc="(prod.tendance>0?'+':'') + prod.tendance"/>%
                                </span>
                            </td>
                        </tr>
                    </t>
                </tbody>
            </table>
        </div>
        <div class="camlait_card">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-list"/></div>
                <h3>Commandes recentes</h3>
                <span class="camlait_link" t-on-click="() => comp.openRecentOrders()">Voir tout</span>
            </div>
            <table class="camlait_table">
                <thead><tr><th>N</th><th>CLIENT</th><th>DATE</th><th class="camlait_th_right">MONTANT</th><th>STATUT</th></tr></thead>
                <tbody>
                    <t t-foreach="state.commandes_recentes" t-as="cmd">
                        <tr class="camlait_tr_hover" t-on-click="(ev) => comp.openOrder(ev)" t-att-data-id="cmd.id">
                            <td class="camlait_link_cell"><t t-esc="cmd.name"/></td>
                            <td><t t-esc="cmd.client"/></td>
                            <td><t t-esc="cmd.date"/></td>
                            <td class="camlait_td_right"><t t-esc="formatAmount(cmd.montant)"/></td>
                            <td><span t-attf-class="camlait_statut camlait_statut_{{cmd.statut}}"><t t-esc="cmd.label"/></span></td>
                        </tr>
                    </t>
                </tbody>
            </table>
        </div>
    </div>
    </t>
</div>
`;
