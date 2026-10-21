/* ================================================================
   Dev server local — serve o site estático + roteia /api/* para os
   handlers da pasta api/ (mesma assinatura da Vercel: handler(req,res)).
   Sem dependências. Uso: node scripts/dev-server.mjs  (porta 3000)
   ----------------------------------------------------------------
   Carrega o .env automaticamente. NÃO é o runtime de produção —
   é só para ver/testar localmente.
   ================================================================ */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

// ── .env mínimo (sem dependência externa) ──────────────────────
function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ── Shim res no estilo Vercel ──────────────────────────────────
function makeRes(raw) {
  raw.status = (code) => { raw.statusCode = code; return raw; };
  raw.json = (obj) => { raw.setHeader('Content-Type', 'application/json; charset=utf-8'); raw.end(JSON.stringify(obj)); return raw; };
  return raw;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function handleApi(req, res, name, query) {
  let file = path.join(ROOT, 'api', `${name}.js`);
  // Rota dinâmica da Vercel: api/admin/vendas → api/admin/[acao].js
  if (!existsSync(file) && name.includes('/')) {
    const pasta = name.slice(0, name.lastIndexOf('/'));
    const dinamica = path.join(ROOT, 'api', pasta, '[acao].js');
    if (existsSync(dinamica)) { file = dinamica; query = { ...query, acao: name.slice(pasta.length + 1) }; }
  }
  if (!existsSync(file)) { res.status(404).json({ error: `api/${name}.js não encontrado` }); return; }
  try {
    const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`); // bust cache p/ hot edit
    req.query = query;
    if (req.method !== 'GET' && req.method !== 'HEAD') req.body = await readBody(req);
    await mod.default(req, makeRes(res));
  } catch (err) {
    console.error(`[api/${name}]`, err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' ) rel = '/index.html';
  // sem extensão → tenta .html (ex.: /produtos → produtos.html)
  let file = path.join(ROOT, rel);
  if (!path.extname(file)) {
    if (existsSync(file + '.html')) file += '.html';
    else if (existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
  }
  // impede path traversal
  if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end('Forbidden'); return; }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = path.join(file, 'index.html');
    const data = await readFile(file);
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h1>404</h1><p>' + rel + ' não encontrado</p>');
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice('/api/'.length).replace(/\/$/, '');
    return handleApi(req, res, name, Object.fromEntries(u.searchParams));
  }
  return serveStatic(req, res, u.pathname);
});

server.listen(PORT, () => {
  console.log(`\n  Aion Pharma (dev)  →  http://localhost:${PORT}\n`);
  console.log(`  API:  GET /api/produtos   POST /api/frete   POST /api/checkout`);
  console.log(`  MELHORENVIO_MOCK=${process.env.MELHORENVIO_MOCK || '(off)'}  TINY_TOKEN=${process.env.TINY_TOKEN ? 'set' : 'MISSING'}\n`);
});
