import { UpstreamError } from "../middleware/errors.js";
import { validateResponse } from "../services/searchContract.js";

export function createPythonScraperClient(config, fetchImpl = fetch) {
    async function request(path, { method = "GET", body, headers = {} } = {}) {
        const url = new URL(path, config.baseUrl);
        if (!path.startsWith("/") || path.startsWith("//") || url.origin !== config.baseUrl) throw new UpstreamError();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
            const response = await fetchImpl(url, {
                method, body, redirect: "manual", signal: controller.signal,
                headers: { ...headers, Authorization: "Bearer " + config.token },
            });
            if (response.headers.get("content-length") &&
                Number(response.headers.get("content-length")) > 5 * 1024 * 1024) throw new UpstreamError();
            const chunks = [];
            let size = 0;
            if (response.body) {
                for await (const chunk of response.body) {
                    size += chunk.length;
                    if (size > 5 * 1024 * 1024) { controller.abort(); throw new UpstreamError(); }
                    chunks.push(Buffer.from(chunk));
                }
            }
            const data = Buffer.concat(chunks);
            if (data.includes(Buffer.from(config.token))) throw new UpstreamError();
            return { status: response.status, headers: response.headers, data };
        } catch (error) {
            if (error instanceof UpstreamError) throw error;
            throw new UpstreamError(controller.signal.aborted);
        } finally { clearTimeout(timer); }
    }

    async function json(path, options, kind, jobId) {
        const response = await request(path, options);
        if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new UpstreamError();
        let data;
        try { data = JSON.parse(response.data.toString("utf8")); }
        catch { throw new UpstreamError(); }
        if (JSON.stringify(data).includes(config.token)) throw new UpstreamError();
        validateResponse(response.status, data, kind, jobId);
        return { status: response.status, data };
    }

    return {
        submit: body => json("/internal/v1/search", {
            method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
        }, "submission"),
        status: id => json("/internal/v1/search/" + encodeURIComponent(id) + "/status", {}, "status", id),
        results: id => json("/internal/v1/search/" + encodeURIComponent(id) + "/results", {}, "results", id),
        page: request,
        async readiness() {
            const response = await request("/readyz");
            let data;
            try { data = JSON.parse(response.data.toString("utf8")); }
            catch { throw new UpstreamError(); }
            const checks = data?.checks;
            if (![200, 503].includes(response.status) ||
                !["ready", "unavailable"].includes(data?.status) || !checks ||
                !["database", "browser_configuration", "accepting"].every(key => typeof checks[key] === "boolean") ||
                (response.status === 200) !== (data.status === "ready") ||
                (response.status === 200) !== Object.values(checks).every(value => value === true)) throw new UpstreamError();
            return { status: response.status, data };
        },
    };
}
