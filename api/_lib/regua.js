/* ================================================================
   Régua de e-mails do pedido da loja — QUANDO mandar cada e-mail
   ----------------------------------------------------------------
   Os modelos ficam em email.js; aqui ficam os gatilhos e o registro.

   Gatilhos (verificados em 09/11/2026):
     webhook do Mercado Pago (api/webhook.js → aoPagamento)
       · pending / in_process → 1. recebido (Pix/boleto com código e prazo)
       · approved             → 2. aprovado (+ aviso_loja pra equipe)
       · rejected / cancelled → marca a falha; a rotina decide o 3.
     rotina (cron → /api/admin/envios → rodarRegua), lendo o Tiny:
       · 3. nao_aprovado  falha registrada há 30+ min e pedido ainda não pago
                          (o cliente costuma tentar de novo em seguida)
       · 4. faturado      nota emitida (id_nota_fiscal) — DANFE pelo
                          nota.fiscal.obter.link do Tiny
       · 5. enviado       código de rastreio no Tiny (o Olist Envios grava
                          ao concluir a expedição — pedido 323) ou
                          situação Enviado/Entregue
       · 6. pos_entrega   7 dias depois do e-mail de envio

   Cada pedido × tipo é UMA linha em `emails_pedido` (chave dupla),
   gravada ANTES do envio (insert … on conflict do nothing): reenvio do
   MP ou duas rodadas ao mesmo tempo não duplicam. Se o Resend falhar,
   a linha sai e a próxima rodada tenta de novo.

   Flag: EMAILS_CLIENTE_ATIVOS = tipos ligados para o CLIENTE
   (vírgula; "todos" liga tudo). Padrão: só "aprovado". Tipo desligado
   grava status "desligado" — ao ligar depois, pedido antigo não recebe
   e-mail atrasado. O aviso pra equipe (aviso_loja) é sempre ligado.
   ================================================================ */

import { getPool } from './db.js';
import { pesquisarPedidos, obterPedido, linkNotaFiscal } from './tiny.js';
import { canalDoPedido, SITUACOES_CONFIRMADAS } from './vendas.js';
import {
  enviarPedidoRecebido,
  enviarConfirmacaoCliente,
  enviarPagamentoNaoAprovado,
  enviarPedidoFaturado,
  enviarPedidoEnviado,
  enviarPosEntrega,
  enviarAvisoLoja,
  cupomPosEntrega,
  envioDo,
} from './email.js';

export const TIPOS = ['recebido', 'aprovado', 'nao_aprovado', 'faturado', 'enviado', 'pos_entrega'];

// Pedidos anteriores ficam fora da rotina (sem disparo retroativo).
const DESDE_PADRAO = '2026-11-08';
const JANELA_DIAS = 60;
const SITUACOES_SAIU = ['Enviado', 'Entregue'];
const SITUACOES_NOTA = ['Faturado', 'Pronto para envio', ...SITUACOES_SAIU];
const ESPERA_NAO_APROVADO_MIN = 30;
const POS_ENTREGA_DIAS = 7;

const SCHEMA = `
create table if not exists public.emails_pedido (
  id_tiny text not null,
  tipo text not null,
  numero text,
  status text not null,              -- enviando | enviado | desligado | pulado | sem_email
  motivo text,
  para text,
  resend_id text,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  primary key (id_tiny, tipo)
);
create table if not exists public.pedidos_loja (
  id_tiny text primary key,
  numero text,
  email text,
  canal text not null default 'loja',  -- loja | outro
  pref_id text,
  link_pagamento text,
  prazo_dias int,
  pagamento_falhou_em timestamptz,
  pagamento_falha text,
  criado_em timestamptz not null default now()
);
`;

let tabelasProntas = false;
export async function garantirTabelas() {
  if (tabelasProntas) return;
  await getPool().query(SCHEMA);
  tabelasProntas = true;
}

/* ── Flag ───────────────────────────────────────────────────── */

export function tiposAtivos() {
  const bruto = process.env.EMAILS_CLIENTE_ATIVOS;
  const lista = (bruto === undefined ? 'aprovado' : bruto)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return lista.includes('todos') ? [...TIPOS] : lista.filter((t) => TIPOS.includes(t));
}

const ativo = (tipo) => tipo === 'aviso_loja' || tiposAtivos().includes(tipo);

/* ── Registro ───────────────────────────────────────────────── */

async function registrar(o, tipo, status, { motivo = null, para = null } = {}) {
  const { rows } = await getPool().query(
    `insert into emails_pedido (id_tiny, tipo, numero, status, motivo, para)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id_tiny, tipo) do nothing
     returning id_tiny`,
    [String(o.id), tipo, o.numero ? String(o.numero) : null, status, motivo, para]
  );
  return rows.length > 0;
}

/**
 * Manda o e-mail `tipo` do pedido `o` no máximo uma vez.
 * Banco fora do ar: aprovado/aviso_loja saem mesmo assim (era assim
 * antes da régua; melhor duplicar que o cliente ficar sem comprovante).
 */
export async function disparar(o, tipo, enviar) {
  const para = tipo === 'aviso_loja' ? 'equipe' : o.cliente?.email || null;
  try {
    await garantirTabelas();
    if (!ativo(tipo)) {
      await registrar(o, tipo, 'desligado', { motivo: 'flag EMAILS_CLIENTE_ATIVOS', para });
      return { tipo, resultado: 'desligado' };
    }
    if (!para) {
      await registrar(o, tipo, 'sem_email', { motivo: 'cliente sem e-mail no Tiny' });
      return { tipo, resultado: 'sem e-mail' };
    }
    if (!(await registrar(o, tipo, 'enviando', { para }))) return { tipo, resultado: 'já tratado' };
  } catch (dbErr) {
    if (tipo !== 'aprovado' && tipo !== 'aviso_loja') throw dbErr;
    console.error(`[regua] banco fora, mandando ${tipo} sem registro:`, dbErr.message);
    const r = await enviar();
    return { tipo, resultado: 'enviado sem registro', id: r?.id };
  }

  try {
    const r = await enviar();
    if (r?.pulado) {
      await getPool().query(
        `update emails_pedido set status = 'pulado', motivo = $3 where id_tiny = $1 and tipo = $2`,
        [String(o.id), tipo, r.pulado]
      );
      return { tipo, resultado: `pulado (${r.pulado})` };
    }
    await getPool().query(
      `update emails_pedido set status = 'enviado', resend_id = $3, enviado_em = now()
        where id_tiny = $1 and tipo = $2`,
      [String(o.id), tipo, r?.id || null]
    );
    return { tipo, resultado: 'enviado', id: r?.id };
  } catch (err) {
    await getPool()
      .query(`delete from emails_pedido where id_tiny = $1 and tipo = $2 and status = 'enviando'`, [String(o.id), tipo])
      .catch(() => {});
    throw err;
  }
}

async function pularTipo(o, tipo, motivo) {
  await registrar(o, tipo, 'pulado', { motivo });
}

/* ── Checkout: guarda o que o e-mail vai precisar depois ────── */

export async function registrarPedidoLoja({ idTiny, numero, email, prefId, link, prazoDias }) {
  await garantirTabelas();
  const prazo = Number(prazoDias);
  await getPool().query(
    `insert into pedidos_loja (id_tiny, numero, email, canal, pref_id, link_pagamento, prazo_dias)
     values ($1,$2,$3,'loja',$4,$5,$6)
     on conflict (id_tiny) do update set
       numero = excluded.numero, email = excluded.email, canal = 'loja',
       pref_id = excluded.pref_id, link_pagamento = excluded.link_pagamento, prazo_dias = excluded.prazo_dias`,
    [String(idTiny), numero ? String(numero) : null, email || null, prefId || null, link || null,
     prazo > 0 && prazo < 120 ? Math.round(prazo) : null]
  );
}

async function lerPedidoLoja(idTiny) {
  const { rows } = await getPool().query('select * from pedidos_loja where id_tiny = $1', [String(idTiny)]);
  return rows[0] || null;
}

/* ── Webhook do Mercado Pago ────────────────────────────────── */

export async function aoPagamento(pagamento) {
  const idTiny = String(pagamento.external_reference || '');
  if (!idTiny) return [];
  const status = pagamento.status;

  if (status === 'approved') {
    const pedido = await obterPedido(idTiny);
    if (!pedido) return [];
    const loja = await lerPedidoLoja(idTiny).catch(() => null);
    const r = await Promise.allSettled([
      disparar(pedido, 'aprovado', () => enviarConfirmacaoCliente(pedido, { prazoDias: loja?.prazo_dias })),
      disparar(pedido, 'aviso_loja', () => enviarAvisoLoja(pedido)),
    ]);
    return r.map((x) => (x.status === 'fulfilled' ? x.value : { erro: x.reason?.message || String(x.reason) }));
  }

  if (status === 'pending' || status === 'in_process') {
    const pedido = await obterPedido(idTiny);
    if (!pedido) return [];
    return [await disparar(pedido, 'recebido', () => enviarPedidoRecebido(pedido, { pagamento }))];
  }

  if (status === 'rejected' || status === 'cancelled') {
    await garantirTabelas();
    // Pix vencido chega como cancelled/expired; cartão recusado como rejected.
    const falha = status === 'cancelled' && /expir/i.test(String(pagamento.status_detail || ''))
      ? 'expirado'
      : `${status}:${pagamento.status_detail || ''}`;
    await getPool().query(
      `insert into pedidos_loja (id_tiny, canal, pagamento_falhou_em, pagamento_falha)
       values ($1, 'loja', now(), $2)
       on conflict (id_tiny) do update set pagamento_falhou_em = now(), pagamento_falha = excluded.pagamento_falha`,
      [idTiny, falha]
    );
    return [{ tipo: 'nao_aprovado', resultado: `falha registrada (${falha}); a rotina avisa se não pagar em ${ESPERA_NAO_APROVADO_MIN} min` }];
  }
  return [];
}

/* ── Rotina sobre o Tiny ────────────────────────────────────── */

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const limpo = (v) => String(v ?? '').trim();

function dataIso(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(br || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const dataBr = (iso) => iso.split('-').reverse().join('/');
const hojeIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function desdeIso() {
  const env = limpo(process.env.ENVIO_EMAIL_DESDE);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(env) ? env : DESDE_PADRAO;
  const janela = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString().slice(0, 10);
  return desde > janela ? desde : janela;
}

const temRastreio = (p) => Boolean(limpo(p.codigo_rastreamento));
const saiu = (p) => temRastreio(p) || SITUACOES_SAIU.includes(p.situacao);

/** Quais tipos o pedido parece dever, pelos dados baratos (lista + banco). */
function devidos(p, feitos, loja) {
  const due = [];
  if (SITUACOES_NOTA.includes(p.situacao) || temRastreio(p)) {
    if (!feitos.has('faturado')) due.push('faturado');
  }
  if (saiu(p) && !feitos.has('enviado')) due.push('enviado');
  if (loja?.pagamento_falhou_em && !feitos.has('nao_aprovado') && !SITUACOES_CONFIRMADAS.includes(p.situacao)) {
    const min = (Date.now() - new Date(loja.pagamento_falhou_em).getTime()) / 60000;
    if (min >= ESPERA_NAO_APROVADO_MIN && min <= 3 * 24 * 60) due.push('nao_aprovado');
  }
  return due;
}

/**
 * Uma rodada. `simular` não grava nem envia: só diz o que faria.
 * Tiny: 1 chamada de lista por página + até `maxPedidos` pedido.obter
 * (+ 1 do link da nota), com pausa — o limite é da conta e a vitrine
 * divide a mesma cota.
 */
export async function rodarRegua({ simular = false, maxPedidos = 5, pausaMs = 1500, orcamentoMs = 45000 } = {}) {
  const inicio = Date.now();
  await garantirTabelas();
  const pool = getPool();
  const desde = desdeIso();

  const lista = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await pesquisarPedidos({ pagina, dataInicial: dataBr(desde), dataFinal: dataBr(hojeIso()) });
    lista.push(...r.pedidos);
    if (pagina >= r.paginas) break;
  }
  const ids = lista.map((p) => String(p.id));

  const [{ rows: feitosRows }, { rows: lojaRows }, { rows: posRows }] = await Promise.all([
    pool.query('select id_tiny, tipo from emails_pedido where id_tiny = any($1)', [ids]),
    pool.query('select * from pedidos_loja where id_tiny = any($1)', [ids]),
    pool.query(
      `select e.id_tiny from emails_pedido e
        where e.tipo = 'enviado' and e.status = 'enviado'
          and e.enviado_em <= now() - make_interval(days => $1)
          and e.enviado_em >= now() - make_interval(days => $1 + 14)
          and not exists (select 1 from emails_pedido x where x.id_tiny = e.id_tiny and x.tipo = 'pos_entrega')`,
      [POS_ENTREGA_DIAS]
    ),
  ]);
  const feitos = new Map();
  for (const r of feitosRows) {
    if (!feitos.has(r.id_tiny)) feitos.set(r.id_tiny, new Set());
    feitos.get(r.id_tiny).add(r.tipo);
  }
  const lojas = new Map(lojaRows.map((r) => [r.id_tiny, r]));

  const fila = new Map();
  for (const p of lista) {
    const id = String(p.id);
    if (lojas.get(id)?.canal === 'outro') continue;
    if ((dataIso(p.data_pedido) || '') < desde) continue;
    const due = devidos(p, feitos.get(id) || new Set(), lojas.get(id));
    if (due.length) fila.set(id, due);
  }
  for (const { id_tiny } of posRows) fila.set(id_tiny, [...(fila.get(id_tiny) || []), 'pos_entrega']);

  const resultado = {
    desde,
    ativos: tiposAtivos(),
    listados: lista.length,
    pedidosNaFila: fila.size,
    acoes: [],
    bloqueio: null,
  };

  for (const [id, due] of fila) {
    if (resultado.acoes.length >= maxPedidos || Date.now() - inicio > orcamentoMs) break;
    let o;
    try {
      o = await obterPedido(id);
    } catch (err) {
      resultado.bloqueio = err.message; // limite do Tiny: continua na próxima rodada
      break;
    }
    await espera(pausaMs);
    if (!o) continue;

    const acao = { numero: o.numero, id_tiny: id, situacao: o.situacao, tipos: [] };
    resultado.acoes.push(acao);

    let loja = lojas.get(id);
    if (!loja) {
      const canal = canalDoPedido(o);
      const ehLoja = canal === 'loja' || canal === 'loja_cnpj';
      if (!simular) {
        await pool.query(
          `insert into pedidos_loja (id_tiny, numero, email, canal) values ($1,$2,$3,$4)
           on conflict (id_tiny) do update set canal = excluded.canal`,
          [id, o.numero ? String(o.numero) : null, o.cliente?.email || null, ehLoja ? 'loja' : 'outro']
        );
      }
      if (!ehLoja) {
        acao.tipos.push(`ignorado (canal ${canal})`);
        continue;
      }
      loja = { canal: 'loja' };
    }

    for (const tipo of due) {
      try {
        let nota = '';
        let fn = null;
        if (tipo === 'faturado') {
          if (due.includes('enviado') || saiu(o)) {
            if (!simular) await pularTipo(o, tipo, 'pedido já saiu: vai direto o e-mail de envio');
            acao.tipos.push('faturado: pulado (já saiu)');
            continue;
          }
          if (!(Number(o.id_nota_fiscal) > 0)) {
            acao.tipos.push('faturado: ainda sem nota');
            continue;
          }
          let danfe = null;
          try {
            danfe = await linkNotaFiscal(o.id_nota_fiscal);
          } catch (err) {
            nota = ` (sem link da DANFE: ${err.message})`;
          }
          fn = () => enviarPedidoFaturado(o, { danfe });
        } else if (tipo === 'enviado') {
          if (!saiu(o)) {
            acao.tipos.push('enviado: ainda não saiu');
            continue;
          }
          const env = envioDo(o);
          nota = env.codigo ? ` (rastreio ${env.codigo})` : ' (SEM código de rastreio no Tiny)';
          fn = () => enviarPedidoEnviado(o);
        } else if (tipo === 'nao_aprovado') {
          if (SITUACOES_CONFIRMADAS.includes(o.situacao)) {
            acao.tipos.push('nao_aprovado: já pago');
            continue;
          }
          const motivo = /^expirado/.test(loja.pagamento_falha || '') ? 'expirado' : 'recusado';
          fn = () => enviarPagamentoNaoAprovado(o, { link: loja.link_pagamento, motivo });
        } else if (tipo === 'pos_entrega') {
          const cupom = cupomPosEntrega();
          nota = cupom ? ` (cupom ${cupom.codigo})` : ' (sem cupom configurado)';
          fn = () => enviarPosEntrega(o, { cupom });
        }
        if (!fn) continue;
        if (simular) {
          acao.tipos.push(`${tipo}: ${ativo(tipo) ? 'mandaria' : 'desligado (só registraria)'}${nota}`);
          continue;
        }
        const r = await disparar(o, tipo, fn);
        acao.tipos.push(`${tipo}: ${r.resultado}${nota}`);
      } catch (err) {
        acao.tipos.push(`${tipo}: falha ${err.message}`);
        console.error(`[regua] pedido ${o.numero} ${tipo}:`, err.message);
      }
    }
  }

  resultado.restantes = Math.max(0, fila.size - resultado.acoes.length);
  return resultado;
}

export async function listarRegistros(limite = 80) {
  await garantirTabelas();
  const { rows } = await getPool().query(
    `select id_tiny, numero, tipo, status, motivo, resend_id, criado_em::text, enviado_em::text
       from emails_pedido order by criado_em desc limit $1`,
    [limite]
  );
  return rows;
}
