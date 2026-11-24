export const DEFAULT_SITE_ORIGIN = 'https://mr-saloum.onrender.com'

export function siteOrigin(value) {
  if (!value) return DEFAULT_SITE_ORIGIN
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_SITE_URL deve ser uma origem HTTPS sem credenciais, caminho ou parâmetros.')
  }
  return url.origin
}

export function seoPlugin(origin) {
  const files = {
    'robots.txt': `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`
  }
  return {
    name: 'mr-saloum-seo',
    transformIndexHtml: (html) => html.replaceAll('%SITE_ORIGIN%', origin),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const filename = new URL(request.url, 'http://localhost').pathname.slice(1)
        if (!Object.hasOwn(files, filename)) return next()
        response.setHeader('Content-Type', filename.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8')
        response.end(files[filename])
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    }
  }
}
