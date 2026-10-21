import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

type Influencer = {
  id: string;
  nome: string;
  email: string | null;
  instagram: string | null;
  ativo: boolean;
  comissao_percent?: number | string | null;
};

const empty = { nome: '', email: '', instagram: '', comissao_percent: '', ativo: true };

export default function InfluencersPage() {
  const [list, setList] = useState<Influencer[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await apiFetch('/api/admin/influencers');
    setList(data.influencers || []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function startEdit(inf: Influencer) {
    setEditingId(inf.id);
    setForm({
      nome: inf.nome,
      email: inf.email || '',
      instagram: inf.instagram || '',
      comissao_percent: Number(inf.comissao_percent) ? String(Number(inf.comissao_percent)) : '',
      ativo: inf.ativo,
    });
  }

  function reset() {
    setEditingId(null);
    setForm(empty);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editingId) {
        await apiFetch('/api/admin/influencers', {
          method: 'PATCH',
          body: JSON.stringify({ id: editingId, ...form }),
        });
      } else {
        await apiFetch('/api/admin/influencers', {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function toggleAtivo(inf: Influencer) {
    try {
      await apiFetch('/api/admin/influencers', {
        method: 'PATCH',
        body: JSON.stringify({ id: inf.id, ativo: !inf.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Influencers</h1>
          <p className="muted">Cadastre quem receberá cupons personalizados</p>
        </div>
      </header>

      <div className="grid-2">
        <form className="panel form-panel" onSubmit={onSubmit}>
          <h2>{editingId ? 'Editar influencer' : 'Novo influencer'}</h2>
          <label>
            Nome*
            <input
              required
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Instagram
            <input
              placeholder="handle sem @"
              value={form.instagram}
              onChange={(e) => setForm({ ...form, instagram: e.target.value })}
            />
          </label>
          <label>
            Comissão (% sobre a venda com o cupom)
            <input
              inputMode="decimal"
              placeholder="ex.: 10"
              value={form.comissao_percent}
              onChange={(e) => setForm({ ...form, comissao_percent: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
            />
            Ativo
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row-actions">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Salvando…' : editingId ? 'Atualizar' : 'Criar'}
            </button>
            {editingId && (
              <button type="button" className="btn-ghost" onClick={reset}>
                Cancelar
              </button>
            )}
          </div>
        </form>

        <div className="panel">
          <h2>Lista</h2>
          {list.length === 0 ? (
            <p className="muted">Nenhum influencer ainda.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Instagram</th>
                  <th>Comissão</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((inf) => (
                  <tr key={inf.id}>
                    <td>
                      <strong>{inf.nome}</strong>
                      {inf.email && <div className="muted small">{inf.email}</div>}
                    </td>
                    <td>{inf.instagram ? `@${inf.instagram}` : '—'}</td>
                    <td>{Number(inf.comissao_percent) ? `${Number(inf.comissao_percent)}%` : '—'}</td>
                    <td>
                      <span className={inf.ativo ? 'badge ok' : 'badge off'}>
                        {inf.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="td-actions">
                      <button type="button" className="btn-link" onClick={() => startEdit(inf)}>
                        Editar
                      </button>
                      <button type="button" className="btn-link" onClick={() => toggleAtivo(inf)}>
                        {inf.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
