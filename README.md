# Dobrões Religiosos

Site com catálogo, imagens, animações e carrinho, organizado para enviar a um repositório GitHub. O código original do servidor e suas integrações foi preservado.

## Enviar para o GitHub

1. Extraia este ZIP no computador.
2. Abra o repositório e escolha **Add file → Upload files**.
3. Envie o conteúdo extraído: `index.html`, `frontend/`, `backend/`, `scripts/`, `tests/` e os demais arquivos. Não envie apenas o ZIP nem uma pasta extra envolvendo o projeto.
4. Confirme o envio em **Commit changes**.

O arquivo `index.html` deve aparecer diretamente na raiz do repositório.

## Exibir no GitHub Pages

Em **Settings → Pages**, selecione publicação por branch, a branch que recebeu os arquivos e a pasta **/ (root)**. Salve e aguarde a publicação. O endereço aparece nessa mesma tela.

O arquivo da raiz direciona para `frontend/` usando um caminho relativo, compatível com o nome do repositório. As imagens, os estilos e os scripts estão incluídos.

**GitHub Pages publica apenas a parte estática.** O catálogo e o carrinho podem ser visualizados, mas pagamento, cálculo real de frete e acompanhamento de pedidos dependem do servidor Node.js. Os valores de prévia não autorizam pagamentos.

## Executar com o servidor

Requisito: Node.js 24 ou superior.

```sh
npm ci
```

Copie `.env.example` para `.env` e configure as variáveis. Depois:

```sh
npm start
```

Abra `http://localhost:3000`. Para executar os testes existentes:

```sh
npm test
```

## Frete com SuperFrete

Crie a conta, gere o token de integração e cadastre o endereço de origem no SuperFrete. Depois, copie `.env.example` para `.env`, informe o CEP de origem e as medidas/peso reais da embalagem, e configure:

```sh
SHIPPING_PROVIDER=superfrete
SUPERFRETE_TOKEN=seu_token_de_integracao
SUPERFRETE_SERVICES=1,2,17
```

O token fica somente no servidor. O navegador envia apenas o CEP e os produtos; o backend consulta preço, prazo e modalidades, e vincula a cotação à sessão, ao carrinho e ao CEP por 10 minutos.
Use `SHIPPING_UNIT_WEIGHT_G=60` para considerar 60 g por dobrão antes da embalagem externa.

## Vercel

O arquivo `api/[...path].js` conecta as rotas `/api/*` ao deploy da Vercel, inclusive a sessão do carrinho e a cotação do SuperFrete. Depois de salvar as variáveis de ambiente, use **Redeploy**. Para pagamentos e pedidos reais em produção, substitua o armazenamento temporário da Function por um banco persistente antes de ativar o Mercado Pago.

## Habilitar vendas

Hospede o projeto completo em um serviço compatível com Node.js e armazenamento persistente para o banco SQLite. Sirva a loja pelo próprio servidor, na mesma origem da API. Configure HTTPS, `APP_URL`, as credenciais de pagamento, webhook e Correios conforme `.env.example` e os guias originais incluídos.

Nunca envie `.env`, credenciais reais ou o banco de pedidos ao GitHub. O arquivo `.gitignore` já exclui esses itens dos commits feitos pelo Git; em uploads manuais, não os selecione.

## Organização

- `index.html`: entrada estática para GitHub Pages.
- `frontend/`: site, estilos, scripts e imagens.
- `backend/`: API, validação, pedidos, frete e pagamento.
- `tests/`: testes originais.
- `scripts/`: utilitários originais.
- `.env.example`: configuração sem credenciais.
- `README.txt`, `TESTES.txt`, `ENTREGA-CORREIOS.txt`: documentação original.

## Versão mobile

Layout ajustado para celular, carrossel com gesto horizontal, controles de toque, formulários em uma coluna e imagens WebP leves. Para gerar um HTML único de visualização, execute `npm run preview:build`. O arquivo será criado em `dist/dobroes-visualizacao.html`. A prévia funciona sem servidor para explorar o catálogo e montar o carrinho; frete e pagamentos continuam dependendo da API.
