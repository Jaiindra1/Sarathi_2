import express from "express";
import { createPythonScraperClient } from "./clients/pythonScraperClient.js";
import { searchRoutes } from "./routes/search.js";
import { pageRoutes } from "./routes/pages.js";
import { healthRoutes } from "./routes/health.js";
import { errorHandler } from "./middleware/errors.js";

export function createApp(config, { fetchImpl } = {}) {
    const app = express();
    app.disable("x-powered-by");
    app.disable("etag");
    const client = createPythonScraperClient(config, fetchImpl);
    app.use(healthRoutes(client));
    app.use(searchRoutes(client));
    app.use(pageRoutes(client, config));
    app.use((req, res) => res.status(404).json({ success: false, message: "Not found.", products: [] }));
    app.use(errorHandler);
    return app;
}
