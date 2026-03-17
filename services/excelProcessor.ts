import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { isEmptyValue, truncateProductName, extractMonthDay, safeIntConversion } from './utils';

export interface ProcessedOrder {
  'tracking-id': string;
  asin?: string;
  sku?: string;
  'product-name': string;
  qty: number;
  'pickup-slot': string;
  highlight: boolean;
  'date-ordered'?: string;
}

export interface MultiItemOrderStats {
  multiItemOrders: string[];
  totalOrders: number;
  multiItemCount: number;
  singleItemCount: number;
  riskLevel: 'Low' | 'Medium' | 'High';
}

/**
 * Convert Excel column letter to 0-based index
 * Example: A -> 0, B -> 1, Z -> 25, AA -> 26, AE -> 30
 */
export const excelColumnToIndex = (columnLetter: string): number => {
  let result = 0;
  for (const char of columnLetter.toUpperCase()) {
    result = result * 26 + (char.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1;
};

/**
 * Detect multi-item orders by grouping by tracking-id
 */
export const detectMultiItemOrders = (
  orders: ProcessedOrder[],
  productIdColumn: 'asin' | 'sku' = 'asin'
): MultiItemOrderStats => {
  // Group orders by tracking-id
  const orderGroups = new Map<string, Set<string>>();
  
  for (const order of orders) {
    const trackingId = order['tracking-id'];
    const productId = productIdColumn === 'asin' 
      ? (order.asin || '') 
      : (order.sku || '');
    
    if (!trackingId || !productId) continue;
    
    if (!orderGroups.has(trackingId)) {
      orderGroups.set(trackingId, new Set());
    }
    orderGroups.get(trackingId)!.add(productId);
  }
  
  // Find orders with multiple products
  const multiItemOrders: string[] = [];
  for (const [trackingId, products] of orderGroups.entries()) {
    if (products.size > 1) {
      multiItemOrders.push(trackingId);
    }
  }
  
  const totalOrders = orderGroups.size;
  const multiItemCount = multiItemOrders.length;
  const singleItemCount = totalOrders - multiItemCount;
  
  // Determine risk level
  let riskLevel: 'Low' | 'Medium' | 'High' = 'Low';
  if (multiItemCount > 20) {
    riskLevel = 'High';
  } else if (multiItemCount > 10) {
    riskLevel = 'Medium';
  }
  
  return {
    multiItemOrders,
    totalOrders,
    multiItemCount,
    singleItemCount,
    riskLevel
  };
};

/**
 * Create product name mapping from master data
 * Builds clean_product_name from Name + Net Weight (or Packet Size as fallback)
 * Format: "Product Name 0.2kg"
 */
export const createProductNameMapping = (
  masterData: any[],
  idColumn: 'ASIN' | 'SKU' = 'ASIN',
  fallbackIdColumn?: 'ASIN' | 'SKU'
): Map<string, string> => {
  const mapping = new Map<string, string>();
  
  for (const row of masterData) {
    // Find Name column flexibly
    let nameCol: string | undefined;
    for (const col of Object.keys(row)) {
      const colLower = col.toLowerCase().trim();
      if (['name', 'product name', 'product', 'item name', 'item'].includes(colLower)) {
        nameCol = col;
        break;
      }
    }
    
    if (!nameCol) continue;
    
    const productName = String(row[nameCol] || '').trim();
    if (!productName || isEmptyValue(productName)) continue;
    
    // Find Net Weight column flexibly
    let netWeightCol: string | undefined;
    for (const col of Object.keys(row)) {
      const colLower = col.toLowerCase().trim();
      if (['net weight', 'netweight', 'weight', 'net wt'].includes(colLower)) {
        netWeightCol = col;
        break;
      }
    }
    
    // Find Packet Size column flexibly (fallback if Net Weight is empty)
    let packetSizeCol: string | undefined;
    for (const col of Object.keys(row)) {
      const colLower = col.toLowerCase().trim();
      if (['packet size', 'packetsize', 'size'].includes(colLower)) {
        packetSizeCol = col;
        break;
      }
    }
    
    // Get weight from Net Weight (preferred) or Packet Size (fallback)
    let weight = '';
    if (netWeightCol) {
      weight = String(row[netWeightCol] || '').trim();
    }
    if (!weight && packetSizeCol) {
      weight = String(row[packetSizeCol] || '').trim();
    }
    
    // Build clean product name: Name + weight (if available)
    let cleanProductName = productName;
    if (weight && !isEmptyValue(weight)) {
      // Normalize weight format
      // Trim and normalize spaces (remove extra spaces, keep single space if present)
      let normalizedWeight = weight.trim().replace(/\s+/g, ' ').toLowerCase();
      
      // If it doesn't end with 'kg' or 'g', add 'kg'
      if (!normalizedWeight.endsWith('kg') && !normalizedWeight.endsWith('g')) {
        normalizedWeight = `${normalizedWeight}kg`;
      } else {
        // Remove any space before the unit (e.g., "0.2 kg" -> "0.2kg")
        normalizedWeight = normalizedWeight.replace(/\s+(kg|g)$/i, '$1');
      }
      
      cleanProductName = `${productName} ${normalizedWeight}`;
    }
    
    // Find primary ID column flexibly (case-insensitive)
    let primaryIdCol: string | undefined;
    const idColumnLower = idColumn.toLowerCase();
    for (const col of Object.keys(row)) {
      const colLower = col.toLowerCase().trim();
      if (colLower === idColumnLower) {
        primaryIdCol = col; // Use original case
        break;
      }
    }
    
    // Try primary ID column (use flexible lookup if found, otherwise fallback to exact match)
    const primaryId = primaryIdCol 
      ? String(row[primaryIdCol] || '').trim()
      : String(row[idColumn] || '').trim();
    if (primaryId && !isEmptyValue(primaryId)) {
      mapping.set(primaryId, cleanProductName);
    }
    
    // Try fallback ID column if provided
    if (fallbackIdColumn) {
      let fallbackIdCol: string | undefined;
      const fallbackIdColumnLower = fallbackIdColumn.toLowerCase();
      for (const col of Object.keys(row)) {
        const colLower = col.toLowerCase().trim();
        if (colLower === fallbackIdColumnLower) {
          fallbackIdCol = col; // Use original case
          break;
        }
      }
      
      const fallbackId = fallbackIdCol
        ? String(row[fallbackIdCol] || '').trim()
        : String(row[fallbackIdColumn] || '').trim();
      
      if (fallbackId && !isEmptyValue(fallbackId) && fallbackId !== primaryId) {
        mapping.set(fallbackId, cleanProductName);
      }
    }
  }
  
  return mapping;
};

/**
 * Process Amazon Easy Ship Excel file
 */
export const processAmazonEasyShipExcel = async (file: File): Promise<ProcessedOrder[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first sheet or Sheet1
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          reject(new Error('Excel file contains no sheets'));
          return;
        }
        
        const sheetName = workbook.SheetNames.includes('Sheet1') 
          ? 'Sheet1' 
          : workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Validate required columns by reading headers first
        const requiredColumns = ['tracking-id', 'asin', 'product-name', 'quantity-purchased', 'pickup-slot'];
        
        // Read headers with header: 1 to get first row as array
        const headerRow = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })[0] as any[];
        if (!headerRow || headerRow.length === 0) {
          reject(new Error('Excel sheet is empty or has no headers'));
          return;
        }
        
        // Build header map (lowercase for comparison) and preserve original names
        const headerMap = new Map<string, number>();
        const originalHeaders = new Map<string, string>(); // lowercase -> original
        for (let i = 0; i < headerRow.length; i++) {
          const originalHeader = String(headerRow[i] || '').trim();
          const headerLower = originalHeader.toLowerCase();
          headerMap.set(headerLower, i);
          originalHeaders.set(headerLower, originalHeader);
        }
        
        // Check for required columns (case-insensitive)
        const missingColumns: string[] = [];
        for (const requiredCol of requiredColumns) {
          if (!headerMap.has(requiredCol.toLowerCase())) {
            missingColumns.push(requiredCol);
          }
        }
        
        if (missingColumns.length > 0) {
          reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
          return;
        }
        
        // Convert to JSON with defval to handle empty cells
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        // Check if sheet is empty
        if (jsonData.length === 0) {
          reject(new Error('Excel sheet contains no data rows'));
          return;
        }
        
        // Check if SKU column exists (optional) - use original header name
        const hasSkuColumn = headerMap.has('sku');
        const skuColumnName = hasSkuColumn ? (originalHeaders.get('sku') || 'sku') : '';
        
        // Process data
        const processed: ProcessedOrder[] = [];
        for (const row of jsonData as any[]) {
          // Skip rows with missing critical data - use isEmptyValue to match Streamlit's dropna behavior
          if (isEmptyValue(row['tracking-id']) || isEmptyValue(row['asin'])) continue;
          
          const qty = safeIntConversion(row['quantity-purchased'], 1);
          
          const asinValue = String(row['asin'] || '').trim();
          // Only set SKU from actual SKU column if present, otherwise undefined
          const sku = hasSkuColumn && skuColumnName ? String(row[skuColumnName] || '').trim() : undefined;
          
          processed.push({
            'tracking-id': String(row['tracking-id']),
            asin: asinValue,
            sku: sku || undefined, // Only set if has value, otherwise undefined
            'product-name': truncateProductName(row['product-name']),
            qty,
            'pickup-slot': extractMonthDay(row['pickup-slot']),
            highlight: qty > 1
          });
        }
        
        // Sort by ASIN
        processed.sort((a, b) => (a.asin || '').localeCompare(b.asin || ''));
        
        resolve(processed);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Process Flipkart Excel/CSV file
 */
export const processFlipkartFile = async (file: File): Promise<ProcessedOrder[]> => {
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  const isCSV = fileExtension === 'csv' || file.type === 'text/csv';
  
  if (isCSV) {
    return processFlipkartCSV(file);
  } else {
    return processFlipkartExcel(file);
  }
};

/**
 * Process Flipkart CSV file
 */
const processFlipkartCSV = async (file: File): Promise<ProcessedOrder[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      encoding: 'utf-8',
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const processed = mapFlipkartColumns(results.data as any[]);
          resolve(processed);
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => {
        // Try with different encoding
        Papa.parse(file, {
          encoding: 'latin-1',
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            try {
              const processed = mapFlipkartColumns(results.data as any[]);
              resolve(processed);
            } catch (error) {
              reject(error);
            }
          },
          error: () => reject(new Error('Failed to parse CSV file'))
        });
      }
    });
  });
};

/**
 * Process Flipkart Excel file
 */
const processFlipkartExcel = async (file: File): Promise<ProcessedOrder[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first sheet or Sheet1
        const sheetName = workbook.SheetNames.includes('Sheet1') 
          ? 'Sheet1' 
          : workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to array of arrays (to access by column index)
        const arrayData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        if (arrayData.length === 0) {
          reject(new Error('Excel file is empty'));
          return;
        }
        
        // Get column indices
        const colAIdx = excelColumnToIndex('A'); // 0 - Ordered On
        const colAEIdx = excelColumnToIndex('AE'); // 30 - Tracking ID
        const colIIdx = excelColumnToIndex('I'); // 8 - SKU/Product Name
        const colSIdx = excelColumnToIndex('S'); // 18 - Quantity
        const colABIdx = excelColumnToIndex('AB'); // 27 - Dispatch by date (try AB first)
        const colACIdx = excelColumnToIndex('AC'); // 28 - Dispatch by date (fallback)
        
        // Check if we have enough columns
        const maxColIdx = Math.max(colAEIdx, colACIdx);
        if (arrayData[0] && (arrayData[0] as any[]).length <= maxColIdx) {
          reject(new Error(`Excel file doesn't have enough columns. Expected at least ${maxColIdx + 1} columns`));
          return;
        }
        
        // Determine dispatch date column (try AB first, fallback to AC)
        const dispatchDateIdx = (arrayData[0] as any[]).length > colABIdx ? colABIdx : colACIdx;
        
        // Process rows (skip header if first row looks like headers)
        const startRow = Array.isArray(arrayData[0]) && 
          typeof arrayData[0][colAIdx] === 'string' && 
          String(arrayData[0][colAIdx]).toLowerCase().includes('order')
          ? 1 
          : 0;
        
        const processed: ProcessedOrder[] = [];
        for (let i = startRow; i < arrayData.length; i++) {
          const row = arrayData[i] as any[];
          
          if (!row || row.length <= maxColIdx) continue;
          
          const trackingId = String(row[colAEIdx] || '').trim();
          const sku = String(row[colIIdx] || '').trim();
          
          // Skip rows with missing critical data
          if (!trackingId || !sku || isEmptyValue(trackingId) || isEmptyValue(sku)) continue;
          
          const qty = safeIntConversion(row[colSIdx], 1);
          
          processed.push({
            'tracking-id': trackingId,
            sku,
            'product-name': truncateProductName(row[colIIdx]),
            qty,
            'pickup-slot': extractMonthDay(row[dispatchDateIdx]),
            highlight: qty > 1,
            'date-ordered': String(row[colAIdx] || '').trim()
          });
        }
        
        // Sort by SKU
        processed.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
        
        resolve(processed);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Map Flipkart columns from array data
 * When header: true, map by header names (not Object.values which is unreliable)
 */
const mapFlipkartColumns = (data: any[]): ProcessedOrder[] => {
  if (data.length === 0) return [];
  
  const firstRow = data[0];
  const headers = Object.keys(firstRow);
  
  // Find columns by header name (case-insensitive)
  let dateOrderedKey: string | null = null;
  let trackingIdKey: string | null = null;
  let skuKey: string | null = null;
  let qtyKey: string | null = null;
  let dispatchDateKey: string | null = null;
  
  for (const header of headers) {
    const headerLower = header.toLowerCase();
    if (!dateOrderedKey && headerLower.includes('order') && headerLower.includes('date')) {
      dateOrderedKey = header;
    }
    if (!trackingIdKey && headerLower.includes('tracking')) {
      trackingIdKey = header;
    }
    if (!skuKey && (headerLower.includes('sku') || (headerLower.includes('product') && headerLower.includes('name')))) {
      skuKey = header;
    }
    if (!qtyKey && (headerLower.includes('quantity') || headerLower.includes('qty'))) {
      qtyKey = header;
    }
    if (!dispatchDateKey && headerLower.includes('dispatch')) {
      dispatchDateKey = header;
    }
  }
  
  // Fallback to position-based mapping if column names not found
  // Use header names directly when found, otherwise try positional fallback
  // For positional fallback, we need to parse with header: false, but that's handled in processFlipkartCSV
  
  const processed: ProcessedOrder[] = [];
  
  for (const row of data) {
    // Map by header names (not Object.values)
    const trackingId = trackingIdKey ? String(row[trackingIdKey] || '').trim() : '';
    const sku = skuKey ? String(row[skuKey] || '').trim() : '';
    
    if (!trackingId || !sku || isEmptyValue(trackingId) || isEmptyValue(sku)) continue;
    
    const qty = qtyKey ? safeIntConversion(row[qtyKey], 1) : 1;
    const productName = skuKey ? truncateProductName(row[skuKey]) : '';
    const pickupSlot = dispatchDateKey ? extractMonthDay(row[dispatchDateKey]) : 'No Date';
    const dateOrdered = dateOrderedKey ? String(row[dateOrderedKey] || '').trim() : '';
    
    processed.push({
      'tracking-id': trackingId,
      sku,
      'product-name': productName,
      qty,
      'pickup-slot': pickupSlot,
      highlight: qty > 1,
      'date-ordered': dateOrdered
    });
  }
  
  // Sort by SKU
  processed.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
  
  return processed;
};

/**
 * Apply product name mapping to orders
 */
export const applyProductNameMapping = (
  orders: ProcessedOrder[],
  nameMapping: Map<string, string>,
  idColumn: 'asin' | 'sku' = 'asin'
): ProcessedOrder[] => {
  return orders.map(order => {
    const productId = idColumn === 'asin' ? order.asin : order.sku;
    if (productId && nameMapping.has(productId)) {
      return {
        ...order,
        'product-name': nameMapping.get(productId)!
      };
    }
    return order;
  });
};

