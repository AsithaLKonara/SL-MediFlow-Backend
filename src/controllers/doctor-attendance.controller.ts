import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { NotificationService } from "../services/notification.service.js";
import { sortDoctorsWithOpdFirst } from "../utils/doctor-utils.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";
import { FrontdeskService } from "../services/frontdesk.service.js";

const frontdeskService = new FrontdeskService();

export const markDoctorArrived = async (req: Request, res: Response) => {
  try {
    const doctorId = req.params.id as string;
    const { roomId, ignoreConflict, override, startTime, endTime } = req.body || {};
    const userId = (req as any).user?.id || doctorId;

    const attendance = await frontdeskService.updateDoctorAttendance(
      doctorId,
      "ARRIVED",
      roomId || null,
      userId,
      false,
      undefined,
      startTime,
      endTime,
      ignoreConflict === true,
      override === true
    );

    res.json({
      success: true,
      data: {
        attendance
      }
    });
  } catch (error: any) {
    if (error.conflict) {
      return res.status(409).json(error.conflictData || { conflict: true, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getDoctorsTodayStatus = async (req: Request, res: Response) => {
  try {
    const { startOfDay, endOfDay } = getTimezoneBoundaries();

    const doctors = await prisma.user.findMany({
      where: { Role: { name: { equals: "Doctor", mode: "insensitive" } }, isActive: true },
      select: {
        id: true,
        fullName: true,
        specialty: true,
        Department: { select: { name: true } },
        DoctorAttendance: {
          where: { date: { gte: startOfDay, lte: endOfDay } },
          orderBy: { date: 'desc' },
          take: 1
        }
      }
    });

    const mapped = doctors.map(d => ({
      id: d.id,
      fullName: d.fullName,
      specialty: d.specialty,
      department: d.Department?.name,
      status: d.DoctorAttendance[0]?.status ?? "SCHEDULED",
      arrivedAt: d.DoctorAttendance[0]?.arrivedAt ?? null
    }));

    res.json({
      success: true,
      data: sortDoctorsWithOpdFirst(mapped)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getDoctorMetrics = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.query;
    
    if (!doctorId) {
      return res.status(400).json({ success: false, error: "doctorId is required" });
    }

    const { startOfDay, endOfDay } = getTimezoneBoundaries();

    const doctor = await prisma.user.findUnique({
      where: { id: doctorId as string }
    });

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }

    // Patients Today
    const patientsToday = await prisma.appointment.count({
      where: {
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay }
      }
    });

    // Completed Consultations
    const completedConsultations = await prisma.appointment.count({
      where: {
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: "COMPLETED"
      }
    });

    // Pending Queue (Booked / In Progress)
    const pendingQueue = await prisma.appointment.count({
      where: {
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["BOOKED", "IN_PROGRESS"] }
      }
    });

    // Pending Prescriptions
    const pendingPrescriptions = await prisma.prescription.count({
      where: {
        doctorId: doctor.id,
        createdAt: { gte: startOfDay, lte: endOfDay },
        status: "PENDING"
      }
    });

    // Pending Lab Requests
    const pendingLabRequests = await prisma.labRequest.count({
      where: {
        doctorId: doctor.id,
        requestedAt: { gte: startOfDay, lte: endOfDay },
        status: "PENDING"
      }
    });

    // Upcoming Patients
    const upcomingTokens = await prisma.appointment.findMany({
      where: { 
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["BOOKED", "IN_PROGRESS"] }
      },
      include: { Patient: true },
      orderBy: { tokenNumber: 'asc' },
      take: 5
    });

    const upcomingPatients = upcomingTokens.map(apt => {
      let mappedStatus = apt.status;
      if (mappedStatus === "BOOKED") mappedStatus = "WAITING";
      if (mappedStatus === "IN_PROGRESS") mappedStatus = "IN_CONSULTATION";

      return {
        queueNo: apt.tokenNumber,
        patientId: apt.patientId,
        patientName: apt.Patient?.fullName || "Unknown",
        age: apt.Patient?.dateOfBirth ? new Date().getFullYear() - new Date(apt.Patient.dateOfBirth).getFullYear() : 45,
        reason: apt.department || "Consultation",
        status: mappedStatus
      };
    });

    res.json({
      success: true,
      data: {
        doctorName: doctor.fullName,
        specialty: doctor.specialty || "General Medicine",
        patientsToday,
        completedConsultations,
        pendingQueue,
        pendingPrescriptions,
        pendingLabRequests,
        upcomingPatients
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
