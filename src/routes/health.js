import { Router } from "express";

export function healthRoutes(client) {
    const router = Router();
    router.get("/healthz", (req, res) => res.json({ status: "ok" }));
    router.get("/readyz", async (req, res) => {
        try {
            const result = await client.readiness();
            res.set("Cache-Control", "no-store").status(result.status).json(result.data);
        } catch {
            res.set("Cache-Control", "no-store").status(503).json({ status: "unavailable" });
        }
    });
    return router;
}
