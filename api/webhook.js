/* ================================================================
   POST /api/webhook
   Recebe as notificações do Mercado Pago. Quando um pagamento é
   aprovado, atualiza a situação do pedido no Tiny e (opcionalmente)
   dispara a emissão da NF-e.
   ----------------------------------------------------------------
   O MP envia o id do pagamento; buscamos os detalhes na API do MP,
   pegamos o external_reference (= id do pedido no Tiny) e atualizamos.
   ================================================================ */

import { obterPagamento } from './_lib/mercadopago.js';
import { alterarSituacaoPedido, gerarNotaFiscal } from './_lib/tiny.js';
import { confirmarResgatePorPedido } from './_lib/cupons.js';
import { aoPagamento } from './_lib/regua.js';
import { enviarCompraGA4 } from './_lib/ga4.js';

async function emails(pagamento) {
  try {
    const r = await aoPagamento(pagamento);
    r.filter((x) => x?.erro).forEach((x) => console.error('[/api/webhook] e-mail:', x.erro));
  } catch (err) {
    console.error('[/api/webhook] e-mail:', err.message);
  }
}

export default async function handler(req, res) {
  // Responda 200 rápido — o MP reenvia se não receber 200.
  if (req.method !== 'POST') {
    return res.status(200).end();
  }

  try {
    const type = req.query?.type || req.body?.type;
    const paymentId = req.query?.['data.id'] || req.body?.data?.id;

    // Só tratamos eventos de pagamento
    if (type !== 'payment' || !paymentId) {
      return res.status(200).json({ ignored: true });
    }

    const pagamento = await obterPagamento(paymentId);
    const pedidoId = pagamento.external_reference;
    const status = pagamento.status; // approved, pending, rejected, ...

    if (!pedidoId) {
      return res.status(200).json({ ignored: 'sem external_reference' });
    }

    if (status === 'approved') {
      await alterarSituacaoPedido(pedidoId, 'aprovado');

      // E-mails (régua em api/_lib/regua.js): confirmação pro cliente e
      // aviso pra equipe, uma vez só por pedido. Falha de e-mail NÃO pode
      // derrubar o webhook — o MP reenvia e o pedido seria reprocessado.
      await emails(pagamento);

      // Venda no GA4 (cobre Pix/boleto, aprovados fora do site).
      // Medição nunca derruba o webhook.
      try {
        await enviarCompraGA4(pagamento);
      } catch (gaErr) {
        console.error('[/api/webhook] GA4:', gaErr.message);
      }

      // Registra uso do cupom (idempotente por pedido_id)
      try {
        if (process.env.DATABASE_URL) {
          await confirmarResgatePorPedido(pedidoId);
        }
      } catch (cupomErr) {
        console.error('[/api/webhook] cupom:', cupomErr.message);
      }

      if (String(process.env.AUTO_EMIT_NFE).toLowerCase() === 'true') {
        try {
          await gerarNotaFiscal(pedidoId);
        } catch (nfErr) {
          // Não falha o webhook por causa da NF — apenas registra.
          console.error('[/api/webhook] NF-e:', nfErr.message);
        }
      }
    } else if (status === 'cancelled' || status === 'rejected') {
      await alterarSituacaoPedido(pedidoId, 'cancelado');
      await emails(pagamento); // registra a falha; a rotina manda o "não aprovado"
    } else if (status === 'pending' || status === 'in_process') {
      await emails(pagamento); // "pedido recebido" com Pix/boleto
    }

    return res.status(200).json({ ok: true, pedidoId, status });
  } catch (err) {
    console.error('[/api/webhook]', err.message);
    // Mesmo em erro, devolvemos 200 para evitar tempestade de reenvios;
    // o erro fica logado para investigação.
    return res.status(200).json({ ok: false, error: err.message });
  }
}
