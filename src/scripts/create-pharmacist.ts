import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] || "pharmacist@slmediflow.com").toLowerCase().trim();
  const password = process.argv[3] || "Pharmacy@123";
  const fullName = process.argv[4] || "Pharmacy Staff";

  console.log(`[CREATE PHARMACIST] Creating/updating user: ${email}`);

  // 1. Find or create Pharmacist role
  let role = await prisma.role.findFirst({
    where: {
      name: {
        equals: "Pharmacist",
        mode: "insensitive"
      }
    }
  });

  if (!role) {
    console.log("[CREATE PHARMACIST] Role 'Pharmacist' not found. Creating it...");
    role = await prisma.role.create({
      data: {
        name: "Pharmacist",
        description: "Pharmacist Role"
      }
    });
  }

  // 2. Find Pharmacy department (optional)
  const department = await prisma.department.findFirst({
    where: {
      name: {
        in: ["PHARMACY", "Pharmacy"],
        mode: "insensitive"
      }
    }
  });

  // 3. Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // 4. Create or update user
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      password: hashedPassword,
      roleId: role.id,
      departmentId: department?.id || null,
      isActive: true
    },
    create: {
      email,
      fullName,
      password: hashedPassword,
      roleId: role.id,
      departmentId: department?.id || null,
      isActive: true
    }
  });

  console.log("\n=================================");
  console.log("Pharmacy User Created Successfully!");
  console.log("=================================");
  console.log(`ID:         ${user.id}`);
  console.log(`Full Name:  ${user.fullName}`);
  console.log(`Email:      ${user.email}`);
  console.log(`Password:   ${password}`);
  console.log(`Role:       ${role.name}`);
  if (department) {
    console.log(`Department: ${department.name}`);
  }
  console.log("=================================\n");
}

main()
  .catch((e) => {
    console.error("Error creating pharmacist user:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
