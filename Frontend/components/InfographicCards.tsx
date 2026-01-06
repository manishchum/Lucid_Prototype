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

  return (
    <section aria-label="Infographic cards" className="py-0 relative overflow-visible">
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
