# Backup e recuperação — Dobrões de Fé

## Exportação operacional

O painel administrativo oferece **Exportar backup**. O arquivo JSON contém uma fotografia operacional de pedidos, clientes, auditoria e configuração de estoque. Ele não contém credenciais, tokens de cartão, `DATABASE_URL`, senhas administrativas ou segredos do Mercado Pago.

Recomendação operacional:

1. Exportar antes de mudanças importantes de catálogo, estoque ou infraestrutura.
2. Guardar o arquivo em armazenamento privado com controle de acesso.
3. Não enviar o arquivo por canais públicos, pois contém dados pessoais de clientes.
4. Definir política de retenção compatível com a operação e com a política de privacidade da loja.

## Banco Supabase

O PostgreSQL/Supabase continua sendo a fonte principal de verdade. O JSON do admin é uma cópia operacional e não substitui snapshots/backups oferecidos pelo provedor.

Antes de produção real, verificar no painel/contrato do plano Supabase quais recursos de backup, PITR e retenção estão disponíveis no plano efetivamente contratado. Não assumir recursos de um plano superior.

## Restauração

A restauração automática propositalmente **não foi exposta no painel**. Importar pedidos/clientes por uma interface web aumenta muito o risco de sobrescrever dados, criar pedidos duplicados ou alterar estados financeiros.

Procedimento seguro para recuperação:

1. Interromper temporariamente mutações de produção, se houver incidente grave.
2. Preservar uma cópia do banco afetado antes de qualquer restauração.
3. Identificar o ponto de recuperação desejado.
4. Preferir restauração nativa do provedor quando disponível.
5. Se a recuperação for feita a partir da exportação JSON, usar script administrativo offline revisado para aquela ocorrência; nunca importar cegamente sobre pedidos existentes.
6. Validar contagens de clientes/pedidos, totais financeiros, IDs do Mercado Pago e estados de entrega antes de reabrir a operação.

## Teste obrigatório antes de produção

Executar um exercício de recuperação em banco de desenvolvimento/branch, nunca diretamente sobre o banco principal. Registrar data, responsável, tempo de recuperação e divergências encontradas.

**Status:** exportação operacional implementada; teste real de restauração continua pendente por depender de ambiente de recuperação separado e decisão operacional.
