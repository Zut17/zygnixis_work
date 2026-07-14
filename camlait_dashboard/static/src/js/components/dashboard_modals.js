/** @odoo-module **/

import { formatAmount, formatQty } from "@camlait_dashboard/js/utils/dashboard_format";

const { Component } = owl;
const { xml } = owl.tags;

// Toutes les modales du dashboard, extraites de dashboard_main.js et
// regroupees dans ce fichier (chacune reste un petit composant autonome).
// Meme principe que les cartes (stock_card.js, achats_card.js,
// ventes_card.js) : pas de donnees locales, tout vient de comp.state,
// les actions (fermer, sauvegarder, changer de periode...) restent
// implementees une seule fois sur le composant principal.

export class SettingsModal extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
    }
}
SettingsModal.template = xml`
<div class="camlait_modal_overlay" t-on-click="() => comp.closeSettings()">
    <div class="camlait_modal" t-on-click.stop="() => comp.doNothing()">
        <h3>Reglages du tableau de bord</h3>
        <div class="camlait_modal_field">
            <label>Budget achats mensuel (FCFA)</label>
            <input type="number" t-att-value="state.settingsForm.budget_achats" t-on-change="(ev) => comp.onBudgetChange(ev)"/>
        </div>
        <div class="camlait_modal_field">
            <label>Objectif de chiffre d'affaires mensuel (FCFA)</label>
            <input type="number" t-att-value="state.settingsForm.objectif_ca" t-on-change="(ev) => comp.onObjectifChange(ev)"/>
        </div>
        <div class="camlait_modal_actions">
            <button class="camlait_btn_secondary" t-on-click="() => comp.closeSettings()">Annuler</button>
            <button class="camlait_btn_primary" t-on-click="() => comp.saveSettings()">Enregistrer</button>
        </div>
    </div>
</div>
`;

// Affiche le classement complet (jusqu'a 50) des produits les plus
// vendus sur la periode, trie par chiffre d'affaires decroissant :
// exactement le meme calcul/ordre que le tableau "Top 5 produits
// vendus" du tableau de bord (ce n'est donc jamais un simple total).
export class TopProductsModal extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
        this.formatAmount = formatAmount;
        this.formatQty = formatQty;
    }
}
TopProductsModal.template = xml`
<div class="camlait_modal_overlay" t-on-click="() => comp.closeTopProducts()">
    <div class="camlait_modal camlait_modal_wide" t-on-click.stop="() => comp.doNothing()">
        <h3>Produits les plus vendus - <t t-esc="comp.periodLabel()"/></h3>
        <t t-if="state.topProductsLoading">
            <div class="camlait_loader"><i class="fa fa-spin fa-circle-o-notch fa-lg"/> Chargement...</div>
        </t>
        <t t-else="">
            <table class="camlait_table">
                <thead><tr><th>#</th><th>PRODUIT</th><th class="camlait_th_right">QTE VENDUE</th><th class="camlait_th_right">CHIFFRE D'AFFAIRES</th><th class="camlait_th_right">TENDANCE</th></tr></thead>
                <tbody>
                    <t t-foreach="state.topProductsList" t-as="p" t-key="p.product_id">
                        <tr class="camlait_tr_hover" t-on-click="() => comp.openProduct(p.product_id)">
                            <td><t t-esc="p.rank"/></td>
                            <td class="camlait_link_cell"><t t-esc="p.name"/></td>
                            <td class="camlait_td_right"><t t-esc="formatQty(p.qty)"/></td>
                            <td class="camlait_td_right"><span class="camlait_badge_ca"><t t-esc="formatAmount(p.ca)"/></span></td>
                            <td class="camlait_td_right">
                                <span t-att-class="'camlait_delta ' + (p.tendance>=0?'pos':'neg')">
                                    <i t-att-class="'fa ' + (p.tendance>0?'fa-arrow-up':(p.tendance&lt;0?'fa-arrow-down':'fa-minus'))"/>
                                    <t t-esc="(p.tendance>0?'+':'') + p.tendance"/>%
                                </span>
                            </td>
                        </tr>
                    </t>
                    <t t-if="!state.topProductsList.length">
                        <tr><td colspan="5" class="camlait_empty">Aucune donnee sur cette periode.</td></tr>
                    </t>
                </tbody>
            </table>
            <div class="camlait_modal_note" t-if="state.topProductsTotalCount > state.topProductsList.length">
                Affichage des <t t-esc="state.topProductsList.length"/> premiers produits sur <t t-esc="state.topProductsTotalCount"/> vendus sur la periode.
            </div>
        </t>
        <div class="camlait_modal_actions">
            <button class="camlait_btn_secondary" t-on-click="() => comp.closeTopProducts()">Fermer</button>
        </div>
    </div>
</div>
`;

// Justifie le pourcentage affiche sur la carte "Taux de livraison" :
// montre le calcul (commandes livrees / commandes confirmees) puis
// les deux listes qui expliquent l'ecart : livraisons en retard et
// livraisons en attente de validation.
export class TauxLivraisonModal extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
        this.formatAmount = formatAmount;
    }
}
TauxLivraisonModal.template = xml`
<div class="camlait_modal_overlay" t-on-click="() => comp.closeTauxLivraison()">
    <div class="camlait_modal camlait_modal_wide" t-on-click.stop="() => comp.doNothing()">
        <h3>Taux de livraison - <t t-esc="comp.periodLabel()"/></h3>
        <t t-if="state.tauxLivraisonLoading">
            <div class="camlait_loader"><i class="fa fa-spin fa-circle-o-notch fa-lg"/> Chargement...</div>
        </t>
        <t t-else="">
            <div class="camlait_calc_box">
                <div class="camlait_calc_line">
                    Commandes livrees / Commandes confirmees =
                    <strong><t t-esc="state.tauxLivraison.commandes_livrees"/></strong> /
                    <strong><t t-esc="state.tauxLivraison.commandes_confirmees"/></strong>
                    = <strong><t t-esc="state.tauxLivraison.taux_livraison"/>%</strong>
                </div>
            </div>

            <h4>Livraisons en retard (<t t-esc="state.tauxLivraison.en_retard_total"/>)</h4>
            <table class="camlait_table">
                <thead><tr><th>COMMANDE</th><th>CLIENT</th><th class="camlait_th_right">MONTANT</th><th>PREVUE LE</th><th class="camlait_th_right">RETARD</th><th>STATUT</th></tr></thead>
                <tbody>
                    <t t-foreach="state.tauxLivraison.en_retard" t-as="r" t-key="r.order_id">
                        <tr>
                            <td><t t-esc="r.name"/></td>
                            <td><t t-esc="r.partner"/></td>
                            <td class="camlait_td_right"><t t-esc="formatAmount(r.montant)"/></td>
                            <td><t t-esc="r.scheduled"/></td>
                            <td class="camlait_td_right"><t t-esc="r.jours_retard"/> j</td>
                            <td><t t-esc="r.statut"/></td>
                        </tr>
                    </t>
                    <t t-if="!state.tauxLivraison.en_retard.length">
                        <tr><td colspan="6" class="camlait_empty">Aucune livraison en retard.</td></tr>
                    </t>
                </tbody>
            </table>

            <h4>Livraisons en attente de validation (<t t-esc="state.tauxLivraison.en_attente_total"/>)</h4>
            <table class="camlait_table">
                <thead><tr><th>COMMANDE</th><th>CLIENT</th><th class="camlait_th_right">MONTANT</th><th>DATE COMMANDE</th><th>PREVUE LE</th><th>STATUT</th></tr></thead>
                <tbody>
                    <t t-foreach="state.tauxLivraison.en_attente" t-as="r" t-key="r.order_id">
                        <tr>
                            <td><t t-esc="r.name"/></td>
                            <td><t t-esc="r.partner"/></td>
                            <td class="camlait_td_right"><t t-esc="formatAmount(r.montant)"/></td>
                            <td><t t-esc="r.date"/></td>
                            <td><t t-esc="r.scheduled or '-'"/></td>
                            <td><t t-esc="r.statut"/></td>
                        </tr>
                    </t>
                    <t t-if="!state.tauxLivraison.en_attente.length">
                        <tr><td colspan="6" class="camlait_empty">Aucune livraison en attente de validation.</td></tr>
                    </t>
                </tbody>
            </table>
        </t>
        <div class="camlait_modal_actions">
            <button class="camlait_btn_secondary" t-on-click="() => comp.closeTauxLivraison()">Fermer</button>
        </div>
    </div>
</div>
`;

// Justifie le graphique "Evolution des ventes" : recapitulatif mensuel
// (memes totaux que les points du graphique) suivi de la liste des
// commandes qui composent chaque mois.
export class EvolutionDetailModal extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
        this.formatAmount = formatAmount;
    }
}
EvolutionDetailModal.template = xml`
<div class="camlait_modal_overlay" t-on-click="() => comp.closeEvolutionDetail()">
    <div class="camlait_modal camlait_modal_wide" t-on-click.stop="() => comp.doNothing()">
        <h3>Evolution des ventes - detail des 6 derniers mois</h3>
        <t t-if="state.evolutionDetailLoading">
            <div class="camlait_loader"><i class="fa fa-spin fa-circle-o-notch fa-lg"/> Chargement...</div>
        </t>
        <t t-else="">
            <h4>Recapitulatif mensuel (justifie le graphique)</h4>
            <table class="camlait_table">
                <thead><tr><th>MOIS</th><th class="camlait_th_right">CA</th><th class="camlait_th_right">NB COMMANDES</th></tr></thead>
                <tbody>
                    <t t-foreach="state.evolutionDetail.recap" t-as="m" t-key="m.mois">
                        <tr>
                            <td><t t-esc="m.mois"/></td>
                            <td class="camlait_td_right"><span class="camlait_badge_ca"><t t-esc="formatAmount(m.ca)"/></span></td>
                            <td class="camlait_td_right"><t t-esc="m.nb_commandes"/></td>
                        </tr>
                    </t>
                </tbody>
            </table>

            <h4>Detail des commandes</h4>
            <table class="camlait_table">
                <thead><tr><th>MOIS</th><th>COMMANDE</th><th>CLIENT</th><th>DATE</th><th class="camlait_th_right">MONTANT</th></tr></thead>
                <tbody>
                    <t t-foreach="state.evolutionDetail.detail" t-as="d" t-key="d.order_id">
                        <tr>
                            <td><t t-esc="d.mois"/></td>
                            <td><t t-esc="d.name"/></td>
                            <td><t t-esc="d.partner"/></td>
                            <td><t t-esc="d.date"/></td>
                            <td class="camlait_td_right"><t t-esc="formatAmount(d.montant)"/></td>
                        </tr>
                    </t>
                    <t t-if="!state.evolutionDetail.detail.length">
                        <tr><td colspan="5" class="camlait_empty">Aucune commande sur cette periode.</td></tr>
                    </t>
                </tbody>
            </table>
        </t>
        <div class="camlait_modal_actions">
            <button class="camlait_btn_secondary" t-on-click="() => comp.closeEvolutionDetail()">Fermer</button>
        </div>
    </div>
</div>
`;

export class StockRotationDetailModal extends Component {
    setup() {
        this.comp = this.props.comp;
        this.state = this.comp.state;
    }
}
StockRotationDetailModal.template = xml`
<div class="camlait_modal_overlay" t-on-click="() => comp.closeStockRotationDetail()">
    <div class="camlait_modal camlait_modal_wide" t-on-click.stop="() => comp.doNothing()">
        <h3>Rotation moy. stock</h3>
        <div class="camlait_period_selector">
            <span>Periode : </span>
            <t t-foreach="[7, 14, 30, 60, 90]" t-as="p" t-key="p">
                <button t-att-class="state.stockRotationPeriod === p ? 'camlait_btn_period_active' : 'camlait_btn_period'"
                        t-on-click="() => comp.changeStockRotationPeriod(p)">
                    <t t-esc="p"/>j
                </button>
            </t>
        </div>
        <t t-if="state.stockRotationDetailLoading">
            <div class="camlait_loader"><i class="fa fa-spin fa-circle-o-notch fa-lg"/> Chargement...</div>
        </t>
        <t t-else="">
            <h4>Analyse</h4><br/>
            <table class="camlait_table">
                <thead><tr><th>STOCK TOTAL (qte)</th><th>SORTIES <t t-esc="state.stockRotationPeriod"/> DERNIERS JOURS (qte)</th><th>SORTIES MOY. / JOUR</th><th>ROTATION</th></tr></thead>
                <tbody>
                    <tr>
                        <td><t t-esc="state.stockRotationDetail.recap.stock_total_qty"/></td>
                        <td><t t-esc="state.stockRotationDetail.recap.sorties_30j"/></td>
                        <td><t t-esc="state.stockRotationDetail.recap.sorties_jour"/></td>
                        <td><strong><t t-esc="state.stockRotationDetail.recap.rotation"/> j</strong></td>
                    </tr>
                </tbody>
            </table>
            <p class="camlait_modal_note">Sur la base de <t t-esc="state.stockRotationDetail.recap.nb_mouvements"/> mouvement(s) de sortie vers l'exterieur.</p>

            <br/>
            <h4>Detail des sorties (<t t-esc="state.stockRotationPeriod"/> derniers jours)</h4><br/>
            <table class="camlait_table">
                <thead><tr><th>DATE</th><th>PRODUIT</th><th class="camlait_th_right">QTE</th><th>ORIGINE</th></tr></thead>
                <tbody>
                    <t t-foreach="state.stockRotationDetail.detail" t-as="d" t-key="d.move_id">
                        <tr>
                            <td><t t-esc="d.date"/></td>
                            <td><t t-esc="d.produit"/></td>
                            <td class="camlait_td_right"><t t-esc="d.qty"/></td>
                            <td><t t-esc="d.origine"/></td>
                        </tr>
                    </t>
                    <t t-if="!state.stockRotationDetail.detail.length">
                        <tr><td colspan="4" class="camlait_empty">Aucune sortie de stock sur cette periode.</td></tr>
                    </t>
                </tbody>
            </table>
        </t>
        <div class="camlait_modal_actions">
            <button class="camlait_btn_secondary" t-on-click="() => comp.closeStockRotationDetail()">Fermer</button>
        </div>
    </div>
</div>
`;
