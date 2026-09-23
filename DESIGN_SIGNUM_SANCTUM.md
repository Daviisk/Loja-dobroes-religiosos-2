# Signum Sanctum — Especificação de Identidade Visual

## Objetivo

Adaptar a loja existente para a marca **Signum Sanctum — Medalhas Religiosas**, preservando integralmente catálogo, carrinho, cálculo de frete, filtros, modais, formulários e responsividade.

## Referência oficial

- Identidade: Signum Sanctum.
- Assinatura: Medalhas Religiosas.
- Conceito: fé, tradição, delicadeza, memória e presente com significado.
- Atmosfera: editorial clássica, acolhedora, artesanal e premium.

## Sistema visual

| Papel | Cor |
|---|---|
| Fundo principal | `#F4EFE4` |
| Superfície clara | `#FFFDF8` |
| Texto principal | `#3F2B18` |
| Texto secundário | `#6F604F` |
| Dourado principal | `#AA7824` |
| Dourado claro | `#D3AD61` |
| Linhas e bordas | `rgba(126, 91, 43, .22)` |

## Tipografia

- Títulos editoriais e frases de destaque: Georgia ou serif equivalente.
- Navegação, controles e textos funcionais: fonte legível do sistema.
- Nome da marca: caixa alta, espaçamento amplo e presença discreta.

## Componentes

- Cabeçalho centralizado com logotipo oficial, frase institucional e navegação simétrica.
- Hero em duas colunas, com chamada à esquerda e fotografia religiosa à direita.
- Botões com dourado envelhecido, alto contraste e área mínima de toque de 44 px.
- Medalhas em molduras circulares douradas.
- Cards de produto em marfim com borda fina, sombra leve e preço dourado.
- Formulários claros, acessíveis e com foco visível.
- Rodapé com logotipo, assinatura institucional e navegação.

## Regras de preservação

1. Não remover nem simplificar carrinho, frete, filtros ou modais.
2. Não alterar identificadores usados pelo JavaScript.
3. Não inventar materiais, dimensões, bênçãos ou características físicas dos produtos.
4. Manter textos em português brasileiro e acessibilidade por teclado.
5. Usar as imagens religiosas existentes; gerar novas somente se faltar um produto ou formato essencial.

## Responsividade

- Desktop: navegação simétrica e hero em duas colunas.
- Tablet: redução progressiva de tipografia e espaçamento.
- Celular: menu recolhível, hero empilhado, catálogo em duas colunas e formulários em uma coluna.
- Telas muito estreitas: catálogo em uma coluna, sem rolagem horizontal.

## Critérios de aceite

- Marca Signum Sanctum visível no cabeçalho, metadados, conteúdo institucional e rodapé.
- Paleta creme, dourado e marrom aplicada de forma consistente.
- Contraste, foco, áreas de toque e navegação por teclado preservados.
- Fluxos comerciais existentes funcionando sem regressão.

## Comando Mestre

> Adapte o projeto existente conforme `DESIGN_SIGNUM_SANCTUM.md`. Preserve integralmente funcionalidades, IDs, eventos, carrinho, frete, catálogo, filtros, modais e responsividade. Use a identidade Signum Sanctum com fundo creme, dourado envelhecido, marrom profundo, tipografia editorial e o logotipo oficial existente em `frontend/images/signum-sanctum-logo.jpg`. Não invente informações de produto. Ao concluir, execute os testes existentes, valide desktop e celular e entregue um resumo objetivo dos arquivos alterados.

## Comandos de iteração

### Auditoria visual

> Compare a implementação com `DESIGN_SIGNUM_SANCTUM.md`; corrija inconsistências de paleta, tipografia, espaçamento, contraste e alinhamento sem alterar funcionalidades.

### Responsividade

> Audite em 360 px, 390 px, 768 px, 1024 px e 1440 px. Corrija overflow, sobreposição, legibilidade e áreas de toque, preservando a hierarquia visual.

### Regressão funcional

> Teste navegação, carrossel, filtros, detalhes de produto, carrinho, quantidades, frete e formulário. Corrija somente regressões introduzidas pela adaptação visual.

### Refinamento

> Refine sombras, bordas, ritmo vertical e transições para uma aparência religiosa premium, sóbria e acolhedora, sem exagerar brilhos ou efeitos.
