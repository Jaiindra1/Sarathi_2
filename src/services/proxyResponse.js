import { UpstreamError } from "../middleware/errors.js";

export function sendProxyResponse(result, res, config) {
    if (![200, 303, 304, 400, 404, 405, 409, 503].includes(result.status)) throw new UpstreamError();
    for (const name of ["content-type", "cache-control", "etag", "last-modified", "expires", "vary"]) {
        const value = result.headers.get(name);
        if (value) {
            if (value.includes(config.token)) throw new UpstreamError();
            res.set(name, value);
        }
    }
    const location = result.headers.get("location");
    if (location) {
        let target;
        try { target = new URL(location, config.baseUrl); }
        catch { throw new UpstreamError(); }
        if (target.origin !== config.baseUrl || target.href.includes(config.token)) throw new UpstreamError();
        res.set("Location", target.pathname + target.search + target.hash);
    }
    res.status(result.status).send(result.data);
}
