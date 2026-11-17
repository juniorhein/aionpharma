/* ================================================================
   GET /api/produtos
   Lista os produtos do catálogo a partir do Tiny ERP, normalizados
   para o frontend. Enriquece cada item com imagem/descrição via
   produto.obter (com cache na borda da Vercel).
   Query: ?busca=tartoff

   Também serve as imagens enviadas pelo painel (?img=<sku|destaque>)
   e devolve o bloco de destaque da home junto do catálogo — a Vercel
   Hobby só permite 12 funções em /api, então estas duas rotas moram
   aqui em vez de virarem arquivos novos.
   ================================================================ */

import { pesquisarProdutos, obterProduto, extrairImagem } from './_lib/tiny.js';
import { afiliadoPublico } from './_lib/afiliados.js';
import { lerDestaque, lerOverrides, aplicarOverrides, lerImagem } from './_lib/vitrine.js';
import {
  contaDaRequisicao,
  idListaPrecoB2C,
  idListaPrecoDoNivel,
  rotuloDoNivel,
} from './_lib/b2b.js';

const PLACEHOLDER = '/assets/images/placeholder-produto.svg';

/** Produtos que não devem aparecer na loja (itens internos/teste). */
function isOculto(p) {
  const nome = (p.nome || '').toUpperCase();
  if (Number(p.preco) <= 0) return true;                 // sem preço
  if (nome.includes('THIAGO')) return true;              // item pessoal/teste
  if (nome.includes('AMOSTRA')) return true;             // amostra (não vendida)
  return false;
}

/** Prioridade de exibição: linha TartOff (gel) primeiro, depois areia, depois o resto. */
function prioridade(nome) {
  const n = (nome || '').toUpperCase();
  if (n.includes('GEL DENTAL') || n.includes('TARTOFF')) return 0;
  if (n.includes('AREIA') || n.includes('GREEN CAT')) return 1;
  return 2;
}

/** Mapeia um produto detalhado do Tiny para o formato do site. */
function normalizar(p) {
  const preco = Number(p.preco || 0);
  const promo = Number(p.preco_promocional || 0);
  const img = extrairImagem(p);
  return {
    id: String(p.id),
    sku: p.codigo || '',
    name: p.nome,
    description: p.descricao_complementar || '',
    price: promo > 0 ? promo : preco,
    priceOld: promo > 0 ? preco : null,
    image: img || PLACEHOLDER,
    hasImage: Boolean(img),
    inStock: p.situacao === 'A',
  };
}

/** Executa promises com limite de concorrência (respeita rate limit do Tiny). */
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

export default async function handler(req, res) {
  if (req.query?.afiliado !== undefined) return afiliadoPublico(req, res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Imagem guardada no painel. Responde antes de falar com o Tiny.
  const alvoImagem = (req.query?.img || '').toString().trim();
  if (alvoImagem) {
    try {
      const img = await lerImagem(alvoImagem);
      if (!img) return res.status(404).json({ error: 'Imagem não encontrada' });
      res.setHeader('Content-Type', img.mime);
      // A URL carrega ?v=<timestamp>, então o conteúdo desta URL é imutável.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(img.bytes);
    } catch (err) {
      console.error('[/api/produtos?img]', err.message);
      return res.status(502).json({ error: 'Falha ao ler a imagem', detail: err.message });
    }
  }

  try {
    const busca = (req.query?.busca || '').toString();
    // Visitante comum vê a lista "Cliente Final" (321 na conta Aion).
    // Lojista logado (Bearer do /api/b2b/login) vê a tabela do nível
    // dele — Lojista (103) ou Distribuição (102).
    const conta = await contaDaRequisicao(req);
    const idListaPreco = conta ? idListaPrecoDoNivel(conta.nivel) : idListaPrecoB2C();
    const lista = await pesquisarProdutos({ pesquisa: busca, idListaPreco });
    const visiveis = lista
      .filter((p) => !isOculto(p))
      .sort((a, b) => prioridade(a.nome) - prioridade(b.nome));

    // Enriquece com imagem/descrição (produto.obter). O obter devolve o
    // preço de CADASTRO; o preço da vitrine tem que continuar o da lista
    // (produtos.pesquisa + idListaPreco), senão a tabela da Olist não vale.
    const detalhados = await mapLimit(visiveis, 3, async (p) => {
      try {
        const full = await obterProduto(p.id);
        return normalizar({
          ...full,
          preco: p.preco,
          preco_promocional: p.preco_promocional,
        });
      } catch {
        return normalizar(p); // fallback sem imagem se obter falhar
      }
    });

    // Correções do painel (nome/descrição/foto) e destaque da home.
    // Banco fora do ar não pode derrubar a vitrine: cai no catálogo cru.
    let produtos = detalhados;
    let destaque = null;
    try {
      const [overrides, blocoDestaque] = await Promise.all([lerOverrides(), lerDestaque()]);
      produtos = aplicarOverrides(detalhados, overrides);
      destaque = blocoDestaque;
    } catch (err) {
      console.error('[/api/produtos] vitrine indisponível:', err.message);
    }

    // Preço B2B NUNCA pode ir para o cache compartilhado da Vercel:
    // um visitante seguinte receberia a tabela de custo.
    if (conta) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      return res.status(200).json({
        produtos,
        destaque,
        b2b: { nivel: conta.nivel, nivelLabel: rotuloDoNivel(conta.nivel) },
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'Authorization');
    return res.status(200).json({ produtos, destaque });
  } catch (err) {
    console.error('[/api/produtos]', err.message);
    return res.status(502).json({ error: 'Falha ao buscar produtos no Tiny', detail: err.message });
  }
}
