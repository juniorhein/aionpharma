import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { brl, dataCurta, inteiro, nomeBonito, periodoDe, query, useSyncTiny, type Periodo } from '../lib/vendas';
import { FiltroPeriodo, SyncTiny } from '../components/VendasUI';

type Influencer = {
  id: string;
  nome: string;
  instagram: string | null;
  ativo: boolean;
  comissao_percent: number;
  cupons: string[];
  pedidos: number;
  receita: number;
  desconto: number;
  comissao: number;
  ultima: string | null;
};

type Representante = {
  vendedor: string;
  pedidos: number;
  faturamento: number;
  clientes: number;
  clientes_novos: number;
  unidades_tartoff: number;
  ultima: string | null;
};

function Posicao({ n }: { n: number }) {
  return <span className={n <= 3 ? `posicao p${n}` : 'posicao'}>{n}</span>;
}

export default function RankingsPage() {
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') === 'representantes' ? 'representantes' : 'influencers';
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes'));
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [semDono, setSemDono] = useState<{ codigo: string; pedidos: number; receita: number }[]>([]);
  const [reps, setReps] = useState<Representante[]>([]);
  const [erro, setErro] = useState('');
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(() => {
    const qs = query({ de: periodo.de, ate: periodo.ate });
    Promise.all([
      apiFetch(`/api/admin/vendas?tipo=influencers&${qs}`),
      apiFetch(`/api/admin/vendas?tipo=representantes&${qs}`),
    ])
      .then(([i, r]) => {
        setInfluencers(i.influencers || []);
        setSemDono(i.semDono || []);
        setReps(r.representantes || []);
        setErro('');
        setCarregado(true);
      })
      .catch((e) => setErro(e.message));
  }, [periodo]);

  const sync = useSyncTiny(carregar);
  useEffect(carregar, [carregar]);

  const totalInf = influencers.reduce(
    (s, i) => ({ receita: s.receita + i.receita, pedidos: s.pedidos + i.pedidos, comissao: s.comissao + i.comissao }),
    { receita: 0, pedidos: 0, comissao: 0 }
  );
  const totalRep = reps.reduce(
    (s, r) => ({ fat: s.fat + r.faturamento, pedidos: s.pedidos + r.pedidos, un: s.un + r.unidades_tartoff, novos: s.novos + r.clientes_novos }),
    { fat: 0, pedidos: 0, un: 0, novos: 0 }
  );
  const lider = reps[0]?.faturamento || 1;

  return (
    <div className="page">
      <header className="page-header header-linha">
        <div>
          <h1>Rankings</h1>
          <p className="muted">Quem trouxe venda: influencers pelo cupom, representantes pelo pedido no Tiny.</p>
        </div>
        <SyncTiny {...sync} onSync={sync.sincronizar} />
      </header>

      <div className="tabs">
        <button
          type="button"
          className={aba === 'influencers' ? 'tab active' : 'tab'}
          onClick={() => setParams({})}
        >
          Influencers
        </button>
        <button
          type="button"
          className={aba === 'representantes' ? 'tab active' : 'tab'}
          onClick={() => setParams({ aba: 'representantes' })}
        >
          Representantes
        </button>
      </div>

      <FiltroPeriodo periodo={periodo} onChange={setPeriodo} escolher={periodoDe} />
      {erro && <p className="error">{erro}</p>}

      {aba === 'influencers' ? (
        <>
          <div className="stats-row">
            <div className="stat-card destaque">
              <span className="stat-label">Receita com cupom</span>
              <strong className="stat-value">{brl(totalInf.receita)}</strong>
              <span className="stat-sub">produtos, já com desconto, sem frete</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Pedidos com cupom</span>
              <strong className="stat-value">{inteiro(totalInf.pedidos)}</strong>
              <span className="stat-sub">confirmados no período</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Comissão a pagar</span>
              <strong className="stat-value">{brl(totalInf.comissao)}</strong>
              <span className="stat-sub">pelo % de cada influencer</span>
            </div>
          </div>

          <div className="panel">
            {carregado && influencers.length === 0 ? (
              <div className="vazio-guia">
                <strong>Nenhum influencer cadastrado ainda.</strong>
                <p className="muted">
                  Cadastre em <Link to="/influencers">Influencers</Link> (com o % de comissão) e ligue o cupom dele em{' '}
                  <Link to="/cupons">Cupons</Link>. A venda entra aqui assim que o pagamento é confirmado.
                </p>
              </div>
            ) : (
              <div className="tabela-rola">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Influencer</th>
                      <th>Cupons</th>
                      <th className="num">Pedidos</th>
                      <th className="num">Receita</th>
                      <th className="num">Desconto dado</th>
                      <th className="num">Comissão</th>
                      <th>Última venda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {influencers.map((i, n) => (
                      <tr key={i.id} className={i.ativo ? '' : 'linha-off'}>
                        <td>
                          <Posicao n={n + 1} />
                        </td>
                        <td>
                          <strong>{i.nome}</strong>
                          {i.instagram && <span className="muted small bloco">@{i.instagram}</span>}
                        </td>
                        <td>
                          {i.cupons.length ? (
                            i.cupons.map((c) => (
                              <span key={c} className="badge cupom">
                                {c}
                              </span>
                            ))
                          ) : (
                            <span className="muted small">sem cupom</span>
                          )}
                        </td>
                        <td className="num">{inteiro(i.pedidos)}</td>
                        <td className="num">
                          <strong>{brl(i.receita)}</strong>
                        </td>
                        <td className="num">{brl(i.desconto)}</td>
                        <td className="num">
                          {brl(i.comissao)}
                          <span className="muted small bloco">{i.comissao_percent ? `${i.comissao_percent}%` : 'sem %'}</span>
                        </td>
                        <td className="nowrap">{dataCurta(i.ultima)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {semDono.length > 0 && (
            <div className="panel">
              <h2 className="panel-title">Cupons sem influencer</h2>
              <p className="muted small">Venderam no período, mas não estão ligados a ninguém.</p>
              <ul className="lista-simples">
                {semDono.map((c) => (
                  <li key={c.codigo}>
                    <span className="badge cupom">{c.codigo}</span>
                    <span>
                      {inteiro(c.pedidos)} pedido{c.pedidos === 1 ? '' : 's'} · {brl(c.receita)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="stats-row stats-4">
            <div className="stat-card destaque">
              <span className="stat-label">Faturamento</span>
              <strong className="stat-value">{brl(totalRep.fat)}</strong>
              <span className="stat-sub">pedidos confirmados dos representantes</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Pedidos</span>
              <strong className="stat-value">{inteiro(totalRep.pedidos)}</strong>
              <span className="stat-sub">{inteiro(reps.length)} representantes vendendo</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Clientes novos</span>
              <strong className="stat-value">{inteiro(totalRep.novos)}</strong>
              <span className="stat-sub">pedidos marcados "1ª venda"</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Tart Off</span>
              <strong className="stat-value">{inteiro(totalRep.un)}</strong>
              <span className="stat-sub">unidades de gel dental</span>
            </div>
          </div>

          <div className="panel">
            {carregado && reps.length === 0 ? (
              <p className="muted vazio">Nenhuma venda de representante nesse período.</p>
            ) : (
              <div className="tabela-rola">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Representante</th>
                      <th className="num">Faturamento</th>
                      <th className="num">Pedidos</th>
                      <th className="num">Ticket</th>
                      <th className="num">Clientes</th>
                      <th className="num">Novos</th>
                      <th className="num">Tart Off (un.)</th>
                      <th>Última venda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reps.map((r, n) => (
                      <tr key={r.vendedor}>
                        <td>
                          <Posicao n={n + 1} />
                        </td>
                        <td className="col-rep">
                          <strong>{nomeBonito(r.vendedor)}</strong>
                          <span className="barra-trilho fina">
                            <span className="barra-cheia" style={{ width: `${(r.faturamento / lider) * 100}%` }} />
                          </span>
                        </td>
                        <td className="num">
                          <strong>{brl(r.faturamento)}</strong>
                        </td>
                        <td className="num">{inteiro(r.pedidos)}</td>
                        <td className="num">{brl(r.pedidos ? r.faturamento / r.pedidos : 0)}</td>
                        <td className="num">{inteiro(r.clientes)}</td>
                        <td className="num">{r.clientes_novos ? inteiro(r.clientes_novos) : <span className="muted">—</span>}</td>
                        <td className="num">{r.unidades_tartoff ? inteiro(r.unidades_tartoff) : <span className="muted">—</span>}</td>
                        <td className="nowrap">{dataCurta(r.ultima)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
