/* ================================================================
   Cliente Tiny ERP — API v2 (token estático)
   Docs: https://tiny.com.br/api-docs/api2
   ----------------------------------------------------------------
   Chamadas: POST x-www-form-urlencoded com token + formato=json.
   Resposta encapsulada em { retorno: { status, ... } }.
   ================================================================ */

const BASE_URL = 'https://api.tiny.com.br/api2';

function getToken() {
  const token = process.env.TINY_TOKEN;
  if (!token) throw new Error('TINY_TOKEN não configurado.');
  return token;
}

async function call(service, params = {}) {
  const body = new URLSearchParams({ token: getToken(), formato: 'json', ...params });
  const res = await fetch(`${BASE_URL}/${service}.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Tiny ${service}: HTTP ${res.status}`);
  const data = await res.json();
  const retorno = data?.retorno;
  if (!retorno) throw new Error(`Tiny ${service}: resposta inesperada`);
  if (retorno.status === 'Erro') {
    const erros = (retorno.erros || []).map((e) => e.erro || JSON.stringify(e)).join('; ');
    const err = new Error(`Tiny ${service}: ${erros || 'erro desconhecido'}`);
    err.tinyRetorno = retorno;
    throw err;
  }
  return retorno;
}

/* ── Produtos ───────────────────────────────────────────────── */

/**
 * Lista a página do catálogo (sem `pesquisa`, retorna o catálogo).
 * Sem `idListaPreco`, o Tiny devolve o preço de CADASTRO — que NÃO
 * acompanha as tabelas (Cliente Final / Lojista / Distribuição).
 * A loja B2C usa a lista "Cliente Final" (env TINY_ID_LISTA_PRECO).
 */
export async function pesquisarProdutos({ pesquisa = '', pagina = 1, idListaPreco } = {}) {
  const params = { pesquisa, pagina };
  const lista = idListaPreco || process.env.TINY_ID_LISTA_PRECO;
  if (lista) params.idListaPreco = String(lista);
  const retorno = await call('produtos.pesquisa', params);
  return (retorno.produtos || []).map((p) => p.produto);
}

/**
 * Mapa de preços da lista informada, indexado por id e por SKU.
 * Usado no checkout para NUNCA confiar no preço vindo do navegador —
 * o carrinho mora no localStorage e é editável pelo cliente.
 */
export async function mapaDePrecos({ idListaPreco, maxPaginas = 5 } = {}) {
  const produtos = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    let lote = [];
    try {
      lote = await pesquisarProdutos({ idListaPreco, pagina });
    } catch (err) {
      // "A consulta não retornou registros" na página seguinte é fim de
      // catálogo, não falha — só propaga se nem a 1ª página veio.
      if (pagina === 1) throw err;
      break;
    }
    if (!lote.length) break;
    produtos.push(...lote);
  }

  const mapa = new Map();
  for (const p of produtos) {
    const promo = Number(p.preco_promocional || 0);
    const info = {
      id: String(p.id),
      sku: p.codigo || '',
      nome: p.nome,
      preco: promo > 0 ? promo : Number(p.preco || 0),
    };
    mapa.set(String(p.id), info);
    if (p.codigo) mapa.set(`sku:${String(p.codigo).toUpperCase()}`, info);
  }
  return mapa;
}

/** Detalhe completo de um produto (descrição, imagens, etc.). */
export async function obterProduto(id) {
  const retorno = await call('produto.obter', { id });
  return retorno.produto;
}

/** Saldo de estoque de um produto. */
export async function obterEstoque(id) {
  const retorno = await call('produto.obter.estoque', { id });
  return retorno.produto;
}

/**
 * Preenche o `sku` dos itens que vieram sem ele. Carrinhos gravados no
 * localStorage antes da migração da cotação guardam só o `id` do Tiny, e
 * a cotação de frete da Olist exige SKU. Itens cujo produto não resolve
 * saem com `sku` vazio — quem chama decide o que fazer.
 */
export async function garantirSkus(itens) {
  return Promise.all(
    itens.map(async (item) => {
      if (item.sku || !item.id) return item;
      try {
        const produto = await obterProduto(item.id);
        return { ...item, sku: produto?.codigo || '' };
      } catch {
        return item;
      }
    })
  );
}

/** Extrai a 1ª imagem de um produto (anexos ou imagens_externas). */
export function extrairImagem(produto) {
  const anexo = produto?.anexos?.[0]?.anexo;
  if (anexo) return anexo;
  const ext = produto?.imagens_externas?.[0]?.imagem_externa?.url;
  if (ext) return ext;
  return '';
}

/* ── Pedidos ────────────────────────────────────────────────── */

export async function incluirPedido(pedido) {
  const retorno = await call('pedido.incluir', { pedido: JSON.stringify({ pedido }) });
  const registro = retorno.registros?.registro || retorno.registro || {};
  return { id: registro.id, numero: registro.numero, retorno };
}

export async function obterPedido(id) {
  const retorno = await call('pedido.obter', { id });
  return retorno.pedido;
}

export async function alterarSituacaoPedido(id, situacao) {
  return call('pedido.alterar.situacao', { id, situacao });
}

/* ── Nota Fiscal ────────────────────────────────────────────── */

export async function gerarNotaFiscal(idPedido, modelo = '55') {
  return call('pedido.gerar.nota.fiscal', { id: idPedido, modelo });
}

export async function emitirNotaFiscal(idNota) {
  return call('nota.fiscal.emitir', { id: idNota });
}

/* ── Helper: montar pedido a partir do carrinho ─────────────── */

/* ── Fiscal: natureza de operação por tipo de cliente ───────────
   Sem natureza informada o Tiny assume a PADRÃO da conta, que é a de
   contribuinte (PJ). Resultado: nota de venda para CPF saía como "para
   contribuinte", com carga tributária errada e erro no faturamento —
   reclamação do fiscal da Aion em 10/09/2026.

   Usamos o ID e não o nome: casar por texto pegou uma natureza parecida
   (337432794) em vez da que o Mercado Livre usa. Os ids abaixo são os da
   conta da Aion — 337432712 é o que chega nos pedidos do ML para
   consumidor final; 337432765 é a de contribuinte (a padrão antiga). */
const ID_NATUREZA_CONSUMIDOR = process.env.TINY_ID_NATUREZA_CONSUMIDOR || '337432712';
const ID_NATUREZA_CONTRIBUINTE = process.env.TINY_ID_NATUREZA_CONTRIBUINTE || '337432765';

/** "Jadlog - Normal" → "Jadlog" (o que vai no campo transportadora da NF). */
function nomeTransportadora(frete) {
  if (!frete) return '';
  const bruto = String(frete.name || frete.company || '');
  return bruto.split(/\s*[-–]\s*/)[0].trim().slice(0, 100);
}

export function montarPedido({ cliente, itens, observacoes = '', situacao = 'aberto', frete = null }) {
  // frete = { id, name, company, price } escolhido pelo cliente na cotação.
  // O valor vai no pedido para conciliar com a etiqueta gerada no Olist Envios.
  const valorFrete = frete && Number(frete.price) > 0 ? Number(frete.price) : 0;
  const servicoFrete = frete ? [frete.company, frete.name].filter(Boolean).join(' ') : '';
  // Cotação veio do Olist Envios → o pedido tem que nascer NESSA logística
  // ('OLIST' + nome da forma de frete como está no cadastro, ex. "Loggi - Expresso"),
  // senão a Expedição imprime só a etiqueta interna do ERP, sem rastreio e sem
  // postagem contratada — a transportadora não reconhece (Gustavo, 24/09/2026).
  const olistEnvios = /olist envios/i.test(frete?.company || '');
  const obsFrete = servicoFrete ? `Frete escolhido: ${servicoFrete} (R$ ${valorFrete.toFixed(2)}).` : '';
  const pj = (cliente.tipoPessoa || 'F') === 'J';

  return {
    data_pedido: '',
    situacao,
    // Nome do canal: sem isso o pedido não se identifica como venda da
    // loja própria (o do Mercado Livre chega marcado com o canal dele).
    ...(process.env.TINY_ID_ECOMMERCE
      ? { id_ecommerce: Number(process.env.TINY_ID_ECOMMERCE), ecommerce: 'Loja Aion Pharma' }
      : {}),
    id_natureza_operacao: pj ? ID_NATUREZA_CONTRIBUINTE : ID_NATUREZA_CONSUMIDOR,
    valor_frete: valorFrete,
    frete_por_conta: 'R', // R = por conta do Remetente (loja despacha via Olist Envios)
    // `forma_envio` é CÓDIGO de uma letra, não texto livre: 'T' = transportadora.
    // Mandar o nome do serviço aqui fazia o Tiny gravar 'S' e a nota sair sem
    // transporte — o serviço vai em `forma_frete` e a empresa em `nome_transportador`.
    forma_envio: olistEnvios ? 'OLIST' : frete ? 'T' : '',
    forma_frete: (olistEnvios ? String(frete.name || '') : servicoFrete).slice(0, 30),
    nome_transportador: nomeTransportadora(frete),
    cliente: {
      nome: cliente.nome,
      tipoPessoa: cliente.tipoPessoa || 'F',
      cpf_cnpj: cliente.cpfCnpj || '',
      email: cliente.email || '',
      fone: cliente.telefone || '',
      endereco: cliente.endereco || '',
      numero: cliente.numero || '',
      complemento: cliente.complemento || '',
      bairro: cliente.bairro || '',
      cep: cliente.cep || '',
      cidade: cliente.cidade || '',
      uf: cliente.uf || '',
    },
    itens: itens.map((item) => ({
      item: {
        codigo: item.sku || item.id || '',
        descricao: item.name,
        unidade: 'UN',
        quantidade: item.qty,
        valor_unitario: item.price,
      },
    })),
    obs: [observacoes, obsFrete].filter(Boolean).join(' '),
    // Marcador de canal: sem isso o pedido da loja se mistura na lista
    // com os do Mercado Livre e os digitados à mão.
    marcadores: [{ marcador: { descricao: 'Loja online' } }],
  };
}

export default {
  pesquisarProdutos,
  mapaDePrecos,
  obterProduto,
  obterEstoque,
  garantirSkus,
  extrairImagem,
  incluirPedido,
  obterPedido,
  alterarSituacaoPedido,
  gerarNotaFiscal,
  emitirNotaFiscal,
  montarPedido,
};
