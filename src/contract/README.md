# `src/contract` — o contrato `/v1`, escrito uma vez

Estes schemas são a **forma do fio** das rotas de dado: o que a API devolve e o que a UI
espera. Não são "tipos do banco" — o banco da loja e o da nuvem têm nomes de tabela
diferentes (`products` × `pv_products`, `orders` × `vw_command_orders`). O que precisa ser
idêntico é o **JSON**, e é isso que está aqui.

## Por que aqui e não num pacote npm compartilhado

O EasyML resolve isso com `packages/shared` num monorepo. Aqui são **três repositórios
separados** (`easyfood-api`, `easycommandpay-admin-api`, `easycommandpay-admin`), então um
pacote compartilhado significaria publicar e versionar a cada mudança de contrato — durante
uma migração em que o contrato muda toda semana, isso troca um risco real (divergência) por
um atrito diário garantido.

Decisão: o contrato nasce aqui, como código executável. A extração para pacote fica para
**depois que ele estabilizar** (fim da migração), quando o custo de versionar deixa de ser
diário. Enquanto isso, quem protege contra divergência é o teste de contrato — que roda
contra uma base URL e vale para as duas implementações.

## Regras

1. **Nada de campo a mais "porque estava no SELECT".** O que entra aqui é o que a UI usa.
   Devolver a linha crua do banco vaza coluna interna e amarra o contrato ao schema.
2. **Números que são dinheiro/quantidade viajam como `number`.** O driver `pg` devolve
   `numeric` como string (ver `db.service.ts`) — a conversão é do service, não da tela.
3. **Data/hora viaja como string ISO.** Nunca `Date` (não sobrevive ao JSON).
4. **Campo ausente é `null`, não `undefined`.** `undefined` some no `JSON.stringify` e o
   cliente não distingue "não veio" de "veio vazio".
5. Mudou um schema? O teste de contrato tem que quebrar. Se não quebrou, ele não cobria.
