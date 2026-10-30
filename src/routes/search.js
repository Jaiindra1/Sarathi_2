import { Router, json } from "express";
import { searchController } from "../controllers/searchController.js";

export function searchRoutes(client) {
    const router = Router();
    const controller = searchController(client);
    router.post("/api/search", json({ strict: false, limit: "64kb" }), controller.submit);
    router.get("/api/search/:job_id/status", controller.status);
    router.get("/api/search/:job_id/results", controller.results);
    return router;
}
