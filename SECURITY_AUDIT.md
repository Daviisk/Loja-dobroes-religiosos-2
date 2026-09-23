# Auditoria de segurança pré-produção — Dobrões de Fé

Este documento separa controles já existentes de verificações que ainda exigem teste manual/live. Ele não substitui pentest profissional.

## Controles implementados

- Segredos apenas no servidor/variáveis de ambiente.
- Preço, catálogo, frete selecionado e total são recalculados/validados no backend.
- Sessão pública com cookie HttpOnly e token CSRF para mutações.
- Sessão administrativa assinada, HttpOnly, SameSite Strict e expiração.
- Rate limit global de API e limite adicional no login/checkout/webhook.
- Verificação de `Origin` para mutações sensíveis.
- Validação estrita de JSON, campos permitidos, UUIDs, cartão tokenizado e dados de cliente/endereço.
- Idempotência para criação/tentativa de pagamento.
- Reconciliação com o provedor antes de confiar em retorno do navegador.
- Webhook autenticado e validado contra aplicação, vendedor e modo.
- Proteções contra webhook duplicado/fora de ordem e regressão indevida de estado financeiro.
- RLS e revogação de `anon`/`authenticated` nas tabelas de backend.
- Escape de HTML no painel administrativo.
- CSP, HSTS em produção, `frame-ancestors 'none'`, `object-src 'none'` e `base-uri 'none'`.
- Autorização horizontal do pedido público vinculada à sessão proprietária.
- Estoque transacional preparado para reserva/consumo quando a flag for explicitamente ativada.
- Logs estruturados de erros sem gravar dados de cartão.

## Testes automatizados esperados

A suíte deve cobrir pelo menos:

- acesso ao admin sem sessão;
- senha administrativa inválida;
- mutação administrativa com `Origin` externo;
- CSRF ausente/incorreto;
- tentativa de consultar pedido de outra sessão;
- preço/quantidade enviados pelo cliente não alterando o valor do servidor;
- idempotency key reaproveitada com carrinho diferente;
- cobrança repetida não criando segundo pagamento;
- webhook com assinatura/aplicação/vendedor/modo incorretos;
- webhook repetido e atualização financeira fora de ordem;
- pagamento aprovado, recusado e 3DS simulado;
- estoque insuficiente quando enforcement estiver ligado;
- reserva de estoque idempotente e liberação em falha/cancelamento.

## Testes manuais antes de pagamentos reais

- CSP no navegador sem violações inesperadas nas páginas pública, pós-compra e admin.
- Fluxo 3DS real do ambiente de teste.
- Recarregar/fechar o navegador durante a cobrança e retornar ao pedido.
- Dois navegadores tentando comprar a última unidade ao mesmo tempo após o estoque ser ativado.
- Tentar alterar IDs, quantidade, preço, frete, `orderId`, `customerId` e `paymentId` pelo DevTools.
- Verificar que mensagens de erro não expõem SQL, stack trace, credenciais ou tokens.
- Validar logout/expiração do admin e impossibilidade de reusar cookie expirado.
- Revisar permissões do Supabase e da Vercel.

## Exceções mantidas

- `MERCADO_PAGO_MODE=production` não deve ser ativado até a homologação final.
- `INVENTORY_ENFORCEMENT=true` não deve ser ativado até todas as quantidades reais estarem cadastradas e testadas.
- Não implementar reembolso administrativo até regras, permissões e responsabilidade operacional estarem definidas.

**Status:** controles e matriz de teste implementados/documentados; pentest/manual abuse testing em ambiente publicado continua pendente.
