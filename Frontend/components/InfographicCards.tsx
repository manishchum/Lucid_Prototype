// @ts-nocheck
"use client"

import React, { useRef, useState, useEffect } from "react"

export type InfographicSection = {
  heading: string
  points: string[]
  icon?: string
}

type Props = {
  sections?: InfographicSection[] | null
}

export default function InfographicCards({ sections }: Props) {
  const items = (sections && Array.isArray(sections) ? sections.slice(0, 6) : [])

  if (!items || items.length === 0) return (
    <div className="text-center text-sm text-slate-500">📊 Flash cards generation coming soon...</div>
  )

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 0)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      el.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [items])

  const scrollByWidth = (dir: 'left' | 'right') => {
    const el = scrollerRef.current
    if (!el) return
    const amount = Math.max(el.clientWidth * 0.6, 240)
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' })
  }

  // export helper: build SVG with wrapped text and rasterize to PNG with high DPR
  const exportAsPNG = async () => {
    try {
      const cards = items
      if (!cards || cards.length === 0) return

      const cardW = 256 // matches w-64
      const gap = 16 // matches gap-4 (1rem)
      const pad = 12 // scroller px-3 -> 0.75rem -> 12px

      // Fonts and measurement helpers
      const headingFontSize = 18
      const headingFont = `600 ${headingFontSize}px Inter, Arial, sans-serif`
      const bulletFontSize = 14
      const bulletFont = `${bulletFontSize}px Inter, Arial, sans-serif`
      const usableWidth = cardW - 32 // left/right padding inside card (16px each approx)

      const measureCtx = document.createElement('canvas').getContext('2d')
      if (!measureCtx) throw new Error('Canvas not supported')

      const wrapText = (text: string, font: string, maxWidth: number, maxLines = 10) => {
        measureCtx.font = font
        const words = text.split(/\s+/)
        const lines: string[] = []
        let cur = ''
        for (let w of words) {
          const trial = cur ? cur + ' ' + w : w
          const wWidth = measureCtx.measureText(trial).width
          if (wWidth <= maxWidth) {
            cur = trial
          } else {
            if (cur) lines.push(cur)
            cur = w
            if (lines.length >= maxLines) break
          }
        }
        if (cur && lines.length < maxLines) lines.push(cur)
        return lines
      }

      // Build per-card lines and compute heights
      type CardRender = { headingLines: string[]; bulletLines: { lines: string[] }[]; height: number }
      const rendered: CardRender[] = []
      let maxCardH = 0
      const headingLineHeight = Math.round(headingFontSize * 1.25)
      const bulletLineHeight = Math.round(bulletFontSize * 1.4)

      for (let c of cards) {
        const rawHeading = String(c.heading || '')
        const headingLines = wrapText(rawHeading, headingFont, usableWidth, 2)

        const bullets = Array.isArray(c.points) ? c.points : []
        const bulletLinesArr: { lines: string[] }[] = []
        let totalBulletLines = 0
        for (let b of bullets) {
          const lines = wrapText(String(b), bulletFont, usableWidth - 16, 2) // bullets have a bullet glyph indent
          bulletLinesArr.push({ lines })
          totalBulletLines += lines.length
        }

        const topPadding = 16
        const afterHeadingGap = 12
        const contentH = headingLines.length * headingLineHeight + afterHeadingGap + totalBulletLines * bulletLineHeight
        const cardH = Math.max(160, topPadding + contentH + 16)
        rendered.push({ headingLines, bulletLines: bulletLinesArr, height: cardH })
        if (cardH > maxCardH) maxCardH = cardH
      }

      const totalWidth = cards.length * cardW + Math.max(0, cards.length - 1) * gap + pad * 2
      const totalHeight = Math.round(maxCardH) + pad * 2

      const defs = `
        <linearGradient id="gblue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#EFF6FF" />
          <stop offset="100%" stop-color="#EEF2FF" />
        </linearGradient>
        <linearGradient id="gpurple" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#F5F3FF" />
          <stop offset="100%" stop-color="#FEF2F8" />
        </linearGradient>
      `

      const escape = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      let inner = ''
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i]
        const x = pad + i * (cardW + gap)
        const y = pad
        const grad = i % 2 === 0 ? 'url(#gblue)' : 'url(#gpurple)'
        const r = rendered[i]

        inner += `<g transform="translate(${x},${y})">` +
          `<rect x="0" y="0" rx="12" ry="12" width="${cardW}" height="${r.height}" fill="${grad}" stroke="#0000001f" stroke-width="1"/>`

        // heading lines
        inner += `<text x="16" y="${16 + headingLineHeight - 2}" font-family="Inter, Arial, sans-serif" font-size="${headingFontSize}px" fill="#0f172a" font-weight="600">`
        for (let li = 0; li < r.headingLines.length; li++) {
          const line = escape(r.headingLines[li])
          const dy = li === 0 ? '0' : headingLineHeight.toString()
          inner += `<tspan x="16" dy="${dy}">${line}</tspan>`
        }
        inner += `</text>`

        // bullets
        let currentY = 16 + r.headingLines.length * headingLineHeight + 12
        for (let bi = 0; bi < r.bulletLines.length; bi++) {
          const block = r.bulletLines[bi]
          for (let li = 0; li < block.lines.length; li++) {
            const line = escape(block.lines[li])
            inner += `<text x="24" y="${currentY + li * bulletLineHeight}" font-family="Inter, Arial, sans-serif" font-size="${bulletFontSize}px" fill="#334155">` + (li === 0 ? `• ${line}` : `${line}`) + `</text>`
          }
          currentY += block.lines.length * bulletLineHeight
        }

        inner += `</g>`
      }

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}"><defs>${defs}</defs><rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#ffffff"/>${inner}</svg>`

      // rasterize with higher DPR for clarity
      const svg64 = btoa(unescape(encodeURIComponent(svg)))
      const imgSrc = 'data:image/svg+xml;base64,' + svg64
      const DPR = Math.min(4, Math.max(2, Math.round((window.devicePixelRatio || 1) * 2)))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(totalWidth * DPR)
      canvas.height = Math.round(totalHeight * DPR)
      canvas.style.width = totalWidth + 'px'
      canvas.style.height = totalHeight + 'px'
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas not supported')
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          ctx.clearRect(0, 0, totalWidth, totalHeight)
          ctx.drawImage(img, 0, 0, totalWidth, totalHeight)
          canvas.toBlob((blob) => {
            if (!blob) return
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'flashcards.png'
            document.body.appendChild(a)
            a.click()
            a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 5000)
          }, 'image/png')
        } catch (e) {
          console.error('rasterize failed', e)
        }
      }
      img.onerror = (ev) => console.error('image load failed', ev)
      img.src = imgSrc

    } catch (err) {
      console.error('export failed', err)
    }
  }

  return (
    <section aria-label="Infographic cards" className="py-0 relative overflow-visible">
      {/* Download button above the cards */}
      <div className="mb-3 flex justify-end pr-3">
        <button onClick={exportAsPNG} className="bg-white px-3 py-1 rounded shadow text-sm border" title="Download flashcards as PNG">Download</button>
      </div>

      {/* scroller has modest horizontal padding; arrows will be positioned outside the scroller so they don't overlap cards */}
      <div
        ref={scrollerRef}
        // hide native scrolling and prevent touch/drag; movement will be via arrow buttons only
        className="flex gap-4 overflow-x-hidden no-scrollbar infographic-scroller px-3 py-0"
        onWheel={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
      >
        {items.map((sec, idx) => {
          const heading = (sec.heading || '').trim()
          const points = Array.isArray(sec.points) ? sec.points : []
          const colorClass = (idx % 2 === 0)
            ? 'bg-gradient-to-br from-blue-50 to-indigo-50 border-transparent'
            : 'bg-gradient-to-br from-purple-50 to-pink-50 border-transparent'

          return (
            <article
              key={idx}
              role="group"
              tabIndex={0}
              className={`flex-shrink-0 w-64 p-3 ${colorClass} rounded-lg shadow-sm hover:shadow-lg transition-transform transform hover:-translate-y-1 focus-within:shadow-lg focus-within:-translate-y-1 outline-none`}
            >
              <h3 className="font-semibold text-lg text-slate-900 leading-snug mb-1 text-left" title={heading}>
                {heading}
              </h3>

              <ul className="list-disc list-outside pl-5 text-left text-base text-slate-700 space-y-1">
                {points.length > 0 && (
                  points.map((p, i) => (
                    <li key={i} className="leading-tight text-left">
                      <span
                        className="block"
                        // clamp to 2 lines and ellipsize if longer so only 1 wrapped line appears
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {p}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </article>
          )
        })}
      </div>

      {/* Arrows vertically centered at extreme left and right (absolute) */}
      {canScrollLeft && (
        <button
          aria-label="Scroll left"
          onClick={() => scrollByWidth('left')}
          // position outside the scroller so arrow doesn't overlap cards
          className={`absolute top-1/2 -translate-y-1/2 p-3 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-300 bg-white hover:bg-slate-50`}
          style={{ left: -28, zIndex: 30 }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {canScrollRight && (
        <button
          aria-label="Scroll right"
          onClick={() => scrollByWidth('right')}
          className={`absolute top-1/2 -translate-y-1/2 p-3 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-300 bg-white hover:bg-slate-50`}
          style={{ right: -28, zIndex: 30 }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </section>
  )
}

