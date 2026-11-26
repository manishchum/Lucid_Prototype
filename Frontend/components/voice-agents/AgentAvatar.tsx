"use client";
import React from 'react';
import { Phone } from 'lucide-react';

interface AgentAvatarProps {
  name: string;
  color?: 'blue' | 'amber' | 'crimson' | 'emerald' | 'purple';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showBadge?: boolean;
}

// Generate deterministic pseudo-pixel pattern from agent name
function getPattern(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const grid: boolean[][] = [];
  for (let r = 0; r < 5; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < 3; c++) {
      const bit = (Math.abs(hash) >> (r * 3 + c)) & 1;
      row.push(bit === 1);
    }
    // mirror for symmetric pixel art
    grid.push([row[0], row[1], row[2], row[1], row[0]]);
  }
  return grid;
}

export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  name,
  color = 'blue',
  size = 'md',
  showBadge = true,
}) => {
  const pattern = getPattern(name);

  // Colors matching Screenshot 2
  const colorMap = {
    blue: {
      bg: 'bg-blue-600',
      pixel: 'bg-blue-300',
      badgeBg: 'bg-blue-600',
      container: 'bg-blue-50 border-blue-200',
    },
    amber: {
      bg: 'bg-amber-600',
      pixel: 'bg-amber-300',
      badgeBg: 'bg-amber-600',
      container: 'bg-amber-50 border-amber-200',
    },
    crimson: {
      bg: 'bg-rose-700',
      pixel: 'bg-rose-300',
      badgeBg: 'bg-rose-700',
      container: 'bg-rose-50 border-rose-200',
    },
    emerald: {
      bg: 'bg-emerald-600',
      pixel: 'bg-emerald-300',
      badgeBg: 'bg-emerald-600',
      container: 'bg-emerald-50 border-emerald-200',
    },
    purple: {
      bg: 'bg-purple-600',
      pixel: 'bg-purple-300',
      badgeBg: 'bg-purple-600',
      container: 'bg-purple-50 border-purple-200',
    },
  };

  const selected = colorMap[color] || colorMap.blue;

  const sizeClasses = {
    sm: {
      box: 'w-8 h-8 rounded-lg',
      pixelSize: 'w-1 h-1',
      badge: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5',
      icon: 'w-2 h-2',
    },
    md: {
      box: 'w-10 h-10 rounded-xl',
      pixelSize: 'w-1.5 h-1.5',
      badge: 'w-4 h-4 -bottom-1 -right-1',
      icon: 'w-2.5 h-2.5',
    },
    lg: {
      box: 'w-13 h-13 rounded-xl',
      pixelSize: 'w-2 h-2',
      badge: 'w-5 h-5 -bottom-1 -right-1',
      icon: 'w-3 h-3',
    },
    xl: {
      box: 'w-16 h-16 rounded-2xl',
      pixelSize: 'w-2.5 h-2.5',
      badge: 'w-6 h-6 -bottom-1.5 -right-1.5',
      icon: 'w-3.5 h-3.5',
    },
  };

  const sc = sizeClasses[size];

  return (
    <div className={`relative inline-flex items-center justify-center shrink-0`}>
      <div
        className={`${sc.box} ${selected.bg} shadow-sm flex items-center justify-center overflow-hidden p-1`}
        title={name}
      >
        {/* Pixel Grid representing robot/voice pattern */}
        <div className="grid grid-cols-5 gap-0.5">
          {pattern.map((row, rIdx) =>
            row.map((active, cIdx) => (
              <div
                key={`${rIdx}-${cIdx}`}
                className={`${sc.pixelSize} rounded-[1px] transition-opacity duration-300 ${
                  active ? 'bg-white opacity-95' : 'bg-white/20'
                }`}
              />
            ))
          )}
        </div>
      </div>

      {showBadge && (
        <div
          className={`absolute ${sc.badge} rounded-full bg-white p-0.5 shadow-sm flex items-center justify-center border border-white`}
        >
          <div className={`w-full h-full rounded-full ${selected.badgeBg} flex items-center justify-center text-white`}>
            <Phone className={`${sc.icon} text-white fill-white`} />
          </div>
        </div>
      )}
    </div>
  );
};
