# Plano de Implementações Profissionais — Dobrões de Fé

Atualizado após a implementação do Pix junto do CardForm e das melhorias profissionais acumuladas na branch `automation/professionalization-round-2`.

## Legenda

- ✅ **Implementado** — código criado e integrado.
- 🟡 **Parcial** — estrutura criada, mas depende de configuração, homologação ou validação operacional.
- ⬜ **Pendente** — ainda precisa ser desenvolvido ou validado.
- 🚫 **Exceção respeitada** — não deve ser ativado automaticamente sem dados, homologação ou autorização.

---

## Implementado nesta rodada

- ✅ Pix integrado ao Checkout Transparente junto do CardForm.
- ✅ Endpoint dedicado de preparação do Pix (`/api/pix/prepare`).
- ✅ Endpoint dedicado de criação/reconciliação do Pix (`/api/pix/pay`).
- ✅ `payment_method_id=pix` usando a Payments API já adotada pelo projeto.
- ✅ `X-Idempotency-Key` mantido também no Pix.
- ✅ QR Code retornado pelo Mercado Pago e renderizado dentro da loja.
- ✅ Pix Copia e Cola.
- ✅ Link seguro opcional do Mercado Pago (`ticket_url`).
- ✅ Validação de CPF/CNPJ para geração do Pix.
- ✅ Expiração de 30 minutos configurada para o Pix.
- ✅ Polling do pedido até confirmação do pagamento.
- ✅ Webhook existente continua reconciliando cartão e Pix.
- ✅ Bloqueio para impedir que um pedido já iniciado por um meio seja cobrado por outro meio.
- ✅ Status do Pix usa a mesma máquina de estados segura dos pagamentos existentes.
- ✅ Carrinho só é limpo quando o servidor confirma `paid`.
- ✅ Testes automatizados específicos para Pix adicionados.
- ✅ `/api/products` informa `cardFormConfigured`, `pixConfigured` e meios disponíveis.
- ✅ `/api/health` informa disponibilidade de CardForm e Pix.
- 🚫 `MERCADO_PAGO_MODE=production` não foi ativado.

## Implementações profissionais já incorporadas na branch

- ✅ Dashboard administrativo com métricas operacionais e financeiras.
- ✅ Filtros e ordenação de pedidos.
- ✅ Mini CRM com detalhe individual do cliente, pedidos e endereços.
- ✅ Ocorrências financeiras no admin.
- ✅ Estoque configurável, estoque mínimo e monitoramento.
- ✅ Estrutura de reservas transacionais de estoque.
- ✅ Audit log administrativo.
- ✅ Analytics interno e funil de conversão.
- ✅ Exportação de backup JSON.
- ✅ Endpoint `/api/health`.
- ✅ Estrutura de notificações por e-mail/outbox.
- ✅ SEO técnico, sitemap e robots.
- ✅ Página de pós-compra com timeline pública.
- ✅ Numeração amigável dos pedidos.

---

# Sequência completa

## 1. Base técnica e infraestrutura — 🟡 Parcial

- ✅ Backend Node/Express.
- ✅ PostgreSQL/Supabase para persistência compartilhada.
- ✅ `DATABASE_URL` somente no servidor.
- ✅ `ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET`.
- ✅ GitHub Actions.
- ✅ Sessões persistentes.
- ✅ Endpoint `/api/health`.
- ⬜ Homologar compra completa em ambiente publicado usando modo de teste.
- ⬜ Revisar logs após a primeira compra completa.
- 🚫 Não alterar credenciais reais automaticamente.

## 2. Painel administrativo profissional — ✅ Implementado na base atual

- ✅ Login/logout protegido.
- ✅ Pedidos.
- ✅ Clientes.
- ✅ Ocorrências financeiras.
- ✅ Estoque.
- ✅ Auditoria.
- ✅ Analytics.
- ✅ Busca e filtros.
- ✅ Ordenação manual.
- ✅ Métricas.
- ✅ Detalhes de pedido.
- ✅ Alteração de fulfillment.
- ✅ Rastreamento e observações.
- ✅ Timeline.
- ✅ Botões de cópia.
- ✅ Exportação de backup.
- ✅ Escape de HTML nos dados dinâmicos.

## 3. Número amigável do pedido — ✅ Implementado

- ✅ UUID interno preservado.
- ✅ Número sequencial amigável a partir de `1001`.
- ✅ PostgreSQL usa `public.order_number_seq`.
- ✅ SQLite usa contador transacional.
- ✅ Número exibido no admin e pós-compra.
- ℹ️ Pedidos antigos não são renumerados retroativamente.

## 4. Detalhes e histórico do pedido — ✅ Implementado

- ✅ Cliente, pagamento, endereço, frete e itens.
- ✅ Subtotal e total.
- ✅ Status de pagamento e entrega.
- ✅ Rastreio e observações.
- ✅ Histórico das transições de fulfillment.
- ✅ Origem e data das transições.

## 5. Clientes / mini CRM — ✅ Implementado na base atual

- ✅ Clientes persistidos.
- ✅ E-mail único.
- ✅ Telefone normalizado.
- ✅ Lista administrativa.
- ✅ Quantidade de pedidos e total pago.
- ✅ Último pedido.
- ✅ Tela/detalhe individual do cliente.
- ✅ Histórico de pedidos do cliente.
- ✅ Endereços já utilizados.

## 6. Estoque real — 🟡 Parcial / 🚫 proteção mantida

- ✅ Tabela de estoque por produto.
- ✅ Quantidade e estoque mínimo.
- ✅ Monitoramento por produto.
- ✅ Indicador de estoque baixo no admin.
- ✅ Estrutura de `inventory_reservations` em SQLite e Supabase.
- ✅ RLS nas reservas no Supabase.
- 🟡 Reserva/decremento transacional já possui base no backend.
- ⬜ Homologar concorrência e expiração de reservas com pagamentos reais de teste.
- ⬜ Homologar devolução de estoque em todos os cenários de reembolso/cancelamento.
- 🚫 `INVENTORY_ENFORCEMENT` deve permanecer desligado até definir quantidades reais e concluir os testes.

## 7. Carrinho — ✅ Implementado

- ✅ Persistência no navegador.
- ✅ Quantidade e remoção.
- ✅ Limpeza manual.
- ✅ Não limpa ao iniciar checkout.
- ✅ Limpa somente depois de `paid`.
- ✅ Pendência/erro preserva o carrinho.
- ✅ Pedido antigo não deve apagar carrinho novo.
- ✅ Dados temporários removidos depois da confirmação.

## 8. Checkout e Mercado Pago — 🟡 Parcial

### Cartão

- ✅ CardForm/Checkout Transparente.
- ✅ Campos sensíveis tokenizados pelo Mercado Pago.
- ✅ Preços calculados no servidor.
- ✅ Idempotência.
- ✅ 3DS preparado.
- ✅ Webhook.

### Pix

- ✅ Pix oferecido junto do CardForm.
- ✅ Mesmo total autoritativo do servidor.
- ✅ Geração via `/v1/payments` com `payment_method_id=pix`.
- ✅ Idempotência.
- ✅ CPF/CNPJ.
- ✅ QR Code.
- ✅ Pix Copia e Cola.
- ✅ Link `ticket_url` validado antes de ser exibido.
- ✅ Validade de 30 minutos.
- ✅ Polling de confirmação.
- ✅ Webhook compartilhado com cartão.
- ✅ Bloqueio de troca de meio depois que uma cobrança já foi iniciada.

### Homologações ainda necessárias

- ⬜ Homologar cartão aprovado com credenciais de teste.
- ⬜ Homologar cartão recusado.
- ⬜ Homologar 3DS.
- ⬜ Homologar geração de Pix com a conta de teste.
- ⬜ Homologar confirmação de Pix pago por webhook.
- ⬜ Testar expiração do Pix.
- ⬜ Testar timeout/queda de rede.
- 🚫 Só depois alterar `MERCADO_PAGO_MODE=production`.

> Para o Pix aparecer na conta real, o Mercado Pago exige uma chave Pix cadastrada na conta recebedora. Isso é configuração externa e não é criada pelo código da loja.

## 9. Pós-compra — ✅ Implementado na base atual

- ✅ Página de acompanhamento.
- ✅ Status real do backend.
- ✅ Polling.
- ✅ Itens, frete, total e endereço.
- ✅ Rastreio.
- ✅ Número amigável.
- ✅ Timeline pública.
- ✅ Limpeza segura do carrinho após pagamento confirmado.

## 10. Notificações automáticas — 🟡 Parcial

- ✅ Infraestrutura de notificações/outbox.
- ✅ Eventos de pagamento, envio, entrega e ocorrências financeiras.
- ✅ Retry pelo admin.
- ⬜ Configurar provedor real de e-mail.
- ⬜ Homologar entrega de e-mails.
- ⬜ Templates finais da marca.
- ⬜ WhatsApp, se desejado.
- 🚫 Não inventar nem expor credenciais externas.

## 11. Frete e expedição — 🟡 Parcial

- ✅ Cotação pelo backend.
- ✅ SuperFrete/Correios suportados.
- ✅ Cotação com expiração.
- ✅ Seleção antes do pagamento.
- ✅ Status de preparação/envio/rastreio.
- ⬜ Homologar peso, dimensões e CEP de origem definitivos.
- ⬜ Geração automática de etiqueta.
- ⬜ Impressão de etiqueta no admin.
- 🚫 Não ativar compra de etiquetas sem dados e API definitivos.

## 12. Reembolso, mediação e chargeback — 🟡 Parcial

- ✅ `refunded`, `partially_refunded`, `in_mediation` e `charged_back`.
- ✅ `hold` para pedidos de risco.
- ✅ Aba de ocorrências financeiras.
- ✅ Bloqueio de efeitos pendentes em estados de risco.
- ⬜ Motivo administrativo detalhado da ocorrência.
- ⬜ Ações de reembolso pelo admin.
- 🚫 Não habilitar reembolso operacional sem política e permissões definidas.

## 13. Logs e auditoria — ✅ Base implementada

- ✅ `events`.
- ✅ `outbox`.
- ✅ Histórico de fulfillment.
- ✅ `audit_log`.
- ✅ Auditoria de alterações administrativas.
- ✅ Auditoria de estoque.
- ✅ Tela de auditoria.
- 🟡 Múltiplos administradores exigiriam modelo próprio de usuários.

## 14. Segurança — 🟡 Parcial

- ✅ Segredos somente no backend.
- ✅ Cookie HttpOnly/SameSite Strict para admin.
- ✅ Rate limit.
- ✅ Origin check.
- ✅ CSRF.
- ✅ Valores calculados no servidor.
- ✅ RLS.
- ✅ Escape de HTML no admin.
- ✅ Validação de UUID nas rotas administrativas.
- ✅ Pix não recebe nem armazena dados de cartão.
- ✅ QR/ticket Pix passam por validação antes de exposição ao navegador.
- ✅ Documento `SECURITY_AUDIT.md`.
- ⬜ Pentest/manual abuse testing final.

## 15. Testes de pagamento — 🟡 Parcial

- ✅ Testes automatizados de CardForm.
- ✅ Idempotência de cartão.
- ✅ Webhook assinado em testes.
- ✅ 3DS em testes automatizados.
- ✅ Testes automatizados do Pix.
- ✅ Pix aparece como método disponível.
- ✅ Pix retorna QR Code validado.
- ✅ Pix preserva idempotência.
- ✅ Documento Pix inválido é rejeitado.
- ✅ Pix pendente reconcilia para pago em teste automatizado.
- ⬜ Homologação integrada com a plataforma Mercado Pago em ambiente de teste.

## 16. Persistência Supabase — 🟡 Parcial

- ✅ Clientes, sessões, pedidos, requests, events, outbox e cotações.
- ✅ Sequência amigável.
- ✅ Audit log.
- ✅ Inventário.
- ✅ Analytics.
- ✅ Reservas de estoque.
- ⬜ Comprovar compra completa + webhook + admin em ambiente publicado.
- ⬜ Testar concorrência de estoque antes do enforcement.

## 17. UX e responsividade — 🟡 Parcial

- ✅ Carrinho responsivo.
- ✅ Admin responsivo.
- ✅ Pós-compra refinado.
- ✅ Fluxo Pix com botão próprio, QR Code e Copia e Cola.
- ⬜ Auditoria manual completa em celulares pequenos, tablet e desktop.
- ⬜ Revisão final de teclado/leitor de tela.

## 18. Páginas institucionais e legais — 🟡 Parcial / 🚫 depende do negócio

- ✅ Documento `CONTEUDO_LEGAL_NECESSARIO.md`.
- ⬜ Sobre.
- ⬜ Contato.
- ⬜ Política de privacidade final.
- ⬜ Termos de venda final.
- ⬜ Trocas/devoluções final.
- ⬜ Envio/prazos final.
- ⬜ Identificação comercial final.
- 🚫 Não publicar dados jurídicos ou comerciais inventados.

## 19. SEO e compartilhamento — 🟡 Parcial

- ✅ Serviço de SEO.
- ✅ Metadados técnicos da home.
- ✅ Sitemap.
- ✅ Robots.txt.
- ⬜ Imagem Open Graph definitiva.
- ⬜ Schema.org completo de produtos.
- ⬜ Auditoria final de imagens/alt/performance.

## 20. Analytics — ✅ Código implementado / 🟡 ativação configurável

- ✅ `page_view`.
- ✅ `product_view`.
- ✅ `add_to_cart`.
- ✅ `shipping_quote`.
- ✅ `checkout_start`.
- ✅ `payment_start`.
- ✅ `purchase`.
- ✅ Funil no admin.
- ✅ Sem dados de cartão.

## 21. Backup e recuperação — 🟡 Parcial

- ✅ Exportação JSON no admin.
- ✅ Pedidos, clientes, auditoria e estoque.
- ✅ `BACKUP_RECUPERACAO.md`.
- ⬜ Testar restauração completa.
- ⬜ Definir periodicidade operacional.
- ⬜ Confirmar política de backup do plano Supabase.

## 22. Monitoramento — 🟡 Parcial

- ✅ `/api/health`.
- ✅ Banco, frete, admin, notificações, analytics, CardForm e Pix informados no health check.
- ✅ Logging estruturado de erros internos.
- ⬜ Serviço externo de alertas.
- 🚫 Não configurar serviço externo sem conta/credenciais autorizadas.

## 23. Homologação final — ⬜ Pendente

Comprovar no ambiente de teste publicado:

- ⬜ Cliente gravado.
- ⬜ Pedido gravado.
- ⬜ Frete gravado.
- ⬜ Cartão aprovado.
- ⬜ Cartão recusado.
- ⬜ 3DS.
- ⬜ Pix gerado.
- ⬜ Pix pago.
- ⬜ Webhook do Pix.
- ⬜ Pedido no admin.
- ⬜ Carrinho zerado apenas após `paid`.
- ⬜ Preparação e envio.
- ⬜ Rastreio.
- ⬜ Notificação.
- ⬜ Analytics.
- ⬜ Backup.

## 24. Ativação do Mercado Pago em produção — 🚫 NÃO ativar ainda

Somente depois da homologação final:

- ⬜ Confirmar credenciais reais.
- ⬜ Confirmar chave Pix cadastrada na conta recebedora.
- ⬜ Confirmar Public Key.
- ⬜ Confirmar Access Token.
- ⬜ Confirmar Seller ID/Application ID.
- ⬜ Confirmar webhook real.
- ⬜ Alterar `MERCADO_PAGO_MODE=production`.
- ⬜ Redeploy.
- ⬜ Compra real controlada de baixo valor por cartão e Pix.

## 25. Pós-lançamento — ⬜ Futuro

- ⬜ Acompanhar primeiras vendas.
- ⬜ Monitorar webhooks e pagamentos.
- ⬜ Monitorar estoque/frete.
- ⬜ Cupons, avaliações, favoritos, kits e recuperação de carrinho.

---

# Comando Mestre

```text
Trabalhe no repositório Daviisk/Loja-dobroes-religiosos seguindo IMPLEMENTACOES_PROFISSIONAIS.md como fonte de verdade. Preserve tudo que já funciona. Continue somente itens pendentes/parciais seguros. Respeite as exceções: não ativar Mercado Pago em produção antes da homologação; não ativar enforcement de estoque sem quantidades reais e testes de concorrência; não inventar dados legais/comerciais; não configurar serviços externos sem credenciais autorizadas. Preserve compatibilidade PostgreSQL/Supabase e SQLite, adicione testes, verifique CI, evite regressões em carrinho, CardForm, Pix e admin e atualize este arquivo após cada rodada.
```
