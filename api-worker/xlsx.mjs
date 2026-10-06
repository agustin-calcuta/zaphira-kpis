import {zipSync, strToU8} from 'fflate';
import {argentinaDate} from './auth.mjs';

const xml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const column = index => {
  let n = index + 1, out = '';
  while (n) { out = String.fromCharCode(65 + (n - 1) % 26) + out; n = Math.floor((n - 1) / 26); }
  return out;
};
function worksheet(rows) {
  const body = rows.map((row, ri) => `<row r="${ri + 1}">` + row.map((value, ci) => {
    const ref = `${column(ci)}${ri + 1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  }).join('') + '</row>').join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
function workbook(summary, orders) {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Resumen KPIs" sheetId="1" r:id="rId1"/><sheet name="Órdenes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': worksheet(summary),
    'xl/worksheets/sheet2.xml': worksheet(orders)
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, strToU8(contents)])), {level: 6});
}
function dayNum(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
const noFilter = v => v === undefined || v === null || v === '' || v === 'all' || v === -1 || v === '-1';

export function xlsxResponse(raw, input) {
  if (!raw?.O || !raw?.dict) return {ok: false, error: 'Todavía no hay datos sincronizados para exportar.'};
  const dict = raw.dict, cur = String(input.cur || 'ARS').toUpperCase();
  const base = raw.meta?.day0 ? dayNum(raw.meta.day0) : 0;
  const fromOff = noFilter(input.from) ? null : dayNum(input.from) - base;
  const toOff = noFilter(input.to) ? null : dayNum(input.to) - base;
  const match = (value, filter) => noFilter(filter) || Number(value) === Number(filter);
  const selected = raw.O.filter(row => (fromOff === null || row[7] >= fromOff) &&
    (toOff === null || row[7] <= toOff) && match(row[1], input.ven) && match(row[2], input.can));
  const orders = [['#', 'Fecha', 'Mes', 'Vendedora', 'Canal', 'Tipo', 'Provincia', 'Industria', `Total c/IVA (${cur})`]];
  let total = 0;
  for (const [i, row] of selected.entries()) {
    const rate = raw.rateDay?.[row[7]] || raw.rateMon?.[dict.MON[row[0]]] || raw.rate || 0;
    const amount = Math.round(cur === 'USD' ? (rate ? row[6] / rate : 0) : row[6]);
    total += amount;
    const date = row[7] == null || !raw.meta?.day0 ? '' : new Date((base + row[7]) * 86400000)
      .toISOString().slice(0, 10).split('-').reverse().join('/');
    orders.push([i + 1, date, dict.MON[row[0]], dict.VEN[row[1]], dict.CAN[row[2]],
      dict.TIPO[row[3]], dict.PROV[row[4]], dict.IND[row[5]], amount]);
  }
  const period = fromOff === null && toOff === null ? 'Todo el período' :
    `${noFilter(input.from) ? 'hasta ' : String(input.from).split('-').reverse().join('/')} — ${noFilter(input.to) ? 'en adelante' : String(input.to).split('-').reverse().join('/')}`;
  const now = argentinaDate();
  const summary = [['Generado', now], ['Período', period],
    ['Moneda', cur + (cur === 'USD' ? ' (oficial del día de cada venta)' : '')],
    ['Pull de datos', raw.pull || ''], ['Órdenes filtradas', selected.length], ['Total c/IVA (' + cur + ')', total]];
  const bytes = workbook(summary, orders);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.slice(i, i + 32768));
  const [day, month, year, hour, minute] = now.match(/\d+/g);
  const filename = `Zaphira_Dashboard_Ventas_${year}${month}${day}_${hour}${minute}.xlsx`;
  return {ok: true, filename, b64: btoa(binary)};
}
