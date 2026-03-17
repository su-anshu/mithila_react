import { PDFDocument } from 'pdf-lib';
import { generateMRPLabel } from './pdfGenerator';
import { generateBarcodePDF, generateBarcodePDFVertical } from './barcodeGenerator';
import { extractFnskuPageFromPdf } from './pdfExtractor';
import { MasterProduct } from '../types';
import { VERTICAL_WIDTH, VERTICAL_HEIGHT, COMBINED_WIDTH, COMBINED_HEIGHT, MM_TO_PT } from '../constants';

/**
 * Generate vertical combined label (50mm x 42mm)
 * MRP label on top, barcode on bottom
 */
export const generateCombinedLabelVertical = async (
  product: MasterProduct
): Promise<Uint8Array> => {
  const fnsku = String(product.FNSKU || '').trim();
  
  if (!fnsku) {
    throw new Error('FNSKU is required for combined label generation');
  }
  
  // Generate MRP label PDF
  const mrpPdf = generateMRPLabel(product);
  const mrpBytes = mrpPdf.output('arraybuffer');
  
  // Generate barcode PDF
  const barcodeBytes = await generateBarcodePDFVertical(fnsku);
  
  // Create combined PDF
  const combinedPdf = await PDFDocument.create();
  const page = combinedPdf.addPage([VERTICAL_WIDTH * MM_TO_PT, VERTICAL_HEIGHT * MM_TO_PT]);
  
  // Load MRP PDF
  const mrpDoc = await PDFDocument.load(mrpBytes);
  const [mrpPage] = await combinedPdf.copyPages(mrpDoc, [0]);
  
  // Load barcode PDF
  const barcodeDoc = await PDFDocument.load(barcodeBytes);
  const [barcodePage] = await combinedPdf.copyPages(barcodeDoc, [0]);
  
  // Calculate positions
  const pageHeight = VERTICAL_HEIGHT * MM_TO_PT;
  const mrpHeight = 21 * MM_TO_PT; // Top half
  const barcodeHeight = 20 * MM_TO_PT; // Bottom half
  const gap = 1 * MM_TO_PT; // 1mm gap between sections
  
  // Draw MRP label on top
  page.drawPage(mrpPage, {
    x: 0,
    y: pageHeight - mrpHeight,
    xScale: (VERTICAL_WIDTH * MM_TO_PT) / (48 * MM_TO_PT), // Scale from 48mm to 50mm width
    yScale: mrpHeight / (25 * MM_TO_PT) // Scale height proportionally
  });
  
  // Draw barcode on bottom
  page.drawPage(barcodePage, {
    x: 0,
    y: 0,
    xScale: 1,
    yScale: 1
  });
  
  // Draw separator line
  page.drawLine({
    start: { x: 5 * MM_TO_PT, y: barcodeHeight + gap / 2 },
    end: { x: (VERTICAL_WIDTH - 5) * MM_TO_PT, y: barcodeHeight + gap / 2 },
    thickness: 0.5,
    color: { r: 0, g: 0, b: 0 }
  });
  
  const pdfBytes = await combinedPdf.save();
  return new Uint8Array(pdfBytes);
};

/**
 * Generate horizontal combined MRP + barcode label using existing barcode PDF
 * 
 * @param product Product data for MRP label
 * @param barcodePdfBytes Existing barcode PDF bytes
 * @param fnsku FNSKU code to extract from barcode PDF
 * @returns Combined label PDF bytes (96mm x 25mm) or null if error
 */
export const generateCombinedLabelHorizontalFromPdf = async (
  product: MasterProduct,
  barcodePdfBytes: Uint8Array,
  fnsku: string
): Promise<Uint8Array | null> => {
  try {
    // Generate MRP label PDF
    const mrpPdf = generateMRPLabel(product);
    const mrpBytes = mrpPdf.output('arraybuffer');

    // Extract barcode page from PDF
    const barcodePageBytes = await extractFnskuPageFromPdf(fnsku, barcodePdfBytes);
    if (!barcodePageBytes) {
      console.error(`FNSKU ${fnsku} not found in barcode PDF`);
      return null;
    }

    // Create combined PDF
    const combinedPdf = await PDFDocument.create();
    const page = combinedPdf.addPage([COMBINED_WIDTH * MM_TO_PT, COMBINED_HEIGHT * MM_TO_PT]);

    // Load MRP PDF
    const mrpDoc = await PDFDocument.load(mrpBytes);
    const [mrpPage] = await combinedPdf.copyPages(mrpDoc, [0]);

    // Load barcode PDF
    const barcodeDoc = await PDFDocument.load(barcodePageBytes);
    const [barcodePage] = await combinedPdf.copyPages(barcodeDoc, [0]);

    // Draw MRP label on left (48mm)
    page.drawPage(mrpPage, {
      x: 0,
      y: 0,
      xScale: 1,
      yScale: 1
    });

    // Draw barcode on right (48mm)
    page.drawPage(barcodePage, {
      x: 48 * MM_TO_PT,
      y: 0,
      xScale: 1,
      yScale: 1
    });

    const pdfBytes = await combinedPdf.save();
    return new Uint8Array(pdfBytes);
  } catch (e) {
    console.error(`Error generating combined label from PDF: ${String(e)}`);
    return null;
  }
};

/**
 * Generate vertical combined MRP + barcode label using existing barcode PDF
 * 
 * @param product Product data for MRP label
 * @param barcodePdfBytes Existing barcode PDF bytes
 * @param fnsku FNSKU code to extract from barcode PDF
 * @returns Combined label PDF bytes (50mm x 42mm) or null if error
 */
export const generateCombinedLabelVerticalFromPdf = async (
  product: MasterProduct,
  barcodePdfBytes: Uint8Array,
  fnsku: string
): Promise<Uint8Array | null> => {
  try {
    // Generate MRP label PDF
    const mrpPdf = generateMRPLabel(product);
    const mrpBytes = mrpPdf.output('arraybuffer');

    // Extract barcode page from PDF
    const barcodePageBytes = await extractFnskuPageFromPdf(fnsku, barcodePdfBytes);
    if (!barcodePageBytes) {
      console.error(`FNSKU ${fnsku} not found in barcode PDF`);
      return null;
    }

    // Create combined PDF
    const combinedPdf = await PDFDocument.create();
    const page = combinedPdf.addPage([VERTICAL_WIDTH * MM_TO_PT, VERTICAL_HEIGHT * MM_TO_PT]);

    // Load MRP PDF
    const mrpDoc = await PDFDocument.load(mrpBytes);
    const [mrpPage] = await combinedPdf.copyPages(mrpDoc, [0]);

    // Load barcode PDF
    const barcodeDoc = await PDFDocument.load(barcodePageBytes);
    const [barcodePage] = await combinedPdf.copyPages(barcodeDoc, [0]);

    // Calculate positions
    const pageHeight = VERTICAL_HEIGHT * MM_TO_PT;
    const mrpHeight = 21 * MM_TO_PT; // Top half
    const barcodeHeight = 20 * MM_TO_PT; // Bottom half
    const gap = 1 * MM_TO_PT; // 1mm gap between sections

    // Draw MRP label on top
    page.drawPage(mrpPage, {
      x: 0,
      y: pageHeight - mrpHeight,
      xScale: (VERTICAL_WIDTH * MM_TO_PT) / (48 * MM_TO_PT), // Scale from 48mm to 50mm width
      yScale: mrpHeight / (25 * MM_TO_PT) // Scale height proportionally
    });

    // Draw barcode on bottom
    page.drawPage(barcodePage, {
      x: 0,
      y: 0,
      xScale: 1,
      yScale: 1
    });

    // Draw separator line
    page.drawLine({
      start: { x: 5 * MM_TO_PT, y: barcodeHeight + gap / 2 },
      end: { x: (VERTICAL_WIDTH - 5) * MM_TO_PT, y: barcodeHeight + gap / 2 },
      thickness: 0.5,
      color: { r: 0, g: 0, b: 0 }
    });

    const pdfBytes = await combinedPdf.save();
    return new Uint8Array(pdfBytes);
  } catch (e) {
    console.error(`Error generating vertical combined label from PDF: ${String(e)}`);
    return null;
  }
};

