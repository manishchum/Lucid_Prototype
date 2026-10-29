'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: string;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export default function InfoTooltip({
  content,
  className = '',
  align = 'center',
}: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const alignClasses = {
    left: 'left-0 translate-x-0',
    center: 'left-1/2 -translate-x-1/2',
    right: 'right-0 translate-x-0',
  }[align];

  const arrowClasses = {
    left: 'left-3',
    center: 'left-1/2 -translate-x-1/2',
    right: 'right-3',
  }[align];

  return (
    <span className={`relative inline-flex items-center align-middle ${className}`}>
      <span
        tabIndex={0}
        role="button"
        aria-label="Information"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsVisible((prev) => !prev);
        }}
        className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded-full cursor-help focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <Info size={13} className="shrink-0" />
      </span>

      {isVisible && (
        <span
          role="tooltip"
          className={`absolute bottom-full mb-2 w-60 p-2.5 bg-slate-900/95 backdrop-blur-xs text-white text-[11px] font-medium leading-relaxed rounded-xl shadow-xl z-50 pointer-events-none transition-all animate-in fade-in zoom-in-95 duration-100 ${alignClasses}`}
        >
          {content}
          <span
            className={`absolute top-full border-4 border-transparent border-t-slate-900/95 ${arrowClasses}`}
          />
        </span>
      )}
    </span>
  );
}
