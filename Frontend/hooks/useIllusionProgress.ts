'use client'

import { useState, useEffect } from "react";

export function useIllusionProgress(active: boolean) {
    const [progress, setProgress] = useState(12);
    const [show, setShow] = useState(active);
  
    useEffect(() => {
      if (!active) {
        setProgress(100);
        const timeout = setTimeout(() => setShow(false), 180);
        return () => clearTimeout(timeout);
      }
  
      setShow(true);
      setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));
  
      const id = setInterval(() => {
        setProgress((prev) => {
          const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
          if (shouldHold) return prev; // create a brief stall so progress looks more natural
          const increment = Math.max(1, Math.round(Math.random() * 7));
          return Math.min(prev + increment, 93);
        });
      }, 420 + Math.round(Math.random() * 240));
  
      return () => clearInterval(id);
    }, [active]);
  
    return { progress: Math.min(progress, 100), show };
  }