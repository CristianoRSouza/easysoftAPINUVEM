import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint da EasyFood API.
 *
 * ── Por que esta configuração é curta ──────────────────────────────────────────
 * O `npm run lint` existia no `package.json` desde o início, mas o ESLint nunca foi
 * instalado e nunca houve config: o comando só respondia "eslint não é reconhecido", e
 * o CI não o executava, então ninguém percebeu. Esta config nasce com um objetivo
 * modesto e honesto — o comando passar a funcionar e a esteira passar a executá-lo —
 * não o de impor um padrão novo a 12 mil linhas já escritas.
 *
 * Por isso o preset é o `recommended` (sem as variantes `strict`/`type-checked`): ele
 * pega descuido de verdade sem exigir refatoração. O dia de apertar é outro, e deve ser
 * uma decisão consciente, não um efeito colateral de ligar a ferramenta.
 */
/*
 * ── Camadas dos módulos (`src/modules/<modulo>/{http,application,domain,infrastructure}`) ──
 *
 *   http → application → infrastructure
 *                 ↘          ↓
 *                   domain  (puro)
 *
 * A pasta já diz a intenção; estas regras impedem que um import a desminta. `import type`
 * é liberado onde só o TIPO cruza a fronteira e nada roda (ex.: o caso de uso que recebe o
 * client de uma transação aberta pelo repositório).
 */
const proibir = (...grupos) => ({
  'no-restricted-imports': ['error', { patterns: grupos }],
});

const SO_NEST_COMUM = {
  regex: '^@nestjs/(?!common$)',
  message: 'Só `@nestjs/common` aqui; Swagger e afins são da camada http.',
};
const BANCO = {
  group: ['pg', '**/db/db.service', '**/db/service-role', '**/db/supabase-admin'],
  message: 'Acesso a banco/Supabase é da camada infrastructure.',
};
/*
 * O caso de uso PODE importar o `ServiceRole`: ele não é acesso a banco, é o rótulo de uma
 * escalação de privilégio ("este login cria sessão") — e decidir que uma operação escala é
 * regra de aplicação. O que ele não pode é falar com o pool ou com o Supabase direto.
 */
const BANCO_NA_APLICACAO = {
  group: ['pg', '**/db/db.service', '**/db/supabase-admin'],
  message: 'Acesso a banco/Supabase é da camada infrastructure.',
  allowTypeImports: true,
};
const EXPRESS = { group: ['express'], message: 'Requisição/resposta HTTP é da camada http.' };

const camadas = [
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: proibir(
      { group: ['@nestjs/*'], message: 'domain é puro: sem Nest.' },
      { ...BANCO, message: 'domain é puro: sem banco.' },
      { ...EXPRESS, message: 'domain é puro: sem HTTP.' },
      {
        regex: '/(application|infrastructure|http)/',
        message: 'domain não depende das outras camadas.',
      },
    ),
  },
  {
    files: ['src/modules/*/infrastructure/**/*.ts'],
    rules: proibir(SO_NEST_COMUM, EXPRESS, {
      regex: '/(application|http)/',
      message: 'infrastructure só conhece o domain.',
    }),
  },
  {
    files: ['src/modules/*/application/**/*.ts'],
    rules: proibir(
      SO_NEST_COMUM,
      BANCO_NA_APLICACAO,
      EXPRESS,
      { regex: '/http/', message: 'application não conhece a camada http.' },
    ),
  },
  {
    files: ['src/modules/*/http/**/*.ts'],
    rules: proibir(BANCO, {
      regex: '/infrastructure/',
      message: 'http fala com application; quem busca dado é o caso de uso.',
    }),
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      /*
       * O prefixo `_` já era a convenção do código para "existe por contrato, não se usa"
       * — parâmetro que a interface obriga a declarar (`setLogLevels(_levels)`), campo
       * descartado num destructuring (`{ has_direct: _ignored, ...store }`), argumento de
       * callback de terceiro (`(err, chunk, _final)`). A regra crua acusava os quatro.
       * Honrar o `_` não afrouxa nada: alinha a ferramenta à intenção que já estava escrita.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      /*
       * `any` é ERRO. Já foi aviso, quando havia 44 ocorrências e zerar exigiria refatorar
       * no meio de uma migração; a refatoração em camadas zerou, e daqui em diante o CI cobra.
       * Fronteira sem tipo estável (linha de SQL crua, payload de terceiro) usa `Row`/`unknown`
       * e um mapper — não `any`.
       */
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  ...camadas,
);
