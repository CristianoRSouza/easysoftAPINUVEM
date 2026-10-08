import { Injectable } from '@nestjs/common';
import { ServiceRole } from '../../../db/service-role';
import { SupabaseAdmin } from '../../../db/supabase-admin';

/**
 * O Storage do Supabase, visto daqui: subir um objeto e montar a URL pública.
 *
 * Não decide nada — nem o que é erro aceitável, nem o status HTTP. Devolve o que o Storage
 * respondeu e o `StorageService` aplica a regra.
 */
@Injectable()
export class StorageBucketClient {
  constructor(
    private readonly supabase: SupabaseAdmin,
    private readonly serviceRole: ServiceRole,
  ) {}

  /**
   * Upload pelo chokepoint 'storage'. Devolve a mensagem de erro do Storage, ou `null`
   * quando subiu.
   */
  async upload(
    bucket: string,
    objectPath: string,
    buffer: Buffer,
    opts: { upsert: boolean; contentType: string },
  ): Promise<string | null> {
    const { error } = await this.serviceRole.run('storage', () =>
      this.supabase.client.storage
        .from(bucket)
        .upload(objectPath, buffer, { upsert: opts.upsert, contentType: opts.contentType }),
    );
    return error ? error.message : null;
  }

  /** URL pública do objeto. Não vai à rede: é montada pelo SDK a partir do caminho. */
  publicUrl(bucket: string, objectPath: string): string {
    const { data } = this.supabase.client.storage.from(bucket).getPublicUrl(objectPath);
    return data.publicUrl;
  }
}
