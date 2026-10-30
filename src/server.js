import { loadConfig } from "./config/index.js";
import { createApp } from "./app.js";

let config;
try { config = loadConfig(); }
catch (error) {
    // Configuration errors mention variable names only; never print their values.
    console.error(error.message);
    process.exit(1);
}
const server = createApp(config).listen(config.port, "0.0.0.0", () => {
    console.log("Express public service listening on port " + config.port);
});
server.on("error", () => {
    console.error("Express could not start. Check the public port configuration.");
    process.exitCode = 1;
});
let stopping = false;
function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
        server.closeAllConnections();
        process.exitCode = 1;
    }, 10000);
    deadline.unref();
    server.close(() => { clearTimeout(deadline); });
    server.closeIdleConnections();
    // Python jobs are independent; stopping Express must not cancel them.
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
