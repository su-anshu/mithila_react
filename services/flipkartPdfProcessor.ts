import * as pdfjsLib from 'pdfjs-dist';
import { parseSkuId } from './flipkartUtils';

export interface FlipkartProductInfo {
  skuId: string;
  productName: string;
  weight: string;
  description: string;
  qty: number;
  page: number;
}

export interface FlipkartExtractionResult {
  products: FlipkartProductInfo[];
  orderId: string | null;
  awbNumber: string | null;
}

export interface FlipkartPDFProcessingResult {
  skuQtyData: Map<string, number>;
  totalInvoices: number;
  multiQtyInvoices: number; // Count of invoices with at least one item with qty > 1
  extractionResults: FlipkartExtractionResult[];
  failedPdfCount?: number;
  allPdfBytes?: Uint8Array[]; // Store PDF bytes for sorting
}

/**
 * Smart text joining that preserves spacing and table structure
 * Uses text item positions to determine when to add spaces vs newlines
 * Falls back to simple join if position data is unreliable
 * 
 * @param items Text content items from PDF.js
 * @returns Joined text string with proper spacing
 */
const smartJoinTextItems = (items: any[]): string => {
  if (!items || items.length === 0) {
    return '';
  }

  // Try position-aware joining first
  try {
    const lines: string[] = [];
    let currentLine: Array<{ text: string; x: number; y: number }> = [];
    let lastY = -1;
    const Y_THRESHOLD = 3; // Consider items on same line if Y difference < 3

    // Group items by Y position (line)
    for (const item of items) {
      const text = item.str || '';
      if (!text.trim()) continue;

      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const x = transform[4] || 0;
      const y = transform[5] || 0;

      // Check if this is a new line
      if (lastY >= 0 && Math.abs(y - lastY) > Y_THRESHOLD) {
        // Save current line
        if (currentLine.length > 0) {
          // Sort by X position and join with spaces
          currentLine.sort((a, b) => a.x - b.x);
          const lineText = currentLine.map(item => item.text).join(' ');
          lines.push(lineText);
          currentLine = [];
        }
      }

      currentLine.push({ text, x, y });
      lastY = y;
    }

    // Add final line
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      const lineText = currentLine.map(item => item.text).join(' ');
      lines.push(lineText);
    }

    return lines.join('\n');
  } catch (error) {
    // Fallback to simple join if position-based joining fails
    console.debug('[Flipkart PDF] Position-based joining failed, using simple join:', error);
    return items.map((item: any) => item.str || '').join('\n');
  }
};

/**
 * Extract SKU IDs from Flipkart invoice page text
 * 
 * Looks for table format: "SKU ID | Description | QTY"
 * SKU ID format: "1 Product Name Weight"
 * 
 * Enhanced version matching Streamlit implementation with better pattern matching
 * 
 * @param pageText Full text content of the PDF page
 * @returns Array of { skuId, description, qty }
 */
export const extractSkuFromPage = (pageText: string): Array<{ skuId: string; description: string; qty: number }> => {
  if (!pageText) {
    console.debug('[Flipkart SKU] Empty page text');
    return [];
  }

  const products: Array<{ skuId: string; description: string; qty: number }> = [];
  const lines = pageText.split('\n');

  // Debug: Log first 500 chars of page text
  const textPreview = pageText.substring(0, 500);
  console.debug(`[Flipkart SKU] Page text preview (first 500 chars): ${textPreview}...`);

  // Find table header
  let tableStartIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineUpper = line.toUpperCase();
    if ((lineUpper.includes('SKU ID') || lineUpper.includes('SKU')) && 
        (lineUpper.includes('DESCRIPTION') || lineUpper.includes('QTY') || lineUpper.includes('QUANTITY'))) {
      tableStartIdx = i;
      console.debug(`[Flipkart SKU] Found table header at line ${i}: ${line.substring(0, 100)}`);
      break;
    }
  }

  if (tableStartIdx === null) {
    console.debug('[Flipkart SKU] No table header found, trying alternative extraction');
    // Try alternative: look for product descriptions directly
    // Pattern: "1 Product Name Weight | Description | QTY"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Pattern 1: Full table row with pipe separators
      // "1 Product Name Weight | Description | QTY"
      const skuMatch = line.match(/^(\d+\s+[A-Za-z].*?)\s*\|\s*(.*?)\s*\|\s*(\d+)/);
      if (skuMatch) {
        const skuId = skuMatch[1].trim();
        const description = skuMatch[2].trim();
        const qty = parseInt(skuMatch[3], 10);
        console.debug(`[Flipkart SKU] Alternative extraction - Pattern 1: SKU=${skuId}, Qty=${qty}`);
        products.push({ skuId, description, qty });
        continue;
      }

      // Pattern 2: SKU ID with weight pattern, quantity might be separate
      // "1 Product Name Weight" followed by quantity
      const skuWithWeightMatch = line.match(/^(\d+\s+[A-Za-z].*?\s+\d+(?:\.\d+)?(?:kg|g))/i);
      if (skuWithWeightMatch) {
        const skuId = skuWithWeightMatch[1].trim();
        // Look for quantity in same line or next few lines
        let qty = 1;
        let description = '';

        // Check same line for quantity
        const qtyInLine = line.match(/\bQTY\s*:?\s*(\d+)\b/i) || line.match(/\|\s*(\d+)\s*$/);
        if (qtyInLine) {
          qty = parseInt(qtyInLine[1], 10);
        }

        // Check for description in same line (after pipe)
        if (line.includes('|')) {
          const parts = line.split('|');
          if (parts.length > 1) {
            description = parts.slice(1).join('|').trim();
          }
        }

        // Look ahead for quantity if not found
        if (qty === 1) {
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            const qtyMatch = lines[j].match(/\bQTY\s*:?\s*(\d+)\b/i);
            if (qtyMatch) {
              qty = parseInt(qtyMatch[1], 10);
              break;
            }
            const numMatch = lines[j].match(/^\s*(\d+)\s*$/);
            if (numMatch) {
              qty = parseInt(numMatch[1], 10);
              break;
            }
          }
        }

        console.debug(`[Flipkart SKU] Alternative extraction - Pattern 2: SKU=${skuId}, Qty=${qty}`);
        products.push({ skuId, description, qty });
      }
    }
    
    if (products.length > 0) {
      console.debug(`[Flipkart SKU] Alternative extraction found ${products.length} products`);
    }
    return products;
  }

  // Parse table rows after header
  let productsFound = 0;
  for (let i = tableStartIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    // Stop if we hit a section that's not part of the table
    const lineUpper = line.toUpperCase();
    const stopWords = ['SOLD BY', 'SHIPPING', 'AWB', 'ORDERED', 'HBD', 'CPD', 'TAX INVOICE'];
    if (stopWords.some(stopWord => lineUpper.includes(stopWord))) {
      console.debug(`[Flipkart SKU] Stopping at line ${i} (stop word detected): ${line.substring(0, 50)}`);
      break;
    }

    // Skip header rows
    if (lineUpper.includes('SKU ID') || lineUpper.includes('DESCRIPTION') || 
        (lineUpper.includes('QTY') && lineUpper.length < 20)) {
      continue;
    }

    // Pattern 1: "1 Product Name Weight | Description | QTY" (full table row)
    const tableRowMatch = line.match(/^(\d+\s+[A-Za-z].*?)\s*\|\s*(.*?)\s*\|\s*(\d+)/);
    if (tableRowMatch) {
      const skuId = tableRowMatch[1].trim();
      const description = tableRowMatch[2].trim();
      const qty = parseInt(tableRowMatch[3], 10);
      console.debug(`[Flipkart SKU] Pattern 1 match: SKU=${skuId}, Qty=${qty}`);
      products.push({ skuId, description, qty });
      productsFound++;
      continue;
    }

    // Pattern 2: "1 Product Name Weight" (SKU ID only, quantity might be on next line)
    const skuOnlyMatch = line.match(/^(\d+\s+[A-Za-z].*?)$/);
    if (skuOnlyMatch) {
      const skuId = skuOnlyMatch[1].trim();
      
      // Look ahead for quantity
      let qty = 1;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const qtyMatch = lines[j].match(/\bQTY\s*:?\s*(\d+)\b/i);
        if (qtyMatch) {
          qty = parseInt(qtyMatch[1], 10);
          break;
        }
        // Also check for standalone number
        const numMatch = lines[j].match(/^\s*(\d+)\s*$/);
        if (numMatch) {
          qty = parseInt(numMatch[1], 10);
          break;
        }
      }

      // Try to extract description from same line or next line
      let description = '';
      if (line.includes('|')) {
        const parts = line.split('|');
        if (parts.length > 1) {
          description = parts[1].trim();
        }
      } else {
        // Check next line for description
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.toUpperCase().includes('MITHILA') || nextLine.toUpperCase().includes('FOODS')) {
            description = nextLine;
          }
        }
      }

      console.debug(`[Flipkart SKU] Pattern 2 match: SKU=${skuId}, Qty=${qty}`);
      products.push({ skuId, description, qty });
      productsFound++;
      continue;
    }

    // Pattern 3: Try matching without strict line start (for multi-line SKUs)
    // Look for pattern anywhere in line: number + letter + product name
    const flexibleMatch = line.match(/(\d+\s+[A-Za-z][^\|]*?)(?:\s*\|\s*(.*?))?(?:\s*\|\s*(\d+))?/);
    if (flexibleMatch) {
      const skuId = flexibleMatch[1].trim();
      const description = flexibleMatch[2] ? flexibleMatch[2].trim() : '';
      const qty = flexibleMatch[3] ? parseInt(flexibleMatch[3], 10) : 1;
      
      // Only add if it looks like a valid SKU (has product name, not just numbers)
      if (skuId.match(/[A-Za-z]{2,}/)) {
        console.debug(`[Flipkart SKU] Pattern 3 match: SKU=${skuId}, Qty=${qty}`);
        products.push({ skuId, description, qty });
        productsFound++;
      }
    }
  }

  console.debug(`[Flipkart SKU] Extracted ${productsFound} products from table (starting at line ${tableStartIdx})`);
  return products;
};

/**
 * Main extraction function for Flipkart invoices
 * 
 * Extracts all product information from Flipkart PDF invoices:
 * - SKU IDs
 * - Product names and weights (parsed from SKU)
 * - Quantities
 * - Descriptions
 * 
 * @param pdfBytes PDF file bytes
 * @returns Structured product data
 */
export const extractProductInfoFlipkart = async (pdfBytes: Uint8Array): Promise<FlipkartExtractionResult> => {
  const result: FlipkartExtractionResult = {
    products: [],
    orderId: null,
    awbNumber: null
  };

  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;

    console.log(`[Flipkart PDF] Processing PDF with ${pdf.numPages} page(s)`);

    // Extract full text from all pages using smart joining
    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = smartJoinTextItems(textContent.items);
      fullText += pageText + '\n';
    }

    // Extract order ID (pattern: "OD\d+")
    const orderIdMatch = fullText.match(/OD\d+/);
    if (orderIdMatch) {
      result.orderId = orderIdMatch[0];
      console.log(`[Flipkart PDF] Found Order ID: ${result.orderId}`);
    }

    // Extract AWB number (pattern: "AWB No. (FMP[CP]\d+)")
    const awbMatch = fullText.match(/AWB\s+No\.\s*(FMP[CP]\d+)/i);
    if (awbMatch) {
      result.awbNumber = awbMatch[1];
      console.log(`[Flipkart PDF] Found AWB Number: ${result.awbNumber}`);
    }

    // Extract products from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = smartJoinTextItems(textContent.items);
      
      // Debug: Log page text preview
      const pageTextPreview = pageText.substring(0, 500);
      console.debug(`[Flipkart PDF] Page ${pageNum} text preview (first 500 chars): ${pageTextPreview}...`);
      
      const skuProducts = extractSkuFromPage(pageText);
      console.log(`[Flipkart PDF] Page ${pageNum}: Found ${skuProducts.length} SKU product(s)`);

      for (const { skuId, description, qty } of skuProducts) {
        // Clean SKU ID - remove description part if pipe exists
        let cleanSkuId = skuId;
        if (cleanSkuId.includes('|')) {
          cleanSkuId = cleanSkuId.split('|')[0].trim();
        }

        const { productName, weight } = parseSkuId(cleanSkuId);

        // Convert null to empty string for consistent handling
        const finalProductName = productName || '';
        const finalWeight = weight || '';

        const productInfo: FlipkartProductInfo = {
          skuId: cleanSkuId,
          productName: finalProductName,
          weight: finalWeight,
          description,
          qty,
          page: pageNum
        };

        result.products.push(productInfo);

        console.log(`[Flipkart PDF] Extracted: SKU=${cleanSkuId}, Product=${finalProductName}, Weight=${finalWeight}, Qty=${qty}`);
      }
    }

    console.log(`[Flipkart PDF] Total products extracted: ${result.products.length}`);
  } catch (error) {
    console.error('[Flipkart PDF] Error extracting product info:', error);
    throw error;
  }

  return result;
};

/**
 * Process multiple Flipkart PDF invoice files
 * 
 * @param files Array of PDF files
 * @param progressCallback Optional progress callback
 * @returns Processing result with SKU quantity data
 */
export const processFlipkartPdfInvoices = async (
  files: File[],
  progressCallback?: (progress: number, status: string) => void
): Promise<FlipkartPDFProcessingResult> => {
  const skuQtyData = new Map<string, number>();
  let totalInvoices = 0;
  let multiQtyInvoices = 0;
  const extractionResults: FlipkartExtractionResult[] = [];
  let failedPdfCount = 0;
  const allPdfBytes: Uint8Array[] = []; // Store PDF bytes for sorting

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx];
    const progress = (fileIdx + 1) / files.length;
    progressCallback?.(progress * 0.8, `📄 Processing Flipkart file ${fileIdx + 1}/${files.length}: ${file.name} (${Math.round(progress * 100)}%)`);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);

      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
      const pdf = await loadingTask.promise;

      console.log(`[Flipkart PDF] Loaded PDF: ${file.name}, Pages: ${pdf.numPages}`);

      // Count invoice pages (pages with SKU ID table)
      let invoiceCount = 0;
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = smartJoinTextItems(textContent.items);
        const pageTextUpper = pageText.toUpperCase();
        
        // Check for invoice page indicators
        const hasSkuId = pageTextUpper.includes('SKU ID') || pageTextUpper.includes('SKU');
        const hasDescription = pageTextUpper.includes('DESCRIPTION');
        const hasQty = pageTextUpper.includes('QTY') || pageTextUpper.includes('QUANTITY');
        
        if (hasSkuId && (hasDescription || hasQty)) {
          invoiceCount++;
          console.debug(`[Flipkart PDF] Page ${pageNum} identified as invoice page`);
          // Check if any item on this invoice page has qty > 1
          const pageProducts = extractSkuFromPage(pageText);
          if (pageProducts.some(p => p.qty > 1)) {
            multiQtyInvoices++;
          }
        }
      }

      console.log(`[Flipkart PDF] Found ${invoiceCount} invoice page(s) in ${file.name}`);
      totalInvoices += invoiceCount;

      // Read file fresh to avoid ArrayBuffer detachment error
      // PDF.js can detach/transfer the ArrayBuffer after first use, making it unusable
      // Reading the file again ensures we have a fresh, usable ArrayBuffer
      const arrayBufferFresh = await file.arrayBuffer();
      const pdfBytesFresh = new Uint8Array(arrayBufferFresh);

      // Store PDF bytes for sorting (create a copy to avoid detachment issues)
      const pdfBytesCopy = new Uint8Array(pdfBytesFresh);
      allPdfBytes.push(pdfBytesCopy);
      console.log(`[Flipkart PDF] Stored PDF bytes for sorting: ${file.name}, size: ${pdfBytesCopy.length} bytes`);

      // Extract product info using fresh bytes
      const extractionResult = await extractProductInfoFlipkart(pdfBytesFresh);
      extractionResults.push(extractionResult);

      // Aggregate quantities by SKU
      for (const product of extractionResult.products) {
        const currentQty = skuQtyData.get(product.skuId) || 0;
        skuQtyData.set(product.skuId, currentQty + product.qty);
      }

      progressCallback?.(progress * 0.9, `✅ Processed ${file.name} (${extractionResult.products.length} products)`);
    } catch (error) {
      console.error(`[Flipkart PDF] Error processing file ${file.name}:`, error);
      failedPdfCount++;
      progressCallback?.(progress, `❌ Failed to process ${file.name}`);
    }
  }

  progressCallback?.(1.0, `✅ Completed processing ${files.length} file(s)`);

  console.log(`[Flipkart PDF] Processing complete: ${allPdfBytes.length} PDF bytes stored for sorting`);

  return {
    skuQtyData,
    totalInvoices,
    multiQtyInvoices,
    extractionResults,
    failedPdfCount: failedPdfCount > 0 ? failedPdfCount : undefined,
    allPdfBytes: allPdfBytes.length > 0 ? allPdfBytes : undefined
  };
};

