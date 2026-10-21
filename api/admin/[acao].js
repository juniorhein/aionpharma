/* ================================================================
   /api/admin/:acao — painel, numa função só
   ----------------------------------------------------------------
   login | coupons | influencers | b2b | vitrine | vendas

   Mesmo motivo do /api/b2b/[acao].js: o plano Hobby da Vercel aceita
   no máximo 12 funções em /api. As 5 rotas do painel eram 5 funções;
   juntas aqui viram 1 e as URLs continuam as mesmas. Os handlers
   reais ficam em api/_lib/admin-rotas.
   ================================================================ */

import login from '../_lib/admin-rotas/login.js';
import coupons from '../_lib/admin-rotas/coupons.js';
import influencers from '../_lib/admin-rotas/influencers.js';
import b2b from '../_lib/admin-rotas/b2b.js';
import vitrine from '../_lib/admin-rotas/vitrine.js';
import vendas from '../_lib/admin-rotas/vendas.js';

const ROTAS = { login, coupons, influencers, b2b, vitrine, vendas };

// O passo de sincronização com o Tiny pode levar ~20 s.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const acao = String(req.query?.acao || '').toLowerCase();
  const rota = ROTAS[acao];
  if (!rota) return res.status(404).json({ error: 'Rota não encontrada' });
  return rota(req, res);
}
