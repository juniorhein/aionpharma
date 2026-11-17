import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

type Afiliado = {
  id: string; nome: string; codigo: string; contato: string | null;
  comissao_percent: string | number; ativo: boolean; coupon_id: string | null;
  cupom_codigo: string | null; cliques: number; pedidos: number; pagos: number;
  faturamento: string | number; comissao: string | number;
};
type Cupom = { id: string; codigo: string; ativo: boolean };
const empty = { nome: '', codigo: '', contato: '', comissao_percent: '0', ativo: true, coupon_id: '' };
const brl = (v: string | number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AfiliadosPage() {
  const [list, setList] = useState<Afiliado[]>([]);
  const [cupons, setCupons] = useState<Cupom[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const data = await apiFetch(`/api/admin/afiliados?${new URLSearchParams({ inicio, fim })}`);
    setList(data.afiliados || []);
  }
  useEffect(() => {
    Promise.all([apiFetch('/api/admin/afiliados'), apiFetch('/api/admin/coupons')])
      .then(([a,c]) => { setList(a.afiliados || []); setCupons(c.coupons || []); })
      .catch(e => setError(e.message));
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao salvar'); }
    finally { setBusy(false); }
  }
  function edit(a: Afiliado) {
    setEditing(a.id);
    setForm({ nome: a.nome, codigo: a.codigo, contato: a.contato || '', comissao_percent: String(a.comissao_percent), ativo: a.ativo, coupon_id: a.coupon_id || '' });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void action(async () => {
      await apiFetch('/api/admin/afiliados', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, ...(editing ? { id: editing } : {}) }) });
      setForm(empty); setEditing(null); await load();
    });
  }
  return <div className="page">
    <header className="page-header"><div><h1>Afiliados</h1><p className="muted">Links, cupons e resultados dos parceiros</p></div></header>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="grid-2" style={{ marginBottom: '1.25rem', alignItems: 'start' }}>
      <form className="panel form-panel" onSubmit={submit}>
        <h2>{editing ? 'Editar afiliado' : 'Novo afiliado'}</h2>
        <label>Nome*<input required maxLength={200} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
        <label>Código do link*<input required pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" maxLength={64} value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} /></label>
        <label>Contato<input maxLength={500} value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} /></label>
        <label>Comissão (%)<input required type="number" min="0" max="100" step="0.01" value={form.comissao_percent} onChange={e => setForm({ ...form, comissao_percent: e.target.value })} /></label>
        <label>Cupom vinculado<select value={form.coupon_id} onChange={e => setForm({ ...form, coupon_id: e.target.value })}><option value="">Sem cupom</option>{cupons.map(c => <option key={c.id} value={c.id}>{c.codigo}{!c.ativo ? ' (inativo)' : ''}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />Ativo</label>
        <div className="row-actions"><button className="btn-primary" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Atualizar' : 'Criar'}</button>{editing && <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancelar</button>}</div>
      </form>
      <section className="panel"><h2>Como funciona</h2><p>O último link acessado vale por 30 dias. Cada cupom pode pertencer a um afiliado e tem prioridade sobre o link na atribuição.</p><p>Comissão sobre produtos após desconto, sem frete, com a taxa registrada no pedido. Mudanças de taxa valem para novas compras.</p><p>O período considera a criação dos pedidos e cliques, no horário de Brasília. Faturamento pago inclui frete. Pagamentos estornados ou contestados não entram nos pagos.</p><p className="muted">Cupons continuam restritos aos produtos Tart Off elegíveis e não se aplicam à tabela de lojista.</p></section>
    </div>
    <section className="panel">
      <h2>Relatório por afiliado</h2>
      <form className="row-actions" onSubmit={e => { e.preventDefault(); void action(load); }}>
        <label>De <input aria-label="Data inicial" type="date" value={inicio} onChange={e => setInicio(e.target.value)} /></label>
        <label>Até <input aria-label="Data final" type="date" value={fim} onChange={e => setFim(e.target.value)} /></label>
        <button className="btn-primary" disabled={busy} style={{ alignSelf: 'flex-end' }}>Filtrar</button>
      </form>
      <div style={{ overflowX: 'auto' }}><table className="table"><thead><tr><th>Afiliado</th><th>Cupom</th><th>Taxa</th><th>Status</th><th>Cliques</th><th>Pedidos</th><th>Pagos</th><th>Faturamento pago</th><th>Comissão</th><th>Ações</th></tr></thead>
        <tbody>{list.map(a => <tr key={a.id}>
          <td><strong>{a.nome}</strong><div className="muted small">{a.codigo} · {a.contato || 'Sem contato'}</div></td><td>{a.cupom_codigo || '—'}</td><td>{Number(a.comissao_percent)}%</td><td><span className={a.ativo ? 'badge ok' : 'badge off'}>{a.ativo ? 'Ativo' : 'Inativo'}</span></td>
          <td>{a.cliques}</td><td>{a.pedidos}</td><td>{a.pagos}</td><td>{brl(a.faturamento)}</td><td>{brl(a.comissao)}</td>
          <td className="td-actions"><button className="btn-link" disabled={busy} onClick={() => edit(a)}>Editar</button>
            <button className="btn-link" disabled={busy} onClick={() => void action(async () => { await navigator.clipboard.writeText(`https://www.aionpharma.ind.br/?ref=${encodeURIComponent(a.codigo)}`); setNotice(`Link de ${a.nome} copiado.`); })}>Copiar link</button>
            <button className="btn-link" disabled={busy} onClick={() => void action(async () => { await apiFetch('/api/admin/afiliados', { method: 'PATCH', body: JSON.stringify({ id: a.id, ativo: !a.ativo }) }); await load(); })}>{a.ativo ? 'Desativar' : 'Ativar'}</button></td>
        </tr>)}</tbody></table></div>
      {!list.length && <p className="muted">Nenhum afiliado cadastrado.</p>}
    </section>
  </div>;
}
