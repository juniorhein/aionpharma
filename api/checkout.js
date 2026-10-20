/* ================================================================
   POST /api/checkout
   0. Reconhece a sessão B2B (Bearer) e revalida os preços no servidor
   1. Valida cupom (se houver) e aplica desconto nos itens
   2. Cria o pedido no Tiny (situação "aberto")
   3. Cria a preferência de pagamento no Mercado Pago
   4. Guarda vínculo pedido↔cupom para o webhook registrar o uso
   ================================================================ */

import { incluirPedido, montarPedido, mapaDePrecos } from './_lib/tiny.js';
import { criarPreferencia, contaDaCredencial } from './_lib/mercadopago.js';
import {
  buscarCupomValido,
  calcularDesconto,
  aplicarDescontoNosItens, subtotalElegivel,
  salvarCheckoutCupom,
} from './_lib/cupons.js';
import {
  contaDaRequisicao,
  idListaPrecoB2C,
  idListaPrecoDoNivel,
  rotuloDoNivel,
  formatarCnpj,
} from './_lib/b2b.js';
import { getDb as getSupabaseAdmin } from './_lib/db.js';
import { contaPfDaRequisicao, formatarCpf } from './_lib/pf.js';
import { temFreteGratis } from './_lib/fretegratis.js';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** Ids do GA4 vindos do navegador, saneados (vão pro metadata do MP). */
function gaMetadata(ga) {
  const limpa = (v) => (typeof v === 'string' && /^[\w.-]{1,64}$/.test(v) ? v : undefined);
  const clientId = limpa(ga?.clientId);
  const sessionId = limpa(ga?.sessionId);
  return {
    ...(clientId ? { ga_client_id: clientId } : {}),
    ...(sessionId ? { ga_session_id: sessionId } : {}),
  };
}

/**
 * Recarrega o preço de cada item na lista correta (Cliente Final,
 * Lojista ou Distribuição). O carrinho vem do localStorage, então o
 * preço enviado pelo navegador é só uma sugestão.
 * Se o Tiny não responder: pedido B2B falha (preço de custo não pode
 * sair no chute); B2C segue com o preço enviado, como antes.
 */
async function revalidarPrecos(itens, { idListaPreco, exigir }) {
  let mapa;
  try {
    mapa = await mapaDePrecos({ idListaPreco });
  } catch (err) {
    if (exigir) {
      const e = new Error(`Não foi possível confirmar os preços agora: ${err.message}`);
      e.statusCode = 503;
      throw e;
    }
    return { itens, revalidado: false };
  }

  const revalidados = itens.map((item) => {
    const chaveSku = item.sku ? `sku:${String(item.sku).toUpperCase()}` : '';
    const info = mapa.get(String(item.id)) || (chaveSku ? mapa.get(chaveSku) : null);
    if (!info || !(info.preco > 0)) {
      if (exigir) {
        const e = new Error(`Produto indisponível na tabela de preço: ${item.name || item.id}.`);
        e.statusCode = 400;
        throw e;
      }
      return item;
    }
    return { ...item, sku: item.sku || info.sku, price: info.preco };
  });

  return { itens: revalidados, revalidado: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { cliente, itens, frete, cupom: cupomCodigo, ga } = await readJson(req);

    if (!cliente?.nome || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'Pedido inválido: informe cliente e itens.' });
    }

    // Sessão B2B (Bearer): define a tabela de preço e trava o pedido no
    // CNPJ da conta — não no que veio digitado no formulário.
    const conta = await contaDaRequisicao(req);
    const idListaPreco = conta ? idListaPrecoDoNivel(conta.nivel) : idListaPrecoB2C();

    // Sessão PF: o mesmo Bearer pode ser de uma conta de consumidor. Ela
    // NÃO muda preço (PF compra na tabela Cliente Final, igual a quem
    // compra sem conta) — serve para vincular o pedido ao histórico.
    const contaPf = conta ? null : await contaPfDaRequisicao(req);

    if (conta && cupomCodigo) {
      return res.status(400).json({
        error: 'Cupom de desconto não vale para pedidos com preço de lojista.',
      });
    }

    const { itens: itensConferidos } = await revalidarPrecos(itens, {
      idListaPreco,
      exigir: Boolean(conta),
    });

    let clienteFinal = cliente;
    if (conta) {
      clienteFinal = {
        ...cliente,
        tipoPessoa: 'J',
        cpfCnpj: formatarCnpj(conta.cnpj),
        nome: cliente.nome || conta.razao_social,
        email: cliente.email || conta.email,
      };
    } else if (contaPf) {
      // O CPF do pedido é o da conta logada, não o que veio no formulário:
      // a nota sai no titular da conta e o histórico não mistura pessoas.
      clienteFinal = {
        ...cliente,
        tipoPessoa: 'F',
        cpfCnpj: formatarCpf(contaPf.cpf),
        nome: cliente.nome || contaPf.nome,
        email: cliente.email || contaPf.email,
      };
    }

    const valorFrete = frete && Number(frete.price) > 0 ? Number(frete.price) : 0;
    const subtotalOriginal = itensConferidos.reduce(
      (s, it) => s + Number(it.price) * Number(it.qty),
      0
    );

    // Frete zero só vale onde a loja dá frete grátis (Sul/Sudeste).
    if (valorFrete === 0 && !temFreteGratis({ cep: cliente.cep, subtotal: subtotalOriginal })) {
      return res.status(400).json({
        error: 'Frete inválido para este CEP. Calcule o frete novamente no carrinho.',
      });
    }

    let cupomInfo = null;
    let itensFinais = itensConferidos;
    let valorDesconto = 0;
    let obsCupom = '';

    if (cupomCodigo) {
      const result = await buscarCupomValido(cupomCodigo);
      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      cupomInfo = result.coupon;
      const calc = calcularDesconto(subtotalElegivel(itensConferidos), cupomInfo.desconto_percent);
      valorDesconto = calc.valorDesconto;
      itensFinais = aplicarDescontoNosItens(itensConferidos, cupomInfo.desconto_percent);
      obsCupom = `Cupom ${cupomInfo.codigo} (${cupomInfo.desconto_percent}%): -R$ ${valorDesconto.toFixed(2)}.`;
    }

    const obsB2B = conta
      ? `Pedido B2B — ${conta.razao_social} (${formatarCnpj(conta.cnpj)}), tabela ${rotuloDoNivel(conta.nivel)}.`
      : '';

    const pedido = montarPedido({
      cliente: clienteFinal,
      itens: itensFinais,
      frete,
      observacoes: [
        'Pedido da loja online.',
        obsB2B,
        obsCupom,
      ]
        .filter(Boolean)
        .join(' '),
      situacao: 'aberto',
    });
    const { id: pedidoId, numero } = await incluirPedido(pedido);

    if (conta) {
      try {
        await getSupabaseAdmin()
          .from('b2b_orders')
          .insert({
            account_id: conta.id,
            pedido_id: String(pedidoId),
            pedido_numero: numero ? String(numero) : null,
            nivel: conta.nivel,
            id_lista_preco: String(idListaPreco),
            valor_itens: Math.round(subtotalOriginal * 100) / 100,
            valor_frete: valorFrete,
          });
      } catch (b2bErr) {
        // Pedido já existe no Tiny — o rastro é secundário, não bloqueia.
        console.error('[/api/checkout] b2b_orders:', b2bErr.message);
      }
    }

    if (contaPf) {
      try {
        await getSupabaseAdmin()
          .from('pf_orders')
          .insert({
            account_id: contaPf.id,
            pedido_id: String(pedidoId),
            pedido_numero: numero ? String(numero) : null,
            valor_itens: Math.round((subtotalOriginal - valorDesconto) * 100) / 100,
            valor_frete: valorFrete,
          });
      } catch (pfErr) {
        // Pedido já existe no Tiny — o histórico é secundário, não bloqueia.
        console.error('[/api/checkout] pf_orders:', pfErr.message);
      }
    }

    const preferencia = await criarPreferencia({
      externalReference: String(pedidoId),
      items: itensFinais.map((it) => ({
        id: it.sku || it.id,
        title: it.name,
        description: it.name,
        quantity: it.qty,
        unit_price: it.price,
        picture_url: it.image || undefined,
      })),
      shipmentCost: valorFrete,
      // O comprador vai INTEIRO (documento, telefone, endereço): é o que o
      // antifraude do Mercado Pago pontua. Mandar só nome e e-mail derrubou
      // as duas primeiras compras reais em 10/09 com cc_rejected_high_risk.
      cliente: clienteFinal,
      metadata: gaMetadata(ga),
    });

    if (cupomInfo) {
      try {
        await salvarCheckoutCupom({
          pedidoId,
          pedidoNumero: numero,
          couponId: cupomInfo.id,
          codigo: cupomInfo.codigo,
          emailCliente: clienteFinal.email,
          valorPedido: Math.round((subtotalOriginal - valorDesconto + valorFrete) * 100) / 100,
          valorDesconto,
        });
      } catch (cupomErr) {
        // Pedido já criado — não bloqueia o pagamento; loga para investigação.
        console.error('[/api/checkout] salvarCheckoutCupom:', cupomErr.message);
      }
    }

    // Qual conta recebe? `APP_USR-` nao prova producao: usuario de teste do
    // Mercado Pago usa o mesmo prefixo. Perguntamos pro MP (cache no processo).
    // O `sandbox_init_point` foi descontinuado (sandbox.mercadopago.com.br
    // devolve erro), entao o link e sempre o `init_point` -- o que muda e o
    // alerta, para ninguem acreditar que a loja esta recebendo de verdade.
    const contaMp = await contaDaCredencial();
    const paymentUrl = preferencia.init_point;
    if (contaMp.ehTeste) {
      console.error(
        `[/api/checkout] pedido ${pedidoId} criado com credencial de TESTE do Mercado Pago ` +
        `(${contaMp.nickname}); comprador real vai ver "uma das partes e de teste".`
      );
    }

    return res.status(200).json({
      pedidoId,
      numero,
      preferenceId: preferencia.id,
      paymentUrl,
      ambienteMp: contaMp.conhecida ? (contaMp.ehTeste ? 'teste' : 'producao') : 'desconhecido',
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY || null,
      itens: itensFinais.map((it) => ({ id: it.id, sku: it.sku, price: it.price, qty: it.qty })),
      b2b: conta ? { nivel: conta.nivel, nivelLabel: rotuloDoNivel(conta.nivel) } : null,
      pf: contaPf ? { nome: contaPf.nome } : null,
      cupom: cupomInfo
        ? {
            codigo: cupomInfo.codigo,
            desconto_percent: cupomInfo.desconto_percent,
            valor_desconto: valorDesconto,
          }
        : null,
    });
  } catch (err) {
    if (err.statusCode) {
      // Erro de regra (preço não confirmado, item fora da tabela) — a
      // mensagem é para o cliente ler, não é falha de integração.
      console.error('[/api/checkout]', err.statusCode, err.message);
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[/api/checkout]', err.message);
    return res.status(502).json({ error: 'Falha ao processar o checkout', detail: err.message });
  }
}
