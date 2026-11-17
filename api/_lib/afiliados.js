import { createHash } from 'node:crypto';
import { getPool } from './db.js';
import { buscarCupomValido } from './cupons.js';

export function codigoAfiliado(value) {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(code) ? code : null;
}

// Cupom validado no checkout tem prioridade; só afiliados ativos atribuem.
export async function resolverAfiliado(codigo, couponId = null) {
  const code = codigoAfiliado(codigo);
  if (!code && !couponId) return null;
  const { rows } = await getPool().query(
    `select * from afiliados where ativo and (codigo = $1 or coupon_id = $2)
     order by (coupon_id = $2) desc nulls last limit 1`, [code, couponId]);
  return rows[0] || null;
}

export async function afiliadoPublico(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  try {
    const afiliado = await resolverAfiliado(req.query.afiliado);
    if (!afiliado) return res.status(200).json({ afiliado: null });
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.clique || '')) {
        return res.status(400).json({ error: 'Clique inválido.' });
      }
      // 1 clique por visitante (IP) e afiliado a cada 30 min: evita inflar o relatório.
      const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
      const ipHash = createHash('sha256').update(`aion-afiliado:${ip}`).digest('hex').slice(0, 32);
      await getPool().query(`insert into afiliado_cliques(id, afiliado_id, ip_hash)
        select $1,$2,$3 where not exists (select 1 from afiliado_cliques
          where afiliado_id=$2 and ip_hash=$3 and created_at > now() - interval '30 minutes')
        on conflict do nothing`, [body.clique, afiliado.id, ipHash]);
    }
    let cupom = null;
    if (afiliado.coupon_id) {
      const { rows } = await getPool().query('select codigo from coupons where id=$1', [afiliado.coupon_id]);
      if (rows[0]) {
        const result = await buscarCupomValido(rows[0].codigo);
        if (result.ok) cupom = { codigo: result.coupon.codigo, desconto_percent: result.coupon.desconto_percent };
      }
    }
    return res.status(200).json({ afiliado: { codigo: afiliado.codigo, cupom } });
  } catch (err) {
    console.error('[afiliados/publico]', err.message);
    return res.status(503).json({ error: 'Atribuição indisponível.' });
  }
}

export async function salvarAtribuicao(pedidoId, afiliado, base, total) {
  if (!afiliado) return;
  await getPool().query(`insert into pedidos_loja
    (id_tiny, afiliado_id, afiliado_codigo, afiliado_comissao_percent, afiliado_base, afiliado_total)
    values ($1,$2,$3,$4,$5,$6) on conflict (id_tiny) do update set
    afiliado_id=excluded.afiliado_id, afiliado_codigo=excluded.afiliado_codigo,
    afiliado_comissao_percent=excluded.afiliado_comissao_percent,
    afiliado_base=excluded.afiliado_base, afiliado_total=excluded.afiliado_total`,
  [String(pedidoId), afiliado.id, afiliado.codigo, afiliado.comissao_percent, base, total]);
}

export async function registrarPagamentoAfiliado(p) {
  if (!p.id || !p.external_reference || !p.date_last_updated) return;
  await getPool().query(`insert into afiliado_pagamentos(pagamento_id,pedido_id,status,atualizado_em)
    values($1,$2,$3,$4) on conflict(pagamento_id) do update set
    status=excluded.status, atualizado_em=excluded.atualizado_em
    where afiliado_pagamentos.atualizado_em <= excluded.atualizado_em`,
  [String(p.id), String(p.external_reference), p.status, p.date_last_updated]);
}
