import { simulate } from './simulation-core.js';

self.onmessage = (event) => {
  if (event.data?.type !== 'simulate') return;
  try {
    const result = simulate(event.data.parameters, (fraction, message) => {
      self.postMessage({ type: 'progress', fraction, message });
    });
    const buffers = Object.values(result.arrays).map((array) => array.buffer);
    self.postMessage({ type: 'result', result }, buffers);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

