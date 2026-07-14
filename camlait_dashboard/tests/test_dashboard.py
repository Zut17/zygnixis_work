# camlait_dashboard/tests/test_dashboard.py
from odoo.tests.common import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestCamlaitDashboard(TransactionCase):
    """Tests de regression de base pour camlait.dashboard.

    Objectif : proteger les methodes de calcul (get*) contre les
    regressions silencieuses (ex: le doublon de _get_target_warehouses /
    _get_target_location_ids qui existait auparavant en deux endroits du
    fichier, avec Python ne gardant que la derniere definition sans lever
    d'erreur). Ces tests ne verifient pas des valeurs metier precises
    (elles dependent des donnees presentes en base) mais que les methodes
    s'executent sans erreur et renvoient une structure coherente.
    """

    def setUp(self):
        super().setUp()
        self.dashboard = self.env['camlait.dashboard']

    def test_get_dashboard_data_keys(self):
        """get_dashboard_data() doit renvoyer toutes les sections attendues,
        sans lever d'exception, quelle que soit la volumetrie de donnees."""
        result = self.dashboard.get_dashboard_data()
        expected_keys = {
            'achats', 'ventes', 'stock', 'maintenance',
            'commandes_recentes', 'alertes', 'repartition_canal',
            'achats_categories', 'bons_commande_recents',
            'produits_sous_seuil_liste', 'stock_emplacements',
            'alertes_achats', 'alertes_stock', 'date_from', 'date_to',
        }
        self.assertTrue(expected_keys.issubset(result.keys()))

    def test_get_dashboard_data_with_explicit_dates(self):
        """Un appel avec des dates explicites doit etre repris tel quel
        dans la reponse (date_from / date_to echoes)."""
        result = self.dashboard.get_dashboard_data(
            date_from='2026-01-01', date_to='2026-01-31')
        self.assertEqual(result['date_from'], '2026-01-01')
        self.assertEqual(result['date_to'], '2026-01-31')

    def test_get_dashboard_data_cache(self):
        """Deux appels rapproches avec les memes parametres doivent
        renvoyer un resultat coherent (le cache court ne doit jamais
        renvoyer une structure invalide ou perimee au point de manquer
        des cles)."""
        first = self.dashboard.get_dashboard_data(date_from='2026-01-01', date_to='2026-01-31')
        second = self.dashboard.get_dashboard_data(date_from='2026-01-01', date_to='2026-01-31')
        self.assertEqual(first['date_from'], second['date_from'])
        self.assertEqual(first['date_to'], second['date_to'])

    def test_target_warehouses_no_duplicate_definition(self):
        """_get_target_warehouses / _get_target_location_ids ne doivent
        exister qu'une seule fois dans la classe (regression du bug des
        methodes dupliquees). On verifie indirectement que l'appel
        fonctionne et renvoie un recordset de stock.warehouse."""
        warehouses = self.dashboard._get_target_warehouses()
        self.assertEqual(warehouses._name, 'stock.warehouse')

        loc_ids = self.dashboard._get_target_location_ids()
        self.assertIsInstance(loc_ids, list)

    def test_stock_rotation_detail_default_period(self):
        """Sans argument, la periode de rotation doit rester 30 jours
        (comportement historique conserve pour compatibilite)."""
        result = self.dashboard.get_stock_rotation_detail()
        self.assertEqual(result['recap']['period_days'], 30)
        self.assertIn('rotation', result['recap'])
        self.assertIn('detail', result)

    def test_stock_rotation_detail_custom_period(self):
        """La fenetre de calcul de la rotation doit etre ajustable (ex: 7
        jours pour des produits a peremption rapide comme les produits
        laitiers), sans erreur meme sur une petite periode."""
        result = self.dashboard.get_stock_rotation_detail(period_days=7)
        self.assertEqual(result['recap']['period_days'], 7)

    def test_stock_rotation_detail_invalid_period_falls_back(self):
        """Une valeur invalide pour period_days ne doit pas faire planter
        l'appel : on retombe sur la valeur par defaut (30)."""
        result = self.dashboard.get_stock_rotation_detail(period_days='not-a-number')
        self.assertEqual(result['recap']['period_days'], 30)

    def test_get_stock_structure(self):
        """_get_stock() doit toujours renvoyer les cles utilisees par le
        front-end (le JS accede directement a ces champs sans garde)."""
        stock = self.dashboard._get_stock()
        for key in ('produits_en_stock', 'sous_seuil', 'ruptures',
                    'rotation_stock', 'taux_dispo', 'valeur_stock'):
            self.assertIn(key, stock)
