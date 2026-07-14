// ============================================================
// ST-BetterImgGen v1.0.2 — Server-Side Proxy Module
// 
// Routes all ComfyUI requests through SillyTavern's server
// to bypass CORS and mixed-content restrictions when
// SillyTavern is served over HTTPS and ComfyUI is HTTP.
// ============================================================

const express = require('express');
const router = express.Router();

/**
 * Generic proxy endpoint.
 * Forwards any request to the configured ComfyUI URL and returns the response.
 *
 * Request body format:
 * {
 *   "endpoint": "/object_info",           // The path on the ComfyUI server
 *   "method": "GET",                      // HTTP method (default GET)
 *   "query": { "param": "value" },        // Query string params (optional)
 *   "body": { ... }                       // JSON body for POST/PUT (optional)
 * }
 *
 * Response format:
 * {
 *   "ok": true,
 *   "status": 200,
 *   "data": { ... }    // The parsed JSON response from ComfyUI
 * }
 * OR on error:
 * {
 *   "ok": false,
 *   "status": <status>,
 *   "error": "message"
 * }
 */
router.all('/proxy', async (req, res) => {
    try {
        const { endpoint, method, query, body, binary } = req.body;

        if (!endpoint) {
            return res.status(400).json({ ok: false, error: 'Missing "endpoint" in request body.' });
        }

        // Build the full URL to ComfyUI
        // Read the comfyuiUrl from the request body (sent by the client from settings)
        // This avoids having to read SillyTavern's extension_settings on the server
        let comfyUrl = req.body.comfyuiUrl || '';

        // Ensure we have a URL
        if (!comfyUrl) {
            return res.status(400).json({ ok: false, error: 'Missing "comfyuiUrl" in request body.' });
        }

        // Normalise: remove trailing slash
        comfyUrl = comfyUrl.replace(/\/+$/, '');

        // Build the target URL
        const targetUrl = new URL(comfyUrl + endpoint);

        // Add query params if provided
        if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
                targetUrl.searchParams.set(key, String(value));
            }
        }

        // Prepare fetch options
        const fetchOptions = {
            method: method || 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        };

        // Add body for POST/PUT/PATCH
        if (body && ['POST', 'PUT', 'PATCH'].includes((method || 'GET').toUpperCase())) {
            fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        // Make the request to ComfyUI
        const response = await fetch(targetUrl.toString(), fetchOptions);

        // Handle binary responses (e.g. image data via /view)
        if (binary) {
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            return res.json({
                ok: response.ok,
                status: response.status,
                data: base64,
                contentType: response.headers.get('content-type') || 'application/octet-stream',
            });
        }

        // Handle text/JSON responses
        const responseText = await response.text();

        // Try to parse as JSON
        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            data = responseText;
        }

        // Return the response
        res.json({
            ok: response.ok,
            status: response.status,
            data: data,
        });
    } catch (err) {
        console.error('[BetterImgGen:Proxy] Error forwarding request:', err);
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
    res.json({ ok: true, name: 'ST-BetterImgGen', version: '1.0.2' });
});

module.exports = router;