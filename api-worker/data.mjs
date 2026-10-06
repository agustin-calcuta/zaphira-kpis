import {argentinaDate} from './auth.mjs';

export async function readDataset(db) {
  const rows = (await db.prepare('SELECT payload FROM dataset ORDER BY id').all()).results;
  if (!rows.length) return {};
  return JSON.parse(rows.map(row => row.payload).join(''));
}

export async function writeDataset(db, raw) {
  const json = JSON.stringify(raw);
  const statements = [db.prepare('DELETE FROM dataset')];
  for (let i = 0, id = 0; i < json.length; i += 7000, id++) {
    statements.push(db.prepare('INSERT INTO dataset (id,payload,updated_at) VALUES (?,?,datetime(\'now\'))')
      .bind(id, json.slice(i, i + 7000)));
  }
  await db.batch(statements);
}

export async function readObjectives(db, mes) {
  const rows = (await db.prepare('SELECT alcance,objetivo FROM objetivos WHERE mes = ?').bind(mes).all()).results;
  const result = {empresa: 0, vendedoras: {}};
  for (const row of rows) {
    if (row.alcance === 'empresa') result.empresa = Number(row.objetivo) || 0;
    else result.vendedoras[row.alcance] = Number(row.objetivo) || 0;
  }
  return result;
}

export async function objectives(db, user, mesInput) {
  const mes = /^\d{4}-\d{2}$/.test(String(mesInput || '')) ? mesInput : argentinaDate(new Date(), 'yyyy-MM');
  const obj = await readObjectives(db, mes);
  if (user.rol !== 'direccion') {
    return {ok: true, mes, objetivos: {empresa: 0, vendedoras: {}}, mio: obj.vendedoras[user.vendedora] || 0};
  }
  return {ok: true, mes, objetivos: obj};
}

export async function saveObjectives(db, input) {
  const mes = String(input.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) return {ok: false, error: 'El mes tiene que venir como AAAA-MM.'};
  const desired = new Map();
  for (const row of Array.isArray(input.filas) ? input.filas : []) {
    const scope = String(row.alcance || '').trim(), amount = Number(row.objetivo) || 0;
    if (scope && Number.isFinite(amount) && amount > 0) desired.set(scope, amount);
  }
  const statements = [db.prepare('DELETE FROM objetivos WHERE mes = ?').bind(mes)];
  for (const [scope, amount] of desired) {
    statements.push(db.prepare('INSERT INTO objetivos (mes,alcance,objetivo) VALUES (?,?,?)').bind(mes, scope, amount));
  }
  await db.batch(statements);
  const confirmed = await readObjectives(db, mes);
  return {ok: true, mes, guardadas: desired.size, objetivos: confirmed};
}

export function trimToSeller(raw, seller) {
  const index = raw.dict?.VEN?.indexOf(seller) ?? -1;
  if (index < 0) return null;
  const onlyMine = rows => (rows || []).filter(row => row[1] === index)
    .map(row => { const copy = row.slice(); copy[1] = 0; return copy; });
  return {...raw, O: onlyMine(raw.O), L: onlyMine(raw.L), P: onlyMine(raw.P),
    C: onlyMine(raw.C), dict: {...raw.dict, VEN: [seller]}};
}

export async function dataResponse(db, user) {
  const mes = argentinaDate(new Date(), 'yyyy-MM');
  const obj = await readObjectives(db, mes);
  const raw = await readDataset(db);
  if (user.rol === 'direccion') return {ok: true, objetivo: {mes, empresa: obj.empresa, vendedoras: obj.vendedoras}, raw};
  if (!raw.dict) return {ok: true, objetivo: {mes, mio: 0}, raw: {}};
  const recortado = trimToSeller(raw, user.vendedora);
  if (!recortado) return {ok: false, code: 'sin_vendedora', error: 'No encontramos tus ventas.', vendedora: user.vendedora};
  return {ok: true, objetivo: {mes, mio: obj.vendedoras[user.vendedora] || 0}, raw: recortado};
}
