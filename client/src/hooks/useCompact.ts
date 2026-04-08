import { useState, useEffect } from 'react';

// Compact mode: the shorter screen dimension < 500px (works in both landscape and CSS-rotated portrait)
const isCompact = () => Math.min(window.innerWidth, window.innerHeight) < 500;

export function useCompact(): boolean {
  const [compact, setCompact] = useState(isCompact);
  useEffect(() => {
    const handler = () => setCompact(isCompact());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return compact;
}
