const encoder = new TextEncoder();
function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}
export async function redeemPortalTicket(db, ticket, secret) {
  if (!secret || !/^[A-Za-z0-9_-]{1,800}\.[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  try {
    const [payload, mac] = ticket.split('.');
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
    if (!(await crypto.subtle.verify('HMAC', key, decode(mac), encoder.encode(payload)))) return null;
    const claim = JSON.parse(new TextDecoder().decode(decode(payload)));
    const now = Math.floor(Date.now()/1000);
    if (claim.iss !== 'zaphira.pages.dev' || claim.aud !== 'sales' ||
        typeof claim.sub !== 'string' || !/^[a-z0-9._-]{3,40}$/.test(claim.sub) ||
        typeof claim.jti !== 'string' || !/^[0-9a-f-]{36}$/.test(claim.jti) ||
        typeof claim.exp !== 'number' || claim.exp < now || claim.exp > now+60) return null;
    const result = await db.prepare('INSERT OR IGNORE INTO portal_sso_redeemed(jti,expires_at) VALUES (?,?)').bind(claim.jti, claim.exp).run();
    return result.meta.changes === 1 ? claim.sub : null;
  } catch { return null; }
}
