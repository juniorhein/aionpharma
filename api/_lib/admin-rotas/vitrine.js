/* ================================================================
   /api/admin/vitrine — o que o painel edita na loja

   GET     → destaque da home + catálogo do Tiny já casado com as
             correções salvas (nome do sistema x nome exibido)
   PUT     → salva o destaque ({alvo:'destaque'}) ou um produto
             ({alvo:'produto', sku})
   POST    → sobe a foto ({alvo:'destaque'|<sku>, mime, base64})
   DELETE  → ?imagem=<alvo> tira a foto · ?sku=<sku> zera a correção

   É a 12ª (e última) função de /api permitida no plano Hobby —
   por isso tudo da vitrine passa por este arquivo.
   ================================================================ */

import { requireAdmin } from '../auth.js';
import { pesquisarProdutos, obterProduto, extrairImagem } from '../tiny.js';
import { idListaPrecoB2C } from '../b2b.js';
import {
  lerDestaque,
  salvarDestaque,
  lerOverrides,
  salvarProduto,
  limparProduto,
  salvarImagem,
  removerImagem,
  urlImagem,
} from '../vitrine.js';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Catálogo cru do Tiny (preço de consumidor final) + correções salvas. */
async function montarLista() {
  const [lista, overrides] = await Promise.all([
    pesquisarProdutos({ pesquisa: '', idListaPreco: idListaPrecoB2C() }),
    lerOverrides(),
  ]);

  // Mesma regra da vitrine pública: item sem preço, amostra e item de
  // teste não aparecem — o painel mostra o que a loja mostra.
  const visiveis = lista.filter((p) => {
    const nome = (p.nome || '').toUpperCase();
    return Number(p.preco) > 0 && !nome.includes('THIAGO') && !nome.includes('AMOSTRA');
  });

  const detalhados = await mapLimit(visiveis, 3, async (p) => {
    let imagemSistema = '';
    try {
      imagemSistema = extrairImagem(await obterProduto(p.id)) || '';
    } catch {
      imagemSistema = '';
    }
    const o = overrides.get(String(p.codigo || ''));
    const promo = Number(p.preco_promocional || 0);
    return {
      sku: p.codigo || '',
      idTiny: String(p.id),
      nomeSistema: p.nome,
      preco: promo > 0 ? promo : Number(p.preco || 0),
      situacao: p.situacao,
      imagemSistema,
      // o que o painel salvou (null = herda do sistema)
      nome: o?.nome || '',
      descricao: o?.descricao || '',
      imagemUrl: o?.imagem_url || '',
      temImagemPropria: Boolean(o?.tem_imagem),
      imagemPropria: o?.tem_imagem ? urlImagem(p.codigo, o.atualizado_em) : '',
      oculto: Boolean(o?.oculto),
      ordem: Number.isInteger(o?.ordem) ? o.ordem : '',
    };
  });

  return detalhados;
}

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const [destaque, produtos] = await Promise.all([lerDestaque(), montarLista()]);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ destaque, produtos });
    }

    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (body.alvo === 'destaque') {
        const destaque = await salvarDestaque(body);
        return res.status(200).json({ ok: true, destaque });
      }
      if (body.alvo === 'produto') {
        if (!body.sku) return res.status(400).json({ error: 'SKU obrigatório.' });
        await salvarProduto(body.sku, body);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "alvo deve ser 'destaque' ou 'produto'." });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const alvo = String(body.alvo || '').trim();
      if (!alvo) return res.status(400).json({ error: 'Informe o alvo da imagem.' });
      const r = await salvarImagem(alvo, String(body.mime || ''), body.base64);
      return res.status(200).json({ ok: true, ...r, url: urlImagem(alvo, new Date()) });
    }

    if (req.method === 'DELETE') {
      const imagem = (req.query?.imagem || '').toString().trim();
      const sku = (req.query?.sku || '').toString().trim();
      if (imagem) {
        await removerImagem(imagem);
        return res.status(200).json({ ok: true });
      }
      if (sku) {
        await limparProduto(sku);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Informe ?imagem= ou ?sku=.' });
    }

    res.setHeader('Allow', 'GET, PUT, POST, DELETE');
    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('[/api/admin/vitrine]', err.message);
    return res.status(400).json({ error: err.message });
  }
}
