/* ================================================================
   /api/admin/vendas — vendas e rankings do painel
   ----------------------------------------------------------------
   GET  ?tipo=lista&de=&ate=&canal=&grupo=&busca=   pedidos + resumo
   GET  ?tipo=pedido&id=<id Tiny>                    um pedido, com itens
   GET  ?tipo=influencers&de=&ate=                   ranking por cupom
   GET  ?tipo=representantes&de=&ate=                ranking por vendedor
   GET  ?tipo=status                                 última sincronização
   POST { tipo: 'sync' }                             um passo de sync do Tiny
   ================================================================ */

import { requireAdmin } from '../auth.js';
import {
  listarVendas,
  obterVenda,
  rankingInfluencers,
  rankingRepresentantes,
  sincronizar,
  statusSync,
} from '../vendas.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CANAIS = ['loja', 'loja_cnpj', 'loja_todos', 'mercado_livre', 'marketplace', 'representante', 'direto'];
const GRUPOS = ['confirmado', 'pendente', 'cancelado'];

function filtros(q = {}) {
  return {
    de: ISO.test(q.de || '') ? q.de : null,
    ate: ISO.test(q.ate || '') ? q.ate : null,
    canal: CANAIS.includes(q.canal) ? q.canal : null,
    grupo: GRUPOS.includes(q.grupo) ? q.grupo : null,
    busca: q.busca ? String(q.busca).trim().slice(0, 60) : null,
  };
}

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'POST') {
      const r = await sincronizar({ orcamentoMs: 20000 });
      return res.status(200).json(r);
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Método não permitido' });
    }

    const q = req.query || {};
    const tipo = String(q.tipo || 'lista');
    if (tipo === 'status') return res.status(200).json(await statusSync());
    if (tipo === 'pedido') {
      const pedido = await obterVenda(q.id);
      if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });
      return res.status(200).json({ pedido });
    }
    if (tipo === 'influencers') return res.status(200).json(await rankingInfluencers(filtros(q)));
    if (tipo === 'representantes') return res.status(200).json(await rankingRepresentantes(filtros(q)));
    return res.status(200).json(await listarVendas(filtros(q)));
  } catch (err) {
    console.error('[/api/admin/vendas]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
