"""Browser regressions with synthetic API data (no production login or data).

Run: python tests/test_dashboard.py
Requires Python Playwright and its Chromium browser.
"""
import copy
import json
import unittest
from pathlib import Path
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

HTML = (Path(__file__).resolve().parents[1] / 'index.html').read_text(encoding='utf-8').replace(
    '</script>', 'window.__chartSVG=chartSVG;window.__chartMoney=money;</script>')
RAW = {
    'pull': '2026-09-23 10:00', 'rate': 1000, 'rateMon': {'2026-09': 1000},
    'dict': {'VEN': ['Ana', 'Web (Tiendanube)'],
             'CAN': ['Venta directa', 'Web (Tiendanube)'],
             'TIPO': ['Tradicional', 'Pronta Entrega', 'Ecommerce'],
             'PROV': ['Buenos Aires'], 'IND': ['Salud'], 'CAT': ['Sanidad'],
             'MON': ['2026-09'], 'STAGE': ['Ganado', 'Calificado']},
    'meta': {'day0': '2026-09-01', 'today': '2026-09-23',
             'maxDate': '2026-09-23', 'dateFrom': '2026-09-01', 'base': 'total'},
    'O': [[0, 0, 0, 0, 0, 0, 1000, 10, 1, 101, 501],
          [0, 1, 1, 2, 0, 0, 2000, 11, 0, 0, 502]],
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
        self.page.clock.set_fixed_time(datetime(2026, 9, 23, 15, tzinfo=timezone.utc))
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual([], self.errors)

    def load(self, raw=None, seller=False, objective=None, goals_by_month=None, users=None):
        raw = copy.deepcopy(raw if raw is not None else RAW)
        if seller:
            for key in ('O', 'L', 'P', 'C'):
                raw[key] = [row for row in raw.get(key, []) if row[1] == 0]
            raw['dict']['VEN'] = ['Ana']
        session = {'token': 'synthetic-test-token', 'usuario': 'test', 'nombre': 'Test',
                   'rol': 'vendedora' if seller else 'direccion', 'ven': 'Ana', 'cambiar': False}
        self.context.add_init_script('localStorage.setItem("zaphira_sesion_v2", '
                                     + json.dumps(json.dumps(session)) + ');')
        self.saved_goals = None
        self.export_request = None
        def route(request):
            if request.request.url == 'http://dashboard.test/api':
                self.assertEqual('synthetic-test-token', request.request.post_data_json['token'])
                payload = request.request.post_data_json
                result = {'ok': True, 'raw': raw, 'objetivo': objective or {}}
                if payload['op'] == 'usuarios':
                    result = {'ok': True, 'usuarios': users if users is not None else [{'rol': 'vendedora', 'activo': True, 'vendedora': 'Ana', 'nombre': 'Ana', 'usuario': 'ana'}]}
                elif payload['op'] == 'objetivos':
                    month = payload.get('mes') or raw['meta']['today'][:7]
                    goals = (goals_by_month or {}).get(month, objective) or {}
                    result = {'ok': True, 'mes': month, 'objetivos': {'empresa': 0, 'vendedoras': {}, **goals}, 'mio': goals.get('mio', 0)}
                elif payload['op'] == 'guardarObjetivos':
                    self.saved_goals = payload['filas']
                    values = {row['alcance']: row['objetivo'] for row in payload['filas']}
                    result = {'ok': True, 'objetivos': {'empresa': values.get('empresa', 0),
                              'tiendanube': values.get('__tiendanube__', 0),
                              'vendedoras': {k: v for k, v in values.items() if k not in ('empresa', '__tiendanube__')}}}
                elif payload['op'] == 'xlsx':
                    self.export_request = payload
                    result = {'ok': True, 'b64': 'dGVzdA==', 'filename': 'synthetic.xlsx'}
                request.fulfill(status=200, content_type='application/json',
                                headers={'Access-Control-Allow-Origin': '*'},
                                body=json.dumps(result))
            elif request.request.url.startswith('http://dashboard.test'):
                request.fulfill(status=200, content_type='text/html', body=HTML)
            else:
                request.abort()
        self.context.route('**/*', route)
        self.page.goto('http://dashboard.test')
        self.page.locator('#fVen').wait_for()

    def text(self):
        return self.page.locator('#app').inner_text()

    def rate_card(self):
        return self.page.locator('.kpi').filter(has=self.page.locator('.kl').filter(has_text='% de cierres ganados'))

    def rate_help(self):
        return self.rate_card().locator('[title]').get_attribute('title')

    def top_labels(self):
        return self.page.locator('#app > div > .kpis').first.locator('.kl').all_text_contents()

    def test_general_has_four_commercial_cards_and_explained_crm(self):
        self.load()
        self.assertEqual(['Ventas confirmadas', 'Ticket promedio', 'Órdenes', 'Prendas vendidas'], self.top_labels())
        self.assertIn('Flujo de oportunidades creadas — etapa actual', self.text())
        self.assertIn('no es la tasa de cierres ganados', self.text())

    def test_seller_has_average_garments_card_and_correct_rate(self):
        self.load()
        self.page.select_option('#fVen', '0')
        self.assertEqual(7, len(self.top_labels()))
        self.assertIn('Prendas promedio por orden', self.top_labels())
        self.assertIn('2 ganadas / (2 ganadas + 3 perdidas)', self.text())

    def test_default_month_and_reset_use_current_argentina_date_despite_stale_odoo(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 1, 15, tzinfo=timezone.utc))
        self.load()
        self.assertEqual('mtd',self.page.locator('#fPer').input_value())
        self.assertEqual('2026-10-01',self.page.locator('#fFrom').input_value())
        self.assertEqual('2026-10-01',self.page.locator('#fTo').input_value())
        self.assertIn('Sin ventas en este período',self.text())
        self.page.select_option('#fPer','all')
        self.assertEqual('2',self.page.locator('#app > div > .kpis').first.locator('.kv').nth(2).inner_text())
        self.page.click('#reset')
        self.assertEqual('mtd',self.page.locator('#fPer').input_value())
        self.page.reload()
        self.assertEqual('mtd',self.page.locator('#fPer').input_value())

    def test_default_month_changes_at_argentina_midnight_and_applies_to_sellers(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 1, 1, tzinfo=timezone.utc))
        self.load(seller=True)
        self.assertEqual('mtd',self.page.locator('#fPer').input_value())
        self.assertEqual('2026-09-01',self.page.locator('#fFrom').input_value())
        self.assertEqual('2026-09-30',self.page.locator('#fTo').input_value())

    def test_direct_channel_opens_current_year_but_keeps_manual_period(self):
        self.load()
        self.page.select_option('#fCan','0')
        self.assertEqual('ytd',self.page.locator('#fPer').input_value())
        self.assertEqual(RAW['meta']['dateFrom'],self.page.locator('#fFrom').input_value(),
                         'Odoo cannot claim coverage before its extraction cutoff')
        self.page.select_option('#fPer','d30')
        self.page.select_option('#fCan','')
        self.page.select_option('#fCan','0')
        self.assertEqual('d30',self.page.locator('#fPer').input_value())

    def test_direct_segment_by_province_uses_line_category_and_order_province(self):
        raw=copy.deepcopy(RAW)
        raw['dict']['PROV']=['Córdoba','Buenos Aires']
        raw['dict']['CAT']=['Sanidad','Laboral']
        raw['O'][0][4]=0; raw['O'][1][4]=1
        raw['L'][0][4]=0; raw['L'][1][4]=1
        raw['L'][0].append(0); raw['L'][1].append(1)
        self.load(raw)
        self.page.select_option('#fCan','0')
        table=self.page.locator('.card').filter(has=self.page.get_by_role('heading',name='Venta directa por segmento de producto y provincia')).locator('table')
        self.assertIn('Córdoba',table.text_content())
        self.assertIn('Sanidad',table.text_content())
        self.assertIn('$ 1,0 K',table.text_content())
        self.assertIn('Prendas promedio por orden',self.top_labels())

    def test_monthly_evolution_fills_zero_sales_months_inside_odoo_coverage(self):
        raw=copy.deepcopy(RAW)
        raw['meta'].update(day0='2026-03-01',dateFrom='2026-03-01')
        raw['dict']['MON']=['2026-03','2026-09']
        raw['O'][0][7]=14;raw['O'][1][7]=198
        raw['L'][0][8]=14;raw['L'][1][8]=198
        self.load(raw)
        self.page.select_option('#fCan','0')
        chart=self.page.locator('#app svg[aria-label^="Ventas confirmadas"]')
        self.assertIn('Mar',chart.text_content())
        self.assertIn('Abr',chart.text_content())
        self.assertIn('Ago',chart.text_content())
        self.assertNotIn('Ene',chart.text_content())
        pairs=chart.evaluate('svg => [...svg.querySelectorAll(".chart-value-label")].map((value,i) => { const count=svg.querySelectorAll(".chart-count-label")[i]; const a=value.getBoundingClientRect(), b=count.getBoundingClientRect(); return a.bottom<=b.top || b.bottom<=a.top; })')
        self.assertTrue(all(pairs), 'amount and count labels must remain separate, including zero-sale months')

    def test_tiendanube_only_appears_in_channel_and_general_includes_odoo_web_sales(self):
        self.load()
        self.assertEqual(['Todas', 'Ana'], self.page.locator('#fVen option').all_text_contents())
        self.assertEqual(['Todos', 'Venta directa', 'Tiendanube'], self.page.locator('#fCan option').all_text_contents())
        self.assertEqual(0, self.page.locator('#btnTienda').count())
        self.assertIn('Fuente: Odoo', self.text())
        self.assertEqual('2', self.page.locator('#app > div > .kpis').first.locator('.kv').nth(2).inner_text())
        ranking=self.page.locator('.card').filter(has=self.page.get_by_role('heading',name='Ranking por vendedora',exact=True))
        self.assertEqual(['Ana'], ranking.locator('.hlbl').all_text_contents())
        evolution=self.page.locator('.card').filter(has=self.page.get_by_role('heading',name='Evolución mes a mes por vendedora',exact=True))
        self.assertNotIn('Web (Tiendanube)',evolution.text_content())

    def test_web_channel_hides_all_crm(self):
        self.setup_tn()
        self.assertNotIn('oportunidades', self.text().lower())

    def test_direct_channel_does_not_show_unfiltered_crm(self):
        self.load()
        self.page.select_option('#fCan', '0')
        self.assertNotIn('% de cierres ganados', self.text())
        self.assertIn('seleccioná «Todos» en Canal', self.text())

    def test_no_closures_is_not_zero_percent(self):
        raw = copy.deepcopy(RAW)
        raw['C'] = [[0, 0, 1, 0, 1, 0, -1, -1, 101, 'opportunity', '']]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        card = self.rate_card()
        self.assertIn('Sin cierres', card.inner_text())
        self.assertNotIn('0%', card.inner_text())

    def test_missing_close_date_keeps_counts_and_discloses_reference(self):
        raw = copy.deepcopy(RAW)
        raw['C'][2][6] = -1
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('40%', self.text())
        self.assertIn('2 ganadas / (2 ganadas + 3 perdidas)', self.text())
        self.assertIn('1 oportunidades sin fecha de cierre incluidas por fecha de alta', self.rate_help())
        self.assertNotIn('sin fecha de cierre incluidas', self.rate_card().inner_text())
        self.assertEqual('2 ganadas / (2 ganadas + 3 perdidas)', self.rate_card().locator('.ks').inner_text())
        self.assertNotIn('Sin datos completos', self.text())

    def test_mixed_legacy_rows_do_not_hide_or_inflate_known_results(self):
        raw = copy.deepcopy(RAW)
        raw['C'][-1] = raw['C'][-1][:5]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('50%', self.text())
        self.assertIn('2 ganadas / (2 ganadas + 2 perdidas)', self.text())
        self.assertIn('1 registros sin estado identificable excluidos', self.rate_help())
        self.assertNotIn('Sin datos completos', self.text())

    def test_other_seller_missing_date_does_not_block_selected_seller(self):
        raw = copy.deepcopy(RAW)
        raw['C'].append([0, 1, 1, 0, 1, 2, -1, -1, 999, 'opportunity', ''])
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('40%', self.text())
        self.assertNotIn('sin fecha de cierre incluidas', self.rate_help())

    def test_all_closures_missing_dates_still_count_known_states(self):
        raw = copy.deepcopy(RAW)
        for row in raw['C']:
            row[6] = -1
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('40%', self.text())
        self.assertIn('2 ganadas / (2 ganadas + 3 perdidas)', self.text())
        self.assertIn('5 oportunidades sin fecha de cierre incluidas por fecha de alta', self.rate_help())

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
        self.assertNotIn('sin fecha de cierre incluidas', self.rate_help())

    def test_only_unknown_states_do_not_display_false_zero_rate(self):
        raw = copy.deepcopy(RAW)
        raw['C'] = [[0, 0, 1, 0, 1]]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        card = self.rate_card()
        self.assertIn('Sin cierres identificados', card.inner_text())
        self.assertNotIn('0%', card.inner_text())

    def test_crm_visible_without_any_orders(self):
        raw = copy.deepcopy(RAW)
        raw['O'] = []
        raw['L'] = []
        self.load(raw)
        self.page.select_option('#fVen', '0')
        self.assertIn('Sin ventas en este período', self.text())
        self.assertIn('Flujo de oportunidades creadas — etapa actual', self.text())

    def test_legacy_yeni_is_web(self):
        raw = copy.deepcopy(RAW)
        raw['dict']['VEN'][1] = 'Yeni'
        self.load(raw)
        self.assertEqual(['Todas', 'Ana'], self.page.locator('#fVen option').all_text_contents())
        self.assertEqual(['Todos', 'Venta directa', 'Tiendanube'], self.page.locator('#fCan option').all_text_contents())
        self.assertEqual('2', self.page.locator('#app > div > .kpis').first.locator('.kv').nth(2).inner_text())

    def test_seller_role_keeps_own_filter_locked(self):
        raw = copy.deepcopy(RAW)
        raw['dict']['VEN'] = ['Ana']
        raw['O'] = raw['O'][:1]
        raw['L'] = raw['L'][:1]
        self.load(raw, seller=True)
        self.assertTrue(self.page.locator('#fVen').is_disabled())
        self.assertEqual(0, self.page.locator('#fCan').count())
        self.assertEqual(7, len(self.top_labels()))
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
                for card in self.page.locator('.crm-flow-cards > .kpi').all()}

    def test_flow_matches_stages_with_explicit_groups_and_archived_excluded(self):
        self.load(self.flow_fixture())
        self.page.select_option('#fVen', '0')
        self.assertEqual({'Contacto inicial': '2', 'En gestión': '2',
                          'Pedido confirmado': '1', 'Ganado (etapa actual)': '1', 'No avanzará': '1', 'Perdidas': '1'},
                         self.flow_counts())
        flow = self.page.locator('.crm-flujo').inner_text()
        self.assertIn('8 oportunidades creadas en el período', flow)
        self.assertIn('1 oportunidades archivadas', self.page.locator('.crm-flujo [title]').get_attribute('title'))
        self.assertIn('Cotizacion enviada: 1', flow)
        self.assertIn('Negociación: 1', flow)
        self.assertNotIn('próxima sincronización', flow)

    def test_flow_general_includes_web_records_from_odoo(self):
        self.load(self.flow_fixture())
        self.assertEqual('3', self.flow_counts()['En gestión'])

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
        self.assertEqual('0', self.flow_counts()['Ganado (etapa actual)'])
        self.assertEqual('1', self.flow_counts()['Pedido confirmado'])
        self.assertIn('7 oportunidades creadas en el período', self.page.locator('.crm-flujo').inner_text())

    def test_flow_with_only_archived_opportunities_keeps_losses(self):
        raw = self.flow_fixture()
        for row in raw['C']:
            row[11] = 0
        self.load(raw)
        self.assertEqual('1', self.flow_counts()['Perdidas'])
        self.assertTrue(all(value == '0' for name, value in self.flow_counts().items() if name != 'Perdidas'))
        self.assertIn('100% del flujo creado', self.page.locator('.crm-flujo').inner_text())

    def test_flow_percentages_use_unique_total_and_block_is_near_top(self):
        self.load(self.flow_fixture())
        self.page.select_option('#fVen', '0')
        cards = self.page.locator('.crm-flow-cards > .kpi')
        percentages = {card.locator('.kl').inner_text(): card.locator('.porcentaje-flujo').inner_text()
                       for card in cards.all()}
        self.assertEqual('25% del flujo creado', percentages['En gestión'])
        self.assertEqual('12,5% del flujo creado', percentages['Perdidas'])
        self.assertEqual('12,5% del flujo creado', percentages['No avanzará'])
        self.assertEqual(1, self.page.locator('.crm-flujo').count())
        self.assertTrue(self.page.locator('.crm-flujo').evaluate(
            "e => Boolean(e.compareDocumentPosition([...document.querySelectorAll('h3')].find(h => h.textContent.includes('Evolución mensual'))) & Node.DOCUMENT_POSITION_PRECEDING)"))

    def test_comparison_includes_low_and_zero_closures_without_web(self):
        raw = copy.deepcopy(RAW)
        raw['dict']['VEN'] += ['Bea', 'Cecilia', 'Diana', 'Elena', 'Flor', 'Graciela', 'Helena']
        raw['C'].append([0, 2, 0, 1, 1, 1, 12, -1, 900, 'opportunity', '', 1])
        self.load(raw)
        table = self.page.locator('.crm-comparativa')
        rows = table.locator('tbody tr:not(.tot)')
        self.assertEqual(8, rows.count())
        self.assertEqual(['Ana', '2', '3', '5', '40%'], rows.nth(0).locator('td').all_text_contents())
        self.assertEqual(['Bea', '1', '0', '1', '100%'], rows.nth(1).locator('td').all_text_contents())
        self.assertIn('Sin cierres', rows.nth(2).inner_text())
        self.assertNotIn('Web (Tiendanube)', table.inner_text())
        self.assertEqual(['Total vendedoras', '3', '3', '6', '50%'], table.locator('.tot td').all_text_contents())
        self.page.select_option('#fVen', '0')
        self.assertEqual(0, self.page.locator('.crm-comparativa').count())
        self.page.select_option('#fVen', '')
        self.page.select_option('#fCan', '0')
        self.assertEqual(0, self.page.locator('.crm-comparativa').count())

    def test_seller_role_cannot_see_crm_comparison(self):
        self.load(seller=True)
        self.assertEqual(0, self.page.locator('.crm-comparativa').count())

    def test_seller_reconciliation_explains_orders_vs_won_with_traceable_ids(self):
        raw = copy.deepcopy(RAW)
        raw['O'] = [
            [0, 0, 0, 0, 0, 0, 1000, 10, 1, 101, 501],
            [0, 0, 0, 0, 0, 0, 1000, 11, 1, 0, 502],
            [0, 0, 0, 0, 0, 0, 1000, 12, 1, 102, 503],
            [0, 0, 0, 0, 0, 0, 1000, 12, 1, 101, 504],
        ]
        raw['C'] = [
            [0, 0, 0, 1, 1, 1, 12, -1, 101, 'opportunity', '', 1],
            [0, 0, 1, 0, 2, 0, -1, -1, 102, 'opportunity', '', 1],
            [0, 0, 0, 1, 3, 1, 13, -1, 103, 'opportunity', '', 1],
        ]
        self.load(raw)
        self.page.select_option('#fVen', '0')
        details = self.page.locator('.crm-recon')
        self.assertIn('Por qué 4 órdenes y 2 ganadas no tienen que coincidir', details.locator('summary').inner_text())
        details.locator('summary').click()
        text = details.inner_text()
        self.assertIn('Orden #502', text)
        self.assertIn('Orden #503', text)
        self.assertIn('→ oportunidad #102', text)
        self.assertIn('Oportunidad #101 → Orden #501', text)
        self.assertIn('Oportunidad #103', text)
        self.assertIn('fecha del pedido', text)
        self.assertIn('fecha de cierre de la oportunidad', text)

    def test_monthly_tables_start_collapsed_but_charts_and_comparison_stay_visible(self):
        self.load()
        details = self.page.locator('.evo-detail')
        self.assertGreaterEqual(details.count(), 5)
        for detail in details.all():
            self.assertIsNone(detail.get_attribute('open'))
            self.assertFalse(detail.locator('table').is_visible())
        self.assertTrue(self.page.locator('.crm-comparativa table').is_visible())
        chart = self.page.locator('#app svg').first
        self.assertTrue(chart.is_visible())
        self.assertEqual(0, self.page.locator('.evo-detail svg').count())
        first = details.first
        first.locator('summary').click()
        self.assertTrue(first.locator('table').is_visible())
        first.locator('summary').click()
        self.assertFalse(first.locator('table').is_visible())

    def test_empty_sections_removed_and_visible_sections_numbered_without_gaps(self):
        self.load()
        for seller, channel in [('', ''), ('0', ''), ('', '0')]:
            self.page.select_option('#fVen', seller)
            self.page.select_option('#fCan', channel)
            labels = self.page.locator('.sect').all_text_contents()
            self.assertNotIn('Ventas por industria', labels)
            self.assertNotIn('Ventas por tamaño del cliente', labels)
            self.assertNotIn('Comparación entre años', labels)
            self.assertNotIn('En construcción', self.text())
            numbers = self.page.locator('.secn').all_text_contents()
            self.assertEqual([str(n) for n in range(1, len(numbers)+1)], numbers)

    def test_seller_has_only_requested_sections_and_own_exports(self):
        self.load(self.flow_fixture(), seller=True, objective={'mio': 4000})
        self.assertEqual([
            'Ventas confirmadas — evolución mensual',
            'Flujo de oportunidades creadas — etapa actual',
            'Prendas vendidas — por tipo de orden',
            'Ticket promedio — evolución',
            'Ventas por provincia',
            'Ventas por tipo de producto',
        ], self.page.locator('.sect').all_text_contents())
        self.assertEqual(7, len(self.top_labels()))
        self.assertTrue(self.page.locator('#fVen').is_disabled())
        self.assertEqual(['Ana'], self.page.locator('#fVen option').all_text_contents())
        self.assertEqual(0, self.page.locator('#btnCfg, #fCan, .crm-comparativa').count())
        self.page.select_option('#fPer', 'custom')
        for field, value in [('fFrom', '2026-09-10'), ('fTo', '2026-09-20')]:
            self.page.locator('#'+field).fill(value)
            self.page.locator('#'+field).dispatch_event('change')
        self.page.click('[data-cur="USD"]')
        self.page.evaluate('window.print = () => { window.printCalled = true; }')
        self.page.click('#btnPdf')
        self.assertTrue(self.page.evaluate('window.printCalled'))
        with self.page.expect_download():
            self.page.click('#btnXlsx')
        self.assertEqual('USD', self.export_request['cur'])
        self.assertEqual('0', self.export_request['ven'])
        self.assertEqual('2026-09-10', self.export_request['from'])
        self.assertEqual('2026-09-20', self.export_request['to'])

    def test_objectives_convert_all_amounts_preserving_compliance(self):
        raw = copy.deepcopy(RAW)
        raw['rate'] = 2000  # Goals use the monthly reference when available.
        self.load(raw, objective={'empresa': 6000, 'vendedoras': {'Ana': 4000}})
        bars = self.page.locator('.objbar')
        self.assertIn('de $ 6.000', bars.first.inner_text())
        self.page.click('[data-cur="USD"]')
        self.assertIn('50% de US$ 6', bars.first.inner_text())
        self.assertIn('Vendido US$ 3 · faltan US$ 3', bars.first.inner_text())
        self.page.select_option('#fVen', '0')
        self.assertIn('25% de US$ 4', bars.first.inner_text())
        self.assertIn('Vendido US$ 1 · faltan US$ 3', bars.first.inner_text())
        self.page.click('[data-cur="ARS"]')
        self.assertIn('25% de $ 4.000', bars.first.inner_text())

    def test_seller_objective_uses_usd_and_missing_rate_is_not_zero(self):
        raw = copy.deepcopy(RAW)
        raw['rate'] = 0
        raw['rateMon'] = {}
        self.load(raw, seller=True, objective={'mio': 4000})
        self.page.click('[data-cur="USD"]')
        text = self.page.locator('.objbar').inner_text()
        self.assertIn('25%', text)
        self.assertIn('Sin cotización', text)
        self.assertNotIn('US$ 0', text)

    def test_objective_history_loads_september_after_october_rollover(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 1, 15, tzinfo=timezone.utc))
        raw = copy.deepcopy(RAW)
        raw['meta']['today'] = '2026-10-01'
        self.load(raw, objective={'empresa': 9000, 'vendedoras': {'Ana': 5000}},
                  goals_by_month={'2026-09': {'empresa': 6000, 'vendedoras': {'Ana': 4000}}})
        self.page.click('#btnCfg')
        self.page.locator('#ob_empresa').wait_for()
        self.assertEqual('2026-10', self.page.locator('#cfgMes').input_value())
        self.assertEqual('9000', self.page.locator('#ob_empresa').input_value())
        self.page.select_option('#cfgMes', '2026-09')
        self.page.wait_for_function("document.getElementById('ob_empresa')?.value === '6000'")
        self.assertEqual('2026-09', self.page.locator('#cfgMes').input_value())
        self.assertEqual('4000', self.page.locator('#ob_Ana').input_value())
        self.page.select_option('#cfgMes', '2026-10')
        self.page.wait_for_function("document.getElementById('ob_empresa')?.value === '9000'")
        self.assertIsNone(self.saved_goals)

    def test_period_loads_historical_objectives_sales_and_exchange_rate(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 1, 15, tzinfo=timezone.utc))
        raw = copy.deepcopy(RAW)
        raw['meta']['today'] = '2026-10-01'
        raw['rateMon']['2026-10'] = 2000
        self.load(raw, objective={'empresa': 9000, 'vendedoras': {'Ana': 5000}},
                  goals_by_month={'2026-09': {'empresa': 6000, 'vendedoras': {'Ana': 4000}}})
        self.page.select_option('#fPer', 'lastmon')
        self.page.wait_for_function("document.querySelector('.objbar')?.textContent.includes('6.000')")
        self.assertIn('Objetivo de Sep 2026', self.text())
        self.assertIn('50% de $ 6.000', self.page.locator('.objbar').first.inner_text())
        self.assertIn('Vendido $ 3.000', self.page.locator('.objbar').first.inner_text())
        self.page.click('[data-cur="USD"]')
        self.assertIn('50% de US$ 6', self.page.locator('.objbar').first.inner_text())
        self.page.select_option('#fVen', '0')
        self.assertIn('25% de US$ 4', self.page.locator('.objbar').inner_text())
        self.page.select_option('#fPer', 'mtd')
        self.assertIn('Oct 2026', self.text())
        self.assertIn('0% de US$ 3', self.page.locator('.objbar').inner_text())

    def test_seller_period_uses_own_historical_goal(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 1, 15, tzinfo=timezone.utc))
        raw = copy.deepcopy(RAW)
        raw['meta']['today'] = '2026-10-01'
        self.load(raw, seller=True, objective={'mio': 9000},
                  goals_by_month={'2026-09': {'mio': 4000}})
        self.page.select_option('#fPer', 'lastmon')
        self.page.wait_for_function("document.querySelector('.objbar')?.textContent.includes('4.000')")
        self.assertIn('Tu objetivo de Sep 2026', self.text())
        self.assertIn('25% de $ 4.000', self.page.locator('.objbar').inner_text())

    def test_multimonth_period_keeps_goals_separate_and_respects_partial_dates(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 15, 15, tzinfo=timezone.utc))
        raw = copy.deepcopy(RAW)
        raw['meta'].update(today='2026-10-15', maxDate='2026-10-15')
        raw['dict']['MON'].append('2026-10')
        raw['O'].append([1, 0, 0, 0, 0, 0, 900, 31, 1, 103, 503])
        self.load(raw, objective={'empresa': 9000, 'vendedoras': {}},
                  goals_by_month={'2026-09': {'empresa': 6000, 'vendedoras': {}}})
        self.page.select_option('#fPer', 'all')
        self.page.wait_for_function("document.querySelectorAll('.objbar').length === 2")
        self.assertIn('50% de $ 6.000', self.page.locator('.objbar').nth(0).inner_text())
        self.assertIn('10% de $ 9.000', self.page.locator('.objbar').nth(1).inner_text())
        self.page.select_option('#fPer', 'custom')
        self.page.locator('#fFrom').fill('2026-09-12')
        self.page.locator('#fFrom').dispatch_event('change')
        self.page.locator('#fTo').fill('2026-09-30')
        self.page.locator('#fTo').dispatch_event('change')
        self.assertEqual(1, self.page.locator('.objbar').count())
        self.assertIn('33% de $ 6.000', self.page.locator('.objbar').inner_text())

    def test_period_without_goal_does_not_reuse_current_goal(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 1, 15, tzinfo=timezone.utc))
        raw = copy.deepcopy(RAW)
        raw['meta']['today'] = '2026-10-01'
        self.load(raw, objective={'empresa': 9000, 'vendedoras': {}},
                  goals_by_month={'2026-09': {}})
        self.page.select_option('#fPer', 'lastmon')
        self.page.wait_for_function("!document.getElementById('app').textContent.includes('Cargando objetivos')")
        self.assertEqual(0, self.page.locator('.objbar').count())

    def test_objective_history_survives_new_year_and_months_without_sales(self):
        self.page.clock.set_fixed_time(datetime(2027, 1, 1, 15, tzinfo=timezone.utc))
        raw = copy.deepcopy(RAW)
        raw['meta']['today'] = '2027-01-01'
        raw['meta']['day0'] = '2025-11-01'
        self.load(raw)
        self.page.click('#btnCfg')
        self.page.locator('#cfgMes').wait_for()
        months = self.page.locator('#cfgMes option').evaluate_all('(options) => options.map(o => o.value)')
        self.assertEqual('2025-11', months[0])
        self.assertIn('2025-12', months)
        self.assertIn('2026-09', months)
        self.assertIn('2026-12', months)
        self.assertEqual('2027-04', months[-1])
        self.assertEqual(len(months), len(set(months)))
        self.assertEqual('2027-01', self.page.locator('#cfgMes').input_value())

    def test_usd_objective_editor_saves_ars_and_keeps_draft_when_toggling(self):
        self.load(objective={'empresa': 6000, 'vendedoras': {'Ana': 4000}})
        self.page.click('[data-cur="USD"]')
        self.page.click('#btnCfg')
        field = self.page.locator('#ob_empresa')
        field.wait_for()
        self.assertEqual('6', field.input_value())
        field.fill('8.5')
        self.page.click('[data-cur="ARS"]')
        self.assertEqual('8500', field.input_value())
        self.page.click('[data-cur="USD"]')
        self.assertEqual('8.5', field.input_value())
        self.page.click('#objSave')
        self.page.wait_for_function("document.getElementById('objMsg').textContent.includes('verificado')")
        self.assertEqual([{'alcance': 'empresa', 'objetivo': 8500}, {'alcance': 'Ana', 'objetivo': 4000},
                          {'alcance': '__tiendanube__', 'objetivo': 0}], self.saved_goals)
        self.page.click('#cfgBack')
        self.assertIn('de US$ 9', self.page.locator('.objbar').first.inner_text())


    def setup_tn(self, stale=False, raw=None, start_view='', start_channel='', period='d30', objective=None, tn_data=None, goals_by_month=None, users=None):
        self.load(raw=raw, objective=objective, goals_by_month=goals_by_month, users=users)
        self.page.select_option('#fPer', period)
        self.page.select_option('#fVen', start_view)
        self.page.select_option('#fCan', start_channel)
        self.odoo_summary = self.page.locator('#app > div > .kpis').first.locator('.kv').all_text_contents()
        data = {'ok': True, 'configured': True, 'storeId': '1301166', 'updatedAt': '2026-09-29T15:00:00Z',
                'summary': {'orders': 3, 'paid': 1, 'pending': 1, 'cancelled': 1, 'refunded': 0, 'partial': 0,
                            'other': 0, 'paidUnits': 2},
                'daily': [{'date': '2026-09-15', 'orders': 3, 'paid': 1, 'paidTotalArs': 5000, 'missingAmounts': 0}],
                'abandoned': {'count': 7, 'from': '2026-09-01', 'to': '2026-09-23', 'partialCoverage': False, 'noCoverage': False},
                'products': [{'name': '<img src=x onerror=alert(1)>', 'units': 2}],
                'origins': [{'name': 'mobile', 'orders': 3}],
                'commerce': {'discountOrders':1,'discountKnown':1,'couponOrders':0,'couponKnown':1,
                             'awaitingDispatch':1,'awaitingDispatch7Days':1,'shippingKnown':1,
                             'discountDaily':[{'date':'2026-09-15','paid':1,'paidTotalArs':1000,'missingAmounts':0}],
                             'providers':[{'name':'Transferencia','orders':1}],
                             'shipping':[{'name':'unpacked','orders':1}]}}
        if tn_data:
            data.update(tn_data)
        if stale:
            data.update(stale=True, warning='Error temporal de Tiendanube.')
        def handler(route):
            payload=route.request.post_data_json
            if payload.get('op') != 'tiendanube':
                route.fallback()
                return
            self.tn_request=payload
            route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(data))
        self.page.route('http://dashboard.test/api',handler)
        self.page.select_option('#fCan', 'tiendanube')
        self.page.get_by_text('Importe de pedidos pagados',exact=True).wait_for()

    def test_tiendanube_is_separate_scoped_and_escapes_product_names(self):
        self.setup_tn()
        text=self.text()
        self.assertIn('Visitas pendientes de integración',text)
        self.assertIn('7',text)
        self.assertEqual('synthetic-test-token',self.tn_request['token'])
        self.assertNotIn('rol',self.tn_request)
        self.assertTrue(self.page.locator('#fVen').is_visible())
        self.assertTrue(self.page.locator('#fVen').is_disabled())
        self.assertEqual('tiendanube', self.page.locator('#fCan').input_value())
        self.assertTrue(self.page.locator('#fCan').is_visible())
        self.assertFalse(self.page.locator('#fCan').is_disabled())
        self.assertTrue(self.page.locator('#btnXlsx').is_disabled())
        self.assertEqual(0,self.page.locator('#app img').count())
        self.assertIn('<img src=x onerror=alert(1)>',text)
        self.assertNotIn('Flujo de oportunidades',text)
        self.page.click('#tnBack')
        self.assertTrue(self.page.locator('#fVen').is_visible())
        self.assertFalse(self.page.locator('#btnXlsx').is_disabled())
        self.assertIn('Ventas confirmadas',self.text())
        self.assertEqual(self.odoo_summary, self.page.locator('#app > div > .kpis').first.locator('.kv').all_text_contents(), 'Consultar Tiendanube no debe sumar ventas, órdenes ni unidades al consolidado Odoo')

    def test_tiendanube_currency_conversion_uses_existing_historical_rate(self):
        self.setup_tn()
        self.page.click('[data-cur="USD"]')
        self.assertIn('US$ 5',self.text())
        self.page.locator('.tn-evolution summary').click()
        self.assertIn('US$ 5', self.page.locator('.tn-evolution table').inner_text())
        self.assertIn('US$ 1', self.page.locator('.tn-commerce').inner_text())

    def test_tiendanube_labels_and_period_values_are_visible_on_chart(self):
        self.setup_tn(tn_data={'daily':[{'date':'2026-09-15','orders':3,'paid':1,
                                         'paidTotalArs':5000.75,'missingAmounts':0}]})
        self.assertIn('Ticket promedio de pedidos pagados',self.text())
        self.assertIn('Unidades promedio por pedido pagado',self.text())
        chart=self.page.locator('.tn-evolution svg')
        self.assertIn('$ 5,0 K',chart.text_content())
        self.assertEqual(13,chart.locator('text[text-anchor="middle"]').count(),
                         'Cada período muestra importe, pedidos y fecha; el último compara con el anterior')
        self.assertIn('-100%',chart.text_content())
        self.assertEqual(0,self.page.locator('.tn-period-values').count())
        self.page.locator('.tn-evolution summary').click()
        self.assertIn('$ 5.000,75',self.page.locator('.tn-evolution table').inner_text())
        self.assertIn('panel de administración',self.text())

    def test_tiendanube_monthly_chart_shows_month_over_month_change(self):
        raw=copy.deepcopy(RAW)
        raw['meta']['day0']='2026-03-01'
        raw['meta']['dateFrom']='2026-03-01'
        self.setup_tn(raw=raw,period='all',tn_data={
            'daily':[{'date':'2026-03-15','orders':1,'paid':1,'paidTotalArs':100,'missingAmounts':0},
                     {'date':'2026-04-15','orders':1,'paid':1,'paidTotalArs':150,'missingAmounts':0}],
            'summary':{'orders':2,'paid':2,'pending':0,'cancelled':0,'refunded':0,'partial':0,
                       'other':0,'paidUnits':2}})
        self.page.select_option('#fPer','all')
        chart=self.page.locator('.tn-evolution svg')
        self.assertIn('Mar 26',chart.text_content())
        self.assertIn('Abr 26',chart.text_content())
        self.assertIn('+50%',chart.text_content())
        self.assertEqual(0,self.page.locator('.tn-period-values').count())

    def test_tiendanube_year_to_date_includes_january_and_february(self):
        self.setup_tn(tn_data={'daily':[
            {'date':'2026-01-15','orders':1,'paid':1,'paidTotalArs':100,'paidUnits':2,'missingAmounts':0},
            {'date':'2026-02-15','orders':1,'paid':1,'paidTotalArs':150,'paidUnits':3,'missingAmounts':0}]})
        self.page.select_option('#fPer','ytd')
        self.assertEqual('2026-01-01',self.page.locator('#fFrom').input_value())
        self.assertEqual('2026-01-01',self.page.locator('#fFrom').get_attribute('min'))
        self.page.locator('.tn-evolution svg').get_by_text('Ene 26').wait_for()
        self.assertIn('Feb 26',self.page.locator('.tn-evolution svg').text_content())
        self.assertEqual('2026-01-01',self.tn_request['from'])

    def test_tiendanube_weeks_start_monday_and_first_week_is_partial(self):
        self.setup_tn()
        self.page.select_option('#fPer','custom')
        self.page.locator('#fFrom').fill('2026-09-01')
        self.page.locator('#fFrom').dispatch_event('change')
        self.page.locator('#fTo').fill('2026-09-23')
        self.page.locator('#fTo').dispatch_event('change')
        chart=self.page.locator('.tn-evolution svg')
        self.assertIn('01/09–06/09',chart.text_content())
        self.assertIn('07/09–13/09',chart.text_content())
        self.assertIn('21/09–23/09',chart.text_content())

    def test_tiendanube_ticket_and_units_average_monthly_and_weekly(self):
        self.setup_tn(tn_data={
            'summary':{'orders':2,'paid':2,'pending':0,'cancelled':0,'refunded':0,'partial':0,'other':0,'paidUnits':5},
            'daily':[{'date':'2026-09-15','orders':2,'paid':2,'paidTotalArs':100,'paidUnits':5,'missingAmounts':0}]})
        monthly=self.page.locator('.tn-averages svg').first
        self.assertIn('$ 50',monthly.text_content())
        self.assertIn('2,5',monthly.locator('.chart-count-label').all_text_contents())
        self.page.locator('.tn-averages summary').click()
        weekly=self.page.locator('.tn-averages svg').nth(1)
        self.assertIn('14/09–20/09',weekly.text_content())
        self.assertIn('2,5',weekly.locator('.chart-count-label').all_text_contents())

    def test_monthly_chart_labels_do_not_overlap_each_other_or_the_line(self):
        self.load()
        result=self.page.evaluate('''() => {
          const amounts=[43.1,39.8,28.4,25.9,17.1,24.3,36.9];
          const counts=[136,112,91,74,73,93,115];
          const points=amounts.map((v,i)=>({lbl:['Mar','Abr','May','Jun','Jul','Ago','Sep'][i],v:v*1e6,n:counts[i]}));
          const holder=document.createElement('div');
          holder.innerHTML=window.__chartSVG(points,{line:true,delta:true,h:265,fmt:window.__chartMoney});
          document.body.appendChild(holder);
          const svg=holder.querySelector('svg');
          const values=[...svg.querySelectorAll('.chart-value-label')];
          const orders=[...svg.querySelectorAll('.chart-count-label')];
          const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
          const labels=[...values,...orders];
          const conflicts=[];
          labels.forEach((a,i)=>labels.slice(i+1).forEach(b=>{
            if(overlap(a.getBBox(),b.getBBox()))conflicts.push([a.textContent,b.textContent]);
          }));
          const path=svg.querySelector('path');
          const crossings=[];
          for(let d=0;d<=path.getTotalLength();d+=1){
            const p=path.getPointAtLength(d);
            labels.forEach(label=>{
              const b=label.getBBox();
              if(p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height)
                crossings.push(label.textContent);
            });
          }
          return {values:values.length,orders:orders.length,conflicts,crossings,
            titles:svg.querySelectorAll('title').length};
        }''')
        self.assertEqual(7,result['values'])
        self.assertEqual(7,result['orders'])
        self.assertEqual([],result['conflicts'])
        self.assertEqual([],result['crossings'])
        self.assertEqual(0,result['titles'])

    def test_tiendanube_discount_detail_traces_coupon_and_escapes_code(self):
        self.setup_tn(tn_data={'commerce':{'discountOrders':2,'discountKnown':2,'couponOrders':1,'couponKnown':2,
            'awaitingDispatch':0,'awaitingDispatch7Days':0,'shippingKnown':0,
            'discountDaily':[{'date':'2026-09-15','paid':2,'paidTotalArs':15,'missingAmounts':0}],
            'providers':[],'shipping':[],
            'discountCases':[{'orderId':'1','orderNumber':'17','date':'2026-09-15','couponId':'19',
                'couponCodes':['<img src=x onerror=alert(1)>'],'discountArs':10,'couponDiscountArs':10},
                {'orderId':'2','orderNumber':'18','date':'2026-09-15','couponId':None,
                'couponCodes':[],'discountArs':5,'couponDiscountArs':0}]}})
        self.page.get_by_text('Ver pedidos y códigos de cupón').click()
        detail=self.page.locator('.tn-detail').last.inner_text()
        self.assertIn('#17',detail)
        self.assertIn('Sin cupón',detail)
        self.assertIn('<img src=x onerror=alert(1)>',detail)
        self.assertEqual(0,self.page.locator('#app img').count())

    def test_tiendanube_month_default_sends_current_range_and_commerce_does_not_double_discount(self):
        self.setup_tn()
        self.assertEqual('mtd',self.page.locator('#fPer').input_value())
        self.assertEqual('2026-09-01',self.tn_request['from'])
        self.assertEqual('2026-09-23',self.tn_request['to'])
        self.assertIn('$ 1.000',self.page.locator('.tn-commerce').inner_text())
        self.assertIn('1 creados hace 7 días o más',self.page.locator('.tn-commerce').inner_text())
        self.assertIn('Transferencia',self.page.locator('.tn-commerce-charts').inner_text())
        self.assertIn('Sin empaquetar',self.page.locator('.tn-commerce-charts').inner_text())
        self.assertEqual('$ 5.000',self.page.locator('#app > div > .kpis .kv').first.inner_text())

    def test_tiendanube_commerce_missing_data_and_names_are_safe(self):
        self.setup_tn(tn_data={'commerce':{'discountOrders':0,'discountKnown':0,'couponOrders':0,'couponKnown':0,
            'awaitingDispatch':0,'awaitingDispatch7Days':0,'shippingKnown':0,
            'discountDaily':[{'date':'2026-09-15','paid':1,'paidTotalArs':0,'missingAmounts':1}],
            'providers':[{'name':'<img src=x onerror=alert(1)>','orders':1}], 'shipping':[{'name':'unknown','orders':1}]}})
        self.assertEqual(['Sin dato completo','Sin dato','Sin dato','Sin dato'],self.page.locator('.tn-commerce .kv').all_text_contents())
        self.assertEqual(0,self.page.locator('#app img').count())
        self.assertIn('Sin estado informado',self.page.locator('.tn-commerce-charts').inner_text())

    def test_tiendanube_hides_existing_objectives_and_restores_them_in_general(self):
        self.setup_tn(objective={'empresa': 6000, 'vendedoras': {'Ana': 4000}})
        self.assertEqual(0, self.page.locator('.objbar').count())
        self.assertNotIn('Objetivo de', self.text())
        self.page.click('#tnBack')
        self.assertGreater(self.page.locator('.objbar').count(), 0)
        self.assertIn('de $ 6.000', self.page.locator('.objbar').first.inner_text())

    def test_tiendanube_goal_is_separate_from_yeni_and_can_be_edited_from_channel(self):
        users = [{'rol': 'vendedora', 'activo': True, 'vendedora': name,
                  'nombre': name, 'usuario': name.lower()} for name in ('Ana', 'Yeni')]
        self.setup_tn(period='mtd', users=users,
                      objective={'empresa': 0, 'tiendanube': 6000, 'vendedoras': {'Yeni': 7000}})
        self.assertIn('83% de $ 6.000', self.page.locator('.objbar').inner_text())
        self.assertIn('Vendido $ 5.000', self.page.locator('.objbar').inner_text())
        self.page.click('#btnCfg')
        self.assertEqual('7000', self.page.locator('#ob_Yeni').input_value())
        self.assertEqual('6000', self.page.locator('#ob___tiendanube__').input_value())
        self.page.locator('#ob___tiendanube__').fill('10000')
        self.page.click('#objSave')
        self.page.wait_for_function("document.getElementById('objMsg').textContent.includes('verificado')")
        self.assertIn({'alcance': 'Yeni', 'objetivo': 7000}, self.saved_goals)
        self.assertIn({'alcance': '__tiendanube__', 'objetivo': 10000}, self.saved_goals)
        self.page.click('#cfgBack')
        self.assertEqual('tiendanube', self.page.locator('#fCan').input_value())
        self.assertIn('50% de $ 10.000', self.page.locator('.objbar').inner_text())

    def test_tiendanube_goal_uses_selected_month_and_skips_incomplete_amounts(self):
        self.setup_tn(period='lastmon', objective={'tiendanube': 10000},
                      goals_by_month={'2026-08': {'tiendanube': 8000}},
                      tn_data={'daily': [{'date': '2026-08-12', 'orders': 1, 'paid': 1,
                                          'paidTotalArs': 4000, 'missingAmounts': 0}]})
        self.page.select_option('#fPer', 'lastmon')
        self.page.wait_for_function("document.querySelector('.objbar')?.textContent.includes('8.000')")
        self.assertIn('Objetivo Tienda Nube · Ago 2026', self.text())
        self.assertIn('50% de $ 8.000', self.page.locator('.objbar').inner_text())
        self.page.click('[data-cur="USD"]')
        self.assertIn('50% de US$ 8', self.page.locator('.objbar').inner_text())
        self.page.select_option('#fPer', 'mtd')
        self.assertIn('0% de US$ 10', self.page.locator('.objbar').inner_text())

    def test_tiendanube_goal_does_not_show_partial_compliance(self):
        self.setup_tn(period='mtd', objective={'tiendanube': 6000},
                      tn_data={'daily': [{'date': '2026-09-15', 'orders': 2, 'paid': 2,
                                          'paidTotalArs': 5000, 'missingAmounts': 1}]})
        self.assertEqual(0, self.page.locator('.objbar').count())
        self.assertIn('no se calcula un cumplimiento parcial', self.text())

    def test_tiendanube_evolution_fills_empty_days_and_keeps_correct_ticket(self):
        self.setup_tn()
        self.page.select_option('#fPer', 'custom')
        for field, value in [('fFrom', '2026-09-14'), ('fTo', '2026-09-16')]:
            self.page.locator('#'+field).fill(value)
            self.page.locator('#'+field).dispatch_event('change')
        self.page.get_by_text('Importe de pedidos pagados', exact=True).wait_for()
        self.page.locator('.tn-evolution summary').click()
        rows=self.page.locator('.tn-evolution tbody tr')
        self.assertEqual(3, rows.count())
        self.assertEqual(['0', '0', '$ 0,00', 'Sin pedidos pagados'], rows.nth(0).locator('td').all_text_contents()[1:])
        self.assertEqual(['3', '1', '$ 5.000,00', '$ 5.000,00'], rows.nth(1).locator('td').all_text_contents()[1:])
        self.assertEqual(['0', '0', '$ 0,00', 'Sin pedidos pagados'], rows.nth(2).locator('td').all_text_contents()[1:])
        self.assertIn('2 u. · 100%', self.page.locator('.tn-products').inner_text())

    def test_tiendanube_missing_currency_rate_hides_incomplete_amount_chart(self):
        raw=copy.deepcopy(RAW)
        raw['rateMon']={}
        raw['rateDay']={}
        self.setup_tn(raw=raw)
        self.page.click('[data-cur="USD"]')
        self.assertIn('Sin dato completo',self.text())
        self.assertIn('Pedidos pagados · importe sin datos completos', self.page.locator('.tn-evolution').inner_text())
        self.page.locator('.tn-evolution summary').click()
        rows=self.page.locator('.tn-evolution tbody tr').filter(has_text='Sin dato completo')
        self.assertEqual(1,rows.count())
        self.assertNotIn('US$ 0', rows.inner_text())

    def test_tiendanube_product_share_uses_all_units_not_only_top_ten(self):
        self.setup_tn(tn_data={'products':[{'name':'Producto de prueba','units':1}]})
        self.assertIn('1 u. · 50%',self.page.locator('.tn-products').inner_text())

    def test_tiendanube_empty_period_has_no_nan_or_fake_ticket(self):
        self.setup_tn(tn_data={'daily':[], 'summary':{'orders':0,'paid':0,'pending':0,'cancelled':0,'refunded':0,'partial':0,'other':0,'paidUnits':0}, 'products':[], 'origins':[],
            'commerce':{'discountOrders':0,'discountKnown':0,'couponOrders':0,'couponKnown':0,'awaitingDispatch':0,'awaitingDispatch7Days':0,'shippingKnown':0,'discountDaily':[],'providers':[],'shipping':[]}})
        self.assertIn('Sin pedidos pagados',self.text())
        self.assertIn('Sin datos para este período.',self.text())
        self.assertNotIn('NaN',self.text())
        self.assertNotIn('Infinity',self.text())

    def test_tiendanube_stale_data_is_explicit(self):
        self.setup_tn(stale=True)
        self.assertIn('Última consulta válida',self.text())
        self.assertIn('Error temporal de Tiendanube',self.text())

    def test_tiendanube_hidden_for_sellers(self):
        self.load(seller=True)
        self.assertEqual(0,self.page.locator('#fVen option[value=tiendanube]').count())
        self.assertEqual(0,self.page.locator('#fCan').count())
        self.assertTrue(self.page.locator('#fVen').is_disabled())

    def test_tiendanube_mobile_has_no_horizontal_overflow(self):
        self.setup_tn()
        self.page.set_viewport_size({'width':390,'height':844})
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        self.assertTrue(self.page.locator('#fCan').is_visible())
        self.assertFalse(self.page.locator('#fPer').is_visible())
        self.page.select_option('#fCan', '0')
        self.assertIn('Ventas confirmadas', self.text())

    def test_tiendanube_and_odoo_preserve_independent_filters(self):
        self.setup_tn(start_view='0', start_channel='0', period='mtd')
        self.assertEqual('mtd', self.page.locator('#fPer').input_value())
        self.page.select_option('#fPer', 'd90')
        self.page.get_by_text('Importe de pedidos pagados', exact=True).wait_for()
        self.page.select_option('#fCan', '0')
        self.assertEqual('0', self.page.locator('#fVen').input_value())
        self.assertEqual('mtd', self.page.locator('#fPer').input_value())
        self.assertEqual('0', self.page.locator('#fCan').input_value())
        self.assertEqual(self.odoo_summary, self.page.locator('#app > div > .kpis').first.locator('.kv').all_text_contents())
        self.page.select_option('#fCan', 'tiendanube')
        self.page.get_by_text('Importe de pedidos pagados', exact=True).wait_for()
        self.assertEqual('d90', self.page.locator('#fPer').input_value())
        self.assertNotIn('ven', self.tn_request)
        self.assertNotIn('can', self.tn_request)
        self.page.click('#tnBack')
        self.assertEqual('', self.page.locator('#fVen').input_value())
        self.assertEqual('', self.page.locator('#fCan').input_value())
        self.assertEqual('2', self.page.locator('#app > div > .kpis').first.locator('.kv').nth(2).inner_text())

    def test_tiendanube_available_without_web_seller_in_odoo(self):
        raw=copy.deepcopy(RAW)
        raw['dict']['VEN']=['Ana']
        for key in ('O', 'L', 'P', 'C'):
            raw[key]=[row for row in raw[key] if row[1]==0]
        self.setup_tn(raw=raw)
        self.assertIn('Importe de pedidos pagados', self.text())
        self.assertEqual(['Todas', 'Ana'], self.page.locator('#fVen option').all_text_contents())
        self.assertEqual(['Todos', 'Venta directa', 'Tiendanube'], self.page.locator('#fCan option').all_text_contents())

    def test_tiendanube_reset_keeps_view_and_restores_odoo_afterwards(self):
        self.setup_tn(period='mtd')
        self.page.select_option('#fPer', 'd90')
        self.page.click('#reset')
        self.page.get_by_text('Importe de pedidos pagados', exact=True).wait_for()
        self.assertEqual('tiendanube', self.page.locator('#fCan').input_value())
        self.assertEqual('mtd', self.page.locator('#fPer').input_value())
        self.page.select_option('#fCan', '')
        self.assertEqual('mtd', self.page.locator('#fPer').input_value())
        self.assertEqual(self.odoo_summary, self.page.locator('#app > div > .kpis').first.locator('.kv').all_text_contents())


if __name__ == '__main__':
    unittest.main(verbosity=2)
