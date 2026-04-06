/**
 * Generates PNG icons from the SVG for PWA manifest.
 * Run once: node generate-icons.mjs
 */
import { createCanvas } from 'canvas'
import { readFileSync, writeFileSync } from 'fs'

// Simple canvas-drawn icon — no external SVG renderer needed
function drawIcon(size) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  const s = size / 512

  // Background
  ctx.fillStyle = '#0d1f2d'
  roundRect(ctx, 0, 0, size, size, 80 * s)
  ctx.fill()

  // Water shimmer
  ctx.fillStyle = 'rgba(14,165,233,0.2)'
  ctx.beginPath()
  ctx.ellipse(256*s, 370*s, 200*s, 40*s, 0, 0, Math.PI * 2)
  ctx.fill()

  // Fish body
  ctx.fillStyle = '#38bdf8'
  ctx.beginPath()
  ctx.ellipse(240*s, 256*s, 110*s, 58*s, 0, 0, Math.PI * 2)
  ctx.fill()

  // Fish tail
  ctx.fillStyle = '#0ea5e9'
  ctx.beginPath()
  ctx.moveTo(360*s, 256*s)
  ctx.lineTo(410*s, 210*s)
  ctx.lineTo(410*s, 302*s)
  ctx.closePath()
  ctx.fill()

  // Eye
  ctx.fillStyle = '#0d1f2d'
  ctx.beginPath()
  ctx.arc(170*s, 245*s, 14*s, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath()
  ctx.arc(167*s, 242*s, 5*s, 0, Math.PI * 2)
  ctx.fill()

  // Fishing line
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 3 * s
  ctx.setLineDash([6*s, 4*s])
  ctx.beginPath()
  ctx.moveTo(256*s, 60*s)
  ctx.lineTo(256*s, 195*s)
  ctx.stroke()

  // Hook
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = 4 * s
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(256*s, 215*s, 25*s, -Math.PI/2, Math.PI/2)
  ctx.stroke()

  // Rod tip dot
  ctx.fillStyle = '#facc15'
  ctx.beginPath()
  ctx.arc(256*s, 58*s, 6*s, 0, Math.PI * 2)
  ctx.fill()

  return c
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

try {
  writeFileSync('public/icon-192.png', drawIcon(192).toBuffer('image/png'))
  writeFileSync('public/icon-512.png', drawIcon(512).toBuffer('image/png'))
  writeFileSync('public/apple-touch-icon.png', drawIcon(180).toBuffer('image/png'))
  console.log('Icons generated: icon-192.png, icon-512.png, apple-touch-icon.png')
} catch (e) {
  console.log('canvas package not available — using SVG fallback in manifest')
}
