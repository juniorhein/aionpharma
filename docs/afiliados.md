# Programa de afiliados

Aplicar manualmente `supabase/schema-afiliados.sql` no banco **aion** antes de publicar o código. A migração é transacional e idempotente, depende da tabela `coupons` e não é executada pela implementação. Nenhuma alteração foi aplicada ao banco nesta entrega.

## Regras

- Links: `https://www.aionpharma.ind.br/?ref=CODIGO` ou qualquer página da loja com `?afiliado=CODIGO`.
- Código normalizado para minúsculas; último link vence por 30 dias em localStorage. Navegação comum não renova a validade. Reload usa o mesmo identificador de clique; POST repetido não duplica a contagem. Cliques são entradas por link, não visitantes únicos nem uma métrica antifraude.
- Cupom vinculado é validado pelas regras existentes e aplicado automaticamente, exceto B2B. Um cupom manual válido vinculado a afiliado ativo tem prioridade sobre o link. Cupom automático anterior é removido ao entrar por outro link. Cada cupom só pode estar vinculado a um afiliado.
- Servidor revalida o afiliado ativo. Código inválido/inativo não bloqueia a compra. Falhas no rastreamento ficam nos logs e não bloqueiam os fluxos existentes.
- Comissão calculada sobre produtos após desconto, sem frete. Taxa e valores são guardados em `pedidos_loja` na compra; editar o cadastro não recalcula pedidos antigos.
- Relatório filtra a criação do pedido/clique (datas inclusivas em America/Sao_Paulo). Faturamento inclui frete. Pago significa existir uma tentativa MP atualmente `approved`, confirmada pela API do MP no webhook. Reenvios não multiplicam pedidos; `refunded`/`charged_back` deixam de contar. Não há conciliação retroativa de webhooks perdidos nem cálculo proporcional de estorno parcial nesta versão.
- Desativar preserva histórico. Sem exclusão de afiliados.

## Testar

1. Aplicar o SQL em ambiente de teste e reaplicar para conferir idempotência.
2. Em `/admin/#/afiliados`, criar dois afiliados, vincular cupom existente a um, editar taxa/contato, copiar link e desativar/reativar. Código/cupom duplicado deve ser recusado; acesso à API sem login deve retornar 401.
3. Abrir o link em uma aba limpa: conferir cupom no carrinho e um clique. Recarregar e navegar: não deve aumentar cliques. Abrir o link do segundo: atribuição deve mudar e cupom automático anterior sair. Alterar `expira` de `aion_afiliado` para o passado: atribuição deve desaparecer.
4. Comprar em ambiente de teste com link, somente cupom e código inválido/inativo; conferir `pedidos_loja.afiliado_id`, `afiliado_codigo` e taxa. Conferir B2B sem cupom e carrinho misto preservando desconto só em SKUS_CUPOM.
5. Simular pagamentos com credenciais de teste: pending, approved, reenvio do mesmo evento, tentativa rejeitada separada e refunded. Conferir relatório, período e comissão; trocar taxa e confirmar que pedidos anteriores não mudam.

Validação offline disponível: `node scripts/test-afiliados.mjs` (mocks, sem acesso à rede ou banco). Também executados `node --check` em todo JS/MJS tocado, TypeScript sem emissão, `npm run build` em admin e `node scripts/build-for-vercel.mjs`. Os builds passaram numa cópia com dependências locais em `C:\tmp\aion-afiliados-validation`: no diretório original, esbuild foi bloqueado ao ler pastas ancestrais pelo sandbox Windows. Tela conferida em 1440px e 390px, com APIs simuladas e rede externa bloqueada.

## Arquivos

- `api/_lib/afiliados.js`, `api/_lib/admin-rotas/afiliados.js`, `api/admin/[acao].js`: validação, persistência, cliques e gestão/relatório autenticados.
- `api/produtos.js`: rota pública reutilizada com `?afiliado=`, GET consulta e POST registra clique, sem cache.
- `api/checkout.js`, `api/webhook.js`: atribuição e status do pagamento; sem alterar preços, descontos, e-mails ou envios.
- `script.js` e 14 HTMLs da loja: captura e envio, cache `v13` → `v14` somente do script.
- `admin/src/pages/AfiliadosPage.tsx`, `App.tsx`, `components/Layout.tsx`, `styles.css`: tela/menu e adaptação da navegação/tabela ao celular.
- `supabase/schema-afiliados.sql` e `scripts/test-afiliados.mjs`.

Contagem final: **8 funções em /api**, excluindo `_lib`; **zero novas**. Sem commit ou deploy.
