import { Router, raw } from "express";
import { pagesController } from "../controllers/pagesController.js";

export function pageRoutes(client, config) {
    const router = Router();
    const proxy = pagesController(client, config);
    router.get("/", proxy);
    router.post("/", raw({ type: () => true, limit: "64kb" }), proxy);
    router.get("/feedback", proxy);
    router.post("/feedback", raw({ type: () => true, limit: "64kb" }), proxy);
    router.get("/static/{*asset}", proxy);
    return router;
}
