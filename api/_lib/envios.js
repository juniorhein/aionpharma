/* ================================================================
   E-mail de "pedido enviado" (rastreio) — rotina sobre o Tiny
   ----------------------------------------------------------------
   Depois do "Pedido X confirmado", o cliente ficava sem notícia
   (pedido 347, 09/11/2026). Aqui a loja olha o Tiny de tempos em
   tempos e manda UM e-mail por pedido quando ele sai:

   De onde vem o envio (verificado no Tiny em 09/11/2026):
     · Olist Envios grava `codigo_rastreamento` + `url_rastreamento`
       no pedido quando a equipe fatura e CONCLUI A EXPEDIÇÃO (etiqueta)
       no Olist. Provado no pedido 323: "Pronto para envio" já com o
       código L7DRGBISCOGYO0 e o link envios.olist.com/rastreios/...
     · Pedido que só foi faturado (NF) ainda não saiu: sem e-mail.

   Regra de disparo (pedido da LOJA ONLINE, feito a partir de
   ENVIO_EMAIL_DESDE):
     · tem código de rastreio no Tiny            → e-mail com código e link
     · situação "Enviado"/"Entregue" sem código  → e-mail "foi enviado",
       e fica registrado `sem_rastreio = true`
   Cada pedido vira uma linha em `envio_emails` ANTES do envio
   (insert ... on conflict do nothing): duas rodadas ao mesmo tempo
   não duplicam. Se o Resend falhar, a linha sai e a próxima rodada
   tenta de novo.

   Limite do Tiny é da CONTA (dividido com a vitrine): cada rodada faz
   1 chamada de lista por página + no máximo `maxDetalhes` pedido.obter,
   com pausa. Pedido que não é da loja fica gravado como "ignorado" e
   não é consultado de novo.
   ================================================================ */

import { getPool } from './db.js';
import { pesquisarPedidos, obterPedido } from './tiny.js';
import { canalDoPedido } from './vendas.js';
import { enviarPedidoEnviado } from './email.js';

// Pedidos anteriores não recebem o e-mail (evita disparo em massa
// retroativo). 08/11/2026 inclui o 347, que motivou o e-mail.
const DESDE_PADRAO = '2026-11-08';
const JANELA_DIAS = 60;
const SITUACOES_SAIU = ['Enviado', 'Entregue'];

const SCHEMA = `
create table if not exists public.envio_emails (
  id_tiny text primary key,
  numero text,
  status text not null,              -- enviando | enviado | ignorado | sem_email
  motivo text,
  email text,
  situacao text,
  transportadora text,
  codigo_rastreamento text,
  url_rastreamento text,
  sem_rastreio boolean not null default false,
  resend_id text,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);
`;

let tabelaPronta = false;
async function garantirTabela() {
  if (tabelaPronta) return;
  await getPool().query(SCHEMA);
  tabelaPronta = true;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** "21/10/2026" → "2026-10-21" */
function dataIso(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(br || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** ISO → "dd/mm/aaaa" */
const dataBr = (iso) => iso.split('-').reverse().join('/');

function hojeIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function desdeIso() {
  const env = String(process.env.ENVIO_EMAIL_DESDE || '').trim();
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(env) ? env : DESDE_PADRAO;
  const janela = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString().slice(0, 10);
  return desde > janela ? desde : janela;
}

const limpo = (v) => String(v ?? '').trim();

/** Pela lista (barato): o pedido parece ter saído? */
function saiuPelaLista(p) {
  return Boolean(limpo(p.codigo_rastreamento)) || SITUACOES_SAIU.includes(p.situacao);
}

/** Dados de envio do pedido completo (pedido.obter). */
export function dadosDeEnvio(o) {
  const codigo = limpo(o.codigo_rastreamento) || null;
  let url = limpo(o.url_rastreamento) || null;
  // Olist Envios: o Tiny costuma trazer o link; se vier só o código,
  // o rastreio público do Olist é por código de pacote.
  if (!url && codigo && /OLIST/i.test(String(o.forma_envio || ''))) {
    url = `https://envios.olist.com/rastreios/pacote/${encodeURIComponent(codigo)}`;
  }
  const frete = limpo(o.forma_frete);
  const transportadora = limpo(o.nome_transportador) || frete.split(' - ')[0] || null;
  const servico = frete && transportadora && frete.startsWith(transportadora) ? frete : null;
  return { codigo, url, transportadora, servico };
}

/** O pedido completo está pronto para o e-mail de envio? */
function saiuDetalhe(o) {
  return Boolean(limpo(o.codigo_rastreamento)) || SITUACOES_SAIU.includes(o.situacao);
}

async function registrar(o, status, extra = {}) {
  const env = dadosDeEnvio(o);
  const { rows } = await getPool().query(
    `insert into envio_emails
       (id_tiny, numero, status, motivo, email, situacao, transportadora, codigo_rastreamento, url_rastreamento, sem_rastreio)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id_tiny) do nothing
     returning id_tiny`,
    [
      String(o.id),
      o.numero ? String(o.numero) : null,
      status,
      extra.motivo || null,
      o.cliente?.email || null,
      o.situacao || null,
      env.transportadora,
      env.codigo,
      env.url,
      !env.codigo,
    ]
  );
  return rows.length > 0;
}

/**
 * Uma rodada. `simular` não grava nada nem manda e-mail: só diz o que
 * faria (para conferir antes de ligar e no QA).
 */
export async function rodarEnvios({ simular = false, maxDetalhes = 5, pausaMs = 1500, orcamentoMs = 40000 } = {}) {
  const inicio = Date.now();
  await garantirTabela();
  const pool = getPool();
  const desde = desdeIso();

  // 1. Lista do Tiny desde a data de corte (100 por página).
  const lista = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await pesquisarPedidos({ pagina, dataInicial: dataBr(desde), dataFinal: dataBr(hojeIso()) });
    lista.push(...r.pedidos);
    if (pagina >= r.paginas) break;
  }

  // 2. Só os que parecem ter saído e ainda não foram tratados.
  const ids = lista.map((p) => String(p.id));
  const { rows: jaTratados } = ids.length
    ? await pool.query('select id_tiny from envio_emails where id_tiny = any($1)', [ids])
    : { rows: [] };
  const tratados = new Set(jaTratados.map((r) => r.id_tiny));
  const candidatos = lista.filter(
    (p) => !tratados.has(String(p.id)) && saiuPelaLista(p) && (dataIso(p.data_pedido) || '') >= desde
  );

  const resultado = { desde, listados: lista.length, candidatos: candidatos.length, acoes: [], bloqueio: null };

  // 3. Detalhe (caro) e envio.
  for (const p of candidatos.slice(0, maxDetalhes)) {
    if (Date.now() - inicio > orcamentoMs) break;
    let o;
    try {
      o = await obterPedido(p.id);
    } catch (err) {
      resultado.bloqueio = err.message; // limite do Tiny: tenta na próxima rodada
      break;
    }
    await espera(pausaMs);
    if (!o) continue;

    const acao = { numero: o.numero, id_tiny: String(o.id), situacao: o.situacao };
    const canal = canalDoPedido(o);
    if (canal !== 'loja' && canal !== 'loja_cnpj') {
      acao.resultado = `ignorado (canal ${canal})`;
      if (!simular) await registrar(o, 'ignorado', { motivo: `canal ${canal}` });
    } else if (!saiuDetalhe(o)) {
      acao.resultado = 'ainda não saiu';
    } else if (!o.cliente?.email) {
      acao.resultado = 'sem e-mail do cliente';
      if (!simular) await registrar(o, 'sem_email', { motivo: 'cliente sem e-mail no Tiny' });
    } else if (simular) {
      const env = dadosDeEnvio(o);
      acao.resultado = env.codigo ? `mandaria com rastreio ${env.codigo}` : 'mandaria SEM código de rastreio';
    } else if (await registrar(o, 'enviando')) {
      try {
        const r = await enviarPedidoEnviado(o);
        const env = dadosDeEnvio(o);
        await pool.query(
          `update envio_emails set status = 'enviado', resend_id = $2, enviado_em = now(),
                  motivo = $3 where id_tiny = $1`,
          [String(o.id), r?.id || null, env.codigo ? null : 'enviado sem código de rastreio (não veio no Tiny)']
        );
        acao.resultado = env.codigo ? `enviado com rastreio ${env.codigo}` : 'enviado SEM código de rastreio';
        if (!env.codigo) console.warn(`[envios] pedido ${o.numero}: e-mail sem rastreio (Tiny sem código)`);
      } catch (err) {
        await pool.query(`delete from envio_emails where id_tiny = $1 and status = 'enviando'`, [String(o.id)]);
        acao.resultado = `falha no e-mail: ${err.message}`;
        console.error(`[envios] pedido ${o.numero}:`, err.message);
      }
    } else {
      acao.resultado = 'já tratado por outra rodada';
    }
    resultado.acoes.push(acao);
  }

  resultado.restantes = Math.max(0, candidatos.length - resultado.acoes.length);
  return resultado;
}

/** E-mail de prova: monta o e-mail real do pedido e manda só para `para`. */
export async function enviarTeste(idTiny, para) {
  const o = await obterPedido(idTiny);
  if (!o) throw new Error('Pedido não encontrado no Tiny');
  const r = await enviarPedidoEnviado(o, { para, teste: true });
  return { numero: o.numero, situacao: o.situacao, ...dadosDeEnvio(o), resend: r };
}

export async function listarRegistros(limite = 50) {
  await garantirTabela();
  const { rows } = await getPool().query(
    `select id_tiny, numero, status, motivo, situacao, transportadora, codigo_rastreamento,
            sem_rastreio, resend_id, criado_em::text, enviado_em::text
       from envio_emails order by criado_em desc limit $1`,
    [limite]
  );
  return rows;
}
