import '@testing-library/jest-dom/vitest';

// VexFlow measures text via canvas; stub for jsdom unit tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
HTMLCanvasElement.prototype.getContext = (() =>
  ({
    measureText: () => ({ width: 10 }),
    fillText: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    translate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
  })) as typeof HTMLCanvasElement.prototype.getContext;
