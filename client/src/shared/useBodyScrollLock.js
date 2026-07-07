import { useEffect } from 'react';

// Locks background page scrolling while a modal/overlay is open.
// Ref-counted so nested modals (e.g. WorkHub -> QR) don't unlock early.
let lockCount = 0;

export default function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    const body = document.body;
    if (lockCount === 1) {
      body.dataset.prevOverflow = body.style.overflow || '';
      body.style.overflow = 'hidden';
    }
    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        body.style.overflow = body.dataset.prevOverflow || '';
        delete body.dataset.prevOverflow;
      }
    };
  }, [active]);
}
