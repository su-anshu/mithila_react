import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export interface StockItem {
  'Product Name': string;
  'SKU/Unit': string;
  'Count(Qty)': number;
}

/**
 * Check if a string is a number (SKU)
 */
export const isNumber = (s: string | null | undefined): boolean => {
  if (!s) return false;
  try {
    const num = parseFloat(String(s));
    return !isNaN(num);
  } catch {
    return false;
  }
};

/**
 * Check if a line represents an SKU line (Number or 'In lot')
 */
export const isSkuLine = (s: string | null | undefined): boolean => {
  if (!s) return false;
  const str = String(s).trim();
  if (str === '') return false;
  if (isNumber(str)) return true;
  const lower = str.toLowerCase();
  if (lower.includes('in lot')) return true;
  if (lower.includes('sku+inlot')) return true;
  return false;
};

/**
 * Check if a line is a text line (potential Category or Product)
 */
export const isTextLine = (s: string | null | undefined): boolean => {
  if (!s) return false;
  const str = String(s).trim();
  if (str === '' || str.toLowerCase() === 'nan') return false;
  return !isSkuLine(str);
};

/**
 * Process stock data file with Column A/Y parsing logic
 * 
 * Parses the uploaded Excel/CSV file to extract Product Name, SKU, and Count.
 * Logic:
 * 1. Iterate through rows (skip first row as header)
 * 2. Identify Product Name (Text lines where next non-empty line is SKU)
 * 3. Identify SKU (Numeric lines)
 * 4. Extract Count from Column Y (Index 24)
 * 5. Filter > 0 and exclude 'In Lot'
 * 
 * @param file Excel or CSV file
 * @returns Array of stock items
 */
export const processStockData = async (file: File): Promise<StockItem[]> => {
  return new Promise((resolve, reject) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    const isCsv = fileExtension === 'csv';

    if (isCsv) {
      // Process CSV
      Papa.parse(file, {
        header: false,
        skipEmptyLines: false,
        complete: (results) => {
          try {
            const data = results.data as any[][];
            const processed = processStockDataRows(data);
            resolve(processed);
          } catch (error) {
            reject(error);
          }
        },
        error: reject
      });
    } else {
      // Process Excel
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array', header: false });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // Convert to array of arrays
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
          const dataArray: any[][] = [];
          
          for (let row = 0; row <= range.e.r; row++) {
            const rowData: any[] = [];
            for (let col = 0; col <= range.e.c; col++) {
              const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
              const cell = worksheet[cellAddress];
              rowData.push(cell ? cell.v : '');
            }
            dataArray.push(rowData);
          }
          
          const processed = processStockDataRows(dataArray);
          resolve(processed);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }
  });
};

/**
 * Process stock data rows with Column A/Y logic
 */
const processStockDataRows = (data: any[][]): StockItem[] => {
  // Ensure we have enough columns (Column Y is index 24, so we need at least 25 cols)
  if (data.length === 0 || (data[0] && data[0].length < 25)) {
    throw new Error('The uploaded file does not have enough columns. Expected at least 25 columns (Column Y).');
  }

  // Skip first row (header) and process from row 1
  const rows = data.slice(1);
  const results: StockItem[] = [];
  let currentProduct = 'Unknown Product';

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row || row.length === 0) {
      i++;
      continue;
    }

    const colA = String(row[0] || '').trim();

    // Skip empty rows
    if (colA === '' || colA.toLowerCase() === 'nan') {
      i++;
      continue;
    }

    // SKU Line Logic
    if (isSkuLine(colA)) {
      // Exclude "In Lot" and "SKU+INLOT"
      const colALower = colA.toLowerCase();
      if (colALower.includes('in lot') || colALower.includes('sku+inlot')) {
        i++;
        continue;
      }

      // Extract Count from Column Y (Index 24)
      const colYRaw = row[24];
      let colY = 0.0;
      try {
        colY = parseFloat(String(colYRaw || 0));
        if (isNaN(colY)) {
          colY = 0.0;
        }
      } catch {
        colY = 0.0;
      }

      // Filter: Count must be > 0
      if (colY > 0) {
        // Format quantity: integer if no decimal needed
        const qtyVal = Number.isInteger(colY) ? Math.floor(colY) : colY;

        // Format SKU/Unit: If >= 1 add "kg", if < 1 multiply by 1000 and add "g"
        let skuFormatted: string;
        try {
          const skuVal = parseFloat(colA);
          if (!isNaN(skuVal)) {
            if (skuVal >= 1) {
              // Format as kg with 2 decimal places
              skuFormatted = `${skuVal.toFixed(2)} kg`;
            } else {
              // Format as g with 2 decimal places (multiply by 1000)
              const grams = skuVal * 1000;
              skuFormatted = `${grams.toFixed(2)} g`;
            }
          } else {
            // If SKU is not a number, keep original value
            skuFormatted = colA;
          }
        } catch {
          skuFormatted = colA;
        }

        results.push({
          'Product Name': currentProduct,
          'SKU/Unit': skuFormatted,
          'Count(Qty)': qtyVal
        });
      }
      i++;
      continue;
    }

    // Product Name Logic
    // We need to determine if this text line is a Product or a Category.
    // Logic: Look ahead. If the NEXT non-empty line is an SKU (number), then THIS line is a Product.
    // If the NEXT line is also text, then THIS line is likely a Category (which we ignore).

    let j = i + 1;
    let hasNext = false;
    let nextIsSku = false;

    while (j < rows.length) {
      const nextRow = rows[j];
      if (!nextRow || nextRow.length === 0) {
        j++;
        continue;
      }

      const nextVal = String(nextRow[0] || '').trim();
      if (nextVal !== '' && nextVal.toLowerCase() !== 'nan') {
        hasNext = true;
        nextIsSku = isSkuLine(nextVal);
        break;
      }
      j++;
    }

    if (hasNext) {
      if (nextIsSku) {
        // Next line is a number, so this line is the Product Name
        currentProduct = colA;
      } else {
        // Next line is text, so this line is likely a Category header.
        // We do nothing, just move on.
      }
    } else {
      // End of file, assume product if we found text
      currentProduct = colA;
    }

    i++;
  }

  return results;
};

