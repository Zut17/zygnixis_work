# camlait_dashboard/models/dashboard.py
import logging
from odoo import models, fields, api
from datetime import date, timedelta

_logger = logging.getLogger(__name__)


class CamlaitDashboard(models.TransientModel):
    _name = 'camlait.dashboard'
    _description = 'Tableau de bord decisionnel Camlait'

    @api.model
    def get_dashboard_data(self, date_from=None, date_to=None):
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
            'achats':             self._get_achats(dt_from, dt_to, today),
            'ventes':             self._get_ventes(dt_from, dt_to, today),
            'stock':              self._get_stock(),
            'maintenance':        self._get_maintenance(dt_from, dt_to, today),
            'commandes_recentes': self._get_commandes_recentes(),
            'alertes':            self._get_alertes(dt_from, dt_to, today),
            'repartition_canal':  self._get_repartition_canal(dt_from, dt_to),
            'date_from':          str(date_from),
            'date_to':            str(date_to),
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
    def _get_ventes(self, dt_from, dt_to, today):
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
        livrees        = sum(1 for p in pickings_so if p.state == 'done')
        total_pick     = len(pickings_so)
        taux_livraison = round(livrees / total_pick * 100) if total_pick else 0

        en_attente = 0
        en_retard  = 0
        for so in confirmed:
            pickings  = so.picking_ids
            non_livre = any(
                p.state not in ('done', 'cancel') for p in pickings
            ) if pickings else True
            if non_livre:
                en_attente += 1
                if so.commitment_date and \
                   so.commitment_date.strftime('%Y-%m-%d %H:%M:%S') < str_today:
                    en_retard += 1

        prod_data = {}
        for line in sale_lines:
            if not line.product_id:
                continue
            pid = line.product_id.id
            if pid not in prod_data:
                prod_data[pid] = {'name': line.product_id.name, 'qty': 0.0, 'ca': 0.0}
            prod_data[pid]['qty'] += line.product_uom_qty
            prod_data[pid]['ca']  += line.price_subtotal
        top5 = sorted(prod_data.values(), key=lambda x: x['ca'], reverse=True)[:5]
        for p in top5:
            p['qty'] = round(p['qty'])
            p['ca']  = round(p['ca'], 2)

        six_months_ago = today.replace(day=1)
        for _ in range(5):
            six_months_ago = (six_months_ago - timedelta(days=1)).replace(day=1)
        all_orders = SO.search([
            ('date_order', '>=', six_months_ago.strftime('%Y-%m-%d 00:00:00')),
            ('date_order', '<=', str_to),
            ('state', 'in', ['sale', 'done']),
        ])
        all_lines = self.env['sale.order.line'].search([
            ('order_id', 'in', all_orders.ids),
        ])
        monthly_ca = {}
        for line in all_lines:
            key = line.order_id.date_order.strftime('%Y-%m')
            monthly_ca[key] = monthly_ca.get(key, 0.0) + line.price_subtotal
        evolution = []
        for i in range(5, -1, -1):
            ref   = today.replace(day=1)
            month = ref.month - i
            year  = ref.year
            while month <= 0:
                month += 12
                year  -= 1
            key = f'{year:04d}-{month:02d}'
            evolution.append({
                'mois': date(year, month, 1).strftime('%b'),
                'ca':   round(monthly_ca.get(key, 0.0), 2),
            })

        objectif_ca = self._get_param_float('camlait_dashboard.objectif_ca', 197_000_000.0)

        activite_totale = SO.search_count([
            ('date_order', '>=', str_from),
            ('date_order', '<=', str_to),
        ])

        return {
            'ca_total':          round(ca_total, 2),
            'ca_delta':          ca_delta,
            'objectif_ca':       objectif_ca,
            'commandes_livrees': livrees,
            'taux_livraison':    taux_livraison,
            'en_attente':        en_attente,
            'en_retard':         en_retard,
            'top5':              top5,
            'evolution':         evolution,
            'has_data':          activite_totale > 0,
        }

    # ════════════════════════════════════════════════════════════════
    # STOCK
    # ════════════════════════════════════════════════════════════════
    def _get_stock(self):
        today     = date.today()
        str_today = today.strftime('%Y-%m-%d 23:59:59')

        loc_ids = self.env['stock.location'].search([
            ('usage', '=', 'internal'),
            ('active', '=', True),
        ]).ids

        all_quants = self.env['stock.quant'].search([
            ('location_id', 'in', loc_ids),
            ('product_id.type', '=', 'product'),
        ])

        produits_en_stock = len(set(q.product_id.id for q in all_quants if q.quantity > 0))
        ruptures = len(set(q.product_id.id for q in all_quants if q.quantity <= 0))
        valeur_stock = sum(
            q.quantity * q.product_id.standard_price
            for q in all_quants if q.quantity > 0
        )
        total_produits = len(set(q.product_id.id for q in all_quants))

        orderpoints = self.env['stock.warehouse.orderpoint'].search([('active', '=', True)])
        sous_seuil = sum(1 for op in orderpoints if op.qty_on_hand < op.product_min_qty)

        date_30j  = (today - timedelta(days=30)).strftime('%Y-%m-%d 00:00:00')
        moves_out = self.env['stock.move'].search([
            ('state', '=', 'done'),
            ('location_dest_id.usage', '=', 'customer'),
            ('date', '>=', date_30j),
            ('date', '<=', str_today),
        ])
        sorties_30j     = sum(m.product_qty for m in moves_out)
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
        for wh in self.env['stock.warehouse'].search([('active', '=', True)]):
            wh_locs = self.env['stock.location'].search([
                ('complete_name', 'like', wh.name),
                ('usage', '=', 'internal'),
            ])
            wh_quants = self.env['stock.quant'].search([
                ('location_id', 'in', wh_locs.ids),
                ('product_id.type', '=', 'product'),
            ])
            rup   = sum(1 for q in wh_quants if q.quantity <= 0)
            total = len(wh_quants)
            if rup == 0:
                statuts.append({'label': f"{wh.name} - OK", 'statut': 'ok'})
            elif rup < total * 0.3:
                statuts.append({'label': f"{wh.name} - Attention", 'statut': 'warn'})
            else:
                statuts.append({'label': f"{wh.name} - Rupture", 'statut': 'danger'})
        statuts = statuts[:3]

        return {
            'produits_en_stock': produits_en_stock,
            'sous_seuil':        sous_seuil,
            'ruptures':          ruptures,
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
        }

    @api.model
    def action_open_maintenance(self):
        return {
            'type': 'ir.actions.act_window', 'name': 'Demandes de maintenance',
            'res_model': 'maintenance.request', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')], 'target': 'current',
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
        }

    @api.model
    def action_open_stock(self):
        return {
            'type': 'ir.actions.act_window', 'name': 'Etat du stock',
            'res_model': 'stock.quant', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')],
            'domain': [('location_id.usage', '=', 'internal'), ('product_id.type', '=', 'product')],
            'target': 'current',
        }

    @api.model
    def action_open_stock_alert(self):
        return {
            'type': 'ir.actions.act_window', 'name': 'Produits sous seuil minimum',
            'res_model': 'stock.warehouse.orderpoint', 'view_mode': 'list,form',
            'views': [(False, 'list'), (False, 'form')], 'target': 'current',
        }

    @api.model
    def action_open_sale_order(self, order_id):
        return {
            'type': 'ir.actions.act_window', 'name': 'Commande',
            'res_model': 'sale.order', 'view_mode': 'form',
            'views': [(False, 'form')], 'res_id': order_id, 'target': 'current',
        }