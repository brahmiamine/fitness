import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

function read(path) {
  return readFileSync(resolve(root, path))
}

function pngDimensions(path) {
  const contents = read(path)
  return { width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) }
}

describe('PWA assets', () => {
  it('declares an installable standalone application', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest').toString('utf8'))
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('ships correctly sized Android and Apple icons', () => {
    expect(pngDimensions('public/icons/icon-192.png')).toEqual({ width: 192, height: 192 })
    expect(pngDimensions('public/icons/icon-512.png')).toEqual({ width: 512, height: 512 })
    expect(pngDimensions('public/icons/icon-maskable-512.png')).toEqual({ width: 512, height: 512 })
    expect(pngDimensions('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 })
  })

  it('registers the manifest, iPhone splash screens and offline worker', () => {
    const html = read('index.html').toString('utf8')
    const worker = read('public/sw.js').toString('utf8')
    expect(html).toContain('rel="manifest"')
    expect(html.match(/apple-touch-startup-image/g)).toHaveLength(12)
    expect(worker).toContain("self.addEventListener('install'")
    expect(worker).toContain("self.addEventListener('fetch'")
    expect(worker).toContain(".wasm")
  })
})
