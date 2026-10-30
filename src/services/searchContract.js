import { UpstreamError } from "../middleware/errors.js";

const states = new Set(["queued", "running", "completed", "failed"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const string = value => typeof value === "string";
const integer = value => Number.isInteger(value) && value >= 0;

// Match Python str.strip and code-point length; forward the original string.
export const stripQuery = value => value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, "");

export function validateSubmission(body) {
    if (!object(body) || !string(body.query) || !stripQuery(body.query)) return "Please enter a product name.";
    if (Array.from(stripQuery(body.query)).length > 200) return "Please keep the product name to 200 characters or fewer.";
    if (!string(body.request_id) || !/^[0-9a-f]{32}$/.test(body.request_id)) {
        return "A valid client request ID (32 lowercase hexadecimal characters) is required.";
    }
    return null;
}

function persistence(value) {
    if (!object(value)) return false;
    if (!Object.keys(value).length) return true;
    if (value.status === "pending") return exactKeys(value, ["status"]);
    return ["saved", "partial", "failed"].includes(value.status) && string(value.search_id) &&
        integer(value.saved_count) && (value.warning === undefined || string(value.warning)) &&
        Object.keys(value).every(key => ["status", "search_id", "saved_count", "warning"].includes(key));
}

function retailers(value) {
    return exactKeys(value, ["Flipkart", "Amazon"]) && Object.values(value).every(outcome => {
        if (!object(outcome)) return false;
        if (["queued", "running"].includes(outcome.status)) return exactKeys(outcome, ["status"]);
        if (["completed", "empty"].includes(outcome.status)) return exactKeys(outcome, ["status", "count"]) && integer(outcome.count);
        return outcome.status === "failed" && exactKeys(outcome, ["status", "stage"]) && string(outcome.stage);
    });
}

function product(value) {
    const keys = ["name", "price", "original_price", "rating", "url", "image_url",
        "retailer", "category", "specifications", "highlights", "availability"];
    if (!exactKeys(value, keys) || !string(value.name) || !string(value.retailer) ||
        !string(value.category) || !object(value.specifications) ||
        !Array.isArray(value.highlights) || !value.highlights.every(string)) return false;
    const nullableText = key => value[key] === null || string(value[key]);
    const price = key => value[key] === null || string(value[key]) ||
        (typeof value[key] === "number" && Number.isFinite(value[key]));
    return ["url", "image_url", "availability"].every(nullableText) &&
        ["price", "original_price", "rating"].every(price);
}

export function validateResponse(status, body, kind, expectedId) {
    let valid = false;
    if (kind === "submission") {
        if (status === 202) {
            valid = exactKeys(body, ["success", "job_id", "status", "status_url", "results_url"]) &&
                body.success === true && /^[0-9a-f]{32}$/.test(body.job_id) && states.has(body.status) &&
                body.status_url === "/api/search/" + body.job_id + "/status" &&
                body.results_url === "/api/search/" + body.job_id + "/results";
        } else if ([400, 409, 503].includes(status)) {
            valid = exactKeys(body, ["success", "message", "products"]) && body.success === false &&
                string(body.message) && Array.isArray(body.products) && body.products.length === 0;
        }
    } else if (status === 404) {
        valid = exactKeys(body, ["success", "message"]) && body.success === false && string(body.message);
    } else if (status === 200 || (kind === "results" && status === 202)) {
        const keys = ["success", "job_id", "query", "status", "message", "persistence", "retailers"];
        if (kind === "results") keys.push("products");
        valid = exactKeys(body, keys) && body.job_id === expectedId && string(body.query) &&
            states.has(body.status) && body.success === (body.status !== "failed") &&
            string(body.message) && persistence(body.persistence) && retailers(body.retailers);
        if (kind === "results") {
            valid = valid && Array.isArray(body.products) && body.products.every(product) &&
                (status === 202) === ["queued", "running"].includes(body.status);
        }
    }
    if (!valid) throw new UpstreamError();
    return body;
}
