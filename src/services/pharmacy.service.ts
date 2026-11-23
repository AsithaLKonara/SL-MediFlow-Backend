import { prisma, withRetry } from "../lib/prisma.js";
import { BillingService } from "./billing.service.js";
import { clearCache } from "../middlewares/cache.middleware.js";

const billingService = new BillingService();

export class PharmacyService {
  async getAllMedicines(searchTerm?: string, page: number = 1, limit: number = 50) {
    const whereClause: any = { isActive: true };
    if (searchTerm) {
      whereClause.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { genericName: { contains: searchTerm, mode: 'insensitive' } },
        { barcode: { contains: searchTerm, mode: 'insensitive' } },
        { category: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      withRetry(() => prisma.medicine.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          genericName: true,
          category: true,
          itemType: true,
          form: true,
          strength: true,
          unit: true,
          packSize: true,
          retailPrice: true,
          barcode: true,
          reorderLevel: true,
          isActive: true,
          stockBatches: {
            where: { currentQuantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
            select: {
              id: true,
              batchNumber: true,
              expiryDate: true,
              currentQuantity: true,
              unitPrice: true,
            }
          },
        },
        skip,
        take: limit
      })),
      withRetry(() => prisma.medicine.count({ where: whereClause }))
    ]);
    
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async addMedicine(data: { name: string; barcode?: string; genericName?: string; category: string; itemType?: string; form?: string; strength?: string; unit: string; packSize?: number; reorderLevel?: number; baseStock?: number; basePrice?: number; expiryDate?: Date }) {
    const existingName = await prisma.medicine.findFirst({
      where: {
        name: { equals: data.name, mode: 'insensitive' },
        form: { equals: data.form || "", mode: 'insensitive' },
        strength: { equals: data.strength || "", mode: 'insensitive' }
      }
    });
    if (existingName) {
      const err = new Error(`An item with name "${data.name}" (${data.form || "N/A"}, ${data.strength || "N/A"}) already exists in the inventory.`);
      (err as any).code = 'ALREADY_EXISTS';
      (err as any).itemId = existingName.id;
      throw err;
    }
    
    return withRetry(() => prisma.$transaction(async (tx) => {
      const medicine = await tx.medicine.create({
        data: {
          name: data.name,
          barcode: data.barcode,
          genericName: data.genericName,
          category: data.category,
          itemType: data.itemType || "MEDICINE",
          form: data.form,
          strength: data.strength,
          unit: data.unit,
          packSize: data.packSize ?? 1,
          reorderLevel: data.reorderLevel,
        },
      });

      if (data.baseStock && data.baseStock > 0) {
        await tx.stockBatch.create({
          data: {
            medicineId: medicine.id,
            batchNumber: `INIT-${Date.now()}`,
            expiryDate: data.expiryDate || null,
            initialQuantity: data.baseStock,
            currentQuantity: data.baseStock,
            unitPrice: data.basePrice || 0,
          }
        });
      }

      clearCache("pharmacy/medicines").catch(() => {});
      clearCache("pharmacy/metrics").catch(() => {});
      return medicine;
    }));
  }

  // --- INVENTORY MANAGEMENT ---
  async addStockBatch(data: { medicineId: string; batchNumber: string; expiryDate?: Date; initialQuantity: number; unitPrice: number }) {
    const result = await withRetry(() => prisma.stockBatch.create({
      data: {
        ...data,
        expiryDate: data.expiryDate || null,
        currentQuantity: data.initialQuantity,
      },
    }));
    clearCache("pharmacy/medicines").catch(() => {});
    clearCache("pharmacy/metrics").catch(() => {});
    return result;
  }

  // --- DISPENSING ENGINE (FIFO LOGIC) ---
  /**
   * Dispense a medicine from stock using FIFO batch ordering.
   *
   * For syrups/liquids pass dispensedMl (volume in ml to dispense).
   * The service converts ml → bottles for stock deduction and bills per-ml.
   * For solid forms (tablets, capsules, etc.) dispensedMl must be omitted.
   */
  async dispenseMedicine(
    medicineId: string, 
    quantityToDispense: number,
    billingInfo?: { visitId?: string; patientId?: string; description?: string, skipBilling?: boolean },
    existingTx?: any,
    /** Volume in ml to dispense (syrups/liquids only). When set, overrides qty-based billing. */
    dispensedMl?: number
  ) {
    const executeLogic = async (tx: any) => {
      // Lock all batches for this medicine to serialize concurrent dispensing
      await tx.$executeRaw`SELECT id FROM "StockBatch" WHERE "medicineId" = ${medicineId} FOR UPDATE`;

      // --- Syrup/liquid path: resolve packSize for ml→bottle conversion ---
      let packSize = 1; // default: 1 dose-unit per stock unit (tablets)
      if (dispensedMl && dispensedMl > 0) {
        const med = await tx.medicine.findUnique({
          where: { id: medicineId },
          select: { packSize: true },
        });
        packSize = (med?.packSize && med.packSize > 0) ? med.packSize : 1;
        // Convert requested ml volume to bottles needed (ceil so we always pull enough)
        quantityToDispense = Math.max(1, Math.ceil(dispensedMl / packSize));
      }

      // 1. Get all available unexpired stock batches for this medicine, ordered by expiry date (FIFO)
      const availableBatches = await tx.stockBatch.findMany({
        where: {
          medicineId,
          currentQuantity: { gt: 0 },
          OR: [
            { expiryDate: null },
            { expiryDate: { gt: new Date() } }
          ]
        },
        orderBy: {
          expiryDate: 'asc', // Oldest expiry first
        },
      });

      // 2. Check if we have enough total stock
      const totalAvailable = availableBatches.reduce((sum: number, b: any) => sum + b.currentQuantity, 0);
      if (totalAvailable < quantityToDispense) {
        const availableMl = dispensedMl ? `${totalAvailable * packSize} ml` : `${totalAvailable} units`;
        const requestedMl = dispensedMl ? `${dispensedMl} ml` : `${quantityToDispense} units`;
        throw new Error(`Insufficient stock. Requested: ${requestedMl}, Available: ${availableMl}`);
      }

      let remainingToDispense = quantityToDispense;
      const batchesUsed: Array<{ batchId: string; batchNumber: string; quantityDispensed: number; unitPrice: number }> = [];

      // 3. Loop through batches and deduct stock (FIFO)
      for (const batch of availableBatches) {
        if (remainingToDispense <= 0) break;

        const quantityFromThisBatch = Math.min(batch.currentQuantity, remainingToDispense);
        
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: { currentQuantity: batch.currentQuantity - quantityFromThisBatch },
        });

        batchesUsed.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantityDispensed: quantityFromThisBatch,
          unitPrice: batch.unitPrice,
        });

        remainingToDispense -= quantityFromThisBatch;
      }

      // 4. Calculate billing cost
      // For syrups: bill proportionally by ml (dispensedMl × pricePerMl)
      // For solids: bill by whole unit (quantityDispensed × unitPrice)
      let totalCost: number;
      if (dispensedMl && dispensedMl > 0 && packSize > 1) {
        // Weighted average pricePerMl across batches used
        const totalBottlesBilled = batchesUsed.reduce((s, b) => s + b.quantityDispensed, 0);
        const weightedBottlePrice = totalBottlesBilled > 0
          ? batchesUsed.reduce((s, b) => s + (b.quantityDispensed * b.unitPrice), 0) / totalBottlesBilled
          : 0;
        const pricePerMl = Number((weightedBottlePrice / packSize).toFixed(4));
        totalCost = Number((dispensedMl * pricePerMl).toFixed(2));
      } else {
        totalCost = batchesUsed.reduce((sum: number, b: any) => sum + (b.quantityDispensed * b.unitPrice), 0);
      }

      if (billingInfo && !billingInfo.skipBilling && (billingInfo.visitId || billingInfo.patientId)) {
        if (totalCost > 0) {
          await billingService.addCharge({
            visitId: billingInfo.visitId,
            patientId: billingInfo.patientId,
            department: 'PHARMACY',
            referenceId: medicineId,
            description: billingInfo.description || 'Pharmacy Medication',
            quantity: 1,
            unitPrice: totalCost
          }, tx);
        }
      }

      return {
        success: true,
        message: dispensedMl
          ? `Successfully dispensed ${dispensedMl} ml (${quantityToDispense} bottle(s) deducted).`
          : `Successfully dispensed ${quantityToDispense} units.`,
        batchesUsed,
        totalCost,
        /** Present only for syrup dispenses */
        dispensedMl: dispensedMl ?? null,
        packSize: dispensedMl ? packSize : null,
      };
    };

    let result;
    if (existingTx) {
      result = await executeLogic(existingTx);
    } else {
      result = await withRetry(() => prisma.$transaction(executeLogic));
    }
    clearCache("pharmacy/medicines").catch(() => {});
    clearCache("pharmacy/metrics").catch(() => {});
    return result;
  }

  // --- ALERTS ---
  async getLowStockAlerts() {
    return withRetry(async () => {
      const medicines = await prisma.medicine.findMany({
        where: { isActive: true },
        include: {
          stockBatches: {
            where: { 
              currentQuantity: { gt: 0 },
              OR: [
                { expiryDate: null },
                { expiryDate: { gt: new Date() } }
              ]
            },
          },
        },
      });

      return medicines
        .map(med => ({
          id: med.id,
          name: med.name,
          totalStock: med.stockBatches.reduce((sum, b) => sum + b.currentQuantity, 0),
          reorderLevel: med.reorderLevel,
        }))
        .filter(med => med.totalStock <= med.reorderLevel);
    });
  }

  async getExpiringSoonAlerts(daysThreshold: number = 30) {
    return withRetry(async () => {
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

      return prisma.stockBatch.findMany({
        where: {
          currentQuantity: { gt: 0 },
          expiryDate: {
            lte: thresholdDate,
            gt: new Date(),
          },
        },
        include: { medicine: true },
        orderBy: { expiryDate: 'asc' },
      });
    });
  }

  /**
   * [P1 Fix] Get stock that has ALREADY expired (Ghost Inventory detection)
   */
  async getExpiredStock() {
    return withRetry(() => prisma.stockBatch.findMany({
      where: {
        currentQuantity: { gt: 0 },
        expiryDate: { lte: new Date() }
      },
      include: { medicine: true },
      orderBy: { expiryDate: 'asc' }
    }));
  }

  /**
   * [P1 Fix] Write off expired / damaged stock, zeroing quantity and logging a loss
   */
  async writeOffBatch(batchId: string, reason: string, performedBy: string) {
    return withRetry(() => prisma.$transaction(async (tx) => {
      const batch = await tx.stockBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new Error('Batch not found');
      if (batch.currentQuantity === 0) throw new Error('Batch already at zero quantity');

      const writtenOffQty = batch.currentQuantity;
      const lossValue = writtenOffQty * batch.unitPrice;

      await tx.stockBatch.update({
        where: { id: batchId },
        data: { currentQuantity: 0 }
      });

      // Log the write-off as an expense
      await tx.expense.create({
        data: {
          category: 'INVENTORY_WRITEOFF',
          description: `Stock Write-Off: Batch ${batch.batchNumber} - ${reason}`,
          amount: lossValue,
          date: new Date(),
          performedBy
        }
      });

      return { success: true, writtenOffQty, lossValue };
    }));
  }

  async getMetrics() {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pendingPrescriptions = await prisma.prescription.count({
        where: { status: "PENDING" }
      });

      const fulfilledToday = await prisma.prescription.count({
        where: {
          status: "DISPENSED",
          updatedAt: { gte: today }
        }
      });

      const allMedicines = await prisma.medicine.findMany({
        where: { isActive: true },
        select: {
          reorderLevel: true,
          stockBatches: {
            select: { currentQuantity: true }
          }
        }
      });
      let lowStockItems = 0;
      allMedicines.forEach((med: any) => {
        const stock = med.stockBatches.reduce((sum: number, b: any) => sum + b.currentQuantity, 0);
        if (stock > 0 && stock <= med.reorderLevel) lowStockItems++;
      });

      const recentPrescriptionsRaw = await prisma.prescription.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { items: true }
      });

      const recentPrescriptions = recentPrescriptionsRaw.map((rx: any) => ({
        id: rx.id,
        patientName: rx.patientName || `Patient ${rx.patientId.slice(0, 4)}`,
        doctor: rx.doctorName || "Unknown Doctor",
        drugs: rx.items.map((i: any) => `${i.drugName} ${i.dosage || ''}`.trim()),
        status: rx.status,
        issuedAt: rx.createdAt
      }));

      const pharmacyLines = await prisma.invoiceLineItem.findMany({
        where: { department: "PHARMACY", createdAt: { gte: today } }
      });
      const totalRevenue = pharmacyLines.reduce((sum: number, item: any) => sum + item.total, 0);

      return {
        pendingPrescriptions,
        fulfilledToday,
        lowStockItems,
        totalRevenue,
        recentPrescriptions
      };
    });
  }

  async updateMedicine(id: string, data: { name?: string; genericName?: string; category?: string; form?: string; strength?: string; unit?: string; packSize?: number; reorderLevel?: number; barcode?: string }) {
    if (data.name) {
      const existingName = await prisma.medicine.findFirst({
        where: {
          name: { equals: data.name, mode: 'insensitive' },
          form: { equals: data.form || "", mode: 'insensitive' },
          strength: { equals: data.strength || "", mode: 'insensitive' },
          id: { not: id }
        }
      });
      if (existingName) {
        const err = new Error(`An item with the name "${data.name}" (${data.form || "N/A"}, ${data.strength || "N/A"}) already exists in the inventory.`);
        (err as any).code = 'ALREADY_EXISTS';
        (err as any).itemId = existingName.id;
        throw err;
      }
    }
    
    const result = await withRetry(() => prisma.medicine.update({
      where: { id },
      data
    }));
    clearCache("pharmacy/medicines").catch(() => {});
    clearCache("pharmacy/metrics").catch(() => {});
    return result;
  }

  async deleteMedicine(id: string) {
    // Check if medicine has active stock batches
    const batches = await prisma.stockBatch.findMany({
      where: { medicineId: id, currentQuantity: { gt: 0 } }
    });
    if (batches.length > 0) {
      throw new Error("Cannot delete medicine with active stock. Deplete or adjust stock first.");
    }
    // Soft delete
    const result = await prisma.medicine.update({ where: { id }, data: { isActive: false } });
    clearCache("pharmacy/medicines").catch(() => {});
    clearCache("pharmacy/metrics").catch(() => {});
    return result;
  }
}

export const pharmacyService = new PharmacyService();
