import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiSessionErrorResponses, ApiTenantHeaders } from '../../../common/swagger';
import { NFCE_XML_KINDS } from '../domain/nfce-xml.rule';
import { filtrosDaListagem, noteIdParam } from './nfce.docs';

/** Documentação OpenAPI das rotas de XML de NFC-e (ZIP do contador e XML de uma nota). */

export const DocXmlArchive = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Baixar os XML das notas do filtro, em um ZIP',
      description:
        'Mesmos filtros da listagem (`status`, `from`, `to`, `search`, `reconcileStatus`) — sem ' +
        '`page`/`limit`. O pacote leva **tudo o que casa com o filtro**, lido do banco: o que a ' +
        'tela carregou por rolagem infinita não tem influência nenhuma aqui.\n\n' +
        'Dentro do ZIP: `autorizadas/<chave>.xml` e `canceladas/<chave>.xml` trazem o procNFe (o ' +
        'documento que vale para escrituração); `canceladas/` traz também o evento de ' +
        'cancelamento; `nao-autorizadas/` traz XML gerado/assinado de notas que **não** foram ' +
        'autorizadas — servem para diagnóstico e não devem ser escriturados. Um `_RESUMO.txt` ' +
        'registra os filtros usados e as contagens.\n\n' +
        'A resposta é **streaming** (`chunked`, sem `Content-Length`): o ZIP é montado enquanto é ' +
        'enviado, então um período grande não precisa caber na memória da API.\n\n' +
        '**Não há teto de notas.** Quem recorta a exportação é o filtro — e só ele. Um teto de ' +
        'segurança cortaria o pacote sem o usuário pedir, e o contador escrituraria o período ' +
        'pela metade sem perceber.',
    }),
    ApiTenantHeaders(true),
    ...filtrosDaListagem(),
    ApiResponse({
      status: 200,
      description: 'O arquivo ZIP (`application/zip`), como anexo.',
      content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
    }),
    ApiSessionErrorResponses(),
  );

export const DocXmlDaNota = () =>
  ApiDocs(
    ApiOperation({
      summary: 'O XML da nota, sob demanda (migracao D7)',
      description: [
        'Existe porque o detalhe **parou de carregar o XML** junto com as ~110 colunas: ele',
        'viajava em toda abertura de nota, mesmo de quem nunca abre a aba XML. Agora so vem',
        'quando alguem pede.',
        '',
        'Le do bucket quando a nota ja foi migrada e **cai para a coluna `text` quando nao** —',
        'e esse fallback que permitiu esta rota entrar no ar durante a convivencia.',
        '',
        '`kind`: `authorized` (o procNFe, o que vale para escrituracao), `cancellation`,',
        '`signed` e `generated`. ⚠️ `generated` **nao e XML** — e o INI do ACBr, e por isso',
        'nunca esteve no bucket; serve so para diagnostico.',
        '',
        'Nota de outra loja e nota sem aquele XML respondem **igualmente 404**, de proposito:',
        'distinguir as duas confirmaria a existencia de nota alheia para quem adivinhasse o id.',
        '',
        'Teto de 2 MB — acima disso o caminho e o pacote em ZIP.',
      ].join(' '),
    }),
    ApiTenantHeaders(true),
    noteIdParam(),
    ApiParam({ name: 'kind', schema: { type: 'string', enum: [...NFCE_XML_KINDS] } }),
    ApiResponse({
      status: 200,
      description: 'O XML e o nome de arquivo sugerido.',
      schema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: { xml: { type: 'string' }, nomeArquivo: { type: 'string' } },
          },
        },
      },
    }),
    ApiSessionErrorResponses(),
  );
