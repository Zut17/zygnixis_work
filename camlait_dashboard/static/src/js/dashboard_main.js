/** @odoo-module **/
console.log("Camlait Dashboard JS loaded");

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { formatAmount, formatQty } from "@camlait_dashboard/js/utils/dashboard_format";
import { StockCard } from "@camlait_dashboard/js/components/stock_card";
import { AchatsCard } from "@camlait_dashboard/js/components/achats_card";
import { VentesCard } from "@camlait_dashboard/js/components/ventes_card";
import {
    SettingsModal,
    TopProductsModal,
    TauxLivraisonModal,
    EvolutionDetailModal,
    StockRotationDetailModal,
} from "@camlait_dashboard/js/components/dashboard_modals";

const { Component, useState, hooks, tags } = owl;
const { onWillStart, onMounted, onPatched, onWillUnmount } = hooks;

// Intervalle d'auto-refresh du dashboard (5 minutes). Utile pour un
// affichage continu (ex: ecran mural) sans avoir a recharger la page.
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const { xml } = tags;

function loadChartJs() {
    return new Promise((resolve) => {
        if (window.Chart) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
        s.onload = resolve;
        document.head.appendChild(s);
    });
}

// Utilisee par l'export "Exporter" (evolution des ventes) : genere un vrai
// fichier .xlsx avec des colonnes correctement dimensionnees, au lieu d'un
// CSV que l'utilisateur devait elargir colonne par colonne.
function loadXlsxJs() {
    return new Promise((resolve) => {
        if (window.XLSX) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
}

const TEMPLATE = xml`
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
                <select class="camlait_period_select" t-on-change="onYearSelect">
                    <option value="">Annee...</option>
                    <t t-foreach="yearOptions()" t-as="y" t-key="y.value">
                        <option t-att-value="y.value" t-att-selected="state.selectedYear===y.value"><t t-esc="y.label"/></option>
                    </t>
                </select>
                <select class="camlait_period_select" t-on-change="onMonthSelect">
                    <option value="">Mois...</option>
                    <t t-foreach="monthOptions()" t-as="m" t-key="m.value">
                        <option t-att-value="m.value" t-att-selected="state.selectedMonth===m.value"><t t-esc="m.label"/></option>
                    </t>
                </select>
                <select class="camlait_period_select" t-on-change="onQuarterSelect">
                    <option value="">Trimestre...</option>
                    <option value="1" t-att-selected="state.selectedQuarter==='1'">T1 (Jan-Mar)</option>
                    <option value="2" t-att-selected="state.selectedQuarter==='2'">T2 (Avr-Juin)</option>
                    <option value="3" t-att-selected="state.selectedQuarter==='3'">T3 (Juil-Sep)</option>
                    <option value="4" t-att-selected="state.selectedQuarter==='4'">T4 (Oct-Dec)</option>
                </select>
                <div class="camlait_daterange_wrap">
                    <button t-att-class="'camlait_period_btn' + (state.activePeriod==='custom'?' active':'')" t-on-click="toggleDateRange">
                        <i class="fa fa-calendar"/> Plage
                    </button>
                    <div class="camlait_daterange_panel" t-if="state.showDateRange" t-on-click.stop="doNothing">
                        <div class="camlait_daterange_field">
                            <label>Du</label>
                            <input type="date" name="rangeFromDraft" t-att-value="state.rangeFromDraft" t-on-change="onRangeDraftChange"/>
                        </div>
                        <div class="camlait_daterange_field">
                            <label>Au</label>
                            <input type="date" name="rangeToDraft" t-att-value="state.rangeToDraft" t-on-change="onRangeDraftChange"/>
                        </div>
                        <div class="camlait_daterange_error" t-if="state.rangeError"><t t-esc="state.rangeError"/></div>
                        <div class="camlait_daterange_actions">
                            <button class="camlait_btn_secondary" t-on-click="cancelDateRange">Annuler</button>
                            <button class="camlait_btn_primary" t-on-click="applyDateRange">Appliquer</button>
                        </div>
                    </div>
                </div>
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

    <!-- ═══ BANDEAU D'ERREUR ═══ -->
    <!-- Affiche visiblement toute erreur de chargement (ex: exception
         Python cote get_dashboard_data), au lieu de la laisser
         uniquement dans la console navigateur. -->
    <div class="camlait_error_banner" t-if="state.loadError" style="background:#fdecea; color:#611a15; border:1px solid #f5c6cb; padding:10px 16px; margin:8px 16px; border-radius:4px; display:flex; align-items:center; justify-content:space-between;">
        <span><i class="fa fa-exclamation-circle"/> Erreur lors du chargement du dashboard : <t t-esc="state.loadError"/></span>
        <button class="camlait_btn_secondary" t-on-click="() => this._loadData()">Reessayer</button>
    </div>

    <!-- ═══ MODALES ═══ -->
    <!-- Extraites en composants separes (dashboard_modals.js). Chacune
         lit comp.state (comp = ce composant, voir "self" plus bas) et
         delegue ses actions (fermer, sauvegarder, changer de periode...)
         aux methodes de ce fichier, qui restent la source unique de la
         logique metier. -->
    <SettingsModal t-if="state.showSettings" comp="self"/>
    <TopProductsModal t-if="state.showTopProducts" comp="self"/>
    <TauxLivraisonModal t-if="state.showTauxLivraison" comp="self"/>
    <EvolutionDetailModal t-if="state.showEvolutionDetail" comp="self"/>
    <StockRotationDetailModal t-if="state.showStockRotationDetail" comp="self"/>

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
                    <h3>Evolution des ventes - <t t-esc="graphPeriodLabel()"/></h3>
                    <div class="camlait_card_header_right">
                        <select class="camlait_period_select camlait_graph_period_select" t-att-value="state.graphPeriod" t-on-change="(ev) => setGraphPeriod(ev.target.value)">
                            <option value="6mois" t-att-selected="state.graphPeriod==='6mois'">6 derniers mois</option>
                            <option value="annee" t-att-selected="state.graphPeriod==='annee'">Cet Annee</option>
                            <option value="mois" t-att-selected="state.graphPeriod==='mois'">Ce mois</option>
                            <option value="6semaines" t-att-selected="state.graphPeriod==='6semaines'">6 derniers semaines</option>
                            <option value="7jours" t-att-selected="state.graphPeriod==='7jours'">7 derniers jours</option>
                        </select>
                        <span class="camlait_link" t-on-click="openEvolutionDetail">Detail</span>
                    </div>
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
                    <span class="camlait_link" t-on-click="openTopProducts">Voir tout</span>
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
                    <div class="camlait_compact_row" t-on-click="openAvaries">
                        <span><i class="fa fa-exclamation-triangle camlait_txt_orange"/> Avarie</span>
                        <strong><t t-esc="state.stock.avarie_count"/> ref.</strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openEchantillons">
                        <span><i class="fa fa-flask camlait_txt_red"/> Echantillon</span>
                        <strong><t t-esc="state.stock.echantillon_count"/> ref.</strong>
                    </div>
                    <div class="camlait_compact_row" t-on-click="openStockRotation">
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
                    <span class="camlait_link" t-on-click="openRecentOrders">Voir tout</span>
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
        <VentesCard comp="self"/>
    </t>

    <!-- ═══════════════════ TAB 2 : ACHATS ═══════════════════ -->
    <t t-if="state.activeTab === 2">
        <AchatsCard comp="self"/>
    </t>

    <!-- ═══════════════════ TAB 3 : STOCK ═══════════════════ -->
    <t t-if="state.activeTab === 3">
        <StockCard comp="self"/>
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
                <div class="camlait_kpi_btn camlait_kpi_blue" t-on-click="openMaintenanceTotal">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-list"/></span><span class="camlait_kpi_label">Total demandes</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.maintenance.total"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_orange" t-on-click="openMaintenanceEnCours">
                    <div class="camlait_kpi_icon_row"><span class="camlait_kpi_fa"><i class="fa fa-cog fa-spin"/></span><span class="camlait_kpi_label">En cours</span></div>
                    <span class="camlait_kpi_value"><t t-esc="state.maintenance.en_cours"/></span>
                </div>
                <div class="camlait_kpi_btn camlait_kpi_green" t-on-click="openMaintenanceTerminees">
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
`;

class CamlaitDashboard extends Component {

    setup() {
        this.actionService = useService("action");
        this._chart = null;
        this._donut = null;
        // Reference vers ce composant, exposee au template sous le nom
        // "self" pour la passer en prop "comp" aux sous-composants
        // (StockCard, AchatsCard, VentesCard, modales) : ils lisent
        // comp.state (le meme objet reactif que ci-dessous, pas une copie)
        // et appellent comp.xxx() pour toute action, qui reste
        // implementee une seule fois ici.
        this.self = this;

        const saved = this._loadSavedPeriod();

        this.state = useState({
            loading: true,
            loadError: '',
            logoError: false,
            activeTab: (saved.activeTab !== undefined && saved.activeTab !== null) ? saved.activeTab : 0,
            activePeriod: saved.activePeriod || 'mois',
            selectedYear: saved.selectedYear || '',
            selectedMonth: saved.selectedMonth || '',
            selectedQuarter: saved.selectedQuarter || '',
            evolutionGroup: saved.evolutionGroup || 'month',
            graphPeriod: saved.graphPeriod || '6mois',
            graphDateFrom: '',
            graphDateTo: '',
            graphGroup: saved.graphGroup || 'month',
            showDateRange: false,
            rangeFromDraft: '',
            rangeToDraft: '',
            rangeError: '',
            showNotifications: false,
            showSettings: false,
            settingsForm: { budget_achats: 0, objectif_ca: 0 },
            showTopProducts: false,
            topProductsLoading: false,
            topProductsList: [],
            topProductsTotalCount: 0,
            showTauxLivraison: false,
            tauxLivraisonLoading: false,
            tauxLivraison: { commandes_confirmees: 0, commandes_livrees: 0, taux_livraison: 0, en_retard: [], en_retard_total: 0, en_attente: [], en_attente_total: 0 },
            showEvolutionDetail: false,
            evolutionDetailLoading: false,
            evolutionDetail: { recap: [], detail: [] },
            dateFrom: saved.dateFrom || this._firstDayOfMonth(),
            dateTo: saved.dateTo || this._today(),
            achats: { bdc_valides: 0, bdc_en_attente: 0, bdc_en_retard: 0, montant_total_engage: 0, fournisseurs_actifs: 0, taux_reception_delais: 0, budget_consomme: 0, has_data: true },
            ventes: { ca_total: 0, ca_delta: 0, objectif_ca: 197000000, commandes_confirmees: 0, cmd_delta: 0, panier_moyen: 0, panier_delta: 0, commandes_livrees: 0, taux_livraison: 0, en_attente: 0, en_retard: 0, top5: [], evolution: [], has_data: true },
            stock: { produits_en_stock: 0, sous_seuil: 0, ruptures: 0, avarie_count: 0, echantillon_count: 0, rotation_stock: 0, taux_dispo: 0, valeur_stock: 0, pct_perime: 0, nb_perime: 0, statuts: [] },
            showStockRotationDetail: false,
            stockRotationDetailLoading: false,
            stockRotationPeriod: 30,
            stockRotationDetail: { recap: { stock_total_qty: 0, sorties_30j: 0, sorties_jour: 0, rotation: 0, nb_mouvements: 0 }, detail: [] },
            maintenance: { total: 0, en_cours: 0, terminees: 0, urgentes: 0, equipements: 0, mtbf_moy: 0, alertes_maint: [] },
            commandes_recentes: [],
            alertes: [],
            repartition_canal: [],
            achats_categories: [],
            bons_commande_recents: [],
            produits_sous_seuil_liste: [],
            stock_emplacements: [],
            alertes_achats: [],
            alertes_stock: [],
        });

        onWillStart(async () => {
            await loadChartJs();
            await this._loadData();
        });

        onMounted(() => {
            this._drawCharts();
        });

        onPatched(() => {
            if (!this.state.loading) this._drawCharts();
        });

        // Auto-refresh : recharge silencieusement les donnees toutes les
        // 5 minutes (sans afficher le spinner de chargement plein ecran),
        // pratique pour un dashboard laisse ouvert / affiche en continu.
        this._autoRefreshTimer = setInterval(() => {
            this._loadData(true);
        }, AUTO_REFRESH_MS);
        onWillUnmount(() => {
            if (this._autoRefreshTimer) clearInterval(this._autoRefreshTimer);
        });
    }

    _loadSavedPeriod() {
        try {
            const raw = sessionStorage.getItem('camlait_dashboard_period');
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    _savePeriod() {
        try {
            sessionStorage.setItem('camlait_dashboard_period', JSON.stringify({
                activePeriod: this.state.activePeriod,
                selectedYear: this.state.selectedYear,
                selectedMonth: this.state.selectedMonth,
                selectedQuarter: this.state.selectedQuarter,
                evolutionGroup: this.state.evolutionGroup,
                graphPeriod: this.state.graphPeriod,
                graphGroup: this.state.graphGroup,
                dateFrom: this.state.dateFrom,
                dateTo: this.state.dateTo,
                activeTab: this.state.activeTab,
            }));
        } catch (e) { /* ignore */ }
    }
    // Sauvegarde uniquement l'onglet actif (evite de re-ecrire toute la periode
    // a chaque changement d'onglet, mais garde l'etat coherent avec le reste).
    _saveTab() {
        this._savePeriod();
    }

    onLogoError() { this.state.logoError = true; }

    _rpc(model, method, kwargs = {}) {
        return this.env.services.rpc('/web/dataset/call_kw', { model, method, args: [], kwargs });
    }

    async _loadData(silent) {
        // silent=true : rafraichissement en arriere-plan (auto-refresh),
        // on evite de reafficher le grand spinner pour ne pas faire
        // "clignoter" tout le dashboard toutes les 5 minutes.
        if (!silent) this.state.loading = true;
        try {
            const result = await this._rpc('camlait.dashboard', 'get_dashboard_data', {
                date_from: this.state.dateFrom,
                date_to: this.state.dateTo,
                evolution_group: this.state.evolutionGroup,
            });
            this.state.loadError = '';
            this.state.achats = result.achats;
            this.state.ventes = result.ventes;
            this.state.stock = result.stock;
            this.state.maintenance = result.maintenance;
            this.state.commandes_recentes = result.commandes_recentes;
            this.state.alertes = result.alertes;
            this.state.repartition_canal = result.repartition_canal;
            this.state.achats_categories = result.achats_categories || [];
            this.state.bons_commande_recents = result.bons_commande_recents || [];
            this.state.produits_sous_seuil_liste = result.produits_sous_seuil_liste || [];
            this.state.stock_emplacements = result.stock_emplacements || [];
            this.state.alertes_achats = result.alertes_achats || [];
            this.state.alertes_stock = result.alertes_stock || [];
            await this._loadEvolutionData();
        } catch (e) {
            console.error('Erreur chargement dashboard :', e);
            this.state.loadError = (e && e.data && e.data.message) || (e && e.message) || String(e);
        } finally {
            if (!silent) this.state.loading = false;
        }
    }

    printDashboard() {
        window.print();
    }
    // ── Plage de dates personnalisee ──────────────────────────────
    toggleDateRange() {
        this.state.showDateRange = !this.state.showDateRange;
        if (this.state.showDateRange) {
            this.state.rangeFromDraft = this.state.dateFrom;
            this.state.rangeToDraft = this.state.dateTo;
        }
    }
    onRangeDraftChange(ev) {
        const { name, value } = ev.target;
        this.state[name] = value;
    }

    async applyDateRange() {
        const from = this.state.rangeFromDraft;
        const to = this.state.rangeToDraft;
        this.state.rangeError = '';
        if (!from || !to) {
            this.state.rangeError = 'Merci de renseigner les deux dates.';
            return;
        }
        if (from > to) {
            this.state.rangeError = 'La date de debut doit preceder la date de fin.';
            return;
        }
        this.state.selectedMonth = '';
        this.state.selectedQuarter = '';
        this.state.showDateRange = false;
        await this._setPeriod('custom', from, to);
    }
    cancelDateRange() {
        this.state.showDateRange = false;
    }

    async _setPeriod(period, from, to) {
        this.state.activePeriod = period;
        this.state.dateFrom = from;
        this.state.dateTo = to;
        this._savePeriod();
        await this._loadData();
    }

    async onDateChange(ev) {
        const { name, value } = ev.target;
        this.state[name] = value;
        this.state.activePeriod = 'custom';
        this._savePeriod();
        await this._loadData();
    }


    setPeriod7j() {
        this.state.selectedMonth = ''; this.state.selectedQuarter = '';
        this.state.selectedYear = '';
        const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 7);
        this._setPeriod('7j', from.toISOString().split('T')[0], to.toISOString().split('T')[0]);
    }
    setPeriodMois() {
        this.state.selectedYear = ''; this.state.selectedMonth = ''; this.state.selectedQuarter = '';
        this._setPeriod('mois', this._firstDayOfMonth(), this._today());
    }
    setPeriodTrim() {
        this.state.selectedYear = ''; this.state.selectedMonth = ''; this.state.selectedQuarter = '';
        const d = new Date();
        const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
        this._setPeriod('trim', qStart.toISOString().split('T')[0], this._today());
    }
    setPeriodAnnee() {
        this.state.selectedMonth = ''; this.state.selectedQuarter = '';
        const year = new Date().getFullYear();
        this.state.selectedYear = String(year);
        this._setPeriod('annee', `${year}-01-01`, this._today());
    }

    yearOptions() {
        const today = new Date();
        const currentYear = today.getFullYear();
        const years = [];
        for (let i = 0; i < 6; i++) {
            years.push({ value: String(currentYear - i), label: String(currentYear - i) });
        }
        return years;
    }

    monthOptions() {
        const names = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
        return names.map((label, i) => ({ value: String(i), label }));
    }
    onMonthSelect(ev) {
        const m = ev.target.value;
        if (m === '') return;
        this.state.selectedMonth = m;
        this.state.selectedQuarter = '';
        this.state.selectedYear = '';
        const year = new Date().getFullYear();
        const month = parseInt(m, 10);
        const from = new Date(year, month, 1);
        const isCurrentMonth = (month === new Date().getMonth());
        const to = isCurrentMonth ? new Date() : new Date(year, month + 1, 0);
        this._setPeriod('mois_custom', from.toISOString().split('T')[0], to.toISOString().split('T')[0]);
    }
    onQuarterSelect(ev) {
        const q = ev.target.value;
        if (q === '') return;
        this.state.selectedQuarter = q;
        this.state.selectedMonth = '';
        this.state.selectedYear = '';
        const year = new Date().getFullYear();
        const qNum = parseInt(q, 10);
        const startMonth = (qNum - 1) * 3;
        const from = new Date(year, startMonth, 1);
        const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;
        const to = (qNum === currentQuarter) ? new Date() : new Date(year, startMonth + 3, 0);
        this._setPeriod('trim_custom', from.toISOString().split('T')[0], to.toISOString().split('T')[0]);
    }
    onYearSelect(ev) {
        const year = ev.target.value;
        if (year === '') return;
        this.state.selectedYear = year;
        this.state.selectedMonth = '';
        this.state.selectedQuarter = '';
        this._setPeriod('annee', `${year}-01-01`, `${year}-12-31`);
    }
    onEvolutionGroupChange(ev) {
        const group = ev.target.value;
        if (!group) return;
        this.state.evolutionGroup = group;
        this._savePeriod();
        this._loadData();
    }

    async setGraphPeriod(period) {
        const { from, to, group } = this._resolveGraphPeriod(period);
        this.state.graphPeriod = period;
        this.state.graphGroup = group;
        this.state.graphDateFrom = from;
        this.state.graphDateTo = to;
        this._savePeriod();
        await this._loadEvolutionData(from, to, group);
    }

    _resolveGraphPeriod(period) {
        const today = new Date();
        let from = new Date(today);
        let group = 'month';

        switch (period) {
            case 'annee':
                from = new Date(today.getFullYear(), 0, 1);
                group = 'month';
                break;
            case 'mois':
                from = new Date(today.getFullYear(), today.getMonth(), 1);
                group = 'day';
                break;
            case '6semaines':
                from.setDate(today.getDate() - 41);
                group = 'week';
                break;
            case '7jours':
                from.setDate(today.getDate() - 6);
                group = 'day';
                break;
            case '6mois':
            default:
                from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
                group = 'month';
                break;
        }

        const to = new Date(today);
        const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { from: formatDate(from), to: formatDate(to), group };
    }

    async _loadEvolutionData(from, to, group) {
        const params = { evolution_group: group || this.state.graphGroup || 'month' };
        if (from && to) {
            params.date_from = from;
            params.date_to = to;
        } else {
            const range = this._resolveGraphPeriod(this.state.graphPeriod);
            params.date_from = range.from;
            params.date_to = range.to;
            params.evolution_group = range.group;
            this.state.graphGroup = range.group;
            this.state.graphDateFrom = range.from;
            this.state.graphDateTo = range.to;
        }
        try {
            const result = await this._rpc('camlait.dashboard', 'get_ventes_evolution', params);
            this.state.ventes.evolution = result.evolution || [];
        } catch (e) {
            console.error('Erreur chargement evolution des ventes :', e);
            this.state.ventes.evolution = [];
        }
    }

    graphPeriodLabel() {
        const labels = {
            '6mois': '6 derniers mois',
            'annee': 'Cet Annee',
            'mois': 'Ce mois',
            '6semaines': '6 derniers semaines',
            '7jours': '7 derniers jours',
        };
        return labels[this.state.graphPeriod] || 'Evolution des ventes';
    }

    periodLabel() {
        const map = {
            '7j': '7 derniers jours', 'mois': 'Mois en cours', 'trim': 'Trimestre en cours',
            'annee': 'Annee en cours', 'custom': 'Periode personnalisee (' + this.state.dateFrom + ' au ' + this.state.dateTo + ')',
        };
        if (this.state.activePeriod === 'mois_custom' && this.state.selectedMonth !== '') {
            return this.monthOptions()[parseInt(this.state.selectedMonth, 10)].label + ' ' + new Date().getFullYear();
        }
        if (this.state.activePeriod === 'trim_custom' && this.state.selectedQuarter !== '') {
            return 'Trimestre ' + this.state.selectedQuarter + ' ' + new Date().getFullYear();
        }
        if (this.state.activePeriod === 'annee' && this.state.selectedYear) {
            return 'Annee ' + this.state.selectedYear;
        }
        return map[this.state.activePeriod] || 'Periode';
    }

    async onDateFromChange(ev) {
        const val = ev.target.value;
        if (!val) return;
        this.state.dateFrom = val;
        this.state.activePeriod = 'custom';
        await this._loadData();
    }

    async onDateToChange(ev) {
        const val = ev.target.value;
        if (!val) return;
        this.state.dateTo = val;
        this.state.activePeriod = 'custom';
        await this._loadData();
    }
    // ── Sélecteurs de date personnalisés ─────────────────────────
    onCustomDayChange(ev) {
        const val = ev.target.value;
        if (val && parseInt(val) >= 1 && parseInt(val) <= 31) {
            this.state.customDay = String(parseInt(val)).padStart(2, '0');
        }
    }

    onCustomMonthChange(ev) {
        this.state.customMonth = ev.target.value;
        // Mettre à jour customDay si le mois change
        // (ex: éviter le 31 en février)
        const maxDay = new Date(
            parseInt(this.state.customYear),
            parseInt(this.state.customMonth),
            0
        ).getDate();
        if (parseInt(this.state.customDay) > maxDay) {
            this.state.customDay = String(maxDay).padStart(2, '0');
        }
    }

    onCustomYearChange(ev) {
        const val = ev.target.value;
        if (val && parseInt(val) >= 2020 && parseInt(val) <= 2099) {
            this.state.customYear = val;
        }
    }

    async applyCustomDate() {
        const day = this.state.customDay;
        const month = this.state.customMonth;
        const year = this.state.customYear;

        // Construire les dates : du 1er du mois au jour sélectionné
        const dateFrom = `${year}-${month}-01`;
        const dateTo = `${year}-${month}-${day}`;

        // Valider que dateTo est une date réelle
        const d = new Date(dateTo);
        if (isNaN(d.getTime())) {
            console.warn('Date invalide :', dateTo);
            return;
        }

        await this._setPeriod('custom', dateFrom, dateTo);
    }


    // ── Onglets ──────────────────────────────────────────────────
    // On memorise l'onglet actif a chaque changement (sessionStorage) afin
    // que si l'utilisateur clique sur une section pour voir le detail, puis
    // revient en arriere, il retrouve l'onglet ou il se trouvait (Ventes,
    // Achats, Stock, Maintenance...) et non systematiquement la Vue globale.
    setTab0() { this.state.activeTab = 0; this._saveTab(); }
    setTab1() { this.state.activeTab = 1; this._saveTab(); }
    setTab2() { this.state.activeTab = 2; this._saveTab(); }
    setTab3() { this.state.activeTab = 3; this._saveTab(); }
    setTab4() { this.state.activeTab = 4; this._saveTab(); }

    // ── Notifications ────────────────────────────────────────────
    toggleNotifications() { this.state.showNotifications = !this.state.showNotifications; }
    countUrgent() { return (this.state.alertes || []).filter(a => a.type === 'danger').length; }

    // ── Reglages ─────────────────────────────────────────────────
    async openSettings() {
        try {
            const s = await this._rpc('camlait.dashboard', 'get_settings', {});
            this.state.settingsForm = { budget_achats: s.budget_achats, objectif_ca: s.objectif_ca };
            this.state.showSettings = true;
        } catch (e) { console.error(e); }
    }
    closeSettings() { this.state.showSettings = false; }
    doNothing() { }
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
        } catch (e) { console.error(e); }
    }

    // ── Export du recapitulatif (Excel, avec repli CSV) ───────────
    // Bug corrige : le separateur de lignes etait la chaine litterale
    // "\\n" (2 caracteres) au lieu d'un vrai saut de ligne, ce qui
    // affichait tout le fichier sur une seule ligne illisible. On genere
    // maintenant un vrai .xlsx avec des colonnes deja dimensionnees (plus
    // besoin de les elargir a la main) ; si la librairie ne peut pas se
    // charger (reseau), on retombe sur un CSV correctement forme (BOM
    // UTF-8 + vrais sauts de ligne + valeurs entre guillemets).
    async exportCsv() {
        const rows = [['Indicateur', 'Valeur']];
        rows.push(['Periode', this.state.dateFrom + ' au ' + this.state.dateTo]);
        rows.push(["Chiffre d'affaires (FCFA)", this.state.ventes.ca_total]);
        rows.push(['Commandes confirmees', this.state.ventes.commandes_confirmees]);
        rows.push(['Commandes livrees', this.state.ventes.commandes_livrees]);
        rows.push(['Taux de livraison (%)', this.state.ventes.taux_livraison]);
        rows.push(['Commandes en attente', this.state.ventes.en_attente]);
        rows.push(['Devis en retard de relance', this.state.ventes.en_retard]);
        rows.push(['Panier moyen (FCFA)', this.state.ventes.panier_moyen]);
        rows.push(['BdC valides', this.state.achats.bdc_valides]);
        rows.push(['Montant achats engage (FCFA)', this.state.achats.montant_total_engage]);
        rows.push(['Valeur stock (FCFA)', this.state.stock.valeur_stock]);
        rows.push(['Produits sous seuil', this.state.stock.sous_seuil]);
        rows.push(['Avarie (produits)', this.state.stock.avarie_count]);
        rows.push(['Echantillon (produits)', this.state.stock.echantillon_count]);
        rows.push(['Demandes maintenance urgentes', this.state.maintenance.urgentes]);

        const fileBase = `camlait_dashboard_${this.state.dateFrom}_${this.state.dateTo}`;

        try {
            const loaded = await loadXlsxJs();
            if (loaded && window.XLSX) {
                const ws = window.XLSX.utils.aoa_to_sheet(rows);
                // Largeur de chaque colonne calculee a partir du contenu
                // le plus long : evite d'avoir a re-dimensionner les
                // colonnes soi-meme une fois le fichier ouvert.
                const colCount = rows[0].length;
                ws['!cols'] = Array.from({ length: colCount }, (_, colIdx) => {
                    const maxLen = rows.reduce((max, row) => {
                        const cell = row[colIdx] === undefined || row[colIdx] === null ? '' : String(row[colIdx]);
                        return Math.max(max, cell.length);
                    }, 0);
                    return { wch: Math.max(14, maxLen + 3) };
                });
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, 'Indicateurs');
                window.XLSX.writeFile(wb, `${fileBase}.xlsx`);
                return;
            }
        } catch (e) {
            console.error('Export Excel impossible, repli sur CSV :', e);
        }

        // Repli CSV : BOM UTF-8 (accents lisibles dans Excel), point-virgule
        // (separateur standard Excel FR) et VRAIS sauts de ligne.
        const escapeCsv = (v) => `"${String(v).replace(/"/g, '""')}"`;
        const csv = '\uFEFF' + rows.map(r => r.map(escapeCsv).join(';')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileBase}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Graphiques ───────────────────────────────────────────────
    _drawCharts() {
        this._drawLineChart('camlait_evolution_chart');
        this._drawLineChart('camlait_global_chart');
        this._drawTop5Chart('camlait_top5_chart_global');
        this._drawDonut('camlait_global_donut');
        this._drawDonut('camlait_ventes_donut');
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
                if (value >= 1000000) label = (value / 1000000).toFixed(1).replace('.', ',') + ' M FCFA';
                else if (value >= 1000) label = (value / 1000).toFixed(0) + ' K FCFA';
                else label = value + ' FCFA';

                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 11px Calibri, Arial, sans-serif';
                const textW = ctx.measureText(label).width;
                const boxW = textW + 16, boxH = 22;
                const x = Math.min(Math.max(point.x - boxW / 2, 4), chart.width - boxW - 4);
                const y = point.y - boxH - 12;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                if (ctx.roundRect) { ctx.roundRect(x, y, boxW, boxH, 6); } else { ctx.rect(x, y, boxW, boxH); }
                ctx.fill();
                ctx.fillStyle = '#1e293b';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x + boxW / 2, y + boxH / 2);
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
                    y: { ticks: { color: '#64748b', font: { size: 10 }, callback: v => v >= 1000000 ? (v / 1000000).toFixed(0) + 'M' : v }, grid: { color: '#1e293b' } },
                    x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { display: false } },
                },
            },
        });
    }

    _drawDonut(canvasId) {
        if (!window.Chart) return;
        const canvas = document.getElementById(canvasId);
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
    // Implementation partagee dans utils/dashboard_format.js (utilisee
    // telle quelle par StockCard/AchatsCard/VentesCard/modales) ; gardees
    // ici comme methodes du composant principal, car son propre template
    // (Tab 0 "vue globale", Tab 4 "maintenance", en-tete) les appelle
    // encore directement (ex: t-esc="formatAmount(...)").
    formatAmount(val) { return formatAmount(val); }
    formatQty(v) { return formatQty(v); }

    // ── Navigation Achats ────────────────────────────────────────
    // Chaque action ci-dessous reprend EXACTEMENT le meme domaine que celui
    // utilise cote serveur (models/dashboard.py) pour calculer la valeur
    // affichee sur la carte/section correspondante, afin que la liste qui
    // s'ouvre mette bien en evidence (et corresponde a) les chiffres du
    // tableau de bord.
    openPurchaseConfirmed() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'BdC valides ce mois', res_model: 'purchase.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [['state', 'in', ['purchase', 'done']], ['date_order', '>=', this.state.dateFrom], ['date_order', '<=', this.state.dateTo]],
            target: 'current',
        });
    }
    openPurchaseDraft() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'BdC en attente de validation', res_model: 'purchase.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [['state', 'in', ['draft', 'sent']], ['date_order', '>=', this.state.dateFrom], ['date_order', '<=', this.state.dateTo]],
            target: 'current',
        });
    }
    openPurchaseLate() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'BdC en retard fournisseur', res_model: 'purchase.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [
                ['state', 'in', ['purchase', 'done']],
                ['date_planned', '<', this._today()],
                ['picking_ids.state', 'not in', ['done', 'cancel']],
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
            ],
            target: 'current',
        });
    }
    async openPurchaseAnalysis() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_purchase_analysis', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Avarie" reprend le meme calcul que 'avarie_count' cote serveur :
    // quants a quantite > 0 dans les emplacements 'Avarie' de chaque
    // entrepot cible (Ndogbong/Douala, Yaounde, Bafoussam).
    async openAvaries() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_avaries', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Echantillon" reprend le meme calcul que 'echantillon_count' cote
    // serveur : quants a quantite > 0 dans les emplacements 'Echantillon'
    // de chaque entrepot cible.
    async openEchantillons() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_echantillons', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Fournisseurs actifs" = fournisseurs ayant au moins un BdC confirme
    // sur la periode selectionnee (meme calcul que _get_achats cote serveur),
    // et non "tous les partenaires marques fournisseur" comme avant.
    async openSuppliers() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_suppliers', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Bons de commande recents" (section) n'est PAS filtre par periode ni
    // par statut cote serveur (_get_bons_commande_recents) : "Voir tout"
    // doit donc ouvrir la meme liste non filtree, et non l'analyse achats
    // filtree sur la periode/etat comme c'etait le cas avant.
    openRecentPurchaseOrders() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Bons de commande recents', res_model: 'purchase.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [], target: 'current',
        });
    }

    // ── Navigation Ventes ────────────────────────────────────────
    async openSaleAnalysis() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_sale_analysis', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    openSaleDone() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Commandes livrees', res_model: 'sale.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [
                ['state', 'in', ['sale', 'done']],
                ['picking_ids.state', '=', 'done'],
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
            ],
            target: 'current',
        });
    }
    // "Commandes confirmees" (Ventes) = memes commandes que celles utilisees
    // pour calculer le CA / panier moyen : state in (sale, done) sur la
    // periode. Avant, la carte renvoyait vers l'analyse generale des ventes
    // qui ne correspondait pas forcement au nombre affiche.
    openSaleConfirmed() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Commandes confirmees', res_model: 'sale.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [
                ['state', 'in', ['sale', 'done']],
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
            ],
            target: 'current',
        });
    }
    openSaleWaiting() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Devis en attente de confirmation', res_model: 'sale.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [['state', 'in', ['draft', 'sent']], ['date_order', '>=', this.state.dateFrom], ['date_order', '<=', this.state.dateTo]],
            target: 'current',
        });
    }
    // "Commandes clients recentes" (section) n'est pas filtree par periode
    // ni par un seul statut cote serveur (_get_commandes_recentes prend les
    // 6 dernieres commandes, tous statuts sale/done/cancel confondus).
    // "Voir tout" doit donc refleter la meme liste, au lieu de ne montrer
    // que les commandes livrees comme c'etait le cas avant.
    openRecentOrders() {
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Commandes clients recentes', res_model: 'sale.order',
            view_mode: 'list,form', views: [[false, 'list'], [false, 'form']],
            domain: [['state', 'in', ['sale', 'done', 'cancel']]],
            target: 'current',
        });
    }
    openProduct(productId) {
        if (!productId) {
            return;
        }
        this.actionService.doAction({
            type: 'ir.actions.act_window', name: 'Produit', res_model: 'product.product', res_id: productId,
            view_mode: 'form', views: [[false, 'form']], target: 'current',
        });
    }
    // "Top 5 produits vendus -> Voir tout" doit montrer la LISTE complete
    // des produits, deja classee par CA decroissant (comme le tableau du
    // dashboard) -- pas un total agrege. On affiche ce classement dans une
    // fenetre dediee (meme calcul/tri que la carte) plutot que de renvoyer
    // vers l'analyse generale des ventes (qui ouvrait un pivot = 1 seul total).
    async openTopProducts() {
        this.state.showTopProducts = true;
        this.state.topProductsLoading = true;
        try {
            const result = await this._rpc('camlait.dashboard', 'get_top_products_ventes', {
                date_from: this.state.dateFrom, date_to: this.state.dateTo, limit: 50,
            });
            this.state.topProductsList = result.items || [];
            this.state.topProductsTotalCount = result.total_count || 0;
        } catch (e) {
            console.error(e);
            this.state.topProductsList = [];
            this.state.topProductsTotalCount = 0;
        } finally {
            this.state.topProductsLoading = false;
        }
    }
    closeTopProducts() { this.state.showTopProducts = false; }

    // "Taux de livraison" (Ventes) : le corps de la carte pointe vers le
    // rapport qui a permis d'obtenir le taux (openSaleAnalysis). Les deux
    // sous-lignes de la carte pointent chacune vers leur propre liste :
    // devis en retard de relance, et devis en attente de confirmation.
    async openSaleQuotesLate() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_sale_quotes_late', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }

    // "Taux de livraison" : au lieu de renvoyer vers un rapport (montant
    // agrege), affiche le calcul exact (livrees / confirmees) et les deux
    // listes qui expliquent l'ecart : livraisons en retard et livraisons
    // en attente de validation.
    async openTauxLivraisonDetail() {
        this.state.showTauxLivraison = true;
        this.state.tauxLivraisonLoading = true;
        try {
            const result = await this._rpc('camlait.dashboard', 'get_taux_livraison_detail', {
                date_from: this.state.dateFrom, date_to: this.state.dateTo,
            });
            this.state.tauxLivraison = result;
        } catch (e) {
            console.error(e);
        } finally {
            this.state.tauxLivraisonLoading = false;
        }
    }
    closeTauxLivraison() { this.state.showTauxLivraison = false; }

    // "Evolution des ventes -> Detail" : au lieu de renvoyer vers un
    // rapport (montant agrege), affiche le recapitulatif mensuel (memes
    // totaux que le graphique) puis la liste des commandes de chaque mois.
    async openEvolutionDetail() {
        this.state.showEvolutionDetail = true;
        this.state.evolutionDetailLoading = true;
        try {
            const result = await this._rpc('camlait.dashboard', 'get_evolution_detail', {});
            this.state.evolutionDetail = result;
        } catch (e) {
            console.error(e);
        } finally {
            this.state.evolutionDetailLoading = false;
        }
    }
    closeEvolutionDetail() { this.state.showEvolutionDetail = false; }

    async openStock() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_stock', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Ruptures" doit montrer les quants a quantite <= 0 (et non les memes
    // produits en stock positif que la carte "Valeur du stock" / "Produits
    // en stock" qui reutilisaient toutes deux openStock() par erreur).
    async openStockRuptures() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_stock_ruptures', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Rotation moy. stock" est calculee a partir des sorties de stock
    // (mouvements vers l'exterieur) des 30 derniers jours : le detail doit
    // donc montrer ces mouvements, plutot que la liste des produits en stock.
    async openStockRotation() {
        this.state.showStockRotationDetail = true;
        await this._loadStockRotationDetail();
    }
    // Permet d'ajuster la fenetre de calcul de la rotation (7/14/30/60/90j)
    // au lieu d'une valeur fixe de 30 jours : utile pour des produits a
    // peremption rapide (produits laitiers) ou l'on veut une rotation
    // calculee sur une periode plus courte que 30 jours.
    async changeStockRotationPeriod(periodDays) {
        this.state.stockRotationPeriod = periodDays;
        await this._loadStockRotationDetail();
    }
    async _loadStockRotationDetail() {
        this.state.stockRotationDetailLoading = true;
        try {
            const result = await this._rpc('camlait.dashboard', 'get_stock_rotation_detail', {
                period_days: this.state.stockRotationPeriod,
            });
            this.state.stockRotationDetail = result;
        } catch (e) {
            console.error(e);
        } finally {
            this.state.stockRotationDetailLoading = false;
        }
    }
    closeStockRotationDetail() { this.state.showStockRotationDetail = false; }
    async openStockAlert() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_stock_alert', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Total demandes" est filtre sur la periode selectionnee (create_date)
    // cote serveur : on transmet donc la meme periode ici, alors qu'avant
    // aucune periode n'etait appliquee (la liste montrait TOUTES les
    // demandes, sans lien avec le chiffre affiche).
    async openMaintenanceTotal() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_maintenance', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "En cours" = demandes dont l'etape n'est pas "done", sans filtre de
    // periode (meme calcul que _get_maintenance cote serveur).
    async openMaintenanceEnCours() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_maintenance_en_cours', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    // "Terminees" = demandes cloturees (stage done) dont la date de cloture
    // tombe dans la periode selectionnee (meme calcul que cote serveur).
    async openMaintenanceTerminees() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_maintenance_terminees', { date_from: this.state.dateFrom, date_to: this.state.dateTo });
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    async openMaintenanceUrgent() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_maintenance_urgent', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
    }
    async openEquipment() {
        try {
            const action = await this._rpc('camlait.dashboard', 'action_open_equipment', {});
            this.actionService.doAction(action);
        } catch (e) { console.error(e); }
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
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }
}

CamlaitDashboard.template = TEMPLATE;
CamlaitDashboard.components = {
    StockCard,
    AchatsCard,
    VentesCard,
    SettingsModal,
    TopProductsModal,
    TauxLivraisonModal,
    EvolutionDetailModal,
    StockRotationDetailModal,
};
registry.category('actions').add('camlait_dashboard_owl_action_main', CamlaitDashboard);