# Receptor da telemetria (EasyGuardian) — aceitar a chave dedicada do EasyFood

> **Sintoma que gerou este arquivo.** Em 31/07/2026, com
> `ERROR_REPORT_SECRET_EASYFOOD` (valor novo, fp `4e125f57…`) já cadastrado nos dois lados,
> a sonda ao vivo de dentro do container da EasyFoodAPI recebeu
> `HTTP 401 {"error":"Unauthorized"}` da function `error-report`
> (`ohjyqafgcxvrvbtiuvpq`). A contraprova com segredo aleatório deu o mesmo 401.

## O diagnóstico, em uma frase

**Cadastrar a secret no projeto receptor não basta** — o que autentica é o *código* da function
comparando o header `x-report-secret` com o valor de **uma variável específica que ele lê**. Se a
`error-report` lê só `ERROR_REPORT_SECRET`, uma secret nova chamada
`ERROR_REPORT_SECRET_EASYFOOD` fica ali sem nunca ser consultada.

É exatamente a mesma armadilha do SSO no EasyChat: adicionar `SSO_SHARED_SECRET_EASYML` não
resolveu nada até a function `sso` passar a testar **duas** chaves candidatas.

## As duas saídas

**A) Sem tocar no receptor (imediata).** No cofre Infisical do `easyfood-api`/`prod`, pôr em
`ERROR_REPORT_SECRET_EASYFOOD` o **valor que o EasyGuardian já aceita** (o mesmo das edge
functions do EasyERP, digest `bbc5df3a…`). O nome continua sendo do EasyFood; só o valor é
compartilhado. A API lê qualquer um dos dois nomes — nada a deployar.

**B) Isolamento de verdade (exige mexer no EasyGuardian).** Ensinar a function `error-report` a
aceitar mais de uma chave. Se aquele projeto for gerido pelo Lovable, a mudança **tem que entrar
no fonte do Lovable** — patch por CLI/painel morre no próximo redeploy (foi o que aconteceu com a
`sso` do EasyChat em 28/07/2026).

Prompt para o caso B (colar no chat do Lovable do projeto EasyGuardian):

```
CONTEXTO (não é pedido, é para você entender o sintoma antes de mexer)

A Edge Function `error-report` deste projeto recebe relatórios de erro de vários sistemas
Easy* e autentica cada chamada comparando o header `x-report-secret` com um segredo do
ambiente. Hoje ela conhece UM único segredo.

Um novo emissor entrou em cena — a EasyFoodAPI — e ele assina com uma chave própria. A
secret `ERROR_REPORT_SECRET_EASYFOOD` JÁ ESTÁ cadastrada neste projeto (Secrets), com o
mesmo valor que o emissor usa. Mesmo assim toda chamada dele volta
401 {"error":"Unauthorized"}, porque o CÓDIGO da função não lê essa variável: uma secret
que o código não consulta é uma secret invisível. Cadastrar não basta; é preciso alterar a
função e PUBLICAR.

O QUE FAZER

Na Edge Function `error-report`, altere APENAS a verificação do header `x-report-secret`.
Não mexa em mais nada: não altere o parse do corpo, a validação do payload, a gravação em
`error_reports`, o formato da resposta, o status de sucesso nem os headers de CORS.

Ela precisa aceitar VÁRIAS chaves candidatas e autorizar se QUALQUER UMA delas bater:

  - ERROR_REPORT_SECRET_EASYFOOD  -> usada pela EasyFoodAPI (nova)
  - ERROR_REPORT_SECRET           -> segredo compartilhado pelos demais emissores Easy*

REGRAS (todas obrigatórias)

1. Considerar apenas os segredos que estiverem definidos (filtrar vazios/ausentes).
2. Se NENHUM dos dois estiver configurado, responder 500 — nunca liberar a requisição por
   ausência de configuração.
3. Se nenhuma das chaves bater, manter exatamente a resposta atual:
   401 {"error":"Unauthorized"}.
4. Não dar short-circuit no laço: testar todas as chaves configuradas antes de decidir, e
   comparar em tempo constante (evita distinguir as chaves por tempo de resposta).
5. NÃO remover, renomear nem trocar o valor de ERROR_REPORT_SECRET — os outros emissores
   Easy* dependem dele e parariam de reportar erro em silêncio.
6. Não introduzir dependência nova nem mudar a assinatura/rota da função.

IMPLEMENTAÇÃO DE REFERÊNCIA

    function candidateSecrets(): string[] {
      return [
        Deno.env.get("ERROR_REPORT_SECRET_EASYFOOD"),
        Deno.env.get("ERROR_REPORT_SECRET"),
      ].filter((s): s is string => !!s);
    }

    function authorized(header: string | null): boolean {
      if (!header) return false;
      let ok = false;
      for (const secret of candidateSecrets()) {
        // sem short-circuit: compara todas antes de decidir
        if (timingSafeEqual(header, secret)) ok = true;
      }
      return ok;
    }

E no handler, no lugar da comparação com chave única:

    if (candidateSecrets().length === 0) {
      return jsonResponse({ error: "Server configuration error" }, 500);
    }
    if (!authorized(req.headers.get("x-report-secret"))) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

AO TERMINAR

Publique/reimplante a função — alteração salva e não publicada não muda nada em produção.
Depois me diga o nome exato do arquivo alterado e confirme que a `error-report` foi
reimplantada.
```

## Desfecho (31/07/2026) e as duas pedras do caminho

Resolvido pelo caminho B: a `error-report` passou a aceitar as duas chaves e o relatório da
EasyFoodAPI é gravado (`HTTP 201 {"ok":true,"id":...}`), com chave aleatória ainda em 401.

Duas armadilhas apareceram no meio, nesta ordem:

1. **Secret cadastrada ≠ secret lida.** A `ERROR_REPORT_SECRET_EASYFOOD` existia no projeto
   receptor desde o começo e mesmo assim tudo dava 401 — porque o *código* da function lia só
   `ERROR_REPORT_SECRET`. Trocar o valor não adianta; é o código que precisa mudar (e ser
   publicado).
2. **`timingSafeEqual` derrubou a função inteira.** A primeira versão publicada passava
   *strings* para ela; a API exige `ArrayBufferView` e **lança** com tamanhos diferentes. Como a
   exceção não era tratada, qualquer requisição com header preenchido virava
   `500 Internal Server Error` em texto puro — inclusive as dos emissores que funcionavam.
   Comparação de segredo deve usar byte a byte com guarda de tamanho (`safeEqual` abaixo) e o
   handler tem que ter try/catch. Sintoma que denuncia o caso: **sem header dá 401, com
   qualquer header dá 500**.

## Como validar (de dentro do container da API, sem expor segredo)

```sh
docker exec easyfood-api node -e '
const c=require("crypto");
const s=process.env.ERROR_REPORT_SECRET_EASYFOOD||process.env.ERROR_REPORT_SECRET||"";
console.log("chave: len="+s.length+" fp="+c.createHash("sha256").update(s).digest("hex").slice(0,12));
const url=process.env.ERROR_REPORT_UPSTREAM_URL;
const body=JSON.stringify({app:"easyfood-api",message:"DIAGNOSTICO: verificacao de chave (ignorar)"});
const go=(k,rot)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-report-secret":k},body})
  .then(async r=>console.log(rot+": HTTP "+r.status+" "+(await r.text()).slice(0,140)));
go(s,"chave do cofre").then(()=>go(c.randomBytes(32).toString("hex"),"contraprova aleatoria"));'
```

Aceito = qualquer status **diferente de 401** na chave do cofre (um 400 de schema já prova que a
autenticação passou), **com** a contraprova aleatória continuando em 401. Um sem o outro não é
prova. Se der 401 nos dois logo após cadastrar a secret, repetir depois de ~4 min: worker frio do
Supabase pode ainda estar com o ambiente antigo.
