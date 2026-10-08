import { Injectable } from '@nestjs/common';
import { ServiceRole } from '../../../db/service-role';
import { SupabaseAdmin } from '../../../db/supabase-admin';

/** Leitura do acervo de XML no Supabase Storage, pelo chokepoint `storage` da service_role. */
@Injectable()
export class NfceXmlStorageClient {
  constructor(
    private readonly supabase: SupabaseAdmin,
    private readonly serviceRole: ServiceRole,
  ) {}

  /**
   * Baixa um XML do acervo.
   *
   * ⚠️ **Quem chama já leu a linha com o filtro de tenant.** Este método recebe um caminho e
   * o busca — ele NÃO autoriza nada. O bucket é privado e só `service_role` o alcança, então
   * baixar um caminho vindo do request seria entregar o acervo inteiro. A ordem correta, e a
   * única usada aqui, é: ler a linha por `store_id` → pegar o caminho QUE AQUELA LEITURA
   * devolveu → baixar. Apoiar-se só na RLS já causou vazamento entre clientes no EasyML em
   * 12/08/2026.
   */
  async baixar(bucket: string, path: string): Promise<string> {
    const { data, error } = await this.serviceRole.run('storage', () =>
      this.supabase.client.storage.from(bucket).download(path),
    );
    if (error || !data) {
      throw new Error(
        `Storage não devolveu o XML (bucket="${bucket}", object="${path}"): ${error?.message ?? 'sem corpo'}`,
      );
    }
    return Buffer.from(await data.arrayBuffer()).toString('utf8');
  }
}
