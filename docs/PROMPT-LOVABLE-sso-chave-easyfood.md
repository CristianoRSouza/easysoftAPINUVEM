# Prompt para o Lovable do projeto Suporte (EasyChat) — terceira chave, do EasyFood

> **Por que este arquivo existe.** O receptor do SSO é a Edge Function `sso` do projeto
> EasyChat (`puqybpgzhwaxmhedqhqu`), que é **gerido pelo Lovable**. Em **28/07/2026** um
> redeploy do Lovable reimplantou todas as functions daquele projeto e **reverteu** uma
> correção que tinha sido aplicada por fora (CLI/painel), derrubando o botão "Suporte" do
> EasyML com `{"error":"Invalid signature"}`. Portanto: **qualquer mudança na `sso` tem
> que entrar no fonte do Lovable** — patch por fora é temporário por construção.
>
> Hoje a `sso` (version 41, de 31/07/2026) aceita duas chaves:
> `SSO_SHARED_SECRET_EASYML` e a legada `SSO_SHARED_SECRET`. Este prompt adiciona a
> **terceira**, dedicada ao EasyFood, para que o EasyFoodManager pare de depender da
> chave legada compartilhada.

## Pré-requisito (fazer ANTES de publicar o prompt)

No projeto EasyChat, criar a secret **`SSO_SHARED_SECRET_EASYFOOD`** com um valor novo e
aleatório (ex.: `openssl rand -hex 32`). **Exatamente o mesmo valor** vai no cofre
Infisical do `easyfood-api` (env `prod`), na variável de mesmo nome.

Publicar o prompt sem a secret cadastrada não quebra nada (a chave entra na lista de
candidatos só quando definida), mas também não isola nada.

## Prompt (copiar e colar no Lovable do projeto EasyChat)

```
Na Edge Function `supabase/functions/sso/index.ts`, altere APENAS a lista de chaves
candidatas usadas para conferir a assinatura HMAC do token. Não mexa em mais nada do
arquivo (não altere o fluxo de criação/lookup de usuário, o upsert de profiles, o
generateLink, o redirect nem os headers de CORS).

Hoje a função aceita duas chaves. Ela precisa passar a aceitar TRÊS, validando se
QUALQUER UMA delas bater:

  - SSO_SHARED_SECRET_EASYML     -> usada pelo app EasyML
  - SSO_SHARED_SECRET_EASYFOOD   -> usada pelo EasyFoodManager (NOVA)
  - SSO_SHARED_SECRET            -> segredo legado, compartilhado pelos demais módulos
                                    Easy* (EasyCommandPay, ...)

Regras (as mesmas de antes, mantidas):
1. NÃO escolher o segredo pelo campo `iss` do payload. Vários módulos Easy* emitem `iss`
   iguais assinando com segredos diferentes; rotear pelo `iss` derruba módulos. O `iss`
   fica só como informação de log/metadata.
2. Considerar apenas os segredos que estiverem definidos (filtrar vazios). Se NENHUM
   estiver configurado, responder 500 com {"error":"Server configuration error"}.
3. Se nenhuma das chaves validar, manter a resposta atual: 401 com
   {"error":"Invalid signature"}.
4. Não dar short-circuit no laço (testar todas as chaves configuradas antes de decidir) e
   manter a comparação da assinatura em tempo constante.
5. NÃO remover nem renomear SSO_SHARED_SECRET nem SSO_SHARED_SECRET_EASYML — a legada
   ainda é usada por outros módulos Easy* e a do EasyML está pareada e em produção.

Implementação de referência (só a função de candidatos muda):

    function candidateSecrets(): string[] {
      return [
        Deno.env.get("SSO_SHARED_SECRET_EASYML"),
        Deno.env.get("SSO_SHARED_SECRET_EASYFOOD"),
        Deno.env.get("SSO_SHARED_SECRET"),
      ].filter((s): s is string => !!s);
    }
```

## Como validar depois do deploy

1. **Chave nova aceita:** assinar um token com o valor de `SSO_SHARED_SECRET_EASYFOOD` e
   chamar `https://puqybpgzhwaxmhedqhqu.supabase.co/functions/v1/sso?token=<token>` →
   **302** (redirect para `/auth/v1/verify`), não 401.
2. **Contraprova:** o mesmo payload assinado com um segredo aleatório → **401**
   `{"error":"Invalid signature"}`. Um sem o outro não é prova.
3. **Nada regrediu:** o EasyML (assina com `SSO_SHARED_SECRET_EASYML`) e os módulos
   legados (assinam com `SSO_SHARED_SECRET`) continuam entrando.

Do lado do EasyFood, o teste ao vivo roda de dentro do container da API, lendo a chave do
próprio ambiente — o valor nunca é impresso; ver "Verificação" no README de deploy.

## Referência

- Receptor completo e histórico do incidente: repo `easyconnect-hub`,
  `docs/sso-support-side/` (`sso.ts`, `README.md`, `PROMPT-LOVABLE-sso-duas-chaves.md`).
- Emissor deste produto: `src/modules/auth/application/auth.service.ts` (`ssoSupport`) +
  `test/sso-support.service.spec.ts`.
