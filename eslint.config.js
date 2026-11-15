// ESLint flat config. no-unsanitized blocks innerHTML/outerHTML/insertAdjacentHTML/document.write
// with unsanitized data (SEC-DOM-2); no-eval and no-implied-eval back up SEC-EVAL-1.
// The views render with template strings: every interpolated string from user input, storage or
// an import goes through esc() (src/core/escape.js). A reviewed sink is marked with
//   // eslint-disable-next-line no-unsanitized/property -- reviewed: <why>
import js from '@eslint/js';
import nounsanitized from 'eslint-plugin-no-unsanitized';

const browser = {
  window: 'readonly', document: 'readonly', console: 'readonly', navigator: 'readonly', localStorage: 'readonly',
  URL: 'readonly', Blob: 'readonly', FileReader: 'readonly', Image: 'readonly', CustomEvent: 'readonly', Event: 'readonly',
  ResizeObserver: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', getComputedStyle: 'readonly',
  structuredClone: 'readonly', fetch: 'readonly', HTMLElement: 'readonly', Node: 'readonly', XMLSerializer: 'readonly',
  createImageBitmap: 'readonly', ImageData: 'readonly', devicePixelRatio: 'readonly', matchMedia: 'readonly',
  LadaGlass: 'readonly', CSS: 'readonly', performance: 'readonly', crypto: 'readonly', DOMParser: 'readonly', getSelection: 'readonly',
};

export default [
  { ignores: ['vendor/**', 'node_modules/**'] },
  js.configs.recommended,
  nounsanitized.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: browser },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly', Response: 'readonly' } },
  },
  {
    files: ['tests/**', 'scripts/**', 'eslint.config.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', WebSocket: 'readonly', fetch: 'readonly', URL: 'readonly', setTimeout: 'readonly' } },
  },
];
