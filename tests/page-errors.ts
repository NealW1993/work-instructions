/**
 * `next dev` can push a hot-reload refresh while a page is still hydrating (for example when a route
 * compiles on first request), and Next's own dev client then throws "Router action dispatched before
 * initialization". Production builds have no hot reloader, so only errors raised from inside it are
 * ignored; every other page error still fails the test.
 */
export function isDevHotReloadError(error: Error) {
  return /next[\\/]dist[\\/]client[\\/]dev[\\/]hot-reloader[\\/]/.test(error.stack ?? "");
}
