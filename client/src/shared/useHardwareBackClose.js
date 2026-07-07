import { useEffect, useRef } from 'react';

// Registers an overlay with the global hardware-back stack (see index.js).
// While `active` is true the phone's back button closes this overlay instead
// of navigating/exiting. Push/pop happen only on open/close transitions —
// re-renders never touch the history stack.
export default function useHardwareBackClose(active, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active || typeof window === 'undefined' || !window.pushBackHandler) return;
    const close = () => { if (closeRef.current) closeRef.current(); };
    window.pushBackHandler(close);
    return () => window.popBackHandler(close);
  }, [active]);
}
