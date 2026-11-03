import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

const noUtcDay = {
  selector: "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString'][arguments.0.value=0][arguments.1.value=10]",
  message: 'Usá todayAR() (America/Argentina/Buenos_Aires). toISOString().slice(0, 10) es el día UTC.',
};

export default defineConfig([
  // Exports generados de LILA/Societas/datita: datos, no código (y no se commitean).
  globalIgnores(['dist', 'datita', 'src/data/seed', 'src/data/seedDatitaReservas.js']),
  {
    files: ['**/*.{mjs,cjs}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-syntax': ['error', noUtcDay] },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // toISOString() es UTC: a las 23:30 del día 10 en Argentina queda el 11 y cobra recargo.
      'no-restricted-syntax': ['error', noUtcDay],
      // `const { a, b, ...rest } = obj` es la forma de omitir campos: a y b no son "sin usar".
      'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
      // Reglas experimentales del compilador de React: marcan Date.now()/Math.random()
      // dentro de event handlers como impuras (falso positivo sin el compilador).
      'react-hooks/purity': 'off',
      // Patrón legacy de sincronización de estado en efectos; visible pero no bloqueante.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
