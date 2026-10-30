// Generate a matched pair of ignored local configuration files; never overwrite.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env") || existsSync("api-node.env")) {
    console.error("Local configuration already exists. No files changed; preserve and edit the existing files manually.");
    process.exit(1);
}
const token = randomBytes(32).toString("hex");
writeFileSync(".env", [
    "PORT=5000", "SCRAPER_BIND_HOST=127.0.0.1", "SCRAPER_SERVICE_TOKEN=" + token,
    "SQLITE_DATABASE_PATH=data/products.sqlite3",
    "MAIL_SERVER=smtp.gmail.com", "MAIL_PORT=587", "MAIL_USERNAME=", "MAIL_PASSWORD=", "FEEDBACK_RECIPIENT=", "",
].join("\n"), { flag: "wx", mode: 0o600 });
writeFileSync("api-node.env", [
    "PORT=3000", "SCRAPER_SERVICE_URL=http://127.0.0.1:5000",
    "SCRAPER_SERVICE_TOKEN=" + token, "SCRAPER_REQUEST_TIMEOUT_MS=20000", "",
].join("\n"), { flag: "wx", mode: 0o600 });
console.log("Created .env and api-node.env with matching random service tokens. No database or SMTP credentials were changed.");
