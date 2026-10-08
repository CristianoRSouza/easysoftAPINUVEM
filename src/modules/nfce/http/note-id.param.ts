import { BadRequestException } from '@nestjs/common';
import { UUID_RE } from '../../../common/validation/uuid';

/** `:noteId` da rota, aparado e conferido. Fora do formato é 400 `invalid_note`. */
export function validNote(noteId: string): string {
  const id = String(noteId ?? '').trim();
  if (!UUID_RE.test(id)) {
    throw new BadRequestException({ error: 'invalid_note', message: 'noteId inválido.' });
  }
  return id;
}
