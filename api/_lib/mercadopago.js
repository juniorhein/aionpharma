/* ================================================================
   Cliente Mercado Pago — Checkout Pro (preferências de pagamento)
   Docs: https://www.mercadopago.com.br/developers/pt/reference/preferences/_checkout_preferences/post
   ----------------------------------------------------------------
   Fluxo: criamos uma "preferência" com os itens do carrinho e o MP
   devolve uma URL (init_point) para a qual redirecionamos o cliente.
   Após o pagamento, o MP chama nosso webhook e redireciona o cliente
   de volta para as back_urls.
   ================================================================ */

const BASE_URL = 'https://api.mercadopago.com';

function getAccessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado.');
  }
  return token;
}

/* ----------------------------------------------------------------
   Qual conta está por trás do token?
   ATENÇÃO: `APP_USR-` NÃO quer dizer produção. Usuário de teste do
   Mercado Pago também recebe token `APP_USR-`. A única checagem que
   vale é perguntar pro próprio MP quem é o dono da credencial:
   se `tags` inclui `test_user`, o dinheiro NÃO chega na conta real e
   qualquer comprador de verdade leva "uma das partes é de teste".
   Resultado fica em cache no processo (a credencial não muda em
   tempo de execução).
   ---------------------------------------------------------------- */
let _contaCache = null;

export async function contaDaCredencial() {
  if (_contaCache) return _contaCache;
  try {
    const res = await fetch(`${BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return { conhecida: false, ehTeste: null, motivo: data?.message || `HTTP ${res.status}` };
    }
    const tags = Array.isArray(data.tags) ? data.tags : [];
    _contaCache = {
      conhecida: true,
      ehTeste: tags.includes('test_user'),
      id: data.id,
      nickname: data.nickname,
      email: data.email,
    };
    if (_contaCache.ehTeste) {
      console.error(
        `[mercadopago] ALERTA: a credencial em uso e de CONTA DE TESTE (${_contaCache.nickname}). ` +
        `Nenhum pagamento real entra na conta da Aion e todo cliente de verdade recebe ` +
        `"uma das partes e de teste". Trocar MERCADOPAGO_ACCESS_TOKEN pelo Access Token de ` +
        `producao da conta real.`
      );
    }
    return _contaCache;
  } catch (err) {
    return { conhecida: false, ehTeste: null, motivo: err.message };
  }
}

/* ── Dados que o antifraude do Mercado Pago usa ─────────────────
   Uma preferência "magra" (só nome, e-mail e título do item) é
   pontuada como risco alto: foi o que derrubou as duas primeiras
   compras reais em 10/09/2026 com `cc_rejected_high_risk`. O motor
   de risco quer saber QUEM compra (documento, telefone, endereço) e
   O QUE compra (id, descrição, categoria). Mandar isso é a
   recomendação oficial para aumentar aprovação — e é de graça.
   ---------------------------------------------------------------- */

const so = (v) => String(v ?? '').replace(/\D/g, '');

/** "Maria Silva Souza" → { nome: 'Maria', sobrenome: 'Silva Souza' } */
function partirNome(nomeCompleto) {
  const partes = String(nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return { nome: undefined, sobrenome: undefined };
  return { nome: partes[0], sobrenome: partes.slice(1).join(' ') || undefined };
}

/** Telefone BR: separa DDD do número, como o Mercado Pago espera. */
function partirTelefone(telefone) {
  const d = so(telefone);
  if (d.length < 10) return undefined;
  const semPais = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  return { area_code: semPais.slice(0, 2), number: semPais.slice(2) };
}

/** CPF (11) ou CNPJ (14) no formato do MP. */
function documento(cpfCnpj) {
  const d = so(cpfCnpj);
  if (d.length === 11) return { type: 'CPF', number: d };
  if (d.length === 14) return { type: 'CNPJ', number: d };
  return undefined;
}

function enderecoPayer(cliente) {
  const cep = so(cliente?.cep);
  if (!cep) return undefined;
  return {
    zip_code: cep,
    street_name: cliente.endereco || undefined,
    street_number: cliente.numero ? String(cliente.numero) : undefined,
  };
}

/**
 * Cria uma preferência de pagamento (Checkout Pro).
 * @param {object} opts
 * @param {Array<{id?,title,quantity,unit_price,picture_url?,description?}>} opts.items
 * @param {string} opts.externalReference  id do pedido no Tiny (para conciliar)
 * @param {number} [opts.shipmentCost]      valor do frete (somado ao total)
 * @param {object} [opts.cliente]           dados completos do comprador (antifraude)
 * @returns {Promise<{ id, init_point, sandbox_init_point }>}
 */
export async function criarPreferencia({ items, externalReference, shipmentCost = 0, cliente, metadata }) {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const { nome, sobrenome } = partirNome(cliente?.nome);

  const payer = cliente
    ? {
        name: nome,
        surname: sobrenome,
        email: cliente.email || undefined,
        phone: partirTelefone(cliente.telefone),
        identification: documento(cliente.cpfCnpj),
        address: enderecoPayer(cliente),
      }
    : undefined;

  const enderecoEntrega = so(cliente?.cep)
    ? {
        zip_code: so(cliente.cep),
        street_name: [cliente.endereco, cliente.bairro, cliente.cidade, cliente.uf]
          .filter(Boolean)
          .join(', ') || undefined,
        street_number: cliente.numero ? String(cliente.numero) : undefined,
      }
    : undefined;

  const preference = {
    items: items.map((it) => ({
      id: it.id ? String(it.id) : undefined,
      title: it.title,
      description: it.description || it.title,
      category_id: 'health_beauty',       // linha veterinária/higiene
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      currency_id: 'BRL',
      picture_url: it.picture_url || undefined,
    })),
    shipments: {
      ...(Number(shipmentCost) > 0 ? { cost: Number(shipmentCost) } : {}),
      mode: 'not_specified',
      receiver_address: enderecoEntrega,
    },
    external_reference: externalReference,
    // Volta no pagamento (payment.metadata) — o webhook usa pra ligar a
    // venda à visita no GA4.
    ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
    payer,
    back_urls: {
      success: `${siteUrl}/pedido-confirmado?status=sucesso`,
      pending: `${siteUrl}/pedido-confirmado?status=pendente`,
      failure: `${siteUrl}/pedido-confirmado?status=falha`,
    },
    auto_return: 'approved',
    notification_url: `${siteUrl}/api/webhook`,
    statement_descriptor: 'AION PHARMA',
  };

  const res = await fetch(`${BASE_URL}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify(preference),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Mercado Pago preferência: ${data?.message || res.status}`);
  }
  return data;
}

/** Busca os detalhes de um pagamento (usado no webhook). */
export async function obterPagamento(paymentId) {
  const res = await fetch(`${BASE_URL}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Mercado Pago pagamento ${paymentId}: ${data?.message || res.status}`);
  }
  return data;
}

export default { criarPreferencia, obterPagamento, contaDaCredencial };
