
require("dotenv").config();

const app = require("./app");
const pool = require("./config/db");

const PORT = Number(process.env.PORT || 5000);
const SHUTDOWN_TIMEOUT_MS = 10000;

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({
    level: "info",
    message: "FlashGuard API started",
    port: PORT
  }));
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    console.log(`${signal} received; shutdown is already in progress.`);
    return;
  }

  shuttingDown = true;

  console.log(JSON.stringify({
    level: "info",
    message: "Graceful shutdown started",
    signal
  }));

  const forceExitTimer = setTimeout(() => {
    console.error(JSON.stringify({
      level: "error",
      message: "Shutdown timed out; forcing exit"
    }));

    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExitTimer.unref();

  server.close(async (serverError) => {
    if (serverError) {
      clearTimeout(forceExitTimer);
      console.error("Error closing HTTP server:", serverError);
      process.exitCode = 1;

      try {
        await pool.end();
      } catch (dbError) {
        console.error("Error closing database pool:", dbError);
      }

      return;
    }

    try {
      await pool.end();

      console.log(JSON.stringify({
        level: "info",
        message: "HTTP server and database pool closed"
      }));

      clearTimeout(forceExitTimer);
      process.exitCode = 0;
    } catch (err) {
      console.error("Error closing database pool:", err);
      clearTimeout(forceExitTimer);
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
