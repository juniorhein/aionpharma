import { getPool } from '../db.js';
import { requireAdmin } from '../auth.js';
import { codigoAfiliado } from '../afiliados.js';

const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const dia = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;

export default async function handler(req, res) {
  if (!await requireAdmin(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const db = getPool();
    if (req.method === 'GET') {
      const { inicio, fim } = req.query || {};
      if ((inicio && !dia(inicio)) || (fim && !dia(fim)) || (inicio && fim && inicio > fim)) {
        return res.status(400).json({ error: 'Período inválido.' });
      }
      // Agregações separadas evitam multiplicar vendas pelos cliques/tentativas.
      const { rows } = await db.query(`select a.*, c.codigo as cupom_codigo,
        coalesce(k.cliques,0)::int as cliques,
        coalesce(v.pedidos,0)::int as pedidos, coalesce(v.pagos,0)::int as pagos,
        coalesce(v.faturamento,0) as faturamento, coalesce(v.comissao,0) as comissao
        from afiliados a left join coupons c on c.id=a.coupon_id
        left join lateral (select count(*) as cliques from afiliado_cliques k
          where k.afiliado_id=a.id
          and ($1::date is null or k.created_at >= ($1::date::timestamp at time zone 'America/Sao_Paulo'))
          and ($2::date is null or k.created_at < (($2::date+1)::timestamp at time zone 'America/Sao_Paulo'))) k on true
        left join lateral (select count(*) as pedidos, count(*) filter(where pago) as pagos,
          sum(afiliado_total) filter(where pago) as faturamento,
          sum(round(afiliado_base*afiliado_comissao_percent/100,2)) filter(where pago) as comissao
          from (select p.*, exists(select 1 from afiliado_pagamentos m where m.pedido_id=p.id_tiny and m.status='approved') as pago
            from pedidos_loja p where p.afiliado_id=a.id
            and ($1::date is null or p.criado_em >= ($1::date::timestamp at time zone 'America/Sao_Paulo'))
            and ($2::date is null or p.criado_em < (($2::date+1)::timestamp at time zone 'America/Sao_Paulo'))) pedidos) v on true
        order by a.nome`, [inicio || null, fim || null]);
      return res.status(200).json({ afiliados: rows });
    }
    if (req.method === 'POST' || req.method === 'PATCH') {
      let body = req.body;
      if (!body) { const chunks = []; for await (const c of req) chunks.push(c); body = Buffer.concat(chunks).toString(); }
      if (typeof body === 'string') body = JSON.parse(body);
      body ||= {};
      if (req.method === 'PATCH' && !uuid(body.id)) return res.status(400).json({ error: 'id inválido.' });
      const row = {};
      if (req.method === 'POST' || body.nome !== undefined) {
        row.nome = String(body.nome || '').trim();
        if (!row.nome || row.nome.length > 200) return res.status(400).json({ error: 'Informe o nome (até 200 caracteres).' });
      }
      if (req.method === 'POST' || body.codigo !== undefined) {
        row.codigo = codigoAfiliado(body.codigo);
        if (!row.codigo) return res.status(400).json({ error: 'Código: 1–64 letras, números, hífen ou sublinhado; comece com letra/número.' });
      }
      if (req.method === 'POST' || body.comissao_percent !== undefined) {
        const n = Number(body.comissao_percent ?? 0);
        if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: 'Comissão deve ser de 0 a 100%.' });
        row.comissao_percent = Math.round(n * 100) / 100;
      }
      if (body.contato !== undefined) row.contato = String(body.contato || '').trim().slice(0,500) || null;
      if (body.ativo !== undefined) {
        if (typeof body.ativo !== 'boolean') return res.status(400).json({ error: 'Status inválido.' });
        row.ativo = body.ativo;
      }
      if (body.coupon_id !== undefined) {
        if (body.coupon_id && !uuid(body.coupon_id)) return res.status(400).json({ error: 'Cupom inválido.' });
        row.coupon_id = body.coupon_id || null;
      }
      const keys = Object.keys(row);
      if (!keys.length) return res.status(400).json({ error: 'Nenhum campo informado.' });
      const values = Object.values(row);
      const sql = req.method === 'POST'
        ? `insert into afiliados(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`
        : `update afiliados set ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')} where id=$${values.push(body.id)} returning *`;
      const { rows } = await db.query(sql, values);
      if (!rows[0]) return res.status(404).json({ error: 'Afiliado não encontrado.' });
      return res.status(req.method === 'POST' ? 201 : 200).json({ afiliado: rows[0] });
    }
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código ou cupom já vinculado a outro afiliado.' });
    if (err.code === '23503') return res.status(400).json({ error: 'Cupom não encontrado.' });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido.' });
    console.error('[admin/afiliados]', err.message);
    return res.status(502).json({ error: 'Não foi possível acessar afiliados. Confira a migração do banco.' });
  }
}
