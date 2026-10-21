-- Espelho dos pedidos do Tiny para o painel (Vendas, rankings).
-- A venda nasce no Tiny (loja, Mercado Livre, representante); aqui só
-- guardamos uma cópia para a tela abrir rápido. Criado também pelo
-- código em api/_lib/vendas.js (garantirTabelas) se não existir.

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
