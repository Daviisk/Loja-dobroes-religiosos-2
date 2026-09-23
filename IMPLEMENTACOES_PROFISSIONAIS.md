# Plano de Implementações Profissionais — Dobrões de Fé

Atualizado após a rodada de implementação de numeração amigável, histórico de entrega e pós-compra.

## Legenda

- ✅ **Implementado** — já existe no projeto e está incorporado ao código.
- 🟡 **Parcial** — a base existe, mas ainda falta concluir, integrar ou homologar.
- ⬜ **Pendente** — ainda precisa ser desenvolvido ou configurado.

---

## Implementado nesta rodada

- ✅ Numeração amigável sequencial para novos pedidos (`#1001`, `#1002`...), preservando UUID interno.
- ✅ Sequência transacional no PostgreSQL/Supabase.
- ✅ Contador transacional equivalente no SQLite de desenvolvimento/testes.
- ✅ Migration da sequência registrada em `supabase/migrations/20260920_add_order_number_sequence.sql`.
- ✅ Histórico persistido de transições de entrega com status anterior, novo status, data e origem (`system`, `payment` ou `admin`).
- ✅ Timeline administrativa passou a mostrar a data registrada de cada etapa concluída.
- ✅ Pós-compra passou a mostrar endereço, modalidade de frete, valor do frete e código de rastreio quando disponível.
- ✅ Página de acompanhamento passou a usar o número amigável do pedido.
- ✅ Testes automatizados adicionados para numeração amigável e histórico de entrega.

## Implementações já concluídas em rodadas anteriores

- ✅ Dashboard administrativo com métricas: pedidos, pagos, aguardando pagamento, aguardando envio, preparando, enviados, faturamento pago e ticket médio.
- ✅ Filtro por data inicial/final e botão para limpar filtros.
- ✅ Indicador de última atualização.
- ✅ Timeline visual do pedido.
- ✅ Botões para copiar telefone, e-mail, endereço, Payment ID, código do pedido e rastreio.
- ✅ Escape de HTML em dados dinâmicos exibidos no admin, reduzindo risco de XSS.
- ✅ Atualização visual do andamento após salvar status.
- ✅ Testes automatizados das métricas administrativas.
- ✅ Correção do login para esconder a tela de senha após autenticação.

---

# Sequência completa

## 1. Base técnica e infraestrutura — 🟡 Parcial

- ✅ Backend Node/Express.
- ✅ Deploy na Vercel.
- ✅ PostgreSQL/Supabase configurado para persistência em produção.
- ✅ `DATABASE_URL` usada somente no servidor.
- ✅ `ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET` configurados.
- ✅ GitHub Actions com testes automatizados.
- ✅ Sessão persistida no Supabase já verificada.
- ⬜ Homologar uma compra completa em modo de teste usando o banco compartilhado.
- ⬜ Revisar logs de runtime após a primeira compra de teste completa.

## 2. Painel administrativo profissional — 🟡 Parcial

- ✅ Login/logout administrativo protegido.
- ✅ Pedidos e clientes.
- ✅ Busca por pedido/cliente/contato/pagamento.
- ✅ Filtros por pagamento, entrega e período.
- ✅ Métricas operacionais e financeiras.
- ✅ Detalhes completos do pedido.
- ✅ Alteração de status de entrega.
- ✅ Código de rastreio e observações administrativas.
- ✅ Timeline visual com datas registradas de cada etapa.
- ✅ Botões de cópia rápida.
- ✅ Renderização protegida contra HTML injetado em dados exibidos.
- ⬜ Adicionar controle manual de ordenação no frontend.

## 3. Número amigável do pedido — ✅ Implementado

- ✅ UUID interno continua sendo a chave técnica do pedido.
- ✅ Novos pedidos recebem número sequencial amigável a partir de `1001`.
- ✅ PostgreSQL usa sequência transacional `public.order_number_seq`.
- ✅ SQLite usa contador transacional próprio para desenvolvimento/testes.
- ✅ Código amigável aparece no admin e no pós-compra.
- ✅ Migration registrada no repositório.
- ℹ️ Pedidos antigos mantêm o `orderCode` anterior; não é feita renumeração retroativa.

## 4. Detalhes e histórico do pedido — ✅ Implementado na base atual

- ✅ Cliente, pagamento, endereço, frete, itens, subtotal e total.
- ✅ Status de pagamento e de entrega.
- ✅ Rastreamento e observações internas.
- ✅ `createdAt`, `providerUpdatedAt` e `fulfillmentUpdatedAt` disponíveis na API administrativa.
- ✅ Histórico de cada transição de entrega com data, status anterior, novo status e origem.
- ✅ Transições automáticas de pagamento também entram no histórico.
- ✅ Transições manuais do admin entram no histórico.
- ✅ Datas são exibidas diretamente na timeline administrativa.

## 5. Clientes / mini CRM — 🟡 Parcial

- ✅ Clientes persistidos no banco.
- ✅ E-mail único no banco.
- ✅ Telefone é normalizado para apenas dígitos antes da persistência.
- ✅ Lista administrativa de clientes.
- ✅ Quantidade de pedidos, total pago e último pedido.
- ⬜ Criar página individual de cada cliente.
- ⬜ Mostrar histórico completo de pedidos por cliente.
- ⬜ Mostrar endereços já utilizados.

## 6. Estoque real — ⬜ Pendente

- ⬜ Criar tabela de estoque por produto.
- ⬜ Definir estoque atual e estoque mínimo.
- ⬜ Reservar/decrementar de maneira transacional.
- ⬜ Impedir venda acima do estoque disponível.
- ⬜ Marcar produto sem estoque automaticamente.
- ⬜ Alertar estoque baixo no admin.
- ⬜ Definir regra de devolução de estoque em cancelamento/reembolso.

> Observação: o controle de estoque não será ativado sem quantidades reais definidas para os produtos, para evitar bloquear vendas por configuração incompleta.

## 7. Carrinho — ✅ Implementado

- ✅ Persistência no navegador.
- ✅ Alteração de quantidade.
- ✅ Remoção de itens.
- ✅ Limpeza manual.
- ✅ Carrinho não é limpo simplesmente ao iniciar o checkout.
- ✅ Carrinho é limpo somente quando o servidor confirma pagamento `paid`.
- ✅ Pagamento pendente/processando mantém o carrinho.
- ✅ Compra recusada/erro mantém o carrinho.
- ✅ Confirmação de pedido antigo não apaga um carrinho novo diferente.
- ✅ Dados temporários da tentativa de pagamento são removidos após confirmação.

## 8. Checkout e Mercado Pago — 🟡 Parcial

- ✅ Checkout Transparente/CardForm integrado no código.
- ✅ Preços calculados no servidor.
- ✅ Idempotência de tentativa de checkout.
- ✅ Proteção contra alteração de preço pelo frontend.
- ✅ Suporte de status de pagamento e webhook.
- ✅ Fluxo preparado para 3DS.
- ⬜ Homologar cartão de teste aprovado.
- ⬜ Homologar cartão de teste recusado.
- ⬜ Homologar desafio 3DS de teste.
- ⬜ Validar comportamento em timeout/queda de rede durante cobrança.
- ⬜ Só depois alterar `MERCADO_PAGO_MODE=production`.

## 9. Pós-compra — 🟡 Parcial

- ✅ Página de acompanhamento do pedido.
- ✅ Consulta do status real no backend.
- ✅ Polling para pagamentos pendentes/processando.
- ✅ Exibição de itens, produtos, frete e total.
- ✅ Exibição do endereço completo de entrega.
- ✅ Exibição da modalidade e prazo de frete.
- ✅ Exibição do código de rastreio quando disponível.
- ✅ Número amigável do pedido exibido ao cliente.
- ✅ Limpeza segura do carrinho quando o pagamento é confirmado.
- ⬜ Refinar visual da página para o mesmo padrão premium da loja.
- ⬜ Adicionar timeline visual pública de preparação/envio/entrega.

## 10. Notificações automáticas — ⬜ Pendente

- ⬜ E-mail de pedido criado.
- ⬜ E-mail de pagamento aprovado.
- ⬜ E-mail de envio/rastreio.
- ⬜ E-mail de cancelamento/reembolso.
- ⬜ Notificação interna de nova venda aprovada.
- ⬜ Integração com WhatsApp, se desejada.

## 11. Frete e expedição — 🟡 Parcial

- ✅ Cotação de frete pelo backend.
- ✅ SuperFrete/Correios suportados pelo projeto.
- ✅ Cotação armazenada com expiração.
- ✅ Seleção da modalidade antes do checkout.
- ✅ Peso planejado de 60 g por item.
- ✅ Status de preparação/envio/rastreio no admin.
- ⬜ Homologar peso, dimensões e CEP de origem definitivos.
- ⬜ Integrar compra/geração automática de etiqueta, se a API escolhida permitir.
- ⬜ Disponibilizar impressão da etiqueta pelo admin.

## 12. Reembolso, mediação e chargeback — 🟡 Parcial

- ✅ Estados `refunded`, `partially_refunded`, `in_mediation` e `charged_back` suportados.
- ✅ Pedidos problemáticos podem entrar em `hold`.
- ✅ Filtros administrativos exibem esses estados.
- ✅ Outbox pendente pode ser bloqueada em estados de risco.
- ⬜ Criar painel específico de ocorrências financeiras.
- ⬜ Registrar motivo/observação de cada ocorrência.
- ⬜ Integrar ações de reembolso pelo admin somente após definir regras e permissões.

## 13. Logs e auditoria — 🟡 Parcial

- ✅ Tabela `events` para deduplicação/eventos do pagamento.
- ✅ Tabela `outbox` para efeitos posteriores.
- ✅ Datas de atualização persistidas nos pedidos.
- ✅ Histórico de transições de entrega persistido no próprio documento do pedido.
- ✅ Origem da transição registrada (`system`, `payment`, `admin`).
- ⬜ Criar audit log administrativo geral para alterações que não sejam apenas status de entrega.
- ⬜ Registrar identidade de quem alterou status/rastreio quando houver múltiplos administradores.
- ⬜ Criar tela de auditoria dedicada no admin.

## 14. Segurança — 🟡 Parcial

- ✅ Segredos mantidos no backend/Vercel.
- ✅ Cookie administrativo HttpOnly/SameSite Strict.
- ✅ Rate limit de login.
- ✅ Verificação de Origin nas mutações administrativas.
- ✅ CSRF no fluxo público sensível.
- ✅ Backend calcula catálogo/valores.
- ✅ RLS ativado nas tabelas e acesso direto do navegador bloqueado.
- ✅ Renderização administrativa dinâmica passa por escape de HTML.
- ⬜ Auditoria completa pré-produção de CSP, XSS, CSRF, sessão, SQL injection e autorização horizontal.
- ⬜ Pentest/manual abuse testing antes de volume real de vendas.

## 15. Testes de pagamento — 🟡 Parcial

- ✅ Testes automatizados de regras do backend/admin.
- ✅ Testes de segurança administrativa básicos.
- ✅ Testes de numeração amigável e histórico de entrega adicionados.
- ⬜ Compra aprovada de ponta a ponta.
- ⬜ Compra recusada.
- ⬜ Pagamento pendente/processando.
- ⬜ 3DS.
- ⬜ Duplo clique/repetição.
- ⬜ Webhook repetido e fora de ordem.
- ⬜ Reembolso parcial/total.
- ⬜ Chargeback/mediação.

## 16. Persistência Supabase — 🟡 Parcial

- ✅ Schema de clientes/sessões/pedidos/requests/eventos/outbox/cotações persistente.
- ✅ Sessão de produção já comprovada no banco.
- ✅ Sequência `order_number_seq` criada no Supabase.
- ✅ Migration da sequência salva no repositório.
- ⬜ Comprovar compra completa + webhook + visualização no admin usando produção de teste.
- ⬜ Testar concorrência em criação/pagamento de pedidos.

## 17. UX e responsividade — 🟡 Parcial

- ✅ Loja possui carrinho responsivo.
- ✅ Admin possui layout responsivo.
- ✅ Feedback de carregamento e estados vazios no admin.
- ✅ Botões e filtros adaptáveis.
- ✅ Datas do histórico se adaptam à timeline mobile do admin.
- ⬜ Auditoria completa em celulares pequenos, tablets e desktop.
- ⬜ Revisão de acessibilidade por teclado e leitor de tela.
- ⬜ Refinamento final de microinterações da loja.

## 18. Páginas institucionais e legais — ⬜ Pendente / requer conteúdo do negócio

- ⬜ Sobre a loja.
- ⬜ Contato.
- ⬜ Política de privacidade.
- ⬜ Termos de uso/venda.
- ⬜ Política de trocas e devoluções.
- ⬜ Política de envio e prazos.
- ⬜ Identificação comercial necessária.

## 19. SEO e compartilhamento — ⬜ Pendente de auditoria específica

- ⬜ Revisar title/description de todas as páginas públicas.
- ⬜ Open Graph.
- ⬜ Imagem de compartilhamento.
- ⬜ Sitemap.
- ⬜ robots.txt público adequado.
- ⬜ Schema.org de produtos quando aplicável.
- ⬜ Auditoria de imagens/alt/performance.

## 20. Analytics — ⬜ Pendente

- ⬜ Visualização de produto.
- ⬜ Adição ao carrinho.
- ⬜ Início de checkout.
- ⬜ Cotação de frete.
- ⬜ Início de pagamento.
- ⬜ Compra confirmada.
- ⬜ Funil de conversão sem enviar dados sensíveis.

## 21. Backup e recuperação — ⬜ Pendente de procedimento operacional

- ⬜ Verificar política de backup disponível no plano Supabase utilizado.
- ⬜ Definir rotina de exportação de pedidos/clientes.
- ⬜ Documentar procedimento de restauração.
- ⬜ Realizar teste de recuperação.

## 22. Monitoramento de produção — ⬜ Pendente

- ⬜ Alertas de erro HTTP 5xx.
- ⬜ Erros de conexão PostgreSQL.
- ⬜ Erros Mercado Pago.
- ⬜ Falhas de webhook.
- ⬜ Falhas de cotação de frete.
- ⬜ Painel/serviço de observabilidade e alertas.

## 23. Homologação final — ⬜ Pendente

Executar uma compra completa em ambiente de teste e comprovar:

- ⬜ Cliente gravado.
- ⬜ Pedido gravado.
- ⬜ Frete gravado.
- ⬜ Pagamento aprovado.
- ⬜ Webhook processado.
- ⬜ Pedido exibido no admin.
- ⬜ Carrinho zerado somente após `paid`.
- ⬜ Status alterado para preparação.
- ⬜ Rastreio salvo.
- ⬜ Status alterado para enviado.

## 24. Ativação do Mercado Pago em produção — ⬜ NÃO ativar ainda

Somente depois da homologação final:

- ⬜ Confirmar credenciais reais.
- ⬜ Confirmar Public Key.
- ⬜ Confirmar Access Token.
- ⬜ Confirmar Seller ID/Application ID quando exigidos.
- ⬜ Confirmar webhook real.
- ⬜ Alterar `MERCADO_PAGO_MODE=production`.
- ⬜ Redeploy.
- ⬜ Fazer compra real controlada de baixo valor.

## 25. Pós-lançamento — ⬜ Futuro

- ⬜ Conferir manualmente as primeiras vendas.
- ⬜ Monitorar webhook e pagamentos.
- ⬜ Monitorar estoque e frete.
- ⬜ Corrigir dúvidas recorrentes dos clientes.
- ⬜ Depois considerar cupons, avaliações, favoritos, kits, recuperação de carrinho e campanhas.

---

# Próximas prioridades recomendadas

1. Homologação de uma compra completa em modo de teste.
2. Estoque transacional, somente depois de definir quantidades reais por produto.
3. Página individual de cliente com histórico de pedidos e endereços.
4. Notificações por e-mail.
5. Refinamento visual do pós-compra e timeline pública.
6. Auditoria de segurança e testes de abuso.
7. Páginas legais.
8. Analytics e monitoramento.
9. Backup/recuperação.
10. Somente então ativar pagamentos reais.

---

# Comando Mestre

```text
Trabalhe no repositório Daviisk/Loja-dobroes-religiosos seguindo o arquivo IMPLEMENTACOES_PROFISSIONAIS.md como fonte de verdade do roadmap. Antes de alterar qualquer código, leia o estado atual do repositório e preserve tudo que já estiver funcionando. Execute somente itens marcados como pendentes ou parciais que possam ser implementados com segurança no ambiente disponível. Não exponha segredos, não altere credenciais e não ative MERCADO_PAGO_MODE=production sem homologação completa. Para cada implementação: preserve compatibilidade com PostgreSQL/Supabase e SQLite de desenvolvimento, adicione ou atualize testes, execute/verifique CI, evite regressões no carrinho/checkout/admin e atualize IMPLEMENTACOES_PROFISSIONAIS.md marcando exatamente o que foi concluído, o que ficou parcial e o que depende de configuração externa. Priorize segurança, idempotência, persistência, UX mobile e simplicidade operacional.
```
