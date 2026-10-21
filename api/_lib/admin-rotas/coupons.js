/* GET/POST/PATCH /api/admin/coupons */

import { getDb } from '../db.js';
import { requireAdmin } from '../auth.js';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const sb = getDb();

  try {
    if (req.method === 'GET') {
      // Relatório de um cupom: GET /api/admin/coupons?id=...&stats=1
      if (req.query?.stats && req.query?.id) {
        const id = req.query.id;
        const { data: coupon, error: cErr } = await sb
          .from('coupons')
          .select('*, influencers(id, nome, instagram)')
          .eq('id', id)
          .maybeSingle();
        if (cErr) throw new Error(cErr.message);
        if (!coupon) return res.status(404).json({ error: 'Cupom não encontrado.' });

        const { data: redemptions, error: rErr } = await sb
          .from('coupon_redemptions')
          .select('*')
          .eq('coupon_id', id)
          .order('created_at', { ascending: false });
        if (rErr) throw new Error(rErr.message);

        const list = redemptions || [];
        const receita = list.reduce((s, r) => s + Number(r.valor_pedido || 0), 0);
        const descontoTotal = list.reduce((s, r) => s + Number(r.valor_desconto || 0), 0);

        return res.status(200).json({
          coupon,
          stats: {
            usos: list.length,
            usos_contador: coupon.usos,
            receita_gerada: Math.round(receita * 100) / 100,
            desconto_concedido: Math.round(descontoTotal * 100) / 100,
          },
          redemptions: list,
        });
      }

      const { data, error } = await sb
        .from('coupons')
        .select('*, influencers(id, nome, instagram)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return res.status(200).json({ coupons: data || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const codigo = String(body.codigo || '').trim().toUpperCase();
      const desconto = Number(body.desconto_percent);

      if (!codigo) return res.status(400).json({ error: 'Código é obrigatório.' });
      if (!(desconto > 0 && desconto <= 100)) {
        return res.status(400).json({ error: 'desconto_percent deve ser entre 0 e 100.' });
      }

      const row = {
        codigo,
        desconto_percent: desconto,
        valido_de: body.valido_de || null,
        valido_ate: body.valido_ate || null,
        ativo: body.ativo !== false,
        influencer_id: body.influencer_id || null,
      };

      const { data, error } = await sb
        .from('coupons')
        .insert(row)
        .select('*, influencers(id, nome, instagram)')
        .single();
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Já existe um cupom com esse código.' });
        }
        throw new Error(error.message);
      }
      return res.status(201).json({ coupon: data });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = body.id;
      if (!id) return res.status(400).json({ error: 'id é obrigatório.' });

      const patch = {};
      if (body.codigo !== undefined) patch.codigo = String(body.codigo).trim().toUpperCase();
      if (body.desconto_percent !== undefined) {
        const d = Number(body.desconto_percent);
        if (!(d > 0 && d <= 100)) {
          return res.status(400).json({ error: 'desconto_percent inválido.' });
        }
        patch.desconto_percent = d;
      }
      if (body.valido_de !== undefined) patch.valido_de = body.valido_de || null;
      if (body.valido_ate !== undefined) patch.valido_ate = body.valido_ate || null;
      if (body.ativo !== undefined) patch.ativo = Boolean(body.ativo);
      if (body.influencer_id !== undefined) patch.influencer_id = body.influencer_id || null;

      const { data, error } = await sb
        .from('coupons')
        .update(patch)
        .eq('id', id)
        .select('*, influencers(id, nome, instagram)')
        .single();
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Já existe um cupom com esse código.' });
        }
        throw new Error(error.message);
      }
      return res.status(200).json({ coupon: data });
    }

    if (req.method === 'DELETE') {
      const id = (req.query?.id || '').toString().trim();
      if (!id) return res.status(400).json({ error: 'id é obrigatório.' });

      // Cupom já usado não some: o histórico de resgate (e a comissão do
      // influencer) aponta para ele. Nesse caso o certo é desativar.
      const { data: usos, error: uErr } = await sb
        .from('coupon_redemptions')
        .select('id')
        .eq('coupon_id', id);
      if (uErr) throw new Error(uErr.message);
      if ((usos || []).length) {
        return res.status(409).json({
          error: `Esse cupom já foi usado ${usos.length}x. Apagar apagaria o histórico — desative em vez de excluir.`,
        });
      }

      const { error } = await sb.from('coupons').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('[/api/admin/coupons]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
