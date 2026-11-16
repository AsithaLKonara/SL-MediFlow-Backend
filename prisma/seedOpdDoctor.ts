import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding new OPD Doctor...');

  // 1. Find or create DOCTOR role (check both 'Doctor' and 'DOCTOR')
  let doctorRole = await prisma.role.findFirst({
    where: {
      OR: [
        { name: 'Doctor' },
        { name: 'DOCTOR' }
      ]
    }
  });

  if (!doctorRole) {
    doctorRole = await prisma.role.create({
      data: {
        id: 'role-doctor',
        name: 'Doctor',
        description: 'Doctor Role',
        updatedAt: new Date()
      }
    });
    console.log('Created Doctor role.');
  }

  // 2. Find or create OPD Department
  let opdDept = await prisma.department.findFirst({
    where: {
      OR: [
        { name: 'OPD' },
        { name: { contains: 'OPD', mode: 'insensitive' } }
      ]
    }
  });

  if (!opdDept) {
    opdDept = await prisma.department.create({
      data: {
        name: 'OPD',
        description: 'Outpatient Department'
      }
    });
    console.log('Created OPD department.');
  }

  // 3. Find or create OPD Consultation Room
  let opdRoom = await prisma.room.findFirst({
    where: {
      OR: [
        { roomNumber: 'OPD-01' },
        { roomNumber: 'Room 1' }
      ]
    }
  });

  if (!opdRoom) {
    opdRoom = await prisma.room.create({
      data: {
        roomNumber: 'OPD-01',
        department: 'CONSULTATION',
        description: 'OPD Consultation Room 1',
        status: 'AVAILABLE',
        isActive: true
      }
    });
    console.log('Created OPD Room OPD-01.');
  }

  // 4. Generate bcrypt hash for password
  const rawPassword = 'password123';
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(rawPassword, salt);

  // 5. Upsert OPD Doctor
  const doctorData = {
    fullName: 'Dr. Amal Fernando',
    email: 'opd.doctor@amazhospital.com',
    title: 'Dr.',
    specialty: 'OPD / General Practitioner',
    feeType: 'POST', // OPD clinical rule: consult fee billed post-consultation / at checkout
    consultationFee: 1000,
    feeOptions: [800, 1000, 1200, 1500],
    commissionRate: 20,
    commissionType: 'PERCENTAGE',
    bankName: 'Bank of Ceylon',
    bankBranch: 'Tissamaharama',
    bankAccountNumber: '7009876543',
    bankAccountName: 'Dr. Amal Fernando',
    roleId: doctorRole.id,
    departmentId: opdDept.id,
    roomId: opdRoom.id,
    isActive: true,
  };

  const doctor = await prisma.user.upsert({
    where: { email: doctorData.email },
    update: {
      ...doctorData,
      password: hashedPassword
    },
    create: {
      ...doctorData,
      password: hashedPassword
    }
  });

  console.log(`Upserted OPD Doctor: ${doctor.fullName} (${doctor.email})`);

  // 6. Setup Doctor Schedule (Available 7 days a week for continuous OPD shifts)
  let schedule = await prisma.doctorSchedule.findFirst({
    where: { doctorId: doctor.id }
  });

  if (!schedule) {
    schedule = await prisma.doctorSchedule.create({
      data: {
        doctorId: doctor.id,
        validFrom: new Date('2024-01-01'),
        validUntil: null
      }
    });
  }

  // Check existing sessions
  const existingSessions = await prisma.doctorScheduleSession.findMany({
    where: { scheduleId: schedule.id }
  });

  // Create Morning (08:00 - 14:00) & Evening (16:00 - 22:00) sessions for all 7 days (0 to 6)
  const days = [0, 1, 2, 3, 4, 5, 6]; // Sun to Sat
  for (const day of days) {
    const morningExists = existingSessions.some(
      s => s.dayOfWeek === day && s.sessionName === 'Morning OPD'
    );
    if (!morningExists) {
      await prisma.doctorScheduleSession.create({
        data: {
          scheduleId: schedule.id,
          roomId: opdRoom.id,
          dayOfWeek: day,
          sessionName: 'Morning OPD',
          startTime: '08:00',
          endTime: '14:00',
          tokenCapacity: 50,
          walkInPercentage: 80,
          isActive: true
        }
      });
    }

    const eveningExists = existingSessions.some(
      s => s.dayOfWeek === day && s.sessionName === 'Evening OPD'
    );
    if (!eveningExists) {
      await prisma.doctorScheduleSession.create({
        data: {
          scheduleId: schedule.id,
          roomId: opdRoom.id,
          dayOfWeek: day,
          sessionName: 'Evening OPD',
          startTime: '16:00',
          endTime: '22:00',
          tokenCapacity: 50,
          walkInPercentage: 80,
          isActive: true
        }
      });
    }
  }

  console.log('7-day OPD continuous schedule sessions verified.');
  console.log('\n==================================================');
  console.log('NEW OPD DOCTOR SEEDED SUCCESSFULLY');
  console.log('==================================================');
  console.log(`Name:        ${doctor.fullName}`);
  console.log(`Email:       ${doctor.email}`);
  console.log(`Password:    ${rawPassword}`);
  console.log(`Specialty:   ${doctor.specialty}`);
  console.log(`Fee Type:    ${doctor.feeType} (Standard OPD rule)`);
  console.log(`Fee Options: [${doctor.feeOptions.join(', ')}] LKR`);
  console.log(`Room:        ${opdRoom.roomNumber}`);
  console.log('==================================================\n');
}

main()
  .catch((e) => {
    console.error('Error seeding OPD doctor:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
