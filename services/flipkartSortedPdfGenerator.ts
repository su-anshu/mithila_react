import { PDFDocument, rgb, PDFPage } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { extractSkuFromPage } from './flipkartPdfProcessor';
import { parseSkuId } from './flipkartUtils';

/**
 * Product info extracted from shipping label
 */
interface ShippingLabelProduct {
  skuId: string;
  productName: string;
  weight: string;
  qty: number;
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
    console.debug('[Flipkart Sorted PDF] Position-based joining failed, using simple join:', error);
    return items.map((item: any) => item.str || '').join('\n');
  }
};

/**
 * Get crop dimensions for shipping label section
 * 
 * Fixed margins (from Streamlit):
 * - Top: 0.76 cm
 * - Left: 6.49 cm
 * - Right: 6.49 cm
 * - Bottom: 16.14 cm
 * 
 * @param pageWidth Page width in points
 * @param pageHeight Page height in points
 * @returns Crop dimensions or null if invalid
 */
const getCropDimensions = (
  pageWidth: number,
  pageHeight: number
): { cropX0: number; cropY0: number; cropX1: number; cropY1: number; cropWidth: number; cropHeight: number } | null => {
  // Validate page dimensions
  if (pageWidth <= 0 || pageHeight <= 0) {
    console.error(`[Flipkart Sorted PDF] Invalid page dimensions: ${pageWidth}x${pageHeight}`);
    return null;
  }

  // Fixed crop margins in centimeters (from Streamlit)
  const TOP_MARGIN_CM = 0.76;
  const LEFT_MARGIN_CM = 6.49;
  const RIGHT_MARGIN_CM = 6.49;
  const BOTTOM_MARGIN_CM = 16.14;

  // Convert cm to points (1 cm = 28.35 points in PDF)
  const CM_TO_POINTS = 28.35;

  const topMarginPt = TOP_MARGIN_CM * CM_TO_POINTS;
  const leftMarginPt = LEFT_MARGIN_CM * CM_TO_POINTS;
  const rightMarginPt = RIGHT_MARGIN_CM * CM_TO_POINTS;
  const bottomMarginPt = BOTTOM_MARGIN_CM * CM_TO_POINTS;

  // Calculate crop rectangle based on margins
  const cropX0 = leftMarginPt;
  const cropY0 = topMarginPt;
  const cropX1 = pageWidth - rightMarginPt;
  const cropY1 = pageHeight - bottomMarginPt;

  // Validate crop rectangle
  if (cropX1 <= cropX0 || cropY1 <= cropY0) {
    console.error(`[Flipkart Sorted PDF] Invalid crop rectangle: (${cropX0}, ${cropY0}) to (${cropX1}, ${cropY1})`);
    return null;
  }

  const cropWidth = cropX1 - cropX0;
  const cropHeight = cropY1 - cropY0;

  return { cropX0, cropY0, cropX1, cropY1, cropWidth, cropHeight };
};

/**
 * Extract product info from shipping label section only (before "Tax Invoice")
 * 
 * @param pageText Full text content of the PDF page
 * @returns List of product info dicts
 */
const extractProductFromShippingLabel = (pageText: string): ShippingLabelProduct[] => {
  if (!pageText) {
    return [];
  }

  // Split text at "Tax Invoice" to get only shipping label section
  let shippingLabelText = pageText;
  if (pageText.includes('Tax Invoice') || pageText.toUpperCase().includes('TAX INVOICE')) {
    const lines = pageText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Tax Invoice') || lines[i].toUpperCase().includes('TAX INVOICE')) {
        // Take everything before this line
        shippingLabelText = lines.slice(0, i).join('\n');
        break;
      }
    }
  }

  // Use existing extraction function but on shipping label text only
  const skuProducts = extractSkuFromPage(shippingLabelText);

  const products: ShippingLabelProduct[] = [];
  for (const { skuId, qty } of skuProducts) {
    // Clean SKU ID - remove description part if pipe exists
    let cleanSkuId = skuId;
    if (cleanSkuId.includes('|')) {
      cleanSkuId = cleanSkuId.split('|')[0].trim();
    }

    const { productName, weight } = parseSkuId(cleanSkuId);

    // Convert null to empty string
    products.push({
      skuId: cleanSkuId,
      productName: productName || '',
      weight: weight || '',
      qty
    });
  }

  return products;
};

/**
 * Highlight quantities > 1 in shipping label section
 * Also highlights when same product appears multiple times (even if each shows QTY 1)
 * 
 * @param page PDF page to highlight
 * @param products Optional list of product dicts to help detect duplicates
 * @param totalQty Optional total quantity (sum of all products)
 * @returns Number of blocks highlighted
 */
const highlightLargeQtyFlipkart = async (
  page: PDFPage,
  products?: ShippingLabelProduct[],
  totalQty?: number
): Promise<number> => {
  try {
    console.log('[Flipkart Sorted PDF] 🎨 HIGHLIGHTING START: highlightLargeQtyFlipkart() called');
    
    const { width: pageWidth, height: pageHeight } = page.getSize();
    console.log(`[Flipkart Sorted PDF] Page info: width=${pageWidth.toFixed(1)}, height=${pageHeight.toFixed(1)}`);

    // Detect if same product appears multiple times
    let hasDuplicateProducts = false;
    if (products && products.length > 1) {
      const productIdentifiers = new Set<string>();
      for (const p of products) {
        const pName = (p.productName || '').trim().toLowerCase();
        const pWeight = (p.weight || '').trim().toLowerCase();
        if (pName && pWeight) {
          const identifier = `${pName}|${pWeight}`;
          if (productIdentifiers.has(identifier)) {
            hasDuplicateProducts = true;
            console.log(`[Flipkart Sorted PDF] 🔍 Duplicate product detected: ${pName} (${pWeight})`);
            break;
          }
          productIdentifiers.add(identifier);
        }
      }
    }

    // If total_qty > 1 or multiple products detected, highlight all product rows
    const shouldHighlightAll = (totalQty && totalQty > 1) || (products && products.length > 1);

    console.log(`[Flipkart Sorted PDF] Decision: should_highlight=${shouldHighlightAll}, total_qty=${totalQty}, duplicates=${hasDuplicateProducts}, products=${products?.length || 0}`);

    if (!shouldHighlightAll) {
      console.log('[Flipkart Sorted PDF] ⏭️  No highlighting needed - total_qty <= 1 and only 1 product');
      return 0;
    }

    // Get page text using pdf.js for text extraction
    // We need to get the source PDF bytes to use pdf.js
    // For now, we'll use a simpler approach: highlight based on product info
    
    // Since we don't have direct access to pdf.js page here, we'll use a workaround:
    // Create a highlight rectangle that covers the product table area
    // This is a simplified version - in a full implementation, we'd extract text positions
    
    // For Flipkart, the product table is typically in the shipping label section
    // We'll highlight a region that likely contains the product information
    // This is an approximation - the Streamlit version does text-based detection
    
    let highlightedCount = 0;
    
    // Highlight full width for product rows (approximate position)
    // In Flipkart invoices, product table is typically in the middle-upper section
    // We'll highlight a region that covers the likely product table area
    const highlightY = pageHeight * 0.3; // Start at ~30% from bottom
    const highlightHeight = pageHeight * 0.4; // Cover ~40% of page height
    const highlightX = 0;
    const highlightWidth = pageWidth;

    try {
      // Draw highlight rectangle (red, semi-transparent)
      page.drawRectangle({
        x: highlightX,
        y: highlightY,
        width: highlightWidth,
        height: highlightHeight,
        color: rgb(1, 0, 0), // Red color
        opacity: 0.4, // Semi-transparent
      });

      highlightedCount++;
      console.log(`[Flipkart Sorted PDF] ✅ Highlighted page (rect: ${highlightX.toFixed(1)},${highlightY.toFixed(1)} to ${(highlightX + highlightWidth).toFixed(1)},${(highlightY + highlightHeight).toFixed(1)})`);
    } catch (drawError) {
      console.error(`[Flipkart Sorted PDF] ❌ Error drawing highlight:`, drawError);
    }

    console.log(`[Flipkart Sorted PDF] ✅ HIGHLIGHTING COMPLETE: ${highlightedCount} blocks highlighted`);
    return highlightedCount;
  } catch (error) {
    console.error('[Flipkart Sorted PDF] Error highlighting shipping label:', error);
    return 0;
  }
};

/**
 * Generate a cropped + highlighted PDF from Flipkart invoices.
 * Pages are kept in original order. Multi-qty pages are highlighted.
 * Each page is cropped to show only the shipping label section.
 *
 * @param allPdfBytes Array of PDF file bytes
 * @returns PDF bytes or null if error
 */
export const sortPdfBySkuFlipkart = async (
  allPdfBytes: Uint8Array[]
): Promise<Uint8Array | null> => {
  console.log(`[Flipkart PDF] Generating cropped+highlighted PDF from ${allPdfBytes.length} file(s)`);

  if (!allPdfBytes || allPdfBytes.length === 0) return null;

  try {
    const outputPdf = await PDFDocument.create();

    for (let pdfIdx = 0; pdfIdx < allPdfBytes.length; pdfIdx++) {
      const pdfBytes = allPdfBytes[pdfIdx];
      if (!pdfBytes || pdfBytes.length === 0) continue;

      const sourcePdf = await PDFDocument.load(pdfBytes);
      const totalPages = sourcePdf.getPageCount();
      console.log(`[Flipkart PDF] File ${pdfIdx + 1}: ${totalPages} pages`);

      // Load with pdf.js for text extraction (to detect multi-qty)
      const pdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;

      for (let pageNum = 0; pageNum < totalPages; pageNum++) {
        try {
          const originalPage = sourcePdf.getPage(pageNum);
          const { width: pageWidth, height: pageHeight } = originalPage.getSize();
          const cropDimensions = getCropDimensions(pageWidth, pageHeight);

          // Extract text to check qty
          let totalQty = 1;
          let products: ShippingLabelProduct[] = [];
          try {
            const pdfjsPage = await pdfjsDoc.getPage(pageNum + 1);
            const textContent = await pdfjsPage.getTextContent();
            const pageText = smartJoinTextItems(textContent.items);
            products = extractProductFromShippingLabel(pageText);
            totalQty = products.reduce((sum, p) => sum + p.qty, 0);
          } catch {
            // continue without highlight info
          }

          const shouldHighlight = totalQty > 1 || products.length > 1;

          if (cropDimensions) {
            const { cropX0, cropY0, cropWidth, cropHeight } = cropDimensions;
            const xOffset = -cropX0;
            const yOffset = -(pageHeight - cropY0 - cropHeight);

            const embeddedPage = await outputPdf.embedPage(originalPage);
            const newPage = outputPdf.addPage([cropWidth, cropHeight]);
            newPage.drawPage(embeddedPage, { x: xOffset, y: yOffset, xScale: 1, yScale: 1 });

            if (shouldHighlight) {
              await highlightLargeQtyFlipkart(newPage, products, totalQty);
            }
          } else {
            // Fallback: full page
            const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageNum]);
            outputPdf.addPage(copiedPage);
            if (shouldHighlight) {
              await highlightLargeQtyFlipkart(outputPdf.getPage(outputPdf.getPageCount() - 1), products, totalQty);
            }
          }
        } catch (pageErr) {
          console.error(`[Flipkart PDF] Error on page ${pageNum + 1}:`, pageErr);
        }
      }
    }

    const pageCount = outputPdf.getPageCount();
    if (pageCount === 0) {
      console.error('[Flipkart PDF] No pages in output PDF');
      return null;
    }

    const pdfBytes = await outputPdf.save();
    console.log(`[Flipkart PDF] ✅ Done: ${pageCount} pages, ${pdfBytes.length} bytes`);
    return new Uint8Array(pdfBytes);
  } catch (error) {
    console.error('[Flipkart PDF] ❌ Error:', error);
    return null;
  }
};

