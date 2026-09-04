// Transparent reverse proxy: standingorders.lucaswalker.net -> the GitHub Pages
// project site (which only serves under /standing-orders/, per its repo name).
// GET/HEAD-only — the frontend's actual API calls go straight to
// api.standingorders.lucaswalker.net, never through this proxy.

const UPSTREAM_HOST = 'sen2008.github.io';
const UPSTREAM_PREFIX = '/standing-orders';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    let path = url.pathname;
    if (path === '/') path = `${UPSTREAM_PREFIX}/`;
    else if (!path.startsWith(UPSTREAM_PREFIX)) path = `${UPSTREAM_PREFIX}${path}`;

    const upstream = await fetch(`https://${UPSTREAM_HOST}${path}${url.search}`, {
      method: request.method,
      cf: { cacheTtl: 60 },
    });

    return new Response(upstream.body, upstream);
  },
};
