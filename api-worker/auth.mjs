import {createHash} from 'node:crypto';

const encoder = new TextEncoder();
const GENERIC_PASSWORD = 'Zaphira2026';
const TOKEN_HOURS = 12;

export function argentinaDate(now = new Date(), format = 'dd/MM/yyyy HH:mm') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(x => [x.type, x.value]));
  if (format === 'yyyy-MM') return `${parts.year}-${parts.month}`;
  if (format === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}

export async function legacyHash(password, salt) {
  // WebCrypto's 1000 awaited digests take many seconds at the edge. The Node
  // hash implementation is supported natively by Workers and yields the same bytes.
  let bytes = createHash('sha256').update(`${salt}|${password}`, 'utf8').digest();
  for (let i = 1; i < 1000; i++) bytes = createHash('sha256').update(bytes).digest();
  return bytes.toString('hex');
}

function same(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signature(payload, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export async function signToken(user, secret) {
  const exp = Date.now() + TOKEN_HOURS * 3600_000;
  const payload = [user.usuario, user.rol, user.vendedora || '', exp].join('|');
  const b64 = btoa(String.fromCharCode(...encoder.encode(payload)))
    .replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64}.${await signature(b64, secret)}`;
}

export async function verifyToken(token, secret) {
  try {
    const [b64, mac, extra] = String(token || '').split('.');
    if (!b64 || !mac || extra || !same(mac, await signature(b64, secret))) return null;
    const bytes = Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const [usuario, rol, vendedora, expiry, more] = new TextDecoder().decode(bytes).split('|');
    if (!usuario || !rol || more || !Number.isFinite(Number(expiry)) || Number(expiry) < Date.now()) return null;
    return {usuario, rol, vendedora};
  } catch { return null; }
}

export async function currentUser(db, token, secret) {
  const claim = await verifyToken(token, secret);
  if (!claim) return null;
  const user = await db.prepare('SELECT * FROM users WHERE usuario = ? AND activo = 1').bind(claim.usuario).first();
  if (!user || user.rol !== claim.rol || user.vendedora !== claim.vendedora) return null;
  return user;
}

export async function login(db, input, secret) {
  const username = String(input.u || '').trim().toLowerCase();
  const user = await db.prepare('SELECT * FROM users WHERE usuario = ?').bind(username).first();
  const bad = {ok: false, error: 'Usuario o contraseña incorrectos.'};
  if (!user || !user.activo) return bad;
  if (!same(await legacyHash(String(input.p || ''), user.salt), user.hash)) return bad;
  const last = argentinaDate();
  await db.prepare('UPDATE users SET ultimo_ingreso = ? WHERE usuario = ?').bind(last, username).run();
  return {ok: true, token: await signToken(user, secret), nombre: user.nombre,
    usuario: user.usuario, rol: user.rol, vendedora: user.vendedora || '', cambiar: !!user.cambiar};
}

export async function password(db, user, input, secret) {
  const nueva = String(input.nueva || '');
  if (nueva.length < 8) return {ok: false, error: 'La contraseña nueva tiene que tener al menos 8 caracteres.'};
  if (nueva === GENERIC_PASSWORD) return {ok: false, error: 'Elegí una contraseña distinta de la inicial.'};
  if (!same(await legacyHash(String(input.actual || ''), user.salt), user.hash))
    return {ok: false, error: 'La contraseña actual no coincide.'};
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await legacyHash(nueva, salt);
  await db.prepare('UPDATE users SET salt = ?, hash = ?, cambiar = 0 WHERE usuario = ?')
    .bind(salt, hash, user.usuario).run();
  return {ok: true, token: await signToken(user, secret)};
}

export async function users(db) {
  const rows = (await db.prepare('SELECT usuario,nombre,rol,vendedora,cambiar,activo,ultimo_ingreso FROM users ORDER BY usuario').all()).results;
  return {ok: true, usuarios: rows.map(u => ({usuario: u.usuario, nombre: u.nombre, rol: u.rol,
    vendedora: u.vendedora, debeCambiar: !!u.cambiar, activo: !!u.activo, ultimoIngreso: u.ultimo_ingreso}))};
}

export async function reset(db, username) {
  const user = await db.prepare('SELECT usuario FROM users WHERE usuario = ?').bind(username).first();
  if (!user) return {ok: false, error: 'Ese usuario no existe.'};
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await db.prepare('UPDATE users SET salt = ?, hash = ?, cambiar = 1 WHERE usuario = ?')
    .bind(salt, await legacyHash(GENERIC_PASSWORD, salt), username).run();
  return {ok: true, clave: GENERIC_PASSWORD};
}

export async function addUser(db, input) {
  const usuario = String(input.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,24}$/.test(usuario))
    return {ok: false, error: 'El usuario admite 3 a 24 letras, números, punto, guion o guion bajo.'};
  const nombre = String(input.nombre || '').trim(), vendedora = String(input.vendedora || '').trim();
  if (!nombre) return {ok: false, error: 'Falta el nombre.'};
  if (nombre.includes('|') || vendedora.includes('|')) return {ok: false, error: 'El nombre no puede contener el carácter "|".'};
  const rol = input.rol === 'direccion' ? 'direccion' : 'vendedora';
  if (rol === 'vendedora' && !vendedora) return {ok: false, error: 'Indicá con qué nombre figura en Odoo.'};
  if (await db.prepare('SELECT 1 FROM users WHERE usuario = ?').bind(usuario).first())
    return {ok: false, error: 'Ya existe un usuario con ese nombre.'};
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await legacyHash(GENERIC_PASSWORD, salt);
  await db.prepare('INSERT INTO users (usuario,nombre,rol,vendedora,hash,salt,cambiar,activo) VALUES (?,?,?,?,?,?,1,1)')
    .bind(usuario, nombre, rol, vendedora, hash, salt).run();
  return {ok: true, clave: GENERIC_PASSWORD};
}

export async function setActive(db, actor, input) {
  if (actor.usuario === input.usuario) return {ok: false, error: 'No podés desactivar tu propio usuario.'};
  const user = await db.prepare('SELECT usuario FROM users WHERE usuario = ?').bind(input.usuario).first();
  if (!user) return {ok: false, error: 'Ese usuario no existe.'};
  await db.prepare('UPDATE users SET activo = ? WHERE usuario = ?').bind(input.activo === true ? 1 : 0, input.usuario).run();
  return {ok: true};
}
