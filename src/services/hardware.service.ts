export interface EscPosReceiptData {
  companyName: string;
  orderNumber: string;
  cashierName: string;
  date: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPriceLkr: number;
    totalLkr: number;
  }>;
  subtotalLkr: number;
  discountLkr: number;
  totalLkr: number;
  paymentMethod: string;
}

export interface ScaleReading {
  weight: number;
  unit: 'kg' | 'g' | 'lb';
  isStable: boolean;
  raw: string;
}

export type PoleDisplayProtocol = 'PRICE_DISPLAY' | 'CD5220' | 'ESCPOS' | 'UTC' | 'AEDEX';
export type PriceDisplayIndicator = 'NONE' | 'PRICE' | 'TOTAL' | 'COLLECT' | 'CHANGE';

export interface PoleDisplayLines {
  line1: string;
  line2: string;
}

export class HardwareService {
  /**
   * Generates raw ESC/POS byte array for 80mm / 58mm thermal printers.
   */
  static buildEscPosReceipt(data: EscPosReceiptData, paperWidth: 80 | 58 = 80): Buffer {
    const charsPerLine = paperWidth === 80 ? 48 : 32;
    const parts: number[] = [];

    // ESC @ (Initialize)
    parts.push(0x1b, 0x40);
    // ESC a 1 (Center Align)
    parts.push(0x1b, 0x61, 0x01);
    // Double Height + Double Width for Store Name
    parts.push(0x1d, 0x21, 0x11);
    parts.push(...Buffer.from(`${data.companyName}\n`, 'utf-8'));
    parts.push(0x1d, 0x21, 0x00);

    parts.push(...Buffer.from('='.repeat(charsPerLine) + '\n', 'utf-8'));

    // Left Align Header details
    parts.push(0x1b, 0x61, 0x00);
    parts.push(...Buffer.from(`Receipt: #${data.orderNumber}\n`, 'utf-8'));
    parts.push(...Buffer.from(`Cashier: ${data.cashierName}\n`, 'utf-8'));
    parts.push(...Buffer.from(`Date   : ${data.date}\n`, 'utf-8'));
    parts.push(...Buffer.from('-'.repeat(charsPerLine) + '\n', 'utf-8'));

    for (const item of data.items) {
      const line = `${item.name} x${item.quantity} - Rs. ${item.totalLkr.toFixed(0)}\n`;
      parts.push(...Buffer.from(line, 'utf-8'));
    }

    parts.push(...Buffer.from('-'.repeat(charsPerLine) + '\n', 'utf-8'));

    // Totals Section (Right Align)
    parts.push(0x1b, 0x61, 0x02);
    parts.push(...Buffer.from(`Subtotal: Rs. ${data.subtotalLkr.toLocaleString()}\n`, 'utf-8'));
    if (data.discountLkr > 0) {
      parts.push(...Buffer.from(`Discount: -Rs. ${data.discountLkr.toLocaleString()}\n`, 'utf-8'));
    }
    parts.push(...Buffer.from(`TOTAL: Rs. ${data.totalLkr.toLocaleString()}\n`, 'utf-8'));

    // Footer & Paper Cut
    parts.push(0x1b, 0x61, 0x01);
    parts.push(...Buffer.from('\nThank you for visiting SL MediFlow!\n\n\n', 'utf-8'));
    parts.push(0x1d, 0x56, 0x41, 0x10);

    return Buffer.from(parts);
  }

  /**
   * Generates ESC/POS pulse command to pop RJ11 cash drawer.
   */
  static getCashDrawerPulse(pin: 2 | 5 = 2): Buffer {
    return Buffer.from([0x1b, 0x70, pin === 5 ? 1 : 0, 25, 250]);
  }

  /**
   * Robust RS-232 serial scale parser.
   */
  static parseScaleStream(raw: string): ScaleReading {
    const clean = raw.trim();

    const casMatch = clean.match(/(ST|US),\s*(GS|NT),\s*([+-]?\s*\d+\.?\d*)\s*(kg|g|lb)/i);
    if (casMatch && casMatch[1] && casMatch[3] && casMatch[4]) {
      const isStable = casMatch[1].toUpperCase() === 'ST';
      const weight = parseFloat(casMatch[3].replace(/\s+/g, ''));
      const unit = casMatch[4].toLowerCase() as 'kg' | 'g' | 'lb';
      return { weight: Number.isNaN(weight) ? 0 : weight, unit, isStable, raw: clean };
    }

    const toledoMatch = clean.match(/(?:W:|NET|WT:)\s*([+-]?\d+\.?\d*)\s*(kg|g|lb)/i);
    if (toledoMatch && toledoMatch[1] && toledoMatch[2]) {
      const weight = parseFloat(toledoMatch[1]);
      const unit = toledoMatch[2].toLowerCase() as 'kg' | 'g' | 'lb';
      return { weight: Number.isNaN(weight) ? 0 : weight, unit, isStable: true, raw: clean };
    }

    const rawMatch = clean.match(/([+-]?\d+\.?\d*)\s*(kg|g|lb)?/i);
    if (rawMatch && rawMatch[1]) {
      const weight = parseFloat(rawMatch[1]);
      const unit = (rawMatch[2]?.toLowerCase() || 'kg') as 'kg' | 'g' | 'lb';
      return { weight: Number.isNaN(weight) ? 0 : weight, unit, isStable: true, raw: clean };
    }

    return { weight: 0, unit: 'kg', isStable: false, raw: clean };
  }

  /**
   * Cleans and pads/truncates a string to exact character width (default 20 for pole displays).
   */
  static formatPoleDisplayLine(text: string, width = 20): string {
    const clean = (text || '')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
    if (clean.length > width) {
      return clean.substring(0, width);
    }
    return clean.padEnd(width, ' ');
  }

  /**
   * Centers text within a fixed width (default 20 characters).
   */
  static centerText(text: string, width = 20): string {
    const clean = (text || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (clean.length >= width) return clean.substring(0, width);
    const leftPad = Math.floor((width - clean.length) / 2);
    const rightPad = width - clean.length - leftPad;
    return ' '.repeat(leftPad) + clean + ' '.repeat(rightPad);
  }

  /**
   * Creates a two-column row (left text + right text) fitted to exact width.
   */
  static makeTwoColumnLine(left: string, right: string, width = 20): string {
    const cleanRight = (right || '').replace(/[^\x20-\x7E]/g, '').trim();
    const availableForLeft = Math.max(0, width - cleanRight.length - 1);
    const cleanLeft = (left || '').replace(/[^\x20-\x7E]/g, '').trim().substring(0, availableForLeft);
    const spaces = Math.max(1, width - cleanLeft.length - cleanRight.length);
    return cleanLeft + ' '.repeat(spaces) + cleanRight;
  }

  /**
   * Formats Idle / Welcome screen for 2x20 customer display.
   */
  static formatPoleDisplayIdle(
    storeName = 'SL MediFlow',
    greeting = 'WELCOME! THANK YOU'
  ): PoleDisplayLines {
    return {
      line1: this.centerText(storeName, 20),
      line2: this.centerText(greeting, 20),
    };
  }

  /**
   * Formats Line item screen when cashier scans or adds an item.
   */
  static formatPoleDisplayItem(
    name: string,
    price: number,
    qty = 1,
    subtotal?: number
  ): PoleDisplayLines {
    const priceStr = price.toFixed(2);
    const line1 = this.makeTwoColumnLine(name, priceStr, 20);
    const calcSubtotal = subtotal !== undefined ? subtotal : price * qty;
    const line2 = this.makeTwoColumnLine(`QTY:${qty}`, `SUB:${calcSubtotal.toFixed(0)}`, 20);
    return { line1, line2 };
  }

  /**
   * Formats Payment pending screen showing subtotal and total due.
   */
  static formatPoleDisplayPayment(subtotal: number, totalDue: number): PoleDisplayLines {
    return {
      line1: this.makeTwoColumnLine('SUBTOTAL:', `Rs.${subtotal.toLocaleString()}`, 20),
      line2: this.makeTwoColumnLine('TOTAL DUE:', `Rs.${totalDue.toLocaleString()}`, 20),
    };
  }

  /**
   * Formats Sale Completed screen showing tender received and change due.
   */
  static formatPoleDisplayCompleted(amountPaid: number, changeDue: number): PoleDisplayLines {
    return {
      line1: this.makeTwoColumnLine('PAID CASH:', `Rs.${amountPaid.toLocaleString()}`, 20),
      line2: this.makeTwoColumnLine('CHANGE DUE:', `Rs.${changeDue.toLocaleString()}`, 20),
    };
  }

  /**
   * Builds exact single-line LED8 / VFD Price Display command buffer:
   * CLR (0x0C) + ESC s <n> + ESC Q A <numeric> CR
   */
  static buildPriceDisplayBuffer(
    amount: number | string,
    indicator: PriceDisplayIndicator = 'NONE'
  ): Buffer {
    const indicatorMap: Record<PriceDisplayIndicator, number> = {
      NONE: 0x30,
      PRICE: 0x31,
      TOTAL: 0x32,
      COLLECT: 0x33,
      CHANGE: 0x34,
    };

    let numStr = '0.00';
    if (typeof amount === 'number') {
      numStr = amount.toFixed(2);
    } else {
      const match = (amount || '').match(/-?\d+(?:\.\d+)?/);
      numStr = match?.[0] || '0.00';
    }

    const parts: number[] = [
      0x0c,
      0x1b,
      0x73,
      indicatorMap[indicator] ?? 0x30,
      0x1b,
      0x51,
      0x41,
      ...Buffer.from(numStr.substring(0, 10), 'ascii'),
      0x0d,
    ];

    return Buffer.from(parts);
  }

  /**
   * Generates binary command buffer for LED8 Price Displays & 2x20 VFD / LCD Pole Displays.
   * Supports PRICE_DISPLAY, CD5220, ESCPOS, UTC, and AEDEX.
   */
  static buildPoleDisplayBuffer(
    line1: string,
    line2: string,
    protocol: PoleDisplayProtocol = 'CD5220'
  ): Buffer {
    const l1 = this.formatPoleDisplayLine(line1, 20);
    const l2 = this.formatPoleDisplayLine(line2, 20);
    const parts: number[] = [];

    switch (protocol) {
      case 'PRICE_DISPLAY': {
        const combined = `${line1} ${line2}`;
        const noCommas = combined.replace(/,/g, '');
        let indicator = 0; // 0=Off, 1=Price, 2=Total, 3=Collect, 4=Change
        let amountStr = '0.00';

        if (/change/i.test(noCommas)) {
          indicator = 4;
          const m = noCommas.match(/\bchange(?:\s+due)?[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = m?.[1] || noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00';
        } else if (/\btotal|subtotal|due/i.test(noCommas)) {
          indicator = 2;
          const m =
            noCommas.match(/\btotal(?:\s+due)?[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i) ||
            noCommas.match(/\bsubtotal[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = m?.[1] || noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00';
        } else if (/paid|cash|collect/i.test(noCommas)) {
          indicator = 3;
          const m = noCommas.match(/\b(?:paid|cash|collect)[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = m?.[1] || noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00';
        } else if (/qty|price|item|\d+\.\d{2}/i.test(noCommas)) {
          indicator = 1;
          const m = noCommas.match(/\b(?:price|sub)?[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = m?.[1] || noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00';
        } else {
          const m = noCommas.match(/-?\d+(?:\.\d+)?/);
          amountStr = m?.[0] || '0.00';
        }

        const cleanAmount = amountStr.substring(0, 10);
        parts.push(0x0c);
        parts.push(0x1b, 0x73, 0x30 + indicator);
        parts.push(0x1b, 0x51, 0x41);
        parts.push(...Buffer.from(cleanAmount, 'ascii'));
        parts.push(0x0d);
        break;
      }

      case 'CD5220': {
        parts.push(0x1b, 0x40);
        parts.push(0x0c);
        parts.push(0x1b, 0x51, 0x41);
        parts.push(...Buffer.from(l1, 'ascii'));
        parts.push(0x0d);
        parts.push(0x1b, 0x51, 0x42);
        parts.push(...Buffer.from(l2, 'ascii'));
        parts.push(0x0d);
        break;
      }

      case 'ESCPOS': {
        parts.push(0x1b, 0x40);
        parts.push(0x0c);
        parts.push(0x1f, 0x24, 0x01, 0x01);
        parts.push(...Buffer.from(l1, 'ascii'));
        parts.push(0x1f, 0x24, 0x01, 0x02);
        parts.push(...Buffer.from(l2, 'ascii'));
        break;
      }

      case 'UTC': {
        parts.push(0x0c);
        parts.push(0x0b);
        parts.push(...Buffer.from(l1, 'ascii'));
        parts.push(0x1f, 0x42);
        parts.push(...Buffer.from(l2, 'ascii'));
        break;
      }

      case 'AEDEX': {
        parts.push(0x21, 0x23, 0x31);
        parts.push(...Buffer.from(l1, 'ascii'));
        parts.push(0x0d);
        parts.push(0x21, 0x23, 0x32);
        parts.push(...Buffer.from(l2, 'ascii'));
        parts.push(0x0d);
        break;
      }

      default: {
        parts.push(...Buffer.from(`${l1}\r\n${l2}`, 'ascii'));
        break;
      }
    }

    return Buffer.from(parts);
  }
}

