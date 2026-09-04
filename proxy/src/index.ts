// Transparent reverse proxy + site-wide password gate.
//
// standingorders.lucaswalker.net -> the GitHub Pages project site (which only
// serves under /standing-orders/, per the repo name). API calls still go
// straight to api.standingorders.lucaswalker.net, never through this proxy.
//
// Nothing — not even the create-game form — is reachable without first
// posting the correct password to /__gate. That sets a cookie (a hash of the
// password, not the password itself) which every subsequent request checks.
// Stateless: no KV/session store, just a deterministic hash recomputed per
// request. Configure with `wrangler secret put SITE_PASSWORD` (same value as
// the API worker's, so there's one password to remember).

export interface Env {
  SITE_PASSWORD?: string;
}

const UPSTREAM_HOST = 'sen2008.github.io';
const UPSTREAM_PREFIX = '/standing-orders';
const COOKIE_NAME = 'so_gate';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function gateToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`standing-orders-gate:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Standing Orders</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:system-ui,sans-serif;background:#16181d;color:#e6e6e6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
form{background:#1f232b;border:1px solid #333944;border-radius:8px;padding:2rem;max-width:320px;width:100%;box-sizing:border-box}
input{width:100%;padding:.5rem;margin:.5rem 0 1rem;border-radius:4px;border:1px solid #333944;background:#0f1116;color:#e6e6e6;box-sizing:border-box;font-size:1rem}
button{width:100%;padding:.5rem;border-radius:6px;border:1px solid #4c8bf5;background:#4c8bf5;color:#fff;cursor:pointer;font-size:1rem}
.error{color:#ff6b6b;font-size:.85rem;margin:-.5rem 0 1rem}
h1{margin-top:0;font-size:1.2rem}
label{display:block;font-size:.9rem}
</style></head>
<body>
<form method="POST" action="/__gate">
<h1>Standing Orders</h1>
${error ? `<div class="error">${error}</div>` : ''}
<label>Password<input type="password" name="password" autofocus /></label>
<button type="submit">Enter</button>
</form>
</body></html>`;
}

function loginResponse(status: number, error?: string): Response {
  return new Response(loginPage(error), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/__gate') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!env.SITE_PASSWORD) return loginResponse(500, 'Site password is not configured.');
      const form = await request.formData().catch(() => null);
      const password = String(form?.get('password') ?? '');
      if (password !== env.SITE_PASSWORD) return loginResponse(401, 'Wrong password.');

      const token = await gateToken(env.SITE_PASSWORD);
      const headers = new Headers({ Location: '/' });
      headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const expected = env.SITE_PASSWORD ? await gateToken(env.SITE_PASSWORD) : null;
    if (!expected || getCookie(request, COOKIE_NAME) !== expected) {
      return loginResponse(401);
    }

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
