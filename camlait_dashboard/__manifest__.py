{
    'name': 'Camlait Dashboard',
    'version': '15.0.2.1.0',
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
            'camlait_dashboard/static/src/js/dashboard_main.js',
        ],
    },
    'application': True,
    'installable': True,
    'license': 'LGPL-3',
}