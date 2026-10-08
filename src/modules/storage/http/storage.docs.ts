import { ApiBody, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiDocs, ApiServiceKeyErrorResponses } from '../../../common/swagger';
import { IMAGE_EXTS } from '../dto/storage.schema';

/**
 * Documentação OpenAPI das rotas de storage — fora do controller, para ele mostrar só o que
 * decide o comportamento (rota, guard, interceptor de upload, caso de uso).
 *
 * Cada `Doc*` equivale a empilhar os mesmos decorators sobre o método, na mesma ordem.
 */

const UUID = { type: 'string' as const, format: 'uuid' };

const NOTA_UPSERT =
  'O upload é **upsert**: o object path é derivado dos ids (não de um nome sorteado), então ' +
  'reenviar o mesmo arquivo substitui o anterior em vez de acumular cópias. É o que permite ao ' +
  'worker repetir o envio depois de uma queda sem sujar o bucket.';

export const DocUploadProductImage = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Sobe a imagem de um produto e devolve a URL pública',
      description:
        `Object path \`\${companyId}/\${productId}\${ext}\` e \`contentType\` deduzido da extensão — ` +
        'os MESMOS do SDK que rodava na loja, para as URLs já gravadas continuarem resolvendo.\n\n' +
        `${NOTA_UPSERT}\n\n` +
        'Dois tetos, e eles não são redundantes: o multer corta em **25 MB** (backstop, antes de o ' +
        'buffer existir) e o service recusa acima de **20 MB** (a regra de verdade). O primeiro ' +
        'protege a memória do processo; o segundo é o contrato.\n\n' +
        'Erro do Storage vira **400**, não 500: quem chama é um serviço, e bucket inexistente ou ' +
        'permissão faltando é problema da chamada, não do servidor.',
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file', 'companyId', 'productId', 'ext'],
        properties: {
          file: { type: 'string', format: 'binary', description: 'Bytes da imagem.' },
          companyId: UUID,
          productId: UUID,
          ext: {
            type: 'string',
            enum: [...IMAGE_EXTS],
            description: 'O Sync já normaliza (`.jpeg` → `.jpg`) antes de enviar.',
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Imagem no bucket.',
      schema: { type: 'object', properties: { publicUrl: { type: 'string', format: 'uri' } } },
    }),
    ApiServiceKeyErrorResponses(),
  );

export const DocUploadNfcePfx = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Sobe o certificado PFX da NFC-e da loja',
      description:
        `Object path \`\${companyId}/\${certificateId}.pfx\` — o MESMO do SDK que isto substituiu.\n\n` +
        `${NOTA_UPSERT}\n\n` +
        'Devolve o **object path**, não uma URL pública, e a diferença é de propósito: o bucket de ' +
        'certificado é privado. Um PFX é a identidade fiscal da empresa — quem o tem assina nota em ' +
        'nome dela.\n\n' +
        'A **senha do certificado não passa por aqui** e não deve ser enviada junto: esta rota ' +
        'transporta o arquivo, e só. Teto de 5 MB (backstop do multer em 25 MB).',
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file', 'companyId', 'certificateId'],
        properties: {
          file: { type: 'string', format: 'binary', description: 'Bytes do .pfx.' },
          companyId: UUID,
          certificateId: UUID,
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Certificado no bucket privado.',
      schema: {
        type: 'object',
        properties: { objectPath: { type: 'string', example: '<companyId>/<certificateId>.pfx' } },
      },
    }),
    ApiServiceKeyErrorResponses(),
  );

export const DocUploadFiscalXml = () =>
  ApiDocs(
    ApiOperation({
      summary: 'Sobe um XML fiscal (nota, evento ou inutilização) ao acervo',
      description:
        '**Esta rota NÃO é upsert** — e é a única das três que não é. A nota acima vale para ' +
        'imagem e PFX, que são substituíveis; documento fiscal não é. O caminho é derivado da ' +
        'chave de acesso, então o mesmo documento sempre cai no mesmo lugar com o mesmo ' +
        'conteúdo: **conflito é tratado como sucesso** (já subiu numa execução anterior), o que ' +
        'torna o reenvio do worker idempotente sem deixá-lo sobrescrever um XML autorizado.\n\n' +
        'O **object path é derivado pela API** a partir dos metadados — não existe campo de ' +
        'caminho no corpo. O bucket é compartilhado com o EasyML (NF-e mod. 55 e CT-e); aceitar ' +
        'um caminho de quem chama seria permitir escrever sobre o acervo de outro produto.\n\n' +
        'Três formatos, discriminados por `documento`:\n' +
        '- `nota` → `{company}/{store}/{model}/{YYYY}/{MM}/{chave44}/{kind}.xml`\n' +
        '- `evento` → `…/{chave44}/event-{tipo}-{seq}.xml` (na pasta da NOTA, no mês da NOTA)\n' +
        '- `inutilizacao` → `…/{YYYY}/inutilizations/{serie}-{inicio}-{fim}.xml` (não tem chave)\n\n' +
        '`issuedAt`/`noteIssuedAt` vão como **string ISO com o offset do emitente**: o ano e o ' +
        'mês saem da string, porque uma nota de 31/12 23h30 BRT convertida para UTC cairia no ' +
        'ano fiscal seguinte.\n\n' +
        'Nota sem chave de acesso (rejeitada, rascunho) usa `number`/`serie`/`noteId` para um ' +
        'nome de pasta estável — a **mesma** regra do ZIP do contador.\n\n' +
        'Teto de 10 MB (o do próprio bucket); backstop do multer em 25 MB. Devolve também o ' +
        '`sha256`, calculado aqui sobre o que subiu, para a linha do banco poder provar depois ' +
        'que o objeto é o que ela diz que é.',
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file', 'documento', 'companyId', 'storeId', 'model'],
        properties: {
          file: { type: 'string', format: 'binary', description: 'Bytes do XML.' },
          documento: { type: 'string', enum: ['nota', 'evento', 'inutilizacao'] },
          companyId: UUID,
          storeId: UUID,
          model: { type: 'string', enum: ['55', '65'], description: '65 = NFC-e.' },
          kind: {
            type: 'string',
            enum: ['authorized', 'signed', 'cancellation', 'request', 'response'],
            description: 'Os três primeiros para `nota`; os dois últimos para `evento`.',
          },
          issuedAt: { type: 'string', description: '`nota`: ISO local do emitente.' },
          noteIssuedAt: { type: 'string', description: '`evento`: emissão da NOTA.' },
          accessKey: { type: 'string', description: 'Chave de 44 dígitos, quando houver.' },
          number: { type: 'integer', description: 'Fallback de nota sem chave.' },
          serie: { type: 'integer', description: 'Fallback de nota sem chave; série na inutilização.' },
          noteId: { ...UUID, description: 'Fallback de nota sem chave.' },
          eventType: { type: 'string', description: '`evento`: ex. 110111 (cancelamento).' },
          eventSequence: { type: 'integer', description: '`evento`: nSeqEvento.' },
          year: { type: 'integer', description: '`inutilizacao`: ano da faixa.' },
          numberStart: { type: 'integer', description: '`inutilizacao`: primeiro número.' },
          numberEnd: { type: 'integer', description: '`inutilizacao`: último número.' },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'XML no acervo. `bucket`, `sha256` e `bytes` vão para a linha do documento.',
      schema: {
        type: 'object',
        properties: {
          bucket: { type: 'string', example: 'fiscal-xml' },
          objectPath: { type: 'string', example: '<companyId>/<storeId>/65/2026/07/<chave44>/authorized.xml' },
          sha256: { type: 'string' },
          bytes: { type: 'integer' },
        },
      },
    }),
    ApiServiceKeyErrorResponses(),
  );
