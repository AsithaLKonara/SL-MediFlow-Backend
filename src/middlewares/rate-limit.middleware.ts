import rateLimit from "express-rate-limit";

const isLocalhost = (req: any) => {
  const ip = req.ip || req.socket.remoteAddress || "";
  const host = req.hostname || req.headers.host || "";
  return (
    process.env.NODE_ENV !== "production" && (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      host.includes("localhost") ||
      host.includes("127.0.0.1")
    )
  );
};

export const financialTransactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  skip: (req) => isLocalhost(req),
  message: { success: false, error: "Too many financial transactions. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const clinicalTransactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  skip: (req) => isLocalhost(req),
  message: { success: false, error: "Too many clinical submissions. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});
