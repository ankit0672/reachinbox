// Rate-limit windows are epoch-aligned: window n covers [n*W, (n+1)*W).
// With W = 1h this is exactly the UTC hour. The Lua counter keys and the
// pre-pack SQL both use this same math, so they always agree on "which hour".

export const windowOf = (ms: number, windowMs: number): number => Math.floor(ms / windowMs);
export const windowStart = (window: number, windowMs: number): number => window * windowMs;
