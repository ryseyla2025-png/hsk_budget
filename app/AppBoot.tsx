'use client';

import { useEffect } from 'react';

/** Starts the ported vanilla-JS UI once the static shell is in the DOM. */
export default function AppBoot() {
  useEffect(() => {
    import('./legacy-ui.js').then((m) => m.start());
  }, []);
  return null;
}
