/* ================================================================
   /api/admin/envios — régua de e-mails do pedido (api/_lib/regua.js)
   ----------------------------------------------------------------
   Quem chama:
     · Vercel Cron (vercel.json) e o GitHub Actions (.github/workflows/
       envios.yml), com "Authorization: Bearer <CRON_SECRET>"
     · admin logado no painel (token do painel)

   GET                              uma rodada da rotina (Tiny)
   GET ?simular=1                   só diz o que faria; não grava, não envia
   GET ?registros=1                 últimos registros de emails_pedido
   GET ?teste=<id Tiny>&tipo=<t>&para=<…@tartoff.com.br>
                                    manda o e-mail <t> com os dados reais do
                                    pedido SÓ para um endereço da casa
                                    (t = recebido | aprovado | nao_aprovado |
                                    faturado | enviado | pos_entrega)
   ================================================================ */

import { requireAdmin } from '../auth.js';
import { rodarRegua, listarRegistros, tiposAtivos, TIPOS } from '../regua.js';
import { obterPedido, linkNotaFiscal } from '../tiny.js';
import { buscarPagamentos } from '../mercadopago.js';
import { getPool } from '../db.js';
import {
  enviarPedidoRecebido,
  enviarConfirmacaoCliente,
  enviarPagamentoNaoAprovado,
  enviarPedidoFaturado,
  enviarPedidoEnviado,
  enviarPosEntrega,
  cupomPosEntrega,
} from '../email.js';

function cronAutorizado(req) {
  const segredo = process.env.CRON_SECRET;
  return Boolean(segredo) && req.headers?.authorization === `Bearer ${segredo}`;
}

async function teste(idTiny, tipo, para, q) {
  const o = await obterPedido(idTiny);
  if (!o) throw new Error('Pedido não encontrado no Tiny');
  const opts = { para, teste: true };
  const info = { numero: o.numero, situacao: o.situacao, tipo };
  const loja = await getPool()
    .query('select * from pedidos_loja where id_tiny = $1', [String(idTiny)])
    .then((r) => r.rows[0])
    .catch(() => null);
  let r;
  if (tipo === 'recebido') {
    const pagamentos = await buscarPagamentos(idTiny).catch(() => []);
    const pagamento = pagamentos[0] || null;
    info.pagamento = pagamento
      ? { id: pagamento.id, status: pagamento.status, metodo: pagamento.payment_method_id, tipo: pagamento.payment_type_id }
      : null;
    r = await enviarPedidoRecebido(o, { ...opts, pagamento });
  } else if (tipo === 'aprovado') {
    r = await enviarConfirmacaoCliente(o, { ...opts, prazoDias: loja?.prazo_dias });
  } else if (tipo === 'nao_aprovado') {
    info.link = loja?.link_pagamento || null;
    r = await enviarPagamentoNaoAprovado(o, { ...opts, link: loja?.link_pagamento, motivo: q.motivo === 'expirado' ? 'expirado' : 'recusado' });
  } else if (tipo === 'faturado') {
    const danfe = Number(o.id_nota_fiscal) > 0 ? await linkNotaFiscal(o.id_nota_fiscal).catch(() => null) : null;
    info.danfe = danfe;
    r = await enviarPedidoFaturado(o, { ...opts, danfe });
  } else if (tipo === 'enviado') {
    r = await enviarPedidoEnviado(o, opts);
  } else if (tipo === 'pos_entrega') {
    // Prévia do cupom sem mexer nas envs: &cupom=X&desconto=…&fim=AAAA-MM-DD
    const cupom = q.cupom
      ? { codigo: String(q.cupom).toUpperCase().slice(0, 30), desconto: String(q.desconto || '').slice(0, 60), fim: /^\d{4}-\d{2}-\d{2}$/.test(q.fim || '') ? q.fim : null }
      : cupomPosEntrega();
    info.cupom = cupom;
    r = await enviarPosEntrega(o, { ...opts, cupom });
  }
  return { ...info, resend: r };
}

export default async function handler(req, res) {
  if (!cronAutorizado(req)) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const q = req.query || {};
  try {
    if (q.registros) return res.status(200).json({ ativos: tiposAtivos(), registros: await listarRegistros() });

    if (q.teste) {
      const para = String(q.para || '').trim().toLowerCase();
      // Prova nunca vai para cliente: só endereço da casa.
      if (!/^[a-z0-9._%+-]+@tartoff\.com\.br$/.test(para)) {
        return res.status(400).json({ error: 'Teste só para endereço @tartoff.com.br' });
      }
      const tipo = String(q.tipo || 'enviado');
      if (!TIPOS.includes(tipo)) return res.status(400).json({ error: `tipo: ${TIPOS.join(' | ')}` });
      return res.status(200).json(await teste(String(q.teste), tipo, para, q));
    }

    const r = await rodarRegua({ simular: Boolean(q.simular) });
    console.log('[/api/admin/envios]', JSON.stringify(r));
    return res.status(200).json(r);
  } catch (err) {
    console.error('[/api/admin/envios]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
