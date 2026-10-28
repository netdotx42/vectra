/* Set SCHEDULER_API_URL to the Worker origin before this file loads, or edit the
 * assignment below. Leave it empty to keep the local-only schedule fallback.
 * Also add that https origin to connect-src in dist/index.html.
 * Example: https://vectra-scheduler.<account>.workers.dev
 */
(function () {
  if (typeof globalThis.SCHEDULER_API_URL !== 'string') globalThis.SCHEDULER_API_URL = '';
})();
