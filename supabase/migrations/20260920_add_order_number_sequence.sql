-- Numeração amigável e transacional para novos pedidos.
-- O UUID continua sendo a chave interna e referência externa do Mercado Pago.
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
  AS bigint
  START WITH 1001
  INCREMENT BY 1
  MINVALUE 1001;
