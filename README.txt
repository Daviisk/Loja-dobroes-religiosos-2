DOBRÕES DE FÉ — CARRINHO, FRETE, CARDFORM E PAINEL DE PEDIDOS
HTML/CSS/JavaScript puro + Node.js 24 + PostgreSQL/Supabase em produção

VISÃO GERAL
A loja vende cinco dobrões religiosos. O checkout atual usa Mercado Pago CardForm
(Checkout Transparente): o comprador informa o cartão dentro da loja, os campos
sensíveis são tokenizados pelo MercadoPago.js e o servidor recebe somente o token
e os dados mínimos necessários para criar o pagamento em /v1/payments.

O fluxo antigo de Checkout Pro / API Orders foi removido do backend público.
Não existe mais POST /api/checkout nem criação de /v1/orders no fluxo da loja.

CATÁLOGO
backend/products.js é a fonte confiável de preços e disponibilidade.
Os cinco produtos estão configurados com priceCents:15000 (R$ 150,00 cada).
O navegador envia somente IDs e quantidades; preço, frete e total são calculados
novamente pelo servidor.

IDENTIFICAÇÃO DO CLIENTE
Antes do pagamento o comprador informa:
- nome para entrega
- WhatsApp com DDD
- e-mail

O backend normaliza esses dados e gera um customerId UUID. Compras futuras são
relacionadas principalmente pelo e-mail e, quando necessário, pelo telefone.
O CPF/documento informado no CardForm continua sendo dado de pagamento e não é
usado como identificador principal no painel da loja.

FLUXO ATUAL
1. Carrinho envia IDs/quantidades e CEP para POST /api/shipping/quote.
2. O servidor calcula o frete e cria uma cotação temporária vinculada à sessão.
3. POST /api/card/prepare recebe items, customer, address e quoteId.
4. O servidor valida cliente/endereço/frete, recalcula produtos + frete, cria o
   pedido e devolve o total oficial.
5. O frontend inicia o MercadoPago.js CardForm com esse total oficial.
6. Número, validade e CVV são tokenizados pelo SDK do Mercado Pago.
7. POST /api/card/pay recebe orderId + token/dados do CardForm.
8. O backend cria POST https://api.mercadopago.com/v1/payments com
   X-Idempotency-Key persistida no pedido.
9. Pagamentos pendentes são reconciliados por GET /v1/payments/{id}.
10. Webhooks assinados do tópico payment também reconciliam o pagamento.

PAINEL ADMINISTRATIVO
O painel fica em APP_URL/admin e possui login próprio.

Recursos:
- busca por pedido, cliente, e-mail, telefone ou Payment ID
- filtros por status financeiro e andamento da entrega
- contadores de pedidos em aberto, preparação e enviados
- detalhes de cliente, endereço, itens, frete e pagamento
- código de rastreio
- observações internas
- estados: aguardando pagamento, pago, em preparação, enviado, entregue, em
  análise e cancelado
- página Clientes com customerId, contato, número de pedidos, total em pedidos
  pagos e data do último pedido

O backend impede marcar um pedido como em preparação/enviado/entregue quando o
pagamento ainda não está confirmado como paid.

Variáveis do painel:
ADMIN_PASSWORD=senha longa e exclusiva com no mínimo 12 caracteres
ADMIN_SESSION_SECRET=segredo aleatório do servidor com no mínimo 32 caracteres

A sessão do painel usa cookie HttpOnly + SameSite=Strict, expira em oito horas,
as mutações exigem Origin exata e o login possui rate limit.

3D SECURE
A criação do pagamento usa three_d_secure_mode=optional.
Quando o Mercado Pago retorna pending/pending_challenge, o backend devolve somente
external_resource_url HTTPS e creq validados. O frontend abre o desafio do banco
em iframe e continua consultando o status do pagamento.

ESTADOS FINANCEIROS
A aplicação diferencia:
- paid
- processing
- failed
- cancelled
- refunded
- partially_refunded
- in_mediation
- charged_back

approved + status_detail=partially_refunded é tratado como reembolso parcial e
bloqueia a outbox de expedição ainda pendente. Reembolso, mediação e chargeback
não são tratados como pagamento aprovado normal e movem a entrega pendente para
hold quando aplicável.

SEGURANÇA DO PAGAMENTO
- Access Token fica somente no backend.
- Public Key é a única credencial Mercado Pago enviada ao navegador.
- Número do cartão, validade e CVV não são armazenados pelo servidor da loja.
- Total e frete são calculados pelo servidor.
- POSTs financeiros exigem sessão, Origin exata, CSRF e Idempotency-Key UUID.
- O pedido é criado antes da cobrança.
- A mesma tentativa reutiliza a mesma chave idempotente.
- Após existir Payment ID, novas tentativas reconciliam o pagamento existente em
  vez de criar outra cobrança.
- O webhook não confia em status/valor do body: após validar x-signature, consulta
  /v1/payments/{id} com o Access Token e valida referência, valor, vendedor,
  aplicação, moeda e ambiente.
- Webhook order/Orders é rejeitado; somente payment é aceito.

WEBHOOK
Configure no Mercado Pago o evento Pagamentos (payment) para:
APP_URL/api/webhooks/mercadopago

Variável necessária:
WEBHOOK_SECRET=chave secreta da configuração de Webhooks da aplicação.

A assinatura é validada pelo WebhookSignatureValidator do SDK oficial usando:
- x-signature
- x-request-id
- data.id da query string
- WEBHOOK_SECRET

Não existe mais corte manual de cinco minutos no timestamp. Isso evita rejeitar
reenvios legítimos do Mercado Pago; replay não altera estado financeiro sem que a
consulta autenticada de /v1/payments confirme o estado atual, e os eventos são
deduplicados no banco.

VARIÁVEIS MERCADO PAGO
MERCADO_PAGO_MODE=test | production
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_PUBLIC_KEY=
MERCADO_PAGO_SELLER_ID=
MERCADO_PAGO_APPLICATION_ID=
WEBHOOK_SECRET=
APP_URL=https://seu-dominio

Nunca coloque Access Token, WEBHOOK_SECRET, DATABASE_URL ou ADMIN_SESSION_SECRET
em HTML, JavaScript público, Git ou mensagens. A Public Key pode ser usada no
frontend por definição do Mercado Pago.

FRETE
O projeto suporta SuperFrete e adaptador Correios. Peso padrão por unidade: 60 g.
A cotação é vinculada a sessão, carrinho, CEP e quoteId. Uma nova cotação gera um
novo contexto de pedido CardForm, evitando reutilizar frete expirado.

ARMAZENAMENTO, SUPABASE E VERCEL
Em produção na Vercel, quando DATABASE_URL está configurada, o backend usa
PostgreSQL do Supabase para sessões, clientes, pedidos, cotações, idempotência,
eventos e outbox. O projeto Supabase de produção é dobroes-de-fe, na região
sa-east-1.

Use a URI do Supabase Transaction Pooler (porta 6543) como DATABASE_URL. O cliente
Postgres desativa prepared statements, requisito do Transaction Pooler, e limita o
pool por instância serverless.

As tabelas públicas do Supabase têm RLS habilitado sem políticas públicas: o
frontend não acessa os dados diretamente. O backend usa conexão PostgreSQL privada
mantida apenas nas variáveis protegidas da Vercel.

Sem DATABASE_URL, desenvolvimento local e homologação podem usar SQLite. Na
Vercel, a ausência de DATABASE_URL marca o storage como não durável e pagamentos
reais continuam bloqueados por persistent_storage_required. Não remova essa
proteção.

TIMEOUTS
Chamadas ao Mercado Pago têm timeout interno de 8 segundos, abaixo do limite atual
da Function. Assim o backend consegue tratar falha/timeout antes de a Vercel matar
a execução. Em erro de rede, a mesma chave idempotente deve ser reutilizada.

EXECUTAR LOCALMENTE
1. Instale Node.js 24+.
2. npm ci
3. Copie .env.example para .env.
4. Configure frete e Mercado Pago em modo test.
5. Para PostgreSQL, configure DATABASE_URL; sem ela o ambiente local usa SQLite.
6. Configure ADMIN_PASSWORD e ADMIN_SESSION_SECRET para usar /admin.
7. npm start
8. Abra http://localhost:3000

TESTES
npm test

O GitHub Actions executa npm ci e npm test em todo push para main e em pull
requests. Os testes cobrem CardForm, total autoritativo, identificação do cliente,
sessão/CSRF, idempotência, 3DS, webhook payment, painel administrativo, proteção
contra expedir pedido não pago, reembolso parcial, persistência SQLite local,
frete, SuperFrete/Correios e regressões do frontend.

CHECKLIST DE HOMOLOGAÇÃO
- conexão Vercel -> Supabase com DATABASE_URL de Transaction Pooler
- identificação do cliente por nome/WhatsApp/e-mail
- cartão aprovado
- cartão recusado
- pagamento em processamento
- 3DS Challenge
- webhook payment válido
- webhook inválido
- retry de rede usando mesma tentativa
- painel /admin protegido por login
- busca e filtros de pedidos/clientes
- bloqueio de expedição para pedido não pago
- código de rastreio
- reembolso total
- reembolso parcial
- mediação/chargeback
- expiração da cotação de frete

ATIVAÇÃO DE PRODUÇÃO
O armazenamento persistente PostgreSQL/Supabase já está implementado. Antes de
mudar MERCADO_PAGO_MODE para production:
1. Confirme DATABASE_URL no ambiente Production da Vercel e faça um redeploy.
2. Homologue criação/leitura de sessão, cliente e pedido no Supabase.
3. Configure credenciais reais correspondentes da mesma aplicação/conta.
4. Configure o webhook payment real.
5. Faça homologação final em HTTPS, incluindo um fluxo 3DS quando disponível.
6. Só então ative MERCADO_PAGO_MODE=production.

ARQUIVOS PRINCIPAIS
frontend/index.html                 interface da loja
frontend/js/cart.js                 carrinho, frete e entrada do checkout
frontend/js/card-payment.js         cliente, CardForm, idempotência, 3DS e polling
frontend/js/order-status.js         acompanhamento do pedido
frontend/admin/index.html           painel de pedidos/clientes
frontend/admin/admin.js             comportamento do painel
frontend/admin/admin.css            layout responsivo do painel
backend/app.js                      API e proteções HTTP
backend/admin.js                    autenticação e API administrativa
backend/store.js                    adapter SQLite para local/testes
backend/postgres-store.js           adapter PostgreSQL/Supabase para produção
backend/services/mercadopago.js     Payment API / CardForm
backend/services/webhook.js         validação de assinatura payment
backend/services/shipping.js        frete e cotações via storage abstrato
backend/vercel-app.js               seleciona Supabase quando DATABASE_URL existe
.env.example                        nomes de variáveis sem segredos
TESTES.txt                          resumo da suíte de testes

REFERÊNCIAS OFICIAIS
CardForm / Checkout API Payments:
https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments
3D Secure:
https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/how-tos/integrate-3ds
Status de pagamentos:
https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/response-handling/query-results
Webhooks:
https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications
