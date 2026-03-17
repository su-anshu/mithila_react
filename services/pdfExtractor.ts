import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  const workerVersion = pdfjsLib.version || '5.4.394';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${workerVersion}/build/pdf.worker.min.mjs`;
}

/**
 * Extract FNSKU page from barcode PDF with improved error handling
 * 
 * Searches through PDF pages for the FNSKU code in text content and extracts
 * the matching page as a single-page PDF.
 * 
 * @param fnskuCode FNSKU code to search for
 * @param pdfBytes PDF file bytes containing barcode pages
 * @returns Single-page PDF bytes with matching FNSKU, or null if not found
 */
export const extractFnskuPageFromPdf = async (
  fnskuCode: string,
  pdfBytes: Uint8Array
): Promise<Uint8Array | null> => {
  try {
    if (!fnskuCode || !pdfBytes || pdfBytes.length === 0) {
      console.error('Invalid parameters for FNSKU extraction');
      return null;
    }

    console.log(`Extracting FNSKU page for: ${fnskuCode}`);

    // Load PDF using pdf.js for text extraction
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    
    if (pdf.numPages === 0) {
      console.error('Barcode PDF has no pages');
      return null;
    }

    // Search through pages for FNSKU code
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Extract all text from page
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        
        // Check if FNSKU code is in page text
        if (pageText.includes(fnskuCode)) {
          console.log(`Found FNSKU ${fnskuCode} on page ${pageNum}`);
          
          // Extract the matching page using pdf-lib
          const sourcePdf = await PDFDocument.load(pdfBytes);
          const targetPdf = await PDFDocument.create();
          
          // Copy the matching page (pdf-lib uses 0-based indexing)
          const [copiedPage] = await targetPdf.copyPages(sourcePdf, [pageNum - 1]);
          targetPdf.addPage(copiedPage);
          
          const extractedBytes = await targetPdf.save();
          return new Uint8Array(extractedBytes);
        }
      } catch (e) {
        console.warn(`Error processing page ${pageNum}: ${String(e)}`);
        continue;
      }
    }

    console.warn(`FNSKU ${fnskuCode} not found in barcode PDF`);
    return null;
  } catch (e) {
    console.error(`Error extracting FNSKU page: ${String(e)}`);
    return null;
  }
};

