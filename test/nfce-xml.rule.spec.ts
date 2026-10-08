import { describe, expect, it } from 'vitest';
import {
  NFCE_XML_KINDS,
  XML_INLINE_MAX_BYTES,
  excedeTetoInline,
  isNfceXmlKind,
  nomeDoArquivoXml,
} from '../src/modules/nfce/domain/nfce-xml.rule';

/**
 * Regras do XML de UMA nota (aba de detalhe): quais `kind` existem, o teto do que é servido
 * inline e o nome de arquivo sugerido. Eram linhas soltas dentro do service; aqui ficam
 * presas uma a uma.
 */
describe('nfce-xml.rule', () => {
  describe('isNfceXmlKind', () => {
    it('aceita exatamente os quatro kinds da aba XML', () => {
      for (const kind of NFCE_XML_KINDS) expect(isNfceXmlKind(kind)).toBe(true);
      expect([...NFCE_XML_KINDS]).toEqual(['authorized', 'cancellation', 'signed', 'generated']);
    });

    it('recusa o resto — inclusive variação de caixa, que viraria nome de coluna no SQL', () => {
      expect(isNfceXmlKind('Authorized')).toBe(false);
      expect(isNfceXmlKind('')).toBe(false);
      expect(isNfceXmlKind('authorized_xml; drop table')).toBe(false);
    });
  });

  describe('excedeTetoInline', () => {
    it('o teto é 2 MB, e o limite exato ainda passa', () => {
      expect(XML_INLINE_MAX_BYTES).toBe(2 * 1024 * 1024);
      expect(excedeTetoInline(XML_INLINE_MAX_BYTES)).toBe(false);
      expect(excedeTetoInline(XML_INLINE_MAX_BYTES + 1)).toBe(true);
    });

    it('tamanho desconhecido conta como zero (generated nunca tem bytes)', () => {
      expect(excedeTetoInline(null)).toBe(false);
    });

    it('aceita o número como string, que é como o driver pode entregar', () => {
      expect(excedeTetoInline(String(XML_INLINE_MAX_BYTES + 1))).toBe(true);
      expect(excedeTetoInline('8123')).toBe(false);
    });
  });

  describe('nomeDoArquivoXml', () => {
    const CHAVE = '35260413971933000178650020000011641837486150';

    it('usa a chave de acesso (só dígitos) e o kind', () => {
      expect(nomeDoArquivoXml({ access_key: CHAVE, number: 1164, serie: 2 }, 'authorized')).toBe(
        `${CHAVE}-authorized.xml`,
      );
      expect(
        nomeDoArquivoXml({ access_key: `NFe${CHAVE}`, number: 1164, serie: 2 }, 'cancellation'),
      ).toBe(`${CHAVE}-cancellation.xml`);
    });

    it('sem chave (ou chave com menos de 20 dígitos) cai para número/série', () => {
      expect(nomeDoArquivoXml({ access_key: null, number: 1164, serie: 2 }, 'signed')).toBe(
        'nfce-1164-2-signed.xml',
      );
      expect(nomeDoArquivoXml({ access_key: '123', number: 7, serie: 1 }, 'generated')).toBe(
        'nfce-7-1-generated.xml',
      );
    });

    it('sem número nem série, zera em vez de escrever "null" no nome', () => {
      expect(nomeDoArquivoXml({ access_key: null, number: null, serie: null }, 'signed')).toBe(
        'nfce-0-0-signed.xml',
      );
    });
  });
});
