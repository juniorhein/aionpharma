import { PERIODOS, tempoAtras, type Periodo } from '../lib/vendas';

type SyncProps = {
  status: { pendentes: number; total: number; ultima: string | null } | null;
  rodando: boolean;
  aviso: string;
  onSync: () => void;
};

export function SyncTiny({ status, rodando, aviso, onSync }: SyncProps) {
  const progresso =
    rodando && status && status.total > 0
      ? `Atualizando do Tiny… ${status.total - status.pendentes} de ${status.total}`
      : rodando
        ? 'Atualizando do Tiny…'
        : `Tiny atualizado ${tempoAtras(status?.ultima || null)}`;
  return (
    <div className="sync">
      <span className={rodando ? 'sync-dot vivo' : 'sync-dot'} aria-hidden />
      <span className="sync-texto">{progresso}</span>
      <button type="button" className="btn-ghost btn-mini" onClick={onSync} disabled={rodando}>
        Atualizar
      </button>
      {aviso && <span className="sync-aviso">{aviso}</span>}
    </div>
  );
}

type PeriodoProps = {
  periodo: Periodo;
  onChange: (p: Periodo) => void;
  escolher: (chave: string) => Periodo;
};

export function FiltroPeriodo({ periodo, onChange, escolher }: PeriodoProps) {
  return (
    <div className="periodo">
      <div className="chips" role="group" aria-label="Período">
        {PERIODOS.map((p) => (
          <button
            key={p.chave}
            type="button"
            className={periodo.chave === p.chave ? 'chip ativo' : 'chip'}
            onClick={() => onChange(escolher(p.chave))}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <div className="datas">
        <input
          type="date"
          aria-label="De"
          value={periodo.de}
          onChange={(e) => onChange({ chave: 'custom', de: e.target.value, ate: periodo.ate })}
        />
        <span className="muted">até</span>
        <input
          type="date"
          aria-label="Até"
          value={periodo.ate}
          onChange={(e) => onChange({ chave: 'custom', de: periodo.de, ate: e.target.value })}
        />
      </div>
    </div>
  );
}
