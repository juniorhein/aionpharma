/* ================================================================
   GET   /api/admin/b2b — lista as contas com CNPJ (+ pedidos feitos)
   PATCH /api/admin/b2b — muda nível (lojista/distribuição), ativa,
                          desativa ou reseta a senha de uma conta
   ================================================================ */

import { getDb as getSupabaseAdmin } from '../db.js';
import { requireAdmin } from '../auth.js';
import { CAMPOS_PUBLICOS, NIVEIS, formatarCnpj, hashSenha } from '../b2b.js';

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

  const sb = getSupabaseAdmin();
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb
        .from('b2b_accounts')
        .select(`${CAMPOS_PUBLICOS}, cnpj_situacao, cnpj_verificado`)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);

      const contas = data || [];
      // Quantos pedidos cada conta já fez (uma consulta só).
      const { data: pedidos } = await sb.from('b2b_orders').select('account_id, valor_itens');
      const porConta = new Map();
      for (const p of pedidos || []) {
        const atual = porConta.get(p.account_id) || { pedidos: 0, total: 0 };
        atual.pedidos += 1;
        atual.total += Number(p.valor_itens || 0);
        porConta.set(p.account_id, atual);
      }

      return res.status(200).json({
        contas: contas.map((c) => ({
          ...c,
          cnpj_formatado: formatarCnpj(c.cnpj),
          pedidos: porConta.get(c.id)?.pedidos || 0,
          total_comprado: Math.round((porConta.get(c.id)?.total || 0) * 100) / 100,
        })),
      });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = body.id;
      if (!id) return res.status(400).json({ error: 'id é obrigatório.' });

      const patch = {};
      if (body.nivel !== undefined) {
        if (!NIVEIS.includes(body.nivel)) {
          return res.status(400).json({ error: `Nível inválido. Use: ${NIVEIS.join(', ')}.` });
        }
        patch.nivel = body.nivel;
      }
      if (body.ativo !== undefined) {
        patch.ativo = Boolean(body.ativo);
        // Reativar limpa o bloqueio por tentativas de senha.
        if (patch.ativo) {
          patch.tentativas_falhas = 0;
          patch.bloqueado_ate = null;
        }
      }
      if (body.senha !== undefined) {
        const senha = String(body.senha);
        if (senha.length < 8) {
          return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
        }
        patch.senha_hash = hashSenha(senha);
        patch.tentativas_falhas = 0;
        patch.bloqueado_ate = null;
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Nada para atualizar.' });
      }

      const { data, error } = await sb
        .from('b2b_accounts')
        .update(patch)
        .eq('id', id)
        .select(CAMPOS_PUBLICOS)
        .single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ conta: { ...data, cnpj_formatado: formatarCnpj(data.cnpj) } });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('[/api/admin/b2b]', err.message);
    return res.status(502).json({ error: 'Falha ao acessar as contas B2B', detail: err.message });
  }
}
