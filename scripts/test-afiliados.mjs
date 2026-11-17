// Testes offline: nenhum acesso a Postgres, Tiny, MP ou rede.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { codigoAfiliado, resolverAfiliado, salvarAtribuicao, afiliadoPublico, registrarPagamentoAfiliado } from '../api/_lib/afiliados.js';
import admin from '../api/_lib/admin-rotas/afiliados.js';
import { emitirToken } from '../api/_lib/auth.js';
process.env.DATABASE_URL = 'postgres://offline:offline@invalid/offline';
process.env.ADMIN_JWT_SECRET = 'offline-test-only';
globalThis.fetch = () => { throw new Error('Rede proibida neste teste'); };
let query = () => { throw new Error('Query inesperada'); };
pg.Pool.prototype.query = async (sql, params) => query(sql, params);
const res = () => ({ code: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(c) { this.code=c; return this; }, json(data) { this.data=data; return this; } });
assert.equal(codigoAfiliado(' PARCEIRO-1 '), 'parceiro-1');
for (const invalid of ['', 'a b', '../x', '<script>', 'a'.repeat(65), {}]) assert.equal(codigoAfiliado(invalid), null);
assert.equal(await resolverAfiliado('!'), null);
const affiliate = { id: randomUUID(), codigo: 'parceiro', comissao_percent: 12, coupon_id: null };
query = (_sql, p) => { assert.deepEqual(p, ['parceiro', null]); return { rows: [affiliate] }; };
assert.equal(await resolverAfiliado('PARCEIRO'), affiliate);
query = () => ({ rows: [] });
assert.equal(await resolverAfiliado('inativo'), null);
let r = res(); await admin({ method: 'GET', headers: {} }, r); assert.equal(r.code, 401);
const headers = { authorization: `Bearer ${emitirToken({ id: 'test', email: 'test@example.invalid' })}` };
for (const body of [{ nome: 'A', codigo: 'a', comissao_percent: -1 }, { nome: 'A', codigo: 'a', comissao_percent: 'NaN' }, { nome: 'A', codigo: '../' }]) {
  r = res(); await admin({ method: 'POST', headers, body }, r); assert.equal(r.code, 400);
}
r = res(); await admin({ method: 'GET', headers, query: { inicio: '2026-02-30' } }, r); assert.equal(r.code, 400);
r = res(); await admin({ method: 'GET', headers, query: { inicio: '2026-11-20', fim: '2026-11-01' } }, r); assert.equal(r.code, 400);
query = () => { throw Object.assign(new Error('unique'), { code: '23505' }); };
r = res(); await admin({ method: 'POST', headers, body: { nome: 'A', codigo: 'a' } }, r); assert.equal(r.code, 409);
query = (_sql, p) => { assert.deepEqual(p, ['123', affiliate.id, 'parceiro', 12, 90, 110]); return { rows: [] }; };
await salvarAtribuicao('123', affiliate, 90, 110);
await salvarAtribuicao('123', null, 90, 110);
const clicks = new Set();
query = (sql, p) => {
  if (sql.startsWith('select * from afiliados')) return { rows: p[0] === 'parceiro' ? [affiliate] : [] };
  if (sql.startsWith('insert into afiliado_cliques')) { clicks.add(p[0]); return { rows: [] }; }
  throw new Error('Query inesperada');
};
const clique = randomUUID();
for (let i=0; i<2; i++) { r = res(); await afiliadoPublico({ method: 'POST', query: { afiliado: 'parceiro' }, body: { clique } }, r); assert.equal(r.code, 200); assert.equal(r.headers['Cache-Control'], 'private, no-store'); }
assert.equal(clicks.size, 1);
r = res(); await afiliadoPublico({ method: 'GET', query: { afiliado: 'parceiro' } }, r); assert.equal(clicks.size, 1);
r = res(); await afiliadoPublico({ method: 'POST', query: { afiliado: 'inativo' }, body: { clique: randomUUID() } }, r); assert.equal(r.data.afiliado, null); assert.equal(clicks.size, 1);
query = (_sql, p) => { assert.deepEqual(p, ['456', '123', 'refunded', '2026-11-17T12:00:00Z']); return { rows: [] }; };
await registrarPagamentoAfiliado({ id: 456, external_reference: '123', status: 'refunded', date_last_updated: '2026-11-17T12:00:00Z' });

// Executa a captura real do script em um navegador simulado.
const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const capture = source.slice(source.indexOf('function lerAfiliado()'), source.indexOf('async function aplicarCupom()'));
const storage = new Map(); const requests = [];
const context = vm.createContext({ URLSearchParams, Date, crypto: { randomUUID },
  localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
  location: { search: '?ref=PRIMEIRO' }, history: { state: {}, replaceState(s) { this.state=s; } },
  appliedCoupon: null, saveCoupon() {}, renderCartUI() {}, renderCheckoutResumo() {}, b2bLogado: () => false,
  fetch: async (url, opts) => { requests.push(opts); return { ok: true, json: async () => ({ afiliado: { codigo: url.split('=')[1], cupom: url.endsWith('primeiro') ? { codigo: 'TART10', desconto_percent: 10 } : null } }) }; },
});
vm.runInContext(capture, context);
await context.initAfiliado();
assert.equal(context.lerAfiliado().codigo, 'primeiro');
assert.equal(context.appliedCoupon.codigo, 'TART10');
const expiry = context.lerAfiliado().expira;
await context.initAfiliado(); assert.equal(requests.at(-1).method, 'GET'); // reload não conta novamente
context.location.search = ''; await context.initAfiliado(); assert.equal(context.lerAfiliado().expira, expiry);
context.location.search = '?afiliado=SEGUNDO'; context.history.state = {};
await context.initAfiliado(); assert.equal(context.lerAfiliado().codigo, 'segundo'); assert.equal(context.appliedCoupon, null);
storage.set('aion_afiliado', JSON.stringify({ codigo: 'segundo', expira: Date.now()-1 })); assert.equal(context.lerAfiliado(), null);
context.b2bLogado = () => true; context.location.search = '?ref=primeiro'; context.history.state = {};
await context.initAfiliado(); assert.equal(context.appliedCoupon, null);
console.log('OK: normalização, autenticação, validação, conflitos, atribuição, cliques, status MP, último link, expiração, cupom automático e B2B (mocks offline).');
