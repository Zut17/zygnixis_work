{
    'name': 'Camlait Dashboard',
    'version': '15.0.2.2.0',
    'summary': 'Tableau de bord décisionnel Camlait',
    'author': 'Zygnixis',
    'category': 'Reporting',
    'depends': [
        'base',
        'web',
        'purchase',
        'purchase_stock',
        'sale',
        'sale_management',
        'stock',
        'maintenance',
    ],
    'data': [
        'security/ir.model.access.csv',
        'views/stock_quant_views.xml',
        'views/dashboard_menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'camlait_dashboard/static/src/css/dashboard.css',
            # Utilitaires partages, doivent charger avant les composants
            # qui les importent.
            'camlait_dashboard/static/src/js/utils/dashboard_format.js',
            # Sous-composants extraits de dashboard_main.js (cartes +
            # modales) : doivent charger avant dashboard_main.js, qui les
            # importe et les enregistre via CamlaitDashboard.components.
            'camlait_dashboard/static/src/js/components/stock_card.js',
            'camlait_dashboard/static/src/js/components/achats_card.js',
            'camlait_dashboard/static/src/js/components/ventes_card.js',
            'camlait_dashboard/static/src/js/components/dashboard_modals.js',
            'camlait_dashboard/static/src/js/dashboard_main.js',
        ],
    },
    'application': True,
    'installable': True,
    'license': 'LGPL-3',
}