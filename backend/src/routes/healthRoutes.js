
const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      success: true,
      data: {
        status: "healthy",
        database: "connected"
      },
      requestId: req.requestId
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
