import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount between tests so a component left mounted by one test cannot satisfy another
// test's query and turn a real failure green.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom implements neither of these, and both are used by the exam screen (the question
// palette and the proctoring/fullscreen paths). Without stubs the component throws during
// render and every assertion fails for a reason that has nothing to do with the test.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
