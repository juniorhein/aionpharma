/* ================================================================
   E-mails transacionais da loja (Resend) — visual único
   ----------------------------------------------------------------
   Régua do pedido (quem decide QUANDO mandar é api/_lib/regua.js):
     1. recebido      pedido criado, pagamento pendente (Pix/boleto/análise)
     2. aprovado      pagamento confirmado            (+ aviso pra equipe)
     3. nao_aprovado  pagamento recusado / Pix expirado, com link pra tentar de novo
     4. faturado      nota emitida, pedido em separação (link da DANFE)
     5. enviado       transportadora + código + link de rastreio
     6. pos_entrega   ~7 dias depois do envio: chegou bem? avaliação, @, cupom

   Remetente: `envio.aionpharma.ind.br`, subdomínio próprio com SPF e
   DKIM verificados (não usar domínio de terceiro).

   Toda função aceita `{ para, teste }`: `para` troca o destinatário
   (prova para endereço nosso) e `teste` marca o assunto com [TESTE].
   Nada aqui pode derrubar webhook/rotina: quem chama trata a falha.
   ================================================================ */

const RESEND_URL = 'https://api.resend.com/emails';

const FROM = process.env.EMAIL_FROM || 'Aion Pharma <pedidos@envio.aionpharma.ind.br>';
// Respostas do cliente vão para todos da lista (vírgula), ex.
// "comercial@tartoff.com.br,marketing@tartoff.com.br".
const REPLY_TO = (process.env.EMAIL_REPLY_TO || 'comercial@tartoff.com.br')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
const ADMIN = (process.env.EMAIL_ADMIN || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

const SITE = 'https://www.aionpharma.ind.br';
const LOGO = `${SITE}/assets/brand/logo.png`;
const INSTAGRAM = 'tartoff.oficial';
const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM}/`;

// Paleta do site (style.css :root)
const COR = {
  navy: '#051231',
  ciano: '#0099D6',
  fundo: '#F0F4FA',
  caixa: '#F7FAFC',
  borda: '#D5DEEB',
  texto: '#0F1B33',
  suave: '#5D7B9D',
  alerta: '#B42318',
};

const brl = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const qtd = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : String(v ?? '');
};

const escapar = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** "2026-11-10T21:30:00.000-04:00" → "10/11 às 22:30" (Brasília) */
export function dataHoraBr(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

/** "2026-12-31" → "31/12/2026" */
const dataBr = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

async function enviar({ to, subject, html, texto }) {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) throw new Error('RESEND_API_KEY não configurada');
  if (!to?.length) throw new Error('destinatário vazio');

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chave}`,
      'Content-Type': 'application/json',
      // O Cloudflare da Resend recusa requisição sem User-Agent (erro 1010).
      'User-Agent': 'aionpharma-loja/1.0 (+https://www.aionpharma.ind.br)',
    },
    body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html, text: texto }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data?.message || 'falha'}`);
  return data;
}

/* ── Dados do pedido (formato do pedido.obter do Tiny) ─────────── */

const itensDo = (pedido) => (pedido.itens || []).map((i) => i.item || i);
const limpo = (v) => String(v ?? '').trim();

export function envioDo(pedido) {
  const codigo = limpo(pedido.codigo_rastreamento);
  let url = limpo(pedido.url_rastreamento);
  // Olist Envios: o Tiny traz o link; se vier só o código, o rastreio
  // público do Olist é por código de pacote.
  if (!url && codigo && /OLIST/i.test(String(pedido.forma_envio || ''))) {
    url = `https://envios.olist.com/rastreios/pacote/${encodeURIComponent(codigo)}`;
  }
  const frete = limpo(pedido.forma_frete);
  const transportadora = limpo(pedido.nome_transportador) || frete.split(' - ')[0] || '';
  return { codigo, url, transportadora, servico: frete };
}

/* ── Peças visuais ─────────────────────────────────────────────── */

const ETAPAS = [
  ['recebido', 'Recebido'],
  ['aprovado', 'Pago'],
  ['faturado', 'Nota emitida'],
  ['enviado', 'Enviado'],
];

/** Linha do tempo do pedido; `atual` = chave da etapa. */
function trilha(atual) {
  const idx = ETAPAS.findIndex(([k]) => k === atual);
  if (idx < 0) return '';
  const celulas = ETAPAS.map(([, rotulo], i) => {
    const feito = i <= idx;
    return `<td align="center" style="width:25%;padding:0 2px">
        <div style="height:6px;border-radius:3px;background:${feito ? COR.ciano : COR.borda}"></div>
        <div style="margin-top:6px;font-size:11px;line-height:1.3;color:${feito ? COR.navy : COR.suave};font-weight:${i === idx ? 700 : 400}">${rotulo}</div>
      </td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr>${celulas}</tr></table>`;
}

function paragrafo(html) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COR.texto}">${html}</p>`;
}

function botao(rotulo, url, cor = COR.navy) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0"><tr>
    <td style="border-radius:8px;background:${cor}">
      <a href="${escapar(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapar(rotulo)}</a>
    </td></tr></table>`;
}

/** Caixa de destaque (código Pix, rastreio, cupom…). */
function destaque(rotulo, conteudo, extra = '') {
  return `<div style="background:${COR.fundo};border:1px solid ${COR.borda};border-radius:12px;padding:16px 18px;margin:0 0 20px">
      <p style="margin:0 0 6px;font-size:12px;color:${COR.suave};text-transform:uppercase;letter-spacing:.06em">${escapar(rotulo)}</p>
      ${conteudo}
      ${extra}
    </div>`;
}

function rotulo(texto) {
  return `<p style="margin:22px 0 8px;font-size:12px;color:${COR.suave};text-transform:uppercase;letter-spacing:.06em">${escapar(texto)}</p>`;
}

function tabelaItens(pedido, { totais = true } = {}) {
  const linhas = itensDo(pedido)
    .map(
      (it) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${COR.borda};font-size:14px;color:${COR.texto}">
          ${escapar(it.descricao)}<br>
          <span style="color:${COR.suave};font-size:13px">${qtd(it.quantidade)} × ${brl(it.valor_unitario)}</span>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid ${COR.borda};text-align:right;white-space:nowrap;font-size:14px">
          ${brl(Number(it.quantidade) * Number(it.valor_unitario))}
        </td>
      </tr>`
    )
    .join('');
  const frete = Number(pedido.valor_frete || 0);
  const desconto = Number(pedido.valor_desconto || 0);
  const rodape = totais
    ? `${desconto > 0 ? `<tr><td style="padding:10px 0 0;color:${COR.suave};font-size:14px">Desconto</td><td style="padding:10px 0 0;text-align:right;font-size:14px">−${brl(desconto)}</td></tr>` : ''}
       <tr><td style="padding:10px 0 0;color:${COR.suave};font-size:14px">Frete</td>
           <td style="padding:10px 0 0;text-align:right;font-size:14px">${frete > 0 ? brl(frete) : 'Grátis'}</td></tr>
       <tr><td style="padding:8px 0 0;font-weight:700;font-size:15px">Total</td>
           <td style="padding:8px 0 0;text-align:right;font-weight:700;font-size:15px">${brl(pedido.total_pedido)}</td></tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${linhas}${rodape}</table>`;
}

function blocoEndereco(c) {
  const linha2 = [c.bairro, c.cidade, c.uf].filter(Boolean).join(' · ');
  return `<p style="margin:0;font-size:14px;line-height:1.55;color:${COR.texto}">
    ${escapar(c.nome || '')}<br>
    ${escapar(c.endereco || '')}, ${escapar(c.numero || 's/n')}${c.complemento ? ' - ' + escapar(c.complemento) : ''}<br>
    ${escapar(linha2)}<br>CEP ${escapar(c.cep || '')}</p>`;
}

function moldura({ titulo, preheader = '', etapa = null, corpo }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title></head>
<body style="margin:0;padding:0;background:${COR.fundo};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COR.texto}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapar(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.fundo}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td align="center" style="padding:4px 0 18px">
        <a href="${SITE}"><img src="${LOGO}" width="150" alt="Aion Pharma" style="display:block;width:150px;height:auto;border:0"></a>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:16px;border-top:4px solid ${COR.ciano};padding:28px 26px">
        <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:${COR.navy}">${escapar(titulo)}</h1>
        ${etapa ? trilha(etapa) : ''}
        ${corpo}
        <p style="margin:26px 0 0;padding-top:18px;border-top:1px solid ${COR.borda};font-size:14px;color:${COR.suave};line-height:1.55">
          Dúvidas? É só responder este e-mail que a gente te ajuda.
        </p>
      </td></tr>
      <tr><td align="center" style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${COR.suave}">
        Siga a Tart Off no Instagram: <a href="${INSTAGRAM_URL}" style="color:${COR.ciano};text-decoration:none;font-weight:600">@${INSTAGRAM}</a><br>
        Aion Pharma Indústria Veterinária · <a href="${SITE}" style="color:${COR.suave}">aionpharma.ind.br</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function destinatario(pedido, para) {
  if (para) return [para];
  const email = pedido.cliente?.email;
  return email ? [email] : [];
}

function montar(pedido, { para, teste }, { assunto, titulo, preheader, etapa, corpo, texto }) {
  const to = destinatario(pedido, para);
  if (!to.length) return Promise.resolve({ pulado: 'cliente sem e-mail' });
  return enviar({
    to,
    subject: `${teste ? '[TESTE] ' : ''}${assunto}`,
    html: moldura({ titulo, preheader, etapa, corpo }),
    texto,
  });
}

/* ── 1. Pedido recebido (pagamento pendente) ───────────────────── */

/**
 * Dados de pagamento pendente do Mercado Pago (payment):
 *   Pix    → point_of_interaction.transaction_data.qr_code / ticket_url
 *   boleto → transaction_details.external_resource_url, barcode.content
 *   cartão em análise → status in_process
 */
export function pendenciaDoPagamento(pagamento) {
  if (!pagamento) return { tipo: 'outro' };
  const tipo = pagamento.payment_type_id;
  const td = pagamento.point_of_interaction?.transaction_data || {};
  const vence = pagamento.date_of_expiration || null;
  if (pagamento.payment_method_id === 'pix' || tipo === 'bank_transfer') {
    return { tipo: 'pix', codigo: td.qr_code || '', link: td.ticket_url || '', vence };
  }
  if (tipo === 'ticket') {
    return {
      tipo: 'boleto',
      codigo: pagamento.barcode?.content || '',
      link: pagamento.transaction_details?.external_resource_url || '',
      vence,
    };
  }
  if (pagamento.status === 'in_process') return { tipo: 'analise' };
  return { tipo: 'outro' };
}

export function htmlPedidoRecebido(pedido, pagamento) {
  const p = pendenciaDoPagamento(pagamento);
  let bloco = '';
  let intro = 'Recebemos o seu pedido e estamos aguardando a confirmação do pagamento.';
  if (p.tipo === 'pix') {
    intro = 'Recebemos o seu pedido. Falta só o pagamento via Pix: assim que ele cair, você recebe a confirmação.';
    bloco = destaque(
      'Pix copia e cola',
      `<p style="margin:0 0 12px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.5;word-break:break-all;color:${COR.texto}">${escapar(p.codigo)}</p>
       ${p.vence ? `<p style="margin:0 0 12px;font-size:14px;color:${COR.alerta}"><strong>Pague até ${escapar(dataHoraBr(p.vence))}</strong> — depois disso o código expira.</p>` : ''}
       ${p.link ? botao('Ver QR Code e pagar', p.link) : ''}`
    );
  } else if (p.tipo === 'boleto') {
    intro = 'Recebemos o seu pedido. Falta só o pagamento do boleto: a compensação leva até 2 dias úteis.';
    bloco = destaque(
      'Boleto',
      `${p.codigo ? `<p style="margin:0 0 12px;font-family:Consolas,Menlo,monospace;font-size:13px;word-break:break-all">${escapar(p.codigo)}</p>` : ''}
       ${p.vence ? `<p style="margin:0 0 12px;font-size:14px;color:${COR.alerta}"><strong>Vencimento: ${escapar(dataHoraBr(p.vence).split(' ')[0])}</strong></p>` : ''}
       ${p.link ? botao('Abrir boleto', p.link) : ''}`
    );
  } else if (p.tipo === 'analise') {
    intro = 'Recebemos o seu pedido. O pagamento está em análise pelo Mercado Pago — normalmente isso leva poucos minutos, e você recebe a confirmação por e-mail.';
  }
  return { intro, bloco, p };
}

export async function enviarPedidoRecebido(pedido, { pagamento, para, teste } = {}) {
  const { intro, bloco, p } = htmlPedidoRecebido(pedido, pagamento);
  const corpo = `
    ${paragrafo(escapar(intro))}
    ${paragrafo(`<strong>Pedido nº ${escapar(pedido.numero)}</strong>`)}
    ${bloco}
    ${tabelaItens(pedido)}`;
  const texto = `Recebemos o seu pedido ${pedido.numero}. ${intro}
${p.codigo ? `${p.tipo === 'pix' ? 'Pix copia e cola' : 'Linha digitável'}: ${p.codigo}\n` : ''}${p.vence ? `Prazo: ${dataHoraBr(p.vence)}\n` : ''}${p.link ? `Pagar: ${p.link}\n` : ''}Total: ${brl(pedido.total_pedido)}`;
  return montar(pedido, { para, teste }, {
    assunto: `Recebemos seu pedido nº ${pedido.numero}${p.tipo === 'pix' ? ' — falta o Pix' : p.tipo === 'boleto' ? ' — falta o boleto' : ''} — Aion Pharma`,
    titulo: 'Recebemos o seu pedido',
    preheader: p.tipo === 'pix' ? 'Pague com Pix para confirmar o pedido.' : 'Estamos aguardando a confirmação do pagamento.',
    etapa: 'recebido',
    corpo,
    texto,
  });
}

/* ── 2. Pagamento aprovado ─────────────────────────────────────── */

export async function enviarConfirmacaoCliente(pedido, { prazoDias, para, teste } = {}) {
  const c = pedido.cliente || {};
  const prazo = Number(prazoDias) > 0
    ? paragrafo(`Prazo estimado de entrega: <strong>até ${Number(prazoDias)} dias úteis</strong>.`)
    : '';
  const corpo = `
    ${paragrafo('Recebemos a confirmação do seu pagamento. Já estamos preparando o seu pedido — quando ele sair, você recebe o código de rastreio.')}
    ${paragrafo(`<strong>Pedido nº ${escapar(pedido.numero)}</strong>`)}
    ${prazo}
    ${tabelaItens(pedido)}
    ${rotulo('Entrega')}
    ${blocoEndereco(c)}`;
  const texto = `Pedido ${pedido.numero} confirmado.
Total ${brl(pedido.total_pedido)} (frete ${brl(pedido.valor_frete)}).
${Number(prazoDias) > 0 ? `Prazo estimado: até ${Number(prazoDias)} dias úteis.\n` : ''}Entrega: ${c.endereco || ''}, ${c.numero || ''} - ${c.cidade || ''}/${c.uf || ''}, CEP ${c.cep || ''}.
Assim que o pacote sair, enviamos o código de rastreio.`;
  return montar(pedido, { para, teste }, {
    assunto: `Pedido ${pedido.numero} confirmado — Aion Pharma`,
    titulo: 'Pagamento confirmado 🐾',
    preheader: 'Seu pagamento foi aprovado e o pedido já está em preparação.',
    etapa: 'aprovado',
    corpo,
    texto,
  });
}

/* ── 3. Pagamento não aprovado / Pix expirado ──────────────────── */

export async function enviarPagamentoNaoAprovado(pedido, { link, motivo, para, teste } = {}) {
  const expirou = motivo === 'expirado';
  const linkFinal = link || `${SITE}/produtos`;
  const corpo = `
    ${paragrafo(
      expirou
        ? 'O prazo do Pix do seu pedido terminou antes de o pagamento ser identificado, então ele não foi confirmado.'
        : 'O pagamento do seu pedido não foi aprovado. Isso acontece por vários motivos (limite, dados do cartão, análise do banco) e normalmente se resolve tentando de novo ou com outra forma de pagamento.'
    )}
    ${paragrafo(`<strong>Pedido nº ${escapar(pedido.numero)}</strong>`)}
    ${destaque(
      'Tentar de novo',
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">O link do seu pedido continua valendo: é só abrir e escolher Pix, cartão ou boleto.</p>
       ${botao('Pagar meu pedido', linkFinal, COR.ciano)}`
    )}
    ${tabelaItens(pedido)}`;
  const texto = `${expirou ? 'O Pix do' : 'O pagamento do'} pedido ${pedido.numero} não foi ${expirou ? 'pago a tempo' : 'aprovado'}.
Tente de novo: ${linkFinal}`;
  return montar(pedido, { para, teste }, {
    assunto: expirou
      ? `O Pix do pedido ${pedido.numero} expirou — Aion Pharma`
      : `Pagamento do pedido ${pedido.numero} não aprovado — Aion Pharma`,
    titulo: expirou ? 'O Pix expirou' : 'Pagamento não aprovado',
    preheader: 'Seu pedido ainda pode ser pago: é só tentar de novo pelo link.',
    corpo,
    texto,
  });
}

/* ── 4. Pedido faturado (nota emitida) ─────────────────────────── */

export async function enviarPedidoFaturado(pedido, { danfe, para, teste } = {}) {
  const corpo = `
    ${paragrafo('A nota fiscal do seu pedido foi emitida e ele já está em separação. O próximo passo é a postagem — aí você recebe o código de rastreio.')}
    ${paragrafo(`<strong>Pedido nº ${escapar(pedido.numero)}</strong>`)}
    ${danfe ? destaque('Nota fiscal', botao('Ver nota fiscal (DANFE)', danfe)) : ''}
    ${tabelaItens(pedido, { totais: false })}`;
  const texto = `A nota fiscal do pedido ${pedido.numero} foi emitida e ele está em separação.
${danfe ? `Nota fiscal: ${danfe}\n` : ''}Quando sair, enviamos o código de rastreio.`;
  return montar(pedido, { para, teste }, {
    assunto: `Pedido ${pedido.numero} faturado — nota fiscal emitida — Aion Pharma`,
    titulo: 'Nota fiscal emitida',
    preheader: 'Seu pedido está em separação e logo sai para entrega.',
    etapa: 'faturado',
    corpo,
    texto,
  });
}

/* ── 5. Pedido enviado (rastreio) ──────────────────────────────── */

export async function enviarPedidoEnviado(pedido, { para, teste } = {}) {
  const c = pedido.cliente || {};
  const { codigo, url, transportadora, servico } = envioDo(pedido);

  const bloco = codigo
    ? destaque(
        'Código de rastreio',
        `<p style="margin:0 0 12px;font-size:20px;font-weight:700;letter-spacing:.04em;color:${COR.navy}">${escapar(codigo)}</p>
         ${url ? botao('Acompanhar entrega', url, COR.ciano) : ''}`
      )
    : paragrafo('O código de rastreio ainda não foi liberado pela transportadora. Se precisar dele, é só responder este e-mail.');

  const corpo = `
    ${paragrafo(`Boa notícia: seu pedido saiu para entrega${transportadora ? ` pela <strong>${escapar(transportadora)}</strong>` : ''}.`)}
    ${paragrafo(`<strong>Pedido nº ${escapar(pedido.numero)}</strong>${servico && servico !== transportadora ? `<br><span style="color:${COR.suave};font-size:14px">${escapar(servico)}</span>` : ''}`)}
    ${bloco}
    ${tabelaItens(pedido, { totais: false })}
    ${rotulo('Entrega')}
    ${blocoEndereco(c)}`;

  const texto = `Seu pedido ${pedido.numero} foi enviado${transportadora ? ` pela ${transportadora}` : ''}.
${codigo ? `Código de rastreio: ${codigo}${url ? `\nAcompanhe: ${url}` : ''}` : 'O código de rastreio ainda não foi liberado pela transportadora; se precisar, responda este e-mail.'}
Entrega: ${c.endereco || ''}, ${c.numero || ''} - ${c.cidade || ''}/${c.uf || ''}, CEP ${c.cep || ''}.`;

  return montar(pedido, { para, teste }, {
    assunto: `Pedido ${pedido.numero} enviado${codigo ? ` — rastreio ${codigo}` : ''} — Aion Pharma`,
    titulo: 'Seu pedido foi enviado 📦',
    preheader: codigo ? `Rastreio ${codigo}${transportadora ? ` · ${transportadora}` : ''}` : 'Seu pedido saiu para entrega.',
    etapa: 'enviado',
    corpo,
    texto,
  });
}

/* ── 6. Pós-entrega ────────────────────────────────────────────── */

/**
 * Cupom de recompra — configurável e VAZIO até a Aion definir:
 *   POS_ENTREGA_CUPOM            código (já cadastrado no painel de cupons)
 *   POS_ENTREGA_CUPOM_DESCONTO   texto do benefício, ex. "10% de desconto"
 *   POS_ENTREGA_CUPOM_INICIO     AAAA-MM-DD (opcional)
 *   POS_ENTREGA_CUPOM_FIM        AAAA-MM-DD (opcional)
 * Fora da validade (ou sem código), o e-mail sai sem o bloco do cupom.
 */
export function cupomPosEntrega(hojeIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())) {
  const codigo = limpo(process.env.POS_ENTREGA_CUPOM).toUpperCase();
  if (!codigo) return null;
  const inicio = limpo(process.env.POS_ENTREGA_CUPOM_INICIO);
  const fim = limpo(process.env.POS_ENTREGA_CUPOM_FIM);
  if (inicio && hojeIso < inicio) return null;
  if (fim && hojeIso > fim) return null;
  return { codigo, desconto: limpo(process.env.POS_ENTREGA_CUPOM_DESCONTO), fim: fim || null };
}

export async function enviarPosEntrega(pedido, { cupom = cupomPosEntrega(), para, teste } = {}) {
  const avaliacao = limpo(process.env.POS_ENTREGA_AVALIACAO_URL);
  const blocoCupom = cupom
    ? destaque(
        'Presente pra próxima compra',
        `<p style="margin:0 0 6px;font-size:22px;font-weight:700;letter-spacing:.06em;color:${COR.navy}">${escapar(cupom.codigo)}</p>
         <p style="margin:0 0 12px;font-size:14px;line-height:1.5">${cupom.desconto ? `${escapar(cupom.desconto)} na loja. ` : ''}${cupom.fim ? `Válido até ${escapar(dataBr(cupom.fim))}.` : ''}</p>
         ${botao('Comprar de novo', `${SITE}/produtos`, COR.ciano)}`
      )
    : '';
  const corpo = `
    ${paragrafo(`Seu pedido nº <strong>${escapar(pedido.numero)}</strong> já deve ter chegado. Chegou tudo certo?`)}
    ${paragrafo('Se algo não estiver como esperado, responda este e-mail que a gente resolve.')}
    ${destaque(
      'Conta pra gente',
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">A sua opinião ajuda outros tutores a escolher. Poste uma foto do seu pet e marque <strong>@${INSTAGRAM}</strong> — a gente adora ver!</p>
       ${botao(avaliacao ? 'Avaliar minha compra' : `Ver @${INSTAGRAM}`, avaliacao || INSTAGRAM_URL)}`
    )}
    ${blocoCupom}
    ${tabelaItens(pedido, { totais: false })}`;
  const texto = `Seu pedido ${pedido.numero} chegou bem? Se algo não estiver certo, responda este e-mail.
Marque @${INSTAGRAM} no Instagram${avaliacao ? ` ou avalie: ${avaliacao}` : ''}.
${cupom ? `Cupom pra próxima compra: ${cupom.codigo}${cupom.desconto ? ` (${cupom.desconto})` : ''}${cupom.fim ? `, válido até ${dataBr(cupom.fim)}` : ''}.` : ''}`;
  return montar(pedido, { para, teste }, {
    assunto: `Chegou tudo certo com o pedido ${pedido.numero}? — Aion Pharma`,
    titulo: 'Chegou tudo certo? 🐶',
    preheader: 'Conta pra gente como foi a sua compra.',
    corpo,
    texto,
  });
}

/* ── Equipe: aviso de venda ────────────────────────────────────── */

export async function enviarAvisoLoja(pedido) {
  if (!ADMIN.length) return { pulado: 'EMAIL_ADMIN não configurado' };
  const c = pedido.cliente || {};
  const corpo = `
    ${paragrafo('Pagamento aprovado na loja online. Fature e gere a etiqueta pela <strong>expedição do Olist Envios</strong> (é isso que manda o rastreio pro cliente).')}
    ${paragrafo(`<strong>Pedido nº ${escapar(pedido.numero)}</strong><br>
      <span style="font-size:14px;color:${COR.suave}">${escapar(c.nome || '')} · ${escapar(c.cpf_cnpj || '')}<br>${escapar(c.fone || '')} · ${escapar(c.email || '')}</span>`)}
    ${tabelaItens(pedido)}
    ${rotulo('Enviar para')}
    ${blocoEndereco(c)}
    ${pedido.forma_frete || pedido.forma_envio ? paragrafo(`<br><strong>Envio:</strong> ${escapar([pedido.nome_transportador, pedido.forma_frete].filter(Boolean).join(' · ') || pedido.forma_envio)}`) : ''}`;
  const texto = `Venda aprovada — pedido ${pedido.numero}
Cliente: ${c.nome || ''} (${c.cpf_cnpj || ''}) ${c.fone || ''} ${c.email || ''}
Total ${brl(pedido.total_pedido)} (frete ${brl(pedido.valor_frete)})
Enviar para: ${c.endereco || ''}, ${c.numero || ''} - ${c.bairro || ''}, ${c.cidade || ''}/${c.uf || ''} CEP ${c.cep || ''}`;
  return enviar({
    to: ADMIN,
    subject: `💰 Venda aprovada — pedido ${pedido.numero} (${brl(pedido.total_pedido)})`,
    html: moldura({ titulo: 'Nova venda na loja online', corpo }),
    texto,
  });
}

export default {
  enviarPedidoRecebido,
  enviarConfirmacaoCliente,
  enviarPagamentoNaoAprovado,
  enviarPedidoFaturado,
  enviarPedidoEnviado,
  enviarPosEntrega,
  enviarAvisoLoja,
};
