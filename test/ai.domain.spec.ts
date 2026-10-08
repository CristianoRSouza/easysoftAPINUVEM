import { describe, expect, it } from 'vitest';
import { diaEmBrasilia } from '../src/modules/ai/domain/brasilia-day.rule';
import { mapChatSession } from '../src/modules/ai/domain/chat-session.mapper';
import { traduzirFalhaDaPortaDeIa } from '../src/modules/ai/domain/upstream-failure.rule';

describe('traduzirFalhaDaPortaDeIa — o que a tela recebe quando o EasyAI recusa', () => {
  const PADRAO = 'O assistente não conseguiu responder agora.';

  it('402 e 429 são do usuário: status e código próprios', () => {
    expect(traduzirFalhaDaPortaDeIa(402, '{"message":"Sem saldo."}')).toEqual({
      status: 402,
      error: 'ai_insufficient_credits',
      message: 'Sem saldo.',
    });
    expect(traduzirFalhaDaPortaDeIa(429, '{"message":"Devagar."}')).toEqual({
      status: 429,
      error: 'ai_rate_limited',
      message: 'Devagar.',
    });
  });

  it.each([400, 401, 403, 404, 500, 502])('%i vira 503 `ai_upstream_error`', (status) => {
    // 401/403 falam da confiança entre servidores: repassá-los deslogaria quem não tem culpa.
    expect(traduzirFalhaDaPortaDeIa(status, '')).toEqual({
      status: 503,
      error: 'ai_upstream_error',
      message: PADRAO,
    });
  });

  it('`message` vence `error`; `error` só serve de texto se não houver `message`', () => {
    expect(traduzirFalhaDaPortaDeIa(402, '{"error":"codigo","message":"Texto."}').message).toBe('Texto.');
    expect(traduzirFalhaDaPortaDeIa(402, '{"error":"codigo"}').message).toBe('codigo');
    expect(traduzirFalhaDaPortaDeIa(402, '{"error":"codigo","message":""}').message).toBe('codigo');
  });

  it('corpo vazio, não-JSON ou sem os campos: fica a mensagem padrão', () => {
    expect(traduzirFalhaDaPortaDeIa(500, '<html>Bad Gateway</html>').message).toBe(PADRAO);
    expect(traduzirFalhaDaPortaDeIa(500, '{}').message).toBe(PADRAO);
    expect(traduzirFalhaDaPortaDeIa(500, 'null').message).toBe(PADRAO);
  });
});

describe('mapChatSession — linha do histórico → fio', () => {
  it('datas viram ISO e `app` ausente fica null', () => {
    expect(
      mapChatSession({
        id: 1,
        user_id: 'u',
        day: '2026-08-01',
        messages: [{ role: 'user', content: 'oi' }],
        started_at: new Date(0),
        ended_at: '2026-08-01T10:00:00.000Z',
      }),
    ).toEqual({
      id: '1',
      user_id: 'u',
      day: '2026-08-01',
      app: null,
      messages: [{ role: 'user', content: 'oi' }],
      started_at: '1970-01-01T00:00:00.000Z',
      ended_at: '2026-08-01T10:00:00.000Z',
    });
  });

  it('`messages` torto (objeto, null) vira lista vazia; datas ausentes, string vazia', () => {
    const s = mapChatSession({ id: 'a', user_id: 'u', day: 'd', app: 'x', messages: { a: 1 } });
    expect(s.messages).toEqual([]);
    expect(s.started_at).toBe('');
    expect(s.app).toBe('x');
    expect(mapChatSession({ messages: null }).messages).toEqual([]);
  });
});

describe('diaEmBrasilia', () => {
  it('vira o dia às 03:00 UTC, não à meia-noite UTC', () => {
    expect(diaEmBrasilia(new Date('2026-08-01T02:59:59.000Z'))).toBe('2026-07-31');
    expect(diaEmBrasilia(new Date('2026-08-01T03:00:00.000Z'))).toBe('2026-08-01');
  });
});
