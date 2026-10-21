/* Login do painel — substitui o signInWithPassword do Supabase.
   POST { email, password } -> { token, user } */

import { autenticar, emitirToken } from '../auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  try {
    const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = corpo.email;
    const senha = corpo.password || corpo.senha;

    const user = await autenticar(email, senha);
    if (!user) {
      // mensagem única de propósito: não revela se o e-mail existe
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ token: emitirToken(user), user });
  } catch (e) {
    return res.status(500).json({ error: 'Falha no login.', detalhe: e.message });
  }
}
