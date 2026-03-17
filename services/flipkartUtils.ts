import { isEmptyValue } from './utils';

/**
 * Parse SKU ID like "1 Sattu 1kg" into product name and weight
 * 
 * Examples:
 * - "1 Sattu 1kg" → ("Sattu", "1kg")
 * - "1 Bihari Coconut Thekua 350g" → ("Bihari Coconut Thekua", "350g")
 * - "1 ragi atta 1kg" → ("ragi atta", "1kg")
 * - "1 makai atta 1kg" → ("makai atta", "1kg")
 * - "1 Moori 250g" → ("Moori", "250g")
 * - "1 Bihari Thekua 350g" → ("Bihari Thekua", "350g")
 * 
 * @param skuId SKU ID string from Flipkart invoice (may include description after pipe)
 * @returns Tuple of (product_name, weight) or (null, null) if parsing fails
 */
export const parseSkuId = (skuId: string | null | undefined): { productName: string | null; weight: string | null } => {
  if (!skuId || isEmptyValue(skuId)) {
    return { productName: null, weight: null };
  }

  let cleanSkuId = String(skuId).trim();

  // Remove description part if pipe separator exists (SKU ID is before the pipe)
  if (cleanSkuId.includes('|')) {
    cleanSkuId = cleanSkuId.split('|')[0].trim();
  }

  // Pattern 1: Extract weight first (more reliable)
  // Look for weight pattern at the end: "Product Name 350g" or "Product Name 1kg"
  const weightPattern = /(\d+(?:\.\d+)?(?:kg|g))/i;
  const weightMatches = cleanSkuId.match(new RegExp(weightPattern, 'gi'));

  if (weightMatches && weightMatches.length > 0) {
    // Use the last weight match (most likely to be the actual weight)
    const lastWeightMatch = weightMatches[weightMatches.length - 1];
    const weightMatchIndex = cleanSkuId.lastIndexOf(lastWeightMatch);
    
    if (weightMatchIndex !== -1) {
      const weight = lastWeightMatch;
      const weightNormalized = normalizeWeight(weight);
      
      // Extract product name by removing weight and leading number
      let productName = cleanSkuId.substring(0, weightMatchIndex).trim();
      // Remove leading number if present
      productName = productName.replace(/^\d+\s+/, '').trim();
      
      if (productName) {
        return { productName, weight: weightNormalized };
      }
    }
  }

  // Pattern 2: "1 Product Name Weight" with space before weight (most common)
  const pattern2 = /^\d+\s+(.+?)\s+(\d+(?:\.\d+)?(?:kg|g))$/i;
  const match2 = cleanSkuId.match(pattern2);
  if (match2) {
    const productName = match2[1].trim();
    const weight = match2[2].trim();
    const weightNormalized = normalizeWeight(weight);
    return { productName, weight: weightNormalized };
  }

  // Pattern 3: "1 Product Name" (no weight in SKU, may have trailing number like "1 Bihari Coconut Thekua 3")
  const pattern3 = /^\d+\s+(.+)$/;
  const match3 = cleanSkuId.match(pattern3);
  if (match3) {
    let productName = match3[1].trim();
    
    // Check if product name ends with a standalone number (not weight unit)
    // Remove trailing number if it's not part of a weight pattern
    const trailingNumMatch = productName.match(/\s+(\d+)$/);
    if (trailingNumMatch) {
      const trailingNum = parseInt(trailingNumMatch[1], 10);
      // If the number is small (1-10) and there's no weight unit before it, it's likely not weight
      if (trailingNum <= 10) {
        // Remove the trailing number
        productName = productName.substring(0, trailingNumMatch.index).trim();
      }
    }
    
    return { productName, weight: null };
  }

  // Fallback: return as-is without weight
  let productName = cleanSkuId.replace(/^\d+\s+/, '').trim();
  // Remove trailing standalone numbers (likely quantities, not weights)
  const trailingNumMatch = productName.match(/\s+(\d+)$/);
  if (trailingNumMatch && parseInt(trailingNumMatch[1], 10) <= 10) {
    productName = productName.substring(0, trailingNumMatch.index).trim();
  }

  if (productName) {
    return { productName, weight: null };
  }

  return { productName: null, weight: null };
};

/**
 * Normalize weight strings to standard format for comparison
 * 
 * Examples:
 * - "1kg" -> "1kg"
 * - "1 kg" -> "1kg"
 * - "1000g" -> "1kg"
 * - "350g" -> "350g"
 * - "0.35kg" -> "350g"
 * 
 * @param weightStr Weight string to normalize
 * @returns Normalized weight string (e.g., "1kg", "350g") or null if invalid
 */
export const normalizeWeight = (weightStr: string | null | undefined): string | null => {
  if (!weightStr || isEmptyValue(weightStr)) {
    return null;
  }

  let weight = String(weightStr).trim().toLowerCase().replace(/\s+/g, '');

  // Handle grams
  if (weight.endsWith('g') && !weight.endsWith('kg')) {
    try {
      const grams = parseFloat(weight.slice(0, -1));
      if (isNaN(grams)) {
        return weightStr as string;
      }
      
      // Convert to kg if >= 1000g
      if (grams >= 1000) {
        const kg = grams / 1000;
        // Remove trailing zeros
        if (kg === Math.floor(kg)) {
          return `${Math.floor(kg)}kg`;
        } else {
          return `${kg}kg`;
        }
      } else {
        // Keep as grams, remove trailing zeros
        if (grams === Math.floor(grams)) {
          return `${Math.floor(grams)}g`;
        } else {
          return `${grams}g`;
        }
      }
    } catch {
      return weightStr as string;
    }
  }

  // Handle kilograms
  if (weight.endsWith('kg')) {
    try {
      const kg = parseFloat(weight.slice(0, -2));
      if (isNaN(kg)) {
        return weightStr as string;
      }
      
      // Remove trailing zeros
      if (kg === Math.floor(kg)) {
        return `${Math.floor(kg)}kg`;
      } else {
        return `${kg}kg`;
      }
    } catch {
      return weightStr as string;
    }
  }

  return weightStr as string;
};

/**
 * Convert weight string to grams (number)
 * 
 * Examples:
 * - "0.35" -> 350 (assume kg if < 1)
 * - "0.35kg" -> 350
 * - "350g" -> 350
 * - "700g" -> 700
 * - "0.7kg" -> 700
 * - "1kg" -> 1000
 * - "1" -> 1000 (assume kg if >= 1 and round number)
 * 
 * @param weightStr Weight string with or without unit
 * @returns Weight in grams (number) or null if invalid
 */
export const weightToGrams = (weightStr: string | null | undefined): number | null => {
  if (!weightStr || isEmptyValue(weightStr)) {
    return null;
  }

  try {
    let weight = String(weightStr).trim().toLowerCase().replace(/\s+/g, '');

    // Remove units and get numeric value
    if (weight.endsWith('kg')) {
      const kg = parseFloat(weight.slice(0, -2));
      if (isNaN(kg)) {
        return null;
      }
      return Math.floor(kg * 1000);
    } else if (weight.endsWith('g')) {
      const grams = parseFloat(weight.slice(0, -1));
      if (isNaN(grams)) {
        return null;
      }
      return Math.floor(grams);
    } else {
      // No unit - assume kg if < 1, grams if >= 1
      const value = parseFloat(weight);
      if (isNaN(value)) {
        return null;
      }
      
      if (value < 1) {
        return Math.floor(value * 1000); // Assume kg
      } else {
        // For values >= 1, check if it's more likely kg or grams
        // If it's a round number like 1, 2, 5, assume kg
        // If it's like 350, 700, assume grams
        if (value === Math.floor(value) && value <= 10) {
          return Math.floor(value * 1000); // Assume kg (1, 2, 5 kg)
        } else {
          return Math.floor(value); // Assume grams (350, 700, etc.)
        }
      }
    }
  } catch {
    return null;
  }
};

/**
 * Check if two weight strings represent the same weight
 * Handles conversions: 0.35kg = 350g, 0.7kg = 700g, etc.
 * 
 * @param weight1 First weight string (e.g., "0.35", "0.35kg", "350g")
 * @param weight2 Second weight string (e.g., "350g", "0.35kg")
 * @returns True if weights match (within 0.01g tolerance)
 */
export const weightsMatch = (weight1: string | null | undefined, weight2: string | null | undefined): boolean => {
  // Convert both to grams and compare
  const grams1 = weightToGrams(weight1);
  const grams2 = weightToGrams(weight2);

  if (grams1 === null || grams2 === null) {
    return false;
  }

  // Use small tolerance for floating point comparison
  return Math.abs(grams1 - grams2) < 0.01;
};

/**
 * Find column in data array with flexible matching (handles spaces, case, punctuation)
 * 
 * @param data Array of objects (DataFrame-like structure)
 * @param columnNames List of possible column names or single string
 * @returns First matching column name or null if not found
 */
export const findColumnFlexible = (data: any[], columnNames: string | string[]): string | null => {
  if (!data || data.length === 0) {
    return null;
  }

  const targetNames = Array.isArray(columnNames) ? columnNames : [columnNames];

  // Normalize column names: remove spaces, dots, convert to lowercase
  const normalizeName = (name: string): string => {
    return String(name).replace(/[\s\.]+/g, '').toLowerCase();
  };

  // Get all column names from first object
  const availableColumns = Object.keys(data[0]);

  for (const col of availableColumns) {
    const colNormalized = normalizeName(col);
    
    for (const targetName of targetNames) {
      const targetNormalized = normalizeName(targetName);
      
      // Try exact match first
      if (colNormalized === targetNormalized) {
        return col;
      }
      
      // Try contains match
      if (colNormalized.includes(targetNormalized) || targetNormalized.includes(colNormalized)) {
        return col;
      }
      
      // Try case-insensitive match with original
      if (String(col).trim().toLowerCase() === String(targetName).trim().toLowerCase()) {
        return col;
      }
    }
  }

  return null;
};

