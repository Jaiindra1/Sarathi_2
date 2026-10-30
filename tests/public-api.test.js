import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import { createPythonScraperClient } from "../src/clients/pythonScraperClient.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/api-contract.json", import.meta.url)));
const token = "test_service_token_".repeat(4);
const jobId = "1".repeat(32);
const ready = { status: "ready", checks: { database: true, browser_configuration: true, accepting: true } };
async function listen(server) {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return "http://127.0.0.1:" + server.address().port;
}
async function close(server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
async function setup(t, handler, timeoutMs = 1000) {
    const requests = [];
    const upstream = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
        await handler(req, res, requests.at(-1));
    });
    const baseUrl = await listen(upstream);
    const config = loadConfig({ PORT: "3000", SCRAPER_SERVICE_URL: baseUrl, SCRAPER_SERVICE_TOKEN: token,
                                SCRAPER_REQUEST_TIMEOUT_MS: String(timeoutMs) });
    const server = http.createServer(createApp(config));
    const url = await listen(server);
    t.after(async () => { await close(server); await close(upstream); });
    return { url, requests, config };
}
function sendFixture(res, name) {
    const fixture = fixtures[name];
    res.writeHead(fixture.status, { "Content-Type": "application/json",
        ...(fixture.cache_control ? { "Cache-Control": fixture.cache_control } : {}) });
    res.end(JSON.stringify(fixture.json));
}
async function post(url, body) {
    return fetch(url + "/api/search", { method: "POST", headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify(body) });
}

test("submission matches baseline and forwards original query/request ID with service auth", async t => {
    const { url, requests } = await setup(t, (req, res) => sendFixture(res, "submission"));
    const body = { query: " baseline phone ", request_id: "a".repeat(32) };
    const response = await post(url, body);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), fixtures.submission.json);
    assert.deepEqual(JSON.parse(requests[0].body), body);
    assert.equal(requests[0].headers.authorization, "Bearer " + token);
    assert.equal(requests[0].url, "/internal/v1/search");
});
test("invalid query, body, IDs and excessive query length do not reach Python", async t => {
    const { url, requests } = await setup(t, () => assert.fail("Unexpected upstream call"));
    for (const body of [{}, [], null, { query: 5 }, { query: " " },
        { query: "phone", request_id: "bad" }, { query: "x".repeat(201), request_id: "a".repeat(32) }]) {
        assert.equal((await post(url, body)).status, 400);
    }
    assert.equal(requests.length, 0);
});
test("malformed browser JSON preserves invalid-query 400 behavior", async t => {
    const { url } = await setup(t, () => assert.fail("Unexpected upstream call"));
    const response = await fetch(url + "/api/search", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), fixtures.invalid_query.json);
});
for (const fixtureName of ["busy", "request_conflict", "invalid_request_id"]) {
    test("preserves Python error contract: " + fixtureName, async t => {
        const { url } = await setup(t, (req, res) => sendFixture(res, fixtureName));
        const response = await post(url, { query: "phone", request_id: "a".repeat(32) });
        assert.equal(response.status, fixtures[fixtureName].status);
        assert.deepEqual(await response.json(), fixtures[fixtureName].json);
    });
}
test("duplicate submissions preserve the same ID and Express never retries a request", async t => {
    const { url, requests } = await setup(t, (req, res) => sendFixture(res, "submission"));
    const body = { query: "phone", request_id: "a".repeat(32) };
    const first = await post(url, body);
    const second = await post(url, body);
    assert.equal((await first.json()).job_id, (await second.json()).job_id);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(request => JSON.parse(request.body).request_id), [body.request_id, body.request_id]);
});
for (const [fixtureName, path] of [
    ["queued_status", "status"], ["completed_status", "status"], ["unfinished_results", "results"],
    ["completed_results", "results"], ["failed_results", "results"], ["missing_job", "status"],
]) {
    test("status/results golden contract: " + fixtureName, async t => {
        const { url, requests } = await setup(t, (req, res) => sendFixture(res, fixtureName));
        const response = await fetch(url + "/api/search/" + jobId + "/" + path);
        assert.equal(response.status, fixtures[fixtureName].status);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), fixtures[fixtureName].json);
        assert.equal(requests[0].url, "/internal/v1/search/" + jobId + "/" + path);
    });
}
test("persistence warnings and all product fields pass through without rewriting", async t => {
    const payload = structuredClone(fixtures.completed_results.json);
    payload.persistence = { status: "partial", search_id: jobId, saved_count: 1, warning: "SQLite saving did not fully complete." };
    const { url } = await setup(t, (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload));
    });
    assert.deepEqual(await (await fetch(url + "/api/search/" + jobId + "/results")).json(), payload);
});
test("connection refused becomes safe 502, not a new submission", async t => {
    const closed = http.createServer();
    const baseUrl = await listen(closed); await close(closed);
    const server = http.createServer(createApp(loadConfig({ PORT: "3000", SCRAPER_SERVICE_URL: baseUrl,
        SCRAPER_SERVICE_TOKEN: token })));
    const url = await listen(server); t.after(() => close(server));
    const response = await post(url, { query: "phone", request_id: "a".repeat(32) });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).success, false);
});
test("upstream timeout becomes 504 with no automatic resubmission", async t => {
    const { url, requests } = await setup(t, async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 100)); sendFixture(res, "submission");
    }, 20);
    const response = await post(url, { query: "phone", request_id: "a".repeat(32) });
    assert.equal(response.status, 504);
    assert.equal(requests.length, 1);
});
for (const failure of ["invalid-json", "wrong-http", "missing-field", "wrong-fields", "auth-failure", "secret"]) {
    test("safe upstream protocol rejection: " + failure, async t => {
        const { url } = await setup(t, (req, res) => {
            const payload = structuredClone(fixtures.submission.json);
            let status = 202;
            if (failure === "wrong-http") status = 418;
            if (failure === "auth-failure") status = 401;
            if (failure === "missing-field") delete payload.job_id;
            if (failure === "wrong-fields") payload.status = "invented";
            if (failure === "secret") payload.status_url = token;
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(failure === "invalid-json" ? "not JSON" : JSON.stringify(payload));
        });
        const response = await post(url, { query: "phone", request_id: "a".repeat(32) });
        assert.equal(response.status, 502);
        assert(!(await response.text()).includes(token));
    });
}
test("health is local; readiness checks Python without scraping", async t => {
    const { url, requests } = await setup(t, (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(ready));
    });
    assert.deepEqual(await (await fetch(url + "/healthz")).json(), { status: "ok" });
    assert.equal(requests.length, 0);
    assert.deepEqual(await (await fetch(url + "/readyz")).json(), ready);
    assert.equal(requests[0].url, "/readyz");
});
test("readiness failure is safe and does not expose upstream details", async t => {
    const { url } = await setup(t, (req, res) => { res.writeHead(500); res.end(token); });
    const response = await fetch(url + "/readyz");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
});
test("homepage, job bootstrap, feedback and static assets are proxied unchanged", async t => {
    const { url, requests } = await setup(t, (req, res) => {
        res.writeHead(200, { "Content-Type": req.url.startsWith("/static") ? "text/javascript" : "text/html" });
        res.end(req.url.startsWith("/static") ? "const safe = true;" : '<div data-job-id="' + jobId + '">&lt;escaped&gt;</div>');
    });
    for (const path of ["/?job=" + jobId, "/feedback", "/static/js/search.js"]) {
        const response = await fetch(url + path);
        assert.equal(response.status, 200);
        const body = await response.text();
        assert(body.includes(path.startsWith("/static") ? "const safe = true;" : "&lt;escaped&gt;"));
        assert(!body.includes(token));
    }
    assert.equal(requests.length, 3);
});
test("form POST fields, honeypot and redirect remain unchanged and same-origin", async t => {
    const { url, requests, config } = await setup(t, (req, res) => {
        res.writeHead(303, { Location: "http://127.0.0.1:" + req.socket.localPort + "/?job=" + jobId }); res.end();
    });
    for (const path of ["/", "/feedback"]) {
        const body = "name=Tester&email=test%40example.com&category=Bug+report&rating=5&feature=&subject=Hello&message=Text&website=&query=phone";
        const response = await fetch(url + path, { method: "POST", redirect: "manual",
            headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), "/?job=" + jobId);
        assert.equal(requests.at(-1).body, body);
    }
});
test("static conditional response preserves 304 and cache headers", async t => {
    const { url, requests } = await setup(t, (req, res) => {
        res.writeHead(304, { ETag: '"asset"', "Cache-Control": "public, max-age=0" }); res.end();
    });
    const response = await fetch(url + "/static/js/search.js", { headers: { "If-None-Match": '"asset"' } });
    assert.equal(response.status, 304);
    assert.equal(response.headers.get("etag"), '"asset"');
    assert.equal(requests[0].headers["if-none-match"], '"asset"');
});
test("external redirects are rejected instead of exposing an internal credential", async t => {
    const { url } = await setup(t, (req, res) => {
        res.writeHead(303, { Location: "https://untrusted.example/" }); res.end();
    });
    const response = await fetch(url + "/", { redirect: "manual" });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("location"), null);
});
test("client cannot use a user-supplied URL as an upstream destination", async () => {
    let called = false;
    const client = createPythonScraperClient({ baseUrl: "http://127.0.0.1:5000", token, timeoutMs: 100 },
        () => { called = true; });
    await assert.rejects(client.page("https://untrusted.example/"));
    await assert.rejects(client.page("//untrusted.example/"));
    assert.equal(called, false);
});
test("internal URLs are not public Express routes", async t => {
    const { url, requests } = await setup(t, () => assert.fail("Unexpected upstream call"));
    assert.equal((await fetch(url + "/internal/v1/search")).status, 404);
    assert.equal(requests.length, 0);
});
test("startup configuration rejects missing secrets, unsafe URLs and invalid limits", () => {
    const valid = { PORT: "3000", SCRAPER_SERVICE_URL: "http://127.0.0.1:5000", SCRAPER_SERVICE_TOKEN: token };
    assert.equal(loadConfig(valid).port, 3000);
    for (const changed of [{ SCRAPER_SERVICE_TOKEN: "" }, { PORT: "bad" }, { PORT: "0" },
        { SCRAPER_SERVICE_URL: "http://user:password@host" }, { SCRAPER_SERVICE_URL: "file:///tmp" },
        { SCRAPER_SERVICE_URL: "http://host/path" }, { SCRAPER_SERVICE_URL: "http://localhost:3000" },
        { SCRAPER_REQUEST_TIMEOUT_MS: "-1" }]) {
        assert.throws(() => loadConfig({ ...valid, ...changed }));
    }
});


test("Python submission 503 remains a submission error, not a gateway rewrite", async t => {
    const body = { success: false, message: "Unable to start search. Please try again later.", products: [] };
    const { url, requests } = await setup(t, (req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify(body));
    });
    const response = await post(url, { query: "phone", request_id: "a".repeat(32) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), body);
    assert.equal(requests.length, 1);
});

test("valid Python readiness 503 is preserved without starting any job", async t => {
    const unavailable = { status: "unavailable", checks: { database: false, browser_configuration: true, accepting: true } };
    const { url, requests } = await setup(t, (req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify(unavailable));
    });
    const response = await fetch(url + "/readyz");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), unavailable);
    assert.deepEqual(requests.map(request => request.url), ["/readyz"]);
});
