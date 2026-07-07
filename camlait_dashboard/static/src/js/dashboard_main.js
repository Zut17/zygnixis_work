/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const { Component, QWeb } = owl;
const { useState } = owl.hooks;

function loadChartJs() {
    return new Promise((resolve) => {
        if (window.Chart) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
        s.onload = resolve;
        document.head.appendChild(s);
    });
}

QWeb.registerTemplate('camlait_dashboard.Main', `
<t t-name="camlait_dashboard.Main">
<div class="camlait_dashboard_root">

    <!-- ═══ EN-TETE ═══ -->
    <div class="camlait_topbar">
        <div class="camlait_topbar_left">
            <div class="camlait_logo_box">
                <img src="/camlait_dashboard/static/src/img/logo.png" alt="Logo"
                     t-on-error="onLogoError" t-if="!state.logoError"/>
                <i class="fa fa-th-large" t-if="state.logoError"/>
            </div>
            <div class="camlait_topbar_title">
                <h2>Camlait - Tableau de bord decisionnel</h2>
                <span class="camlait_subtitle">Zygnixis - Module Odoo custom - camlait_dashboard</span>
            </div>
        </div>
        <div class="camlait_topbar_right">
            <div class="camlait_period_btns">
                <button t-att-class="'camlait_period_btn' + (state.activePeriod==='7j'?' active':'')" t-on-click="setPeriod7j">7j</button>
                <button t-att-class="'camlait_period_btn' + (state.activePeriod==='mois'?' active':'')" t-on-click="setPeriodMois">Mois</button>
                <button t-att-class="'camlait_period_btn' + (state.activePeriod==='trim'?' active':'')" t-on-click="setPeriodTrim">Trim.</button>
                <button t-att-class="'camlait_period_btn' + (state.activePeriod==='annee'?' active':'')" t-on-click="setPeriodAnnee">Annee</button>
            </div>
            <button class="camlait_icon_btn" title="Telechargement">
                <i class="fa fa-download"/>
            </button>
            <button class="camlait_icon_btn" title="Imprimer" t-on-click="printDashboard">
                <i class="fa fa-print"/>
            </button>
            <div class="camlait_icon_wrap">
                <button class="camlait_icon_btn" title="Notifications" t-on-click="toggleNotifications">
                    <i class="fa fa-bell"/>
                    <span class="camlait_icon_badge" t-if="countUrgent() > 0"><t t-esc="countUrgent()"/></span>
                </button>
                <div class="camlait_notif_panel" t-if="state.showNotifications">
                    <div class="camlait_notif_header">Alertes recentes</div>
                    <t t-foreach="state.alertes" t-as="a">
                        <div t-att-class="'camlait_alerte camlait_alerte_' + a.type">
                            <span class="camlait_alerte_icon"><i t-att-class="'fa ' + a.icon"/></span>
                            <span class="camlait_alerte_msg"><t t-esc="a.msg"/></span>
                        </div>
                    </t>
                    <t t-if="!state.alertes or state.alertes.length === 0">
                        <div class="camlait_notif_empty">Aucune alerte.</div>
                    </t>
                </div>
            </div>
            <button class="camlait_icon_btn" title="Reglages" t-on-click="openSettings">
                <i class="fa fa-cog"/>
            </button>
        </div>
    </div>

    <!-- ═══ MODALE REGLAGES ═══ -->
    <div class="camlait_modal_overlay" t-if="state.showSettings" t-on-click="closeSettings">
        <div class="camlait_modal" t-on-click.stop="doNothing">
            <h3>Reglages du tableau de bord</h3>
            <div class="camlait_modal_field">
                <label>Budget achats mensuel (FCFA)</label>
                <input type="number" t-att-value="state.settingsForm.budget_achats" t-on-change="onBudgetChange"/>
            </div>
            <div class="camlait_modal_field">
                <label>Objectif de chiffre d'affaires mensuel (FCFA)</label>
                <input type="number" t-att-value="state.settingsForm.objectif_ca" t-on-change="onObjectifChange"/>
            </div>
            <div class="camlait_modal_actions">
                <button class="camlait_btn_secondary" t-on-click="closeSettings">Annuler</button>
                <button class="camlait_btn_primary" t-on-click="saveSettings">Enregistrer</button>
            </div>
        </div>
    </div>

    <!-- ═══ ONGLETS ═══ -->
    <div class="camlait_tabs">
        <button t-att-class="'camlait_tab' + (state.activeTab===0?' active':'')" t-on-click="setTab0">
            <i class="fa fa-th-large"/> Vue globale
        </button>
        <button t-att-class="'camlait_tab' + (state.activeTab===1?' active':'')" t-on-click="setTab1">
            <i class="fa fa-line-chart"/> Ventes
        </button>
        <button t-att-class="'camlait_tab' + (state.activeTab===2?' active':'')" t-on-click="setTab2">
            <i class="fa fa-shopping-cart"/> Achats
        </button>
        <button t-att-class="'camlait_tab' + (state.activeTab===3?' active':'')" t-on-click="setTab3">
            <i class="fa fa-cubes"/> Stock
        </button>
        <button t-att-class="'camlait_tab' + (state.activeTab===4?' active':'')" t-on-click="setTab4">
            <i class="fa fa-wrench"/> Maintenance
        </button>
    </div>

    <t t-if="state.loading">
        <div class="camlait_loader"><i class="fa fa-spin fa-circle-o-notch fa-lg"/> Chargement des indicateurs...</div>
    </t>

    <t t-else="">
    <div class="camlait_period_label">INDICATEURS CLES - <t t-esc="periodLabel()"/></div>

    <!-- ═══════════════ TAB 0 : VUE GLOBALE ═══════════════ -->
    <t t-if="state.activeTab === 0">
      <div class="camlait_cards_grid">

        <div class="camlait_kpi_row4">
            <div class="camlait_kpi4_card" t-on-click="openSaleAnalysis">
                <div class="camlait_kpi4_header">
                    <span class="camlait_kpi4_label">Chiffre d'affaires</span>
                    <span class="camlait_kpi4_icon camlait_icon_purple"><i class="fa fa-line-chart"/></span>
                </div>
                <div class="camlait_kpi4_value"><t t-esc="formatAmount(state.ventes.ca_total)"/> M</div>
                <div t-att-class="'camlait_kpi4_delta ' + (state.ventes.ca_delta>=0?'pos':'neg')">
                    <i t-att-class="'fa ' + (state.ventes.ca_delta>=0?'fa-arrow-up':'fa-arrow-down')"/>
                    <t t-esc="(state.ventes.ca_delta>=0?'+':'') + state.ventes.ca_delta"/>% vs periode prec.
                </div>
                <div class="camlait_kpi4_progress">
                    <div class="camlait_kpi4_progress_fill camlait_prog_purple"
                         t-att-style="'width:' + Math.min(state.ventes.ca_total / state.ventes.objectif_ca * 100, 100) + '%'"/>
                </div>
                <div class="camlait_kpi4_sub">Objectif mensuel : <t t-esc="formatAmount(state.ventes.objectif_ca)"/> FCFA</div>
            </div>

            <div class="camlait_kpi4_card" t-on-click="openSaleDone">
                <div class="camlait_kpi4_header">
                    <span class="camlait_kpi4_label">Commandes livrees</span>
                    <span class="camlait_kpi4_icon camlait_icon_green"><i class="fa fa-truck"/></span>
                </div>
                <div class="camlait_kpi4_value"><t t-esc="state.ventes.commandes_livrees"/></div>
                <div class="camlait_kpi4_delta pos">Taux de livraison : <t t-esc="state.ventes.taux_livraison"/>%</div>
                <div class="camlait_kpi4_progress">
                    <div class="camlait_kpi4_progress_fill camlait_prog_green" t-att-style="'width:' + state.ventes.taux_livraison + '%'"/>
                </div>
                <div class="camlait_kpi4_sub">Sur la periode selectionnee</div>
            </div>

            <div class="camlait_kpi4_card" t-on-click="openSaleWaiting">
                <div class="camlait_kpi4_header">
                    <span class="camlait_kpi4_label">Commandes en attente</span>
                    <span class="camlait_kpi4_icon camlait_icon_orange"><i class="fa fa-clock-o"/></span>
                </div>
                <div class="camlait_kpi4_value"><t t-esc="state.ventes.en_attente"/></div>
                <div class="camlait_kpi4_delta neg">Dont <t t-esc="state.ventes.en_retard"/> en retard</div>
                <div class="camlait_kpi4_progress">
                    <div class="camlait_kpi4_progress_fill camlait_prog_orange" style="width:55%"/>
                </div>
                <div class="camlait_kpi4_sub">A traiter en priorite</div>
            </div>

            <div class="camlait_kpi4_card" t-on-click="openStock">
                <div class="camlait_kpi4_header">
                    <span class="camlait_kpi4_label">Valeur stock actuel</span>
                    <span class="camlait_kpi4_icon camlait_icon_blue"><i class="fa fa-cubes"/></span>
                </div>
                <div class="camlait_kpi4_value"><t t-esc="formatAmount(state.stock.valeur_stock)"/> M</div>
                <div class="camlait_kpi4_delta neu">Stable</div>
                <div class="camlait_kpi4_progress">
                    <div class="camlait_kpi4_progress_fill camlait_prog_blue" t-att-style="'width:' + state.stock.taux_dispo + '%'"/>
                </div>
                <div class="camlait_kpi4_sub"><t t-esc="state.stock.sous_seuil"/> produits sous seuil</div>
            </div>
        </div>

        <div class="camlait_row2">
            <div class="camlait_card">
                <div class="camlait_card_header">
                    <div class="camlait_card_icon_wrap"><i class="fa fa-area-chart"/></div>
                    <h3>Evolution des ventes - 6 derniers mois</h3>
                    <span class="camlait_link" t-on-click="openSaleAnalysis">Detail</span>
                </div>
                <div class="camlait_chart_wrap"><canvas id="camlait_global_chart"/></div>
            </div>

            <div class="camlait_card">
                <div class="camlait_card_header">
                    <div class="camlait_card_icon_wrap"><i class="fa fa-pie-chart"/></div>
                    <h3>Repartition CA par canal</h3>
                </div>
                <div class="camlait_donut_wrap">
                    <div class="camlait_donut_canvas_wrap">
                        <canvas id="camlait_global_donut"/>
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

        <div class="camlait_row3">
            <div class="camlait_card">
                <div class="camlait_card_header">
                    <div class="camlait_card_icon_wrap"><i class="fa fa-star"/></div>
                    <h3>Top 5 produits</h3>
                    <span class="camlait_link" t-on-click="openSaleAnalysis">Voir tout</span>
                </div>
                <table class="camlait_table">
                    <thead><tr><th>PRODUIT</th><th class="camlait_th_right">QTE</th><th class="camlait_th_right">CA</th></tr></thead>
                    <tbody>
                        <t t-foreach="state.ventes.top5" t-as="prod">
                            <tr>
                                <td><t t-esc="prod.name"/></td>
                                <td class="camlait_td_right"><t t-esc="formatQty(prod.qty)"/></td>
                                <td class="camlait_td_right"><span class="camlait_badge_ca"><t t-esc="formatAmount(prod.ca)"/></span></td>
                            </tr>
                        </t>
                    </tbody>
                </table>
                <div class="camlait_top5_chart_wrap">
                    <canvas id="camlait_top5_chart_global"/>
                </div>
            </div>

            <div class="camlait_card">
                <div class="camlait_card_header">
                    <div class="camlait_card_icon_wrap"><i class="fa fa-shopping-cart"/></div>
                    <h3>Achats - Bons de commande</h3>
                </div>
                <div class="camlait_compact_list">
                    <div class="camlait_compact_row" t-on-click="openPurchaseConfirmed">
                        <span><i class="fa fa-check camlait_txt_green"/> BdC valides ce mois</span>
                        <strong><t t-esc="state.achats.bdc_valides"/></strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openPurchaseDraft">
                        <span><i class="fa fa-clock-o camlait_txt_orange"/> En attente validation</span>
                        <strong><t t-esc="state.achats.bdc_en_attente"/></strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openPurchaseLate">
                        <span><i class="fa fa-exclamation-triangle camlait_txt_red"/> En retard fournisseur</span>
                        <strong><t t-esc="state.achats.bdc_en_retard"/></strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openPurchaseAnalysis">
                        <span><i class="fa fa-money camlait_txt_blue"/> Montant total engage</span>
                        <strong><t t-esc="formatAmount(state.achats.montant_total_engage)"/></strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openSuppliers">
                        <span><i class="fa fa-building"/> Fournisseurs actifs</span>
                        <strong><t t-esc="state.achats.fournisseurs_actifs"/></strong>
                    </div>
                </div>
                <div class="camlait_progress_item" style="margin-top:10px">
                    <div class="camlait_progress_label"><span>Taux reception dans delais</span><span><t t-esc="state.achats.taux_reception_delais"/>%</span></div>
                    <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_green" t-att-style="'width:' + state.achats.taux_reception_delais + '%'"/></div>
                </div>
                <div class="camlait_progress_item">
                    <div class="camlait_progress_label"><span>Budget achats consomme</span><span><t t-esc="state.achats.budget_consomme"/>%</span></div>
                    <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_blue" t-att-style="'width:' + state.achats.budget_consomme + '%'"/></div>
                </div>
            </div>

            <div class="camlait_card">
                <div class="camlait_card_header">
                    <div class="camlait_card_icon_wrap"><i class="fa fa-cubes"/></div>
                    <h3>Etat du stock</h3>
                </div>
                <div class="camlait_compact_list">
                    <div class="camlait_compact_row" t-on-click="openStock">
                        <span><i class="fa fa-database camlait_txt_blue"/> Produits en stock</span>
                        <strong><t t-esc="state.stock.produits_en_stock"/> ref.</strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openStockAlert">
                        <span><i class="fa fa-arrow-down camlait_txt_orange"/> Sous seuil minimum</span>
                        <strong><t t-esc="state.stock.sous_seuil"/> ref.</strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openStock">
                        <span><i class="fa fa-times-circle camlait_txt_red"/> Ruptures</span>
                        <strong><t t-esc="state.stock.ruptures"/> ref.</strong>
                    </div>
                    <div class="camlait_compact_row">
                        <span><i class="fa fa-refresh"/> Rotation moy. stock</span>
                        <strong><t t-esc="state.stock.rotation_stock"/> j</strong>
                    </div>
                </div>
                <div class="camlait_progress_item" style="margin-top:10px">
                    <div class="camlait_progress_label"><span>Taux de disponibilite</span><span><t t-esc="state.stock.taux_dispo"/>%</span></div>
                    <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_green" t-att-style="'width:' + state.stock.taux_dispo + '%'"/></div>
                </div>
                <div class="camlait_statuts_list" style="margin-top:10px">
                    <t t-foreach="state.stock.statuts" t-as="s">
                        <span t-att-class="'camlait_statut_badge camlait_statut_' + s.statut"><t t-esc="s.label"/></span>
                    </t>
                </div>
            </div>
        </div>

        <div class="camlait_row2">
            <div class="camlait_card">
                <div class="camlait_card_header">
                    <div class="camlait_card_icon_wrap"><i class="fa fa-list-alt"/></div>
                    <h3>Commandes clients recentes</h3>
                    <span class="camlait_link" t-on-click="openSaleDone">Voir tout</span>
                </div>
                <table class="camlait_table">
                    <thead><tr><th>N COMMANDE</th><th>CLIENT</th><th>DATE</th><th class="camlait_th_right">MONTANT</th><th>STATUT</th></tr></thead>
                    <tbody>
                        <t t-foreach="state.commandes_recentes" t-as="cmd">
                            <tr class="camlait_tr_hover" t-on-click="openOrder" t-att-data-id="cmd.id">
                                <td class="camlait_link_cell"><t t-esc="cmd.name"/></td>
                                <td><t t-esc="cmd.client"/></td>
                                <td><t t-esc="cmd.date"/></td>
                                <td class="camlait_td_right"><t t-esc="formatAmount(cmd.montant)"/></td>
                                <td><span t-att-class="'camlait_statut camlait_statut_' + cmd.statut"><t t-esc="cmd.label"/></span></td>
                            </tr>
                        </t>
                    </tbody>
                </table>
            </div>

            <div class="camlait_card">
                <div class="camlait_card_header">
                    <div class="camlait_card_icon_wrap"><i class="fa fa-exclamation-triangle"/></div>
                    <h3>Alertes et actions requises</h3>
                    <span class="camlait_badge_urgence"><t t-esc="countUrgent()"/> urgentes</span>
                </div>
                <div class="camlait_alertes_list">
                    <t t-foreach="state.alertes" t-as="a">
                        <div t-att-class="'camlait_alerte camlait_alerte_' + a.type">
                            <span class="camlait_alerte_icon"><i t-att-class="'fa ' + a.icon"/></span>
                            <span class="camlait_alerte_msg"><t t-esc="a.msg"/></span>
                        </div>
                    </t>
                    <t t-if="!state.alertes or state.alertes.length === 0">
                        <div class="camlait_alerte camlait_alerte_info">
                            <span class="camlait_alerte_icon"><i class="fa fa-check-circle"/></span>
                            <span class="camlait_alerte_msg">Aucune alerte en cours.</span>
                        </div>
                    </t>
                </div>
            </div>
        </div>

      </div>
    </t>

    <!-- ═══════════════════ TAB 1 : VENTES ═══════════════════ -->
    <t t-if="state.activeTab === 1">
      <div class="camlait_cards_grid">
        <t t-if="!state.ventes.has_data">
            <div class="camlait_card camlait_card_wide"><div class="camlait_no_data"><i class="fa fa-info-circle"/> Aucune donnee sur cette periode</div></div>
        </t>
        <t t-else="">
        <div class="camlait_card camlait_card_wide">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-bar-chart"/></div>
                <h3>Ventes - Chiffre d affaires</h3>
            </div>
            <div class="camlait_kpi_grid">
                <div class="camlait_kpi_btn camlait_kpi_purple camlait_kpi_full" t-on-click="openSaleAnalysis">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-line-chart"/></span><span class="camlait_kpi_label">Chiffre d affaires</span></div>
                    <div class="camlait_ca_row">
                        <span class="camlait_kpi_value camlait_kpi_large"><t t-esc="formatAmount(state.ventes.ca_total)"/><span class="camlait_kpi_unit">FCFA</span></span>
                        <span t-att-class="'camlait_delta ' + (state.ventes.ca_delta>=0?'pos':'neg')">
                            <i t-att-class="'fa ' + (state.ventes.ca_delta>=0?'fa-arrow-up':'fa-arrow-down')"/>
                            <t t-esc="(state.ventes.ca_delta>=0?'+':'') + state.ventes.ca_delta"/>% vs periode prec.
                        </span>
                    </div>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_green" t-on-click="openSaleDone">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-truck"/></span><span class="camlait_kpi_label">Commandes livrees</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.ventes.commandes_livrees"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_orange" t-on-click="openSaleWaiting">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-hourglass-half"/></span><span class="camlait_kpi_label">En attente</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.ventes.en_attente"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_red" t-on-click="openSaleLate">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-exclamation-circle"/></span><span class="camlait_kpi_label">En retard</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.ventes.en_retard"/></span>
                </div>
            </div>
            <div class="camlait_progress_section">
                <div class="camlait_progress_item">
                    <div class="camlait_progress_label"><span><i class="fa fa-check-circle"/> Taux de livraison</span><span class="camlait_progress_pct"><t t-esc="state.ventes.taux_livraison"/>%</span></div>
                    <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_green" t-att-style="'width:' + state.ventes.taux_livraison + '%'"/></div>
                </div>
            </div>
        </div>

        <div class="camlait_card camlait_card_wide">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-star"/></div>
                <h3>Top 5 produits vendus</h3>
                <span class="camlait_link" t-on-click="openSaleAnalysis">Voir tout</span>
            </div>
            <table class="camlait_table">
                <thead><tr><th>PRODUIT</th><th class="camlait_th_right">QTE</th><th class="camlait_th_right">CA</th></tr></thead>
                <tbody>
                    <t t-foreach="state.ventes.top5" t-as="prod">
                        <tr><td><t t-esc="prod.name"/></td><td class="camlait_td_right"><t t-esc="formatQty(prod.qty)"/></td><td class="camlait_td_right"><span class="camlait_badge_ca"><t t-esc="formatAmount(prod.ca)"/></span></td></tr>
                    </t>
                </tbody>
            </table>
            <div class="camlait_top5_chart_wrap">
                <canvas id="camlait_top5_chart_ventes"/>
            </div>
        </div>

        <div class="camlait_card camlait_card_wide">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-area-chart"/></div>
                <h3>Evolution des ventes - 6 derniers mois (FCFA)</h3>
                <span class="camlait_link" t-on-click="openSaleAnalysis">Detail</span>
            </div>
            <div class="camlait_chart_wrap"><canvas id="camlait_evolution_chart"/></div>
        </div>
        </t>
      </div>
    </t>

    <!-- ═══════════════════ TAB 2 : ACHATS ═══════════════════ -->
    <t t-if="state.activeTab === 2">
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
                <div class="camlait_kpi_btn camlait_kpi_green" t-on-click="openPurchaseConfirmed">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-check"/></span><span class="camlait_kpi_label">BdC valides ce mois</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.achats.bdc_valides"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_orange" t-on-click="openPurchaseDraft">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-clock-o"/></span><span class="camlait_kpi_label">En attente validation</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.achats.bdc_en_attente"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_red" t-on-click="openPurchaseLate">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-exclamation-triangle"/></span><span class="camlait_kpi_label">En retard fournisseur</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.achats.bdc_en_retard"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_blue camlait_kpi_wide" t-on-click="openPurchaseAnalysis">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-money"/></span><span class="camlait_kpi_label">Montant total engage</span></div>
                    <span class="camlait_kpi_value camlait_kpi_large"><t t-esc="formatAmount(state.achats.montant_total_engage)"/><span class="camlait_kpi_unit">FCFA</span></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_neutral" t-on-click="openSuppliers">
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
        </t>
      </div>
    </t>

    <!-- ═══════════════════ TAB 3 : STOCK ═══════════════════ -->
    <t t-if="state.activeTab === 3">
      <div class="camlait_cards_grid">
        <div class="camlait_card camlait_card_wide">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-cubes"/></div>
                <h3>Etat du stock</h3>
            </div>
            <div class="camlait_stock_grid">
                <div class="camlait_kpi_btn camlait_kpi_blue" t-on-click="openStock">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-database"/></span><span class="camlait_kpi_label">Produits en stock</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.stock.produits_en_stock"/><span class="camlait_kpi_unit">ref.</span></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_orange" t-on-click="openStockAlert">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-arrow-down"/></span><span class="camlait_kpi_label">Sous seuil minimum</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.stock.sous_seuil"/><span class="camlait_kpi_unit">ref.</span></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_red" t-on-click="openStock">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-times-circle"/></span><span class="camlait_kpi_label">Ruptures</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.stock.ruptures"/><span class="camlait_kpi_unit">ref.</span></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_neutral" t-on-click="openStock">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-refresh"/></span><span class="camlait_kpi_label">Rotation moy. stock</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.stock.rotation_stock"/><span class="camlait_kpi_unit">j</span></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_green camlait_kpi_wide" t-on-click="openStock">
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
      </div>
    </t>

    <!-- ═══════════════════ TAB 4 : MAINTENANCE ═══════════════════ -->
    <t t-if="state.activeTab === 4">
      <div class="camlait_cards_grid">
        <div class="camlait_card camlait_card_wide">
            <div class="camlait_card_header">
                <div class="camlait_card_icon_wrap"><i class="fa fa-wrench"/></div>
                <h3>Maintenance</h3>
            </div>
            <div class="camlait_stock_grid">
                <div class="camlait_kpi_btn camlait_kpi_blue" t-on-click="openMaintenance">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-list"/></span><span class="camlait_kpi_label">Total demandes</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.maintenance.total"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_orange" t-on-click="openMaintenance">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-cog fa-spin"/></span><span class="camlait_kpi_label">En cours</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.maintenance.en_cours"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_green" t-on-click="openMaintenance">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-check-circle"/></span><span class="camlait_kpi_label">Terminees</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.maintenance.terminees"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_red camlait_kpi_wide" t-on-click="openMaintenanceUrgent">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-exclamation-circle"/></span><span class="camlait_kpi_label">Demandes urgentes</span></div>
                    <span class="camlait_kpi_value camlait_kpi_large"><t t-esc="state.maintenance.urgentes"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_neutral" t-on-click="openEquipment">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-industry"/></span><span class="camlait_kpi_label">Equipements actifs</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.maintenance.equipements"/></span>
                </div>
            </div>
            <div class="camlait_progress_section">
                <div class="camlait_progress_item">
                    <div class="camlait_progress_label"><span><i class="fa fa-clock-o"/> MTBF moyen</span><span class="camlait_progress_pct"><t t-esc="state.maintenance.mtbf_moy"/> jours</span></div>
                    <div class="camlait_progress_bg"><div class="camlait_progress_fill camlait_bar_blue" t-att-style="'width:' + Math.min(state.maintenance.mtbf_moy, 100) + '%'"/></div>
                </div>
            </div>
            <t t-if="state.maintenance.alertes_maint and state.maintenance.alertes_maint.length > 0">
                <div class="camlait_statuts_section">
                    <div class="camlait_statuts_title"><i class="fa fa-exclamation-triangle"/> Demandes urgentes en cours</div>
                    <div class="camlait_maint_alertes">
                        <t t-foreach="state.maintenance.alertes_maint" t-as="a">
                            <div class="camlait_maint_alerte_row">
                                <span class="camlait_maint_alerte_icon"><i class="fa fa-wrench"/></span>
                                <div class="camlait_maint_alerte_body">
                                    <span class="camlait_maint_alerte_name"><t t-esc="a.name"/></span>
                                    <span class="camlait_maint_alerte_equip"><t t-esc="a.equipment"/></span>
                                </div>
                            </div>
                        </t>
                    </div>
                </div>
            </t>
        </div>
      </div>
    </t>

    </t>
</div>
</t>`);

class CamlaitDashboard extends Component {

    constructor(parent, props) {
        super(parent, props);
        this.actionService = useService("action");
        this._chart = null;
        this._donut = null;

        this.state = useState({
            loading: true,
            logoError: false,
            activeTab: 0,
            activePeriod: 'mois',
            showNotifications: false,
            showSettings: false,
            settingsForm: { budget_achats: 0, objectif_ca: 0 },
            dateFrom: this._firstDayOfMonth(),
            dateTo: this._today(),
            achats: { bdc_valides:0, bdc_en_attente:0, bdc_en_retard:0, montant_total_engage:0, fournisseurs_actifs:0, taux_reception_delais:0, budget_consomme:0, has_data:true },
            ventes: { ca_total:0, ca_delta:0, objectif_ca:197000000, commandes_livrees:0, taux_livraison:0, en_attente:0, en_retard:0, top5:[], evolution:[], has_data:true },
            stock: { produits_en_stock:0, sous_seuil:0, ruptures:0, rotation_stock:0, taux_dispo:0, valeur_stock:0, pct_perime:0, nb_perime:0, statuts:[] },
            maintenance: { total:0, en_cours:0, terminees:0, urgentes:0, equipements:0, mtbf_moy:0, alertes_maint:[] },
            commandes_recentes: [],
            alertes: [],
            repartition_canal: [],
        });
    }

    async willStart() {
        await loadChartJs();
        await this._loadData();
    }

    async mounted() {
        this._drawCharts();
    }

    async patched() {
        if (!this.state.loading) this._drawCharts();
    }

    onLogoError() { this.state.logoError = true; }

    _rpc(model, method, kwargs = {}) {
        return this.env.services.rpc('/web/dataset/call_kw', { model, method, args: [], kwargs });
    }

    async _loadData() {
        this.state.loading = true;
        try {
            const result = await this._rpc('camlait.dashboard', 'get_dashboard_data', {
                date_from: this.state.dateFrom, date_to: this.state.dateTo,
            });
            this.state.achats = result.achats;
            this.state.ventes = result.ventes;
            this.state.stock = result.stock;
            this.state.maintenance = result.maintenance;
            this.state.commandes_recentes = result.commandes_recentes;
            this.state.alertes = result.alertes;
            this.state.repartition_canal = result.repartition_canal;
        } catch (e) {
            console.error('Erreur chargement dashboard :', e);
        } finally {
            this.state.loading = false;
        }
    }

    printDashboard() {
        window.print();
    }

    async onDateChange(ev) {
        const { name, value } = ev.target;
        this.state[name] = value;
        await this._loadData();
    }

    // ── Periodes rapides ─────────────────────────────────────────
    async _setPeriod(period, from, to) {
        this.state.activePeriod = period;
        this.state.dateFrom = from;
        this.state.dateTo = to;
        await this._loadData();
    }
    setPeriod7j() {
        const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 7);
        this._setPeriod('7j', from.toISOString().split('T')[0], to.toISOString().split('T')[0]);
    }
    setPeriodMois() { this._setPeriod('mois', this._firstDayOfMonth(), this._today()); }
    setPeriodTrim() {
        const d = new Date();
        const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth()/3)*3, 1);
        this._setPeriod('trim', qStart.toISOString().split('T')[0], this._today());
    }
    setPeriodAnnee() { this._setPeriod('annee', `${new Date().getFullYear()}-01-01`, this._today()); }

    periodLabel() {
        const map = { '7j':'7 derniers jours', 'mois':'Mois en cours', 'trim':'Trimestre en cours', 'annee':'Annee en cours' };
        return map[this.state.activePeriod] || 'Periode';
    }

    // ── Onglets ──────────────────────────────────────────────────
    setTab0() { this.state.activeTab = 0; }
    setTab1() { this.state.activeTab = 1; }
    setTab2() { this.state.activeTab = 2; }
    setTab3() { this.state.activeTab = 3; }
    setTab4() { this.state.activeTab = 4; }

    // ── Notifications ────────────────────────────────────────────
    toggleNotifications() { this.state.showNotifications = !this.state.showNotifications; }
    countUrgent() { return (this.state.alertes || []).filter(a => a.type === 'danger').length; }

    // ── Reglages ─────────────────────────────────────────────────
    async openSettings() {
        try {
            const s = await this._rpc('camlait.dashboard', 'get_settings', {});
            this.state.settingsForm = { budget_achats: s.budget_achats, objectif_ca: s.objectif_ca };
            this.state.showSettings = true;
        } catch(e) { console.error(e); }
    }
    closeSettings() { this.state.showSettings = false; }
    doNothing() {}
    onBudgetChange(ev) { this.state.settingsForm.budget_achats = ev.target.value; }
    onObjectifChange(ev) { this.state.settingsForm.objectif_ca = ev.target.value; }
    async saveSettings() {
        try {
            await this._rpc('camlait.dashboard', 'save_settings', {
                budget_achats: this.state.settingsForm.budget_achats,
                objectif_ca: this.state.settingsForm.objectif_ca,
            });
            this.state.showSettings = false;
            await this._loadData();
        } catch(e) { console.error(e); }
    }

    // ── Export CSV cote client ──────────────────────────────────
    exportCsv() {
        const rows = [['Indicateur', 'Valeur']];
        rows.push(['Periode', this.state.dateFrom + ' au ' + this.state.dateTo]);
        rows.push(['Chiffre d affaires', this.state.ventes.ca_total]);
        rows.push(['Commandes livrees', this.state.ventes.commandes_livrees]);
        rows.push(['Commandes en attente', this.state.ventes.en_attente]);
        rows.push(['BdC valides', this.state.achats.bdc_valides]);
        rows.push(['Montant achats engage', this.state.achats.montant_total_engage]);
        rows.push(['Valeur stock', this.state.stock.valeur_stock]);
        rows.push(['Produits sous seuil', this.state.stock.sous_seuil]);
        rows.push(['Demandes maintenance urgentes', this.state.maintenance.urgentes]);
        const csv = rows.map(r => r.join(';')).join('\\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `camlait_dashboard_${this.state.dateFrom}_${this.state.dateTo}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Graphiques ───────────────────────────────────────────────
    _drawCharts() {
        this._drawLineChart('camlait_evolution_chart');
        this._drawLineChart('camlait_global_chart');
        this._drawTop5Chart('camlait_top5_chart_global');
        this._drawTop5Chart('camlait_top5_chart_ventes');
        this._drawDonut();
    }

    _drawLineChart(canvasId) {
        if (!window.Chart) return;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const evolution = this.state.ventes.evolution || [];
        if (!evolution.length) return;
        if (canvas._chartInstance) canvas._chartInstance.destroy();

        const ctx2d = canvas.getContext('2d');
        const gradient = ctx2d.createLinearGradient(0, 0, 0, canvas.height || 200);
        gradient.addColorStop(0, 'rgba(99,102,241,0.35)');
        gradient.addColorStop(1, 'rgba(99,102,241,0.02)');

        const lastPointLabel = {
            id: 'lastPointLabel',
            afterDatasetsDraw(chart) {
                const dataset = chart.data.datasets[0];
                const meta = chart.getDatasetMeta(0);
                const idx = dataset.data.length - 1;
                const point = meta.data[idx];
                if (!point) return;
                const value = dataset.data[idx];
                let label;
                if (value >= 1000000) label = (value/1000000).toFixed(1).replace('.', ',') + ' M FCFA';
                else if (value >= 1000) label = (value/1000).toFixed(0) + ' K FCFA';
                else label = value + ' FCFA';

                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 11px Calibri, Arial, sans-serif';
                const textW = ctx.measureText(label).width;
                const boxW = textW + 16, boxH = 22;
                const x = Math.min(Math.max(point.x - boxW/2, 4), chart.width - boxW - 4);
                const y = point.y - boxH - 12;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                if (ctx.roundRect) { ctx.roundRect(x, y, boxW, boxH, 6); } else { ctx.rect(x, y, boxW, boxH); }
                ctx.fill();
                ctx.fillStyle = '#1e293b';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x + boxW/2, y + boxH/2);
                ctx.restore();
            }
        };

        canvas._chartInstance = new window.Chart(canvas, {
            type: 'line',
            data: {
                labels: evolution.map(e => e.mois),
                datasets: [{
                    data: evolution.map(e => e.ca),
                    borderColor: '#6366f1',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    tension: 0.45,
                    fill: true,
                    pointRadius: 4,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverRadius: 6,
                }],
            },
            plugins: [lastPointLabel],
            options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 28 } },
                plugins: { legend: { display: false } },
                scales: {
                    y: { ticks: { color:'#64748b', font:{size:10}, callback: v => v>=1000000?(v/1000000).toFixed(0)+'M':v }, grid:{ color:'#1e293b' } },
                    x: { ticks: { color:'#64748b', font:{size:10} }, grid:{ display:false } },
                },
            },
        });
    }

    _drawDonut() {
        if (!window.Chart) return;
        const canvas = document.getElementById('camlait_global_donut');
        if (!canvas) return;
        const data = this.state.repartition_canal || [];
        if (!data.length) return;
        if (canvas._chartInstance) { canvas._chartInstance.destroy(); }
        canvas._chartInstance = new window.Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.label),
                datasets: [{ data: data.map(d => d.pct), backgroundColor: data.map(d => d.color), borderWidth: 0 }],
            },
            options: { cutout: '65%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
    }

    _drawTop5Chart(canvasId) {
        if (!window.Chart) return;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const top5 = this.state.ventes.top5 || [];
        if (!top5.length) return;
        if (canvas._chartInstance) canvas._chartInstance.destroy();
        canvas._chartInstance = new window.Chart(canvas, {
            type: 'bar',
            data: {
                labels: top5.map(p => p.name),
                datasets: [{
                    data: top5.map(p => p.qty),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4,
                    maxBarThickness: 28,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false, grid: { display: false } },
                    y: { display: false, grid: { display: false } },
                },
            },
        });
    }

    // ── Formatage ────────────────────────────────────────────────
    formatAmount(val) {
        if (!val && val !== 0) return '0';
        if (val >= 1000000) return (val / 1000000).toFixed(1) + ' M';
        if (val >= 1000) return new Intl.NumberFormat('fr-FR').format(Math.round(val));
        return String(Math.round(val));
    }
    formatQty(v) { return new Intl.NumberFormat('fr-FR').format(Math.round(v || 0)); }

    // ── Navigation Achats ────────────────────────────────────────
    openPurchaseConfirmed() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'BdC valides', res_model: 'purchase.order',
            view_mode: 'list,form', views: [[false,'list'],[false,'form']],
            domain: [['state','in',['purchase','done']], ['date_order','>=',this.state.dateFrom], ['date_order','<=',this.state.dateTo]],
            target: 'current',
        });
    }
    openPurchaseDraft() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'BdC en attente', res_model: 'purchase.order',
            view_mode: 'list,form', views: [[false,'list'],[false,'form']],
            domain: [['state','in',['draft','sent']], ['date_order','>=',this.state.dateFrom], ['date_order','<=',this.state.dateTo]],
            target: 'current',
        });
    }
    openPurchaseLate() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'BdC en retard', res_model: 'purchase.order',
            view_mode: 'list,form', views: [[false,'list'],[false,'form']],
            domain: [['state','in',['purchase','done']], ['date_planned','<',this._today()]],
            target: 'current',
        });
    }
    async openPurchaseAnalysis() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_purchase_analysis', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch(e) { console.error(e); }
    }
    openSuppliers() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Fournisseurs actifs', res_model: 'res.partner',
            view_mode: 'list,form', views: [[false,'list'],[false,'form']],
            domain: [['supplier_rank','>',0]], target: 'current',
        });
    }

    // ── Navigation Ventes ────────────────────────────────────────
    async openSaleAnalysis() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_sale_analysis', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch(e) { console.error(e); }
    }
    openSaleDone() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Commandes livrees', res_model: 'sale.order',
            view_mode: 'list,form', views: [[false,'list'],[false,'form']],
            domain: [['state','in',['sale','done']], ['date_order','>=',this.state.dateFrom], ['date_order','<=',this.state.dateTo]],
            target: 'current',
        });
    }
    openSaleWaiting() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Commandes en attente', res_model: 'sale.order',
            view_mode: 'list,form', views: [[false,'list'],[false,'form']],
            domain: [['state','in',['sale','done']], ['date_order','>=',this.state.dateFrom], ['date_order','<=',this.state.dateTo]],
            target: 'current',
        });
    }
    openSaleLate() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Commandes en retard', res_model: 'sale.order',
            view_mode: 'list,form', views: [[false,'list'],[false,'form']],
            domain: [['state','in',['sale','done']], ['commitment_date','<',this._today()]],
            target: 'current',
        });
    }

    async openStock() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_stock', {});
            this.actionService.doAction(action);
        } catch(e) { console.error(e); }
    }
    async openStockAlert() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_stock_alert', {});
            this.actionService.doAction(action);
        } catch(e) { console.error(e); }
    }
    async openMaintenance() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_maintenance', {});
            this.actionService.doAction(action);
        } catch(e) { console.error(e); }
    }
    async openMaintenanceUrgent() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_maintenance_urgent', {});
            this.actionService.doAction(action);
        } catch(e) { console.error(e); }
    }
    async openEquipment() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_equipment', {});
            this.actionService.doAction(action);
        } catch(e) { console.error(e); }
    }
    openOrder(ev) {
        const id = parseInt(ev.currentTarget.dataset.id);
        if (!id) return;
        this._rpc('camlait.dashboard', 'action_open_sale_order', { order_id: id })
            .then(a => this.actionService.doAction(a));
    }

    _today() { return new Date().toISOString().split('T')[0]; }
    _firstDayOfMonth() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    }
}

CamlaitDashboard.components = {};
CamlaitDashboard.template = 'camlait_dashboard.Main';
registry.category('actions').add('camlait_dashboard_action', CamlaitDashboard);