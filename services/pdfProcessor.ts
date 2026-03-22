import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, PDFPage } from 'pdf-lib';

// Configure PDF.js worker — used only for the highlighting pass (coordinate-based)
if (typeof window !== 'undefined') {
  try {
    const workerVersion = pdfjsLib.version || '5.4.394';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${workerVersion}/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.error('[PDF Processing] Error configuring PDF.js worker:', e);
  }
}

export interface PDFProcessingResult {
  asinQtyData: Map<string, number>;
  highlightedPdfBytes: Uint8Array | null;
  totalInvoices: number;
  invoiceHasMultiQty: boolean[];
  // Optional debug / analysis fields
  invoicePageCount?: number;
  shippingPageCount?: number;
  asinAttempts?: number;
  asinAccepted?: number;
  asinRejectedByContext?: number;
  highlightingError?: string;
  failedPdfCount?: number;
  failedPdfNames?: string[]; // Names of files that failed to process
  diagnostics?: import('../types').PDFDiagnostics;
}

/**
 * Validate uploaded PDF file
 */
export const validatePdfFile = (file: File, maxSizeMB: number = 50): { valid: boolean; message: string } => {
  if (!file) {
    return { valid: false, message: 'No file uploaded' };
  }

  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return { valid: false, message: `File too large (max ${maxSizeMB}MB)` };
  }

  if (file.type !== 'application/pdf') {
    return { valid: false, message: 'Invalid file type - only PDF files allowed' };
  }

  return { valid: true, message: 'Valid file' };
};

/**
 * Extract ASIN from text using regex pattern.
 * NOTE: A regex match alone is NEVER enough – callers must always
 * also run {@link validateASINContext} to decide if the ASIN is valid.
 */
const extractASINFromText = (text: string): string[] => {
  // Extract ALL ASINs from text (not just first one) - a line might have multiple ASINs
  const asinPattern = /\b(B[0-9A-Z]{9})\b/g;
  const matches = text.matchAll(asinPattern);
  const asins: string[] = [];
  for (const match of matches) {
    asins.push(match[1]);
  }
  return asins;
};

/**
 * Validate ASIN context.
 *
 * This implements the defensive rules (matches Streamlit implementation):
 * 1) Prefer ASINs that appear inside the invoice table (between DESCRIPTION and TOTAL)
 * 2) Reject ASINs that appear in address / shipping blocks
 * 3) Allow ASINs that clearly have product context (HSN, NET WEIGHT, MRP, UNIT PRICE, TAX, IGST, CGST, SGST)
 *
 * IMPORTANT: If this function returns false the ASIN MUST be ignored,
 * even if the regex matched.
 */
const validateASINContext = (
  line: string,
  lineIndex: number,
  allLines: string[],
  asin: string,
  isContinuationPage?: boolean,
  fileName?: string,
  pageNumber?: number,
  rejectedAsinsArray?: import('../types').RejectedAsin[]
): { valid: boolean; reason?: string; score?: number; isInAddress?: boolean } => {
  // Match Streamlit: look back/forward 20 lines (not 30)
  const lookBack = Math.max(0, lineIndex - 20);
  const lookForward = Math.min(allLines.length, lineIndex + 20);

  let inInvoiceTable = false;
  let descriptionFound = false;
  let descriptionLineIndex = -1;
  let totalLineIndex = -1;

  // Check for invoice table markers - look for DESCRIPTION header and TOTAL footer
  for (let i = lookBack; i < lookForward; i++) {
    if (i >= allLines.length) break;
    const lineText = allLines[i].toUpperCase();

    // Look for DESCRIPTION header (with QTY/QUANTITY column or SL. NO)
    if (lineText.includes('DESCRIPTION') &&
      (lineText.includes('QTY') || lineText.includes('QUANTITY') ||
        lineText.includes('SL. NO') || lineText.includes('SL.NO') ||
        lineText.includes('UNIT PRICE'))) {
      descriptionFound = true;
      descriptionLineIndex = i;
    }

    // Check if TOTAL appears (could be before or after current line)
    if (lineText.includes('TOTAL') && descriptionFound) {
      if (totalLineIndex === -1) {
        totalLineIndex = i;
      }
    }
  }

  // Determine if we're in invoice table: must be between DESCRIPTION and TOTAL
  if (descriptionFound && descriptionLineIndex !== -1) {
    if (totalLineIndex === -1) {
      // No TOTAL found in lookBack/lookForward range - look forward further to confirm TOTAL exists
      for (let i = lineIndex; i < Math.min(allLines.length, lineIndex + 50); i++) {
        if (allLines[i].toUpperCase().includes('TOTAL')) {
          totalLineIndex = i;
          // TOTAL found after current line - we're in table if description was before current line
          inInvoiceTable = (descriptionLineIndex < lineIndex && lineIndex < totalLineIndex);
          break;
        }
      }
      // If still no TOTAL found, assume we're in table if description was before current line
      if (totalLineIndex === -1) {
        inInvoiceTable = (descriptionLineIndex < lineIndex);
      }
    } else {
      // TOTAL found in lookBack/lookForward range - check if current line is between DESCRIPTION and TOTAL
      inInvoiceTable = (descriptionLineIndex < lineIndex && lineIndex < totalLineIndex);
    }
  }

  // Handle continuation pages (multi-page invoices)
  // On continuation pages, DESCRIPTION is on page 1, so we can't find it on current page
  if (isContinuationPage) {
    // Check for TOTAL on current page to determine table boundaries
    let totalFoundOnPage = false;
    let totalLineIndexOnPage = -1;
    for (let i = lineIndex; i < Math.min(allLines.length, lineIndex + 100); i++) {
      if (allLines[i].toUpperCase().includes('TOTAL')) {
        totalFoundOnPage = true;
        totalLineIndexOnPage = i;
        break;
      }
    }

    // If TOTAL found after current line, we're still in invoice table
    if (totalFoundOnPage && totalLineIndexOnPage > lineIndex) {
      inInvoiceTable = true;
    } else if (!totalFoundOnPage) {
      // No TOTAL found - assume continuation (products may continue to next page)
      inInvoiceTable = true;
    }
    // If TOTAL found before current line, we're past the table (inInvoiceTable stays false)
  }

  // Check for address / shipping indicators (negative signals) - STRICT REJECTION
  // Match Streamlit: Use regex patterns for stronger detection
  const strongAddressPatterns = [
    /SHIP\s+TO\s*:?/i,
    /DELIVERY\s+ADDRESS\s*:?/i,
    /SHIPPING\s+ADDRESS\s*:?/i,
    /BILLING\s+ADDRESS\s*:?/i,
    /PIN\s*CODE\s*:?/i,
    /PINCODE\s*:?/i,
    /POSTAL\s+CODE\s*:?/i,
    /STATE\s*:?/i,
    /CITY\s*:?/i
  ];

  const addressKeywords = [
    'SHIP TO', 'DELIVERY ADDRESS', 'SHIPPING ADDRESS', 'BILLING ADDRESS',
    'PIN CODE', 'PINCODE', 'POSTAL CODE', 'STATE:', 'CITY:',
    'MOBILE', 'PHONE', 'CONTACT', 'CUSTOMER NAME', 'SHIP FROM', 'RETURN ADDRESS'
  ];

  // Match Streamlit: Check context in surrounding lines (5 lines before/after)
  const contextText = allLines
    .slice(Math.max(0, lineIndex - 5), Math.min(allLines.length, lineIndex + 5))
    .join(' ')
    .toUpperCase();

  // Match Streamlit: Use regex patterns first, then keyword matching
  const isInStrongAddress = strongAddressPatterns.some(pattern => pattern.test(contextText));
  const addressInLine = addressKeywords.some(keyword => line.toUpperCase().includes(keyword));
  const isInAddress = isInStrongAddress || addressInLine;

  // Check for product context (positive signals) - check both the line and nearby lines
  const productIndicators = [
    'HSN',
    'NET WEIGHT',
    'MRP',
    'UNIT PRICE',
    'DISCOUNT',
    'TAX',
    'IGST',
    'CGST',
    'SGST'
  ];
  const hasProductContext = productIndicators.some(indicator => line.toUpperCase().includes(indicator));

  // Also check nearby lines for product context (since ASIN might be in Description column, price/tax in adjacent columns)
  let hasNearbyProductContext = false;
  for (let i = Math.max(0, lineIndex - 3); i <= Math.min(allLines.length - 1, lineIndex + 3); i++) {
    if (productIndicators.some(indicator => allLines[i].toUpperCase().includes(indicator))) {
      hasNearbyProductContext = true;
      break;
    }
  }

  // Calculate score (matching Streamlit scoring system exactly)
  // Streamlit calculates score after validation, but we calculate it here for efficiency
  let score = 0;
  // Check if in invoice table area (look back 10 lines for DESCRIPTION) - matches Streamlit
  // On continuation pages, DESCRIPTION is on page 1, so we check inInvoiceTable instead
  if (isContinuationPage && inInvoiceTable) {
    score += 2; // On continuation page and in invoice table (highest score)
  } else {
    const lookBackForDescription = Math.max(0, lineIndex - 10);
    const descriptionContext = allLines
      .slice(lookBackForDescription, lineIndex)
      .join(' ')
      .toUpperCase();

    if (descriptionContext.includes('DESCRIPTION')) {
      score += 2; // In invoice table area (highest score) - matches Streamlit
    }
  }

  // Check for product indicators in the line itself (matches Streamlit: checks line_upper)
  const lineUpper = line.toUpperCase();
  const productIndicatorsInLine = ['HSN', 'MRP', 'UNIT PRICE', 'TAX'];
  if (productIndicatorsInLine.some(indicator => lineUpper.includes(indicator))) {
    score += 1; // Has product context (lower score) - matches Streamlit
  }

  // DECISION LOGIC (matching Streamlit implementation exactly):
  // Python: if (is_in_strong_address or address_in_line) and not in_invoice_table and not has_product_context:
  // Only reject if ALL conditions are true: (address AND not in table AND no product context)

  // 1. If in invoice table, ACCEPT (even if in address section - invoice table takes priority)
  // This is the key fix - Amazon invoices have ASINs in Description column, which may not have HSN/price on same line
  if (inInvoiceTable) {
    // Ensure score is at least 2 for invoice table ASINs
    return { valid: true, reason: 'in_invoice_table', score: Math.max(score, 2), isInAddress: isInAddress };
  }

  // 2. If has product context (on line or nearby), ACCEPT (even if in address section - product context takes priority)
  if (hasProductContext || hasNearbyProductContext) {
    // Ensure score is at least 1 for product context ASINs
    return { valid: true, reason: 'has_product_context', score: Math.max(score, 1), isInAddress: isInAddress };
  }

  // 3. If in address section AND not in invoice table AND no product context, REJECT
  // Match Python: Only reject if ALL three conditions are true
  if (isInAddress && !inInvoiceTable && !hasProductContext && !hasNearbyProductContext) {
    // Add to diagnostics if array provided
    if (rejectedAsinsArray && fileName && pageNumber !== undefined) {
      const contextLines = allLines.slice(
        Math.max(0, lineIndex - 3),
        Math.min(allLines.length, lineIndex + 4)
      );
      rejectedAsinsArray.push({
        asin,
        reason: 'in_address_section',
        lineIndex,
        lineContent: line,
        contextLines,
        score: -1,
        isInAddress: true,
        fileName,
        pageNumber
      });
    }
    return { valid: false, reason: 'in_address_section', score: -1, isInAddress: true };
  }

  // 4. Otherwise, ambiguous - return with score 0 (will be accepted if no better ASIN found)
  // Match Streamlit: Accept ambiguous ASINs if not in address and no better one found
  return { valid: false, reason: 'no_product_context_or_table', score: 0, isInAddress: isInAddress };
};

/**
 * Extract quantity from line using multiple patterns.
 * Matches Streamlit (packing_plan.py) implementation exactly:
 *   search_range = min(i + 6, len(lines))
 *   Pattern 1: r'\bQty\b.*?(\d+)'
 *   Pattern 2: r'₹[\d,.]+\s+(\d+)\s+₹[\d,.]+'
 *   Pattern 3: r'^(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)'
 *   Pattern 4: r'^(\d+)' at start + not qty% + not HSN + has ₹
 */
const extractQuantity = (
  line: string,
  lines: string[],
  startIndex: number,
  asin?: string,
  fileName?: string,
  pageNumber?: number,
  diagnosticsArray?: import('../types').QuantityDefault[]
): number => {
  let qty = 1;
  // pdf.js Y-coordinate grouping splits rows into more lines than PyMuPDF.
  // Streamlit uses 6 lines (sufficient for PyMuPDF), but pdf.js needs more because
  // long product descriptions wrap across many Y-groups before reaching the price/qty row.
  // Use 15-line window with early termination at invoice boundaries.
  const maxSearchRange = Math.min(startIndex + 15, lines.length);

  for (let j = startIndex; j < maxSearchRange; j++) {
    const qtyLine = lines[j];
    const qtyLineUpper = qtyLine.toUpperCase();

    // Early termination: reached a DIFFERENT ASIN (next product row) — check before patterns
    if (j > startIndex && asin) {
      const asinMatch = qtyLine.match(/\b(B[0-9A-Z]{9})\b/g);
      if (asinMatch && !asinMatch.includes(asin)) break;
    }

    // Pattern 1: Qty keyword pattern — matches "Qty 3", "Qty: 2", etc.
    // Streamlit: qty_pattern = re.compile(r"\bQty\b.*?(\d+)")
    const qtyKeywordMatch = qtyLine.match(/\bQty\b.*?(\d+)/i);
    if (qtyKeywordMatch) {
      const potentialQty = parseInt(qtyKeywordMatch[1], 10);
      if (potentialQty >= 1 && potentialQty <= 100) {
        qty = potentialQty;
        console.log(`[Quantity Extraction] Found qty ${qty} using Qty-keyword pattern: ${qtyLine.trim()}`);
        break;
      }
    }

    // Pattern 2: Qty between two prices — "₹500 3 ₹1500"
    // Streamlit: price_qty_pattern = re.compile(r"₹[\d,.]+\s+(\d+)\s+₹[\d,.]+")
    const priceBothSidesMatch = qtyLine.match(/₹[\d,.]+\s+(\d+)\s+₹[\d,.]+/);
    if (priceBothSidesMatch) {
      const potentialQty = parseInt(priceBothSidesMatch[1], 10);
      if (potentialQty >= 1 && potentialQty <= 100) {
        qty = potentialQty;
        console.log(`[Quantity Extraction] Found qty ${qty} using price-both-sides pattern: ${qtyLine.trim()}`);
        break;
      }
    }

    // Pattern 3: Qty at line start followed by ₹ price and tax — "3 ₹2,768.67 5% IGST"
    // Streamlit: r'^(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)'
    const priceQtyPattern = /^(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)/i;
    const priceMatch = qtyLine.trim().match(priceQtyPattern);
    if (priceMatch) {
      const potentialQty = parseInt(priceMatch[1], 10);
      if (potentialQty >= 1 && potentialQty <= 100) {
        qty = potentialQty;
        console.log(`[Quantity Extraction] Found qty ${qty} using qty-price-tax pattern: ${qtyLine.trim()}`);
        break;
      }
    }

    // Pattern 4: Standalone number at start of line + has ₹ on same line + not a tax % + not HSN
    // Streamlit: r'^(\d+)' at start, not qty%, not HSN:, has ₹
    // FIX: use /^\d+(\.\d+)?%/ to reject DECIMAL tax percentages like "2.5% SGST ₹7.12".
    // The original check ^N% only rejected "2%" but NOT "2.5%", causing the digit 2
    // from "2.5%" to be incorrectly extracted as qty=2.
    const standaloneMatchStart = qtyLine.trim().match(/^(\d+)/);
    if (standaloneMatchStart) {
      const potentialQty = parseInt(standaloneMatchStart[1], 10);
      if (
        potentialQty >= 1 &&
        potentialQty <= 100 &&
        !qtyLine.trim().match(/^\d+(\.\d+)?%/) &&   // reject any tax % line (e.g. 2.5%, 5%, 18%)
        !qtyLineUpper.includes('HSN') &&
        qtyLine.includes('₹')
      ) {
        qty = potentialQty;
        console.log(`[Quantity Extraction] Found qty ${qty} using standalone-start pattern: ${qtyLine.trim()}`);
        break;
      }
    }

  }

  // Backward search fallback: In some Amazon invoices, pdf.js places the ASIN in a
  // wrapped description line that comes AFTER the price/qty row in Y-coordinate order.
  // e.g. Line N:   "Thekua 350g    ₹672.51  3  ₹2,019.54"  (price/qty row)
  //      Line N+k: "B0FLWMFVDN ( thekua 350g p3 )"          (ASIN in wrapped line)
  // So if forward search found nothing, scan backward from startIndex.
  if (qty === 1) {
    const backSearchStart = Math.max(0, startIndex - 12);
    for (let j = startIndex - 1; j >= backSearchStart; j--) {
      const qtyLine = lines[j];
      const qtyLineUpper = qtyLine.toUpperCase();

      // Stop if we hit a different ASIN (previous product's row)
      if (asin) {
        const asinMatch = qtyLine.match(/\b(B[0-9A-Z]{9})\b/g);
        if (asinMatch && !asinMatch.includes(asin)) break;
      }

      // Pattern 1
      const qtyKeywordMatch = qtyLine.match(/\bQty\b.*?(\d+)/i);
      if (qtyKeywordMatch) {
        const potentialQty = parseInt(qtyKeywordMatch[1], 10);
        if (potentialQty >= 1 && potentialQty <= 100) {
          qty = potentialQty;
          console.log(`[Quantity Extraction] Found qty ${qty} using Qty-keyword pattern (backward): ${qtyLine.trim()}`);
          break;
        }
      }

      // Pattern 2
      const priceBothSidesMatch = qtyLine.match(/₹[\d,.]+\s+(\d+)\s+₹[\d,.]+/);
      if (priceBothSidesMatch) {
        const potentialQty = parseInt(priceBothSidesMatch[1], 10);
        if (potentialQty >= 1 && potentialQty <= 100) {
          qty = potentialQty;
          console.log(`[Quantity Extraction] Found qty ${qty} using price-both-sides pattern (backward): ${qtyLine.trim()}`);
          break;
        }
      }

      // Pattern 3
      const priceMatch = qtyLine.trim().match(/^(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)/i);
      if (priceMatch) {
        const potentialQty = parseInt(priceMatch[1], 10);
        if (potentialQty >= 1 && potentialQty <= 100) {
          qty = potentialQty;
          console.log(`[Quantity Extraction] Found qty ${qty} using qty-price-tax pattern (backward): ${qtyLine.trim()}`);
          break;
        }
      }

      // Pattern 4
      const standaloneMatchStart = qtyLine.trim().match(/^(\d+)/);
      if (standaloneMatchStart) {
        const potentialQty = parseInt(standaloneMatchStart[1], 10);
        if (
          potentialQty >= 1 &&
          potentialQty <= 100 &&
          !qtyLine.trim().match(/^\d+(\.\d+)?%/) &&
          !qtyLineUpper.includes('HSN') &&
          qtyLine.includes('₹')
        ) {
          qty = potentialQty;
          console.log(`[Quantity Extraction] Found qty ${qty} using standalone-start pattern (backward): ${qtyLine.trim()}`);
          break;
        }
      }
    }
  }

  console.log(`[QTY DEBUG] ASIN: ${asin} | Qty: ${qty} | Lines in window: ${maxSearchRange - startIndex} | File: ${fileName}`);
  return qty;
};

/**
 * Process PDF to extract ASINs and quantities, and highlight quantities > 1
 */
export const processPdfInvoices = async (
  files: File[],
  progressCallback?: (progress: number, status: string) => void
): Promise<PDFProcessingResult> => {
  const asinQtyData = new Map<string, number>();
  let totalInvoices = 0;
  const invoiceHasMultiQty: boolean[] = [];
  const allPdfBytes: Uint8Array[] = [];

  // Global debug / analysis counters across all files
  let globalInvoicePageCount = 0;
  let globalShippingPageCount = 0;
  let globalAsinAttempts = 0;
  let globalAsinAccepted = 0;
  let globalAsinRejectedByContext = 0;

  // Diagnostics collection arrays
  const quantityDefaults: import('../types').QuantityDefault[] = [];
  const rejectedAsins: import('../types').RejectedAsin[] = [];
  const pageClassifications: import('../types').PageClassification[] = [];

  // First pass: Extract ASINs and quantities (0-30%)
  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx];
    const progress = 0.0 + ((fileIdx + 1) / files.length) * 0.30;
    progressCallback?.(progress, `📄 Processing file ${fileIdx + 1}/${files.length}: ${file.name} (${Math.round(progress * 100)}%)`);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);

      // Create a true copy with a new ArrayBuffer using slice() - this ensures the bytes remain available
      // even if pdf.js detaches/transfers the original ArrayBuffer
      // slice() creates a new Uint8Array with a new underlying ArrayBuffer (not just a view)
      const pdfBytesCopy = pdfBytes.slice();
      allPdfBytes.push(pdfBytesCopy);

      // Use MuPDF (WebAssembly) for text extraction — same engine as PyMuPDF (Streamlit).
      // This gives identical line grouping: full table rows on one line, ASIN and qty together.
      const mupdf = await import('mupdf');
      const mupdfDoc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
      const numPages = mupdfDoc.countPages();

      console.log(`[PDF Processing] Loaded PDF: ${file.name}, Pages: ${numPages}`);

      const pagesText: string[][] = [];
      const pageTypes: ('invoice' | 'shipping' | 'unknown')[] = [];
      const pageNumberInfos: ({ current: number; total: number } | null)[] = [];
      let previousPageNumberInfo: { current: number; total: number } | null = null;

      // Extract text from all pages using MuPDF structured text
      for (let pageNum = 0; pageNum < numPages; pageNum++) {
        const page = mupdfDoc.loadPage(pageNum);
        const stext = page.toStructuredText("preserve-whitespace");
        const pageText = stext.asText().split('\n').filter((line: string) => line.trim().length > 0);
        pagesText.push(pageText);

        // Log text extraction for debugging (first 200 chars only)
        const pageTextPreview = pageText.join(' ').substring(0, 200);
        console.debug(`[PDF Processing] Page ${pageNum + 1} text preview (first 200 chars): ${pageTextPreview}...`);

        // Page-level classification
        // Match Streamlit: Simple check for DESCRIPTION + QTY/QUANTITY
        const pageTextCombined = pageText.join(' ').toUpperCase();

        // Extract page number pattern (e.g., "Page 1 of 2", "Page 2 of 2")
        const pageNumberPattern = /Page\s+(\d+)\s+of\s+(\d+)/i;
        const pageNumberMatch = pageTextCombined.match(pageNumberPattern);
        let pageNumberInfo: { current: number; total: number } | null = null;
        if (pageNumberMatch) {
          pageNumberInfo = {
            current: parseInt(pageNumberMatch[1], 10),
            total: parseInt(pageNumberMatch[2], 10)
          };
          console.log(`[PDF Processing] Page ${pageNum} has pagination: Page ${pageNumberInfo.current} of ${pageNumberInfo.total}`);
        }
        const isInvoicePage =
          pageTextCombined.includes('DESCRIPTION') &&
          (pageTextCombined.includes('QTY') || pageTextCombined.includes('QUANTITY'));

        const isShippingLabelPage =
          !isInvoicePage && (
            (pageTextCombined.includes('AWB') && pageTextCombined.includes('SHIP TO')) ||
            pageTextCombined.includes('DELIVERY STATION') ||
            pageTextCombined.includes('SORTZONE') ||
            pageTextCombined.includes('SOLD ON: WWW.AMAZON.IN')
          );

        let pageType: 'invoice' | 'shipping' | 'unknown' = 'unknown';
        if (isInvoicePage) {
          pageType = 'invoice';
          globalInvoicePageCount++;
        } else if (isShippingLabelPage) {
          pageType = 'shipping';
          globalShippingPageCount++;
        }

        // Detect continuation pages with multiple strategies
        if (pageNum > 1) {
          const prevPageType = pageTypes[pageNum - 2];

          // Strategy 1: Page number sequence detection (MOST RELIABLE for Amazon invoices)
          // If previous page had "Page 1 of 2" and current has "Page 2 of 2"
          if (previousPageNumberInfo && pageNumberInfo) {
            const isPaginationSequence =
              prevPageType === 'invoice' &&
              pageNumberInfo.current === previousPageNumberInfo.current + 1 &&
              pageNumberInfo.total === previousPageNumberInfo.total;

            if (isPaginationSequence) {
              pageType = 'invoice';
              globalInvoicePageCount++;
              console.log(`[PDF Processing] Page ${pageNum} identified as invoice continuation via page numbering (Page ${pageNumberInfo.current} of ${pageNumberInfo.total})`);
              previousPageNumberInfo = pageNumberInfo;
              pageNumberInfos.push(pageNumberInfo);
              pageTypes.push(pageType);
              continue;
            }
          }

          // Strategy 2: Multi-page invoice without products (payment/summary pages)
          // Previous page was invoice AND current has page numbering (even if no products)
          if (prevPageType === 'invoice' && pageNumberInfo && pageNumberInfo.current > 1) {
            pageType = 'invoice';
            globalInvoicePageCount++;
            console.log(`[PDF Processing] Page ${pageNum} identified as invoice continuation via page numbering only (Page ${pageNumberInfo.current} of ${pageNumberInfo.total}, no products)`);
            previousPageNumberInfo = pageNumberInfo;
            pageNumberInfos.push(pageNumberInfo);
            pageTypes.push(pageType);
            continue;
          }

          // Strategy 3: Previous page + invoice-specific tax/HSN indicators ONLY.
          // IMPORTANT: We deliberately exclude '₹' and bare ASIN presence.
          // Amazon shipping labels contain '₹' (MRP sticker) and the product ASIN,
          // but they do NOT contain GST tax columns (IGST/CGST/SGST) or HSN codes.
          // Only real invoice continuation pages carry those tax/HSN markers.
          const hasInvoiceIndicators =
            pageTextCombined.includes('HSN') ||
            pageTextCombined.includes('IGST') ||
            pageTextCombined.includes('CGST') ||
            pageTextCombined.includes('SGST');

          // Strategy 4: Has TOTAL but no new invoice header (end of multi-page invoice)
          // Also require invoice indicators to avoid triggering on shipping label "TOTAL MRP" text
          const hasTOTAL = pageTextCombined.includes('TOTAL');
          const hasNewInvoiceHeader = pageTextCombined.includes('INVOICE NO') ||
            pageTextCombined.includes('TAX INVOICE');

          // Strategy 5: Check for continuation markers
          const hasContinuationMarkers =
            pageTextCombined.includes('CONTINUED') ||
            pageTextCombined.includes('CONTD');

          const isContinuation =
            (prevPageType === 'invoice' && !isInvoicePage && !isShippingLabelPage &&
              hasInvoiceIndicators) ||
            (hasTOTAL && !hasNewInvoiceHeader && prevPageType === 'invoice' && hasInvoiceIndicators) ||
            hasContinuationMarkers;

          if (isContinuation) {
            pageType = 'invoice';
            globalInvoicePageCount++;
            console.log(`[PDF Processing] Page ${pageNum} identified as continuation (strategy: ${hasContinuationMarkers ? 'markers' : hasInvoiceIndicators ? 'invoiceIndicators' : 'TOTAL'})`);
          }
        }

        // Store page number info for next iteration
        previousPageNumberInfo = pageNumberInfo;
        pageNumberInfos.push(pageNumberInfo);
        pageTypes.push(pageType);

        if (isInvoicePage) {
          totalInvoices++;
          let invoiceHasMulti = false;

          // Check for quantities > 1 in this invoice
          for (let i = 0; i < pageText.length; i++) {
            const lineUpper = pageText[i].toUpperCase();
            if (lineUpper.includes('DESCRIPTION') && (lineUpper.includes('QTY') || lineUpper.includes('QUANTITY'))) {
              const searchRange = Math.min(i + 20, pageText.length);
              for (let j = i + 1; j < searchRange; j++) {
                const qtyLine = pageText[j];
                if (qtyLine.toUpperCase().includes('TOTAL')) break;

                // Check various quantity patterns
                const qtyMatch = qtyLine.match(/\bQty\b.*?(\d+)/i);
                if (qtyMatch) {
                  const qtyVal = parseInt(qtyMatch[1], 10);
                  if (qtyVal > 1) {
                    invoiceHasMulti = true;
                    break;
                  }
                }

                const priceQtyMatch = qtyLine.match(/₹[\d,.]+?\s+(\d+)\s+₹[\d,.]+/);
                if (priceQtyMatch) {
                  const qtyVal = parseInt(priceQtyMatch[1], 10);
                  if (qtyVal > 1) {
                    invoiceHasMulti = true;
                    break;
                  }
                }

                const multiItemMatch = qtyLine.trim().match(/^(\d+)\s+₹[\d,.]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)/);
                if (multiItemMatch) {
                  const qtyVal = parseInt(multiItemMatch[1], 10);
                  if (qtyVal > 1) {
                    invoiceHasMulti = true;
                    break;
                  }
                }

                const standaloneMatch = qtyLine.trim().match(/^(\d+)/);
                if (standaloneMatch) {
                  const qtyVal = parseInt(standaloneMatch[1], 10);
                  if (qtyVal > 1 && qtyVal <= 100 && qtyLine.includes('₹')) {
                    invoiceHasMulti = true;
                    break;
                  }
                }
              }
              if (invoiceHasMulti) break;
            }
          }

          invoiceHasMultiQty.push(invoiceHasMulti);
        }
      }

      // Extract ASINs and quantities from pages
      // Match Streamlit: Process ALL pages, use scoring system to pick best ASIN per page
      let asinExtractionAttempts = 0;
      let asinExtractionSuccesses = 0;
      let asinContextRejections = 0;

      for (let pageIndex = 0; pageIndex < pagesText.length; pageIndex++) {
        const lines = pagesText[pageIndex];
        const pageType = pageTypes[pageIndex] ?? 'unknown';

        // Only process invoice pages — skip shipping label pages entirely.
        // pdf.js extracts text from shipping label elements (product details, barcodes)
        // that PyMuPDF ignores, causing each ASIN to be found on both the shipping page
        // AND the invoice page, doubling the count.
        if (pageType === 'shipping') {
          continue;
        }

        // Detect if this is a continuation page (multi-page invoice)
        // Continuation pages: previous page was invoice, current page has products but no DESCRIPTION
        const previousPageWasInvoice = pageIndex > 0 && pageTypes[pageIndex - 1] === 'invoice';
        const currentPageHasProducts = lines.some(line => {
          const upper = line.toUpperCase();
          return upper.includes('HSN') || upper.includes('₹') ||
            upper.includes('IGST') || upper.includes('CGST') || upper.includes('SGST') ||
            /\b(B[0-9A-Z]{9})\b/.test(upper);
        });
        const isContinuationPage = previousPageWasInvoice &&
          pageType === 'invoice' && // Already marked as invoice continuation
          currentPageHasProducts;

        // Match Streamlit: Process ALL ASINs immediately as they pass validation
        // Streamlit adds every valid ASIN directly, doesn't wait to pick best per page
        // Track for logging
        let pageValidCount = 0;
        let pageAmbiguousCount = 0;
        let pageRejectedCount = 0;
        let pageAsinsFound = 0;

        // Per-page deduplication: pdf.js Y-coordinate grouping can place the same ASIN
        // on multiple reconstructed lines when invoice structures vary (different header
        // sizes, table heights). PyMuPDF (Streamlit) reads each ASIN once per page.
        // We replicate that by accepting each ASIN at most once per PDF page.
        const seenAsinsOnPage = new Set<string>();

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Extract ALL ASINs from line (a line might have multiple ASINs)
          const asins = extractASINFromText(line);
          if (asins.length > 0) {
            pageAsinsFound += asins.length;
            console.debug(`[PDF Processing] Page ${pageIndex + 1}, Line ${i}: Found ${asins.length} ASIN(s): ${asins.join(', ')}`);
          }
          for (const asin of asins) {
            asinExtractionAttempts++;
            globalAsinAttempts++;

            // Skip if this ASIN was already accepted on this page (pdf.js duplicate extraction)
            if (seenAsinsOnPage.has(asin)) {
              console.debug(`[PDF Processing] Skipping duplicate ASIN on same page: ${asin}, Page ${pageIndex + 1}, Line ${i}`);
              continue;
            }

            const validationResult = validateASINContext(
              line, i, lines, asin, isContinuationPage,
              file.name, pageIndex + 1, rejectedAsins
            );

            // Debug: Log all ASIN validation results to identify missing ones
            if (!validationResult.valid && !validationResult.isInAddress) {
              const linePreview = line.substring(0, 150).replace(/\s+/g, ' ');
              console.debug(`[PDF Processing] ⚠ AMBIGUOUS ASIN found (will accept): ${asin} from file: ${file.name}, Page ${pageIndex + 1}, Line ${i}, reason: ${validationResult.reason}, line: "${linePreview}"`);
            }

            // Match Streamlit: Add ASIN immediately if valid OR if ambiguous (not in address)
            if (validationResult.valid) {
              // Valid ASIN (in invoice table or has product context) - add immediately
              seenAsinsOnPage.add(asin);
              const qty = extractQuantity(
                line, lines, i,
                asin, file.name, pageIndex + 1, quantityDefaults
              );
              const currentQty = asinQtyData.get(asin) || 0;
              const newQty = currentQty + qty;
              asinQtyData.set(asin, newQty);
              asinExtractionSuccesses++;
              globalAsinAccepted++;
              pageValidCount++;

              // Comparison logging (matches Python format)
              console.log(`[ASIN Extraction] Found ASIN ${asin} with qty ${qty} (context: invoice_table=${validationResult.reason === 'in_invoice_table'}, product_context=${validationResult.reason === 'has_product_context'})`);
              console.log(`[ASIN Accumulation] ASIN ${asin}: previous=${currentQty}, adding=${qty}, new total=${newQty}`);

              // Log extracted ASIN with line context and quantity details
              const qtyChangeNote = currentQty > 0 ? ` (was ${currentQty}, now ${newQty} - added ${qty})` : ` (new, qty ${qty})`;
              const linePreview = line.substring(0, 150).replace(/\s+/g, ' ');
              console.log(`[PDF Processing] ✓ ACCEPTED ASIN: ${asin}, Qty: ${qty}${qtyChangeNote} from file: ${file.name}, Page ${pageIndex + 1}, Line ${i}, reason: ${validationResult.reason}, score: ${validationResult.score || 0}`);
              console.log(`[PDF Processing]   Line content: "${linePreview}"`);
            } else if (!validationResult.isInAddress) {
              // Ambiguous ASIN (not in address, but no clear context) - accept as fallback
              seenAsinsOnPage.add(asin);
              const qty = extractQuantity(
                line, lines, i,
                asin, file.name, pageIndex + 1, quantityDefaults
              );
              const currentQty = asinQtyData.get(asin) || 0;
              const newQty = currentQty + qty;
              asinQtyData.set(asin, newQty);
              asinExtractionSuccesses++;
              globalAsinAccepted++;
              pageAmbiguousCount++;

              // Comparison logging (matches Python format)
              console.log(`[ASIN Extraction] Found ASIN ${asin} with qty ${qty} (context: ambiguous - not in address, no clear context)`);
              console.log(`[ASIN Accumulation] ASIN ${asin}: previous=${currentQty}, adding=${qty}, new total=${newQty}`);

              // Log ambiguous ASIN acceptance with line context and quantity details
              const qtyChangeNote = currentQty > 0 ? ` (was ${currentQty}, now ${newQty} - added ${qty})` : ` (new, qty ${qty})`;
              const linePreview = line.substring(0, 150).replace(/\s+/g, ' ');
              console.log(`[PDF Processing] ✓ ACCEPTED AMBIGUOUS ASIN (fallback): ${asin}, Qty: ${qty}${qtyChangeNote} from file: ${file.name}, Page ${pageIndex + 1}, Line ${i} - not in address, no clear context`);
              console.log(`[PDF Processing]   Line content: "${linePreview}"`);
            } else {
              // Rejected ASIN (in address section)
              asinContextRejections++;
              globalAsinRejectedByContext++;
              pageRejectedCount++;
              // Log detailed rejection reason with context
              const contextLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 2));
              console.warn(`[PDF Processing] ✗ REJECTED ASIN: ${asin} from file: ${file.name}`, {
                reason: validationResult.reason,
                lineIndex: i,
                line: line.substring(0, 150),
                context: contextLines.map((l, idx) => `Line ${Math.max(0, i - 2) + idx}: ${l.substring(0, 100)}`).join('\n')
              });

              // Additional debug logging for address section rejections
              if (validationResult.isInAddress) {
                console.warn(`[ASIN Validation] Rejected ASIN in address: ${asin}, line: "${line.substring(0, 100)}"`);
              }
            }
          }
        }

        // Collect page classification data
        const pageHasDescription = lines.some(line => {
          const upper = line.toUpperCase();
          return upper.includes('DESCRIPTION') &&
            (upper.includes('QTY') || upper.includes('QUANTITY'));
        });
        const pageHasTOTAL = lines.some(line => line.toUpperCase().includes('TOTAL'));

        const pageNumInfo = pageNumberInfos[pageIndex] ?? null;
        pageClassifications.push({
          fileName: file.name,
          pageNumber: pageIndex + 1,
          pageType,
          isContinuation: isContinuationPage,
          hasDescription: pageHasDescription,
          hasTOTAL: pageHasTOTAL,
          asinsFound: pageAsinsFound,
          asinsAccepted: pageValidCount + pageAmbiguousCount,
          asinsRejected: pageRejectedCount,
          pageNumbering: pageNumInfo ? `Page ${pageNumInfo.current} of ${pageNumInfo.total}` : undefined
        });

        // Log page summary for debugging
        if (pageValidCount > 0 || pageAmbiguousCount > 0 || pageRejectedCount > 0) {
          console.log(`[PDF Processing] Page ${pageIndex + 1} summary: ${pageValidCount} valid, ${pageAmbiguousCount} ambiguous, ${pageRejectedCount} rejected`);
        }
      }

      // Log extraction statistics for this file
      console.log(`[PDF Processing] File: ${file.name} - ASIN extraction attempts: ${asinExtractionAttempts}, successful: ${asinExtractionSuccesses}, rejected by context: ${asinContextRejections}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[PDF Processing] Error processing file ${file.name}:`, error);
      console.error(`[PDF Processing] Error details:`, {
        fileName: file.name,
        fileSize: file.size,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: errorMessage
      });

      // Provide more context in the error
      if (errorMessage.includes('Invalid PDF') || errorMessage.includes('corrupted')) {
        throw new Error(`Failed to process PDF "${file.name}": The file appears to be corrupted or invalid. Please check the file and try again.`);
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        throw new Error(`Failed to process PDF "${file.name}": Network error occurred. Please check your internet connection and try again.`);
      } else {
        throw new Error(`Failed to process PDF "${file.name}": ${errorMessage}`);
      }
    }
  }

  // Second pass: Combine PDFs (30-60%)
  progressCallback?.(0.30, '🔄 Combining PDFs... (30%)');

  let highlightedPdfBytes: Uint8Array | null = null;
  const failedPdfIndices: number[] = [];
  const failedPdfNames: string[] = [];

  console.log(`[PDF Processing] Starting PDF combining phase with ${allPdfBytes.length} PDF(s)`);

  if (allPdfBytes.length > 0) {
    try {
      // Update progress during combining (30-60%)
      progressCallback?.(0.45, '🔄 Combining PDFs... (45%)');
      const combinedPdf = await PDFDocument.create();
      const pageMapping: Array<{ pdfIndex: number; pageIndex: number; originalPageNum: number; isInvoice: boolean }> = [];
      let combinedPageIndex = 0;

      console.log(`[PDF Processing] Created new combined PDF document (initially empty)`);

      // Combine all PDFs and track which pages are invoices
      console.log(`[PDF Processing] Starting to combine ${allPdfBytes.length} PDF(s)`);

      for (let pdfIdx = 0; pdfIdx < allPdfBytes.length; pdfIdx++) {
        const pdfBytes = allPdfBytes[pdfIdx];

        const fileName = files[pdfIdx]?.name || `PDF ${pdfIdx + 1}`;

        // Validate PDF bytes before loading
        if (!pdfBytes || pdfBytes.length === 0) {
          const errorMsg = `Empty PDF file (0 bytes)`;
          console.warn(`[PDF Processing] Skipping empty PDF: ${fileName} (index ${pdfIdx})`);
          console.warn(`[PDF Processing] Error type: Empty file, Error message: ${errorMsg}`);
          failedPdfIndices.push(pdfIdx);
          failedPdfNames.push(`${fileName} - ${errorMsg}`);
          continue;
        }

        // Check for PDF header (should start with %PDF)
        const header = new TextDecoder().decode(pdfBytes.slice(0, 4));
        if (!header.startsWith('%PDF')) {
          const errorMsg = `Invalid PDF header: "${header}" (expected "%PDF")`;
          console.warn(`[PDF Processing] Invalid PDF header: ${fileName} (index ${pdfIdx})`);
          console.warn(`[PDF Processing] Error type: Invalid format, Error message: ${errorMsg}`);
          failedPdfIndices.push(pdfIdx);
          failedPdfNames.push(`${fileName} - ${errorMsg}`);
          continue;
        }

        let sourcePdf;
        try {
          sourcePdf = await PDFDocument.load(pdfBytes);
          console.log(`[PDF Processing] Loaded PDF ${pdfIdx + 1} (${fileName}) with pdf-lib: ${sourcePdf.getPageCount()} page(s)`);
        } catch (loadError) {
          const errorMsg = loadError instanceof Error ? loadError.message : String(loadError);
          const errorType = loadError instanceof Error ? loadError.constructor.name : typeof loadError;
          const isPasswordProtected = errorMsg.toLowerCase().includes('password') || errorMsg.toLowerCase().includes('encrypted');
          const isCorrupted = errorMsg.toLowerCase().includes('corrupt') || errorMsg.toLowerCase().includes('invalid');
          const isMemoryError = errorMsg.toLowerCase().includes('memory') || errorType === 'MemoryError';

          console.warn(`[PDF Processing] Failed to load PDF: ${fileName} (index ${pdfIdx})`);
          console.warn(`[PDF Processing] Error type: ${errorType}, Error message: ${errorMsg}`);
          if (isPasswordProtected) {
            console.warn(`[PDF Processing] ⚠️ This PDF appears to be password-protected or encrypted`);
          }
          if (isCorrupted) {
            console.warn(`[PDF Processing] ⚠️ This PDF appears to be corrupted or invalid`);
          }
          if (isMemoryError) {
            console.warn(`[PDF Processing] ⚠️ Memory error - PDF may be too large`);
          }
          failedPdfIndices.push(pdfIdx);
          failedPdfNames.push(`${fileName} - ${errorMsg}`);
          continue;
        }

        // Load with pdf.js to check which pages are invoices
        let pdfjsDoc;
        try {
          // Create a fresh copy to avoid ArrayBuffer detachment issues
          // pdf-lib may detach the ArrayBuffer, so we need a separate copy for pdf.js
          const pdfBytesForPdfJs = pdfBytes.slice();
          pdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytesForPdfJs }).promise;
          console.log(`[PDF Processing] Loaded PDF ${pdfIdx + 1} (${fileName}) with pdf.js: ${pdfjsDoc.numPages} page(s)`);
        } catch (pdfjsError) {
          const errorMsg = pdfjsError instanceof Error ? pdfjsError.message : String(pdfjsError);
          const errorType = pdfjsError instanceof Error ? pdfjsError.constructor.name : typeof pdfjsError;
          console.warn(`[PDF Processing] Failed to load PDF with pdf.js: ${fileName} (index ${pdfIdx})`);
          console.warn(`[PDF Processing] Error type: ${errorType}, Error message: ${errorMsg}`);
          console.warn(`[PDF Processing] This may indicate the PDF.js worker failed to load or the PDF format is unsupported`);
          failedPdfIndices.push(pdfIdx);
          if (!failedPdfNames.some(name => name.startsWith(fileName))) {
            failedPdfNames.push(`${fileName} - pdf.js load failed: ${errorMsg}`);
          }
          continue;
        }

        let successfullyCopiedPages = 0;
        const sourcePageCount = sourcePdf.getPageCount();
        console.log(`[PDF Processing] Processing ${sourcePageCount} page(s) from PDF ${pdfIdx + 1}`);

        for (let pageNum = 1; pageNum <= sourcePageCount; pageNum++) {
          try {
            const pdfjsPage = await pdfjsDoc.getPage(pageNum);
            const textContent = await pdfjsPage.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ').toUpperCase();

            const isInvoicePage =
              pageText.includes('DESCRIPTION') &&
              (pageText.includes('QTY') || pageText.includes('QUANTITY'));

            // Copy page from source PDF to combined PDF
            // Note: copyPages expects 0-based page indices
            const [copiedPage] = await combinedPdf.copyPages(sourcePdf, [pageNum - 1]);
            combinedPdf.addPage(copiedPage);
            successfullyCopiedPages++;

            pageMapping.push({
              pdfIndex: pdfIdx,
              pageIndex: combinedPageIndex,
              originalPageNum: pageNum,
              isInvoice: isInvoicePage
            });

            console.log(`[PDF Processing] ✓ Added page ${pageNum}/${sourcePageCount} from PDF ${pdfIdx + 1} (${isInvoicePage ? 'INVOICE' : 'other'}) - Combined PDF now has ${combinedPdf.getPageCount()} page(s)`);

            combinedPageIndex++;
          } catch (copyError) {
            const errorMsg = copyError instanceof Error ? copyError.message : String(copyError);
            console.error(`[PDF Processing] ✗ Failed to copy page ${pageNum} from PDF ${pdfIdx + 1}: ${errorMsg}`, copyError);
            // Continue with next page instead of failing entire PDF
          }
        }

        if (successfullyCopiedPages === 0) {
          console.warn(`[PDF Processing] ⚠️ No pages were successfully copied from PDF ${pdfIdx + 1} (attempted ${sourcePageCount} pages)`);
        } else {
          console.log(`[PDF Processing] ✓ Successfully copied ${successfullyCopiedPages}/${sourcePageCount} page(s) from PDF ${pdfIdx + 1}`);
        }
      }

      // Save PDF immediately after combining (before highlighting) as backup
      // This ensures we have a valid PDF even if highlighting fails completely
      let combinedPdfBytes: Uint8Array | null = null;
      try {
        const backupPageCount = combinedPdf.getPageCount();
        if (backupPageCount === 0) {
          console.warn('[PDF Processing] ⚠️ Combined PDF has 0 pages - cannot save backup. This indicates no pages were successfully copied.');
          if (failedPdfIndices.length === allPdfBytes.length) {
            console.error('[PDF Processing] ❌ All PDFs failed to load - no pages available for backup');
          } else {
            console.error(`[PDF Processing] ❌ ${failedPdfIndices.length}/${allPdfBytes.length} PDF(s) failed, but no pages were copied successfully`);
          }
        } else {
          combinedPdfBytes = await combinedPdf.save();
          console.log(`[PDF Processing] ✓ Saved combined PDF (backup) with ${backupPageCount} page(s) before highlighting`);
        }
      } catch (backupSaveError) {
        const errorMsg = backupSaveError instanceof Error ? backupSaveError.message : String(backupSaveError);
        console.error('[PDF Processing] Error saving backup PDF:', backupSaveError);
        console.error('[PDF Processing] Backup save error details:', {
          errorType: backupSaveError instanceof Error ? backupSaveError.constructor.name : typeof backupSaveError,
          errorMessage: errorMsg,
          pageCount: combinedPdf.getPageCount()
        });
        // Continue anyway - we'll try to save after highlighting
      }

      // Apply highlighting to invoice pages using pdf.js for text positions
      // Match Streamlit's block-based highlighting approach
      // Note: Highlighting is optional - if it fails, we still save the PDF
      let highlightingErrors: string[] = [];
      let highlightingSucceeded = false;

      try {
        for (const mapping of pageMapping) {
          if (mapping.isInvoice) {
            try {
              // Get the corresponding PDF bytes and create a fresh copy
              // pdf-lib may have detached the original ArrayBuffer, so we need a new copy
              const sourceBytes = allPdfBytes[mapping.pdfIndex];
              // Create a fresh copy with a new ArrayBuffer using slice()
              const sourceBytesCopy = sourceBytes.slice();
              const pdfjsDoc = await pdfjsLib.getDocument({ data: sourceBytesCopy }).promise;
              const pdfjsPage = await pdfjsDoc.getPage(mapping.originalPageNum);

              // Get the actual page size from pdf.js (in points)
              const pdfjsViewport = pdfjsPage.getViewport({ scale: 1.0 });
              const pdfjsPageSize = {
                width: pdfjsViewport.width,
                height: pdfjsViewport.height
              };

              // Get text items with positions
              const textContent = await pdfjsPage.getTextContent();
              const textItems = textContent.items as Array<{
                str: string;
                transform: number[];
                width: number;
                height: number;
              }>;

              // Process text blocks to find quantities > 1
              const pdfLibPage = combinedPdf.getPage(mapping.pageIndex);
              const { width: pageWidth, height: pageHeight } = pdfLibPage.getSize();

              // Calculate scale factors to convert from pdf.js coordinates to pdf-lib coordinates
              // Both use points, but page sizes might differ slightly
              const scaleX = pageWidth / pdfjsPageSize.width;
              const scaleY = pageHeight / pdfjsPageSize.height;

              let inTable = false;
              let highlightedCount = 0; // Track number of blocks highlighted on this page
              const blocksToHighlight: Array<{ x: number; y: number; width: number; height: number }> = [];

              // Match Streamlit: Group text items into blocks (rectangular regions)
              // Streamlit uses get_text("blocks") which returns (x0, y0, x1, y1, text)
              // We need to simulate this by grouping nearby text items into blocks
              const blocks: Array<{
                x0: number;
                y0: number;
                x1: number;
                y1: number;
                text: string;
                items: typeof textItems;
              }> = [];

              // Group text items by proximity (same Y coordinate within tolerance)
              // Match Streamlit's block grouping: items on the same line form a block
              const yTolerance = 5; // Points - tolerance for grouping items on same line
              const itemGroups: Array<typeof textItems> = [];

              // Sort items by Y coordinate (top to bottom in pdf.js coordinates)
              // pdf.js: transform[5] is Y coordinate (bottom-left origin, Y increases upward)
              // Higher Y = higher on page (closer to top in visual terms)
              const sortedItems = [...textItems].sort((a, b) => {
                // Sort by Y descending (top to bottom visually)
                const yDiff = b.transform[5] - a.transform[5];
                if (Math.abs(yDiff) < 0.1) {
                  // Same Y, sort by X (left to right)
                  return a.transform[4] - b.transform[4];
                }
                return yDiff;
              });

              // Group items that are on the same line (similar Y coordinates)
              let currentGroup: typeof textItems = [];
              let currentY = 0;

              for (const item of sortedItems) {
                const y = item.transform[5];
                if (currentGroup.length === 0 || Math.abs(y - currentY) <= yTolerance) {
                  currentGroup.push(item);
                  if (currentGroup.length === 1) {
                    currentY = y;
                  }
                } else {
                  if (currentGroup.length > 0) {
                    itemGroups.push(currentGroup);
                  }
                  currentGroup = [item];
                  currentY = y;
                }
              }
              if (currentGroup.length > 0) {
                itemGroups.push(currentGroup);
              }

              // Create blocks from item groups (match Streamlit's block format)
              // Each block represents a rectangular text region
              for (const group of itemGroups) {
                if (group.length === 0) continue;

                // Calculate bounding box for the group
                // pdf.js: transform[4] = x, transform[5] = y (bottom-left origin)
                const xCoords = group.map(i => i.transform[4]);
                const yCoords = group.map(i => i.transform[5]);
                const widths = group.map(i => i.width);
                const heights = group.map(i => i.height);

                // x0 = left edge, x1 = right edge
                const x0 = Math.min(...xCoords);
                const x1 = Math.max(...xCoords.map((x, i) => x + widths[i]));

                // y0 = bottom edge (lowest Y), y1 = top edge (highest Y + height)
                // In pdf.js, Y increases upward, so lower Y = lower on page
                const y0 = Math.min(...yCoords);
                const y1 = Math.max(...yCoords.map((y, i) => y + heights[i]));

                const text = group.map(i => i.str).join(' ');

                blocks.push({ x0, y0, x1, y1, text, items: group });
              }

              // Process blocks to find quantities > 1 (match Streamlit's highlight_invoice_page exactly)
              // Streamlit processes blocks in order, tracking in_table state
              for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
                const block = blocks[blockIdx];
                const text = block.text;
                const upperText = text.toUpperCase();

                // Match Streamlit exactly: "Description" in text and "Qty" in text (case-sensitive check)
                // Streamlit code: if "Description" in text and "Qty" in text:
                if (text.includes('Description') && (text.includes('Qty') || text.includes('Quantity'))) {
                  inTable = true;
                  console.log(`[PDF Highlighting] Table started at block ${blockIdx} on page ${mapping.pageIndex + 1}`);
                  continue;
                }

                if (inTable) {
                  // Match Streamlit: Skip HSN lines explicitly (check BEFORE other processing)
                  // Streamlit: upper_text = text.upper(); if "HSN" in upper_text: continue
                  if (upperText.includes('HSN')) {
                    continue;
                  }

                  // Match Streamlit: Skip blocks without digits
                  // Streamlit: if not any(char.isdigit() for char in text): continue
                  if (!/\d/.test(text)) {
                    continue;
                  }

                  // Match Streamlit: Skip obvious header blocks
                  // Streamlit: if any(header in text for header in ["Qty", "Unit Price", "Total", "Description"]): continue
                  if (['Qty', 'Quantity', 'Unit Price', 'Total', 'Description'].some(header =>
                    text.includes(header))) {
                    continue;
                  }

                  // Match Streamlit: Look for quantities > 1 in the text block
                  let shouldHighlight = false;
                  let foundQty: number | null = null;

                  // Match Streamlit exactly: Method 1 - Look for standalone numbers > 1 (MUST have ₹ price)
                  // Streamlit: if "₹" in text: values = text.split(); for val in values: if val.isdigit(): qty_val = int(val); if 1 < qty_val <= 100:
                  // IMPORTANT: This method can match numbers from prices, so we need to be more careful
                  // We'll only match numbers that are immediately followed by ₹ (most reliable quantity pattern)
                  // This avoids false positives from prices or other numbers
                  if (text.includes('₹')) {
                    const values = text.split(/\s+/);
                    for (let i = 0; i < values.length; i++) {
                      const val = values[i];
                      // Match Streamlit: val.isdigit() - only pure digits
                      if (/^\d+$/.test(val)) {
                        const qtyVal = parseInt(val, 10);
                        // Match Streamlit: if 1 < qty_val <= 100:
                        if (qtyVal > 1 && qtyVal <= 100) {
                          // Check if number is immediately followed by ₹ (most reliable quantity pattern)
                          // Quantity pattern: "2 ₹100" or "3 ₹200 5% IGST"
                          // This avoids matching numbers from prices like "₹200" where 200 is the price
                          const nextVal = i < values.length - 1 ? values[i + 1] : '';

                          // Only match if number is immediately followed by ₹
                          // This is the most reliable indicator of a quantity in invoice tables
                          if (nextVal.startsWith('₹')) {
                            shouldHighlight = true;
                            foundQty = qtyVal;
                            break;
                          }
                        }
                      }
                    }
                  }

                  // Match Streamlit exactly: Method 2 - Look for price-quantity patterns
                  // Streamlit pattern: r'(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)'
                  // Streamlit: price_qty_matches = re.findall(r'(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)', text)
                  if (!shouldHighlight) {
                    const priceQtyPattern = /(\d+)\s+₹[\d,.]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)/g;
                    let priceQtyMatch;
                    while ((priceQtyMatch = priceQtyPattern.exec(text)) !== null) {
                      const qtyVal = parseInt(priceQtyMatch[1], 10);
                      // Match Streamlit: if qty_val > 1:
                      if (qtyVal > 1) {
                        shouldHighlight = true;
                        foundQty = qtyVal;
                        break;
                      }
                    }
                  }

                  // Match Streamlit exactly: Method 3 - Look for lines starting with quantity but avoid tax percentages
                  // Streamlit processes lines_in_block = text.split('\n')
                  if (!shouldHighlight) {
                    const linesInBlock = text.split('\n');
                    for (const lineInBlock of linesInBlock) {
                      const trimmed = lineInBlock.trim();
                      // Match Streamlit: if line: (skip empty lines)
                      if (!trimmed) continue;

                      // Match Streamlit pattern: r'^(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)'
                      // Streamlit: qty_match = re.search(r'^(\d+)\s+₹[\d,]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)', line)
                      const qtyMatch = trimmed.match(/^(\d+)\s+₹[\d,.]+\.?\d*\s+\d+%?\s*(IGST|CGST|SGST)/);
                      if (qtyMatch) {
                        const qtyVal = parseInt(qtyMatch[1], 10);
                        // Match Streamlit: if qty_val > 1:
                        if (qtyVal > 1) {
                          shouldHighlight = true;
                          foundQty = qtyVal;
                          break;
                        }
                      }

                      // Match Streamlit alternative pattern: look for standalone numbers > 1 followed by price
                      // but exclude tax percentages
                      // Streamlit: alt_match = re.search(r'^(\d+)', line)
                      if (!shouldHighlight) {
                        const altMatch = trimmed.match(/^(\d+)/);
                        if (altMatch) {
                          const qtyVal = parseInt(altMatch[1], 10);
                          // Match Streamlit conditions exactly:
                          // if (qty_val > 1 and qty_val <= 100 and
                          //     not re.search(r'^' + str(qty_val) + r'%', line) and
                          //     re.search(r'₹[\d,]+\.?\d*', line)):
                          if (
                            qtyVal > 1 &&
                            qtyVal <= 100 &&
                            !trimmed.match(new RegExp(`^${qtyVal}%`)) &&
                            trimmed.match(/₹[\d,.]+\.?\d*/)
                          ) {
                            shouldHighlight = true;
                            foundQty = qtyVal;
                            break;
                          }
                        }
                      }
                    }
                  }

                  // Highlight the block if quantity > 1 found - matches Streamlit exactly
                  // Streamlit: if should_highlight: highlight_box = fitz.Rect(x0, y0, x1, y1); page.draw_rect(highlight_box, color=(1, 0, 0), fill_opacity=0.4)
                  if (shouldHighlight && foundQty !== null) {
                    // Convert pdf.js coordinates to pdf-lib coordinates
                    // Both pdf.js and pdf-lib use bottom-left origin (Y increases upward)
                    // Streamlit's fitz.Rect(x0, y0, x1, y1) uses: x0,y0 = bottom-left, x1,y1 = top-right
                    // pdf-lib's drawRectangle uses: (x, y, width, height) where x,y = bottom-left corner

                    // Scale coordinates from pdf.js page size to pdf-lib page size
                    const x0_pdflib = block.x0 * scaleX;
                    const y0_pdflib = block.y0 * scaleY; // Bottom-left Y (both use bottom-left origin)
                    const x1_pdflib = block.x1 * scaleX;
                    const y1_pdflib = block.y1 * scaleY; // Top-right Y

                    // Convert to pdf-lib format: (x, y, width, height)
                    // Add padding to make rectangle bigger so it doesn't cut off text
                    const padding = 3; // 3pt padding on all sides
                    const x = Math.max(0, x0_pdflib - padding); // Left edge with padding
                    const y = Math.max(0, y0_pdflib - padding); // Bottom edge with padding
                    const width = (x1_pdflib - x0_pdflib) + (2 * padding); // Width with padding
                    const height = (y1_pdflib - y0_pdflib) + (2 * padding); // Height with padding

                    // Validate coordinates are within page bounds (match Streamlit's validation)
                    const finalX = x;
                    const finalY = y;
                    const finalWidth = Math.min(width, pageWidth - finalX);
                    const finalHeight = Math.min(height, pageHeight - finalY);

                    if (finalX >= 0 && finalY >= 0 && finalX + finalWidth <= pageWidth && finalY + finalHeight <= pageHeight && finalWidth > 0 && finalHeight > 0) {
                      try {
                        // Highlight as stroke (outline) only, not fill
                        pdfLibPage.drawRectangle({
                          x: finalX,
                          y: finalY,
                          width: finalWidth,
                          height: finalHeight,
                          color: rgb(1, 0, 0), // Red color
                          opacity: 0, // No fill
                          borderColor: rgb(1, 0, 0), // Red border
                          borderWidth: 2, // 2pt stroke width
                          borderOpacity: 1, // Full opacity for stroke
                        });

                        highlightedCount++;
                        console.log(`[PDF Highlighting] ✓ Highlighted page ${mapping.pageIndex + 1}, block ${blockIdx}, Qty=${foundQty}, Text="${text.substring(0, 80)}"`);
                      } catch (drawError) {
                        const errorMsg = drawError instanceof Error ? drawError.message : String(drawError);
                        console.error(`[PDF Highlighting] Error drawing highlight on page ${mapping.pageIndex + 1}, block ${blockIdx}:`, errorMsg);
                      }
                    } else {
                      console.warn(`[PDF Highlighting] Skipping highlight on page ${mapping.pageIndex + 1}, block ${blockIdx} - coordinates out of bounds: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}, pageSize=${pageWidth.toFixed(2)}×${pageHeight.toFixed(2)}`);
                    }
                  }
                }

                // Match Streamlit: Exit table when we see TOTAL (check AFTER processing the block)
                // Streamlit: if "TOTAL" in text.upper(): in_table = False
                // This check happens AFTER the in_table block processing (outside the if in_table block)
                if (upperText.includes('TOTAL')) {
                  inTable = false;
                  console.log(`[PDF Highlighting] Table ended at block ${blockIdx} on page ${mapping.pageIndex + 1}`);
                }
              }

              // Draw highlight rectangles - match Streamlit's draw_rect exactly
              // Streamlit: page.draw_rect(highlight_box, color=(1, 0, 0), fill_opacity=0.4)
              // fitz.Rect uses (x0, y0, x1, y1) where x0,y0 = bottom-left, x1,y1 = top-right
              // pdf-lib drawRectangle uses (x, y, width, height) where x,y = bottom-left corner
              let highlightedBlocks = 0;
              const padding = 3; // 3pt padding on all sides to make rectangle bigger
              for (const block of blocksToHighlight) {
                try {
                  // Add padding to make rectangle bigger so it doesn't cut off text
                  const x = Math.max(0, block.x - padding);
                  const y = Math.max(0, block.y - padding);
                  const width = block.width + (2 * padding);
                  const height = block.height + (2 * padding);

                  // Ensure rectangle stays within page bounds
                  const finalX = x;
                  const finalY = y;
                  const finalWidth = Math.min(width, pageWidth - finalX);
                  const finalHeight = Math.min(height, pageHeight - finalY);

                  pdfLibPage.drawRectangle({
                    x: finalX, // Left edge with padding
                    y: finalY, // Bottom edge with padding
                    width: finalWidth, // Width with padding
                    height: finalHeight, // Height with padding
                    color: rgb(1, 0, 0), // Red color (1, 0, 0) matches Streamlit color=(1, 0, 0)
                    opacity: 0, // No fill - highlight as stroke only
                    borderColor: rgb(1, 0, 0), // Red border
                    borderWidth: 2, // 2pt stroke width
                    borderOpacity: 1, // Full opacity for stroke
                  });
                  highlightedBlocks++;
                } catch (drawError) {
                  const errorMsg = drawError instanceof Error ? drawError.message : String(drawError);
                  console.error(`[PDF Highlighting] Error drawing rectangle on page ${mapping.pageIndex + 1}:`, drawError);
                  console.error(`[PDF Highlighting] Block details:`, {
                    x: block.x,
                    y: block.y,
                    width: block.width,
                    height: block.height,
                    pageWidth,
                    pageHeight,
                    errorMessage: errorMsg
                  });
                  highlightingErrors.push(`Page ${mapping.pageIndex + 1}: Failed to draw highlight - ${errorMsg}`);
                  // Continue with other blocks even if one fails
                }
              }

              if (highlightedBlocks > 0) {
                console.log(`[PDF Highlighting] ✓ Highlighted ${highlightedBlocks} block(s) on page ${mapping.pageIndex + 1}`);
                highlightingSucceeded = true;
              } else if (blocksToHighlight.length > 0) {
                console.warn(`[PDF Highlighting] ⚠️ Found ${blocksToHighlight.length} blocks to highlight on page ${mapping.pageIndex + 1}, but all drawing operations failed`);
              } else {
                console.log(`[PDF Highlighting] No blocks to highlight on page ${mapping.pageIndex + 1} (processed ${blocks.length} blocks, inTable=${inTable})`);
              }

              if (highlightedBlocks > 0) {
                console.log(`[PDF Highlighting] ✓ Highlighted ${highlightedBlocks} block(s) on page ${mapping.pageIndex + 1}`);
                highlightingSucceeded = true;
              } else if (blocksToHighlight.length > 0) {
                console.warn(`[PDF Highlighting] ⚠️ Found ${blocksToHighlight.length} blocks to highlight on page ${mapping.pageIndex + 1}, but all drawing operations failed`);
              } else {
                console.log(`[PDF Highlighting] No blocks to highlight on page ${mapping.pageIndex + 1} (processed ${blocks.length} blocks, inTable=${inTable})`);
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              const errorType = error instanceof Error ? error.constructor.name : typeof error;
              console.error(`[PDF Highlighting] Error processing page ${mapping.pageIndex + 1}:`, error);
              console.error(`[PDF Highlighting] Error type: ${errorType}, Message: ${errorMsg}`);
              highlightingErrors.push(`Page ${mapping.pageIndex + 1}: ${errorMsg}`);
              // Continue with other pages even if one fails
            }
          }
        }
      } catch (highlightingError) {
        const errorMsg = highlightingError instanceof Error ? highlightingError.message : String(highlightingError);
        console.error('[PDF Highlighting] Critical error during highlighting process:', highlightingError);
        highlightingErrors.push(`Critical: ${errorMsg}`);
        // Continue to save PDF even if highlighting failed
      }

      // Update progress after highlighting (60%)
      progressCallback?.(0.60, '🎨 Applying highlighting... (60%)');

      if (highlightingErrors.length > 0) {
        console.warn(`[PDF Highlighting] ${highlightingErrors.length} page(s) had highlighting errors, but PDF will still be saved`);
      }

      if (highlightingSucceeded) {
        console.log('[PDF Highlighting] ✓ Highlighting completed successfully on at least one page');
      } else {
        console.warn('[PDF Highlighting] ⚠️ No pages were successfully highlighted, but PDF will still be saved');
      }

      // Validate that PDF has pages before saving
      // Note: Highlighting has already been applied above, so this is the final page count
      const finalPageCount = combinedPdf.getPageCount();
      console.log(`[PDF Processing] Combined PDF has ${finalPageCount} page(s) (highlighting complete)`);
      console.log(`[PDF Processing] Page mapping: ${pageMapping.length} entries, ${pageMapping.filter(m => m.isInvoice).length} invoice page(s)`);

      if (finalPageCount === 0) {
        console.error('[PDF Processing] ❌ Combined PDF has no pages - cannot save highlighted PDF');
        console.error('[PDF Processing] This may indicate that all PDFs failed to load or all pages failed to copy');
        if (failedPdfIndices.length > 0) {
          console.error(`[PDF Processing] Failed PDF indices: ${failedPdfIndices.join(', ')}`);
          if (failedPdfNames.length > 0) {
            console.error(`[PDF Processing] Failed PDF files: ${failedPdfNames.join('; ')}`);
          }
        }
        if (failedPdfIndices.length === allPdfBytes.length) {
          console.error('[PDF Processing] ❌ All PDFs failed to process. Possible causes:');
          console.error('  - All PDFs are password-protected or encrypted');
          console.error('  - All PDFs are corrupted or invalid format');
          console.error('  - PDF.js worker failed to load');
          console.error('  - Memory issues with large PDFs');
        }
        highlightedPdfBytes = null;
      } else {
        // Save the highlighted PDF (highlighting has already been applied, or use backup if highlighting failed)
        try {
          console.log(`[PDF Processing] Saving highlighted PDF with ${finalPageCount} page(s)...`);

          // Ensure PDF is valid before saving - CRITICAL CHECK to prevent empty PDFs
          const pageCountBeforeSave = combinedPdf.getPageCount();
          if (pageCountBeforeSave === 0) {
            console.error('[PDF Processing] ❌ PDF has no pages - cannot save. This would create an empty PDF file.');
            throw new Error('PDF has no pages - cannot save empty PDF');
          }

          // Try to save the highlighted PDF
          highlightedPdfBytes = await combinedPdf.save();

          // Validate saved PDF is not empty
          if (highlightedPdfBytes && highlightedPdfBytes.length > 0) {
            const fileSizeKB = (highlightedPdfBytes.length / 1024).toFixed(2);
            console.log(`[PDF Processing] ✓ Successfully saved highlighted PDF: ${pageCountBeforeSave} page(s), ${fileSizeKB} KB`);

            if (failedPdfIndices.length > 0) {
              console.warn(`[PDF Processing] ⚠️ Highlighted PDF created, but ${failedPdfIndices.length} PDF(s) were skipped due to errors`);
              if (failedPdfNames.length > 0) {
                console.warn(`[PDF Processing] Skipped files: ${failedPdfNames.join('; ')}`);
              }
            } else {
              console.log('[PDF Processing] ✓ Successfully created highlighted PDF with all combined invoices');
            }
          } else {
            console.error('[PDF Processing] ❌ Saved PDF is empty (0 bytes) - trying backup...');
            // Use backup PDF if available and valid
            if (combinedPdfBytes && combinedPdfBytes.length > 0) {
              // Verify backup PDF is not empty by checking if it's a valid PDF
              try {
                const backupPdf = await PDFDocument.load(combinedPdfBytes);
                if (backupPdf.getPageCount() > 0) {
                  highlightedPdfBytes = combinedPdfBytes;
                  console.log(`[PDF Processing] ✓ Using backup PDF (without highlighting) with ${backupPdf.getPageCount()} page(s)`);
                } else {
                  console.error('[PDF Processing] ❌ Backup PDF also has 0 pages - cannot use');
                  highlightedPdfBytes = null;
                }
              } catch (backupLoadError) {
                console.error('[PDF Processing] ❌ Backup PDF is invalid or corrupted:', backupLoadError);
                highlightedPdfBytes = null;
              }
            } else {
              highlightedPdfBytes = null;
            }
          }
        } catch (saveError) {
          const errorMsg = saveError instanceof Error ? saveError.message : String(saveError);
          const errorType = saveError instanceof Error ? saveError.constructor.name : typeof saveError;
          console.error('[PDF Processing] Error saving highlighted PDF:', saveError);
          console.error('[PDF Processing] Save error details:', {
            errorType: errorType,
            errorMessage: errorMsg,
            pageCount: combinedPdf.getPageCount(),
            failedPdfCount: failedPdfIndices.length,
            failedPdfNames: failedPdfNames.length > 0 ? failedPdfNames : undefined,
            highlightingErrors: highlightingErrors.length > 0 ? highlightingErrors.length : 'none'
          });

          // Try to use backup PDF first (faster than recreating)
          if (combinedPdfBytes && combinedPdfBytes.length > 0) {
            console.log('[PDF Processing] Using backup PDF (saved before highlighting)...');
            // Validate backup PDF has pages before using it
            try {
              const backupPdf = await PDFDocument.load(combinedPdfBytes);
              const backupPageCount = backupPdf.getPageCount();
              if (backupPageCount > 0) {
                highlightedPdfBytes = combinedPdfBytes;
                const backupSizeKB = (combinedPdfBytes.length / 1024).toFixed(2);
                console.log(`[PDF Processing] ✓ Using backup PDF: ${backupPageCount} pages, ${backupSizeKB} KB`);
              } else {
                console.error('[PDF Processing] ❌ Backup PDF has 0 pages - cannot use');
                highlightedPdfBytes = null;
              }
            } catch (backupLoadError) {
              console.error('[PDF Processing] ❌ Backup PDF is invalid or corrupted:', backupLoadError);
              highlightedPdfBytes = null;
            }
          } else {
            // Try to recreate PDF without highlighting as fallback
            try {
              console.log('[PDF Processing] Attempting to create fallback PDF without highlighting...');
              const fallbackPdf = await PDFDocument.create();
              let fallbackPageCount = 0;
              const fallbackIncludedFiles: string[] = [];
              const fallbackExcludedFiles: string[] = [];

              for (let pdfIdx = 0; pdfIdx < allPdfBytes.length; pdfIdx++) {
                if (failedPdfIndices.includes(pdfIdx)) {
                  const fileName = files[pdfIdx]?.name || `PDF ${pdfIdx + 1}`;
                  fallbackExcludedFiles.push(fileName);
                  continue;
                }

                try {
                  const fileName = files[pdfIdx]?.name || `PDF ${pdfIdx + 1}`;
                  const sourcePdf = await PDFDocument.load(allPdfBytes[pdfIdx]);
                  const sourcePageCount = sourcePdf.getPageCount();

                  for (let pageIndex = 0; pageIndex < sourcePageCount; pageIndex++) {
                    const [copiedPage] = await fallbackPdf.copyPages(sourcePdf, [pageIndex]);
                    fallbackPdf.addPage(copiedPage);
                    fallbackPageCount++;
                  }
                  fallbackIncludedFiles.push(fileName);
                } catch (loadError) {
                  const fileName = files[pdfIdx]?.name || `PDF ${pdfIdx + 1}`;
                  const errorMsg = loadError instanceof Error ? loadError.message : String(loadError);
                  console.error(`[PDF Processing] Failed to load PDF ${pdfIdx + 1} (${fileName}) for fallback:`, loadError);
                  fallbackExcludedFiles.push(`${fileName} - ${errorMsg}`);
                  // Continue with next PDF
                }
              }

              if (fallbackPageCount > 0) {
                highlightedPdfBytes = await fallbackPdf.save();
                const fallbackSizeKB = (highlightedPdfBytes.length / 1024).toFixed(2);
                console.log(`[PDF Processing] ✓ Created fallback PDF without highlighting: ${fallbackPageCount} pages, ${fallbackSizeKB} KB`);
                if (fallbackIncludedFiles.length > 0) {
                  console.log(`[PDF Processing] Included files in fallback: ${fallbackIncludedFiles.join(', ')}`);
                }
                if (fallbackExcludedFiles.length > 0) {
                  console.warn(`[PDF Processing] Excluded files from fallback: ${fallbackExcludedFiles.join('; ')}`);
                }
              } else {
                console.error('[PDF Processing] ❌ Fallback PDF has no pages - cannot create');
                console.error('[PDF Processing] This means all PDFs failed to load or all pages failed to copy');
                if (fallbackExcludedFiles.length > 0) {
                  console.error(`[PDF Processing] All files were excluded: ${fallbackExcludedFiles.join('; ')}`);
                }
                highlightedPdfBytes = null;
              }
            } catch (fallbackError) {
              const fallbackErrorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
              console.error('[PDF Processing] Error creating fallback PDF:', fallbackError);
              console.error('[PDF Processing] Fallback error details:', {
                errorType: fallbackError instanceof Error ? fallbackError.constructor.name : typeof fallbackError,
                errorMessage: fallbackErrorMsg,
                failedPdfCount: failedPdfIndices.length
              });
              highlightedPdfBytes = null;
            }
          }
        }
      }

      // Update progress after highlighting (80%)
      progressCallback?.(0.80, '📊 Processing data... (80%)');

      // Final summary log
      if (highlightedPdfBytes && highlightedPdfBytes.length > 0) {
        const finalPageCount = combinedPdf.getPageCount();
        const finalSizeKB = (highlightedPdfBytes.length / 1024).toFixed(2);
        console.log(`[PDF Processing] ✅ FINAL RESULT: Highlighted PDF ready with ${finalPageCount} page(s), ${finalSizeKB} KB`);
      } else {
        console.error('[PDF Processing] ❌ FINAL RESULT: No highlighted PDF was created');
        if (failedPdfIndices.length > 0) {
          console.error(`[PDF Processing] Failed PDF indices: ${failedPdfIndices.join(', ')}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = error instanceof Error ? error.constructor.name : typeof error;
      console.error('[PDF Processing] Error combining and highlighting PDFs:', error);
      console.error('[PDF Processing] Highlighting error details:', {
        errorType: errorType,
        errorMessage: errorMessage,
        filesProcessed: allPdfBytes.length,
        failedPdfIndices: failedPdfIndices.length > 0 ? failedPdfIndices : 'none'
      });

      // Continue processing even if highlighting fails - it's optional
      // Try to create a fallback PDF without highlighting
      console.log('[PDF Processing] Attempting to create fallback PDF after error...');
      try {
        const fallbackPdf = await PDFDocument.create();
        let fallbackPageCount = 0;

        for (let pdfIdx = 0; pdfIdx < allPdfBytes.length; pdfIdx++) {
          if (failedPdfIndices.includes(pdfIdx)) continue;

          try {
            const sourcePdf = await PDFDocument.load(allPdfBytes[pdfIdx]);
            const sourcePageCount = sourcePdf.getPageCount();

            for (let pageIndex = 0; pageIndex < sourcePageCount; pageIndex++) {
              const [copiedPage] = await fallbackPdf.copyPages(sourcePdf, [pageIndex]);
              fallbackPdf.addPage(copiedPage);
              fallbackPageCount++;
            }
          } catch (loadError) {
            console.error(`[PDF Processing] Failed to load PDF ${pdfIdx + 1} for fallback:`, loadError);
            // Continue with next PDF
          }
        }

        if (fallbackPageCount > 0) {
          highlightedPdfBytes = await fallbackPdf.save();
          const fallbackSizeKB = (highlightedPdfBytes.length / 1024).toFixed(2);
          console.log(`[PDF Processing] ✓ Created fallback PDF after error: ${fallbackPageCount} pages, ${fallbackSizeKB} KB`);
        } else {
          console.error('[PDF Processing] ❌ Fallback PDF has no pages - cannot create');
          highlightedPdfBytes = null;
        }
      } catch (fallbackError) {
        console.error('[PDF Processing] Error creating fallback PDF after error:', fallbackError);
        highlightedPdfBytes = null;
      }

      // Only throw for memory errors - other errors are handled gracefully
      if (errorType === 'MemoryError' || errorMessage.toLowerCase().includes('memory')) {
        throw new Error(`Memory Error: PDFs are too large to process together. Try processing fewer files at once.`);
      }
      // Don't throw for other errors - highlighting is optional
    }
  } else {
    // No PDFs to process
    console.log('[PDF Processing] No PDFs to combine - highlightedPdfBytes will be null');
    highlightedPdfBytes = null;
  }

  // Final progress update (100%)
  progressCallback?.(1.0, '✅ Processing complete! (100%)');

  // Final validation and logging
  if (highlightedPdfBytes && highlightedPdfBytes.length > 0) {
    const finalSizeKB = (highlightedPdfBytes.length / 1024).toFixed(2);
    console.log(`[PDF Processing] ✅ FINAL CHECK: Highlighted PDF is ready (${finalSizeKB} KB)`);
  } else {
    console.error('[PDF Processing] ❌ FINAL CHECK: highlightedPdfBytes is NULL or EMPTY');
    console.error('[PDF Processing] This means no PDF was created. Debugging info:', {
      allPdfBytesCount: allPdfBytes.length,
      failedPdfIndices: failedPdfIndices,
      files: files.length
    });
  }

  // Validation: Check if any ASINs were extracted
  if (asinQtyData.size === 0) {
    const errorMessage = `No ASINs were extracted from the PDF files. This could mean:
- The PDFs don't contain valid ASINs (format: B followed by 9 alphanumeric characters)
- ASINs are in address sections (which are filtered out)
- The PDF text extraction failed
- The invoice format doesn't match expected patterns

Processed ${files.length} file(s), found ${totalInvoices} invoice page(s).`;
    console.warn('[PDF Processing]', errorMessage);
    // Don't throw error, but return result with empty data - let the UI handle the warning
  } else {
    // Log summary of extracted data
    const totalQty = Array.from(asinQtyData.values()).reduce((sum, qty) => sum + qty, 0);
    const asinEntries = Array.from(asinQtyData.entries());
    console.log(`[PDF Processing] ✅ EXTRACTION SUMMARY:`);
    console.log(`[PDF Processing]   - Unique ASINs extracted: ${asinQtyData.size}`);
    console.log(`[PDF Processing]   - Total quantity ordered: ${totalQty}`);
    console.log(`[PDF Processing]   - ASIN extraction attempts: ${globalAsinAttempts}`);
    console.log(`[PDF Processing]   - ASINs accepted: ${globalAsinAccepted}`);
    console.log(`[PDF Processing]   - ASINs rejected by context: ${globalAsinRejectedByContext}`);
    console.log(`[PDF Processing]   - Invoice pages processed: ${globalInvoicePageCount}`);
    console.log(`[PDF Processing]   - Total invoices: ${totalInvoices}`);
    console.log(`[PDF Processing] Extracted ASINs with quantities:`, asinEntries.map(([asin, qty]) => `${asin}: ${qty}`).join(', '));

    // ASIN accumulation summary logging
    console.log(`[ASIN Accumulation] Final ASIN quantities:`,
      asinEntries.map(([asin, qty]) => `${asin}: ${qty}`).join(', '));
    console.log(`[ASIN Accumulation] Total Qty from extraction:`,
      Array.from(asinQtyData.values()).reduce((a, b) => a + b, 0));

    // Log ASINs with qty=1 (might indicate extraction issues)
    const asinsWithQty1 = asinEntries.filter(([_, qty]) => qty === 1);
    if (asinsWithQty1.length > 0) {
      console.warn(`[PDF Processing] ⚠️ Found ${asinsWithQty1.length} ASIN(s) with quantity 1 (may indicate extraction issues):`,
        asinsWithQty1.map(([asin]) => asin).join(', '));
    }
  }

  // Build highlighting error message if PDF creation failed
  let highlightingError: string | undefined = undefined;
  if (!highlightedPdfBytes && allPdfBytes.length > 0) {
    if (failedPdfIndices.length === allPdfBytes.length) {
      highlightingError = `All ${allPdfBytes.length} PDF file(s) failed to process. `;
      if (failedPdfNames.length > 0) {
        highlightingError += `Failed files: ${failedPdfNames.join('; ')}. `;
      }
      highlightingError += `Possible causes: password-protected PDFs, corrupted files, or unsupported format.`;
    } else if (failedPdfIndices.length > 0) {
      highlightingError = `${failedPdfIndices.length} of ${allPdfBytes.length} PDF file(s) failed to process. `;
      if (failedPdfNames.length > 0) {
        highlightingError += `Failed files: ${failedPdfNames.join('; ')}. `;
      }
      highlightingError += `The highlighted PDF may be incomplete.`;
    } else {
      highlightingError = `PDF highlighting failed for unknown reason. The PDF may be too large or in an unsupported format.`;
    }
  }

  // Calculate diagnostics summary
  const extractedQty = Array.from(asinQtyData.values()).reduce((sum, qty) => sum + qty, 0);
  const diagnostics: import('../types').PDFDiagnostics = {
    quantityDefaults,
    rejectedAsins,
    pageClassifications,
    summary: {
      totalAsinsAttempted: globalAsinAttempts,
      totalAsinsAccepted: globalAsinAccepted,
      totalAsinsRejected: globalAsinRejectedByContext,
      totalQtyDefaults: quantityDefaults.length,
      extractedQty,
      discrepancy: 0 // Will be calculated in the view when expected qty is known
    }
  };

  // Enhanced console logging
  console.group('[PDF Extraction Summary]');
  console.log(`Total ASINs attempted: ${globalAsinAttempts}`);
  console.log(`Total ASINs accepted: ${globalAsinAccepted}`);
  console.log(`Total ASINs rejected: ${globalAsinRejectedByContext}`);
  console.log(`Total Qty extracted: ${extractedQty}`);
  console.log(`Quantity defaults (qty=1): ${quantityDefaults.length}`);
  console.log(`Pages classified: ${pageClassifications.length} (Invoice: ${pageClassifications.filter(p => p.pageType === 'invoice').length}, Shipping: ${pageClassifications.filter(p => p.pageType === 'shipping').length}, Unknown: ${pageClassifications.filter(p => p.pageType === 'unknown').length})`);
  console.groupEnd();

  if (rejectedAsins.length > 0) {
    console.group('[Rejected ASINs Details]');
    rejectedAsins.forEach(r => {
      console.warn(`ASIN ${r.asin}: ${r.reason} (${r.fileName}, Page ${r.pageNumber}, Line ${r.lineIndex})`, {
        line: r.lineContent.substring(0, 100),
        context: r.contextLines.map(l => l.substring(0, 80))
      });
    });
    console.groupEnd();
  }

  if (quantityDefaults.length > 0) {
    console.group('[Quantity Defaults (possibly missing qty)]');
    quantityDefaults.forEach(q => {
      console.warn(`ASIN ${q.asin}: defaulted to 1 (${q.fileName}, Page ${q.pageNumber}, Line ${q.lineIndex})`, {
        line: q.lineContent.substring(0, 100),
        searchWindow: q.searchWindowLines.map(l => l.substring(0, 80))
      });
    });
    console.groupEnd();
  }

  return {
    asinQtyData,
    highlightedPdfBytes,
    totalInvoices,
    invoiceHasMultiQty,
    invoicePageCount: globalInvoicePageCount,
    shippingPageCount: globalShippingPageCount,
    failedPdfCount: failedPdfIndices.length > 0 ? failedPdfIndices.length : undefined,
    failedPdfNames: failedPdfNames.length > 0 ? failedPdfNames : undefined,
    highlightingError,
    asinAttempts: globalAsinAttempts,
    asinAccepted: globalAsinAccepted,
    asinRejectedByContext: globalAsinRejectedByContext,
    diagnostics
  };
};





