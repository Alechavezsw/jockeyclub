import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /powerpoint es una página estática (public/powerpoint/index.html), no una ruta de la app.
// En producción lo resuelve vercel.json; acá hace lo mismo en dev y en preview.
const powerpointRoute = () => {
  const rewrite = (req, _res, next) => {
    if (/^\/powerpoint\/?(\?.*)?$/.test(req.url || '')) req.url = '/powerpoint/index.html'
    next()
  }
  return {
    name: 'powerpoint-route',
    configureServer(server) { server.middlewares.use(rewrite) },
    configurePreviewServer(server) { server.middlewares.use(rewrite) },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), powerpointRoute()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'lucide', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, priority: 20 },
            { name: 'supabase', test: /[\\/]node_modules[\\/]@supabase[\\/]/, priority: 20 },
            // Sin arrastrar helpers compartidos: si entran acá, el index importa el PDF entero.
            {
              name: 'xlsx',
              test: /[\\/]node_modules[\\/]xlsx[\\/]/,
              priority: 30,
              includeDependenciesRecursively: false,
            },
            {
              name: 'jspdf',
              test: /[\\/]node_modules[\\/](jspdf(?:-autotable)?|html2canvas|canvg|fflate|fast-png|pako|iobuffer)[\\/]/,
              priority: 30,
              includeDependenciesRecursively: false,
            },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    // Unitarios en paralelo; PostgreSQL embebido en serie (puertos + EBUSY al borrar data dir).
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{js,jsx}'],
          exclude: ['src/**/*.pg.test.js', '**/node_modules/**'],
          setupFiles: ['src/test/setup.js'],
          hookTimeout: 60000,
          env: {
            VITE_SUPABASE_URL: '',
            VITE_SUPABASE_ANON_KEY: '',
          },
        },
      },
      {
        test: {
          name: 'pg',
          environment: 'node',
          include: ['src/**/*.pg.test.js'],
          setupFiles: ['src/test/setup.pg.js'],
          fileParallelism: false,
          hookTimeout: 180000,
          testTimeout: 180000,
          env: {
            VITE_SUPABASE_URL: '',
            VITE_SUPABASE_ANON_KEY: '',
          },
        },
      },
    ],
  },
})
