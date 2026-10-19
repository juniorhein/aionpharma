/* ================================================================
   Regra de frete grátis da loja.
   ----------------------------------------------------------------
   Desde 19/10/2026 (decisão do Gabriel no grupo MKT/Ecommerce):
   frete grátis para Sul e Sudeste, o resto paga.
   A região sai direto da faixa do CEP (Correios), sem consulta externa:
     SP 01–19 · RJ 20–28 · ES 29 · MG 30–39   → Sudeste
     PR 80–87 · SC 88–89 · RS 90–99           → Sul
   FREE_SHIPPING_THRESHOLD (opcional) segue valendo como regra extra:
   acima desse subtotal, grátis para qualquer CEP. 0 = desligado.
   ================================================================ */

export function cepNaRegiaoGratis(cep) {
  const digitos = String(cep || '').replace(/\D/g, '');
  if (digitos.length !== 8) return false;
  const prefixo = Number(digitos.slice(0, 2));
  return (prefixo >= 1 && prefixo <= 39) || (prefixo >= 80 && prefixo <= 99);
}

export function temFreteGratis({ cep, subtotal }) {
  if (cepNaRegiaoGratis(cep)) return true;
  const limite = Number(process.env.FREE_SHIPPING_THRESHOLD || 0);
  return limite > 0 && Number(subtotal) >= limite;
}
