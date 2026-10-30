import { validateSubmission } from "../services/searchContract.js";

export function searchController(client) {
    return {
        async submit(req, res) {
            const error = validateSubmission(req.body);
            if (error) return res.status(400).json({ success: false, message: error, products: [] });
            // Forward the original values. Python remains the idempotency authority.
            const result = await client.submit({ query: req.body.query, request_id: req.body.request_id });
            if (result.status === 202) {
                result.data.status_url = "/api/search/" + result.data.job_id + "/status";
                result.data.results_url = "/api/search/" + result.data.job_id + "/results";
            }
            return res.status(result.status).json(result.data);
        },
        async status(req, res) {
            const result = await client.status(req.params.job_id);
            res.set("Cache-Control", "no-store").status(result.status).json(result.data);
        },
        async results(req, res) {
            const result = await client.results(req.params.job_id);
            res.set("Cache-Control", "no-store").status(result.status).json(result.data);
        },
    };
}
