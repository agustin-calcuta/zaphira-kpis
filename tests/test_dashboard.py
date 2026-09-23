"""Browser regressions with synthetic API data (no production login or data).

Run: python tests/test_dashboard.py
Requires Python Playwright and its Chromium browser.
"""
import copy
import json
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

HTML = (Path(__file__).resolve().parents[1] / 'index.html').read_text(encoding='utf-8')
RAW = {
    'pull': '2026-09-23 10:00', 'rate': 1000, 'rateMon': {'2026-09': 1000},
    'dict': {'VEN': ['Ana', 'Web (Tiendanube)'],
             'CAN': ['Venta directa', 'Web (Tiendanube)'],
             'TIPO': ['Tradicional', 'Pronta Entrega', 'Ecommerce'],
             'PROV': ['Buenos Aires'], 'IND': ['Salud'], 'CAT': ['Sanidad'],
             'MON': ['2026-09'], 'STAGE': ['Ganado', 'Calificado']},
    'meta': {'day0': '2026-09-01', 'today': '2026-09-23',
             'maxDate': '2026-09-23', 'dateFrom': '2026-09-01', 'base': 'total'},
    'O': [[0, 0, 0, 0, 0, 0, 1000, 10, 1, 101],
          [0, 1, 1, 2, 0, 0, 2000, 11, 0, 0]],
    'L': [[0, 0, 0, 0, 0, 10, 10, 1000, 10],
          [0, 1, 1, 2, 0, 20, 20, 2000, 11]], 'P': [],
    'C': [[0, 0, 0 if i < 2 else 1, 1 if i < 2 else 0, 1,
           1 if i < 2 else 2, 12, -1, 101+i, 'opportunity', ''] for i in range(5)],
}


class DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual([], self.errors)

    def load(self, raw=None, seller=False):
        raw = copy.deepcopy(raw if raw is not None else RAW)
        session = {'token': 'synthetic-test-token', 'usuario': 'test', 'nombre': 'Test',
                   'rol': 'vendedora' if seller else 'direccion', 'ven': 'Ana', 'cambiar': False}
        self.context.add_init_script('localStorage.setItem("zaphira_sesion_v2", '
                                     + json.dumps(json.dumps(session)) + ');')
        def route(request):
            if request.request.url.startswith('http://dashboard.test'):
                request.fulfill(status=200, content_type='text/html', body=HTML)
            elif request.request.url.startswith('https://script.google.com/'):
                self.assertEqual('synthetic-test-token', request.request.post_data_json['token'])
                request.fulfill(status=200, content_type='application/json',
                                headers={'Access-Control-Allow-Origin': '*'},
                                body=json.dumps({'ok': True, 'raw': raw}))
            else:
                request.abort()
        self.context.route('**/*', route)
        self.page.goto('http://dashboard.test')
        self.page.locator('#fVen').wait_for()

    def text(self):
        return self.page.locator('#app').inner_text()

    def top_labels(self):
        return self.page.locator('#app > div > .kpis').first.locator('.kl').all_text_contents()

    def test_general_has_four_commercial_cards_and_explained_crm(self):
        self.load()
        self.assertEqual(['Ventas confirmadas', 'Ticket promedio', 'Órdenes', 'Prendas vendidas'], self.top_labels())
        self.assertIn('Cerradas = ganadas + perdidas', self.text())
        self.assertIn('40%', self.text())

    def test_seller_has_six_cards_and_correct_rate(self):
        self.load()
        self.page.select_option('#fVen', '0')
        self.assertEqual(6, len(self.top_labels()))
        self.assertIn('2 ganadas / (2 ganadas + 3 perdidas)', self.text())

    def test_web_seller_hides_all_crm(self):
        self.load()
        self.page.select_option('#fVen', '1')
        self.assertEqual(4, len(self.top_labels()))
        self.assertNotIn('oportunidades', self.text().lower())

    def test_web_channel_hides_all_crm(self):
        self.load()
        self.page.select_option('#fCan', '1')
        self.assertEqual(4, len(self.top_labels()))
        self.assertNotIn('oportunidades', self.text().lower())

    def test_direct_channel_does_not_show_unfiltered_crm(self):
        self.load()
        self.page.select_option('#fCan', '0')
        self.assertNotIn('% de oportunidades ganadas', self.text())
        self.assertIn('seleccioná «Todos» en Canal', self.text())

    def test_no_closures_is_not_zero_percent(self):
        raw = copy.deepcopy(RAW)
        raw['C'] = [[0, 0, 1, 0, 1, 0, -1, -1, 101, 'opportunity', '']]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        card = self.page.locator('.kpi').filter(has=self.page.get_by_text('% de oportunidades ganadas', exact=True))
        self.assertIn('Sin cierres', card.inner_text())
        self.assertNotIn('0%', card.inner_text())

    def test_missing_close_date_disables_percentage(self):
        raw = copy.deepcopy(RAW)
        raw['C'][2][6] = -1
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('Sin datos completos', self.text())
        self.assertNotIn('40%', self.text())

    def test_mixed_legacy_rows_disable_percentage(self):
        raw = copy.deepcopy(RAW)
        raw['C'][-1] = raw['C'][-1][:5]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('Sin datos completos', self.text())

    def test_crm_visible_without_any_orders(self):
        raw = copy.deepcopy(RAW)
        raw['O'] = []
        raw['L'] = []
        self.load(raw)
        self.assertIn('Sin ventas en este período', self.text())
        self.assertIn('40%', self.text())

    def test_legacy_yeni_is_web(self):
        raw = copy.deepcopy(RAW)
        raw['dict']['VEN'][1] = 'Yeni'
        self.load(raw)
        self.page.select_option('#fVen', label='Web (Tiendanube)')
        self.assertNotIn('oportunidades', self.text().lower())

    def test_seller_role_keeps_own_filter_locked(self):
        raw = copy.deepcopy(RAW)
        raw['dict']['VEN'] = ['Ana']
        raw['O'] = raw['O'][:1]
        raw['L'] = raw['L'][:1]
        self.load(raw, seller=True)
        self.assertTrue(self.page.locator('#fVen').is_disabled())
        self.assertEqual(0, self.page.locator('#fCan').count())
        self.assertEqual(6, len(self.top_labels()))
        self.assertNotIn('Web (Tiendanube)', self.text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
