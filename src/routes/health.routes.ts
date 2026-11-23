import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

const getHealthStatus = async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const now = new Date();
    const colomboFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      dateStyle: "short",
      timeStyle: "medium"
    });

    res.json({
      status: "ok",
      success: true,
      message: "Amaz Hospital API and Database are running",
      timezone: process.env.TIMEZONE || process.env.TZ || "Asia/Colombo",
      processTz: process.env.TZ || "Asia/Colombo",
      offset: "+05:30",
      serverTime: now.toISOString(),
      colomboTime: colomboFormatter.format(now)
    });
  } catch (error: any) {
    console.error("Health check failed:", error);
    res.status(503).json({
      status: "error",
      success: false,
      message: "Database connection failed",
      error: error?.message || "Database connection failed",
      timezone: process.env.TIMEZONE || process.env.TZ || "Asia/Colombo",
      offset: "+05:30"
    });
  }
};

router.get("/health", getHealthStatus);
router.get("/api/health", getHealthStatus);
router.get("/api/timezone", getHealthStatus);

export default router;
