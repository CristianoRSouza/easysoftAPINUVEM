import { InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * O envelope `enc:v1` — a cifra dos segredos TEF.
 *
 * Formato: `enc:v1:<iv_b64>:<tag_b64>:<data_b64>` — AES-256-GCM, IV de 12 bytes,
 * tag de 16. É o **mesmo formato do Electron**, e isso não é detalhe: o totem lê no
 * chão de loja o que foi cifrado aqui. Mudar o formato de um lado quebra a maquininha
 * do outro.
 *
 * Estava privado dentro do `TotemsService`. Passou para cá quando a criação/edição de
 * totem também precisou cifrar — duas cópias de uma cifra é como um lado ganha uma
 * correção que o outro não recebe.
 */
export function encryptEnvelopeV1(plain: string, masterKeyBase64: string): string {
  const key = Buffer.from((masterKeyBase64 ?? '').trim(), 'base64');
  if (key.length !== 32) {
    throw new InternalServerErrorException({
      error: 'bad_key',
      message: 'Master key deve ter 32 bytes.',
    });
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/**
 * Só decifra em teste — a API **nunca** devolve segredo TEF em rota alguma.
 *
 * Existe porque sem ela o teste da cifra só consegue afirmar "o texto mudou", o que
 * passaria feliz se a cifra gravasse lixo. Com ela o teste prova o que importa: o que
 * sai é exatamente o que entrou, e adulterar um byte é detectado.
 */
export function decryptEnvelopeV1(envelope: string, masterKeyBase64: string): string {
  const partes = envelope.split(':');
  if (partes.length !== 5 || partes[0] !== 'enc' || partes[1] !== 'v1') {
    throw new Error('envelope fora do formato enc:v1');
  }
  const key = Buffer.from((masterKeyBase64 ?? '').trim(), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(partes[2], 'base64'), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(partes[3], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(partes[4], 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
