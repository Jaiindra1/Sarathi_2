import { sendProxyResponse } from "../services/proxyResponse.js";

export function pagesController(client, config) {
    return async function proxyPage(req, res) {
        const headers = {};
        for (const name of ["content-type", "if-none-match", "if-modified-since", "accept"]) {
            if (req.headers[name]) headers[name] = req.headers[name];
        }
        const result = await client.page(req.originalUrl, {
            method: req.method, headers,
            body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
        });
        sendProxyResponse(result, res, config);
    };
}
