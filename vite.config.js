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
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    // Sin Supabase en los tests: si falta un seed local, el snapshot falla en vez de
    // pedirlo al bucket real.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
})
