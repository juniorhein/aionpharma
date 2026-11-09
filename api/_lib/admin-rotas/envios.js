/* ================================================================
   /api/admin/envios — e-mail de "pedido enviado" (rastreio)
   ----------------------------------------------------------------
   Quem chama:
     · Vercel Cron (vercel.json) e o GitHub Actions (.github/workflows/
       envios.yml), com "Authorization: Bearer <CRON_SECRET>"
     · admin logado no painel (token do painel)

   GET                         uma rodada (manda os e-mails devidos)
   GET ?simular=1              só diz o que faria; não grava, não envia
   GET ?registros=1            últimos registros de envio_emails
   GET ?teste=<id Tiny>&para=  manda o e-mail real do pedido SÓ para
                               um endereço @tartoff.com.br (prova)
   ================================================================ */

import { requireAdmin } from '../auth.js';
import { rodarEnvios, enviarTeste, listarRegistros } from '../envios.js';

function cronAutorizado(req) {
  const segredo = process.env.CRON_SECRET;
  return Boolean(segredo) && req.headers?.authorization === `Bearer ${segredo}`;
}

export default async function handler(req, res) {
  if (!cronAutorizado(req)) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const q = req.query || {};
  try {
    if (q.registros) return res.status(200).json({ registros: await listarRegistros() });

    if (q.teste) {
      const para = String(q.para || '').trim().toLowerCase();
      // Prova nunca vai para cliente: só endereço da casa.
      if (!/^[a-z0-9._%+-]+@tartoff\.com\.br$/.test(para)) {
        return res.status(400).json({ error: 'Teste só para endereço @tartoff.com.br' });
      }
      return res.status(200).json(await enviarTeste(String(q.teste), para));
    }

    const r = await rodarEnvios({ simular: Boolean(q.simular) });
    console.log('[/api/admin/envios]', JSON.stringify(r));
    return res.status(200).json(r);
  } catch (err) {
    console.error('[/api/admin/envios]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
