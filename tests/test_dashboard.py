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
        self.assertIn('Flujo de oportunidades — etapas de Odoo', self.text())
        self.assertIn('agrupadas por su etapa actual', self.text())

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

    def test_missing_close_date_keeps_counts_and_discloses_reference(self):
        raw = copy.deepcopy(RAW)
        raw['C'][2][6] = -1
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('40%', self.text())
        self.assertIn('2 ganadas / (2 ganadas + 3 perdidas)', self.text())
        self.assertIn('1 oportunidades sin fecha de cierre incluidas por fecha de alta', self.text())
        self.assertNotIn('Sin datos completos', self.text())

    def test_mixed_legacy_rows_do_not_hide_or_inflate_known_results(self):
        raw = copy.deepcopy(RAW)
        raw['C'][-1] = raw['C'][-1][:5]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('50%', self.text())
        self.assertIn('2 ganadas / (2 ganadas + 2 perdidas)', self.text())
        self.assertIn('1 registros sin estado identificable excluidos', self.text())
        self.assertNotIn('Sin datos completos', self.text())

    def test_other_seller_missing_date_does_not_block_selected_seller(self):
        raw = copy.deepcopy(RAW)
        raw['C'].append([0, 1, 1, 0, 1, 2, -1, -1, 999, 'opportunity', ''])
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('40%', self.text())
        self.assertNotIn('sin fecha de cierre incluidas', self.text())

    def test_all_closures_missing_dates_still_count_known_states(self):
        raw = copy.deepcopy(RAW)
        for row in raw['C']:
            row[6] = -1
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('40%', self.text())
        self.assertIn('2 ganadas / (2 ganadas + 3 perdidas)', self.text())
        self.assertIn('5 oportunidades sin fecha de cierre incluidas por fecha de alta', self.text())

    def test_date_filter_uses_closure_when_known_and_scopes_missing_date_note(self):
        raw = copy.deepcopy(RAW)
        raw['C'].append([0, 0, 1, 0, 1, 2, -1, -1, 999, 'opportunity', ''])
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.page.select_option('#fPer', 'custom')
        self.page.locator('#fFrom').fill('2026-09-10')
        self.page.locator('#fFrom').dispatch_event('change')
        self.page.locator('#fTo').fill('2026-09-15')
        self.page.locator('#fTo').dispatch_event('change')
        # Five closures on September 13 remain despite creation on September 2.
        # The undated closure referenced to September 2 is outside this range.
        self.assertIn('2 ganadas / (2 ganadas + 3 perdidas)', self.text())
        self.assertIn('40%', self.text())
        self.assertNotIn('sin fecha de cierre incluidas', self.text())

    def test_only_unknown_states_do_not_display_false_zero_rate(self):
        raw = copy.deepcopy(RAW)
        raw['C'] = [[0, 0, 1, 0, 1]]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        card = self.page.locator('.kpi').filter(has=self.page.get_by_text('% de oportunidades ganadas', exact=True))
        self.assertIn('Sin cierres identificados', card.inner_text())
        self.assertNotIn('0%', card.inner_text())

    def test_crm_visible_without_any_orders(self):
        raw = copy.deepcopy(RAW)
        raw['O'] = []
        raw['L'] = []
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('Sin ventas en este período', self.text())
        self.assertIn('Flujo de oportunidades — etapas de Odoo', self.text())

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

    def flow_fixture(self):
        raw = copy.deepcopy(RAW)
        names = ['Nueva consulta', 'Contactado', 'Cotizacion enviada', 'Negociación',
                 'Pedido confirmado', 'Ganado', 'NO AVANZARA']
        raw['dict']['STAGE'] = names
        raw['meta']['stageOrder'] = names
        # Pedido confirmado is deliberately flagged won: its stage must stay separate.
        raw['C'] = [[0, 0, stage, int(stage in (4, 5)), 12,
                     int(stage in (4, 5)), -1, -1, 200+stage, 'opportunity', '', 1]
                    for stage in range(7)]
        raw['C'] += [
            [0, 0, 5, 1, 12, 1, -1, -1, 300, 'opportunity', '', 0],  # archived won
            [0, 0, 2, 0, 12, 2, -1, -1, 301, 'opportunity', '', 0],  # archived lost
            [0, 0, 0, 0, 12, 0, -1, -1, 302, 'lead', '', 1],
            [0, 1, 2, 0, 12, 0, -1, -1, 303, 'opportunity', '', 1],
        ]
        return raw

    def flow_counts(self):
        return {card.locator('.kl').inner_text(): card.locator('.kv').inner_text()
                for card in self.page.locator('.crm-flujo .kpi').all()}

    def test_flow_matches_stages_with_explicit_groups_and_archived_excluded(self):
        self.load(self.flow_fixture())
        self.page.select_option('#fVen', '0')
        self.assertEqual({'Contacto inicial': '2', 'En gestión': '2',
                          'Pedido confirmado': '1', 'Ganado': '1', 'No avanzará': '1'},
                         self.flow_counts())
        flow = self.page.locator('.crm-flujo').inner_text()
        self.assertIn('7 oportunidades en el flujo', flow)
        self.assertIn('2 oportunidades archivadas', flow)
        self.assertIn('Cotizacion enviada: 1', flow)
        self.assertIn('Negociación: 1', flow)
        self.assertNotIn('próxima sincronización', flow)

    def test_flow_general_adds_sellers_and_web_still_hides_it(self):
        self.load(self.flow_fixture())
        self.assertEqual('3', self.flow_counts()['En gestión'])
        self.page.select_option('#fVen', '1')
        self.assertEqual(0, self.page.locator('.crm-flujo').count())

    def test_flow_dates_use_creation_and_keep_empty_stages_visible(self):
        raw = self.flow_fixture()
        raw['C'][5][4] = 1  # Ganado created outside range, with closure inside.
        raw['C'][5][6] = 12
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.page.select_option('#fPer', 'custom')
        self.page.locator('#fFrom').fill('2026-09-10')
        self.page.locator('#fFrom').dispatch_event('change')
        self.page.locator('#fTo').fill('2026-09-15')
        self.page.locator('#fTo').dispatch_event('change')
        self.assertEqual('0', self.flow_counts()['Ganado'])
        self.assertEqual('1', self.flow_counts()['Pedido confirmado'])
        self.assertIn('6 oportunidades en el flujo', self.page.locator('.crm-flujo').inner_text())

    def test_flow_with_only_archived_opportunities_is_empty(self):
        raw = self.flow_fixture()
        for row in raw['C']:
            row[11] = 0
        self.load(raw)
        self.assertTrue(all(value == '0' for value in self.flow_counts().values()))
        self.assertIn('Sin oportunidades activas creadas en este período', self.text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
