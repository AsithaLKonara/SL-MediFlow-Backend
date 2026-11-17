import { z } from "zod";

export const generatePayrollSchema = z.object({
  periodStart: z.string().min(1, "periodStart is required"),
  periodEnd: z.string().min(1, "periodEnd is required")
}).refine(data => {
  const start = new Date(data.periodStart);
  const end = new Date(data.periodEnd);
  return !isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end;
}, {
  message: "periodStart and periodEnd must be valid dates with periodEnd on or after periodStart"
});

export const applyLeaveSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  type: z.string().min(1, "type is required"),
  startDate: z.string().min(1, "startDate is required"),
  endDate: z.string().min(1, "endDate is required"),
  reason: z.string().min(1, "reason is required")
}).refine(data => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return !isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end;
}, {
  message: "startDate and endDate must be valid dates with endDate on or after startDate"
});

export const updateLeaveStatusSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().optional()
}).refine(data => {
  if (data.status === "REJECTED") {
    return !!data.rejectionReason && data.rejectionReason.trim().length > 0;
  }
  return true;
}, {
  message: "Rejection reason is required when rejecting a leave request"
});

export const createSalaryComponentSchema = z.object({
  code: z.string().min(1, "Component code is required"),
  name: z.string().min(1, "Component name is required"),
  category: z.string().min(1, "Category is required"),
  calculationMethod: z.string().min(1, "Calculation method is required"),
  isTaxable: z.boolean().optional(),
  isEpfEligible: z.boolean().optional()
});
