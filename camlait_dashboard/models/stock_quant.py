# camlait_dashboard/models/stock_quant.py
from odoo import models, fields, api


class StockQuant(models.Model):
    _inherit = 'stock.quant'

    camlait_currency_id = fields.Many2one(
        'res.currency', string='Devise',
        related='company_id.currency_id', readonly=True,
    )
    camlait_standard_price = fields.Float(
        related='product_id.standard_price',
        string='Prix de revient',
        store=True
    )
    camlait_valeur_stock = fields.Float(
        string='Valeur du stock',
        compute='_compute_camlait_valeur_stock', store=True,
        help="Quantite x Cout standard du produit. Sert a mettre en evidence "
            "la valorisation du stock (memes valeurs que la carte "
            "'Valeur stock actuel' du tableau de bord Camlait).",
    )

    @api.depends('quantity', 'camlait_standard_price')
    def _compute_camlait_valeur_stock(self):
        for quant in self:
            quant.camlait_valeur_stock = quant.quantity * quant.camlait_standard_price
