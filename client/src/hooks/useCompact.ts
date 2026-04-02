import { useState, useEffect } from 'react';

// Compact mode: landscape phone (height < 500px)
export function useCompact(): boolean {
  const [compact, setCompact] = useState(window.innerHeight < 500);
  useEffect(() => {
    const handler = () => setCompact(window.innerHeight < 500);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return compact;
}
