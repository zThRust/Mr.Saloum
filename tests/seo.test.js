import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_SITE_ORIGIN, seoPlugin, siteOrigin } from '../scripts/seo.mjs'

test('SEO usa uma origem HTTPS central e deixa somente o público no sitemap', () => {
  assert.equal(siteOrigin(), DEFAULT_SITE_ORIGIN)
  const custom = siteOrigin('https://example.test/')
  const plugin = seoPlugin(custom)
  const artifacts = {}
  plugin.generateBundle.call({ emitFile: ({ fileName, source }) => { artifacts[fileName] = source } })
  assert.match(artifacts['robots.txt'], /Sitemap: https:\/\/example\.test\/sitemap\.xml/)
  assert.match(artifacts['sitemap.xml'], /<loc>https:\/\/example\.test\/<\/loc>/)
  assert.doesNotMatch(artifacts['sitemap.xml'], /admin/)
  assert.throws(() => siteOrigin('http://example.test'))
  assert.throws(() => siteOrigin('https://user@example.test'))
  assert.throws(() => siteOrigin('https://example.test/folder'))
})

test('HTML inicial público tem canonical, imagem social e JSON-LD; painel tem noindex', () => {
  const plugin = seoPlugin(DEFAULT_SITE_ORIGIN)
  const read = (file) => plugin.transformIndexHtml(readFileSync(new URL('../' + file, import.meta.url), 'utf8'))
  const index = read('index.html')
  const admin = read('admin/index.html')
  assert.ok(index.includes(`href="${DEFAULT_SITE_ORIGIN}/"`))
  assert.ok(index.includes(`content="${DEFAULT_SITE_ORIGIN}/mr-saloum-share.jpg?v=11"`))
  assert.match(index, /"@type": "HairSalon"/)
  assert.match(index, /"addressLocality": "Parnamirim"/)
  assert.doesNotMatch(index, /telephone|geoCoordinates|aggregateRating/)
  assert.match(admin, /name="robots" content="noindex, nofollow"/)
  assert.doesNotMatch(admin, /rel="canonical"|property="og:/)
})
