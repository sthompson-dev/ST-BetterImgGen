// ============================================================
// ST-BetterImgGen v1.1.0 — Server Plugin for SillyTavern
//
// This is a SillyTavern server plugin that proxies ComfyUI API
// calls from the browser through the ST server to bypass CORS
// and mixed-content restrictions.
//
// Plugin contract: exports { info, init(router) }
// Loaded by ST's src/plugin-loader.js from ./plugins/
//
// CSRF Bypass Strategy:
//   Cloudflare Zero Trust strips the _csrf cookie, so we can't
//   use ST's authenticated POST routes. The solution is to
//   register our proxy handler directly on the main Express app
//   BEFORE the CSRF middleware applies.
//
//   Discovery flow:
//   1. Plugin starts a Node.js HTTP server on a random port
//      inside the container (PROXY_SERVER)
//   2. The ST router exposes /proxy-port (GET, no CSRF) so the
//      client can discover the standalone proxy port
//   3. For Cloudflare users: the client prefers to use the
//      CSRF-bypassed route registered on the main Express app
//      at /api/plugins/st-betterimgen/proxy-noauth
//   4. Fallback: use the original CSRF-protected route
// ============================================================

const http = require('http');
const express = require('express');

// ============================================================
// Plugin Metadata
// ============================================================
const PLUGIN_INFO = {
    id: 'st-betterimgen',
    name: 'ST-BetterImgGen Proxy',
    description: 'Proxies ComfyUI API calls from the browser through the SillyTavern server.',
};

// ============================================================
// Shared proxy handler (used by both the standalone server and
// the Express app routes)
// ============================================================

/**
 * Handle a proxy request: forward it to ComfyUI and return the response.
 * @param {object} parsedBody - The parsed JSON body from the client
 * @returns {Promise<{status: number, body: object}>}
 */
async function handleProxyRequest(parsedBody) {
    const { endpoint, method, query, body: reqBody, binary } = parsedBody;

    if (!endpoint) {
        return { status: 400, body: { ok: false, error: 'Missing "endpoint" in request body.' } };
    }

    let comfyUrl = parsedBody.comfyuiUrl || '';
    if (!comfyUrl) {
        return { status: 400, body: { ok: false, error: 'Missing "comfyuiUrl" in request body.' } };
    }
    comfyUrl = comfyUrl.replace(/\/+$/, '');

    const targetUrl = new URL(comfyUrl + endpoint);

    if (query && typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
            targetUrl.searchParams.set(key, String(value));
        }
    }

    const fetchOptions = {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json' },
    };

    if (reqBody && ['POST', 'PUT', 'PATCH'].includes((method || 'GET').toUpperCase())) {
        fetchOptions.body = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);

    if (binary) {
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return {
            status: 200,
            body: {
                ok: response.ok,
                status: response.status,
                data: base64,
                contentType: response.headers.get('content-type') || 'application/octet-stream',
            },
        };
    }

    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch {
        data = responseText;
    }

    return {
        status: 200,
        body: { ok: response.ok, status: response.status, data },
    };
}

// ============================================================
// Standalone Proxy Server (for non-Cloudflare setups)
// ============================================================

let proxyServer = null;
let proxyPort = 0;

function startStandaloneProxy() {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method !== 'POST' || req.url !== '/proxy') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Not found. Use POST /proxy' }));
                return;
            }

            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body);
                    const result = await handleProxyRequest(parsed);
                    res.writeHead(result.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result.body));
                } catch (err) {
                    console.error('[BetterImgGen:StandaloneProxy] Error:', err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: err.message || 'Proxy error' }));
                }
            });
        });

        server.listen(0, '0.0.0.0', () => {
            proxyPort = server.address().port;
            proxyServer = server;
            console.log(`[ST-BetterImgGen] Standalone proxy server listening on port ${proxyPort}`);
            resolve();
        });

        server.on('error', (err) => {
            console.error('[ST-BetterImgGen] Standalone proxy server error:', err.message);
            reject(err);
        });
    });
}

// ============================================================
// Plugin Initialisation
// ============================================================
function init(router) {
    try {
        console.log('[ST-BetterImgGen] Plugin initialising...');

        // ── Start standalone proxy server ──────────────────
        startStandaloneProxy().catch(err => {
            console.error('[ST-BetterImgGen] Standalone proxy failed:', err.message);
        });

        // ── Try to register CSRF-bypassed routes on main app ──
        // This is needed when using Cloudflare Zero Trust which
        // strips the _csrf cookie. We attempt to get ST's main
        // Express app and register our route directly.
        try {
            // When loaded as a plugin from ./plugins/, we're at
            // /home/node/app/plugins/st-betterimgen.cjs
            // ST's main app is at /home/node/app/index.js
            // which exports app via /home/node/app/src/app.js
            // Try different require paths relative to plugins dir
            const stIndex = require.resolve('../../index.js', { paths: [__dirname] });
            const stMain = require(stIndex);

            // If we got the main app instance (the Express app)
            if (stMain && stMain.app) {
                const app = stMain.app;

                // Register a wildcard middleware on app BEFORE
                // the requireLoginMiddleware catches our requests.
                // We use app.use() with the specific path prefix.
                app.use('/api/plugins/st-betterimgen/proxy-noauth', async (req, res) => {
                    try {
                        const parsed = req.body || {};
                        // For GET requests with query params (JSON-encoded body)
                        if (req.method === 'GET' && req.query.payload) {
                            const parsedBody = JSON.parse(req.query.payload);
                            const result = await handleProxyRequest(parsedBody);
                            return res.status(result.status).json(result.body);
                        }
                        // For POST requests (normal flow)
                        if (req.method === 'POST') {
                            const result = await handleProxyRequest(parsed);
                            return res.status(result.status).json(result.body);
                        }
                        res.status(405).json({ ok: false, error: 'Method not allowed' });
                    } catch (err) {
                        console.error('[BetterImgGen:NoAuth] Error:', err);
                        res.status(500).json({ ok: false, error: err.message || 'Proxy error' });
                    }
                });

                console.log('[ST-BetterImgGen] Registered CSRF-bypassed route on main app');
            }
        } catch (err) {
            console.log('[ST-BetterImgGen] Could not register CSRF-bypassed route:', err.message);
            console.log('[ST-BetterImgGen] This is expected if ST core structure is different.');
        }

        // ── Proxy port discovery endpoint (GET, no CSRF) ──
        router.get('/proxy-port', (req, res) => {
            if (proxyPort === 0) {
                return res.status(503).json({ ok: false, error: 'Standalone proxy not ready yet.' });
            }
            res.json({ ok: true, port: proxyPort });
        });

        // ── GET-based proxy endpoint (no CSRF on GET) ─────
        // All request data is encoded in query parameter 'payload'
        router.get('/proxy', async (req, res) => {
            try {
                const payloadJson = req.query.payload;
                if (!payloadJson) {
                    return res.status(400).json({ ok: false, error: 'Missing "payload" query parameter.' });
                }
                const parsed = JSON.parse(payloadJson);
                const result = await handleProxyRequest(parsed);
                return res.status(result.status).json(result.body);
            } catch (err) {
                console.error('[BetterImgGen:ProxyGET] Error:', err);
                res.status(500).json({ ok: false, error: err.message || 'Proxy error' });
            }
        });

        // ── POST-based proxy endpoint (CSRF-protected) ────
        // This is the fallback when CSRF works (no Cloudflare)
        router.all('/proxy', async (req, res) => {
            try {
                const parsed = req.body;
                const result = await handleProxyRequest(parsed);
                return res.status(result.status).json(result.body);
            } catch (err) {
                console.error('[BetterImgGen:ProxyPOST] Error forwarding request:', err);
                res.status(500).json({
                    ok: false,
                    error: err.message || 'Proxy error',
                });
            }
        });

        /**
         * Health check endpoint.
         */
        router.get('/status', (req, res) => {
            console.log('[ST-BetterImgGen] Status endpoint called');
            res.json({
                ok: true,
                name: 'ST-BetterImgGen',
                version: '1.1.0',
                proxyPort: proxyPort,
                proxyReady: proxyPort > 0,
            });
        });

        console.log(`[ST-BetterImgGen] Plugin loaded — router at /api/plugins/st-betterimgen`);
        console.log(`[ST-BetterImgGen] Standalone proxy port: ${proxyPort || 'starting...'}`);
    } catch (err) {
        console.error('[ST-BetterImgGen] Plugin FAILED to load:', err.message);
        console.error(err.stack);
        throw err;
    }
}

// ============================================================
// Exports — ST plugin contract
// ============================================================
module.exports = {
    info: PLUGIN_INFO,
    init: init,
};