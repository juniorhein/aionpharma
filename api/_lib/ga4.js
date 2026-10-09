/* ================================================================
   GA4 — compra registrada pelo servidor (Measurement Protocol)
   ----------------------------------------------------------------
   Pix e boleto são aprovados depois que o cliente já saiu do site,
   então a página de confirmação nunca vê essas vendas. O webhook do
   Mercado Pago vê todas — é daqui que a compra vai pro GA4.

   transaction_id = id do pedido no Tiny, o mesmo que o navegador usa
   na compra com cartão: o GA4 deduplica, a venda não conta duas vezes.

   client_id vem do cookie _ga do comprador (guardado no metadata da
   preferência no checkout); assim a venda fica ligada à visita e à
   origem dela (anúncio, Instagram...). Sem cookie, vai um id de servidor.
   ================================================================ */

const MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || 'G-2PRH12MJFK';

/**
 * @param {object} pagamento  objeto do pagamento vindo da API do Mercado Pago
 * @returns {Promise<boolean>} true se enviou
 */
export async function enviarCompraGA4(pagamento) {
  const secret = process.env.GA4_API_SECRET;
  if (!secret || !pagamento?.external_reference) return false;

  const meta = pagamento.metadata || {};
  const itensMp = pagamento.additional_info?.items || [];
  const items = itensMp.map((it) => ({
    item_id: String(it.id || it.title),
    item_name: it.title,
    price: Number(it.unit_price) || 0,
    quantity: Number(it.quantity) || 1,
  }));

  const params = {
    transaction_id: String(pagamento.external_reference),
    currency: 'BRL',
    value: Number(pagamento.transaction_amount) || 0,
    shipping: Number(pagamento.shipping_amount) || 0,
    payment_type: pagamento.payment_type_id || undefined,
    items,
  };
  if (meta.ga_session_id) params.session_id = String(meta.ga_session_id);

  const body = {
    client_id: meta.ga_client_id || `srv.${pagamento.external_reference}`,
    timestamp_micros: Date.parse(pagamento.date_approved || '') * 1000 || undefined,
    events: [{ name: 'purchase', params }],
  };

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // O endpoint de produção responde 2xx sem corpo mesmo com payload ruim;
  // a validação de formato é feita em /debug/mp/collect nos testes.
  return res.ok;
}
