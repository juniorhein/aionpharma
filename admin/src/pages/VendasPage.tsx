import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import {
  CANAIS,
  brl,
  classeSituacao,
  dataCurta,
  inteiro,
  nomeBonito,
  periodoDe,
  query,
  useSyncTiny,
  type Periodo,
} from '../lib/vendas';
import { FiltroPeriodo, SyncTiny } from '../components/VendasUI';

type Pedido = {
  id_tiny: string;
  numero: string | null;
  data_pedido: string | null;
  canal: string;
  vendedor: string | null;
  cliente_nome: string | null;
  tipo_pessoa: string | null;
  cidade: string | null;
  uf: string | null;
  valor_total: string;
  valor_frete: string;
  cupom: string | null;
  situacao: string | null;
  codigo_rastreamento: string | null;
  url_rastreamento: string | null;
  primeira_venda: boolean;
};

type Resumo = {
  pedidos: number;
  confirmados: number;
  faturamento: number;
  frete: number;
  pendentes: number;
  cancelados: number;
};

type Detalhe = Pedido & {
  cliente_doc: string | null;
  cliente_email: string | null;
  lista_preco: string | null;
  valor_produtos: string;
  valor_desconto: string;
  cupom_desconto: string | null;
  forma_pagamento: string | null;
  marcadores: string[];
  itens: { sku: string; descricao: string; quantidade: number; valor_unitario: number }[];
};

function exportarCsv(pedidos: Pedido[]) {
  const cab = ['Data', 'Pedido', 'Cliente', 'Canal', 'Vendedor', 'Cupom', 'Situação', 'Rastreio', 'Frete', 'Total'];
  const linhas = pedidos.map((p) => [
    p.data_pedido || '',
    p.numero || '',
    p.cliente_nome || '',
    CANAIS[p.canal] || p.canal,
    p.vendedor || '',
    p.cupom || '',
    p.situacao || '',
    p.codigo_rastreamento || '',
    String(p.valor_frete).replace('.', ','),
    String(p.valor_total).replace('.', ','),
  ]);
  const csv = [cab, ...linhas]
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `vendas-aion-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function VendasPage() {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes'));
  const [canal, setCanal] = useState('');
  const [grupo, setGrupo] = useState('');
  const [busca, setBusca] = useState('');
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [porCanal, setPorCanal] = useState<{ canal: string; pedidos: number; faturamento: number }[]>([]);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState<Detalhe | null>(null);

  const carregar = useCallback(() => {
    const qs = query({ tipo: 'lista', de: periodo.de, ate: periodo.ate, canal, grupo, busca });
    apiFetch(`/api/admin/vendas?${qs}`)
      .then((d) => {
        setPedidos(d.pedidos || []);
        setResumo(d.resumo || null);
        setPorCanal(d.porCanal || []);
        setErro('');
      })
      .catch((e) => setErro(e.message));
  }, [periodo, canal, grupo, busca]);

  const sync = useSyncTiny(carregar);

  useEffect(() => {
    const t = setTimeout(carregar, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  async function abrir(p: Pedido) {
    try {
      const d = await apiFetch(`/api/admin/vendas?${query({ tipo: 'pedido', id: p.id_tiny })}`);
      setAberto(d.pedido);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao abrir o pedido');
    }
  }

  const ticket = resumo && resumo.confirmados ? resumo.faturamento / resumo.confirmados : 0;
  const maiorCanal = Math.max(1, ...porCanal.map((c) => c.faturamento));

  return (
    <div className="page">
      <header className="page-header header-linha">
        <div>
          <h1>Vendas</h1>
          <p className="muted">Todos os pedidos do Tiny: loja, Mercado Livre e representantes.</p>
        </div>
        <SyncTiny {...sync} onSync={sync.sincronizar} />
      </header>

      <FiltroPeriodo periodo={periodo} onChange={setPeriodo} escolher={periodoDe} />

      {erro && <p className="error">{erro}</p>}

      <div className="stats-row stats-4">
        <div className="stat-card destaque">
          <span className="stat-label">Faturamento</span>
          <strong className="stat-value">{brl(resumo?.faturamento || 0)}</strong>
          <span className="stat-sub">pedidos confirmados, com frete</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pedidos</span>
          <strong className="stat-value">{inteiro(resumo?.confirmados || 0)}</strong>
          <span className="stat-sub">confirmados de {inteiro(resumo?.pedidos || 0)} no período</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Ticket médio</span>
          <strong className="stat-value">{brl(ticket)}</strong>
          <span className="stat-sub">por pedido confirmado</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Não fechou</span>
          <strong className="stat-value">{inteiro((resumo?.pendentes || 0) + (resumo?.cancelados || 0))}</strong>
          <span className="stat-sub">
            {inteiro(resumo?.pendentes || 0)} aguardando · {inteiro(resumo?.cancelados || 0)} cancelados
          </span>
        </div>
      </div>

      {porCanal.length > 0 && (
        <div className="panel canais">
          <h2 className="panel-title">Por canal</h2>
          <ul className="barras">
            {porCanal.map((c) => (
              <li key={c.canal}>
                <button
                  type="button"
                  className={canal === c.canal ? 'barra ativa' : 'barra'}
                  onClick={() => setCanal(canal === c.canal ? '' : c.canal)}
                  title="Filtrar por este canal"
                >
                  <span className="barra-rotulo">{CANAIS[c.canal] || c.canal}</span>
                  <span className="barra-trilho">
                    <span className="barra-cheia" style={{ width: `${(c.faturamento / maiorCanal) * 100}%` }} />
                  </span>
                  <span className="barra-valor">
                    {brl(c.faturamento)} <span className="muted">· {inteiro(c.pedidos)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <div className="filtros">
          <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Canal">
            <option value="">Todos os canais</option>
            {Object.entries(CANAIS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Situação">
            <option value="">Todas as situações</option>
            <option value="confirmado">Confirmados</option>
            <option value="pendente">Aguardando pagamento</option>
            <option value="cancelado">Cancelados</option>
          </select>
          <input
            className="filtro-busca"
            placeholder="Buscar pedido, cliente, vendedor ou cupom"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <button type="button" className="btn-ghost btn-mini" onClick={() => exportarCsv(pedidos)} disabled={!pedidos.length}>
            Exportar CSV
          </button>
        </div>

        {pedidos.length === 0 ? (
          <p className="muted vazio">
            {sync.rodando ? 'Carregando pedidos do Tiny…' : 'Nenhum pedido nesse filtro.'}
          </p>
        ) : (
          <div className="tabela-rola">
            <table className="table tabela-vendas">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Canal</th>
                  <th>Vendedor / cupom</th>
                  <th>Situação</th>
                  <th>Rastreio</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id_tiny} className="linha-clicavel" onClick={() => abrir(p)}>
                    <td className="nowrap">{dataCurta(p.data_pedido)}</td>
                    <td className="nowrap">
                      <strong>#{p.numero}</strong>
                    </td>
                    <td>
                      <span className="cliente">{p.cliente_nome || '—'}</span>
                      {(p.cidade || p.uf) && (
                        <span className="muted small bloco">
                          {[p.cidade, p.uf].filter(Boolean).join(' / ')}
                        </span>
                      )}
                    </td>
                    <td className="nowrap">{CANAIS[p.canal] || p.canal}</td>
                    <td>
                      {p.cupom ? <span className="badge cupom">{p.cupom}</span> : p.vendedor ? <span className="small vendedor">{nomeBonito(p.vendedor)}</span> : <span className="muted">—</span>}
                      {p.primeira_venda && <span className="badge novo">1ª venda</span>}
                    </td>
                    <td>
                      <span className={classeSituacao(p.situacao)}>{p.situacao || '—'}</span>
                    </td>
                    <td className="nowrap">
                      {p.codigo_rastreamento ? (
                        p.url_rastreamento ? (
                          <a href={p.url_rastreamento} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            {p.codigo_rastreamento}
                          </a>
                        ) : (
                          p.codigo_rastreamento
                        )
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num nowrap">
                      <strong>{brl(Number(p.valor_total))}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {aberto && <PainelPedido pedido={aberto} onFechar={() => setAberto(null)} />}
    </div>
  );
}

function PainelPedido({ pedido, onFechar }: { pedido: Detalhe; onFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  return (
    <div className="gaveta-fundo" onClick={onFechar}>
      <aside className="gaveta" onClick={(e) => e.stopPropagation()} aria-label={`Pedido ${pedido.numero}`}>
        <header className="gaveta-topo">
          <div>
            <span className="stat-label">Pedido</span>
            <h2>#{pedido.numero}</h2>
            <p className="muted small">
              {dataCurta(pedido.data_pedido)} · {CANAIS[pedido.canal] || pedido.canal}
              {pedido.lista_preco ? ` · tabela ${pedido.lista_preco}` : ''}
            </p>
          </div>
          <button type="button" className="btn-ghost btn-mini" onClick={onFechar}>
            Fechar
          </button>
        </header>

        <span className={classeSituacao(pedido.situacao)}>{pedido.situacao}</span>

        <section className="gaveta-bloco">
          <h3>Cliente</h3>
          <p>
            <strong>{pedido.cliente_nome || '—'}</strong>
          </p>
          <p className="muted small">
            {[pedido.cliente_doc, pedido.cliente_email].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="muted small">{[pedido.cidade, pedido.uf].filter(Boolean).join(' / ')}</p>
        </section>

        <section className="gaveta-bloco">
          <h3>Itens</h3>
          {pedido.itens.length === 0 ? (
            <p className="muted small">Itens ainda não carregados do Tiny.</p>
          ) : (
            <ul className="itens">
              {pedido.itens.map((it, i) => (
                <li key={i}>
                  <span>
                    <strong>{inteiro(it.quantidade)}×</strong> {it.descricao}
                    <span className="muted small bloco">SKU {it.sku}</span>
                  </span>
                  <span className="nowrap">{brl(it.quantidade * it.valor_unitario)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="gaveta-bloco totais">
          <div>
            <span>Produtos</span>
            <span>{brl(Number(pedido.valor_produtos))}</span>
          </div>
          {pedido.cupom && (
            <div>
              <span>
                Cupom <span className="badge cupom">{pedido.cupom}</span>
              </span>
              <span>− {brl(Number(pedido.cupom_desconto || 0))}</span>
            </div>
          )}
          <div>
            <span>Frete</span>
            <span>{brl(Number(pedido.valor_frete))}</span>
          </div>
          <div className="total">
            <span>Total</span>
            <span>{brl(Number(pedido.valor_total))}</span>
          </div>
        </section>

        <section className="gaveta-bloco">
          <h3>Venda</h3>
          <p className="small">Vendedor: {nomeBonito(pedido.vendedor) || '—'}</p>
          <p className="small">Pagamento: {pedido.forma_pagamento || '—'}</p>
          <p className="small">Rastreio: {pedido.codigo_rastreamento || '—'}</p>
          {pedido.marcadores?.length > 0 && <p className="small">Marcadores: {pedido.marcadores.join(', ')}</p>}
        </section>
      </aside>
    </div>
  );
}
