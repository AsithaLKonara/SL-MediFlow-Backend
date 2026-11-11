import { Router, Request, Response } from "express";
import { verifyToken } from "../middlewares/auth.middleware.js";
import {
  HardwareService,
  PoleDisplayProtocol,
  PriceDisplayIndicator,
} from "../services/hardware.service.js";

const router = Router();

const VALID_PROTOCOLS: PoleDisplayProtocol[] = [
  "PRICE_DISPLAY",
  "CD5220",
  "ESCPOS",
  "UTC",
  "AEDEX",
];

const VALID_INDICATORS: PriceDisplayIndicator[] = [
  "NONE",
  "PRICE",
  "TOTAL",
  "COLLECT",
  "CHANGE",
];

router.post("/pole-display/buffer", verifyToken, (req: Request, res: Response) => {
  try {
    const {
      line1 = "",
      line2 = "",
      protocol = "CD5220",
      amount,
      indicator = "NONE",
    } = req.body || {};

    const resolvedProtocol: PoleDisplayProtocol = VALID_PROTOCOLS.includes(protocol)
      ? protocol
      : "CD5220";

    const resolvedIndicator: PriceDisplayIndicator = VALID_INDICATORS.includes(indicator)
      ? indicator
      : "NONE";

    const buffer =
      resolvedProtocol === "PRICE_DISPLAY" && amount !== undefined
        ? HardwareService.buildPriceDisplayBuffer(amount, resolvedIndicator)
        : HardwareService.buildPoleDisplayBuffer(String(line1), String(line2), resolvedProtocol);

    res.json({
      success: true,
      data: {
        protocol: resolvedProtocol,
        formattedLine1: HardwareService.formatPoleDisplayLine(String(line1), 20),
        formattedLine2: HardwareService.formatPoleDisplayLine(String(line2), 20),
        base64: buffer.toString("base64"),
        hex: buffer.toString("hex"),
        length: buffer.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

