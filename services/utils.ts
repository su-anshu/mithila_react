import { MasterProduct, PhysicalItem } from '../types';

/**
 * Standardized check for empty/invalid values
 */
export const isEmptyValue = (value: any): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed === '' || trimmed === 'nan' || trimmed === 'none' || trimmed === 'null' || trimmed === 'n/a';
  }
  
  return false;
};

/**
 * Safely convert value to integer with fallback
 */
export const safeIntConversion = (value: any, fallback: number = 1): number => {
  try {
    if (value === null || value === undefined) {
      return fallback;
    }
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return isNaN(num) ? fallback : Math.floor(num);
  } catch {
    return fallback;
  }
};

/**
 * Sanitize filename for safe file operations
 */
export const sanitizeFilename = (name: string): string => {
  return name.replace(/[^\w\-_\.]/g, '_');
};

/**
 * Truncate messy product names to clean format
 */
export const truncateProductName = (text: any): string => {
  try {
    if (isEmptyValue(text)) {
      return 'Unknown Product';
    }
    const words = String(text).split(' ');
    return words.slice(0, 10).join(' ').substring(0, 70);
  } catch {
    return 'Unknown Product';
  }
};

/**
 * Extract month and day from pickup slot string
 */
export const extractMonthDay = (slot: any): string => {
  try {
    if (isEmptyValue(slot)) {
      return 'No Date';
    }
    
    const slotStr = String(slot);
    // Look for patterns like "January 15", "Feb 3", "Nov 15, 2025", etc.
    const match = slotStr.match(/[A-Za-z]{3,9}\s+\d{1,2}/);
    return match ? match[0] : slotStr.substring(0, 20);
  } catch {
    return 'Invalid Date';
  }
};

/**
 * Generate unique key suffix from data hash
 */
export const getUniqueKeySuffix = (data: any): string => {
  try {
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      // For binary data (PDF bytes)
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const hash = Array.from(bytes).slice(0, 100).join(''); // Sample first 100 bytes
      return btoa(hash).substring(0, 8).replace(/[^a-zA-Z0-9]/g, '');
    } else if (Array.isArray(data)) {
      // For arrays (like physical items)
      const str = JSON.stringify(data.slice(0, 10)); // Sample first 10 items
      return btoa(str).substring(0, 8).replace(/[^a-zA-Z0-9]/g, '');
    } else if (typeof data === 'object' && data !== null) {
      // For objects
      const str = JSON.stringify(data);
      return btoa(str).substring(0, 8).replace(/[^a-zA-Z0-9]/g, '');
    } else {
      // Fallback: use string representation
      const str = String(data);
      return btoa(str).substring(0, 8).replace(/[^a-zA-Z0-9]/g, '');
    }
  } catch (error) {
    // Fallback to timestamp if hashing fails
    return Date.now().toString().slice(-8);
  }
};

/**
 * Check if a product should be included in product labels based on "Product Label" column
 */
export const shouldIncludeProductLabel = (
  productName: string,
  masterData: MasterProduct[],
  row?: PhysicalItem,
  idColumn: 'ASIN' | 'SKU' = 'ASIN'
): boolean => {
  if (!masterData || masterData.length === 0) {
    return true; // Backward compatibility: include all if no master data
  }

  // Find "Product Label" column using flexible matching
  let productLabelCol: string | undefined;
  for (const col of Object.keys(masterData[0])) {
    const colLower = col.toLowerCase().trim();
    if (colLower.includes('product') && colLower.includes('label')) {
      productLabelCol = col;
      break;
    }
  }

  // If column doesn't exist, include all products (backward compatibility)
  if (!productLabelCol) {
    return true;
  }

  // Try to match product in master data
  let match: MasterProduct | undefined;

  // Strategy 1: Match by ID column if available
  if (row) {
    if (idColumn === 'ASIN') {
      const productId = row.ASIN || '';
      if (productId) {
        match = masterData.find(p => p.ASIN === productId);
      }
    } else {
      // Flipkart - use SKU ID
      const skuId = (row as any)['SKU ID'] || (row as any)['SKU_ID'] || '';
      if (skuId) {
        // Try to find SKU column in master data
        let skuCol: string | undefined;
        for (const col of Object.keys(masterData[0])) {
          const colLower = col.toLowerCase().trim();
          if (colLower.includes('sku') && (colLower.includes('id') || colLower === 'sku')) {
            skuCol = col;
            break;
          }
        }
        if (skuCol) {
          match = masterData.find(p => String(p[skuCol] || '').trim() === String(skuId).trim());
        }
      }
    }
  }

  // Strategy 2: Match by Name if ID match failed
  if (!match && productName) {
    let nameCol: string | undefined;
    for (const col of Object.keys(masterData[0])) {
      const colLower = col.toLowerCase().trim();
      if (['name', 'product name', 'product', 'item name', 'item'].includes(colLower)) {
        nameCol = col;
        break;
      }
    }

    if (nameCol) {
      match = masterData.find(
        p => String(p[nameCol] || '').trim().toLowerCase() === productName.trim().toLowerCase()
      );
    }
  }

  // If no match found, don't include (product not in master data)
  if (!match) {
    return false;
  }

  // Check Product Label value
  const productLabelValue = String(match[productLabelCol] || '').trim();
  // Case-insensitive check for "Yes"
  return productLabelValue.toLowerCase() === 'yes' || productLabelValue.toLowerCase() === 'y';
};

/**
 * Detect multi-item orders from processed orders
 */
export const detectMultiItemOrders = (
  orders: Array<{ 'tracking-id': string; [key: string]: any }>,
  productIdColumn: string = 'asin'
): { multiItemOrders: string[]; stats: any } => {
  const orderGroups = new Map<string, Set<string>>();
  
  for (const order of orders) {
    const trackingId = order['tracking-id'];
    const productId = String(order[productIdColumn] || '').trim();
    
    if (!trackingId || !productId) continue;
    
    if (!orderGroups.has(trackingId)) {
      orderGroups.set(trackingId, new Set());
    }
    orderGroups.get(trackingId)!.add(productId);
  }
  
  const multiItemOrders: string[] = [];
  for (const [trackingId, products] of orderGroups.entries()) {
    if (products.size > 1) {
      multiItemOrders.push(trackingId);
    }
  }
  
  const totalOrders = orderGroups.size;
  const multiItemCount = multiItemOrders.length;
  const singleItemCount = totalOrders - multiItemCount;
  
  let riskLevel: 'Low' | 'Medium' | 'High' = 'Low';
  if (multiItemCount > 20) {
    riskLevel = 'High';
  } else if (multiItemCount > 10) {
    riskLevel = 'Medium';
  }
  
  return {
    multiItemOrders,
    stats: {
      totalOrders,
      multiItemCount,
      singleItemCount,
      riskLevel
    }
  };
};

/**
 * Safe integer conversion (alias for consistency)
 */
export const safe_int_conversion = safeIntConversion;

/**
 * Create product name mapping from master data
 */
export const createProductNameMapping = (
  masterData: MasterProduct[],
  idColumn: 'ASIN' | 'SKU' = 'ASIN',
  fallbackIdColumn?: 'ASIN' | 'SKU'
): Array<{ [key: string]: string }> => {
  const mapping: Array<{ [key: string]: string }> = [];
  
  for (const row of masterData) {
    const name = String(row.Name || '').trim();
    if (!name || isEmptyValue(name)) continue;
    
    const primaryId = String(row[idColumn] || '').trim();
    if (primaryId && !isEmptyValue(primaryId)) {
      mapping.push({
        [idColumn]: primaryId,
        clean_product_name: name
      });
    }
    
    if (fallbackIdColumn) {
      const fallbackId = String(row[fallbackIdColumn] || '').trim();
      if (fallbackId && !isEmptyValue(fallbackId) && fallbackId !== primaryId) {
        mapping.push({
          [fallbackIdColumn]: fallbackId,
          clean_product_name: name
        });
      }
    }
  }
  
  return mapping;
};

