/* ================================================================
   Vendas — espelho dos pedidos do Tiny no Postgres
   ----------------------------------------------------------------
   A venda nasce no Tiny (loja online, Mercado Livre e representante
   digitando no ERP). O banco da loja só via o pedido de quem estava
   logado, então o painel não tinha como mostrar "quanto vendeu".
   Aqui copiamos os pedidos do Tiny para `vendas_pedidos` em duas
   fases:
     1. lista  — pedidos.pesquisa (100 por chamada): número, data,
                 valor, situação, vendedor, rastreio. Barato.
     2. detalhe — pedido.obter, uma chamada por pedido NOVO: itens,
                 cliente, observação (cupom), canal. Caro, então roda
                 com orçamento de tempo e continua na próxima chamada.
   Não mexe em nada no Tiny: só lê.
   ================================================================ */

import { getPool } from './db.js';
import { pesquisarPedidos, obterPedido } from './tiny.js';
import { SKUS_CUPOM } from './cupons.js';

// Primeira carga: o histórico do Tiny começa em 2025.
const INICIO_HISTORICO = '01/01/2025';

// Situações do Tiny agrupadas como o dono lê.
export const SITUACOES_CONFIRMADAS = [
  'Aprovado', 'Preparando envio', 'Faturado', 'Pronto para envio', 'Enviado', 'Entregue',
];
export const SITUACOES_PENDENTES = ['Em aberto', 'Dados incompletos', 'Em digitação'];
export const SITUACOES_CANCELADAS = ['Cancelado', 'Não Entregue'];

const SCHEMA = `
create table if not exists public.vendas_pedidos (
  id_tiny text primary key,
  numero text,
  numero_ecommerce text,
  data_pedido date,
  canal text not null default 'direto',
  ecommerce text,
  vendedor text,
  cliente_nome text,
  cliente_doc text,
  tipo_pessoa text,
  cliente_email text,
  cidade text,
  uf text,
  lista_preco text,
  valor_produtos numeric(12,2) not null default 0,
  valor_frete numeric(12,2) not null default 0,
  valor_desconto numeric(12,2) not null default 0,
  valor_total numeric(12,2) not null default 0,
  cupom text,
  cupom_desconto numeric(12,2),
  situacao text,
  forma_pagamento text,
  codigo_rastreamento text,
  url_rastreamento text,
  marcadores text[] not null default '{}',
  primeira_venda boolean not null default false,
  detalhado boolean not null default false,
  sincronizado_em timestamptz not null default now()
);
create index if not exists vendas_pedidos_data_idx on public.vendas_pedidos (data_pedido);
create index if not exists vendas_pedidos_canal_idx on public.vendas_pedidos (canal);
create index if not exists vendas_pedidos_cupom_idx on public.vendas_pedidos (cupom);
create table if not exists public.vendas_itens (
  id bigserial primary key,
  id_tiny text not null references public.vendas_pedidos(id_tiny) on delete cascade,
  sku text,
  descricao text,
  quantidade numeric(12,3) not null default 0,
  valor_unitario numeric(12,2) not null default 0
);
create index if not exists vendas_itens_pedido_idx on public.vendas_itens (id_tiny);
create table if not exists public.vendas_sync (
  chave text primary key,
  valor text,
  atualizado_em timestamptz not null default now()
);
alter table public.influencers add column if not exists comissao_percent numeric(5,2) not null default 0;
`;

let tabelasProntas = false;
export async function garantirTabelas() {
  if (tabelasProntas) return;
  await getPool().query(SCHEMA);
  tabelasProntas = true;
}

/* ── Conversões ─────────────────────────────────────────────── */

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** "21/10/2026" → "2026-10-21" */
function dataIso(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(br || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Agora no horário de Brasília, no formato que o Tiny espera. */
function agoraTiny(menosMinutos = 0) {
  const d = new Date(Date.now() - menosMinutos * 60000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

function nomeEcommerce(o) {
  const ec = o?.ecommerce;
  if (!ec) return '';
  if (typeof ec === 'string') return ec;
  return ec.nomeEcommerce || ec.nome || '';
}

function listaMarcadores(o) {
  return (o?.marcadores || [])
    .map((m) => m?.marcador?.descricao || m?.descricao || '')
    .filter(Boolean);
}

/** Canal pela lista (antes do detalhe): o melhor palpite barato. */
function canalProvisorio(p) {
  if (p.numero_ecommerce) return 'mercado_livre';
  if (p.nome_vendedor) return 'representante';
  return 'direto';
}

/** Canal definitivo, com observação e marcadores do pedido. */
export function canalDoPedido(o) {
  const obs = String(o?.obs || '');
  const marcadores = listaMarcadores(o);
  const ec = nomeEcommerce(o);
  // Os primeiros pedidos (10/09) dizem "Pedido originado pela loja online" e não têm marcador.
  if (/loja online/i.test(obs) || marcadores.some((m) => /loja online/i.test(m)) || /loja aion/i.test(ec)) {
    return /pedido b2b/i.test(obs) ? 'loja_cnpj' : 'loja';
  }
  if (o?.numero_ecommerce || ec) {
    return /mercado/i.test(ec) || /^2000\d{8,}$/.test(String(o?.numero_ecommerce || ''))
      ? 'mercado_livre'
      : 'marketplace';
  }
  if (o?.nome_vendedor) return 'representante';
  return 'direto';
}

/** "Cupom PRIMEIRA15 (15%): -R$ 12.30." → { codigo, desconto } */
export function cupomDaObs(obs) {
  const m = /Cupom\s+([A-Z0-9_-]+)\s*\(([\d.,]+)%\):\s*-R\$\s*([\d.,]+)/i.exec(String(obs || ''));
  return m ? { codigo: m[1].toUpperCase(), desconto: num(m[3]) } : null;
}

/* ── Sincronização ──────────────────────────────────────────── */

async function lerSync(chave) {
  const { rows } = await getPool().query('select valor from vendas_sync where chave = $1', [chave]);
  return rows[0]?.valor || null;
}

async function gravarSync(chave, valor) {
  await getPool().query(
    `insert into vendas_sync (chave, valor, atualizado_em) values ($1, $2, now())
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [chave, valor]
  );
}

/** Grava uma página da lista do Tiny numa consulta só (o banco fica longe). */
async function gravarDaLista(pedidos) {
  if (!pedidos.length) return;
  const linhas = pedidos.map((p) => ({
    id_tiny: String(p.id),
    numero: p.numero ? String(p.numero) : null,
    numero_ecommerce: p.numero_ecommerce ? String(p.numero_ecommerce) : null,
    data_pedido: dataIso(p.data_pedido),
    canal: canalProvisorio(p),
    vendedor: p.nome_vendedor ? String(p.nome_vendedor).trim() : null,
    cliente_nome: p.nome || null,
    valor_total: num(p.valor),
    situacao: p.situacao || null,
    codigo_rastreamento: p.codigo_rastreamento || null,
    url_rastreamento: p.url_rastreamento || null,
  }));
  await getPool().query(
    `insert into vendas_pedidos
       (id_tiny, numero, numero_ecommerce, data_pedido, canal, vendedor, cliente_nome,
        valor_total, situacao, codigo_rastreamento, url_rastreamento, sincronizado_em)
     select x.id_tiny, x.numero, x.numero_ecommerce, x.data_pedido, x.canal, x.vendedor, x.cliente_nome,
            x.valor_total, x.situacao, x.codigo_rastreamento, x.url_rastreamento, now()
       from jsonb_to_recordset($1::jsonb) as x(
         id_tiny text, numero text, numero_ecommerce text, data_pedido date, canal text, vendedor text,
         cliente_nome text, valor_total numeric, situacao text, codigo_rastreamento text, url_rastreamento text)
     on conflict (id_tiny) do update set
       numero = excluded.numero,
       numero_ecommerce = excluded.numero_ecommerce,
       data_pedido = excluded.data_pedido,
       vendedor = excluded.vendedor,
       cliente_nome = excluded.cliente_nome,
       valor_total = excluded.valor_total,
       situacao = excluded.situacao,
       codigo_rastreamento = excluded.codigo_rastreamento,
       url_rastreamento = excluded.url_rastreamento,
       sincronizado_em = now()`,
    [JSON.stringify(linhas)]
  );
}

/** Pedido completo + itens numa consulta só (atômica). */
async function gravarDetalhe(o) {
  const cli = o.cliente || {};
  const cupom = cupomDaObs(o.obs);
  const marcadores = listaMarcadores(o);
  const itens = (o.itens || [])
    .map((x) => x?.item)
    .filter(Boolean)
    .map((item) => ({
      sku: item.codigo || null,
      descricao: item.descricao || null,
      quantidade: num(item.quantidade),
      valor_unitario: num(item.valor_unitario),
    }));
  await getPool().query(
    `with ped as (
       update vendas_pedidos set
         canal = $2, ecommerce = $3, cliente_nome = $4, cliente_doc = $5, tipo_pessoa = $6,
         cliente_email = $7, cidade = $8, uf = $9, lista_preco = $10,
         valor_produtos = $11, valor_frete = $12, valor_desconto = $13, valor_total = $14,
         cupom = $15, cupom_desconto = $16, forma_pagamento = $17, marcadores = $18,
         primeira_venda = $19, vendedor = coalesce($20, vendedor), situacao = coalesce($21, situacao),
         detalhado = true, sincronizado_em = now()
       where id_tiny = $1
       returning id_tiny
     ), apaga as (
       delete from vendas_itens where id_tiny = $1
     )
     insert into vendas_itens (id_tiny, sku, descricao, quantidade, valor_unitario)
     select ped.id_tiny, x.sku, x.descricao, x.quantidade, x.valor_unitario
       from ped, jsonb_to_recordset($22::jsonb) as x(sku text, descricao text, quantidade numeric, valor_unitario numeric)`,
    [
      String(o.id),
      canalDoPedido(o),
      nomeEcommerce(o) || null,
      cli.nome || null,
      cli.cpf_cnpj || null,
      cli.tipo_pessoa || null,
      cli.email || null,
      cli.cidade || null,
      cli.uf || null,
      o.descricao_lista_preco || null,
      num(o.total_produtos),
      num(o.valor_frete),
      num(o.valor_desconto),
      num(o.total_pedido),
      cupom?.codigo || null,
      cupom ? cupom.desconto : null,
      o.forma_pagamento || null,
      marcadores,
      marcadores.some((m) => /1.{0,2}\s*venda/i.test(m)),
      o.nome_vendedor ? String(o.nome_vendedor).trim() : null,
      o.situacao || null,
      JSON.stringify(itens),
    ]
  );
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Um passo de sincronização. O painel chama em sequência até
 * `pendentes` chegar a zero — assim nenhuma chamada passa do tempo
 * limite da Vercel, mesmo na primeira carga (centenas de pedidos).
 * A lista guarda um cursor (filtro + página) em `vendas_sync`, então
 * um passo interrompido continua do ponto em que parou.
 *
 * CUIDADO com o limite de chamadas do Tiny: ele é da CONTA, dividido
 * com a loja (produtos, preço no checkout). Em 21/10 uma carga a ~1
 * chamada/s bloqueou a API e a vitrine da loja saiu do ar por minutos.
 * Por isso cada passo detalha no máximo `maxDetalhes` pedidos, com
 * pausa entre eles, e para no primeiro bloqueio.
 */
export async function sincronizar({ orcamentoMs = 20000, pausaMs = 1500, maxDetalhes = 6 } = {}) {
  const inicio = Date.now();
  await garantirTabelas();

  // 1. Lista: tudo desde o início na 1ª vez; depois só o que mudou.
  let cursor = null;
  try {
    cursor = JSON.parse((await lerSync('lista_cursor')) || 'null');
  } catch {
    cursor = null;
  }
  if (!cursor) {
    const ultima = await lerSync('ultima_lista');
    cursor = {
      marco: agoraTiny(10), // 10 min de folga para relógio/fila do Tiny
      pagina: 1,
      filtros: ultima
        ? { dataAtualizacao: ultima }
        : { dataInicial: INICIO_HISTORICO, dataFinal: agoraTiny().slice(0, 10) },
    };
  }

  let listados = 0;
  let listaCompleta = false;
  while (Date.now() - inicio < orcamentoMs / 2) {
    const r = await pesquisarPedidos({ pagina: cursor.pagina, ...cursor.filtros });
    await gravarDaLista(r.pedidos);
    listados += r.pedidos.length;
    if (cursor.pagina >= r.paginas) {
      listaCompleta = true;
      break;
    }
    cursor.pagina += 1;
  }
  if (listaCompleta) {
    await gravarSync('ultima_lista', cursor.marco);
    await gravarSync('lista_cursor', null);
  } else {
    await gravarSync('lista_cursor', JSON.stringify(cursor));
  }

  // 2. Detalhe dos pedidos que ainda não têm itens/canal.
  const { rows: faltam } = await getPool().query(
    'select id_tiny from vendas_pedidos where not detalhado order by data_pedido desc nulls last limit 300'
  );
  let detalhados = 0;
  let bloqueio = null;
  for (const { id_tiny } of faltam) {
    if (Date.now() - inicio > orcamentoMs || detalhados >= maxDetalhes) break;
    try {
      const o = await obterPedido(id_tiny);
      if (o) await gravarDetalhe(o);
      detalhados += 1;
    } catch (err) {
      // Limite de chamadas do Tiny: para aqui e o painel tenta de novo.
      bloqueio = err.message;
      break;
    }
    await espera(pausaMs);
  }

  const { rows } = await getPool().query(
    'select count(*) filter (where not detalhado)::int pendentes, count(*)::int total from vendas_pedidos'
  );

  return {
    listados,
    detalhados,
    pendentes: rows[0].pendentes + (listaCompleta ? 0 : 1),
    total: rows[0].total,
    bloqueio,
  };
}

export async function statusSync() {
  await garantirTabelas();
  const { rows } = await getPool().query(
    `select count(*) filter (where not detalhado)::int pendentes, count(*)::int total,
            (select atualizado_em from vendas_sync where chave = 'ultima_lista') ultima
       from vendas_pedidos`
  );
  return rows[0];
}

/* ── Consultas do painel ────────────────────────────────────── */

/** Filtros comuns: período (ISO), canal e grupo de situação. */
function montarFiltro({ de, ate, canal, grupo, busca } = {}, alias = 'p') {
  const where = [];
  const args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
  if (de) add(`${alias}.data_pedido >= ?`, de);
  if (ate) add(`${alias}.data_pedido <= ?`, ate);
  if (canal) {
    if (canal === 'loja_todos') where.push(`${alias}.canal in ('loja','loja_cnpj')`);
    else add(`${alias}.canal = ?`, canal);
  }
  if (grupo === 'confirmado') add(`${alias}.situacao = any(?)`, SITUACOES_CONFIRMADAS);
  if (grupo === 'pendente') add(`${alias}.situacao = any(?)`, SITUACOES_PENDENTES);
  if (grupo === 'cancelado') add(`${alias}.situacao = any(?)`, SITUACOES_CANCELADAS);
  if (busca) {
    args.push(`%${busca}%`);
    const n = `$${args.length}`;
    where.push(`(${alias}.numero ilike ${n} or ${alias}.cliente_nome ilike ${n} or ${alias}.vendedor ilike ${n} or ${alias}.cupom ilike ${n})`);
  }
  return { where: where.length ? `where ${where.join(' and ')}` : '', args };
}

export async function listarVendas(filtros) {
  await garantirTabelas();
  const pool = getPool();
  const { where, args } = montarFiltro(filtros);
  const conf = `p.situacao = any($${args.length + 1})`;
  const argsConf = [...args, SITUACOES_CONFIRMADAS];

  const [{ rows: pedidos }, { rows: [resumo] }, { rows: porCanal }, { rows: porDia }] = await Promise.all([
    pool.query(
      `select p.id_tiny, p.numero, p.data_pedido::text data_pedido, p.canal, p.vendedor, p.cliente_nome, p.tipo_pessoa,
              p.cidade, p.uf, p.valor_total, p.valor_frete, p.cupom, p.situacao,
              p.codigo_rastreamento, p.url_rastreamento, p.primeira_venda
         from vendas_pedidos p ${where}
        order by p.data_pedido desc nulls last, length(p.numero) desc, p.numero desc
        limit 1000`,
      args
    ),
    pool.query(
      `select count(*)::int pedidos,
              count(*) filter (where ${conf})::int confirmados,
              coalesce(sum(p.valor_total) filter (where ${conf}), 0)::float faturamento,
              coalesce(sum(p.valor_frete) filter (where ${conf}), 0)::float frete,
              count(*) filter (where p.situacao = any($${args.length + 2}))::int pendentes,
              count(*) filter (where p.situacao = any($${args.length + 3}))::int cancelados
         from vendas_pedidos p ${where}`,
      [...argsConf, SITUACOES_PENDENTES, SITUACOES_CANCELADAS]
    ),
    pool.query(
      `select p.canal, count(*)::int pedidos, coalesce(sum(p.valor_total), 0)::float faturamento
         from vendas_pedidos p ${where ? where + ' and ' : 'where '} ${conf}
        group by p.canal order by faturamento desc`,
      argsConf
    ),
    pool.query(
      `select p.data_pedido::text dia, count(*)::int pedidos, coalesce(sum(p.valor_total), 0)::float faturamento
         from vendas_pedidos p ${where ? where + ' and ' : 'where '} ${conf}
        group by p.data_pedido order by p.data_pedido`,
      argsConf
    ),
  ]);

  return { pedidos, resumo, porCanal, porDia };
}

export async function obterVenda(idTiny) {
  await garantirTabelas();
  const pool = getPool();
  const { rows: [pedido] } = await pool.query('select *, data_pedido::text data_pedido from vendas_pedidos where id_tiny = $1', [String(idTiny)]);
  if (!pedido) return null;
  const { rows: itens } = await pool.query(
    'select sku, descricao, quantidade::float, valor_unitario::float from vendas_itens where id_tiny = $1 order by id',
    [String(idTiny)]
  );
  return { ...pedido, itens };
}

/**
 * Ranking de influencers: pedidos confirmados com cupom do influencer.
 * O cupom sai da observação do pedido no Tiny (o checkout grava lá),
 * então conta mesmo venda em que o banco estava fora do ar.
 * Receita = valor dos produtos já com desconto, sem frete — é a base
 * da comissão.
 */
export async function rankingInfluencers({ de, ate } = {}) {
  await garantirTabelas();
  const args = [SITUACOES_CONFIRMADAS];
  const periodo = [];
  if (de) { args.push(de); periodo.push(`p.data_pedido >= $${args.length}`); }
  if (ate) { args.push(ate); periodo.push(`p.data_pedido <= $${args.length}`); }
  const condPedido = ['p.situacao = any($1)', ...periodo].join(' and ');

  const { rows } = await getPool().query(
    `with vendas as (
       select upper(p.cupom) codigo, count(*)::int pedidos,
              sum(case when p.valor_produtos > 0 then p.valor_produtos else p.valor_total - p.valor_frete end)::float receita,
              coalesce(sum(p.cupom_desconto), 0)::float desconto,
              max(p.data_pedido) ultima
         from vendas_pedidos p
        where p.cupom is not null and ${condPedido}
        group by upper(p.cupom)
     )
     select i.id, i.nome, i.instagram, i.ativo, coalesce(i.comissao_percent, 0)::float comissao_percent,
            coalesce(array_agg(c.codigo order by c.codigo) filter (where c.codigo is not null), '{}') cupons,
            coalesce(sum(v.pedidos), 0)::int pedidos,
            coalesce(sum(v.receita), 0)::float receita,
            coalesce(sum(v.desconto), 0)::float desconto,
            max(v.ultima)::text ultima
       from influencers i
       left join coupons c on c.influencer_id = i.id
       left join vendas v on v.codigo = c.codigo
      group by i.id
      order by receita desc, i.nome`,
    args
  );

  const { rows: semDono } = await getPool().query(
    `select upper(p.cupom) codigo, count(*)::int pedidos,
            sum(case when p.valor_produtos > 0 then p.valor_produtos else p.valor_total - p.valor_frete end)::float receita
       from vendas_pedidos p
       left join coupons c on c.codigo = upper(p.cupom)
      where p.cupom is not null and c.influencer_id is null and ${condPedido}
      group by upper(p.cupom) order by receita desc`,
    args
  );

  const influencers = rows.map((r) => ({
    ...r,
    comissao: Math.round(r.receita * (r.comissao_percent / 100) * 100) / 100,
  }));
  return { influencers, semDono };
}

/**
 * Ranking de representantes (vendedor do pedido no Tiny). "Clientes
 * novos" usa o marcador "1ª venda" que a equipe põe no pedido.
 */
export async function rankingRepresentantes({ de, ate } = {}) {
  await garantirTabelas();
  const args = [SITUACOES_CONFIRMADAS, SKUS_CUPOM];
  const periodo = [];
  if (de) { args.push(de); periodo.push(`p.data_pedido >= $${args.length}`); }
  if (ate) { args.push(ate); periodo.push(`p.data_pedido <= $${args.length}`); }
  const cond = ['p.vendedor is not null', `p.vendedor <> ''`, 'p.situacao = any($1)', ...periodo].join(' and ');

  const { rows } = await getPool().query(
    `select p.vendedor,
            count(*)::int pedidos,
            coalesce(sum(p.valor_total), 0)::float faturamento,
            count(distinct coalesce(nullif(p.cliente_doc, ''), p.cliente_nome))::int clientes,
            count(*) filter (where p.primeira_venda)::int clientes_novos,
            coalesce(sum(it.tartoff), 0)::float unidades_tartoff,
            max(p.data_pedido)::text ultima
       from vendas_pedidos p
       left join lateral (
         -- gel avulso conta 1; "Kit Tartoff 8 unid" conta 8 (o número vem da descrição)
         select sum(case
                  when i.sku = any($2) then i.quantidade
                  when i.descricao ~* 'kit\\s*tart\\s*off'
                    then i.quantidade * coalesce(substring(i.descricao from '(\\d+)\\s*unid')::int, 1)
                  else 0 end) tartoff
           from vendas_itens i
          where i.id_tiny = p.id_tiny
       ) it on true
      where ${cond}
      group by p.vendedor
      order by faturamento desc`,
    args
  );
  return { representantes: rows };
}
