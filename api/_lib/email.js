/* ================================================================
   E-mails transacionais da loja (Resend)
   ----------------------------------------------------------------
   Dois e-mails, disparados quando o pagamento é APROVADO:
     · cliente — confirmação da compra e o que acontece agora
     · loja    — aviso de venda com o que a equipe precisa para separar

   Remetente: `envio.aionpharma.ind.br`, subdomínio próprio com SPF e
   DKIM verificados (não usar domínio de terceiro: e-mail da Aion tem
   que sair com a cara da Aion, senão cai em spam e confunde o cliente).

   Nada aqui pode derrubar o webhook: se o e-mail falhar, o pedido
   continua aprovado e a falha vai só para o log.
   ================================================================ */

const RESEND_URL = 'https://api.resend.com/emails';

const FROM = process.env.EMAIL_FROM || 'Aion Pharma <pedidos@envio.aionpharma.ind.br>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'comercial@tartoff.com.br';
const ADMIN = (process.env.EMAIL_ADMIN || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

const brl = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const escapar = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

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
    body: JSON.stringify({
      from: FROM,
      to,
      reply_to: REPLY_TO,
      subject,
      html,
      text: texto,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data?.message || 'falha'}`);
  return data;
}

/* ── Peças visuais ─────────────────────────────────────────────── */

function linhaItens(itens) {
  return (itens || [])
    .map(
      (it) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee">
          ${escapar(it.descricao)}<br>
          <span style="color:#777;font-size:13px">${escapar(it.quantidade)} × ${brl(it.valor_unitario)}</span>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
          ${brl(Number(it.quantidade) * Number(it.valor_unitario))}
        </td>
      </tr>`
    )
    .join('');
}

function moldura(titulo, corpo) {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c2b3a">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin:0 0 6px;font-size:20px">${escapar(titulo)}</h1>
      ${corpo}
    </div>
    <p style="text-align:center;color:#8a97a5;font-size:12px;margin:18px 0 0">
      Aion Pharma Indústria Veterinária · <a href="https://www.aionpharma.ind.br" style="color:#8a97a5">aionpharma.ind.br</a>
    </p>
  </div>
</body></html>`;
}

function blocoEndereco(c) {
  const linha2 = [c.bairro, c.cidade, c.uf].filter(Boolean).join(' · ');
  return `${escapar(c.endereco || '')}, ${escapar(c.numero || 's/n')}${
    c.complemento ? ' - ' + escapar(c.complemento) : ''
  }<br>${escapar(linha2)}<br>CEP ${escapar(c.cep || '')}`;
}

/* ── Cliente ───────────────────────────────────────────────────── */

export async function enviarConfirmacaoCliente(pedido) {
  const c = pedido.cliente || {};
  if (!c.email) return { pulado: 'cliente sem e-mail' };

  const itens = (pedido.itens || []).map((i) => i.item || i);
  const total = Number(pedido.total_pedido || 0);
  const frete = Number(pedido.valor_frete || 0);
  const subtotal = total - frete;

  const corpo = `
    <p style="margin:0 0 18px;color:#4a5b6c;line-height:1.55">
      Recebemos a confirmação do seu pagamento. Já estamos preparando o envio —
      quando o pacote sair, você recebe o código de rastreio.
    </p>
    <p style="margin:0 0 18px;font-size:14px">
      <strong>Pedido nº ${escapar(pedido.numero)}</strong>
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${linhaItens(itens)}
      <tr><td style="padding:10px 0;color:#4a5b6c">Frete</td>
          <td style="padding:10px 0;text-align:right">${brl(frete)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:700">Total</td>
          <td style="padding:10px 0;text-align:right;font-weight:700">${brl(total)}</td></tr>
    </table>
    <p style="margin:20px 0 6px;font-size:13px;color:#8a97a5;text-transform:uppercase;letter-spacing:.04em">Entrega</p>
    <p style="margin:0;font-size:14px;line-height:1.5">${blocoEndereco(c)}</p>
    <p style="margin:24px 0 0;font-size:14px;color:#4a5b6c">
      Qualquer dúvida, é só responder este e-mail.
    </p>`;

  const texto = `Pedido ${pedido.numero} confirmado.
Subtotal ${brl(subtotal)} + frete ${brl(frete)} = ${brl(total)}.
Entrega: ${c.endereco || ''}, ${c.numero || ''} - ${c.cidade || ''}/${c.uf || ''}, CEP ${c.cep || ''}.
Assim que o pacote sair, enviamos o código de rastreio.`;

  return enviar({
    to: [c.email],
    subject: `Pedido ${pedido.numero} confirmado — Aion Pharma`,
    html: moldura('Pagamento confirmado 🐾', corpo),
    texto,
  });
}

/* ── Cliente: pedido enviado (rastreio) ────────────────────────── */

/**
 * Disparado pela rotina de envios (api/_lib/envios.js) quando o pedido
 * sai. Sem código no Tiny, avisa que saiu e diz que o código vem depois.
 * `para` + `teste` = prova para um endereço nosso (assunto marcado).
 */
export async function enviarPedidoEnviado(pedido, { para, teste = false } = {}) {
  const c = pedido.cliente || {};
  const destino = para ? [para] : c.email ? [c.email] : [];
  if (!destino.length) return { pulado: 'cliente sem e-mail' };

  const itens = (pedido.itens || []).map((i) => i.item || i);
  const codigo = String(pedido.codigo_rastreamento || '').trim();
  let url = String(pedido.url_rastreamento || '').trim();
  if (!url && codigo && /OLIST/i.test(String(pedido.forma_envio || ''))) {
    url = `https://envios.olist.com/rastreios/pacote/${encodeURIComponent(codigo)}`;
  }
  const frete = String(pedido.forma_frete || '').trim();
  const transportadora = String(pedido.nome_transportador || '').trim() || frete.split(' - ')[0] || '';

  const blocoRastreio = codigo
    ? `
    <div style="background:#f4f6f8;border-radius:10px;padding:16px;margin:0 0 20px">
      <p style="margin:0 0 4px;font-size:13px;color:#8a97a5;text-transform:uppercase;letter-spacing:.04em">Código de rastreio</p>
      <p style="margin:0 0 12px;font-size:18px;font-weight:700;letter-spacing:.03em">${escapar(codigo)}</p>
      ${
        url
          ? `<a href="${escapar(url)}" style="display:inline-block;background:#1c2b3a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Acompanhar entrega</a>`
          : ''
      }
    </div>`
    : `
    <p style="margin:0 0 20px;color:#4a5b6c;line-height:1.55;font-size:14px">
      O código de rastreio ainda não foi liberado pela transportadora. Se precisar dele,
      é só responder este e-mail.
    </p>`;

  const corpo = `
    <p style="margin:0 0 18px;color:#4a5b6c;line-height:1.55">
      Boa notícia: seu pedido saiu para entrega${transportadora ? ` pela <strong>${escapar(transportadora)}</strong>` : ''}.
    </p>
    <p style="margin:0 0 18px;font-size:14px">
      <strong>Pedido nº ${escapar(pedido.numero)}</strong>
      ${frete && frete !== transportadora ? `<br><span style="color:#777">${escapar(frete)}</span>` : ''}
    </p>
    ${blocoRastreio}
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${linhaItens(itens)}
    </table>
    <p style="margin:20px 0 6px;font-size:13px;color:#8a97a5;text-transform:uppercase;letter-spacing:.04em">Entrega</p>
    <p style="margin:0;font-size:14px;line-height:1.5">${blocoEndereco(c)}</p>
    <p style="margin:24px 0 0;font-size:14px;color:#4a5b6c">
      Qualquer dúvida, é só responder este e-mail.
    </p>`;

  const texto = `Seu pedido ${pedido.numero} foi enviado${transportadora ? ` pela ${transportadora}` : ''}.
${codigo ? `Código de rastreio: ${codigo}${url ? `\nAcompanhe: ${url}` : ''}` : 'O código de rastreio ainda não foi liberado pela transportadora; se precisar, responda este e-mail.'}
Itens: ${itens.map((i) => `${i.quantidade} × ${i.descricao}`).join('; ')}
Entrega: ${c.endereco || ''}, ${c.numero || ''} - ${c.cidade || ''}/${c.uf || ''}, CEP ${c.cep || ''}.`;

  return enviar({
    to: destino,
    subject: `${teste ? '[TESTE] ' : ''}Pedido ${pedido.numero} enviado${codigo ? ` — rastreio ${codigo}` : ''} — Aion Pharma`,
    html: moldura('Seu pedido foi enviado 📦', corpo),
    texto,
  });
}

/* ── Loja ──────────────────────────────────────────────────────── */

export async function enviarAvisoLoja(pedido) {
  if (!ADMIN.length) return { pulado: 'EMAIL_ADMIN não configurado' };

  const c = pedido.cliente || {};
  const itens = (pedido.itens || []).map((i) => i.item || i);

  const corpo = `
    <p style="margin:0 0 18px;color:#4a5b6c;line-height:1.55">
      Pagamento aprovado na loja online. Separe e gere a etiqueta no painel da Olist.
    </p>
    <p style="margin:0 0 4px;font-size:14px"><strong>Pedido nº ${escapar(pedido.numero)}</strong></p>
    <p style="margin:0 0 18px;font-size:14px;color:#4a5b6c">
      ${escapar(c.nome || '')} · ${escapar(c.cpf_cnpj || '')}<br>
      ${escapar(c.fone || '')} · ${escapar(c.email || '')}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${linhaItens(itens)}
      <tr><td style="padding:10px 0;color:#4a5b6c">Frete</td>
          <td style="padding:10px 0;text-align:right">${brl(pedido.valor_frete)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:700">Total</td>
          <td style="padding:10px 0;text-align:right;font-weight:700">${brl(pedido.total_pedido)}</td></tr>
    </table>
    <p style="margin:20px 0 6px;font-size:13px;color:#8a97a5;text-transform:uppercase;letter-spacing:.04em">Enviar para</p>
    <p style="margin:0;font-size:14px;line-height:1.5">${blocoEndereco(c)}</p>
    ${
      pedido.forma_envio
        ? `<p style="margin:16px 0 0;font-size:14px"><strong>Envio:</strong> ${escapar(pedido.forma_envio)}</p>`
        : ''
    }`;

  const texto = `Venda aprovada — pedido ${pedido.numero}
Cliente: ${c.nome || ''} (${c.cpf_cnpj || ''}) ${c.fone || ''} ${c.email || ''}
Total ${brl(pedido.total_pedido)} (frete ${brl(pedido.valor_frete)})
Enviar para: ${c.endereco || ''}, ${c.numero || ''} - ${c.bairro || ''}, ${c.cidade || ''}/${c.uf || ''} CEP ${c.cep || ''}
Envio: ${pedido.forma_envio || '-'}`;

  return enviar({
    to: ADMIN,
    subject: `💰 Venda aprovada — pedido ${pedido.numero} (${brl(pedido.total_pedido)})`,
    html: moldura('Nova venda na loja online', corpo),
    texto,
  });
}

export default { enviarConfirmacaoCliente, enviarAvisoLoja, enviarPedidoEnviado };
