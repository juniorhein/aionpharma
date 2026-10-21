import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';

export const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const inteiro = (n: number) => Number(n || 0).toLocaleString('pt-BR');

/** "2026-10-21" → "21/10/26" */
export function dataCurta(iso: string | null | undefined) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

/** Nome de empresa em caixa alta vira legível: "BSM VENDAS LTDA" → "Bsm Vendas LTDA". */
export function nomeBonito(s: string | null | undefined) {
  const t = String(s || '').trim();
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s(/-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())
    .replace(/\b(Ltda|Me|Eireli|Epp)\b/g, (m) => m.toUpperCase());
}

export const CANAIS: Record<string, string> = {
  loja: 'Loja · PF',
  loja_cnpj: 'Loja · CNPJ',
  mercado_livre: 'Mercado Livre',
  marketplace: 'Marketplace',
  representante: 'Representante',
  direto: 'Venda direta',
};

const CONFIRMADAS = ['Aprovado', 'Preparando envio', 'Faturado', 'Pronto para envio', 'Enviado', 'Entregue'];
const PENDENTES = ['Em aberto', 'Dados incompletos', 'Em digitação'];

/** Classe do selo de situação: verde confirmada, âmbar aguardando, cinza cancelada. */
export function classeSituacao(s: string | null) {
  if (!s) return 'badge off';
  if (CONFIRMADAS.includes(s)) return 'badge sit-ok';
  if (PENDENTES.includes(s)) return 'badge sit-wait';
  return 'badge sit-off';
}

/* ── Período ─────────────────────────────────────────────────── */

export type Periodo = { chave: string; de: string; ate: string };

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const PERIODOS: { chave: string; rotulo: string }[] = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: '7d', rotulo: '7 dias' },
  { chave: 'mes', rotulo: 'Este mês' },
  { chave: 'mes_passado', rotulo: 'Mês passado' },
  { chave: '90d', rotulo: '90 dias' },
  { chave: 'ano', rotulo: 'Este ano' },
  { chave: 'tudo', rotulo: 'Tudo' },
];

export function periodoDe(chave: string): Periodo {
  const hoje = new Date();
  const h = iso(hoje);
  const menos = (dias: number) => iso(new Date(hoje.getTime() - dias * 86400000));
  switch (chave) {
    case 'hoje':
      return { chave, de: h, ate: h };
    case '7d':
      return { chave, de: menos(6), ate: h };
    case 'mes':
      return { chave, de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: h };
    case 'mes_passado':
      return {
        chave,
        de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)),
        ate: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)),
      };
    case '90d':
      return { chave, de: menos(89), ate: h };
    case 'ano':
      return { chave, de: iso(new Date(hoje.getFullYear(), 0, 1)), ate: h };
    default:
      return { chave: 'tudo', de: '', ate: '' };
  }
}

export function query(params: Record<string, string | null | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) q.set(k, v);
  });
  return q.toString();
}

/* ── Sincronização com o Tiny ────────────────────────────────── */

type Status = { pendentes: number; total: number; ultima: string | null };

export function tempoAtras(isoData: string | null) {
  if (!isoData) return 'nunca';
  const min = Math.round((Date.now() - new Date(isoData).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

/**
 * Puxa o que mudou no Tiny ao abrir a página (se a última vez foi há
 * mais de 5 min) e quando o usuário pede. Cada passo do servidor tem
 * orçamento de tempo e de chamadas ao Tiny.
 */
export function useSyncTiny(aoTerminar: () => void) {
  const [status, setStatus] = useState<Status | null>(null);
  const [rodando, setRodando] = useState(false);
  const [aviso, setAviso] = useState('');
  const terminar = useRef(aoTerminar);
  terminar.current = aoTerminar;

  const sincronizar = useCallback(async () => {
    setRodando(true);
    setAviso('');
    try {
      // Poucos passos por vez: o limite de chamadas do Tiny é dividido
      // com a loja. O que sobrar continua na próxima abertura da página.
      for (let i = 0; i < 4; i++) {
        const r = await apiFetch('/api/admin/vendas', { method: 'POST', body: '{}' });
        setStatus((s) => ({ pendentes: r.pendentes, total: r.total, ultima: s?.ultima || null }));
        terminar.current();
        if (r.pendentes === 0) break;
        if (r.bloqueio) {
          setAviso('O Tiny está no limite de chamadas agora. O resto entra na próxima atualização.');
          break;
        }
      }
      const s = await apiFetch('/api/admin/vendas?tipo=status');
      setStatus(s);
      terminar.current();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Falha ao atualizar do Tiny');
    } finally {
      setRodando(false);
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/admin/vendas?tipo=status')
      .then((s: Status) => {
        setStatus(s);
        const velho = !s.ultima || Date.now() - new Date(s.ultima).getTime() > 5 * 60000;
        if (velho || s.pendentes > 0) sincronizar();
      })
      .catch((e) => setAviso(e.message));
  }, [sincronizar]);

  return { status, rodando, aviso, sincronizar };
}
