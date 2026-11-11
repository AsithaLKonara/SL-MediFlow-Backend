import assert from "node:assert/strict";
import { HardwareService } from "../services/hardware.service.js";

console.log("=== Running SL MediFlow Pole Display Protocol & Formatter Tests ===\n");

// 1. 2x20 Character Layout & Text Formatter
console.log("Test 1: 2x20 Character Layout & Text Formatter");
const padded = HardwareService.formatPoleDisplayLine("HELLO");
assert.equal(padded.length, 20);
assert.equal(padded, "HELLO               ");

const truncated = HardwareService.formatPoleDisplayLine(
  "This is an excessively long product name that exceeds 20 characters"
);
assert.equal(truncated.length, 20);
assert.equal(truncated, "This is an excessive");

const cleaned = HardwareService.formatPoleDisplayLine("ITEM \x00\x07A \t \n");
assert.equal(cleaned.length, 20);
assert.ok(cleaned.startsWith("ITEM A"));

const idle = HardwareService.formatPoleDisplayIdle("SL MediFlow", "WELCOME!");
assert.equal(idle.line1.length, 20);
assert.equal(idle.line2.length, 20);
assert.equal(idle.line1, "    SL MediFlow     ");
assert.equal(idle.line2, "      WELCOME!      ");

const item = HardwareService.formatPoleDisplayItem("Fresh Milk 1L", 250.0, 2, 500.0);
assert.equal(item.line1, "Fresh Milk 1L 250.00");
assert.equal(item.line2, "QTY:2        SUB:500");

const payment = HardwareService.formatPoleDisplayPayment(1450, 1350);
assert.equal(payment.line1, "SUBTOTAL:   Rs.1,450");
assert.equal(payment.line2, "TOTAL DUE:  Rs.1,350");

const done = HardwareService.formatPoleDisplayCompleted(2000, 650);
assert.equal(done.line1, "PAID CASH:  Rs.2,000");
assert.equal(done.line2, "CHANGE DUE:   Rs.650");
console.log("✔ PASS: All 2x20 formatting helpers passed.\n");

// 2. PRICE_DISPLAY (ESC Q A) Protocol
console.log("Test 2: PRICE_DISPLAY (ESC Q A) LED8 Binary Protocol");
const priceBuf = HardwareService.buildPoleDisplayBuffer(
  "Paracetamol   750.00",
  "QTY:1        SUB:750",
  "PRICE_DISPLAY"
);
assert.equal(priceBuf[0], 0x0c);
assert.equal(priceBuf[1], 0x1b);
assert.equal(priceBuf[2], 0x73);
assert.equal(priceBuf[3], 0x31); // Price lamp
assert.equal(priceBuf[4], 0x1b);
assert.equal(priceBuf[5], 0x51);
assert.equal(priceBuf[6], 0x41);
assert.equal(priceBuf.subarray(7, 13).toString("ascii"), "750.00");
assert.equal(priceBuf[13], 0x0d);

const totalBuf = HardwareService.buildPoleDisplayBuffer(
  "SUBTOTAL: Rs.1,450",
  "TOTAL DUE: Rs.1,350",
  "PRICE_DISPLAY"
);
assert.equal(totalBuf[3], 0x32); // Total lamp
assert.equal(totalBuf.subarray(7, 11).toString("ascii"), "1350");

const changeBuf = HardwareService.buildPoleDisplayBuffer(
  "PAID CASH: Rs.2,000",
  "CHANGE DUE: Rs.650",
  "PRICE_DISPLAY"
);
assert.equal(changeBuf[3], 0x34); // Change lamp
assert.equal(changeBuf.subarray(7, 10).toString("ascii"), "650");

const collectBuf = HardwareService.buildPriceDisplayBuffer(1500, "COLLECT");
assert.equal(collectBuf[0], 0x0c);
assert.equal(collectBuf[1], 0x1b);
assert.equal(collectBuf[2], 0x73);
assert.equal(collectBuf[3], 0x33); // Collect lamp
assert.equal(collectBuf.subarray(7, 14).toString("ascii"), "1500.00");
console.log("✔ PASS: PRICE_DISPLAY indicator & numeric frames verified.\n");

const l1 = "SL MEDIFLOW CLINIC  ";
const l2 = "WELCOME TO PHARMACY!";

// 3. CD5220 Protocol
console.log("Test 3: CD5220 Binary Protocol");
const cdBuf = HardwareService.buildPoleDisplayBuffer(l1, l2, "CD5220");
assert.equal(cdBuf[0], 0x1b);
assert.equal(cdBuf[1], 0x40);
assert.equal(cdBuf[2], 0x0c);
assert.equal(cdBuf[3], 0x1b);
assert.equal(cdBuf[4], 0x51);
assert.equal(cdBuf[5], 0x41);
assert.equal(cdBuf.subarray(6, 26).toString("ascii"), l1);
assert.equal(cdBuf[26], 0x0d);
assert.equal(cdBuf[27], 0x1b);
assert.equal(cdBuf[28], 0x51);
assert.equal(cdBuf[29], 0x42);
assert.equal(cdBuf.subarray(30, 50).toString("ascii"), l2);
assert.equal(cdBuf[50], 0x0d);
console.log("✔ PASS: CD5220 byte sequence verified.\n");

// 4. ESCPOS Protocol
console.log("Test 4: ESC/POS Binary Protocol");
const escBuf = HardwareService.buildPoleDisplayBuffer(l1, l2, "ESCPOS");
assert.equal(escBuf[0], 0x1b);
assert.equal(escBuf[1], 0x40);
assert.equal(escBuf[2], 0x0c);
assert.equal(escBuf[3], 0x1f);
assert.equal(escBuf[4], 0x24);
assert.equal(escBuf[5], 0x01);
assert.equal(escBuf[6], 0x01);
assert.equal(escBuf.subarray(7, 27).toString("ascii"), l1);
assert.equal(escBuf[27], 0x1f);
assert.equal(escBuf[28], 0x24);
assert.equal(escBuf[29], 0x01);
assert.equal(escBuf[30], 0x02);
assert.equal(escBuf.subarray(31, 51).toString("ascii"), l2);
console.log("✔ PASS: ESC/POS byte sequence verified.\n");

// 5. UTC Protocol
console.log("Test 5: UTC Binary Protocol");
const utcBuf = HardwareService.buildPoleDisplayBuffer(l1, l2, "UTC");
assert.equal(utcBuf[0], 0x0c);
assert.equal(utcBuf[1], 0x0b);
assert.equal(utcBuf.subarray(2, 22).toString("ascii"), l1);
assert.equal(utcBuf[22], 0x1f);
assert.equal(utcBuf[23], 0x42);
assert.equal(utcBuf.subarray(24, 44).toString("ascii"), l2);
console.log("✔ PASS: UTC byte sequence verified.\n");

// 6. AEDEX Protocol
console.log("Test 6: AEDEX Binary Protocol");
const aedexBuf = HardwareService.buildPoleDisplayBuffer(l1, l2, "AEDEX");
assert.equal(aedexBuf[0], 0x21);
assert.equal(aedexBuf[1], 0x23);
assert.equal(aedexBuf[2], 0x31);
assert.equal(aedexBuf.subarray(3, 23).toString("ascii"), l1);
assert.equal(aedexBuf[23], 0x0d);
assert.equal(aedexBuf[24], 0x21);
assert.equal(aedexBuf[25], 0x23);
assert.equal(aedexBuf[26], 0x32);
assert.equal(aedexBuf.subarray(27, 47).toString("ascii"), l2);
assert.equal(aedexBuf[47], 0x0d);
console.log("✔ PASS: AEDEX byte sequence verified.\n");

console.log("ALL POLE DISPLAY PROTOCOL TESTS PASSED SUCCESSFULLY!");

