export class UpstreamError extends Error {
    constructor(timeout = false) {
        super(timeout
            ? "Search service took too long to respond. Your search may still be running; reload to reconnect."
            : "Search service is unavailable. Please try again shortly.");
        this.httpStatus = timeout ? 504 : 502;
    }
}

export function errorHandler(error, req, res, next) {
    if (res.headersSent) { res.end(); return; }
    const invalidJson = error?.type === "entity.parse.failed";
    const tooLarge = error?.type === "entity.too.large";
    const status = error instanceof UpstreamError ? error.httpStatus : invalidJson ? 400 : tooLarge ? 413 : 500;
    const message = error instanceof UpstreamError ? error.message : invalidJson
        ? "Please enter a product name." : tooLarge ? "Request is too large."
            : "Unable to complete request. Please try again later.";
    res.set("Cache-Control", "no-store").status(status).json({ success: false, message, products: [] });
}
