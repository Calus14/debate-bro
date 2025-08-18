import setupLogging, { config, requireConfig } from "./src/config.js";
import Bot from "./src/bot.js";

setupLogging();

// Fail fast in prod if critical vars are missing (keep or adjust list)
if (config.NODE_ENV !== "development") {
    requireConfig(["DISCORD_TOKEN", "S3_BUCKET_NAME", "AWS_REGION"]);
}

const bot = new Bot();
bot.start()
    .then(() => console.log("✅ Bot Started"))
    .catch(err => {
        console.error("Bot failed to start:", err);
        process.exitCode = 1;
    });
