export function loadConfig(env = process.env) {
    const port = Number(env.PORT ?? 3000);
    const rawPort = String(env.PORT ?? 3000);
    if (!/^[0-9]+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer from 1 to 65535.");
    }
    const token = env.SCRAPER_SERVICE_TOKEN ?? "";
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
        throw new Error("SCRAPER_SERVICE_TOKEN must contain 32-256 URL-safe characters.");
    }
    let base;
    try { base = new URL(env.SCRAPER_SERVICE_URL); }
    catch { throw new Error("SCRAPER_SERVICE_URL must be an absolute HTTP service URL."); }
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password ||
        base.search || base.hash || base.pathname !== "/") {
        throw new Error("SCRAPER_SERVICE_URL must have an HTTP origin without credentials, path, query or fragment.");
    }
    if (["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) &&
        Number(base.port || (base.protocol === "https:" ? 443 : 80)) === port) {
        throw new Error("Express and Python must use different local ports.");
    }
    const rawTimeout = String(env.SCRAPER_REQUEST_TIMEOUT_MS ?? 20000);
    const timeoutMs = Number(rawTimeout);
    if (!/^[0-9]+$/.test(rawTimeout) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
        throw new Error("SCRAPER_REQUEST_TIMEOUT_MS must be between 1 and 120000.");
    }
    return Object.freeze({ port, token, baseUrl: base.origin, timeoutMs });
}
