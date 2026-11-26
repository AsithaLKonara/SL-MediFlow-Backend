/**
 * Helper to get timezone-aware start of day (midnight) and end of day.
 * If TIMEZONE env var is not set, defaults to Asia/Colombo for SL MediFlow.
 */
export function getTimezoneBoundaries(dateInput: Date | string = new Date(), timezone: string = process.env.TIMEZONE || 'Asia/Colombo') {
  let date: Date;
  let yearStr = '';
  let monthStr = '';
  let dayStr = '';

  if (typeof dateInput === 'string') {
    const match = dateInput.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match && match[1] && match[2] && match[3]) {
      yearStr = match[1];
      monthStr = match[2];
      dayStr = match[3];
      // Noon in UTC for this date to avoid edge clipping across timezones
      date = new Date(`${yearStr}-${monthStr}-${dayStr}T12:00:00.000Z`);
    } else {
      date = new Date(dateInput);
    }
  } else {
    date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  }

  if (isNaN(date.getTime())) {
    date = new Date();
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(date);
  const year = yearStr || parts.find(p => p.type === 'year')?.value;
  const month = monthStr || parts.find(p => p.type === 'month')?.value;
  const day = dayStr || parts.find(p => p.type === 'day')?.value;

  const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZoneName: 'longOffset', timeZone: timezone });
  const offsetStringMatch = offsetFormatter.format(date).match(/GMT([+-]\d{2}:\d{2})/);
  const offsetString = offsetStringMatch ? offsetStringMatch[1] : '+05:30';
  
  const startOfDayTz = new Date(`${year}-${month}-${day}T00:00:00.000${offsetString}`);
  const endOfDayTz = new Date(`${year}-${month}-${day}T23:59:59.999${offsetString}`);
  const firstDayOfMonthTz = new Date(`${year}-${month}-01T00:00:00.000${offsetString}`);

  // Weekday in target timezone (0=Sun, 1=Mon, ..., 6=Sat)
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const weekdayStr = weekdayFormatter.format(startOfDayTz);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekdayStr] !== undefined ? dayMap[weekdayStr] : startOfDayTz.getDay();

  return {
    startOfDay: startOfDayTz,
    endOfDay: endOfDayTz,
    firstDayOfMonth: firstDayOfMonthTz,
    dayOfWeek
  };
}

/**
 * Returns the day of week (0=Sun, 1=Mon, ..., 6=Sat) in Asia/Colombo for a given date.
 */
export function getColomboDayOfWeek(date: Date | string = new Date()): number {
  return getTimezoneBoundaries(date, 'Asia/Colombo').dayOfWeek;
}

export interface ParsedAge {
  valid: boolean;
  value: number;
  unit: 'M' | 'Y';
  error?: string;
}

/**
 * Validates and parses an age input string or number.
 * Accepts formats:
 * - "11M", "11m" -> 11 months (valid 1-240)
 * - "25Y", "25y" -> 25 years (valid 1-130)
 * - "25", 25 -> 25 years (valid 1-130, defaults to Y)
 */
export function parseAgeString(ageInput: string | number | null | undefined): ParsedAge {
  if (ageInput === undefined || ageInput === null || String(ageInput).trim() === '') {
    return { valid: false, value: 0, unit: 'Y', error: 'Valid Patient Age (1-130) is mandatory for token generation.' };
  }
  const match = String(ageInput).trim().match(/^(\d+)\s*([mMyY]?)$/);
  if (!match || !match[1]) {
    return { valid: false, value: 0, unit: 'Y', error: 'Valid Patient Age (1-130) is mandatory for token generation.' };
  }
  const value = parseInt(match[1], 10);
  const unit = (match[2] || 'Y').toUpperCase() as 'M' | 'Y';

  if (unit === 'M') {
    if (value <= 0 || value > 240) {
      return { valid: false, value, unit, error: 'Valid Patient Age in months (1-240) is mandatory for token generation.' };
    }
  } else {
    if (value <= 0 || value > 130) {
      return { valid: false, value, unit, error: 'Valid Patient Age (1-130) is mandatory for token generation.' };
    }
  }
  return { valid: true, value, unit };
}

/**
 * Calculates dateOfBirth and ageFallback from parsed age, anchored to Asia/Colombo boundaries.
 * Clamps days to the target month's maximum to prevent end-of-month JavaScript Date rollover (e.g. March 31 - 11M).
 */
export function calculateDobAndFallback(parsed: ParsedAge, referenceDate: Date = new Date()): { dob: Date; ageFallback: number } {
  const boundaries = getTimezoneBoundaries(referenceDate, 'Asia/Colombo');
  const ref = new Date(boundaries.startOfDay);
  const dob = new Date(ref);
  if (parsed.unit === 'M') {
    const originalDay = ref.getDate();
    const targetTotalMonths = ref.getFullYear() * 12 + ref.getMonth() - parsed.value;
    const targetYear = Math.floor(targetTotalMonths / 12);
    const targetMonth = ((targetTotalMonths % 12) + 12) % 12;
    const maxDays = new Date(targetYear, targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(originalDay, maxDays);
    dob.setFullYear(targetYear, targetMonth, clampedDay);
    return { dob, ageFallback: Math.floor(parsed.value / 12) };
  } else {
    const originalDay = ref.getDate();
    const targetYear = ref.getFullYear() - parsed.value;
    const targetMonth = ref.getMonth();
    const maxDays = new Date(targetYear, targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(originalDay, maxDays);
    dob.setFullYear(targetYear, targetMonth, clampedDay);
    return { dob, ageFallback: parsed.value };
  }
}

/**
 * Formats patient age for display/API response.
 * If dob is present and elapsed months < 24: returns `${months}M`.
 * Otherwise returns years as integer.
 */
export function formatPatientAge(
  dob?: Date | string | null,
  ageFallback?: number | null,
  referenceDate: Date = new Date()
): string | number | null {
  if (dob) {
    const birthDate = new Date(dob);
    if (!isNaN(birthDate.getTime())) {
      const boundaries = getTimezoneBoundaries(referenceDate, 'Asia/Colombo');
      const ref = new Date(boundaries.startOfDay);
      let months = (ref.getFullYear() - birthDate.getFullYear()) * 12 + (ref.getMonth() - birthDate.getMonth());
      if (ref.getDate() < birthDate.getDate()) {
        months--;
      }
      if (months >= 0 && months < 24) {
        return `${Math.max(1, months)}M`;
      }
      const years = Math.floor(months / 12);
      return years > 0 ? years : (ageFallback !== null && ageFallback !== undefined ? ageFallback : `${Math.max(1, months)}M`);
    }
  }
  if (ageFallback !== null && ageFallback !== undefined) {
    return ageFallback;
  }
  return null;
}

