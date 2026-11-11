import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SYSTEM_MODULES = [
  'Extra Services',
  'Extra Services Config',
  'Lab Operations',
  'Lab Tests',
  'Consultations',
  'Frontdesk',
  'Billing',
  'Refunds',
  'Doctor Share',
  'Finance',
  'HR',
  'Inventory',
  'Staff',
  'Departments',
  'Rooms',
  'Settings',
  'RBAC',
] as const;

type CrudActions = ('CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'ALL')[];

const ALL_CRUD: CrudActions = ['CREATE', 'READ', 'UPDATE', 'DELETE'];

const ROLE_PERMISSION_MATRIX: Record<string, Record<string, CrudActions>> = {
  Superadmin: Object.fromEntries([
    ['ALL', ['ALL']],
    ...SYSTEM_MODULES.map((m) => [m, ALL_CRUD]),
  ]),
  Admin: Object.fromEntries(SYSTEM_MODULES.map((m) => [m, ALL_CRUD])),
  Receptionist: {
    Frontdesk: ALL_CRUD,
    Billing: ALL_CRUD,
    Refunds: ['CREATE', 'READ', 'UPDATE'],
    'Doctor Share': ALL_CRUD,
    'Extra Services': ALL_CRUD,
    'Extra Services Config': ['READ'],
    'Lab Operations': ['READ'],
    Inventory: ['READ'],
    Rooms: ALL_CRUD,
    Departments: ['READ'],
  },
  Doctor: {
    Consultations: ALL_CRUD,
    'Lab Operations': ALL_CRUD,
    'Lab Tests': ['READ'],
    'Extra Services': ALL_CRUD,
    Inventory: ['READ'],
    Rooms: ['READ'],
    Departments: ['READ'],
  },
  Pharmacist: {
    Consultations: ['READ', 'UPDATE'],
    Billing: ALL_CRUD,
    Inventory: ALL_CRUD,
    Departments: ['READ'],
  },
  LabTech: {
    'Lab Operations': ALL_CRUD,
    'Lab Tests': ALL_CRUD,
    'Extra Services': ['READ', 'UPDATE'],
    Departments: ['READ'],
    Rooms: ['READ'],
  },
  Cashier: {
    Billing: ALL_CRUD,
    Refunds: ALL_CRUD,
    'Doctor Share': ALL_CRUD,
    Frontdesk: ['READ'],
    Departments: ['READ'],
  },
  Nurse: {
    Frontdesk: ALL_CRUD,
    'Extra Services': ALL_CRUD,
    Consultations: ['READ'],
    Rooms: ['READ'],
    Departments: ['READ'],
  },
  'Extra Services': {
    'Extra Services': ALL_CRUD,
    'Extra Services Config': ALL_CRUD,
    Rooms: ['READ'],
    Departments: ['READ'],
  },
};

function startOfDayUTC(offsetDays = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function seedSystemConfig() {
  console.log('[1/10] Seeding system settings & SMS templates...');

  const defaultSettings: Array<{ key: string; value: string; description: string }> = [
    { key: 'hospitalName', value: 'SL MediFlow Hospital', description: 'Hospital display name' },
    { key: 'contactEmail', value: 'admin@slmediflow.com', description: 'Primary hospital contact email' },
    { key: 'hospitalPhone', value: '+94 11 234 5678', description: 'Hospital contact phone' },
    { key: 'hospitalAddress', value: 'No. 123, Wellness Avenue, Colombo 07', description: 'Hospital address for templates' },
    { key: 'systemCurrency', value: 'lkr', description: 'Default currency code' },
    { key: 'passwordExpiry', value: '90', description: 'Password expiry days' },
    { key: 'require2FA', value: 'disabled', description: '2FA policy' },
    { key: 'dailyReportEmail', value: 'admin@slmediflow.com', description: 'Daily executive summary recipient' },
    { key: 'criticalQueueThreshold', value: '50', description: 'Queue overload warning threshold' },
    { key: 'poleDisplayMode', value: 'BOTH', description: 'Customer display output mode' },
    { key: 'poleDisplayTransport', value: 'BRIDGE', description: 'Pole display transport' },
    { key: 'poleDisplayPort', value: 'COM3', description: 'Default serial COM port' },
    { key: 'poleDisplayBaudRate', value: '9600', description: 'Default baud rate' },
    { key: 'poleDisplayProtocol', value: 'CD5220', description: 'Default pole protocol' },
    { key: 'poleDisplayWelcomeMessage', value: 'WELCOME TO SL MEDIFLOW', description: 'Idle pole display text' },
    { key: 'poleDisplayStoreName', value: 'SL MEDIFLOW', description: 'Idle store title' },
    { key: 'poleDisplayChangeTimeoutSeconds', value: '7', description: 'Seconds before reverting to idle' },
  ];

  for (const s of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, description: s.description },
      create: s,
    });
  }

  // Ensure MRN counter starts cleanly above demo MRNs without rolling back live sequence
  const existingMrn = await prisma.systemSetting.findUnique({ where: { key: 'mrnSequence' } });
  if (!existingMrn) {
    await prisma.systemSetting.create({
      data: { key: 'mrnSequence', value: '1006', description: 'Auto-increment MRN counter' },
    });
  }

  const smsTemplates = [
    {
      name: 'APPOINTMENT_BOOKED',
      content: 'SL Medi Flow: Token #{{tokenNumber}} confirmed for {{patientName}} with Dr. {{doctorName}} on {{appointmentDate}}. Ref: {{bookingRef}}',
    },
    {
      name: 'VISIT_TOKENS_BOOKED',
      content: 'SL Medi Flow: Tokens confirmed for {{patientName}} on {{appointmentDate}}: {{tokenDetails}}. Ref: {{bookingRef}}',
    },
    {
      name: 'DOCTOR_ARRIVED',
      content: 'SL Medi Flow: Dr. {{doctorName}} has arrived at Room {{roomNumber}}. Token #{{tokenNumber}} for {{patientName}}. Please proceed.',
    },
    {
      name: 'LAB_REPORT_READY',
      content: 'SL Medi Flow: Lab report for {{patientName}} ({{testProfile}}) is ready. View: {{reportLink}} Ref: {{referenceNo}}',
    },
    {
      name: 'PATIENT_PORTAL_OTP',
      content: 'SL Medi Flow: Your verification code is {{otp}}. Valid for 5 minutes. Do not share this code.',
    },
    {
      name: 'SESSION_CANCELLED',
      content: 'SL Medi Flow: Appointment for {{patientName}} with Dr. {{doctorName}} on {{date}} is cancelled ({{reason}}). Call +94 11 234 5678.',
    },
  ];

  for (const tpl of smsTemplates) {
    await prisma.smsTemplate.upsert({
      where: { name: tpl.name },
      update: { content: tpl.content, isActive: true },
      create: { name: tpl.name, content: tpl.content, isActive: true },
    });
  }
}

async function seedHrAndPayrollMetadata() {
  console.log('[2/10] Seeding statutory rules, salary components, and role payroll templates...');

  const rules = [
    { code: 'EPF_EMPLOYEE', name: 'EPF Employee Contribution', ratePercentage: 8.0 },
    { code: 'EPF_EMPLOYER', name: 'EPF Employer Contribution', ratePercentage: 12.0 },
    { code: 'ETF_EMPLOYER', name: 'ETF Employer Contribution', ratePercentage: 3.0 },
  ];
  for (const r of rules) {
    await prisma.statutoryRule.upsert({
      where: { code: r.code },
      update: { name: r.name, ratePercentage: r.ratePercentage, isActive: true },
      create: { ...r, effectiveFrom: new Date('2025-01-01'), isActive: true },
    });
  }

  const components = [
    { code: 'BASIC', name: 'Basic Salary', category: 'EARNING', type: 'BASIC', calculationMethod: 'FIXED', defaultAmount: 45000, applicableRoles: 'ALL' },
    { code: 'NIGHT_SHIFT_ALLOWANCE', name: 'Night Shift Allowance', category: 'EARNING', type: 'ALLOWANCE', calculationMethod: 'FIXED', defaultAmount: 3500, applicableRoles: 'Nurse' },
    { code: 'TRANSPORT_ALLOWANCE', name: 'Transport Allowance', category: 'EARNING', type: 'ALLOWANCE', calculationMethod: 'FIXED', defaultAmount: 3000, applicableRoles: 'ALL' },
    { code: 'MEAL_ALLOWANCE', name: 'Meal Allowance', category: 'EARNING', type: 'ALLOWANCE', calculationMethod: 'FIXED', defaultAmount: 2500, applicableRoles: 'ALL' },
    { code: 'ATTENDANCE_BONUS', name: 'Attendance Bonus', category: 'EARNING', type: 'BONUS', calculationMethod: 'FIXED', defaultAmount: 1500, applicableRoles: 'ALL' },
    { code: 'EPF_EMPLOYEE', name: 'EPF Employee (8%)', category: 'DEDUCTION', type: 'STATUTORY', calculationMethod: 'PERCENTAGE', defaultAmount: 8, applicableRoles: 'ALL' },
  ];
  for (const comp of components) {
    await prisma.salaryComponent.upsert({
      where: { code: comp.code },
      update: comp,
      create: comp,
    });
  }

  const templates = [
    { role: 'Superadmin', workingHoursPerDay: 8, perHourRate: 1200, otRate: 1500, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'Admin', workingHoursPerDay: 8, perHourRate: 900, otRate: 1200, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'Doctor', workingHoursPerDay: 6, perHourRate: 1500, otRate: 2000, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'Nurse', workingHoursPerDay: 8, perHourRate: 400, otRate: 550, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'Receptionist', workingHoursPerDay: 8, perHourRate: 350, otRate: 500, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'LabTech', workingHoursPerDay: 8, perHourRate: 450, otRate: 650, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'Pharmacist', workingHoursPerDay: 8, perHourRate: 450, otRate: 650, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'Cashier', workingHoursPerDay: 8, perHourRate: 350, otRate: 500, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
    { role: 'Extra Services', workingHoursPerDay: 8, perHourRate: 380, otRate: 520, allowedLeavesPerMonth: 2, fullSalaryPayDate: 28 },
  ];
  for (const t of templates) {
    await prisma.rolePayrollTemplate.upsert({
      where: { role: t.role },
      update: t,
      create: t,
    });
  }
}

async function seedDepartmentsAndRooms() {
  console.log('[3/10] Seeding departments & rooms...');

  const deptsData = [
    { name: 'OPD', description: 'Outpatient Department', commissionRate: 20, commissionType: 'PERCENTAGE' },
    { name: 'LAB', description: 'Clinical Laboratory', commissionRate: 0, commissionType: 'PERCENTAGE' },
    { name: 'PHARMACY', description: 'Hospital Pharmacy', commissionRate: 0, commissionType: 'PERCENTAGE' },
    { name: 'CARDIOLOGY', description: 'Cardiology Unit', commissionRate: 15, commissionType: 'PERCENTAGE' },
    { name: 'DENTAL', description: 'Dental Care', commissionRate: 20, commissionType: 'PERCENTAGE' },
    { name: 'EXTRA_SERVICES', description: 'Extra Services & Procedures', commissionRate: 0, commissionType: 'PERCENTAGE' },
    { name: 'NEUROLOGY', description: 'Neurology Unit', commissionRate: 15, commissionType: 'PERCENTAGE' },
    { name: 'ORTHOPEDICS', description: 'Orthopedics Unit', commissionRate: 15, commissionType: 'PERCENTAGE' },
    { name: 'PEDIATRICS', description: 'Pediatrics Unit', commissionRate: 18, commissionType: 'PERCENTAGE' },
    { name: 'DERMATOLOGY', description: 'Dermatology Clinic', commissionRate: 20, commissionType: 'PERCENTAGE' },
  ];

  const deptMap: Record<string, string> = {};
  for (const d of deptsData) {
    const dept = await prisma.department.upsert({
      where: { name: d.name },
      update: { description: d.description, commissionRate: d.commissionRate, commissionType: d.commissionType, isActive: true },
      create: d,
    });
    deptMap[d.name] = dept.id;
  }

  const roomsData = [
    { roomNumber: 'ROOM 01', department: 'CONSULTATION', status: 'AVAILABLE', description: 'OPD General Consultation Room 1' },
    { roomNumber: 'ROOM 02', department: 'CONSULTATION', status: 'AVAILABLE', description: 'OPD General Consultation Room 2' },
    { roomNumber: 'ROOM 03', department: 'CONSULTATION', status: 'AVAILABLE', description: 'Pediatrics Consultation Suite' },
    { roomNumber: 'ROOM 04', department: 'CONSULTATION', status: 'AVAILABLE', description: 'Cardiology Consultation Suite' },
    { roomNumber: 'ROOM 05', department: 'CONSULTATION', status: 'AVAILABLE', description: 'Orthopedics & Specialist Room' },
    { roomNumber: 'ROOM 06', department: 'CONSULTATION', status: 'MAINTENANCE', description: 'Dermatology Suite (Maintenance)' },
    { roomNumber: 'LAB-A', department: 'LAB', status: 'AVAILABLE', description: 'Main Haematology & Biochemistry Lab' },
    { roomNumber: 'LAB-B', department: 'LAB', status: 'AVAILABLE', description: 'Microbiology & Clinical Pathology Lab' },
    { roomNumber: 'EXT-01', department: 'EXTRA_SERVICE', status: 'AVAILABLE', description: 'ECG & Nebulization Workstation' },
    { roomNumber: 'EXT-02', department: 'EXTRA_SERVICE', status: 'AVAILABLE', description: 'Wound Dressing & Injection Bay' },
  ];

  const roomMap: Record<string, string> = {};
  for (const r of roomsData) {
    const room = await prisma.room.upsert({
      where: { roomNumber: r.roomNumber },
      update: { department: r.department, status: r.status, description: r.description, isActive: true },
      create: r,
    });
    roomMap[r.roomNumber] = room.id;
  }

  return { deptMap, roomMap };
}

async function seedRolesPermissionsAndUsers(
  deptMap: Record<string, string>,
  roomMap: Record<string, string>
) {
  console.log('[4/10] Seeding RBAC permissions, roles, and 1+ user per role...');

  // 1. Ensure all Permission records exist
  const permMap: Record<string, string> = {};
  const ensurePermission = async (action: string, resource: string) => {
    const key = `${action}::${resource}`;
    if (permMap[key]) return permMap[key];
    const perm = await prisma.permission.upsert({
      where: { action_resource: { action, resource } },
      update: {},
      create: { action, resource },
    });
    permMap[key] = perm.id;
    return perm.id;
  };

  await ensurePermission('ALL', 'ALL');
  for (const mod of SYSTEM_MODULES) {
    for (const action of ALL_CRUD) {
      await ensurePermission(action, mod);
    }
  }

  // 2. Ensure all 9 Roles and attach RolePermissions
  const roleDescriptions: Record<string, string> = {
    Superadmin: 'Full unrestricted hospital system administrator',
    Admin: 'Hospital operations manager & billing administrator',
    Receptionist: 'Frontdesk registration, token booking, and billing clerk',
    Doctor: 'Outpatient & specialist medical practitioner',
    Pharmacist: 'Pharmacy dispensary, inventory, and POS billing',
    LabTech: 'Clinical laboratory technician & report publisher',
    Cashier: 'Billing settlements, refunds, and register shifts',
    Nurse: 'Triage, patient vitals, arrivals, and procedure station support',
    'Extra Services': 'Dedicated workstation operator for ECG, dressings, and procedures',
  };

  const roleMap: Record<string, string> = {};
  for (const [roleName, modules] of Object.entries(ROLE_PERMISSION_MATRIX)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: roleDescriptions[roleName] ?? `${roleName} Role` },
      create: { name: roleName, description: roleDescriptions[roleName] ?? `${roleName} Role` },
    });
    roleMap[roleName] = role.id;

    // Sync RolePermissions cleanly
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const permissionIdsToAttach: string[] = [];
    for (const [resource, actions] of Object.entries(modules)) {
      for (const action of actions) {
        const pid = await ensurePermission(action, resource);
        permissionIdsToAttach.push(pid);
      }
    }
    await prisma.rolePermission.createMany({
      data: permissionIdsToAttach.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  // 3. Seed Demo Credentials (1 user per role + 2 extra Doctors for specialty coverage)
  const passwordHash = await bcrypt.hash('password123', 10);

  const demoUsers = [
    {
      email: 'admin@slmediflow.com',
      fullName: 'System Superadmin',
      role: 'Superadmin',
      dept: 'OPD',
      basicSalary: 150000,
    },
    {
      email: 'manager@slmediflow.com',
      fullName: 'Kasun Perera (Hospital Admin)',
      role: 'Admin',
      dept: 'OPD',
      basicSalary: 110000,
    },
    {
      email: 'reception@slmediflow.com',
      fullName: 'Alice Reception',
      role: 'Receptionist',
      dept: 'OPD',
      basicSalary: 52000,
    },
    {
      email: 'dr1@slmediflow.com',
      fullName: 'Dr. Kamal Perera',
      title: 'MBBS (Colombo), General Practitioner',
      role: 'Doctor',
      specialty: 'General',
      dept: 'OPD',
      room: 'ROOM 01',
      consultationFee: 1500,
      feeType: 'POST',
      feeOptions: [1000, 1500, 2000],
      commissionRate: 20,
      basicSalary: 180000,
    },
    {
      email: 'dr2@slmediflow.com',
      fullName: 'Dr. Nimali Silva',
      title: 'MD, MRCP (UK) - Consultant Cardiologist',
      role: 'Doctor',
      specialty: 'Cardiology',
      dept: 'CARDIOLOGY',
      room: 'ROOM 04',
      consultationFee: 3000,
      feeType: 'UPFRONT',
      feeOptions: [2500, 3000, 3500],
      commissionRate: 15,
      basicSalary: 250000,
    },
    {
      email: 'dr3@slmediflow.com',
      fullName: 'Dr. Rohan Jayawardena',
      title: 'MBBS, DCH, MD - Consultant Pediatrician',
      role: 'Doctor',
      specialty: 'Pediatrics',
      dept: 'PEDIATRICS',
      room: 'ROOM 03',
      consultationFee: 2500,
      feeType: 'POST',
      feeOptions: [2000, 2500, 3000],
      commissionRate: 18,
      basicSalary: 220000,
    },
    {
      email: 'pharmacist@slmediflow.com',
      fullName: 'Priya Pharmacist',
      role: 'Pharmacist',
      dept: 'PHARMACY',
      basicSalary: 68000,
    },
    {
      email: 'labtech@slmediflow.com',
      fullName: 'Charlie LabTech',
      role: 'LabTech',
      dept: 'LAB',
      room: 'LAB-A',
      basicSalary: 70000,
    },
    {
      email: 'cashier@slmediflow.com',
      fullName: 'Saman Cashier',
      role: 'Cashier',
      dept: 'OPD',
      basicSalary: 50000,
    },
    {
      email: 'nurse@slmediflow.com',
      fullName: 'Nancy Nurse',
      role: 'Nurse',
      dept: 'OPD',
      room: 'ROOM 01',
      basicSalary: 58000,
    },
    {
      email: 'extraservices@slmediflow.com',
      fullName: 'Dilani Extra Services',
      role: 'Extra Services',
      dept: 'EXTRA_SERVICES',
      room: 'EXT-01',
      basicSalary: 56000,
    },
  ];

  const userMap: Record<string, any> = {};
  for (const u of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        password: passwordHash,
        roleId: roleMap[u.role]!,
        title: u.title ?? null,
        specialty: u.specialty ?? null,
        departmentId: deptMap[u.dept] ?? null,
        roomId: u.room ? roomMap[u.room] ?? null : null,
        consultationFee: u.consultationFee ?? 2500,
        feeType: u.feeType ?? 'POST',
        feeOptions: u.feeOptions ?? [],
        commissionRate: u.commissionRate ?? 20,
        commissionType: 'PERCENTAGE',
        basicSalary: u.basicSalary,
        bankName: 'Commercial Bank of Ceylon',
        bankBranch: 'Colombo 07',
        bankAccountNumber: '10002345678',
        bankAccountName: u.fullName,
        isActive: true,
      },
      create: {
        email: u.email,
        fullName: u.fullName,
        password: passwordHash,
        roleId: roleMap[u.role]!,
        title: u.title ?? null,
        specialty: u.specialty ?? null,
        departmentId: deptMap[u.dept] ?? null,
        roomId: u.room ? roomMap[u.room] ?? null : null,
        consultationFee: u.consultationFee ?? 2500,
        feeType: u.feeType ?? 'POST',
        feeOptions: u.feeOptions ?? [],
        commissionRate: u.commissionRate ?? 20,
        commissionType: 'PERCENTAGE',
        basicSalary: u.basicSalary,
        bankName: 'Commercial Bank of Ceylon',
        bankBranch: 'Colombo 07',
        bankAccountNumber: '10002345678',
        bankAccountName: u.fullName,
        isActive: true,
      },
    });
    userMap[u.email] = user;

    // Ensure EmployeeProfile & active CompensationVersion exist
    const profile = await prisma.employeeProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        employmentType: 'FULL_TIME',
        salaryBasis: 'MONTHLY',
        joiningDate: new Date('2025-01-15'),
        paymentMethod: 'BANK_TRANSFER',
        bankDetails: { bank: 'Commercial Bank', branch: 'Colombo 07', accountNo: '10002345678' },
      },
    });
    const existingComp = await prisma.compensationVersion.findFirst({
      where: { employeeProfileId: profile.id, isActive: true },
    });
    if (!existingComp) {
      await prisma.compensationVersion.create({
        data: {
          employeeProfileId: profile.id,
          baseSalary: u.basicSalary,
          effectiveFrom: new Date('2025-01-15'),
          isActive: true,
        },
      });
    }
  }

  return userMap;
}

async function seedDoctorSchedulesAndAttendance(
  userMap: Record<string, any>,
  roomMap: Record<string, string>
) {
  console.log('[5/10] Seeding weekly doctor schedules & today attendance...');

  const doctorConfigs = [
    { email: 'dr1@slmediflow.com', room: 'ROOM 01', arrived: true },
    { email: 'dr2@slmediflow.com', room: 'ROOM 04', arrived: true },
    { email: 'dr3@slmediflow.com', room: 'ROOM 03', arrived: false },
  ];

  const todaySessions: Record<string, any> = {};
  const todayDow = new Date().getDay();

  for (const cfg of doctorConfigs) {
    const doc = userMap[cfg.email];
    const roomId = roomMap[cfg.room] ?? null;

    let schedule = await prisma.doctorSchedule.findFirst({
      where: { doctorId: doc.id },
      include: { sessions: true },
    });

    if (!schedule) {
      schedule = await prisma.doctorSchedule.create({
        data: { doctorId: doc.id, validFrom: new Date('2025-01-01') },
        include: { sessions: true },
      });
    }

    if (schedule.sessions.length === 0) {
      const sessionsToCreate = [];
      for (let day = 0; day <= 6; day++) {
        sessionsToCreate.push(
          {
            scheduleId: schedule.id,
            roomId,
            dayOfWeek: day,
            sessionName: 'Morning Session',
            startTime: '08:30',
            endTime: '12:30',
            tokenCapacity: 30,
            walkInPercentage: 70,
            isActive: true,
          },
          {
            scheduleId: schedule.id,
            roomId,
            dayOfWeek: day,
            sessionName: 'Evening Session',
            startTime: '16:00',
            endTime: '20:00',
            tokenCapacity: 30,
            walkInPercentage: 70,
            isActive: true,
          }
        );
      }
      await prisma.doctorScheduleSession.createMany({ data: sessionsToCreate });
      schedule = await prisma.doctorSchedule.findUnique({
        where: { id: schedule.id },
        include: { sessions: true },
      });
    }

    const matchingSession =
      schedule?.sessions.find((s) => s.dayOfWeek === todayDow && s.sessionName === 'Morning Session') ||
      schedule?.sessions[0];
    if (matchingSession) todaySessions[cfg.email] = matchingSession;

    // Ensure DoctorAttendance record exists for today
    const todayStart = startOfDayUTC(0);
    const tomorrowStart = startOfDayUTC(1);
    const existingAtt = await prisma.doctorAttendance.findFirst({
      where: { doctorId: doc.id, date: { gte: todayStart, lt: tomorrowStart } },
    });
    if (!existingAtt) {
      await prisma.doctorAttendance.create({
        data: {
          doctorId: doc.id,
          roomId,
          date: new Date(),
          status: cfg.arrived ? 'ARRIVED' : 'SCHEDULED',
          expectedStartTime: '08:30',
          expectedEndTime: '12:30',
          arrivedAt: cfg.arrived ? new Date() : null,
        },
      });
    }
  }

  return todaySessions;
}

async function seedPharmacySuppliersAndMedicines() {
  console.log('[6/10] Seeding suppliers, medicines, consumables, stock batches, and sample PO...');

  const supplierDefs = [
    {
      name: 'State Pharmaceuticals Corp (SPC)',
      contactPerson: 'Ruwan Bandara',
      email: 'orders@spc-demo.lk',
      phone: '+94 11 258 4411',
      address: 'No. 75, Sir Baron Jayathilaka Mw, Colombo 01',
    },
    {
      name: 'Hemas Pharmaceuticals (Pvt) Ltd',
      contactPerson: 'Dilshan Perera',
      email: 'dispatch@hemas-demo.lk',
      phone: '+94 11 473 1731',
      address: 'Hemas House, Braybrooke Place, Colombo 02',
    },
    {
      name: 'Sunshine Healthcare Lanka',
      contactPerson: 'Nirosha Fernando',
      email: 'sales@sunshine-demo.lk',
      phone: '+94 11 269 0010',
      address: 'No. 60, Dharmapala Mawatha, Colombo 03',
    },
  ];

  let mainSupplier = await prisma.supplier.findFirst({ where: { name: supplierDefs[0]!.name } });
  for (const sup of supplierDefs) {
    const existing = await prisma.supplier.findFirst({ where: { name: sup.name } });
    const saved = existing ?? (await prisma.supplier.create({ data: sup }));
    if (sup.name === supplierDefs[0]!.name) mainSupplier = saved;
  }

  const catalog = [
    { name: 'Paracetamol 500mg', genericName: 'Paracetamol', category: 'Analgesics', form: 'Tablet', strength: '500mg', unit: 'Tablet', packSize: 1, reorderLevel: 100, retailPrice: 5, costPrice: 2.5, qty: 1200, barcode: '8901000001' },
    { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', form: 'Capsule', strength: '500mg', unit: 'Capsule', packSize: 1, reorderLevel: 80, retailPrice: 35, costPrice: 22, qty: 600, barcode: '8901000002' },
    { name: 'Amoxicillin 250mg', genericName: 'Amoxicillin', category: 'Antibiotics', form: 'Capsule', strength: '250mg', unit: 'Capsule', packSize: 1, reorderLevel: 60, retailPrice: 22, costPrice: 14, qty: 450, barcode: '8901000003' },
    { name: 'Azithromycin 500mg', genericName: 'Azithromycin', category: 'Antibiotics', form: 'Tablet', strength: '500mg', unit: 'Tablet', packSize: 1, reorderLevel: 40, retailPrice: 110, costPrice: 70, qty: 240, barcode: '8901000004' },
    { name: 'Ciprofloxacin 500mg', genericName: 'Ciprofloxacin', category: 'Antibiotics', form: 'Tablet', strength: '500mg', unit: 'Tablet', packSize: 1, reorderLevel: 50, retailPrice: 45, costPrice: 28, qty: 300, barcode: '8901000005' },
    { name: 'Ibuprofen 400mg', genericName: 'Ibuprofen', category: 'Analgesics', form: 'Tablet', strength: '400mg', unit: 'Tablet', packSize: 1, reorderLevel: 80, retailPrice: 12, costPrice: 6.5, qty: 500, barcode: '8901000006' },
    { name: 'Omeprazole 20mg', genericName: 'Omeprazole', category: 'Antacids', form: 'Capsule', strength: '20mg', unit: 'Capsule', packSize: 1, reorderLevel: 80, retailPrice: 18, costPrice: 10, qty: 700, barcode: '8901000007' },
    { name: 'Domperidone 10mg', genericName: 'Domperidone', category: 'Antiemetics', form: 'Tablet', strength: '10mg', unit: 'Tablet', packSize: 1, reorderLevel: 60, retailPrice: 14, costPrice: 8, qty: 480, barcode: '8901000008' },
    { name: 'Metformin 850mg', genericName: 'Metformin Hydrochloride', category: 'Oral Hypoglycemic Agents (OHA)', form: 'Tablet', strength: '850mg', unit: 'Tablet', packSize: 1, reorderLevel: 100, retailPrice: 16, costPrice: 9, qty: 850, barcode: '8901000009' },
    { name: 'Metformin 500mg', genericName: 'Metformin Hydrochloride', category: 'Oral Hypoglycemic Agents (OHA)', form: 'Tablet', strength: '500mg', unit: 'Tablet', packSize: 1, reorderLevel: 100, retailPrice: 10, costPrice: 5.5, qty: 900, barcode: '8901000010' },
    { name: 'Sitagliptin 50mg', genericName: 'Sitagliptin', category: 'Oral Hypoglycemic Agents (OHA)', form: 'Tablet', strength: '50mg', unit: 'Tablet', packSize: 1, reorderLevel: 40, retailPrice: 95, costPrice: 62, qty: 220, barcode: '8901000011' },
    { name: 'Atorvastatin 10mg', genericName: 'Atorvastatin', category: 'Statins', form: 'Tablet', strength: '10mg', unit: 'Tablet', packSize: 1, reorderLevel: 80, retailPrice: 28, costPrice: 16, qty: 550, barcode: '8901000012' },
    { name: 'Atorvastatin 20mg', genericName: 'Atorvastatin', category: 'Statins', form: 'Tablet', strength: '20mg', unit: 'Tablet', packSize: 1, reorderLevel: 60, retailPrice: 42, costPrice: 25, qty: 400, barcode: '8901000013' },
    { name: 'Amlodipine 5mg', genericName: 'Amlodipine', category: 'Antihypertensives', form: 'Tablet', strength: '5mg', unit: 'Tablet', packSize: 1, reorderLevel: 80, retailPrice: 12, costPrice: 6, qty: 650, barcode: '8901000014' },
    { name: 'Losartan 50mg', genericName: 'Losartan Potassium', category: 'Antihypertensives', form: 'Tablet', strength: '50mg', unit: 'Tablet', packSize: 1, reorderLevel: 80, retailPrice: 24, costPrice: 14, qty: 520, barcode: '8901000015' },
    { name: 'Bisoprolol 5mg', genericName: 'Bisoprolol Fumarate', category: 'Antihypertensives', form: 'Tablet', strength: '5mg', unit: 'Tablet', packSize: 1, reorderLevel: 40, retailPrice: 32, costPrice: 19, qty: 280, barcode: '8901000016' },
    { name: 'Cetirizine 10mg', genericName: 'Cetirizine', category: 'Antihistamines', form: 'Tablet', strength: '10mg', unit: 'Tablet', packSize: 1, reorderLevel: 60, retailPrice: 10, costPrice: 4.5, qty: 600, barcode: '8901000017' },
    { name: 'Loratadine 10mg', genericName: 'Loratadine', category: 'Antihistamines', form: 'Tablet', strength: '10mg', unit: 'Tablet', packSize: 1, reorderLevel: 50, retailPrice: 15, costPrice: 8, qty: 400, barcode: '8901000018' },
    { name: 'Fexofenadine 120mg', genericName: 'Fexofenadine', category: 'Antihistamines', form: 'Tablet', strength: '120mg', unit: 'Tablet', packSize: 1, reorderLevel: 40, retailPrice: 48, costPrice: 29, qty: 240, barcode: '8901000019' },
    { name: 'Ferrous Sulphate 200mg', genericName: 'Ferrous Sulphate', category: 'Vitamins & Minerals', form: 'Tablet', strength: '200mg', unit: 'Tablet', packSize: 1, reorderLevel: 60, retailPrice: 8, costPrice: 4, qty: 500, barcode: '8901000020' },
    { name: 'Vitamin D3 1000IU', genericName: 'Cholecalciferol', category: 'Vitamins & Minerals', form: 'Tablet', strength: '1000IU', unit: 'Tablet', packSize: 1, reorderLevel: 50, retailPrice: 38, costPrice: 22, qty: 350, barcode: '8901000021' },
    { name: 'Cough Syrup (Dextromethorphan)', genericName: 'Dextromethorphan', category: 'Antiasthmatics', form: 'Syrup', strength: '60ml', unit: 'Bottle', packSize: 60, reorderLevel: 20, retailPrice: 480, costPrice: 310, qty: 65, barcode: '8901000022' },
    { name: 'Amoxicillin Suspension 125mg/5ml', genericName: 'Amoxicillin', category: 'Antibiotics', form: 'Syrup', strength: '60ml', unit: 'Bottle', packSize: 60, reorderLevel: 20, retailPrice: 540, costPrice: 360, qty: 45, barcode: '8901000023' },
    { name: 'Mupirocin 2% Ointment', genericName: 'Mupirocin', category: 'Antibiotics', form: 'Cream', strength: '15g', unit: 'Tube', packSize: 30, reorderLevel: 15, retailPrice: 680, costPrice: 440, qty: 35, barcode: '8901000024' },
    { name: 'Ciprofloxacin Eye Drops', genericName: 'Ciprofloxacin', category: 'ENT Preparations', form: 'Eye Drop', strength: '10ml', unit: 'Bottle', packSize: 10, reorderLevel: 15, retailPrice: 390, costPrice: 240, qty: 30, barcode: '8901000025' },
    { name: 'Salbutamol Inhaler 100mcg', genericName: 'Salbutamol', category: 'Antiasthmatics', form: 'Inhaler', strength: '100mcg', unit: 'Piece', packSize: 200, reorderLevel: 15, retailPrice: 1250, costPrice: 820, qty: 28, barcode: '8901000026' },
    { name: 'Surgical Gloves (Medium)', genericName: null, category: 'Medical Consumables', form: 'Piece', strength: null, unit: 'Pair', packSize: 1, reorderLevel: 100, retailPrice: 95, costPrice: 55, qty: 400, itemType: 'CONSUMABLE', barcode: '8901000027' },
    { name: 'CBS Glucose Test Strip', genericName: null, category: 'Medical Consumables', form: 'Strip', strength: null, unit: 'Strip', packSize: 1, reorderLevel: 50, retailPrice: 140, costPrice: 85, qty: 25, itemType: 'CONSUMABLE', barcode: '8901000028', nearLow: true },
  ];

  const medMap: Record<string, any> = {};
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const nearExpiry = new Date();
  nearExpiry.setDate(nearExpiry.getDate() + 25);

  for (let i = 0; i < catalog.length; i++) {
    const item = catalog[i]!;
    const med = await prisma.medicine.upsert({
      where: { barcode: item.barcode },
      update: {
        name: item.name,
        genericName: item.genericName,
        category: item.category,
        itemType: (item as any).itemType || 'MEDICINE',
        form: item.form,
        strength: item.strength,
        unit: item.unit,
        packSize: item.packSize,
        reorderLevel: item.reorderLevel,
        retailPrice: item.retailPrice,
        isActive: true,
      },
      create: {
        name: item.name,
        genericName: item.genericName,
        category: item.category,
        itemType: (item as any).itemType || 'MEDICINE',
        form: item.form,
        strength: item.strength,
        unit: item.unit,
        packSize: item.packSize,
        reorderLevel: item.reorderLevel,
        retailPrice: item.retailPrice,
        barcode: item.barcode,
        isActive: true,
      },
    });
    medMap[item.name] = med;

    const batchNumber = `BATCH-DEMO-${String(i + 1).padStart(3, '0')}`;
    await prisma.stockBatch.upsert({
      where: { medicineId_batchNumber: { medicineId: med.id, batchNumber } },
      update: {},
      create: {
        medicineId: med.id,
        batchNumber,
        expiryDate: (item as any).nearLow ? nearExpiry : nextYear,
        initialQuantity: item.qty,
        currentQuantity: item.qty,
        unitPrice: item.retailPrice,
        costPrice: item.costPrice,
      },
    });
  }

  // Ensure 1 sample PurchaseOrder exists
  const poCount = await prisma.purchaseOrder.count();
  if (poCount === 0 && mainSupplier && medMap['Paracetamol 500mg'] && medMap['Amoxicillin 500mg']) {
    await prisma.purchaseOrder.create({
      data: {
        supplierId: mainSupplier.id,
        status: 'RECEIVED',
        totalAmount: 15700,
        items: {
          create: [
            { medicineId: medMap['Paracetamol 500mg'].id, quantity: 1000, unitPrice: 2.5, totalPrice: 2500 },
            { medicineId: medMap['Amoxicillin 500mg'].id, quantity: 600, unitPrice: 22, totalPrice: 13200 },
          ],
        },
      },
    });
  }

  return medMap;
}

async function seedLabAndExtraServices(roomMap: Record<string, string>) {
  console.log('[7/10] Seeding lab tests (in-house biomarkers & outsourced) + extra services...');

  const labProfiles = [
    {
      name: 'Complete Blood Count (CBC)',
      code: 'CBC01',
      price: 1500,
      category: 'Haematology',
      sampleType: 'EDTA Blood',
      room: 'LAB-A',
      biomarkers: [
        { name: 'TOTAL WHITE CELL COUNT', category: null, unit: '10^9/L', referenceRange: '4.0 - 11.0', orderIndex: 1 },
        { name: 'NEUTROPHILS', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '40% - 80%', orderIndex: 2 },
        { name: 'LYMPHOCYTES', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '20% - 40%', orderIndex: 3 },
        { name: 'MONOCYTES', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '02% - 10%', orderIndex: 4 },
        { name: 'EOSINOPHILS', category: 'DIFFERENTIAL COUNT', unit: '%', referenceRange: '01% - 06%', orderIndex: 5 },
        { name: 'HAEMOGLOBIN', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: 'g/dL', referenceRange: '11.8 - 14.8', orderIndex: 6 },
        { name: 'RED BLOOD CELLS', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: '10^12/L', referenceRange: '3.8 - 4.8', orderIndex: 7 },
        { name: 'PLATELET COUNT', category: 'HAEMOGLOBIN AND RBC PARAMETERS', unit: '10^9/L', referenceRange: '150 - 400', orderIndex: 8 },
      ],
    },
    {
      name: 'Lipid Profile',
      code: 'LIP01',
      price: 2500,
      category: 'Biochemistry',
      sampleType: 'Serum / Fasting Blood',
      room: 'LAB-A',
      biomarkers: [
        { name: 'TOTAL CHOLESTEROL', category: null, unit: 'mg/dL', referenceRange: '< 200', orderIndex: 1 },
        { name: 'TRIGLYCERIDES', category: null, unit: 'mg/dL', referenceRange: '< 150', orderIndex: 2 },
        { name: 'HDL CHOLESTEROL', category: null, unit: 'mg/dL', referenceRange: '> 40', orderIndex: 3 },
        { name: 'LDL CHOLESTEROL', category: null, unit: 'mg/dL', referenceRange: '< 100', orderIndex: 4 },
        { name: 'CHOL / HDL RATIO', category: 'RATIOS', unit: 'Ratio', referenceRange: '< 5.0', orderIndex: 5 },
      ],
    },
    {
      name: 'Liver Function Test (LFT)',
      code: 'LFT02',
      price: 2000,
      category: 'Biochemistry',
      sampleType: 'Serum',
      room: 'LAB-A',
      biomarkers: [
        { name: 'TOTAL PROTEIN', category: null, unit: 'g/dL', referenceRange: '6.4 - 8.3', orderIndex: 1 },
        { name: 'ALBUMIN', category: null, unit: 'g/dL', referenceRange: '3.5 - 5.0', orderIndex: 2 },
        { name: 'TOTAL BILIRUBIN', category: null, unit: 'mg/dL', referenceRange: '0.2 - 1.2', orderIndex: 3 },
        { name: 'SGOT (AST)', category: 'ENZYMES', unit: 'U/L', referenceRange: '< 40', orderIndex: 4 },
        { name: 'SGPT (ALT)', category: 'ENZYMES', unit: 'U/L', referenceRange: '< 41', orderIndex: 5 },
      ],
    },
    {
      name: 'Renal Profile / Kidney Function Test',
      code: 'RFT01',
      price: 1800,
      category: 'Biochemistry',
      sampleType: 'Serum',
      room: 'LAB-A',
      biomarkers: [
        { name: 'BLOOD UREA', category: null, unit: 'mg/dL', referenceRange: '15 - 45', orderIndex: 1 },
        { name: 'SERUM CREATININE', category: null, unit: 'mg/dL', referenceRange: '0.7 - 1.4', orderIndex: 2 },
        { name: 'SERUM URIC ACID', category: null, unit: 'mg/dL', referenceRange: '3.5 - 7.2', orderIndex: 3 },
        { name: 'SERUM SODIUM (Na+)', category: 'ELECTROLYTES', unit: 'mEq/L', referenceRange: '135 - 145', orderIndex: 4 },
        { name: 'SERUM POTASSIUM (K+)', category: 'ELECTROLYTES', unit: 'mEq/L', referenceRange: '3.5 - 5.1', orderIndex: 5 },
      ],
    },
    {
      name: 'Thyroid Profile (T3, T4, TSH)',
      code: 'THY01',
      price: 3000,
      category: 'Immunology',
      sampleType: 'Serum',
      room: 'LAB-B',
      biomarkers: [
        { name: 'TOTAL T3', category: null, unit: 'ng/dL', referenceRange: '60 - 200', orderIndex: 1 },
        { name: 'TOTAL T4', category: null, unit: 'ug/dL', referenceRange: '4.5 - 12.0', orderIndex: 2 },
        { name: 'TSH (Ultrasensitive)', category: null, unit: 'uIU/mL', referenceRange: '0.3 - 5.5', orderIndex: 3 },
      ],
    },
    {
      name: 'Urine Full Report (UFR)',
      code: 'UFR01',
      price: 800,
      category: 'Clinical Pathology',
      sampleType: 'Urine',
      room: 'LAB-B',
      biomarkers: [
        { name: 'COLOR', category: 'PHYSICAL EXAMINATION', unit: '', referenceRange: 'PALE YELLOW', orderIndex: 1 },
        { name: 'APPEARANCE', category: 'PHYSICAL EXAMINATION', unit: '', referenceRange: 'CLEAR', orderIndex: 2 },
        { name: 'PROTEIN (ALBUMIN)', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: 'NIL', orderIndex: 3 },
        { name: 'SUGAR (GLUCOSE)', category: 'CHEMICAL EXAMINATION', unit: '', referenceRange: 'NIL', orderIndex: 4 },
        { name: 'PUS CELLS', category: 'MICROSCOPIC EXAMINATION', unit: '/HPF', referenceRange: '0 - 5', orderIndex: 5 },
      ],
    },
    {
      name: 'Fasting Blood Sugar (FBS)',
      code: 'FBS01',
      price: 500,
      category: 'Biochemistry',
      sampleType: 'Fasting Blood',
      room: 'LAB-A',
      biomarkers: [
        { name: 'FASTING BLOOD SUGAR (FBS)', category: null, unit: 'mg/dL', referenceRange: '70 - 100', orderIndex: 1 },
      ],
    },
  ];

  const labMap: Record<string, any> = {};
  for (const profile of labProfiles) {
    const existing = await prisma.labTest.findUnique({ where: { code: profile.code } });
    if (existing) {
      await prisma.labTestBiomarker.deleteMany({ where: { labTestId: existing.id } });
      await prisma.labTestBiomarker.createMany({
        data: profile.biomarkers.map((b) => ({ ...b, labTestId: existing.id })),
      });
      labMap[profile.code] = await prisma.labTest.update({
        where: { id: existing.id },
        data: { roomId: roomMap[profile.room] ?? null, price: profile.price, isActive: true },
      });
    } else {
      labMap[profile.code] = await prisma.labTest.create({
        data: {
          name: profile.name,
          code: profile.code,
          price: profile.price,
          category: profile.category,
          sampleType: profile.sampleType,
          roomId: roomMap[profile.room] ?? null,
          isActive: true,
          biomarkers: { create: profile.biomarkers },
        },
      });
    }
  }

  const outsourcedTests = [
    { name: 'HbA1c (Asiri Labs)', code: 'OUT_HBA1C', price: 2400, outsourceCost: 1850, hospitalCommission: 550, outsourcedCenter: 'Asiri Laboratories' },
    { name: 'Vitamin D Total (Nawaloka)', code: 'OUT_VITD', price: 6500, outsourceCost: 5200, hospitalCommission: 1300, outsourcedCenter: 'Nawaloka Metropolis' },
    { name: 'Serum Ferritin (Rubimus)', code: 'OUT_FERRITIN', price: 4200, outsourceCost: 3400, hospitalCommission: 800, outsourcedCenter: 'Rubimus Diagnostics' },
    { name: 'Dengue NS1 Antigen Rapid', code: 'DEN01', price: 1800, outsourceCost: 1350, hospitalCommission: 450, outsourcedCenter: 'Asiri Laboratories' },
  ];

  for (const ot of outsourcedTests) {
    labMap[ot.code] = await prisma.labTest.upsert({
      where: { code: ot.code },
      update: {
        name: ot.name,
        price: ot.price,
        category: 'Outsourced',
        isOutsideTest: true,
        outsourceCost: ot.outsourceCost,
        hospitalCommission: ot.hospitalCommission,
        commissionType: 'FLAT',
        outsourcedCenter: ot.outsourcedCenter,
        isActive: true,
      },
      create: {
        name: ot.name,
        code: ot.code,
        price: ot.price,
        category: 'Outsourced',
        sampleType: 'Blood / Serum',
        isOutsideTest: true,
        outsourceCost: ot.outsourceCost,
        hospitalCommission: ot.hospitalCommission,
        commissionType: 'FLAT',
        outsourcedCenter: ot.outsourcedCenter,
        isActive: true,
      },
    });
  }

  const extraServicesData = [
    { title: 'ECG 12-Lead', description: 'Standard 12-lead resting electrocardiogram with trace print', price: 1500, barcode: 'EXT-ECG-001', room: 'EXT-01' },
    { title: 'Nebulization Therapy', description: 'Respiratory salbutamol / saline nebulizer session', price: 800, barcode: 'EXT-NEB-002', room: 'EXT-01' },
    { title: 'Wound Dressing (Standard)', description: 'Sterile dressing and antiseptic wound care', price: 1200, barcode: 'EXT-WND-003', room: 'EXT-02' },
    { title: 'IV Cannulation & Fluid Drip', description: 'Peripheral venous cannulation and IV infusion setup', price: 2200, barcode: 'EXT-IVD-004', room: 'EXT-02' },
    { title: 'Intramuscular (IM) Injection', description: 'Safe clinical IM medication administration', price: 500, barcode: 'EXT-INJ-005', room: 'EXT-02' },
    { title: 'BP, Weight & SpO2 Triage Screening', description: 'Comprehensive outpatient vitals check', price: 350, barcode: 'EXT-VIT-006', room: 'EXT-01' },
  ];

  const serviceMap: Record<string, any> = {};
  for (const svc of extraServicesData) {
    serviceMap[svc.barcode] = await prisma.extraService.upsert({
      where: { barcode: svc.barcode },
      update: { title: svc.title, description: svc.description, price: svc.price, roomId: roomMap[svc.room] ?? null, isActive: true },
      create: { title: svc.title, description: svc.description, price: svc.price, barcode: svc.barcode, roomId: roomMap[svc.room] ?? null, isActive: true },
    });
  }

  return { labMap, serviceMap };
}

async function seedPatientsWorkflowAndFinance(
  userMap: Record<string, any>,
  roomMap: Record<string, string>,
  todaySessions: Record<string, any>,
  medMap: Record<string, any>,
  labMap: Record<string, any>,
  serviceMap: Record<string, any>
) {
  console.log('[8/10] Seeding demo patients...');

  const patientsData = [
    { patientId: 'SLMF-1001', identityKey: 'nimalperera0771110001', fullName: 'Nimal Perera', phone: '0771110001', gender: 'Male', dateOfBirth: new Date('1982-04-12'), nic: '821034567V', bloodGroup: 'O+', address: '12, Galle Road, Colombo 03' },
    { patientId: 'SLMF-1002', identityKey: 'kamalifernando0771110002', fullName: 'Kamali Fernando', phone: '0771110002', gender: 'Female', dateOfBirth: new Date('1991-09-25'), nic: '917654321V', bloodGroup: 'A+', address: '45, Ward Place, Colombo 07' },
    { patientId: 'SLMF-1003', identityKey: 'sunilbandara0771110003', fullName: 'Sunil Bandara', phone: '0771110003', gender: 'Male', dateOfBirth: new Date('1975-02-18'), nic: '750491234V', bloodGroup: 'B+', address: '88, Highlevel Road, Nugegoda' },
    { patientId: 'SLMF-1004', identityKey: 'amarakumari0771110004', fullName: 'Amara Kumari', phone: '0771110004', gender: 'Female', dateOfBirth: new Date('1996-11-08'), nic: '199681203456', bloodGroup: 'AB+', address: '27, Havelock Road, Colombo 05' },
    { patientId: 'SLMF-1005', identityKey: 'ruwansilva0771110005', fullName: 'Ruwan Silva', phone: '0771110005', gender: 'Male', dateOfBirth: new Date('1988-06-30'), nic: '881823456V', bloodGroup: 'O-', address: '104, Nawala Road, Rajagiriya' },
    { patientId: 'SLMF-1006', identityKey: 'dilhanijayasuriya0771110006', fullName: 'Dilhani Jayasuriya', phone: '0771110006', gender: 'Female', dateOfBirth: new Date('2018-03-14'), nic: null, bloodGroup: 'A-', address: '9, Marine Drive, Dehiwala' },
  ];

  const patients: any[] = [];
  for (const p of patientsData) {
    const saved = await prisma.patient.upsert({
      where: { patientId: p.patientId },
      update: { fullName: p.fullName, phone: p.phone, gender: p.gender, address: p.address, bloodGroup: p.bloodGroup },
      create: p,
    });
    patients.push(saved);
  }

  console.log('[9/10] Seeding appointments, prescriptions, lab requests, and extra service orders...');

  const dr1 = userMap['dr1@slmediflow.com'];
  const dr2 = userMap['dr2@slmediflow.com'];
  const dr3 = userMap['dr3@slmediflow.com'];
  const dr1Session = todaySessions['dr1@slmediflow.com'];
  const dr2Session = todaySessions['dr2@slmediflow.com'];
  const dr3Session = todaySessions['dr3@slmediflow.com'];

  const demoAppointments = [
    { ref: 'DEMO-REF-001', token: '01', patient: patients[0], doctor: dr1, session: dr1Session, room: roomMap['ROOM 01'], dept: 'OPD', status: 'COMPLETED', dayOffset: 0 },
    { ref: 'DEMO-REF-002', token: '02', patient: patients[1], doctor: dr1, session: dr1Session, room: roomMap['ROOM 01'], dept: 'OPD', status: 'IN_PROGRESS', dayOffset: 0 },
    { ref: 'DEMO-REF-003', token: '03', patient: patients[2], doctor: dr1, session: dr1Session, room: roomMap['ROOM 01'], dept: 'OPD', status: 'CHECKED_IN', dayOffset: 0 },
    { ref: 'DEMO-REF-004', token: '01', patient: patients[3], doctor: dr2, session: dr2Session, room: roomMap['ROOM 04'], dept: 'CARDIOLOGY', status: 'CHECKED_IN', dayOffset: 0 },
    { ref: 'DEMO-REF-005', token: '01', patient: patients[5], doctor: dr3, session: dr3Session, room: roomMap['ROOM 03'], dept: 'PEDIATRICS', status: 'BOOKED', dayOffset: 0 },
  ];

  const createdAppts: any[] = [];
  for (const a of demoAppointments) {
    let existing = await prisma.appointment.findFirst({ where: { bookingReference: a.ref } });
    if (!existing) {
      existing = await prisma.appointment.create({
        data: {
          tokenNumber: a.token,
          patientId: a.patient.id,
          doctorId: a.doctor.id,
          sessionId: a.session?.id ?? null,
          roomId: a.room ?? null,
          department: a.dept,
          appointmentDate: startOfDayUTC(a.dayOffset),
          status: a.status,
          bookingType: 'WALK_IN',
          bookingReference: a.ref,
          checkedInAt: ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].includes(a.status) ? new Date() : null,
          calledAt: ['IN_PROGRESS', 'COMPLETED'].includes(a.status) ? new Date() : null,
          completedAt: a.status === 'COMPLETED' ? new Date() : null,
        },
      });
    }
    createdAppts.push(existing);
  }

  // Pending Prescriptions for Pharmacy/POS workflow
  const demoPrescriptions = [
    {
      visitId: 'DEMO-RX-VISIT-001',
      patient: patients[0],
      doctor: dr1,
      diagnosis: 'Acute Upper Respiratory Infection',
      clinicalNotes: 'Hydration & rest advised. Review in 5 days if fever persists.',
      fee: 1500,
      items: [
        { drug: 'Amoxicillin 500mg', dosage: '1 capsule', frequency: 'TDS', duration: '5 days', instructions: 'Take after meals', qty: 15 },
        { drug: 'Paracetamol 500mg', dosage: '2 tablets', frequency: 'TDS', duration: '3 days', instructions: 'When fever > 38C', qty: 18 },
        { drug: 'Cough Syrup (Dextromethorphan)', dosage: '10ml', frequency: 'TDS', duration: '5 days', instructions: 'Shake bottle well', qty: 1 },
      ],
    },
    {
      visitId: 'DEMO-RX-VISIT-002',
      patient: patients[2],
      doctor: dr2,
      diagnosis: 'Essential Hypertension & Dyslipidaemia Follow-up',
      clinicalNotes: 'BP 138/86 mmHg. Continue regular medication for 30 days.',
      fee: 3000,
      items: [
        { drug: 'Amlodipine 5mg', dosage: '1 tablet', frequency: 'OD', duration: '30 days', instructions: 'Morning', qty: 30 },
        { drug: 'Losartan 50mg', dosage: '1 tablet', frequency: 'OD', duration: '30 days', instructions: 'Morning', qty: 30 },
        { drug: 'Atorvastatin 10mg', dosage: '1 tablet', frequency: 'OD', duration: '30 days', instructions: 'Night', qty: 30 },
      ],
    },
    {
      visitId: 'DEMO-RX-VISIT-003',
      patient: patients[3],
      doctor: dr1,
      diagnosis: 'Acute Gastritis',
      clinicalNotes: 'Avoid spicy food & NSAIDs.',
      fee: 1500,
      items: [
        { drug: 'Omeprazole 20mg', dosage: '1 capsule', frequency: 'OD', duration: '14 days', instructions: '30 mins before breakfast', qty: 14 },
        { drug: 'Domperidone 10mg', dosage: '1 tablet', frequency: 'TDS', duration: '7 days', instructions: 'Before meals', qty: 21 },
      ],
    },
  ];

  for (const rx of demoPrescriptions) {
    const exists = await prisma.prescription.findFirst({ where: { visitId: rx.visitId } });
    if (!exists) {
      await prisma.prescription.create({
        data: {
          visitId: rx.visitId,
          patientId: rx.patient.id,
          patientName: rx.patient.fullName,
          doctorId: rx.doctor.id,
          doctorName: rx.doctor.fullName,
          diagnosis: rx.diagnosis,
          clinicalNotes: rx.clinicalNotes,
          consultationFee: rx.fee,
          status: 'PENDING',
          items: {
            create: rx.items.map((item) => {
              const med = medMap[item.drug];
              return {
                medicineId: med?.id ?? null,
                drugName: item.drug,
                strength: med?.strength ?? null,
                dosage: item.dosage,
                frequency: item.frequency,
                duration: item.duration,
                instructions: item.instructions,
                dispenseQty: item.qty,
                quantity: item.qty,
                status: 'ACTIVE',
              };
            }),
          },
        },
      });
    }
  }

  // Lab Requests (1 PENDING for LabTech queue, 1 PUBLISHED with results)
  const labReqCount = await prisma.labRequest.count();
  if (labReqCount === 0 && labMap['CBC01'] && labMap['FBS01'] && labMap['LIP01']) {
    await prisma.labRequest.create({
      data: {
        patientId: patients[1].id,
        doctorId: dr1.id,
        visitId: createdAppts[1]?.id ?? null,
        status: 'PENDING',
        priority: 'ROUTINE',
        items: {
          create: [
            { labTestId: labMap['CBC01'].id, price: labMap['CBC01'].price },
            { labTestId: labMap['FBS01'].id, price: labMap['FBS01'].price },
          ],
        },
      },
    });

    await prisma.labRequest.create({
      data: {
        patientId: patients[0].id,
        doctorId: dr1.id,
        visitId: createdAppts[0]?.id ?? null,
        status: 'COMPLETED',
        priority: 'ROUTINE',
        items: {
          create: [{ labTestId: labMap['LIP01'].id, price: labMap['LIP01'].price }],
        },
        results: {
          create: [
            { biomarker: 'TOTAL CHOLESTEROL', value: '188', flag: 'N', referenceRange: '< 200', isOutOfRange: false },
            { biomarker: 'TRIGLYCERIDES', value: '132', flag: 'N', referenceRange: '< 150', isOutOfRange: false },
            { biomarker: 'HDL CHOLESTEROL', value: '48', flag: 'N', referenceRange: '> 40', isOutOfRange: false },
            { biomarker: 'LDL CHOLESTEROL', value: '114', flag: 'H', referenceRange: '< 100', isOutOfRange: true },
          ],
        },
      },
    });
  }

  // Extra Service Orders
  if (serviceMap['EXT-ECG-001']) {
    const ord1 = await prisma.extraServiceOrder.findUnique({ where: { orderNumber: 'EXT-DEMO-001' } });
    if (!ord1) {
      await prisma.extraServiceOrder.create({
        data: {
          orderNumber: 'EXT-DEMO-001',
          serviceId: serviceMap['EXT-ECG-001'].id,
          patientId: patients[3].id,
          doctorId: dr2.id,
          finalPrice: 1500,
          status: 'PENDING',
          notes: 'Baseline ECG prior to cardiology consult',
        },
      });
    }
  }
  if (serviceMap['EXT-NEB-002']) {
    const ord2 = await prisma.extraServiceOrder.findUnique({ where: { orderNumber: 'EXT-DEMO-002' } });
    if (!ord2) {
      await prisma.extraServiceOrder.create({
        data: {
          orderNumber: 'EXT-DEMO-002',
          serviceId: serviceMap['EXT-NEB-002'].id,
          patientId: patients[4].id,
          doctorId: dr1.id,
          finalPrice: 800,
          status: 'IN_PROGRESS',
          notes: 'Salbutamol 2.5mg neb completed 1st cycle',
        },
      });
    }
  }

  console.log('[10/10] Seeding 7-day invoices, payments, and hospital expenses for analytics...');
  const invoiceCount = await prisma.invoice.count();
  if (invoiceCount === 0) {
    const dailyTotals = [18500, 24200, 19800, 27500, 31000, 22400, 29600];
    for (let i = 0; i < dailyTotals.length; i++) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const patient = patients[i % patients.length];
      const consultAmt = 1500 + (i % 3) * 500;
      const pharmAmt = dailyTotals[i]! - consultAmt - 1500;

      const inv = await prisma.invoice.create({
        data: {
          visitId: `DEMO-FIN-VISIT-${i}`,
          patientId: patient.id,
          subtotal: dailyTotals[i]!,
          totalAmount: dailyTotals[i]!,
          status: 'PAID',
          createdAt: dt,
          lineItems: {
            create: [
              {
                department: 'CONSULTATION',
                referenceId: dr1.id,
                description: `Consultation - ${dr1.fullName}`,
                quantity: 1,
                unitPrice: consultAmt,
                total: consultAmt,
                createdAt: dt,
              },
              {
                department: 'PHARMACY',
                description: 'OPD Pharmacy Dispensing',
                quantity: 1,
                unitPrice: pharmAmt,
                total: pharmAmt,
                createdAt: dt,
              },
              {
                department: 'LAB',
                description: 'Complete Blood Count (CBC)',
                quantity: 1,
                unitPrice: 1500,
                total: 1500,
                createdAt: dt,
              },
            ],
          },
        },
      });

      await prisma.payment.create({
        data: {
          invoiceId: inv.id,
          amount: inv.totalAmount,
          method: i % 2 === 0 ? 'CASH' : 'CARD',
          status: 'COMPLETED',
          transactionRef: `DEMO-PAY-${i}`,
          createdAt: dt,
        },
      });
    }

    await prisma.expense.createMany({
      data: [
        { category: 'UTILITIES', amount: 42000, description: 'Electricity & Water Supply - Monthly Demo', date: startOfDayUTC(-2) },
        { category: 'PHARMACY_STOCK', amount: 15700, description: 'SPC Pharmacy Purchase Settlement', date: startOfDayUTC(-1) },
        { category: 'MEDICAL_SUPPLIES', amount: 8500, description: 'Consumables & Disposables Replenishment', date: startOfDayUTC(0) },
      ],
    });
  }
}

async function main() {
  console.log('====================================================');
  console.log('SL MediFlow Comprehensive Idempotent Demo Seeder');
  console.log('====================================================');

  await seedSystemConfig();
  await seedHrAndPayrollMetadata();
  const { deptMap, roomMap } = await seedDepartmentsAndRooms();
  const userMap = await seedRolesPermissionsAndUsers(deptMap, roomMap);
  const todaySessions = await seedDoctorSchedulesAndAttendance(userMap, roomMap);
  const medMap = await seedPharmacySuppliersAndMedicines();
  const { labMap, serviceMap } = await seedLabAndExtraServices(roomMap);
  await seedPatientsWorkflowAndFinance(userMap, roomMap, todaySessions, medMap, labMap, serviceMap);

  console.log('\n====================================================');
  console.log('Demo seed completed successfully!');
  console.log('All role demo credentials share password: password123');
  console.log('====================================================');
}

main()
  .catch((err) => {
    console.error('Demo seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

