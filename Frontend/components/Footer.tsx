'use client'

import React from "react"

const Footer = () => {
  return (
    <footer className="w-full bg-white border-t border-slate-200 py-2 md:py-8">
      <div className="px-4 md:px-8 flex items-right justify-end gap-3">
        {/* Logo */}
        <div className="w-5 h-5 md:w-6 md:h-6 rounded-md bg-slate-900 flex items-center justify-center">
          <span className="text-white text-xs md:text-sm font-bold">L</span>
        </div>
        
        {/* Footer Text */}
        <div className="text-xs md:text-sm text-slate-600 font-medium">
          Powered by Lucid <span className="text-slate-400">·</span> Workflow.ai
        </div>
      </div>
    </footer>
  )
}

export default Footer
