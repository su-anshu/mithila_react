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

    // Group items by Y position (line), processing in PDF.js order
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
 * Strategy 1 (primary, order-independent):
 *   Scans ALL lines for the Flipkart shipping-label SKU row format:
 *     "{row_num} {SKU_name} | MITHILA {description} | ... {qty}"
 *   The "MITHILA" anchor prevents accidental matches in the tax invoice section.
 *
 * Strategy 2 (fallback):
 *   Finds the "SKU ID | Description QTY" table header, then takes the FIRST
 *   line after it that starts with \d+\s+[A-Za-z] as the SKU row.
 *   Stops looking after 15 lines or on a stop-word hit.
 *   Uses TOTAL QTY from the page as a qty fallback.
 *
 * Pattern 3 (the old "flexible" match with no ^ anchor) is intentionally removed
 * because it matched partial patterns inside tax invoice description text,
 * producing garbage SKUs like "2 kg" or "3 Natural" that accumulated into phantom
 * products (e.g. "Sattu 3kg qty=251") in the packing plan.
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

  console.debug(`[Flipkart SKU] Page text preview (first 500 chars): ${pageText.substring(0, 500)}...`);

  // ── Strategy 1: Mithila-specific pattern (order-independent) ──────────────
  // Matches only the shipping-label SKU table row because:
  //   • Starts with \d+ (row number) — tax invoice product rows start with letters
  //   • Has "MITHILA" right after the first pipe — tax invoice lines never do
  //   • Ends with a digit (the QTY column)
  // This pattern is safe to run over ALL lines regardless of ordering.
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Full row: "1 Jau Sattu 500g | MITHILA FOODS ... | High-Fiber 1"
    // Group 1 = "1 Jau Sattu 500g"  (skuId with row number)
    // Group 2 = "MITHILA FOODS ..."  (description)
    // Group 3 = "1"                  (qty — last number on the line)
    const m = line.match(/^(\d+\s+[A-Za-z][^|]*)\|\s*(MITHILA[^|]*)\|.*?(\d+)\s*$/i);
    if (m) {
      const skuId = m[1].trim();
      const description = m[2].trim();
      const qty = parseInt(m[3], 10);
      console.debug(`[Flipkart SKU] Strategy 1 match: SKU=${skuId}, Qty=${qty}`);
      products.push({ skuId, description, qty });
    }
  }

  if (products.length > 0) {
    console.debug(`[Flipkart SKU] Strategy 1 found ${products.length} product(s)`);
    return products;
  }

  // ── Strategy 2: Header-based fallback ────────────────────────────────────
  // Used when Strategy 1 finds nothing (e.g. description doesn't contain "MITHILA",
  // or the SKU row spans multiple lines).

  // Get TOTAL QTY from the page as a reliable qty fallback
  const totalQtyFromPage = (() => {
    const m = pageText.match(/TOTAL\s+QTY[:\s]*(\d+)/i);
    return m ? parseInt(m[1], 10) : 1;
  })();

  // Find "SKU ID | Description QTY" table header
  let tableStartIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lineUpper = lines[i].toUpperCase();
    if (lineUpper.includes('SKU ID') &&
        (lineUpper.includes('DESCRIPTION') || lineUpper.includes('QTY'))) {
      tableStartIdx = i;
      console.debug(`[Flipkart SKU] Strategy 2 header at line ${i}: ${lines[i].substring(0, 80)}`);
      break;
    }
  }

  if (tableStartIdx === null) {
    console.debug('[Flipkart SKU] No table header found');
    return products;
  }

  const stopWords = ['SOLD BY', 'AWB', 'HBD', 'CPD', 'TAX INVOICE', 'TOTAL QTY', 'SHIPPING'];

  // Look at up to 15 lines after the header; take the FIRST SKU row found
  for (let i = tableStartIdx + 1; i < Math.min(tableStartIdx + 16, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lineUpper = line.toUpperCase();

    // Stop on obvious section boundaries
    if (stopWords.some(sw => lineUpper.includes(sw))) {
      console.debug(`[Flipkart SKU] Strategy 2 stop word at line ${i}: ${line.substring(0, 50)}`);
      break;
    }

    // Skip repeated header rows
    if (lineUpper.includes('SKU ID') || lineUpper.includes('DESCRIPTION')) continue;

    // Must start with digit(s) + space + letter
    if (!/^\d+\s+[A-Za-z]/.test(line)) continue;

    // Extract skuId (everything before the first pipe, or the whole line)
    const skuId = line.includes('|') ? line.split('|')[0].trim() : line.trim();

    // Extract qty: try last number on the line first, then TOTAL QTY
    let qty = totalQtyFromPage;
    const endNumMatch = line.match(/(\d+)\s*$/);
    if (endNumMatch) {
      const candidate = parseInt(endNumMatch[1], 10);
      // Sanity-check: real qty should be ≤ 99; large numbers are prices/weights
      if (candidate <= 99) qty = candidate;
    }

    const description = line.includes('|') ? (line.split('|')[1] || '').trim() : '';

    console.debug(`[Flipkart SKU] Strategy 2 match: SKU=${skuId}, Qty=${qty}`);
    products.push({ skuId, description, qty });
    break; // each Flipkart invoice has exactly one product in the SKU table
  }

  console.debug(`[Flipkart SKU] Strategy 2 found ${products.length} product(s)`);
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

