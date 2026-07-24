import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
      // Reglas experimentales del compilador de React: marcan Date.now()/Math.random()
      // dentro de event handlers como impuras (falso positivo sin el compilador).
      'react-hooks/purity': 'off',
      // Patrón legacy de sincronización de estado en efectos; visible pero no bloqueante.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
