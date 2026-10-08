/**
 * Identidade da imagem em execução, gravada no `docker build` (ARG/ENV `BUILD_ID`).
 * Na esteira hom -> main é `t-<árvore do código>`: a produção promove a imagem da
 * homologação sem recompilar, então as duas têm que devolver o MESMO valor.
 * Fora do Docker (dev local, testes) não há build, e o valor é `dev`.
 */
export function buildIdentity(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.BUILD_ID?.trim();
  return id ? id : 'dev';
}
