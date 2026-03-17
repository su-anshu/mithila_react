import { format, parse, isValid } from 'date-fns';

/**
 * Convert weight from kg to ounces
 * @param kg - Weight in kilograms (string or number)
 * @returns Weight in ounces (number)
 */
export const convertKgToOz = (kg: string | number): number => {
  const kgNum = typeof kg === 'string' ? parseFloat(kg) : kg;
  if (isNaN(kgNum) || kgNum <= 0) {
    return 0;
  }
  // 1 kg = 35.274 ounces
  return kgNum * 35.274;
};

/**
 * Format weight as "1kg (35.27oz)" with 2 decimal places for oz
 * @param weightKg - Weight in kilograms (string)
 * @returns Formatted weight string
 */
export const formatWeightWithOz = (weightKg: string): string => {
  if (!weightKg || weightKg.trim() === '') {
    return 'N/A';
  }
  
  const kgNum = parseFloat(weightKg);
  if (isNaN(kgNum)) {
    return weightKg; // Return original if not a number
  }
  
  const oz = convertKgToOz(kgNum);
  return `${kgNum}kg (${oz.toFixed(2)}oz)`;
};

/**
 * Format date as MM/DD/YYYY (US format)
 * @param date - Date object or date string
 * @returns Formatted date string (MM/DD/YYYY)
 */
export const formatUSDate = (date: Date | string | undefined): string => {
  if (!date) {
    return 'N/A';
  }
  
  let dateObj: Date;
  
  if (typeof date === 'string') {
    // Try to parse the date string
    dateObj = parseUSDate(date);
    if (!isValid(dateObj)) {
      return date; // Return original if parsing fails
    }
  } else {
    dateObj = date;
  }
  
  if (!isValid(dateObj)) {
    return 'N/A';
  }
  
  return format(dateObj, 'MM/dd/yyyy');
};

/**
 * Parse date string in various formats to Date object
 * Handles MM/DD/YYYY, YYYY-MM-DD, and other common formats
 * @param dateStr - Date string to parse
 * @returns Date object or current date if parsing fails
 */
export const parseUSDate = (dateStr: string): Date => {
  if (!dateStr || dateStr.trim() === '') {
    return new Date();
  }
  
  const trimmed = dateStr.trim();
  
  // Try MM/DD/YYYY format first (US format)
  const mmddyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const match1 = trimmed.match(mmddyyyy);
  if (match1) {
    const month = parseInt(match1[1], 10) - 1; // Month is 0-indexed
    const day = parseInt(match1[2], 10);
    const year = parseInt(match1[3], 10);
    const date = new Date(year, month, day);
    if (isValid(date)) {
      return date;
    }
  }
  
  // Try YYYY-MM-DD format (ISO format)
  const yyyymmdd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const match2 = trimmed.match(yyyymmdd);
  if (match2) {
    const year = parseInt(match2[1], 10);
    const month = parseInt(match2[2], 10) - 1; // Month is 0-indexed
    const day = parseInt(match2[3], 10);
    const date = new Date(year, month, day);
    if (isValid(date)) {
      return date;
    }
  }
  
  // Try standard Date parsing
  const parsed = new Date(trimmed);
  if (isValid(parsed)) {
    return parsed;
  }
  
  // Fallback to current date
  return new Date();
};
