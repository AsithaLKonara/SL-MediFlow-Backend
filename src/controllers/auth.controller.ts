import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { SMSService } from "../services/sms.service.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is not defined in environment variables");

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone } = req.body;
    if (!email && !phone) {
      res.status(400).json({ error: "Email or phone number is required" });
      return;
    }

    let user = null;
    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    }

    if (!user) {
      // Return generic success to prevent user enumeration
      res.status(200).json({ message: "If an account matching those details exists, a reset link has been dispatched." });
      return;
    }

    // Generate short-lived JWT for password reset (15 minutes)
    const resetToken = jwt.sign(
      { id: user.id, email: user.email, purpose: "PASSWORD_RESET" },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Dispatch via SMS if recipient phone number provided
    if (phone) {
      const smsMessage = `AMAZ Hospital: Your password reset link is ${resetLink}. Valid for 15 minutes. Do not share this link.`;
      SMSService.sendSMS(phone, smsMessage).catch((err: any) => {
        console.error("Failed to dispatch password reset SMS:", err);
      });
    }

    // Sanitize production logging (only log link during development)
    if (process.env.NODE_ENV !== "production") {
      console.log(`[AUTH-DEV] Password reset link for ${user.email}: ${resetLink}`);
    }
    
    res.status(200).json({ message: "If an account matching those details exists, a reset link has been dispatched." });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ error: "Token and new password are required" });
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string, purpose: string };
      if (decoded.purpose !== "PASSWORD_RESET") {
        throw new Error("Invalid token purpose");
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await prisma.user.update({
        where: { id: decoded.id },
        data: { password: hashedPassword }
      });

      res.status(200).json({ message: "Password has been successfully reset" });
    } catch (err) {
      res.status(400).json({ error: "Invalid or expired reset token" });
    }
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Please provide email and password" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        Role: {
          include: {
            RolePermission: {
              include: { Permission: true }
            }
          }
        },
        Department: {
          select: { id: true, name: true }
        }
      }
    });

    if (!user) {
      console.log(`[LOGIN FAILED] No user found for email: ${normalizedEmail}`);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!user.isActive) {
      console.log(`[LOGIN FAILED] User is deactivated: ${normalizedEmail}`);
      res.status(403).json({ error: "Account is deactivated or suspended. Please contact the administrator." });
      return;
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[LOGIN FAILED] Password mismatch for: ${normalizedEmail}`);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, roleId: user.roleId, email: user.email },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.FRONTEND_URL?.startsWith("https"));
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.Role?.name || "Unknown",
        departmentId: user.departmentId || null,
        department: user.Department?.name || null,
        feeOptions: (user as any).feeOptions || [],
        consultationFee: user.consultationFee ?? 2500,
        feeType: user.feeType || "POST",
        permissions: user.Role?.RolePermission?.filter((rp: any) => 
          rp.Permission && (rp.Permission.action === "READ" || rp.Permission.action === "ALL")
        ).map((rp: any) => rp.Permission?.resource) || [],
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    const token = req.cookies?.token || bearerToken;
    if (!token) {
      res.status(401).json({ error: "No session token found" });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET as string) as { id: string; roleId: string; email: string };
    
    // Find user to return
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        Role: {
          include: {
            RolePermission: {
              include: { Permission: true }
            }
          }
        },
        Department: {
          select: { id: true, name: true }
        }
      }
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid session or deactivated user" });
      return;
    }

    res.status(200).json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.Role?.name || "Unknown",
        departmentId: user.departmentId || null,
        department: user.Department?.name || null,
        feeOptions: (user as any).feeOptions || [],
        consultationFee: user.consultationFee ?? 2500,
        feeType: user.feeType || "POST",
        permissions: user.Role?.RolePermission?.filter((rp: any) => 
          rp.Permission && (rp.Permission.action === "READ" || rp.Permission.action === "ALL")
        ).map((rp: any) => rp.Permission?.resource) || [],
      }
    });
  } catch (error) {
    res.status(401).json({ error: "Session expired or invalid" });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });
  res.status(200).json({ message: "Logged out successfully" });
};
