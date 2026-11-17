-- Programa de afiliados — aplicar manualmente no Postgres aion.
-- Requer public.coupons (schema.sql). Pode ser reaplicado.
begin;
create table if not exists public.afiliados (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo text not null unique check (codigo ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  contato text,
  comissao_percent numeric(5,2) not null default 0 check (comissao_percent between 0 and 100),
  ativo boolean not null default true,
  coupon_id uuid unique references public.coupons(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.afiliado_cliques (
  id uuid primary key,
  afiliado_id uuid not null references public.afiliados(id),
  created_at timestamptz not null default now()
);
alter table public.afiliado_cliques add column if not exists ip_hash text;
create index if not exists afiliado_cliques_ip_idx on public.afiliado_cliques(afiliado_id, ip_hash, created_at);
create index if not exists afiliado_cliques_periodo_idx on public.afiliado_cliques(afiliado_id, created_at);
-- Mesma base criada pela régua; não altera seu comportamento.
create table if not exists public.pedidos_loja (
  id_tiny text primary key, numero text, email text,
  canal text not null default 'loja', pref_id text, link_pagamento text,
  prazo_dias int, pagamento_falhou_em timestamptz, pagamento_falha text,
  criado_em timestamptz not null default now()
);
alter table public.pedidos_loja add column if not exists afiliado_id uuid references public.afiliados(id);
alter table public.pedidos_loja add column if not exists afiliado_codigo text;
alter table public.pedidos_loja add column if not exists afiliado_comissao_percent numeric(5,2);
alter table public.pedidos_loja add column if not exists afiliado_base numeric(12,2);
alter table public.pedidos_loja add column if not exists afiliado_total numeric(12,2);
create index if not exists pedidos_loja_afiliado_idx on public.pedidos_loja(afiliado_id, criado_em);
-- Sem FK: webhook pode chegar antes do registro do pedido.
-- Uma linha por tentativa MP; reenvio não duplica e estorno tira a aprovação.
create table if not exists public.afiliado_pagamentos (
  pagamento_id text primary key,
  pedido_id text not null,
  status text not null,
  atualizado_em timestamptz not null
);
create index if not exists afiliado_pagamentos_pedido_idx on public.afiliado_pagamentos(pedido_id);
commit;
