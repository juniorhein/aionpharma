/* ================================================================
   Lógica de cupons — validação e resgate
   ================================================================ */

import { getDb } from './db.js';

/** Busca cupom válido pelo código (maiúsculas). */
export async function buscarCupomValido(codigo) {
  const code = String(codigo || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Informe o código do cupom.' };

  const sb = getDb();
  const { data: coupon, error } = await sb
    .from('coupons')
    .select('*, influencers(id, nome, instagram)')
    .eq('codigo', code)
    .maybeSingle();

  if (error) throw new Error(`Supabase cupons: ${error.message}`);
  if (!coupon) return { ok: false, error: 'Cupom não encontrado.' };
  if (!coupon.ativo) return { ok: false, error: 'Cupom inativo.' };

  const now = Date.now();
  if (coupon.valido_de && new Date(coupon.valido_de).getTime() > now) {
    return { ok: false, error: 'Cupom ainda não está válido.' };
  }
  if (coupon.valido_ate && new Date(coupon.valido_ate).getTime() < now) {
    return { ok: false, error: 'Cupom expirado.' };
  }

  const percent = Number(coupon.desconto_percent);
  if (!(percent > 0 && percent <= 100)) {
    return { ok: false, error: 'Cupom com desconto inválido.' };
  }

  return {
    ok: true,
    coupon: {
      id: coupon.id,
      codigo: coupon.codigo,
      desconto_percent: percent,
      influencer: coupon.influencers
        ? {
            id: coupon.influencers.id,
            nome: coupon.influencers.nome,
            instagram: coupon.influencers.instagram,
          }
        : null,
    },
  };
}

/** Cupom vale só nos produtos Tart Off (gel dental, SKUs 1172–1175). */
export const SKUS_CUPOM = ['1172', '1173', '1174', '1175'];
export function itemAceitaCupom(it) {
  return SKUS_CUPOM.includes(String(it?.sku ?? ''));
}

/** Subtotal só dos itens que aceitam cupom. */
export function subtotalElegivel(itens) {
  return (itens || []).filter(itemAceitaCupom).reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);
}

/** Aplica % de desconto no subtotal (2 casas). */
export function calcularDesconto(subtotal, descontoPercent) {
  const sub = Math.max(0, Number(subtotal) || 0);
  const pct = Math.max(0, Math.min(100, Number(descontoPercent) || 0));
  const valorDesconto = Math.round(sub * (pct / 100) * 100) / 100;
  const subtotalComDesconto = Math.round((sub - valorDesconto) * 100) / 100;
  return { valorDesconto, subtotalComDesconto, descontoPercent: pct };
}

/**
 * Redistribui o desconto nos itens (proporcional) para o Mercado Pago /
 * Tiny receberem unit_price já com desconto. Evita item com preço 0.
 */
export function aplicarDescontoNosItens(itens, descontoPercent) {
  const pct = Math.max(0, Math.min(100, Number(descontoPercent) || 0));
  const fator = 1 - pct / 100;
  return itens.map((it) => {
    if (!itemAceitaCupom(it)) return it;
    const price = Math.round(Number(it.price) * fator * 100) / 100;
    return { ...it, price: Math.max(0.01, price), priceOriginal: Number(it.price) };
  });
}

/**
 * Registra resgate após pagamento aprovado (idempotente por pedido_id).
 * Espera metadata no pagamento ou lookup por pending — usamos tabela
 * auxiliar `pending_checkouts` se existir; senão metadata do MP.
 */
export async function registrarResgate({
  couponId,
  pedidoId,
  pedidoNumero,
  emailCliente,
  valorPedido,
  valorDesconto,
}) {
  if (!couponId || !pedidoId) return { skipped: true };

  const sb = getDb();

  const { error: insertErr } = await sb.from('coupon_redemptions').insert({
    coupon_id: couponId,
    pedido_id: String(pedidoId),
    pedido_numero: pedidoNumero ? String(pedidoNumero) : null,
    email_cliente: emailCliente || null,
    valor_pedido: Number(valorPedido) || 0,
    valor_desconto: Number(valorDesconto) || 0,
  });

  // Já registrado (webhook reenviado) — ok
  if (insertErr) {
    if (insertErr.code === '23505') return { already: true };
    throw new Error(`Resgate cupom: ${insertErr.message}`);
  }

  await sb.rpc('increment_coupon_usos', { p_coupon_id: couponId });
  return { ok: true };
}

/** Guarda vínculo pedido↔cupom até o webhook confirmar pagamento. */
export async function salvarCheckoutCupom({
  pedidoId,
  pedidoNumero,
  couponId,
  codigo,
  emailCliente,
  valorPedido,
  valorDesconto,
}) {
  const sb = getDb();
  // Usa upsert numa tabela leve; se não existir, cria via insert em redemptions pending
  // Preferimos tabela checkout_coupons
  const { error } = await sb.from('checkout_coupons').upsert(
    {
      pedido_id: String(pedidoId),
      pedido_numero: pedidoNumero ? String(pedidoNumero) : null,
      coupon_id: couponId,
      codigo: codigo || null,
      email_cliente: emailCliente || null,
      valor_pedido: Number(valorPedido) || 0,
      valor_desconto: Number(valorDesconto) || 0,
    },
    { onConflict: 'pedido_id' }
  );
  if (error) throw new Error(`checkout_coupons: ${error.message}`);
}

export async function confirmarResgatePorPedido(pedidoId) {
  const sb = getDb();
  const { data, error } = await sb
    .from('checkout_coupons')
    .select('*')
    .eq('pedido_id', String(pedidoId))
    .maybeSingle();

  if (error) throw new Error(`checkout_coupons: ${error.message}`);
  if (!data) return { skipped: true };

  const result = await registrarResgate({
    couponId: data.coupon_id,
    pedidoId: data.pedido_id,
    pedidoNumero: data.pedido_numero,
    emailCliente: data.email_cliente,
    valorPedido: data.valor_pedido,
    valorDesconto: data.valor_desconto,
  });

  // Limpa o pendente após confirmar (ou se já existia)
  await sb.from('checkout_coupons').delete().eq('pedido_id', String(pedidoId));
  return result;
}

export default {
  buscarCupomValido,
  calcularDesconto,
  aplicarDescontoNosItens,
  registrarResgate,
  salvarCheckoutCupom,
  confirmarResgatePorPedido,
};
