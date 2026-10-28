'use client'

import React from "react"
import Link from "next/link"

interface FooterProps {
  className?: string;
  showPrivacy?: boolean;
}

const Footer = ({ className = "", showPrivacy = true }: FooterProps) => {
  return (
    <footer className={`w-full bg-transparent py-2.5 px-4 md:px-8 shrink-0 ${className}`}>
      <div className="max-w-[1320px] mx-auto flex items-center justify-between w-full">
        <div>
          {showPrivacy ? (
            <Link 
              href="/privacy-policy" 
              className="text-xs text-slate-500 hover:text-slate-800 transition-colors font-medium"
            >
              Privacy Policy
            </Link>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2.5 ml-auto">
          {/* Logo */}
          <div className="w-5 h-5 rounded overflow-hidden flex items-center justify-center shrink-0">
            <img
              src="/images/icons/Black%20Logo%20without%20Name.jpg"
              alt="Lucid logo"
              className="w-full h-full object-contain"
            />
          </div>
          
          {/* Footer Text */}
          <div className="text-xs md:text-sm text-slate-600 font-medium whitespace-nowrap">
            2026 Lucid<span className="text-slate-400 mx-1">·</span>Powered by workfloww.ai
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
