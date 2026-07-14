# camlait_dashboard/models/dashboard.py
import unicodedata
import logging
import time
import weakref
from odoo import models, fields, api
from datetime import date, timedelta

_logger = logging.getLogger(__name__)

# Caches de memoisation pour _get_target_warehouses() / _get_target_location_ids()
# / _get_special_location_ids(). Cles sur self.env.cr (le curseur DB, un objet
# Python normal, stable pendant toute la duree d'une requete/transaction) et
# PAS sur self (le recordset camlait.dashboard) : les recordsets Odoo
# n'autorisent pas l'assignation d'attributs Python arbitraires (self.foo = x
# leve AttributeError), donc le cache doit vivre en dehors de self.
# WeakKeyDictionary : l'entree disparait automatiquement quand la transaction
# se termine et que le curseur est garbage-collecte, pas de fuite memoire.
_WH_CACHE = weakref.WeakKeyDictionary()
_LOC_IDS_CACHE = weakref.WeakKeyDictionary()
_SPECIAL_LOC_CACHE = weakref.WeakKeyDictionary()

# Cache court, en memoire du process, du resultat de get_dashboard_data().
# Le dashboard est souvent rouvert / change d'onglet en quelques secondes
# par un meme utilisateur (et parfois plusieurs en meme temps) : on evite
# de tout recalculer (achats, ventes, stock, maintenance...) a chaque appel
# en gardant le dernier resultat par (company, uid, date_from, date_to) pendant
# quelques dizaines de secondes. Volontairement tres court pour rester
# "quasi temps reel" : ce n'est pas un cache metier, juste anti-rafale.
#
# IMPORTANT (securite) : la cle inclut self.env.uid. Toutes les requetes
# metier de ce fichier (stock.quant, purchase.order, sale.order...)
# s'executent avec les droits de l'utilisateur connecte (pas de sudo()).
# Si deux utilisateurs n'ont pas les memes droits de lecture (record rules
# par entrepot, groupes restreints...), sans l'uid dans la cle, le second
# utilisateur pourrait recevoir dans les 45 secondes le resultat calcule
# avec les droits du premier. Inclure uid supprime ce risque, au prix
# d'un cache legerement moins efficace si beaucoup d'utilisateurs
# consultent le dashboard en meme temps (chacun a sa propre entree).
_DASHBOARD_CACHE = {}
_DASHBOARD_CACHE_TTL = 45  # secondes


class CamlaitDashboard(models.TransientModel):
    _name = 'camlait.dashboard'
    _description = 'Tableau de bord decisionnel Camlait'

    @api.model
    def get_dashboard_data(self, date_from=None, date_to=None, evolution_group=None):
        cache_key = (self.env.company.id, self.env.uid, date_from, date_to, evolution_group)
        cached = _DASHBOARD_CACHE.get(cache_key)
        if cached and (time.time() - cached[0]) < _DASHBOARD_CACHE_TTL:
            return cached[1]

        result = self._compute_dashboard_data(date_from, date_to, evolution_group)
        _DASHBOARD_CACHE[cache_key] = (time.time(), result)
        # Purge simple pour eviter une croissance infinie du cache si
        # beaucoup de plages de dates differentes sont utilisees.
        if len(_DASHBOARD_CACHE) > 200:
            oldest_key = min(_DASHBOARD_CACHE, key=lambda k: _DASHBOARD_CACHE[k][0])
            _DASHBOARD_CACHE.pop(oldest_key, None)
        return result

    def _compute_dashboard_data(self, date_from=None, date_to=None, evolution_group=None):
        today = date.today()

        if date_from:
            try:
                date_from = fields.Date.from_string(date_from)
            except Exception:
                date_from = today.replace(day=1)
        else:
            date_from = today.replace(day=1)

        if date_to:
            try:
                date_to = fields.Date.from_string(date_to)
            except Exception:
                date_to = today
        else:
            date_to = today

        dt_from = fields.Datetime.to_datetime(str(date_from))
        dt_to = fields.Datetime.to_datetime(str(date_to)).replace(
            hour=23, minute=59, second=59)

        return {
            'achats':               self._get_achats(dt_from, dt_to, today),
            'ventes':               self._get_ventes(dt_from, dt_to, today, evolution_group),
            'stock':                self._get_stock(),
            'maintenance':          self._get_maintenance(dt_from, dt_to, today),
            'commandes_recentes':   self._get_commandes_recentes(),
            'alertes':              self._get_alertes(dt_from, dt_to, today),
            'repartition_canal':    self._get_repartition_canal(dt_from, dt_to),
            'achats_categories':    self._get_achats_categories(dt_from, dt_to),
            'bons_commande_recents': self._get_bons_commande_recents(),
            'produits_sous_seuil_liste': self._get_produits_sous_seuil(),
            'stock_emplacements':   self._get_stock_emplacements(),
            'alertes_achats':       self._get_alertes_achats(today),
            'alertes_stock':        self._get_alertes_stock(),
            'date_from':            str(date_from),
            'date_to':              str(date_to),
        }

    # ════════════════════════════════════════════════════════════════
    # ACHATS
    # ════════════════════════════════════════════════════════════════
    def _get_achats(self, dt_from, dt_to, today):
        PO = self.env['purchase.order']
        str_from  = dt_from.strftime('%Y-%m-%d 00:00:00')
        str_to    = dt_to.strftime('%Y-%m-%d 23:59:59')
        str_today = today.strftime('%Y-%m-%d 23:59:59')

        confirmed = PO.search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['purchase', 'done']),
        ])
        bdc_en_attente = PO.search_count([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['draft', 'sent']),
        ])
        retard_pos = PO.search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['purchase', 'done']),
            ('date_planned', '<', str_today),
        ])
        bdc_en_retard = sum(
            1 for po in retard_pos
            if any(p.state not in ('done', 'cancel') for p in po.picking_ids)
        )
        lines = self.env['purchase.order.line'].search([
            ('order_id', 'in', confirmed.ids),
        ])
        montant_total = sum(lines.mapped('price_subtotal'))
        fournisseurs  = len(set(confirmed.mapped('partner_id').ids))

        pickings_done = self.env['stock.picking'].search([
            ('purchase_id', 'in', confirmed.ids),
            ('state', '=', 'done'),
        ])
        if pickings_done:
            dans_delais = sum(
                1 for p in pickings_done
                if p.date_done and p.purchase_id.date_planned
                and p.date_done.date() <= p.purchase_id.date_planned.date()
            )
            taux_reception = round(dans_delais / len(pickings_done) * 100, 1)
        else:
            taux_reception = 0.0

        budget_total = self._get_param_float('camlait_dashboard.budget_achats', 95_800_000.0)
        budget_consomme = round(
            montant_total / budget_total * 100, 1) if budget_total else 0.0

        activite_totale = PO.search_count([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
        ])

        return {
            'bdc_valides':           len(confirmed),
            'bdc_en_attente':        bdc_en_attente,
            'bdc_en_retard':         bdc_en_retard,
            'montant_total_engage':  round(montant_total, 2),
            'fournisseurs_actifs':   fournisseurs,
            'taux_reception_delais': taux_reception,
            'budget_consomme':       budget_consomme,
            'budget_total':          budget_total,
            'has_data':              activite_totale > 0,
        }

    # ════════════════════════════════════════════════════════════════
    # VENTES
    # ════════════════════════════════════════════════════════════════
    def _get_ventes(self, dt_from, dt_to, today, evolution_group=None):
        SO = self.env['sale.order']
        str_from  = dt_from.strftime('%Y-%m-%d 00:00:00')
        str_to    = dt_to.strftime('%Y-%m-%d 23:59:59')
        str_today = today.strftime('%Y-%m-%d 23:59:59')

        confirmed = SO.search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['sale', 'done']),
        ])
        sale_lines = self.env['sale.order.line'].search([
            ('order_id', 'in', confirmed.ids),
        ])
        ca_total = sum(sale_lines.mapped('price_subtotal'))

        delta_days   = (dt_to - dt_from).days or 1
        prev_dt_to   = dt_from - timedelta(seconds=1)
        prev_dt_from = prev_dt_to - timedelta(days=delta_days)
        prev_confirmed = SO.search([
            ('date_order', '>=', prev_dt_from.strftime('%Y-%m-%d %H:%M:%S')),
            ('date_order', '<=', prev_dt_to.strftime('%Y-%m-%d %H:%M:%S')),
            ('state', 'in', ['sale', 'done']),
        ])
        prev_lines = self.env['sale.order.line'].search([
            ('order_id', 'in', prev_confirmed.ids),
        ])
        ca_prev  = sum(prev_lines.mapped('price_subtotal'))
        ca_delta = round(
            (ca_total - ca_prev) / ca_prev * 100, 1) if ca_prev else 0.0

        pickings_so = self.env['stock.picking'].search([
            ('sale_id', 'in', confirmed.ids),
        ])
        orders_livrees = set(p.sale_id.id for p in pickings_so if p.state == 'done')
        livrees        = len(orders_livrees)
        taux_livraison = round(livrees / len(confirmed) * 100) if confirmed else 0

        # "Commande en attente" = devis / soumission pas encore confirmee
        devis = SO.search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['draft', 'sent']),
        ])
        en_attente = len(devis)
        # "en retard" = devis vieux de plus de 7 jours sans confirmation
        seuil_retard = fields.Datetime.now() - timedelta(days=7)
        en_retard = sum(
            1 for d in devis
            if d.date_order and d.date_order < seuil_retard
        )

        prod_data = {}
        for line in sale_lines:
            if not line.product_id:
                continue
            pid = line.product_id.id
            if pid not in prod_data:
                prod_data[pid] = {'product_id': pid, 'name': line.product_id.name, 'qty': 0.0, 'ca': 0.0}
            prod_data[pid]['qty'] += line.product_uom_qty
            prod_data[pid]['ca']  += line.price_subtotal
        prev_prod_qty = {}
        for line in prev_lines:
            if not line.product_id:
                continue
            pid = line.product_id.id
            prev_prod_qty[pid] = prev_prod_qty.get(pid, 0.0) + line.product_uom_qty
        top5 = sorted(prod_data.values(), key=lambda x: x['ca'], reverse=True)[:5]
        for p in top5:
            prev_qty = prev_prod_qty.get(p['product_id'], 0.0)
            p['tendance'] = round((p['qty'] - prev_qty) / prev_qty * 100) if prev_qty else 0
            p['qty'] = round(p['qty'])
            p['ca']  = round(p['ca'], 2)

        commandes_confirmees = len(confirmed)
        panier_moyen = round(ca_total / commandes_confirmees, 2) if commandes_confirmees else 0.0
        commandes_confirmees_prev = len(prev_confirmed)
        panier_prev = round(ca_prev / commandes_confirmees_prev, 2) if commandes_confirmees_prev else 0.0
        panier_delta = round((panier_moyen - panier_prev) / panier_prev * 100, 1) if panier_prev else 0.0
        cmd_delta = round(
            (commandes_confirmees - commandes_confirmees_prev) / commandes_confirmees_prev * 100, 1
        ) if commandes_confirmees_prev else 0.0

        objectif_ca = self._get_param_float('camlait_dashboard.objectif_ca', 197_000_000.0)

        evolution = self._compute_ventes_evolution(dt_from, dt_to, evolution_group)

        activite_totale = SO.search_count([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
        ])

        return {
            'ca_total':          round(ca_total, 2),
            'ca_delta':          ca_delta,
            'objectif_ca':       objectif_ca,
            'commandes_confirmees': commandes_confirmees,
            'cmd_delta':         cmd_delta,
            'panier_moyen':      panier_moyen,
            'panier_delta':      panier_delta,
            'commandes_livrees': livrees,
            'taux_livraison':    taux_livraison,
            'en_attente':        en_attente,
            'en_retard':         en_retard,
            'top5':              top5,
            'evolution':         evolution,
            'has_data':          activite_totale > 0,
        }

    @api.model
    def get_stock_rotation_detail(self, period_days=30):
        """Justifie le KPI 'Rotation moy. stock' : reprend EXACTEMENT le meme
        calcul que 'rotation_stock' dans _get_stock() (stock total / sorties
        moyennes par jour sur la periode choisie) et fournit en plus le
        detail des mouvements de sortie qui composent ce calcul.

        period_days : fenetre de calcul de la rotation, en jours (defaut 30).
        Permet d'ajuster la periode pour des produits a peremption rapide
        (ex: 7 ou 14 jours pour les produits laitiers) au lieu d'une valeur
        fixe de 30 jours qui ne convient pas a tous les produits.
        """
        try:
            period_days = int(period_days)
        except (TypeError, ValueError):
            period_days = 30
        period_days = period_days if period_days > 0 else 30

        today     = date.today()
        str_today = today.strftime('%Y-%m-%d 23:59:59')
        loc_ids   = self._get_target_location_ids()

        all_quants = self.env['stock.quant'].search([
            ('location_id', 'in', loc_ids),
            ('product_id.type', '=', 'product'),
        ]) if loc_ids else self.env['stock.quant']
        stock_total_qty = sum(q.quantity for q in all_quants if q.quantity > 0)

        date_debut = (today - timedelta(days=period_days)).strftime('%Y-%m-%d 00:00:00')
        moves_out = self.env['stock.move'].search([
            ('state', '=', 'done'),
            ('location_id', 'in', loc_ids),
            ('location_dest_id.usage', '=', 'customer'),
            ('date', '>=', date_debut),
            ('date', '<=', str_today),
        ], order='date desc')

        sorties_periode = sum(m.product_qty for m in moves_out)
        sorties_jour    = sorties_periode / period_days if sorties_periode > 0 else 0
        rotation        = round(stock_total_qty / sorties_jour) if sorties_jour > 0 else 0

        detail = [{
            'move_id':  m.id,
            'date':     fields.Datetime.to_string(m.date) if m.date else '',
            'produit':  m.product_id.display_name,
            'qty':      m.product_qty,
            'origine':  m.reference or m.origin or '',
        } for m in moves_out]

        return {
            'recap': {
                'period_days':      period_days,
                'stock_total_qty':  round(stock_total_qty, 2),
                'sorties_periode':  round(sorties_periode, 2),
                # gardé pour compatibilité avec l'ancien front-end (30j fixe)
                'sorties_30j':      round(sorties_periode, 2),
                'sorties_jour':     round(sorties_jour, 2),
                'rotation':         rotation,
                'nb_mouvements':    len(moves_out),
            },
            'detail': detail,
        }
    # ════════════════════════════════════════════════════════════════
    # ACHATS PAR CATEGORIE
    # ════════════════════════════════════════════════════════════════
    def _get_achats_categories(self, dt_from, dt_to):
        str_from = dt_from.strftime('%Y-%m-%d 00:00:00')
        str_to   = dt_to.strftime('%Y-%m-%d 23:59:59')
        orders = self.env['purchase.order'].search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['purchase', 'done']),
        ])
        lines = self.env['purchase.order.line'].search([('order_id', 'in', orders.ids)])
        cat_amounts = {}
        total = 0.0
        for line in lines:
            cat = line.product_id.categ_id.name if line.product_id and line.product_id.categ_id else 'Non classe'
            cat_amounts[cat] = cat_amounts.get(cat, 0.0) + line.price_subtotal
            total += line.price_subtotal
        items = sorted(cat_amounts.items(), key=lambda x: x[1], reverse=True)[:5]
        result = []
        for label, montant in items:
            result.append({
                'label':   label,
                'montant': round(montant, 2),
                'pct':     round(montant / total * 100) if total else 0,
            })
        return result

    # ════════════════════════════════════════════════════════════════
    # BONS DE COMMANDE RECENTS
    # ════════════════════════════════════════════════════════════════
    def _get_bons_commande_recents(self):
        orders = self.env['purchase.order'].search([], order='date_order desc', limit=6)
        result = []
        labels_map = {
            'recu': 'Recu', 'partiel': 'Partiel', 'en_transit': 'En transit',
            'attente': 'En attente', 'brouillon': 'Brouillon', 'annule': 'Annule',
        }
        for o in orders:
            pick_states = o.picking_ids.mapped('state')
            if o.state == 'cancel':
                statut = 'annule'
            elif o.state in ('purchase', 'done'):
                if pick_states and all(s == 'done' for s in pick_states):
                    statut = 'recu'
                elif any(s == 'done' for s in pick_states):
                    statut = 'partiel'
                else:
                    statut = 'en_transit'
            elif o.state == 'sent':
                statut = 'attente'
            else:
                statut = 'brouillon'
            result.append({
                'id':          o.id,
                'name':        o.name,
                'fournisseur': o.partner_id.name or '-',
                'montant':     round(o.amount_total, 2),
                'statut':      statut,
                'label':       labels_map.get(statut, statut),
            })
        return result

    # ════════════════════════════════════════════════════════════════
    # PRODUITS SOUS SEUIL / EN RUPTURE
    # ════════════════════════════════════════════════════════════════
    def _get_produits_sous_seuil(self):
        result = []
        orderpoints = self.env['stock.warehouse.orderpoint'].search([
            ('active', '=', True),
            ('location_id', 'in', self._get_target_location_ids()),
        ])
        for op in orderpoints:
            if op.qty_on_hand <= op.product_min_qty:
                if op.qty_on_hand <= 0:
                    statut, label = 'rupture', 'Rupture'
                elif op.qty_on_hand < op.product_min_qty * 0.5:
                    statut, label = 'critique', 'Critique'
                else:
                    statut, label = 'bas', 'Bas'
                result.append({
                    'product': op.product_id.name,
                    'stock':   op.qty_on_hand,
                    'seuil':   op.product_min_qty,
                    'statut':  statut,
                    'label':   label,
                })
        result.sort(key=lambda r: r['stock'])
        return result[:8]

    def _get_sous_seuil_orderpoint_ids(self):
        """Ids des points de commande dont le stock est sous le seuil minimum.
        Utilise le meme critere (qty_on_hand <= product_min_qty) que le
        calcul de 'sous_seuil' dans _get_stock() ET que la liste
        '_get_produits_sous_seuil', afin que le chiffre affiche sur les
        cartes, la liste detaillee et l'action d'ouverture correspondent
        toujours exactement (avant, la liste utilisait <= alors que le
        compteur et cette methode utilisaient <, ce qui pouvait afficher
        des chiffres differents pour un meme seuil).
        """
        orderpoints = self.env['stock.warehouse.orderpoint'].search([
            ('active', '=', True),
            ('location_id', 'in', self._get_target_location_ids()),
        ])
        return [op.id for op in orderpoints if op.qty_on_hand <= op.product_min_qty]

    # ════════════════════════════════════════════════════════════════
    # ETAT DU STOCK PAR EMPLACEMENT
    # ════════════════════════════════════════════════════════════════
    def _get_stock_emplacements(self):
        result = []
        for wh in self._get_target_warehouses():
            locs = self.env['stock.location'].search([
                ('location_id', 'child_of', wh.view_location_id.id),
                ('usage', '=', 'internal'),
            ])
            for loc in locs:
                quants = self.env['stock.quant'].search([
                    ('location_id', '=', loc.id),
                    ('product_id.type', '=', 'product'),
                ])
                if not quants:
                    continue
                rup   = sum(1 for q in quants if q.quantity <= 0)
                total = len(quants)
                if total == 0 or rup == 0:
                    statut, label = 'ok', 'Optimal'
                elif rup < total * 0.3:
                    statut, label = 'warn', 'Attention'
                else:
                    statut, label = 'danger', 'Rupture'
                result.append({'label': loc.name, 'statut': statut, 'statut_label': label})
        return result[:6]

    # ════════════════════════════════════════════════════════════════
    # ALERTES DEDIEES (Achats / Stock)
    # ════════════════════════════════════════════════════════════════
    def _get_alertes_achats(self, today):
        alertes = []
        str_today = today.strftime('%Y-%m-%d 23:59:59')
        PO = self.env['purchase.order']
        late_orders = PO.search([
            ('state', 'in', ['purchase', 'done']),
            ('date_planned', '<', str_today),
        ], limit=10)
        for po in late_orders:
            if any(p.state not in ('done', 'cancel') for p in po.picking_ids):
                alertes.append({
                    'type': 'danger', 'icon': 'fa-exclamation-triangle',
                    'msg': f"BdC {po.name} ({po.partner_id.name or '-'}) en retard fournisseur.",
                })
        drafts = PO.search_count([('state', 'in', ['draft', 'sent'])])
        if drafts:
            alertes.append({
                'type': 'warning', 'icon': 'fa-clock-o',
                'msg': f"{drafts} bon(s) de commande en attente de validation.",
            })
        return alertes[:6]

    def _get_alertes_stock(self):
        alertes = []
        loc_ids = self._get_target_location_ids()
        for op in self.env['stock.warehouse.orderpoint'].search([
            ('active', '=', True), ('location_id', 'in', loc_ids),
        ], limit=15):
            if op.qty_on_hand <= 0:
                alertes.append({
                    'type': 'danger', 'icon': 'fa-times-circle',
                    'msg': f"{op.product_id.name} : rupture de stock.",
                })
            elif op.qty_on_hand < op.product_min_qty:
                alertes.append({
                    'type': 'warning', 'icon': 'fa-arrow-down',
                    'msg': f"{op.product_id.name} : sous le seuil minimum.",
                })
        return alertes[:6]
    # ════════════════════════════════════════════════════════════════
    # ENTREPOTS CIBLES (Ndogbong, Yaounde, Bafoussam)
    # ════════════════════════════════════════════════════════════════
    def _get_target_warehouses(self):
        """Entrepots cibles des 6 centres (Bassa, Ndogbong, Yaounde,
        Bafoussam, Ndokoti, Bandjoun). Memoise (voir _WH_CACHE en haut du
        fichier) : cette methode est appelee plusieurs fois par
        _get_target_location_ids() et _get_special_location_ids() au
        cours d'un seul appel a get_dashboard_data(), et refait sinon une
        recherche + normalisation d'accents a chaque fois pour un
        resultat qui ne change jamais pendant la duree de la requete."""
        cr = self.env.cr
        if cr not in _WH_CACHE:
            keywords = ['bassa', 'ndogbong', 'yaound', 'bafoussam', 'ndokoti', 'bandjoun']
            all_wh = self.env['stock.warehouse'].search([('active', '=', True)])
            wh = all_wh.filtered(lambda w: any(k in self._strip_accents(w.name) for k in keywords))
            _WH_CACHE[cr] = wh or all_wh
        return _WH_CACHE[cr]

    def _strip_accents(self, txt):
        """Normalise un texte pour une comparaison insensible aux
        accents/majuscules (ex: 'Magasin Frais - Yaoundé' -> 'magasin
        frais - yaounde')."""
        if not txt:
            return ''
        norm = unicodedata.normalize('NFKD', txt)
        return ''.join(c for c in norm if not unicodedata.combining(c)).lower()

    def _get_target_location_ids(self):
        """Emplacements de stock pris en compte pour 'Produits en stock'
        (carte 'Etat du stock', vue globale). Voir _compute_target_location_ids()
        pour le detail de la logique.

        Memoise (voir _LOC_IDS_CACHE en haut du fichier) : cette methode
        est appelee 8 fois dans le fichier, dont plusieurs fois au sein
        d'un seul appel a get_dashboard_data() (_get_stock,
        _get_produits_sous_seuil, _get_alertes_stock...). Sans
        memoisation, chaque appel refait une recherche + boucle Python de
        normalisation d'accents sur tous les emplacements des 6 centres,
        pour un resultat identique a chaque fois pendant la duree d'une
        meme requete."""
        cr = self.env.cr
        if cr not in _LOC_IDS_CACHE:
            _LOC_IDS_CACHE[cr] = self._compute_target_location_ids()
        return _LOC_IDS_CACHE[cr]

    def _compute_target_location_ids(self):
        """Emplacements de stock pris en compte pour 'Produits en stock'
        (carte 'Etat du stock', vue globale) :
        - les emplacements 'magasin ... frais' / 'magasin ... sec(s)'
          (ex: 'Magasin Produits Secs', 'Magasin Produits Frais') de
          CHAQUE centre (les 6 : Bassa, Ndogbong, Yaounde, Bafoussam,
          Ndokoti, Bandjoun) ;
        - PLUS les emplacements 'entrepot', mais uniquement pour les
          centres de Yaounde, Douala/Ndogbong et Bafoussam (les 3 autres
          centres -- Bassa, Ndokoti, Bandjoun -- n'apportent que leurs
          magasins frais/secs, pas leur entrepot).

        Les emplacements 'Avarie' et 'Echantillon' sont volontairement
        exclus (ils sont comptes a part sur TOUT le systeme, voir
        _get_avaries_count/_get_echantillons_count).

        Si aucun emplacement ne correspond a ces mots-cles (nommage
        different de celui attendu), on revient a l'ancienne liste
        complete (tous les emplacements internes des entrepots cibles)
        pour ne jamais afficher un dashboard a zero."""
        entrepot_warehouse_keywords = ['yaound', 'ndogbong', 'douala', 'bafoussam']
        excluded = ['avarie', 'echantillon']
        loc_ids = []
        fallback_ids = []
        for wh in self._get_target_warehouses():
            wh_label = self._strip_accents(wh.name)
            wh_has_entrepot = any(k in wh_label for k in entrepot_warehouse_keywords)
            locs = self.env['stock.location'].search([
                ('id', 'child_of', wh.view_location_id.id),
                ('usage', '=', 'internal'),
            ])
            fallback_ids += locs.ids
            for loc in locs:
                label = self._strip_accents(loc.complete_name or loc.name or '')
                if any(ex in label for ex in excluded):
                    continue
                is_magasin = 'magasin' in label
                is_frais_ou_sec = 'frais' in label or 'sec' in label
                is_entrepot = wh_has_entrepot and 'entrepot' in label
                if (is_magasin and is_frais_ou_sec) or is_entrepot:
                    loc_ids.append(loc.id)
        return loc_ids or fallback_ids

    def _get_special_location_ids(self, keyword):
        """Ids des emplacements de stock dont le nom contient `keyword`
        (insensible aux accents/casse), ex: 'avarie' ou 'echantillon'.
        Recherche sur TOUS les entrepots actifs du systeme (pas seulement
        les 6 centres cibles), independamment du filtre magasin
        frais/sec/entrepot de _get_target_location_ids.

        Memoise par mot-cle (voir _SPECIAL_LOC_CACHE en haut du fichier) :
        evite de refaire la meme recherche + normalisation d'accents si
        la methode est appelee plusieurs fois avec le meme mot-cle au
        cours d'une requete."""
        cr = self.env.cr
        if cr not in _SPECIAL_LOC_CACHE:
            _SPECIAL_LOC_CACHE[cr] = {}
        if keyword not in _SPECIAL_LOC_CACHE[cr]:
            loc_ids = []
            all_wh = self.env['stock.warehouse'].search([('active', '=', True)])
            for wh in all_wh:
                locs = self.env['stock.location'].search([
                    ('id', 'child_of', wh.view_location_id.id),
                    ('usage', '=', 'internal'),
                ])
                for loc in locs:
                    label = self._strip_accents(loc.complete_name or loc.name or '')
                    if keyword in label:
                        loc_ids.append(loc.id)
            _SPECIAL_LOC_CACHE[cr][keyword] = loc_ids
        return _SPECIAL_LOC_CACHE[cr][keyword]

    def _count_distinct_products_in_locations(self, loc_ids):
        """Nombre de produits distincts presents (quantite > 0) dans
        `loc_ids`, via read_group plutot qu'un search() + boucle Python :
        on ne rapatrie que des groupes agreges (un par produit), pas les
        enregistrements stock.quant complets. Nettement plus leger sur un
        volume important de quants."""
        if not loc_ids:
            return 0
        groups = self.env['stock.quant'].read_group(
            domain=[
                ('location_id', 'in', loc_ids),
                ('product_id.type', '=', 'product'),
                ('quantity', '>', 0),
            ],
            fields=['product_id'],
            groupby=['product_id'],
            lazy=False,
        )
        return len(groups)

    def _get_avaries_count(self):
        """Nombre de produits actuellement presents (quantite > 0) dans
        les emplacements 'Avarie', sur tous les entrepots du systeme."""
        return self._count_distinct_products_in_locations(
            self._get_special_location_ids('avarie'))

    def _get_echantillons_count(self):
        """Nombre de produits actuellement presents (quantite > 0) dans
        les emplacements 'Echantillon', sur tous les entrepots du systeme."""
        return self._count_distinct_products_in_locations(
            self._get_special_location_ids('echantillon'))
    # ════════════════════════════════════════════════════════════════
    # STOCK
    # ════════════════════════════════════════════════════════════════
    def _get_stock(self):
        today     = date.today()
        str_today = today.strftime('%Y-%m-%d 23:59:59')

        loc_ids = self._get_target_location_ids()

        all_quants = self.env['stock.quant'].search([
            ('location_id', 'in', loc_ids),
            ('product_id.type', '=', 'product'),
        ]) if loc_ids else self.env['stock.quant']

        produits_en_stock = len(set(q.product_id.id for q in all_quants if q.quantity > 0))
        ruptures = len(set(q.product_id.id for q in all_quants if q.quantity <= 0))
        valeur_stock = sum(
            q.quantity * q.product_id.standard_price
            for q in all_quants if q.quantity > 0
        )
        total_produits = len(set(q.product_id.id for q in all_quants))

        orderpoints = self.env['stock.warehouse.orderpoint'].search([
            ('active', '=', True),
            ('location_id', 'in', loc_ids),
        ])
        # Meme critere (<=) que _get_produits_sous_seuil et
        # _get_sous_seuil_orderpoint_ids : un produit dont le stock est
        # EXACTEMENT egal au seuil minimum doit lui aussi etre compte
        # (avant : ce compteur utilisait '<' strict, ce qui pouvait
        # afficher un chiffre different de celui de la liste detaillee).
        sous_seuil = sum(1 for op in orderpoints if op.qty_on_hand <= op.product_min_qty)

        date_30j  = (today - timedelta(days=30)).strftime('%Y-%m-%d 00:00:00')
        # read_group : agregation SQL cote serveur (SUM) plutot que charger
        # tous les mouvements en objets Python pour les sommer nous-memes ;
        # plus rapide des que le volume de mouvements devient important.
        moves_out_agg = self.env['stock.move'].read_group(
            [
                ('state', '=', 'done'),
                ('location_id', 'in', loc_ids),
                ('location_dest_id.usage', '=', 'customer'),
                ('date', '>=', date_30j),
                ('date', '<=', str_today),
            ],
            ['product_qty'], [],
        )
        sorties_30j     = moves_out_agg[0]['product_qty'] if moves_out_agg else 0.0
        sorties_jour    = sorties_30j / 30 if sorties_30j > 0 else 0
        stock_total_qty = sum(q.quantity for q in all_quants if q.quantity > 0)
        rotation = round(stock_total_qty / sorties_jour) if sorties_jour > 0 else 0

        taux_dispo = round(produits_en_stock / total_produits * 100) if total_produits > 0 else 0

        nb_perime  = 0
        pct_perime = 0.0
        expiry_ok  = self.env['ir.module.module'].sudo().search_count([
            ('name', '=', 'product_expiry'),
            ('state', '=', 'installed'),
        ])
        if expiry_ok:
            perime_ids = set()
            lots = self.env['stock.production.lot'].search([
                ('expiration_date', '!=', False),
                ('expiration_date', '<', str_today),
            ])
            for lot in lots:
                if self.env['stock.quant'].search_count([
                    ('lot_id', '=', lot.id),
                    ('location_id', 'in', loc_ids),
                    ('quantity', '>', 0),
                ]):
                    perime_ids.add(lot.product_id.id)
            nb_perime  = len(perime_ids)
            pct_perime = round(nb_perime / total_produits * 100, 1) if total_produits > 0 else 0.0

        statuts = []
        for wh in self._get_target_warehouses():
            wh_locs = self.env['stock.location'].search([
                ('id', 'child_of', wh.view_location_id.id),
                ('usage', '=', 'internal'),
            ])
            wh_quants = self.env['stock.quant'].search([
                ('location_id', 'in', wh_locs.ids),
                ('product_id.type', '=', 'product'),
            ])
            rup   = sum(1 for q in wh_quants if q.quantity <= 0)
            total = len(wh_quants)
            if total == 0 or rup == 0:
                statuts.append({'label': f"{wh.name} - OK", 'statut': 'ok'})
            elif rup < total * 0.3:
                statuts.append({'label': f"{wh.name} - Attention", 'statut': 'warn'})
            else:
                statuts.append({'label': f"{wh.name} - Rupture", 'statut': 'danger'})
        statuts = statuts[:6]

        return {
            'produits_en_stock': produits_en_stock,
            'sous_seuil':        sous_seuil,
            'ruptures':          ruptures,
            'avarie_count':      self._get_avaries_count(),
            'echantillon_count': self._get_echantillons_count(),
            'rotation_stock':    rotation,
            'taux_dispo':        taux_dispo,
            'valeur_stock':      round(valeur_stock, 2),
            'pct_perime':        pct_perime,
            'nb_perime':         nb_perime,
            'statuts':           statuts,
        }
    # ════════════════════════════════════════════════════════════════
    # MAINTENANCE
    # ════════════════════════════════════════════════════════════════
    def _get_maintenance(self, dt_from, dt_to, today):
        MR = self.env['maintenance.request']
        ME = self.env['maintenance.equipment']
        str_from = dt_from.strftime('%Y-%m-%d 00:00:00')
        str_to   = dt_to.strftime('%Y-%m-%d 23:59:59')

        total = MR.search_count([
            ('create_date', '>=', str_from),
            ('create_date', '<=', str_to),
        ])
        en_cours = MR.search_count([('stage_id.done', '=', False)])
        terminees = MR.search_count([
            ('stage_id.done', '=', True),
            ('close_date', '>=', str_from),
            ('close_date', '<=', str_to),
        ])
        urgentes = MR.search_count([
            ('stage_id.done', '=', False),
            ('priority', '=', '3'),
        ])
        equipements = ME.search_count([('active', '=', True)])

        mtbf_vals = []
        for eq in ME.search([('active', '=', True)]):
            demandes_done = MR.search([
                ('equipment_id', '=', eq.id),
                ('stage_id.done', '=', True),
                ('close_date', '!=', False),
            ], order='close_date asc')
            if len(demandes_done) >= 2:
                dates = [d.close_date for d in demandes_done]
                intervals = [
                    (dates[i+1] - dates[i]).days
                    for i in range(len(dates) - 1)
                    if (dates[i+1] - dates[i]).days > 0
                ]
                if intervals:
                    mtbf_vals.append(sum(intervals) / len(intervals))
        mtbf_moy = round(sum(mtbf_vals) / len(mtbf_vals)) if mtbf_vals else 0

        alertes_maint = []
        for m in MR.search([
            ('stage_id.done', '=', False),
            ('priority', '=', '3'),
        ], order='create_date desc', limit=3):
            alertes_maint.append({
                'name': m.name,
                'equipment': m.equipment_id.name if m.equipment_id else 'N/A',
            })

        return {
            'total': total, 'en_cours': en_cours, 'terminees': terminees,
            'urgentes': urgentes, 'equipements': equipements,
            'mtbf_moy': mtbf_moy, 'alertes_maint': alertes_maint,
        }

    # ════════════════════════════════════════════════════════════════
    # COMMANDES CLIENTS RECENTES
    # ════════════════════════════════════════════════════════════════
    def _get_commandes_recentes(self):
        SO = self.env['sale.order']
        orders = SO.search([
            ('state', 'in', ['sale', 'done', 'cancel']),
        ], order='date_order desc', limit=6)

        labels = {
            'livre': 'Livre', 'en_cours': 'En cours',
            'retard': 'Retard', 'facture': 'Facture', 'annule': 'Annule',
        }
        result = []
        for o in orders:
            pick_states = o.picking_ids.mapped('state')
            if o.state == 'cancel':
                statut = 'annule'
            elif pick_states and all(s == 'done' for s in pick_states):
                statut = 'livre'
            elif any(s == 'done' for s in pick_states):
                statut = 'en_cours'
            elif o.invoice_ids and any(inv.state == 'posted' for inv in o.invoice_ids):
                statut = 'facture'
            elif o.commitment_date and o.commitment_date < fields.Datetime.now():
                statut = 'retard'
            else:
                statut = 'en_cours'

            result.append({
                'id':      o.id,
                'name':    o.name,
                'client':  o.partner_id.name or '-',
                'date':    o.date_order.strftime('%d/%m/%Y') if o.date_order else '-',
                'montant': round(o.amount_total, 2),
                'statut':  statut,
                'label':   labels.get(statut, statut),
            })
        return result

    # ════════════════════════════════════════════════════════════════
    # ALERTES ET ACTIONS REQUISES
    # ════════════════════════════════════════════════════════════════
    def _get_alertes(self, dt_from, dt_to, today):
        alertes = []
        str_today = today.strftime('%Y-%m-%d 23:59:59')

        for op in self.env['stock.warehouse.orderpoint'].search([('active', '=', True)]):
            if op.qty_on_hand <= 0:
                alertes.append({
                    'type': 'danger', 'icon': 'fa-times-circle',
                    'msg': f"{op.product_id.name} : rupture de stock. Commande fournisseur requise.",
                })

        PO = self.env['purchase.order']
        for po in PO.search([
            ('state', 'in', ['purchase', 'done']),
            ('date_planned', '<', str_today),
        ], limit=3):
            if any(p.state not in ('done', 'cancel') for p in po.picking_ids):
                alertes.append({
                    'type': 'warning', 'icon': 'fa-truck',
                    'msg': f"BdC {po.name} ({po.partner_id.name}) : delai de livraison depasse.",
                })

        SO = self.env['sale.order']
        for so in SO.search([
            ('state', 'in', ['sale', 'done']),
            ('commitment_date', '<', str_today),
        ], limit=3):
            pickings = so.picking_ids
            non_livre = any(p.state not in ('done', 'cancel') for p in pickings) if pickings else True
            if non_livre:
                alertes.append({
                    'type': 'info', 'icon': 'fa-clock-o',
                    'msg': f"{so.name} ({so.partner_id.name}) : livraison en retard.",
                })

        MR = self.env['maintenance.request']
        for m in MR.search([
            ('stage_id.done', '=', False),
            ('priority', '=', '3'),
        ], limit=2):
            equip = m.equipment_id.name if m.equipment_id else 'N/A'
            alertes.append({
                'type': 'warning', 'icon': 'fa-wrench',
                'msg': f"Maintenance urgente : {m.name} ({equip}).",
            })

        return alertes[:8]

    # ════════════════════════════════════════════════════════════════
    # REPARTITION DU CA PAR CANAL (equipe commerciale)
    # ════════════════════════════════════════════════════════════════
    def _get_repartition_canal(self, dt_from, dt_to):
        str_from = dt_from.strftime('%Y-%m-%d 00:00:00')
        str_to   = dt_to.strftime('%Y-%m-%d 23:59:59')

        confirmed = self.env['sale.order'].search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['sale', 'done']),
        ])
        sale_lines = self.env['sale.order.line'].search([
            ('order_id', 'in', confirmed.ids),
        ])

        canal_ca = {}
        total = 0.0
        for line in sale_lines:
            team = line.order_id.team_id.name if line.order_id.team_id else 'Non classe'
            canal_ca[team] = canal_ca.get(team, 0.0) + line.price_subtotal
            total += line.price_subtotal

        items = sorted(canal_ca.items(), key=lambda x: x[1], reverse=True)
        top   = items[:4]
        autre = sum(v for _, v in items[4:])
        if autre > 0:
            top.append(('Autre', autre))

        palette = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#64748b']
        result = []
        for i, (label, montant) in enumerate(top):
            result.append({
                'label':   label,
                'montant': round(montant, 2),
                'pct':     round(montant / total * 100) if total > 0 else 0,
                'color':   palette[i] if i < len(palette) else '#64748b',
            })
        return result

    # ════════════════════════════════════════════════════════════════
    # PARAMETRES (utilises par l'icone Reglages)
    # ════════════════════════════════════════════════════════════════
    def _get_param_float(self, key, default):
        val = self.env['ir.config_parameter'].sudo().get_param(key, default=str(default))
        try:
            return float(val)
        except Exception:
            return default

    @api.model
    def get_settings(self):
        return {
            'budget_achats': self._get_param_float('camlait_dashboard.budget_achats', 95_800_000.0),
            'objectif_ca':   self._get_param_float('camlait_dashboard.objectif_ca', 197_000_000.0),
        }

    @api.model
    def save_settings(self, budget_achats=None, objectif_ca=None):
        ICP = self.env['ir.config_parameter'].sudo()
        try:
            if budget_achats is not None:
                ICP.set_param('camlait_dashboard.budget_achats', str(float(budget_achats)))
            if objectif_ca is not None:
                ICP.set_param('camlait_dashboard.objectif_ca', str(float(objectif_ca)))
            return {'success': True}
        except (TypeError, ValueError):
            return {'success': False, 'message': 'Valeurs invalides'}

    # ════════════════════════════════════════════════════════════════
    # ACTIONS DE NAVIGATION
    # Chaque action reprend exactement le meme domaine (memes filtres
    # d'etat / de dates) que celui utilise pour calculer la valeur
    # affichee sur la carte ou la ligne correspondante du tableau de bord,
    # afin que la vue ouverte mette bien en evidence les enregistrements
    # a l'origine du chiffre affiche.
    # ════════════════════════════════════════════════════════════════
    @api.model
    def action_open_purchase_analysis(self, date_from=None, date_to=None):
        domain = [('state', 'in', ['purchase', 'done'])]
        if date_from:
            domain.append(('date_order', '>=', date_from))
        if date_to:
            domain.append(('date_order', '<=', date_to + ' 23:59:59'))
        return {
            'type': 'ir.actions.act_window', 'name': 'Analyse des achats',
            'res_model': 'purchase.report', 'view_mode': 'pivot,graph,list',
            'views': [(False, 'pivot'), (False, 'graph'), (False, 'list')],
            'domain': domain, 'target': 'current',
            'context': {
                # 'price_subtotal' n'existe pas sur purchase.report (ce
                # modele expose 'price_total', pas 'price_subtotal') :
                # c'etait la cause exacte du crash JS "Cannot read
                # properties of undefined (reading 'string')" dans
                # computeReportMeasures (mesure fantome -> fields_get()
                # ne retourne rien pour ce nom -> undefined.string au tri).
                'pivot_measures': ['price_total'],
                'graph_measure': 'price_total',
            },
        }

    @api.model
    def action_open_suppliers(self, date_from=None, date_to=None):
        """Fournisseurs actifs = fournisseurs ayant au moins un bon de
        commande confirme sur la periode selectionnee. Reprend exactement
        le meme calcul que 'fournisseurs_actifs' dans _get_achats()."""
        domain_po = [('state', 'in', ['purchase', 'done'])]
        if date_from:
            domain_po.append(('date_order', '>=', date_from))
        if date_to:
            domain_po.append(('date_order', '<=', date_to + ' 23:59:59'))
        partner_ids = self.env['purchase.order'].search(domain_po).mapped('partner_id').ids
        return {
            'type': 'ir.actions.act_window', 'name': 'Fournisseurs actifs',
            'res_model': 'res.partner', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': [('id', 'in', partner_ids)], 'target': 'current',
        }

    @api.model
    def action_open_maintenance(self, date_from=None, date_to=None):
        """'Total demandes' est filtre par create_date sur la periode
        selectionnee (meme calcul que 'total' dans _get_maintenance())."""
        domain = []
        if date_from:
            domain.append(('create_date', '>=', date_from))
        if date_to:
            domain.append(('create_date', '<=', date_to + ' 23:59:59'))
        return {
            'type': 'ir.actions.act_window', 'name': 'Demandes de maintenance',
            'res_model': 'maintenance.request', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': domain, 'target': 'current',
        }

    @api.model
    def action_open_maintenance_en_cours(self):
        """Meme critere que 'en_cours' dans _get_maintenance() : aucun
        filtre de periode, uniquement les demandes dont l'etape n'est pas
        terminee."""
        return {
            'type': 'ir.actions.act_window', 'name': 'Demandes en cours',
            'res_model': 'maintenance.request', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': [('stage_id.done', '=', False)],
            'target': 'current',
        }

    @api.model
    def action_open_maintenance_terminees(self, date_from=None, date_to=None):
        """Meme critere que 'terminees' dans _get_maintenance() : demandes
        cloturees (stage done) dont la date de cloture tombe dans la
        periode selectionnee."""
        domain = [('stage_id.done', '=', True)]
        if date_from:
            domain.append(('close_date', '>=', date_from))
        if date_to:
            domain.append(('close_date', '<=', date_to + ' 23:59:59'))
        return {
            'type': 'ir.actions.act_window', 'name': 'Demandes terminees',
            'res_model': 'maintenance.request', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': domain, 'target': 'current',
        }

    @api.model
    def action_open_maintenance_urgent(self):
        return {
            'type': 'ir.actions.act_window', 'name': 'Demandes urgentes',
            'res_model': 'maintenance.request', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': [('stage_id.done', '=', False), ('priority', '=', '3')],
            'target': 'current',
        }

    @api.model
    def action_open_equipment(self):
        return {
            'type': 'ir.actions.act_window', 'name': 'Equipements actifs',
            'res_model': 'maintenance.equipment', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': [('active', '=', True)], 'target': 'current',
        }

    @api.model
    def action_open_sale_analysis(self, date_from=None, date_to=None):
        domain = [('state', 'in', ['sale', 'done'])]
        if date_from:
            domain.append(('date', '>=', date_from))
        if date_to:
            domain.append(('date', '<=', date_to + ' 23:59:59'))
        return {
            'type': 'ir.actions.act_window', 'name': 'Analyse des ventes',
            'res_model': 'sale.report', 'view_mode': 'pivot,graph,list',
            'views': [(False, 'pivot'), (False, 'graph'), (False, 'list')],
            'domain': domain, 'target': 'current',
            'context': {
                # Met en evidence le meme montant que "Chiffre d'affaires"
                # (calcule a partir de price_subtotal des lignes de vente).
                'pivot_measures': ['price_subtotal'],
                'graph_measure': 'price_subtotal',
            },
        }

    @api.model
    def action_open_sale_quotes_late(self, date_from=None, date_to=None):
        """'devis en retard de relance' = devis (draft/sent) de plus de 7
        jours, sur la periode selectionnee. Reprend exactement le meme
        calcul que 'en_retard' dans _get_ventes()."""
        domain = [('state', 'in', ['draft', 'sent'])]
        if date_from:
            domain.append(('date_order', '>=', date_from))
        if date_to:
            domain.append(('date_order', '<=', date_to + ' 23:59:59'))
        seuil_retard = fields.Datetime.now() - timedelta(days=7)
        domain.append(('date_order', '<', seuil_retard.strftime('%Y-%m-%d %H:%M:%S')))
        return {
            'type': 'ir.actions.act_window', 'name': 'Devis en retard de relance',
            'res_model': 'sale.order', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': domain, 'target': 'current',
        }

    @api.model
    def get_taux_livraison_detail(self, date_from=None, date_to=None):
        """Justifie le pourcentage affiche sur la carte "Taux de
        livraison" : reprend EXACTEMENT le meme calcul que 'taux_livraison'
        dans _get_ventes() (commandes confirmees sur la periode / commandes
        ayant au moins un picking 'done'), puis fournit en plus les deux
        listes qui expliquent l'ecart entre commandes confirmees et
        commandes livrees :
          - livraisons en retard   : commande confirmee, pas encore livree,
                                      et la date prevue du picking est deja
                                      depassee.
          - livraisons en attente de validation : commande confirmee, pas
                                      encore livree, mais pas encore en
                                      retard (picking pas encore du/valide).
        Avant, la carte renvoyait simplement vers un rapport (montant
        agrege) qui ne montrait ni le calcul, ni ces deux listes.
        """
        today = date.today()
        if date_from:
            try:
                date_from = fields.Date.from_string(date_from)
            except Exception:
                date_from = today.replace(day=1)
        else:
            date_from = today.replace(day=1)
        if date_to:
            try:
                date_to = fields.Date.from_string(date_to)
            except Exception:
                date_to = today
        else:
            date_to = today

        str_from = date_from.strftime('%Y-%m-%d 00:00:00')
        str_to = date_to.strftime('%Y-%m-%d 23:59:59')

        SO = self.env['sale.order']
        confirmed = SO.search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['sale', 'done']),
        ])
        pickings_so = self.env['stock.picking'].search([
            ('sale_id', 'in', confirmed.ids),
        ])
        orders_livrees_ids = set(p.sale_id.id for p in pickings_so if p.state == 'done')

        commandes_confirmees = len(confirmed)
        commandes_livrees = len(orders_livrees_ids)
        taux_livraison = round(
            commandes_livrees / commandes_confirmees * 100
        ) if commandes_confirmees else 0

        now = fields.Datetime.now()
        en_retard, en_attente = [], []
        for so in confirmed:
            if so.id in orders_livrees_ids:
                continue
            so_pickings = pickings_so.filtered(lambda p, so=so: p.sale_id.id == so.id and p.state != 'done')
            if not so_pickings:
                continue
            scheduled = min(so_pickings.mapped('scheduled_date')) if so_pickings.mapped('scheduled_date') else False
            item = {
                'order_id':  so.id,
                'name':      so.name,
                'partner':   so.partner_id.name or '',
                'montant':   round(so.amount_total, 2),
                'date':      fields.Datetime.to_string(so.date_order) if so.date_order else '',
                'scheduled': fields.Datetime.to_string(scheduled) if scheduled else '',
                'statut':    dict(so_pickings[0]._fields['state'].selection).get(so_pickings[0].state, so_pickings[0].state),
            }
            if scheduled and scheduled < now:
                item['jours_retard'] = (now - scheduled).days
                en_retard.append(item)
            else:
                en_attente.append(item)

        en_retard.sort(key=lambda r: r.get('jours_retard', 0), reverse=True)
        en_attente.sort(key=lambda r: r.get('date', ''), reverse=True)

        return {
            'commandes_confirmees': commandes_confirmees,
            'commandes_livrees':    commandes_livrees,
            'taux_livraison':       taux_livraison,
            'en_retard':            en_retard[:50],
            'en_retard_total':      len(en_retard),
            'en_attente':           en_attente[:50],
            'en_attente_total':     len(en_attente),
            'date_from':            str(date_from),
            'date_to':              str(date_to),
        }

    @api.model
    def action_open_sale_delivery_late(self, date_from=None, date_to=None):
        """Ouvre les livraisons (stock.picking) en retard qui composent la
        liste 'en_retard' de get_taux_livraison_detail (picking pas
        termine et date prevue depassee)."""
        domain = [('sale_id', '!=', False), ('state', 'not in', ['done', 'cancel']),
                  ('scheduled_date', '<', fields.Datetime.now().strftime('%Y-%m-%d %H:%M:%S'))]
        if date_from:
            domain.append(('sale_id.date_order', '>=', date_from))
        if date_to:
            domain.append(('sale_id.date_order', '<=', date_to + ' 23:59:59'))
        return {
            'type': 'ir.actions.act_window', 'name': 'Livraisons en retard',
            'res_model': 'stock.picking', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': domain, 'target': 'current',
        }

    @api.model
    def action_open_sale_delivery_waiting(self, date_from=None, date_to=None):
        """Ouvre les livraisons (stock.picking) en attente de validation
        qui composent la liste 'en_attente' de get_taux_livraison_detail
        (picking pas termine, mais pas encore en retard)."""
        domain = [('sale_id', '!=', False), ('state', 'not in', ['done', 'cancel']),
                  '|',
                  ('scheduled_date', '=', False),
                  ('scheduled_date', '>=', fields.Datetime.now().strftime('%Y-%m-%d %H:%M:%S'))]
        if date_from:
            domain.append(('sale_id.date_order', '>=', date_from))
        if date_to:
            domain.append(('sale_id.date_order', '<=', date_to + ' 23:59:59'))
        return {
            'type': 'ir.actions.act_window', 'name': 'Livraisons en attente de validation',
            'res_model': 'stock.picking', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': domain, 'target': 'current',
        }

    @api.model
    def get_evolution_detail(self):
        """Justifie le graphique "Evolution des ventes - 6 derniers mois" :
        reprend EXACTEMENT le meme calcul que 'evolution' dans
        _get_ventes() (commandes confirmees, groupees par mois sur les 6
        derniers mois glissants), et fournit en plus, pour chaque mois, la
        liste des commandes dont la somme des montants donne le CA affiche
        sur le graphique. Avant, le lien "Detail" renvoyait vers un rapport
        qui n'affichait qu'un montant total agrege, sans lien visible avec
        les points du graphique.
        """
        today = date.today()
        str_to = today.strftime('%Y-%m-%d 23:59:59')

        six_months_ago = today.replace(day=1)
        for _ in range(5):
            six_months_ago = (six_months_ago - timedelta(days=1)).replace(day=1)

        SO = self.env['sale.order']
        all_orders = SO.search([
            ('date_order', '>=', six_months_ago.strftime('%Y-%m-%d 00:00:00')),
            ('date_order', '<=', str_to),
            ('state', 'in', ['sale', 'done']),
        ], order='date_order desc')

        monthly = {}
        orders_by_month = {}
        for so in all_orders:
            key = so.date_order.strftime('%Y-%m')
            lines_total = sum(so.order_line.mapped('price_subtotal'))
            m = monthly.setdefault(key, {'ca': 0.0, 'nb_commandes': 0})
            m['ca'] += lines_total
            m['nb_commandes'] += 1
            orders_by_month.setdefault(key, []).append({
                'order_id': so.id,
                'name':     so.name,
                'partner':  so.partner_id.name or '',
                'date':     fields.Datetime.to_string(so.date_order) if so.date_order else '',
                'montant':  round(lines_total, 2),
            })

        recap, detail = [], []
        for i in range(5, -1, -1):
            ref = today.replace(day=1)
            month = ref.month - i
            year = ref.year
            while month <= 0:
                month += 12
                year -= 1
            key = f'{year:04d}-{month:02d}'
            mois_label = date(year, month, 1).strftime('%b %Y')
            m = monthly.get(key, {'ca': 0.0, 'nb_commandes': 0})
            recap.append({
                'mois': mois_label,
                'ca': round(m['ca'], 2),
                'nb_commandes': m['nb_commandes'],
            })
            for o in orders_by_month.get(key, []):
                detail.append({**o, 'mois': mois_label})

        return {'recap': recap, 'detail': detail}

    @api.model
    def get_top_products_ventes(self, date_from=None, date_to=None, limit=50):
        """Classement complet des produits les plus vendus sur la periode,
        trie par chiffre d'affaires decroissant : meme calcul exact que le
        tableau "Top 5 produits vendus" du tableau de bord (_get_ventes),
        simplement sans la limite a 5. Utilise par le lien "Voir tout" pour
        afficher une VRAIE liste classee, plutot qu'un total agrege."""
        today = date.today()
        if date_from:
            try:
                date_from = fields.Date.from_string(date_from)
            except Exception:
                date_from = today.replace(day=1)
        else:
            date_from = today.replace(day=1)
        if date_to:
            try:
                date_to = fields.Date.from_string(date_to)
            except Exception:
                date_to = today
        else:
            date_to = today

        str_from = date_from.strftime('%Y-%m-%d 00:00:00')
        str_to = date_to.strftime('%Y-%m-%d 23:59:59')

        SO = self.env['sale.order']
        confirmed = SO.search([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
            ('state', 'in', ['sale', 'done']),
        ])
        sale_lines = self.env['sale.order.line'].search([('order_id', 'in', confirmed.ids)])

        dt_from = fields.Datetime.to_datetime(str_from)
        dt_to = fields.Datetime.to_datetime(str_to)
        delta_days = (dt_to - dt_from).days or 1
        prev_dt_to = dt_from - timedelta(seconds=1)
        prev_dt_from = prev_dt_to - timedelta(days=delta_days)
        prev_confirmed = SO.search([
            ('date_order', '>=', prev_dt_from.strftime('%Y-%m-%d %H:%M:%S')),
            ('date_order', '<=', prev_dt_to.strftime('%Y-%m-%d %H:%M:%S')),
            ('state', 'in', ['sale', 'done']),
        ])
        prev_lines = self.env['sale.order.line'].search([('order_id', 'in', prev_confirmed.ids)])
        prev_prod_qty = {}
        for line in prev_lines:
            if not line.product_id:
                continue
            pid = line.product_id.id
            prev_prod_qty[pid] = prev_prod_qty.get(pid, 0.0) + line.product_uom_qty

        prod_data = {}
        for line in sale_lines:
            if not line.product_id:
                continue
            pid = line.product_id.id
            if pid not in prod_data:
                prod_data[pid] = {'product_id': pid, 'name': line.product_id.name, 'qty': 0.0, 'ca': 0.0}
            prod_data[pid]['qty'] += line.product_uom_qty
            prod_data[pid]['ca'] += line.price_subtotal

        ranked = sorted(prod_data.values(), key=lambda x: x['ca'], reverse=True)
        items = []
        for i, p in enumerate(ranked[:limit], start=1):
            prev_qty = prev_prod_qty.get(p['product_id'], 0.0)
            items.append({
                'rank': i,
                'product_id': p['product_id'],
                'name': p['name'],
                'qty': round(p['qty']),
                'ca': round(p['ca'], 2),
                'tendance': round((p['qty'] - prev_qty) / prev_qty * 100) if prev_qty else 0,
            })
        return {
            'items': items,
            'total_count': len(prod_data),
            'date_from': str(date_from),
            'date_to': str(date_to),
        }

    @api.model
    def get_ventes_evolution(self, date_from=None, date_to=None, evolution_group=None):
        today = date.today()
        if date_from:
            try:
                date_from = fields.Date.from_string(date_from)
            except Exception:
                date_from = today.replace(day=1)
        else:
            date_from = today.replace(day=1)

        if date_to:
            try:
                date_to = fields.Date.from_string(date_to)
            except Exception:
                date_to = today
        else:
            date_to = today

        dt_from = fields.Datetime.to_datetime(str(date_from))
        dt_to = fields.Datetime.to_datetime(str(date_to)).replace(hour=23, minute=59, second=59)
        return {
            'evolution': self._compute_ventes_evolution(dt_from, dt_to, evolution_group),
            'date_from': str(date_from),
            'date_to': str(date_to),
        }

    def _compute_ventes_evolution(self, dt_from, dt_to, evolution_group=None):
        group = (evolution_group or 'month').lower()
        if group not in ('day', 'week', 'month', 'year'):
            group = 'month'

        str_from = dt_from.strftime('%Y-%m-%d 00:00:00')
        str_to = dt_to.strftime('%Y-%m-%d 23:59:59')
        sale_lines = self.env['sale.order.line'].search([
            ('order_id.date_order', '>=', str_from),
            ('order_id.date_order', '<=', str_to),
            ('order_id.state', 'in', ['sale', 'done']),
        ])

        buckets = []
        start_date = dt_from.date()
        end_date = dt_to.date()

        if group == 'day':
            current = start_date
            while current <= end_date:
                buckets.append(current)
                current += timedelta(days=1)
        elif group == 'week':
            current = start_date - timedelta(days=start_date.weekday())
            while current <= end_date:
                buckets.append(current)
                current += timedelta(days=7)
        elif group == 'year':
            current = date(start_date.year, 1, 1)
            while current <= end_date:
                buckets.append(current)
                current = date(current.year + 1, 1, 1)
        else:
            current = date(start_date.year, start_date.month, 1)
            while current <= end_date:
                buckets.append(current)
                next_month = current.month + 1
                next_year = current.year
                if next_month > 12:
                    next_month = 1
                    next_year += 1
                current = date(next_year, next_month, 1)

        grouped = { }
        for line in sale_lines:
            order_date = line.order_id.date_order
            if not order_date:
                continue
            local = fields.Datetime.context_timestamp(line.order_id, order_date).date()
            if group == 'day':
                key = local.strftime('%Y-%m-%d')
                label = local.strftime('%d %b')
            elif group == 'week':
                iso_year, iso_week, _ = local.isocalendar()
                key = f'{iso_year}-W{iso_week:02d}'
                label = f'S{iso_week} {iso_year}'
            elif group == 'year':
                key = str(local.year)
                label = str(local.year)
            else:
                key = local.strftime('%Y-%m')
                label = local.strftime('%b %Y')
            grouped.setdefault(key, {'label': label, 'ca': 0.0})
            grouped[key]['ca'] += line.price_subtotal

        evolution = []
        for current in buckets:
            if group == 'day':
                key = current.strftime('%Y-%m-%d')
                label = current.strftime('%d %b')
            elif group == 'week':
                iso_year, iso_week, _ = current.isocalendar()
                key = f'{iso_year}-W{iso_week:02d}'
                label = f'S{iso_week} {iso_year}'
            elif group == 'year':
                key = str(current.year)
                label = str(current.year)
            else:
                key = current.strftime('%Y-%m')
                label = current.strftime('%b %Y')
            evolution.append({
                'mois': label,
                'ca': round(grouped.get(key, {'ca': 0.0})['ca'], 2),
            })
        return evolution

    @api.model
    def action_open_stock(self):
        # La LISTE est la vue par defaut (pas le pivot) : cliquer sur une
        # carte doit montrer les enregistrements un par un, pas un total
        # agrege. Le pivot/graph restent accessibles via les onglets de vue.
        # Le total (sum="Total" sur camlait_valeur_stock, cf.
        # stock_quant_views.xml) reste visible en pied de liste et
        # correspond exactement a la carte "Valeur totale du stock".
        return {
            'type': 'ir.actions.act_window', 'name': 'Valeur du stock',
            'res_model': 'stock.quant', 'view_mode': 'list,pivot,graph,form',
            'views': [
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_list').id, 'list'),
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_pivot').id, 'pivot'),
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_graph').id, 'graph'),
                (False, 'form'),
            ],
            'domain': [
                ('location_id', 'in', self._get_target_location_ids()),
                ('product_id.type', '=', 'product'),
                ('quantity', '>', 0),
            ],
            'target': 'current',
        }

    @api.model
    def action_open_stock_ruptures(self):
        """'Ruptures' = quants a quantite <= 0 (meme calcul que 'ruptures'
        dans _get_stock()). Reutilise les memes vues que "Valeur du stock",
        avec la LISTE par defaut (et non le pivot, qui n'affichait qu'un
        total agrege au lieu de la liste des produits en rupture)."""
        return {
            'type': 'ir.actions.act_window', 'name': 'Produits en rupture',
            'res_model': 'stock.quant', 'view_mode': 'list,pivot,graph,form',
            'views': [
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_list').id, 'list'),
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_pivot').id, 'pivot'),
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_graph').id, 'graph'),
                (False, 'form'),
            ],
            'domain': [
                ('location_id', 'in', self._get_target_location_ids()),
                ('product_id.type', '=', 'product'),
                ('quantity', '<=', 0),
            ],
            'target': 'current',
        }
        
    
    @api.model
    def action_open_avaries(self):
        """'Avarie' = quants a quantite > 0 dans les emplacements 'Avarie',
        recherches sur TOUS les entrepots actifs du systeme (meme calcul
        que 'avarie_count' dans _get_stock() / _get_avaries_count())."""
        loc_ids = self._get_special_location_ids('avarie')
        return {
            'type': 'ir.actions.act_window', 'name': 'Produits en avarie',
            'res_model': 'stock.quant', 'view_mode': 'list,graph,form',
            'views': [
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_list').id, 'list'),
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_graph').id, 'graph'),
                (False, 'form'),
            ],
            'domain': [
                ('location_id', 'in', loc_ids),
                ('product_id.type', '=', 'product'),
                ('quantity', '>', 0),
            ],
            'target': 'current',
        }

    @api.model
    def action_open_echantillons(self):
        """'Echantillon' = quants a quantite > 0 dans les emplacements
        'Echantillon', recherches sur TOUS les entrepots actifs du systeme
        (meme calcul que 'echantillon_count' dans _get_stock() /
        _get_echantillons_count())."""
        loc_ids = self._get_special_location_ids('echantillon')
        return {
            'type': 'ir.actions.act_window', 'name': 'Echantillons',
            'res_model': 'stock.quant', 'view_mode': 'list,graph,form',
            'views': [
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_list').id, 'list'),
                (self.env.ref('camlait_dashboard.camlait_view_stock_quant_graph').id, 'graph'),
                (False, 'form'),
            ],
            'domain': [
                ('location_id', 'in', loc_ids),
                ('product_id.type', '=', 'product'),
                ('quantity', '>', 0),
            ],
            'target': 'current',
        }

    @api.model
    def action_open_stock_rotation(self):
        """'Rotation moy. stock' est calculee a partir des sorties de
        stock (mouvements vers l'exterieur) des 30 derniers jours (voir
        _get_stock()). Le detail affiche donc ces memes mouvements."""
        today = date.today()
        str_today = today.strftime('%Y-%m-%d 23:59:59')
        date_30j = (today - timedelta(days=30)).strftime('%Y-%m-%d 00:00:00')
        return {
            'type': 'ir.actions.act_window', 'name': 'Sorties de stock (30 derniers jours)',
            'res_model': 'stock.move', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': [
                ('state', '=', 'done'),
                ('location_id', 'in', self._get_target_location_ids()),
                ('location_dest_id.usage', '=', 'customer'),
                ('date', '>=', date_30j),
                ('date', '<=', str_today),
            ],
            'target': 'current',
        }

    @api.model
    def action_open_stock_alert(self):
        """Reprend exactement les memes points de commande que ceux
        comptes dans 'sous_seuil' (_get_stock()), au lieu de renvoyer sans
        filtre vers TOUS les points de commande comme c'etait le cas."""
        ids = self._get_sous_seuil_orderpoint_ids()
        return {
            'type': 'ir.actions.act_window', 'name': 'Produits sous seuil minimum',
            'res_model': 'stock.warehouse.orderpoint', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': [('id', 'in', ids)], 'target': 'current',
        }

    @api.model
    def action_open_sale_order(self, order_id):
        return {
            'type': 'ir.actions.act_window', 'name': 'Commande',
            'res_model': 'sale.order', 'view_mode': 'form',
            'views': [(False, 'form')], 'res_id': order_id, 'target': 'current',
        }

    # NOTE: implémentation unique -- l'ancien doublon (identique) qui existait
    # en fin de fichier a été supprimé. Voir _get_target_warehouses /
    # _get_target_location_ids plus haut dans la section "ENTREPOTS CIBLES".