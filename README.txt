DOBRÕES DE FÉ — CARRINHO, ENTREGA E CHECKOUT SEGURO
HTML/CSS/JavaScript puro + Node.js 24 + SQLite

O QUE FOI ALTERADO
O layout existente foi adaptado para cinco dobrões religiosos.
Preservados: fontes, carrossel, filtros por santo, modal de detalhes,
menu, acordeões e formulário de consulta. O formulário continua preparando
uma mensagem para copiar; não foi transformado em um envio automático.

Os cinco produtos custam R$ 150 cada, conforme solicitado.
Dobrões de Fé é um nome provisório. Imagens geradas por IA são ilustrativas;
substitua por fotografias reais antes de vender. Material, dimensões e acabamento
precisam ser informados pelo vendedor. Não há promessa de ouro ou bênção.

EXECUTAR LOCALMENTE
1. Instale Node.js 24 ou superior e extraia este ZIP.
2. Abra um terminal na pasta que contém package.json.
3. Execute: npm ci
4. Copie .env.example para .env (Linux/macOS: cp .env.example .env).
5. Execute: npm start
6. Abra http://localhost:3000

O carrinho funciona com adicionar/remover, quantidade, contador e persistência.
Sem configuração de pagamento e frete, a compra fica bloqueada, com aviso visível.
O arquivo dobroes-religiosos.html separado é uma prévia independente. Abrir
esse arquivo diretamente permite montar o carrinho, mas não executar operações
financeiras. Use este projeto Node para o checkout e acompanhamento.

CATÁLOGO — R$ 150 CADA
Edite somente backend/products.js para definir priceCents em centavos inteiros:
produto_01 — São Jorge
produto_02 — Santo Antônio
produto_03 — São Francisco de Assis
produto_04 — São José
produto_05 — São Bento

Todos possuem priceCents:15000. null bloquearia a venda, nunca significa zero.
O limite inicial é dez unidades por produto, cinquenta unidades por pedido.
Use enabled:false para suspender uma peça. Reinicie o servidor após alterações.
Valores fictícios existentes nos testes são fixtures isoladas; não chegam ao
catálogo da loja. Os pedidos já criados preservam seu preço original.

O QUE FALTA PARA PAGAMENTOS
- Domínio público HTTPS e servidor Node com disco persistente para SQLite.
- Aplicação Mercado Pago com Checkout Pro pela API Orders disponível na conta.
- MERCADO_PAGO_ACCESS_TOKEN: Access Token privado da conta correta.
- MERCADO_PAGO_SELLER_ID: ID do vendedor titular do token.
- MERCADO_PAGO_APPLICATION_ID: ID da aplicação no painel de integrações.
- WEBHOOK_SECRET: chave secreta da configuração de Webhooks da aplicação.
- APP_URL: origem pública HTTPS, sem caminho nem barra final.
- Notificação de Order (Mercado Pago) habilitada no painel, com URL:
  APP_URL/api/webhooks/mercadopago

Configure esses valores SOMENTE no .env do servidor ou no gerenciador de
segredos da hospedagem. Não cole tokens em HTML, scripts públicos ou chats.
O .env não é fornecido, não é servido e está no .gitignore.

HOMOLOGAÇÃO E ATIVAÇÃO
1. Comece com MERCADO_PAGO_MODE=test e as credenciais/contas de teste da sua
   aplicação. Use o APP_URL HTTPS acessível pelo Mercado Pago, inclusive em teste.
2. Configure a chave e as notificações do ambiente correto no painel.
3. Faça um checkout de teste: pagamento aprovado, pendente, recusado e reembolso.
4. Confira a chegada do webhook, o GET de confirmação e o estado persistido.
5. Teste reenvio da notificação e retentativa de checkout após falha de rede.
6. Somente após homologar, configure NODE_ENV=production,
   MERCADO_PAGO_MODE=production e as credenciais/IDs reais correspondentes.

A integração não foi executada contra uma conta Mercado Pago: faltam os dados
acima. O adapter foi implementado conforme documentação oficial consultada em
17/09/2026 e exercitado com respostas simuladas. Não houve cobrança real.
O adapter valida IDs de Orders, vendedor, aplicação e ambiente. O prefixo
ORDTST é aceito para testes conforme os exemplos oficiais; divergências no
ambiente real devem ser investigadas na homologação, nunca removendo validações
financeiras para fazer uma cobrança passar.

REVERSE PROXY E HTTPS
O servidor escuta 127.0.0.1. Use um reverse proxy HTTPS na frente, encaminhando
para a porta configurada. Se ele estiver na mesma máquina, TRUST_PROXY=loopback
é a opção habitual. Caso contrário, informe apenas o IP/CIDR real do proxy e
ajuste a implantação conforme sua rede. Nunca configure trust proxy=true.
O proxy deve sobrescrever os headers Forwarded/X-Forwarded-* recebidos do cliente.
Produção rejeita HTTP. X-Forwarded-Proto de um endereço não confiável não libera
HTTPS. Mantenha o relógio do servidor sincronizado para validar a assinatura.

FLUXO IMPLEMENTADO
Catálogo -> IDs e quantidades -> endereço e cotação de frete -> POST /api/checkout
-> validação -> preços e frete do servidor -> pedido pending no SQLite
-> POST Mercado Pago /v1/orders -> revisão
do total confirmado -> redirecionamento para Checkout Pro -> webhook assinado ->
GET Mercado Pago /v1/orders/{id} -> conferência -> atualização do pedido.

A revisão do pedido mostra os valores devolvidos pelo servidor antes do botão
“Continuar no Mercado Pago”. URLs de retorno servem apenas à interface.
GET /api/orders/:id exige a mesma sessão que criou o pedido e não altera status.
A página /sucesso ignora status e valores da URL e consulta o backend.

DADOS E SEGURANÇA
- localStorage guarda somente {items:[{productId,quantity}]}.
- sessionStorage guarda apenas o ID do pedido em acompanhamento, sem status.
- O servidor rejeita campos extras, como price, total, discount ou paymentStatus.
- Quantidades precisam ser inteiros no limite, com IDs conhecidos e não repetidos.
- Valores internos são centavos inteiros; valores enviados à API são strings
  decimais construídas sem cálculos financeiros com ponto flutuante.
- Cookie de sessão aleatório HttpOnly/SameSite=Lax, Secure em produção; o banco
  guarda o hash do identificador. Sessões duram sete dias.
- POST de checkout exige origem exata, CSRF e Idempotency-Key UUID.
- Sem CORS aberto: frontend e backend devem compartilhar a mesma origem.
- CSP com hashes dos scripts/estilos originais, headers de segurança, JSON até
  8 KiB, limites por IP e erros sem tokens ou respostas privadas do provedor.
- Access Token só no backend; o navegador vai para a URL HTTPS validada do MP.
- Nenhum dado de cartão é coletado ou armazenado pela loja.

PEDIDOS E IDEMPOTÊNCIA
SQLite grava o pedido antes da chamada externa, incluindo snapshot dos itens,
preços, total e corpo da requisição ao provedor. O UUID interno é também a chave
idempotente do Mercado Pago. Falhas de rede são repetidas com o mesmo UUID e
payload. Cliques concorrentes e reenvios do mesmo carrinho/sessão reutilizam o
pedido ativo. A mesma Idempotency-Key não pode mudar de carrinho.

Pedidos antigos sem resolução são bloqueados para conferência após 24 horas;
a aplicação não recria cobranças automaticamente nesses casos. Um pedido já
pago pode ser seguido por uma nova compra intencional. A deduplicação é por
sessão: dispositivos diferentes não compartilham carrinho ou identidade.

O webhook valida x-signature via SDK oficial, relaciona data.id da query e do
corpo e exige timestamp dentro de cinco minutos (segundos ou milissegundos).
Consulta a API autenticada e confere pedido, vendedor, aplicação, moeda, país,
valor, ID do recurso e itens quando retornados. Marcar como paid exige estado
processed/accredited e total_paid_amount integral. Não usa status do corpo
recebido. Notificações antigas não rebaixam estados financeiros confirmados.

A atualização do pedido e o evento order.paid são transacionais. Uma restrição
única impede duplicar esse evento por pedido, mesmo com webhook repetido.
A tabela outbox prepara a integração de entrega/estoque; NÃO há serviço de
expedição ou baixa de estoque implementado. Um futuro consumidor deve usar
orderId como chave idempotente no serviço de entrega e conferir estado atual.
Reembolsos bloqueiam eventos de entrega ainda pendentes; não revertem entregas
que um serviço externo já tenha realizado.

OPERAÇÃO E LIMITES DO ESCOPO
- Configuração inicial: uma instância Node com SQLite em disco persistente.
- Proteja backend/data; não exponha nem inclua banco, backups ou .env em ZIP/git.
- Faça backups consistentes do SQLite com sua ferramenta de backup/SQLite backup
  API. Não copie apenas o arquivo .sqlite durante escrita com WAL ativo.
- Limites de requisições são em memória; múltiplas instâncias exigiriam um
  armazenamento de rate limit compartilhado e coordenação de tarefas.
- O total inclui produtos e frete cotado no servidor. O endereço fica no pedido.
  Cupons, cálculo de tributos, disponibilidade de estoque e expedição automática
  não estão implementados. A cotação não compra etiqueta nem posta a encomenda.
- O acompanhamento depende do cookie da compra; após expirar/perder a sessão,
  suporte da loja deve conferir o pedido no backend/provedor com procedimento
  próprio. Não existe painel administrativo público ou consulta por ID aberto.
- Pedidos, chaves idempotentes e eventos permanecem no banco. Defina retenção,
  backup e monitoramento antes da operação comercial.

ARQUIVOS PRINCIPAIS
frontend/index.html          HTML original com inserções locais
frontend/css/cart.css        Estilo adicional do carrinho
frontend/js/cart-model.js    Carrinho e persistência sem dados financeiros
frontend/js/cart.js          Interface, catálogo e início do checkout
frontend/sucesso.html        Acompanhamento, sem confirmar por redirect
backend/products.js          Catálogo confiável e preços reais
backend/app.js               Endpoints e proteções HTTP
backend/store.js             Sessões, pedidos, idempotência e outbox SQLite
backend/services/mercadopago.js  Adapter da API Orders / Checkout Pro
backend/services/webhook.js  Autenticidade e janela de assinatura
backend/services/shipping.js Cotação Correios e validação do endereço
ENTREGA-CORREIOS.txt          Configuração, embalagem e limites da entrega
.env.example                 Nomes das configurações, sem credenciais
package-lock.json            Versões fixadas
TESTES.txt                   Resultados e limites de validação

TESTES E PRÉVIA INDEPENDENTE
npm test
node scripts/build-standalone.js dist/dobroes-religiosos.html
O segundo comando gera dist/dobroes-religiosos.html. Ele não embute o backend
nem segredos e mantém a mensagem de indisponibilidade quando aberto sem servidor.

DOCUMENTAÇÃO OFICIAL CONSULTADA
Criar Order / Checkout Pro:
https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order
URLs de retorno:
https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/web-integration/configure-back-urls
Notificações e assinatura:
https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/payment-notifications
Estados da Order:
https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/payment-management/status/order-status
