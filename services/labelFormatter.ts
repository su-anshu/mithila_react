import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { MM_TO_PT } from '../constants';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  const workerVersion = pdfjsLib.version || '5.4.394';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${workerVersion}/build/pdf.worker.min.mjs`;
}

/**
 * Convert PDF page to image using canvas
 * 
 * @param pdf Loaded PDF document (from pdfjsLib.getDocument)
 * @param pageIndex 0-based page index
 * @param dpi DPI for rendering (default 400)
 */
const pdfPageToImage = async (
  pdf: any, // PDFDocumentProxy from pdfjsLib
  pageIndex: number,
  dpi: number = 400
): Promise<HTMLImageElement> => {
  const page = await pdf.getPage(pageIndex + 1); // pdfjs uses 1-based indexing
  
  const scale = dpi / 72; // 72 DPI is default
  const viewport = page.getViewport({ scale });
  
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not get canvas context');
  }
  
  // Render PDF page to canvas
  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;
  
  // Convert canvas to image
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL('image/png');
  });
};

/**
 * Rotate image 90 degrees clockwise
 */
const rotateImage90Clockwise = (img: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = img.height;
  canvas.height = img.width;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }
  
  // Translate to center, rotate, then translate back
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2); // 90 degrees clockwise
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  
  return canvas;
};

/**
 * Reformat House labels into 4x6 inch PDFs with 3 labels stacked vertically (rotated 90°)
 * 
 * @param houseBuffer PDF bytes containing House labels (one per page, typically 50mm × 100mm)
 * @returns PDF bytes with 4×6 inch pages (3 labels per page, rotated 90° clockwise)
 */
export const reformatLabelsTo4x6Vertical = async (
  houseBuffer: Uint8Array
): Promise<Uint8Array> => {
  try {
    console.log('Starting reformat_labels_to_4x6_vertical');
    
    if (!houseBuffer || houseBuffer.length === 0) {
      console.warn('houseBuffer is empty');
      return houseBuffer;
    }
    
    // Create a copy of the buffer to avoid ArrayBuffer detachment issues
    // PDF.js can detach/transfer the ArrayBuffer, making it unusable for subsequent operations
    const bufferCopy = new Uint8Array(houseBuffer);
    
    // Load source PDF using the copy
    const pdf = await pdfjsLib.getDocument({ data: bufferCopy }).promise;
    if (pdf.numPages === 0) {
      console.warn('Source PDF has no pages');
      return houseBuffer;
    }
    
    console.log(`Source PDF has ${pdf.numPages} pages`);
    
    // Get first page dimensions to calculate scaling
    const firstPage = await pdf.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1.0 });
    const sourceWidthPt = viewport.width;
    const sourceHeightPt = viewport.height;
    
    console.log(`First page dimensions: ${sourceWidthPt.toFixed(2)}pt × ${sourceHeightPt.toFixed(2)}pt`);
    
    // 4x6 inch page dimensions in points (1 inch = 72 points)
    const PAGE_WIDTH_PT = 4 * 72.0;   // 288pt
    const PAGE_HEIGHT_PT = 6 * 72.0;  // 432pt
    
    // Margins and gap (vertical layout)
    const MARGIN_X_PT = 4.0;   // 4pt margin on left and right
    const MARGIN_Y_PT = 1.0;   // 1pt margin on top and bottom
    const GAP_Y_PT = 4.0;      // 4pt gap between labels (vertical gap)
    
    // Calculate available space for labels (vertical stacking - 3 labels per page)
    // Need 2 gaps for 3 labels: gap1 between label1-label2, gap2 between label2-label3
    const totalAvailHeight = PAGE_HEIGHT_PT - (2 * MARGIN_Y_PT) - (2 * GAP_Y_PT); // 432 - 2 - 8 = 422pt
    const slotHeight = totalAvailHeight / 3.0; // ~140.67pt per label slot (3 labels stacked)
    const slotWidth = PAGE_WIDTH_PT - (2 * MARGIN_X_PT); // 288 - 8 = 280pt (full width per label)
    
    // Calculate scale to fit label in slot (maintain aspect ratio)
    // Labels will be rotated 90°, so we swap dimensions for calculation
    // After rotation: original width becomes height, original height becomes width
    const scale = Math.min(slotWidth / sourceHeightPt, slotHeight / sourceWidthPt);
    const drawWidth = sourceHeightPt * scale; // After rotation, original height becomes width
    const drawHeight = sourceWidthPt * scale; // After rotation, original width becomes height
    
    console.log(`Scale: ${scale.toFixed(4)}, Draw size: ${drawWidth.toFixed(2)}pt × ${drawHeight.toFixed(2)}pt, Slot: ${slotWidth.toFixed(2)}pt × ${slotHeight.toFixed(2)}pt`);
    
    // Convert all pages to images and rotate them
    // Use the already-loaded PDF document to avoid ArrayBuffer detachment issues
    const rotatedImages: HTMLCanvasElement[] = [];
    for (let i = 0; i < pdf.numPages; i++) {
      try {
        // Convert page to image using the loaded PDF document
        const img = await pdfPageToImage(pdf, i, 400);
        
        // Rotate 90° clockwise (-90 degrees)
        const rotatedCanvas = rotateImage90Clockwise(img);
        rotatedImages.push(rotatedCanvas);
        console.debug(`Converted and rotated page ${i + 1}`);
      } catch (e) {
        console.error(`Error converting page ${i + 1} to image: ${String(e)}`);
        throw e;
      }
    }
    
    // Create output PDF using pdf-lib
    const outputPdf = await PDFDocument.create();
    const totalPages = rotatedImages.length;
    console.log(`Processing ${totalPages} rotated images`);
    
    // Process labels in groups of 3 (3 per page, stacked top/middle/bottom)
    for (let i = 0; i < totalPages; i += 3) {
      const page = outputPdf.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
      
      // Top Label (first of the group)
      if (i < totalPages) {
        const topCanvas = rotatedImages[i];
        const topImg = await outputPdf.embedPng(topCanvas.toDataURL('image/png'));
        
        const yTop = MARGIN_Y_PT + (slotHeight - drawHeight) / 2.0;
        const xTop = MARGIN_X_PT + (slotWidth - drawWidth) / 2.0;
        
        page.drawImage(topImg, {
          x: xTop,
          y: PAGE_HEIGHT_PT - yTop - drawHeight, // pdf-lib uses bottom-left origin
          width: drawWidth,
          height: drawHeight
        });
      }
      
      // Middle Label (second of the group, if exists)
      if (i + 1 < totalPages) {
        const middleCanvas = rotatedImages[i + 1];
        const middleImg = await outputPdf.embedPng(middleCanvas.toDataURL('image/png'));
        
        const yMiddle = MARGIN_Y_PT + slotHeight + GAP_Y_PT + (slotHeight - drawHeight) / 2.0;
        const xMiddle = MARGIN_X_PT + (slotWidth - drawWidth) / 2.0;
        
        page.drawImage(middleImg, {
          x: xMiddle,
          y: PAGE_HEIGHT_PT - yMiddle - drawHeight,
          width: drawWidth,
          height: drawHeight
        });
      }
      
      // Bottom Label (third of the group, if exists)
      if (i + 2 < totalPages) {
        const bottomCanvas = rotatedImages[i + 2];
        const bottomImg = await outputPdf.embedPng(bottomCanvas.toDataURL('image/png'));
        
        const yBottom = MARGIN_Y_PT + (2 * slotHeight) + (2 * GAP_Y_PT) + (slotHeight - drawHeight) / 2.0;
        const xBottom = MARGIN_X_PT + (slotWidth - drawWidth) / 2.0;
        
        page.drawImage(bottomImg, {
          x: xBottom,
          y: PAGE_HEIGHT_PT - yBottom - drawHeight,
          width: drawWidth,
          height: drawHeight
        });
      }
    }
    
    const outputBytes = await outputPdf.save();
    const outputPageCount = Math.ceil(totalPages / 3); // 3 labels per page
    console.log(`Reformatted ${totalPages} House labels into ${outputPageCount} 4x6 inch pages (vertical layout, 3 per page)`);
    
    return new Uint8Array(outputBytes);
  } catch (e) {
    console.error(`Error reformatting House labels to 4x6 vertical: ${String(e)}`);
    console.error(JSON.stringify(e, null, 2));
    throw e;
  }
};

/**
 * Create a 4x6 inch PDF with 3 copies of a single label (stacked top/middle/bottom, rotated 90°)
 * 
 * This is a convenience function for the label generator tool where user selects a product
 * and wants a 4x6 inch PDF with 3 copies of that product's House label.
 * 
 * @param singleLabelPdf PDF bytes containing a single House label PDF (one page)
 * @returns PDF bytes with 4x6 inch PDF containing 3 rotated copies, or original if error
 */
export const create4x6VerticalFromSingleLabel = async (
  singleLabelPdf: Uint8Array
): Promise<Uint8Array> => {
  try {
    console.log('Creating 4x6 vertical from single label');
    
    if (!singleLabelPdf || singleLabelPdf.length === 0) {
      console.warn('singleLabelPdf is empty');
      return singleLabelPdf;
    }
    
    // Create a temporary PDF with 3 copies of the label (duplicate the page)
    const sourcePdf = await PDFDocument.load(singleLabelPdf);
    const tempPdf = await PDFDocument.create();
    
    // Copy the first page 3 times
    const [sourcePage] = await tempPdf.copyPages(sourcePdf, [0]);
    tempPdf.addPage(sourcePage);
    tempPdf.addPage(sourcePage);
    tempPdf.addPage(sourcePage);
    
    const tempBytes = await tempPdf.save();
    
    // Now use the existing function to reformat (which handles 3 labels per page)
    return reformatLabelsTo4x6Vertical(new Uint8Array(tempBytes));
  } catch (e) {
    console.error(`Error creating 4x6 vertical from single label: ${String(e)}`);
    console.error(JSON.stringify(e, null, 2));
    throw e;
  }
};

/**
 * Reformat House labels into 4x6 inch PDFs with 2 labels side-by-side (NOT rotated)
 * 
 * @param houseBuffer PDF bytes containing House labels (one per page, typically 100mm × 150mm)
 * @returns PDF bytes with 4×6 inch pages (2 labels per page, side-by-side, NOT rotated)
 */
export const reformatHouseLabelsTo4x6 = async (
  houseBuffer: Uint8Array
): Promise<Uint8Array> => {
  try {
    console.log('Starting reformat_house_labels_to_4x6');
    
    if (!houseBuffer || houseBuffer.length === 0) {
      console.warn('houseBuffer is empty');
      return houseBuffer;
    }
    
    // Load source PDF with pdf-lib
    const sourcePdf = await PDFDocument.load(houseBuffer);
    const totalPages = sourcePdf.getPageCount();
    
    if (!totalPages || totalPages === 0 || isNaN(totalPages)) {
      console.warn(`Source PDF has no pages or invalid page count: ${totalPages}`);
      return houseBuffer;
    }
    
    console.log(`Source PDF has ${totalPages} pages`);
    
    // Get first page dimensions (should be 100mm × 150mm = ~283.46pt × 425.20pt)
    const firstPage = sourcePdf.getPage(0);
    const { width: sourceWidthPt, height: sourceHeightPt } = firstPage.getSize();
    
    console.log(`First page dimensions: ${sourceWidthPt.toFixed(2)}pt × ${sourceHeightPt.toFixed(2)}pt`);
    
    // 4×6 inch page dimensions in points (1 inch = 72 points)
    const PAGE_WIDTH_PT = 4 * 72.0;   // 288pt
    const PAGE_HEIGHT_PT = 6 * 72.0;  // 432pt
    
    // Margins and gap (side-by-side layout)
    const MARGIN_X_PT = 4.0;   // 4pt margin on left and right
    const MARGIN_Y_PT = 1.0;   // 1pt margin on top and bottom
    const GAP_X_PT = 4.0;      // 4pt gap between labels (horizontal gap)
    
    // Calculate available space for labels (side-by-side - 2 labels per page)
    // Available width: 288 - 8 (2 margins) - 4 (1 gap) = 276pt
    // Available height: 432 - 2 (2 margins) = 430pt
    const totalAvailWidth = PAGE_WIDTH_PT - (2 * MARGIN_X_PT) - GAP_X_PT; // 288 - 8 - 4 = 276pt
    const slotWidth = totalAvailWidth / 2.0; // 138pt per label slot (2 labels side-by-side)
    const slotHeight = PAGE_HEIGHT_PT - (2 * MARGIN_Y_PT); // 432 - 2 = 430pt
    
    // Calculate scale to fit label in slot (maintain aspect ratio)
    // No rotation, so use original dimensions
    const scale = Math.min(slotWidth / sourceWidthPt, slotHeight / sourceHeightPt);
    const drawWidth = sourceWidthPt * scale;
    const drawHeight = sourceHeightPt * scale;
    
    console.log(`Scale: ${scale.toFixed(4)}, Draw size: ${drawWidth.toFixed(2)}pt × ${drawHeight.toFixed(2)}pt, Slot: ${slotWidth.toFixed(2)}pt × ${slotHeight.toFixed(2)}pt`);
    
    // Create output PDF using pdf-lib
    const outputPdf = await PDFDocument.create();
    
    // Process labels in pairs (2 per page, side-by-side)
    for (let i = 0; i < totalPages; i += 2) {
      const page = outputPdf.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
      
      // Left Label (first of the pair)
      if (i < totalPages && i >= 0) {
        try {
          const pageIndex = Math.floor(i); // Ensure integer index
          if (isNaN(pageIndex) || pageIndex < 0 || pageIndex >= totalPages) {
            console.error(`Invalid page index for left label: ${i} (totalPages: ${totalPages})`);
          } else {
            const copiedPages = await outputPdf.copyPages(sourcePdf, [pageIndex]);
            if (!copiedPages || copiedPages.length === 0 || !copiedPages[0]) {
              console.error(`Failed to copy page ${pageIndex} from source PDF - no pages returned`);
            } else {
              const copiedPage = copiedPages[0];
              
              // Calculate position for left label (centered in left slot)
              const xLeft = MARGIN_X_PT + (slotWidth - drawWidth) / 2.0;
              const yLeft = MARGIN_Y_PT + (slotHeight - drawHeight) / 2.0;
              
              page.drawPage(copiedPage, {
                x: xLeft,
                y: PAGE_HEIGHT_PT - yLeft - drawHeight, // pdf-lib uses bottom-left origin
                width: drawWidth,
                height: drawHeight
              });
            }
          }
        } catch (copyError) {
          console.error(`Error copying page ${i} for left label:`, copyError);
          // Skip this label but continue with the page
        }
      }
      
      // Right Label (second of the pair, if exists)
      if (i + 1 < totalPages && (i + 1) >= 0) {
        try {
          const pageIndex = Math.floor(i + 1); // Ensure integer index
          if (isNaN(pageIndex) || pageIndex < 0 || pageIndex >= totalPages) {
            console.error(`Invalid page index for right label: ${i + 1} (totalPages: ${totalPages})`);
          } else {
            const copiedPages = await outputPdf.copyPages(sourcePdf, [pageIndex]);
            if (!copiedPages || copiedPages.length === 0 || !copiedPages[0]) {
              console.error(`Failed to copy page ${pageIndex} from source PDF - no pages returned`);
            } else {
              const copiedPage = copiedPages[0];
              
              // Calculate position for right label (centered in right slot)
              // Right slot starts at: MARGIN_X_PT + slotWidth + GAP_X_PT
              const xRight = MARGIN_X_PT + slotWidth + GAP_X_PT + (slotWidth - drawWidth) / 2.0;
              const yRight = MARGIN_Y_PT + (slotHeight - drawHeight) / 2.0;
              
              page.drawPage(copiedPage, {
                x: xRight,
                y: PAGE_HEIGHT_PT - yRight - drawHeight,
                width: drawWidth,
                height: drawHeight
              });
            }
          }
        } catch (copyError) {
          console.error(`Error copying page ${i + 1} for right label:`, copyError);
          // Skip this label but keep the page (may have left label)
        }
      }
    }
    
    const outputBytes = await outputPdf.save();
    const outputPageCount = Math.ceil(totalPages / 2); // 2 labels per page
    console.log(`Reformatted ${totalPages} House labels into ${outputPageCount} 4x6 inch pages (side-by-side layout, 2 per page)`);
    
    return new Uint8Array(outputBytes);
  } catch (e) {
    console.error(`Error reformatting House labels to 4x6 side-by-side: ${String(e)}`);
    console.error(JSON.stringify(e, null, 2));
    throw e;
  }
};

