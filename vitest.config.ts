import { defineConfig } from 'vitest/config';

// O vitest 4 encolheu o defaultExclude para node_modules e .git — o dist/ saiu
// da lista. Como o CI compila antes de testar, sem isto o vitest recolhe os
// .spec.js compilados em dist/ e falha ao importá-los de um módulo CommonJS.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  },
});
