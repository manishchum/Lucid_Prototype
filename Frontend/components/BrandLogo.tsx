"use client"

import React from "react"
import Link from "next/link"

interface BrandLogoProps {
  isEY?: boolean
  className?: string
  linkHref?: string
  eyLogoSrc?: string
}

export default function BrandLogo({
  isEY = false,
  className = "",
  linkHref = "/",
  eyLogoSrc = "/images/icons/ey-logo.svg"
}: BrandLogoProps) {
  if (isEY) {
    return (
      <Link href={linkHref} className={`flex items-center gap-2.5 group w-fit ${className}`}>
        {/* EY Brand Logo */}
        <div className="relative h-12 sm:h-14 md:h-16 w-auto flex-shrink-0 flex items-center">
          <img
            src={eyLogoSrc}
            alt="EY Logo"
            className="h-full w-auto object-contain"
          />
        </div>
        {/* <div className="flex flex-col leading-none self-end pb-1">
          <span className="text-[16px] sm:text-[17px] font-bold text-[#0F172A] tracking-[-0.02em]">
            EY
          </span>
          <span className="text-[10.5px] sm:text-[11px] text-slate-500 font-normal tracking-tight">
            by workfloww.ai
          </span>
        </div> */}
      </Link>
    )
  }

  // Default Lucid Logo
  return (
    <Link href={linkHref} className={`flex items-center gap-2.5 group w-fit ${className}`}>
      <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0">
        <img
          src="/images/icons/logo-2.png"
          alt="Lucid Logo"
          className="w-full h-full object-contain mix-blend-multiply"
        />
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[18px] sm:text-[19px] font-bold text-[#0F172A] tracking-[-0.02em]">
          Lucid
        </span>
        <span className="text-[11px] sm:text-[11.5px] text-slate-500 font-normal mt-0.5 tracking-tight">
          by workfloww.ai
        </span>
      </div>
    </Link>
  )
}
