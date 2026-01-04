"use client"

import React, { useState } from "react"

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
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set())

  if (!items || items.length === 0) return (
    <div className="text-center text-sm text-slate-500">📊 Infographic generation coming soon...</div>
  )

  return (
    <section aria-label="Infographic cards" className="py-4">
      <div className="flex gap-4 overflow-x-auto no-scrollbar px-1 py-2">
        {items.map((sec, idx) => {
          const heading = (sec.heading || '').trim()
          const points = Array.isArray(sec.points) ? sec.points.slice(0, 3) : []
          const isOpen = openIndex === idx

          return (
            <article
              key={idx}
              role="group"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenIndex(isOpen ? null : idx) } }}
              className="flex-shrink-0 w-64 p-4 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-lg transition-transform transform hover:-translate-y-1 focus-within:shadow-lg focus-within:-translate-y-1 outline-none"
            >
              <div className="flex items-center justify-center mb-3">
                {/* show emoji if icon looks like emoji, or image from sec.icon/url or Unsplash fallback based on heading */}
                {sec.icon && typeof sec.icon === 'string' && sec.icon.length <= 2 ? (
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-lg font-semibold text-slate-800">
                    {sec.icon}
                  </div>
                ) : (
                  (() => {
                    const keyword = (sec.icon && sec.icon !== '' && !sec.icon.startsWith('http')) ? sec.icon : sec.heading || String(idx + 1)
                    const src = sec.icon && sec.icon.startsWith('http')
                      ? sec.icon
                      : `https://source.unsplash.com/160x160/?${encodeURIComponent(String(keyword))}`

                    const initials = (sec.heading || String(idx + 1))
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map(w => w[0]?.toUpperCase() || '')
                      .join('')

                    if (failedImages.has(idx)) {
                      return (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-sm font-semibold text-slate-800 border border-gray-200">
                          {initials || String(idx + 1)}
                        </div>
                      )
                    }

                    return (
                      <img
                        src={src}
                        alt={sec.heading || `infographic-${idx + 1}`}
                        className="w-12 h-12 rounded-full object-cover border border-gray-200"
                        loading="lazy"
                        onError={() => setFailedImages(prev => {
                          const next = new Set(prev)
                          next.add(idx)
                          return next
                        })}
                      />
                    )
                  })()
                )}
              </div>

              <h3 className="font-semibold text-sm text-slate-900 leading-snug mb-2 truncate" title={heading}>
                {heading}
              </h3>

              <ul className="list-disc ml-5 text-sm text-slate-700 space-y-1">
                {points.length > 0 && (
                  // show either first bullet (collapsed) or all bullets (expanded)
                  (isOpen ? points : [points[0]]).map((p, i) => (
                    <li key={i} className="leading-tight">{p}</li>
                  ))
                )}
              </ul>

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  className="text-xs text-slate-600 hover:text-slate-800"
                  aria-expanded={isOpen}
                >
                  {isOpen ? 'Show less' : 'Show more'}
                </button>
                <div className="text-xs text-slate-400">{idx + 1}/{items.length}</div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
