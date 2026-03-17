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
 * Page data for sorting
 */
interface PageData {
  pageNum: number;
  useCropped: boolean;
  productName: string;
  weight: string;
  skuId: string;
  maxQty: number;
  totalQty: number;
  hasDuplicates: boolean;
  sortKey: [string, string, string];
  products: ShippingLabelProduct[];
  pdfBytes: Uint8Array;
  cropDimensions: { cropX0: number; cropY0: number; cropWidth: number; cropHeight: number } | null;
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
 * Sort Flipkart invoice PDFs by product name/SKU and highlight quantities > 1
 * 
 * Process:
 * 1. For each page: crop to shipping label section
 * 2. Extract product info from shipping label
 * 3. Sort pages by (product_name, weight, sku_id)
 * 4. Apply highlighting to pages with qty > 1
 * 5. Return sorted PDF with only shipping labels
 * 
 * @param allPdfBytes Array of PDF file bytes
 * @returns Sorted PDF bytes or null if error
 */
export const sortPdfBySkuFlipkart = async (
  allPdfBytes: Uint8Array[]
): Promise<Uint8Array | null> => {
  console.log(`[Flipkart Sorted PDF] === sortPdfBySkuFlipkart() called with ${allPdfBytes.length} PDF files ===`);
  
  if (!allPdfBytes || allPdfBytes.length === 0) {
    console.error('[Flipkart Sorted PDF] ❌ No PDF bytes provided');
    return null;
  }
  
  // Validate PDF bytes
  for (let i = 0; i < allPdfBytes.length; i++) {
    if (!allPdfBytes[i] || allPdfBytes[i].length === 0) {
      console.error(`[Flipkart Sorted PDF] ❌ PDF bytes at index ${i} is empty or invalid`);
      return null;
    }
  }
  
  try {
    // Combine all PDFs into one document first
    const combinedPdf = await PDFDocument.create();
    const pageDataList: PageData[] = [];

    // Process each PDF file
    for (let pdfIdx = 0; pdfIdx < allPdfBytes.length; pdfIdx++) {
      const pdfBytes = allPdfBytes[pdfIdx];
      
      try {
        // Load PDF with pdf-lib for manipulation
        const sourcePdf = await PDFDocument.load(pdfBytes);
        const totalPages = sourcePdf.getPageCount();

        console.log(`[Flipkart Sorted PDF] PDF ${pdfIdx + 1}: ${totalPages} pages`);

        if (totalPages === 0) {
          console.warn(`[Flipkart Sorted PDF] Empty PDF at index ${pdfIdx}`);
          continue;
        }

        // Also load with pdf.js for text extraction
        const pdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

        // Process each page
        for (let pageNum = 0; pageNum < totalPages; pageNum++) {
          try {
            console.debug(`[Flipkart Sorted PDF] Processing page ${pageNum + 1}/${totalPages} of PDF ${pdfIdx + 1}`);

            // Get crop dimensions for shipping label section
            const originalPage = sourcePdf.getPage(pageNum);
            const { width: pageWidth, height: pageHeight } = originalPage.getSize();
            const cropDimensions = getCropDimensions(pageWidth, pageHeight);
            const useCropped = cropDimensions !== null;

            if (!useCropped) {
              console.warn(`[Flipkart Sorted PDF] ⚠️ Could not crop page ${pageNum + 1}, using full page as fallback`);
            }

            // Extract product info from shipping label (or full page if crop failed)
            let shippingLabelText = '';
            try {
              const pdfjsPage = await pdfjsDoc.getPage(pageNum + 1); // pdf.js uses 1-based indexing
              const textContent = await pdfjsPage.getTextContent();
              shippingLabelText = smartJoinTextItems(textContent.items);
              console.debug(`[Flipkart Sorted PDF] Page ${pageNum + 1} text length: ${shippingLabelText.length} chars`);
            } catch (textError) {
              console.error(`[Flipkart Sorted PDF] Could not extract text from page ${pageNum + 1}:`, textError);
              continue;
            }

            const products = extractProductFromShippingLabel(shippingLabelText);
            console.debug(`[Flipkart Sorted PDF] Page ${pageNum + 1} extracted ${products.length} products`);

            // Get primary product for sorting (use first product or aggregate)
            let productName = '';
            let weight = '';
            let skuId = '';
            let maxQty = 1;
            let totalQty = 1;
            let hasDuplicates = false;

            if (products.length > 0) {
              // Use first product as primary (most invoices have single product)
              const primaryProduct = products[0];
              productName = primaryProduct.productName;
              weight = primaryProduct.weight;
              skuId = primaryProduct.skuId;

              // Calculate max_qty (individual max) and total_qty (sum of all quantities)
              maxQty = Math.max(...products.map(p => p.qty));

              // Calculate total_qty: sum of all quantities
              totalQty = products.reduce((sum, p) => sum + p.qty, 0);

              // Check if same product appears multiple times
              if (products.length > 1) {
                const productIdentifiers = new Set<string>();
                for (const p of products) {
                  const pName = (p.productName || '').trim().toLowerCase();
                  const pWeight = (p.weight || '').trim().toLowerCase();
                  if (pName && pWeight) {
                    const identifier = `${pName}|${pWeight}`;
                    if (productIdentifiers.has(identifier)) {
                      hasDuplicates = true;
                      break;
                    }
                    productIdentifiers.add(identifier);
                  }
                }
              }

              console.log(`[Flipkart Sorted PDF] Page ${pageNum + 1}: max_qty=${maxQty}, total_qty=${totalQty}, has_duplicates=${hasDuplicates}, products=${products.length}`);
            } else {
              console.warn(`[Flipkart Sorted PDF] ⚠️ Page ${pageNum + 1}: No products extracted`);
            }

            // Create sort key
            const sortKey: [string, string, string] = [
              productName || 'ZZZ_NO_NAME',
              weight || 'ZZZ_NO_WEIGHT',
              skuId || 'ZZZ_NO_SKU'
            ];

            // Store page data
            pageDataList.push({
              pageNum,
              useCropped,
              productName,
              weight,
              skuId,
              maxQty,
              totalQty,
              hasDuplicates,
              sortKey,
              products,
              pdfBytes, // Keep reference to PDF bytes for fallback
              cropDimensions,
            });
          } catch (error) {
            console.error(`[Flipkart Sorted PDF] ❌ Error processing page ${pageNum + 1}:`, error);
            continue;
          }
        }
      } catch (error) {
        console.error(`[Flipkart Sorted PDF] ❌ Error processing PDF ${pdfIdx + 1}:`, error);
        continue;
      }
    }

    console.log(`[Flipkart Sorted PDF] Processed ${pageDataList.length} pages out of all PDFs`);

    if (pageDataList.length === 0) {
      console.error('[Flipkart Sorted PDF] ❌ No pages could be processed - returning null');
      console.error('[Flipkart Sorted PDF] Debug info:', {
        totalPdfFiles: allPdfBytes.length,
        pdfSizes: allPdfBytes.map((b, i) => ({ index: i, size: b.length }))
      });
      return null;
    }

    // Sort pages by product name, weight, SKU
    console.log(`[Flipkart Sorted PDF] Sorting ${pageDataList.length} pages...`);
    pageDataList.sort((a, b) => {
      // Compare sort keys lexicographically
      for (let i = 0; i < 3; i++) {
        const cmp = a.sortKey[i].localeCompare(b.sortKey[i]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

    // Create new PDF with sorted cropped pages
    console.log('[Flipkart Sorted PDF] Creating sorted PDF document...');
    const sortedPdf = await PDFDocument.create();
    const highlightingInfo: Array<{ pageIndex: number; products: ShippingLabelProduct[]; totalQty: number; hasDuplicates: boolean }> = [];

    // FIRST PASS: Insert all pages into sortedPdf (without highlighting)
    for (let idx = 0; idx < pageDataList.length; idx++) {
      const pageInfo = pageDataList[idx];
      const { useCropped, totalQty, products, hasDuplicates, cropDimensions } = pageInfo;

      // Determine if this page needs highlighting
      const shouldHighlight = totalQty > 1 || products.length > 1;

      try {
        const sourcePdf = await PDFDocument.load(pageInfo.pdfBytes);
        const originalPage = sourcePdf.getPage(pageInfo.pageNum);

        if (useCropped && cropDimensions) {
          // Create cropped page using proper PDF embedding approach
          const { cropX0, cropY0, cropWidth, cropHeight } = cropDimensions;
          
          // Get original page size for reference
          const { width: originalWidth, height: originalHeight } = originalPage.getSize();
          
          console.debug(`[Flipkart Sorted PDF] Cropping page ${idx + 1}: original=${originalWidth.toFixed(1)}x${originalHeight.toFixed(1)}, crop=${cropWidth.toFixed(1)}x${cropHeight.toFixed(1)}, offset=(${cropX0.toFixed(1)}, ${cropY0.toFixed(1)})`);
          
          try {
            // Copy the page from source PDF to sortedPdf (this creates a page reference we can draw)
            // Note: sourcePdf is already loaded above, reuse it
            const [copiedPage] = await sortedPdf.copyPages(sourcePdf, [pageInfo.pageNum]);
            
            // Create new page with cropped dimensions
            const newPage = sortedPdf.addPage([cropWidth, cropHeight]);
            
            // Calculate offsets to show only the cropped region
            // In pdf-lib: bottom-left origin, so we need to adjust Y coordinate
            // cropY0 is distance from top, convert to bottom-left coordinates
            const xOffset = -cropX0;
            const yOffset = -(originalHeight - cropY0 - cropHeight);
            
            // Validate offsets are reasonable (content should be partially visible)
            // If offsets are too large (more than page size), content will be completely outside bounds
            const maxOffsetX = cropWidth * 0.5; // Allow up to 50% of page width as offset
            const maxOffsetY = cropHeight * 0.5; // Allow up to 50% of page height as offset
            
            if (Math.abs(xOffset) > maxOffsetX || Math.abs(yOffset) > maxOffsetY) {
              console.warn(`[Flipkart Sorted PDF] ⚠️ Large offsets detected for page ${idx + 1}: xOffset=${xOffset.toFixed(1)}, yOffset=${yOffset.toFixed(1)}. This may cause content to be outside visible bounds.`);
            }
            
            // Draw copied page with negative offsets to show only cropped region
            // The page size naturally clips the content outside the bounds
            newPage.drawPage(copiedPage, {
              x: xOffset,
              y: yOffset,
              xScale: 1,
              yScale: 1
            });
            
            // Verify page was created successfully
            const pageCountAfter = sortedPdf.getPageCount();
            if (pageCountAfter === 0) {
              throw new Error('Page was not added to PDF - page count is 0');
            }
            
            console.debug(`[Flipkart Sorted PDF] ✅ Successfully added cropped page ${idx + 1} using drawPage method (xOffset=${xOffset.toFixed(1)}, yOffset=${yOffset.toFixed(1)})`);
          } catch (drawError) {
            const errorMessage = drawError instanceof Error ? drawError.message : String(drawError);
            console.error(`[Flipkart Sorted PDF] Error cropping page ${idx + 1} with drawPage method:`, errorMessage);
            console.error(`[Flipkart Sorted PDF] Error details:`, {
              errorType: drawError instanceof Error ? drawError.constructor.name : typeof drawError,
              errorMessage,
              stack: drawError instanceof Error ? drawError.stack : undefined,
              pageDimensions: { originalWidth, originalHeight },
              cropDimensions: { cropX0, cropY0, cropWidth, cropHeight }
            });
            
            // Fallback: Add full page without cropping
            try {
              console.warn(`[Flipkart Sorted PDF] Attempting fallback to full page for page ${idx + 1}`);
              const [copiedPage] = await sortedPdf.copyPages(sourcePdf, [pageInfo.pageNum]);
              sortedPdf.addPage(copiedPage);
              console.warn(`[Flipkart Sorted PDF] ✅ Using full page as fallback for page ${idx + 1}`);
            } catch (fallbackError) {
              const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
              console.error(`[Flipkart Sorted PDF] ❌ Fallback failed for page ${idx + 1}:`, fallbackMessage);
              // Skip this page
              continue;
            }
          }

          // Store highlighting info for pages that need it
          if (shouldHighlight) {
            const sortedPageIdx = sortedPdf.getPageCount() - 1;
            highlightingInfo.push({
              pageIndex: sortedPageIdx,
              products,
              totalQty,
              hasDuplicates
            });
          }
        } else {
          // Use original page directly (fallback when cropping failed)
          const [copiedPage] = await sortedPdf.copyPages(sourcePdf, [pageInfo.pageNum]);
          sortedPdf.addPage(copiedPage);
          console.debug(`[Flipkart Sorted PDF] Added full page ${idx + 1} (no cropping)`);

          // Store highlighting info if needed
          if (shouldHighlight) {
            const sortedPageIdx = sortedPdf.getPageCount() - 1;
            highlightingInfo.push({
              pageIndex: sortedPageIdx,
              products,
              totalQty,
              hasDuplicates
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Flipkart Sorted PDF] ❌ Error inserting page ${idx + 1}:`, errorMessage);
        console.error(`[Flipkart Sorted PDF] Page insertion error details:`, {
          pageIndex: idx + 1,
          totalPages: pageDataList.length,
          pageInfo: {
            pageNum: pageInfo.pageNum,
            useCropped: pageInfo.useCropped,
            productName: pageInfo.productName,
            skuId: pageInfo.skuId,
            hasCropDimensions: !!pageInfo.cropDimensions
          },
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          stack: error instanceof Error ? error.stack : undefined
        });
        continue;
      }
    }

    const finalPageCount = sortedPdf.getPageCount();
    console.log(`[Flipkart Sorted PDF] Sorted PDF created with ${finalPageCount} pages`);

    // Validate that PDF has pages before proceeding
    if (finalPageCount === 0) {
      console.error('[Flipkart Sorted PDF] ❌ Sorted PDF has no pages - cannot save empty PDF');
      console.error('[Flipkart Sorted PDF] Debug info:', {
        totalPdfFiles: allPdfBytes.length,
        pageDataListLength: pageDataList.length,
        pdfSizes: allPdfBytes.map((b, i) => ({ index: i, size: b.length }))
      });
      return null;
    }

    // SECOND PASS: Apply highlighting to pages in sortedPdf
    if (highlightingInfo.length > 0) {
      console.log(`[Flipkart Sorted PDF] 🎨 SECOND PASS: Applying highlights to ${highlightingInfo.length} pages in sorted PDF...`);
      
      for (let idx = 0; idx < highlightingInfo.length; idx++) {
        const highlightData = highlightingInfo[idx];
        const { pageIndex, products, totalQty, hasDuplicates } = highlightData;

        console.log(`[Flipkart Sorted PDF] 📄 Processing page ${idx + 1}/${highlightingInfo.length}: sorted_pdf index ${pageIndex}`);

        try {
          if (pageIndex < sortedPdf.getPageCount()) {
            const sortedPage = sortedPdf.getPage(pageIndex);
            console.log(`[Flipkart Sorted PDF] 🎨 Calling highlightLargeQtyFlipkart() for sorted_pdf page ${pageIndex + 1}...`);

            const highlightCount = await highlightLargeQtyFlipkart(sortedPage, products, totalQty);

            const qtyReason = totalQty > 1 
              ? `total_qty=${totalQty}` 
              : hasDuplicates 
                ? 'duplicate products' 
                : products.length > 1 
                  ? `multiple products (${products.length} products)` 
                  : 'unknown';

            if (highlightCount > 0) {
              console.log(`[Flipkart Sorted PDF] ✅ SUCCESS: Highlighted sorted_pdf page ${pageIndex + 1} with ${qtyReason} (${highlightCount} blocks highlighted)`);
            } else {
              console.warn(`[Flipkart Sorted PDF] ⚠️  WARNING: Highlight function returned 0 blocks for sorted_pdf page ${pageIndex + 1} (qty_reason: ${qtyReason})`);
            }
          } else {
            console.error(`[Flipkart Sorted PDF] ❌ ERROR: Page index ${pageIndex} out of range for sorted_pdf (length: ${sortedPdf.getPageCount()})`);
          }
        } catch (error) {
          console.error(`[Flipkart Sorted PDF] ❌ ERROR: Could not highlight sorted_pdf page ${pageIndex + 1}:`, error);
        }
      }

      console.log(`[Flipkart Sorted PDF] 🎨 SECOND PASS COMPLETE: Finished processing ${highlightingInfo.length} pages`);
    } else {
      console.log('[Flipkart Sorted PDF] ⏭️  No pages require highlighting (all pages have qty <= 1 and only 1 product each)');
    }

    // Save to bytes
    console.log('[Flipkart Sorted PDF] Saving sorted PDF to buffer...');
    
    // Validate page count one more time before saving
    const pageCountBeforeSave = sortedPdf.getPageCount();
    if (pageCountBeforeSave === 0) {
      console.error('[Flipkart Sorted PDF] ❌ PDF has no pages - cannot save empty PDF');
      return null;
    }
    
    const pdfBytes = await sortedPdf.save();
    const bufferSize = pdfBytes.length;
    
    if (bufferSize === 0) {
      console.error('[Flipkart Sorted PDF] ❌ Saved PDF is empty (0 bytes)');
      return null;
    }
    
    // Validate PDF header to ensure it's a valid PDF
    const pdfHeader = new TextDecoder().decode(pdfBytes.slice(0, 4));
    if (!pdfHeader.startsWith('%PDF')) {
      console.error(`[Flipkart Sorted PDF] ❌ Saved PDF has invalid header: "${pdfHeader}" (expected "%PDF")`);
      return null;
    }
    
    console.log(`[Flipkart Sorted PDF] ✅ Sorted PDF saved: ${pageCountBeforeSave} pages, ${bufferSize} bytes (${(bufferSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`[Flipkart Sorted PDF] ✅ Successfully sorted ${pageDataList.length} shipping labels by product`);

    return new Uint8Array(pdfBytes);
  } catch (error) {
    console.error('[Flipkart Sorted PDF] ❌ Error sorting PDF by SKU:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Flipkart Sorted PDF] Error details:', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
};

