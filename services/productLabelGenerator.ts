import jsPDF from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { format } from 'date-fns';
import { COMBINED_WIDTH, COMBINED_HEIGHT, LABEL_WIDTH, LABEL_HEIGHT, MM_TO_PT } from '../constants';

export type LabelSize = '48x25mm' | '96x25mm' | '50x100mm' | '100x50mm';

/**
 * Wrap text to fit within width
 */
const wrapText = (
  doc: jsPDF,
  text: string,
  maxWidth: number,
  fontName: string,
  fontSize: number,
  maxLines: number = 3
): string[] => {
  if (!text) return [];
  
  doc.setFont(fontName, 'bold');
  doc.setFontSize(fontSize);
  const words = text.split(' ');
  
  if (words.length === 0) return [];
  
  const lines: string[] = [];
  let currentLine = words[0];
  
  for (let i = 1; i < words.length; i++) {
    const testLine = currentLine + ' ' + words[i];
    const testWidth = doc.getTextWidth(testLine);
    
    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      if (lines.length >= maxLines) break;
      currentLine = words[i];
    }
  }
  
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  
  return lines.slice(0, maxLines);
};

/**
 * Draw single label with product name and optional date
 * All dimensions (width, height, xOffset) are in millimeters
 */
const drawSingleLabel = (
  doc: jsPDF,
  productName: string,
  widthMm: number,
  heightMm: number,
  xOffsetMm: number,
  includeDate: boolean
): void => {
  const isVertical = heightMm > widthMm;
  const currentDate = format(new Date(), 'dd/MM/yyyy');
  
  if (isVertical) {
    // Vertical label (50x100mm)
    const baseHeightMm = 100;
    const scaleFactor = heightMm / baseHeightMm;
    
    // Font sizes are in points (standard)
    const productFontSize = Math.max(14, Math.floor(20 * scaleFactor));
    const dateFontSize = Math.max(10, Math.floor(14 * scaleFactor));
    
    // Line heights in points, convert to mm for positioning
    const lineHeightPt = productFontSize * 1.2;
    const lineHeightMm = lineHeightPt / MM_TO_PT;
    const productBaselineOffsetPt = productFontSize * 0.3;
    const productBaselineOffsetMm = productBaselineOffsetPt / MM_TO_PT;
    
    const availableWidthMm = widthMm * 0.9;
    const productLines = wrapText(doc, productName, availableWidthMm, 'helvetica', productFontSize, 3);
    
    const productTextHeightMm = productLines.length * lineHeightMm;
    
    const verticalPaddingMm = heightMm * 0.1;
    const usableHeightMm = heightMm - (2 * verticalPaddingMm);
    
    let productNameYReportLabMm: number;
    let dateYReportLabMm: number;
    
    if (includeDate) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(dateFontSize);
      const dateTextHeightPt = dateFontSize * 1.2;
      const dateTextHeightMm = dateTextHeightPt / MM_TO_PT;
      const dateBaselineOffsetPt = dateFontSize * 0.3;
      const dateBaselineOffsetMm = dateBaselineOffsetPt / MM_TO_PT;
      const spacingMm = usableHeightMm * 0.15;
      
      const contentCenterYMm = heightMm / 2;
      const productCenterYMm = contentCenterYMm - (dateTextHeightMm + spacingMm) / 2;
      productNameYReportLabMm = productCenterYMm - productBaselineOffsetMm;
      
      const dateCenterYMm = contentCenterYMm + (productTextHeightMm + spacingMm) / 2;
      dateYReportLabMm = dateCenterYMm - dateBaselineOffsetMm;
    } else {
      const centerYMm = heightMm / 2;
      productNameYReportLabMm = centerYMm - productBaselineOffsetMm;
    }
    
    // Convert from ReportLab coordinate system (bottom-left origin) to jsPDF (top-left origin)
    // jsPDF: y = 0 at top, increases downward (in mm)
    // ReportLab: y = 0 at bottom, increases upward (in mm)
    // Conversion: y_jsPDF_mm = height_mm - y_ReportLab_mm
    const productNameYMm = heightMm - productNameYReportLabMm;
    const dateYMm = includeDate ? heightMm - dateYReportLabMm : 0;
    
    // Draw product name lines
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(productFontSize);
    const totalLinesHeightMm = productLines.length * lineHeightMm;
    const topLineYReportLabMm = productNameYReportLabMm + (totalLinesHeightMm - lineHeightMm) / 2;
    const topLineYMm = heightMm - topLineYReportLabMm;
    
    for (let i = 0; i < productLines.length; i++) {
      const line = productLines[i];
      const lineWidthMm = doc.getTextWidth(line); // Returns mm when unit is 'mm'
      const lineXMm = xOffsetMm + (widthMm - lineWidthMm) / 2;
      // For multi-line text, lines are drawn from top to bottom
      // In ReportLab: topLineY - (i * lineHeight) means first line is at topLineY, subsequent lines below
      // In jsPDF: we need to add (i * lineHeight) to go downward
      const lineYMm = topLineYMm + (i * lineHeightMm);
      doc.text(line, lineXMm, lineYMm);
    }
    
    // Draw date
    if (includeDate) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(dateFontSize);
      const dateTextWidthMm = doc.getTextWidth(currentDate); // Returns mm when unit is 'mm'
      const dateXMm = xOffsetMm + (widthMm - dateTextWidthMm) / 2;
      doc.text(currentDate, dateXMm, dateYMm);
    }
  } else {
    // Horizontal label (48x25mm or 96x25mm)
    const baseWidthMm = 48;
    const scaleFactor = widthMm / baseWidthMm;
    
    // Font sizes are in points (standard)
    const productFontSize = Math.max(12, Math.floor(16 * scaleFactor));
    const dateFontSize = Math.max(8, Math.floor(12 * scaleFactor));
    
    // Line heights in points, convert to mm for positioning
    const lineHeightPt = productFontSize * 1.2;
    const lineHeightMm = lineHeightPt / MM_TO_PT;
    const productBaselineOffsetPt = productFontSize * 0.3;
    const productBaselineOffsetMm = productBaselineOffsetPt / MM_TO_PT;
    
    const availableWidthMm = widthMm * 0.9;
    const productLines = wrapText(doc, productName, availableWidthMm, 'helvetica', productFontSize, 3);
    
    const productTextHeightMm = productLines.length * lineHeightMm;
    
    const verticalPaddingMm = heightMm * 0.1;
    const usableHeightMm = heightMm - (2 * verticalPaddingMm);
    
    let productNameYReportLabMm: number;
    let dateYReportLabMm: number;
    
    if (includeDate) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(dateFontSize);
      const dateTextHeightPt = dateFontSize * 1.2;
      const dateTextHeightMm = dateTextHeightPt / MM_TO_PT;
      const dateBaselineOffsetPt = dateFontSize * 0.3;
      const dateBaselineOffsetMm = dateBaselineOffsetPt / MM_TO_PT;
      const spacingMm = usableHeightMm * 0.1;
      
      const contentCenterYMm = verticalPaddingMm + usableHeightMm / 2;
      const productCenterYMm = contentCenterYMm - (dateTextHeightMm + spacingMm) / 2;
      productNameYReportLabMm = productCenterYMm - productBaselineOffsetMm;
      
      const dateCenterYMm = contentCenterYMm + (productTextHeightMm + spacingMm) / 2;
      dateYReportLabMm = dateCenterYMm - dateBaselineOffsetMm;
    } else {
      const centerYMm = verticalPaddingMm + usableHeightMm / 2;
      productNameYReportLabMm = centerYMm - productBaselineOffsetMm;
    }
    
    // Convert from ReportLab coordinate system (bottom-left origin) to jsPDF (top-left origin)
    // jsPDF: y = 0 at top, increases downward (in mm)
    // ReportLab: y = 0 at bottom, increases upward (in mm)
    // Conversion: y_jsPDF_mm = height_mm - y_ReportLab_mm
    const productNameYMm = heightMm - productNameYReportLabMm;
    const dateYMm = includeDate ? heightMm - dateYReportLabMm : 0;
    
    // Draw product name lines
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(productFontSize);
    const totalLinesHeightMm = productLines.length * lineHeightMm;
    const topLineYReportLabMm = productNameYReportLabMm + (totalLinesHeightMm - lineHeightMm) / 2;
    const topLineYMm = heightMm - topLineYReportLabMm;
    
    for (let i = 0; i < productLines.length; i++) {
      const line = productLines[i];
      const lineWidthMm = doc.getTextWidth(line); // Returns mm when unit is 'mm'
      const lineXMm = xOffsetMm + (widthMm - lineWidthMm) / 2;
      // For multi-line text, lines are drawn from top to bottom
      // In ReportLab: topLineY - (i * lineHeight) means first line is at topLineY, subsequent lines below
      // In jsPDF: we need to add (i * lineHeight) to go downward
      const lineYMm = topLineYMm + (i * lineHeightMm);
      doc.text(line, lineXMm, lineYMm);
    }
    
    // Draw date
    if (includeDate) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(dateFontSize);
      const dateTextWidthMm = doc.getTextWidth(currentDate); // Returns mm when unit is 'mm'
      const dateXMm = xOffsetMm + (widthMm - dateTextWidthMm) / 2;
      doc.text(currentDate, dateXMm, dateYMm);
    }
  }
};

/**
 * Create label PDF based on size
 * All dimensions are in millimeters
 */
export const createLabelPdf = (
  productName: string,
  labelSize: LabelSize,
  includeDate: boolean = true
): jsPDF => {
  let doc: jsPDF;
  let widthMm: number;
  let heightMm: number;
  
  if (labelSize === '48x25mm') {
    widthMm = 48;
    heightMm = 25;
    doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [48, 25]
    });
    drawSingleLabel(doc, productName, widthMm, heightMm, 0, includeDate);
  } else if (labelSize === '96x25mm') {
    widthMm = 96;
    heightMm = 25;
    doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [96, 25]
    });
    // Draw two identical labels side by side
    const labelWidthMm = 48;
    drawSingleLabel(doc, productName, labelWidthMm, heightMm, 0, includeDate);
    drawSingleLabel(doc, productName, labelWidthMm, heightMm, labelWidthMm, includeDate);
  } else if (labelSize === '50x100mm') {
    widthMm = 50;
    heightMm = 100;
    doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [50, 100]
    });
    drawSingleLabel(doc, productName, widthMm, heightMm, 0, includeDate);
  } else if (labelSize === '100x50mm') {
    widthMm = 100;
    heightMm = 50;
    doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [100, 50]
    });
    drawSingleLabel(doc, productName, widthMm, heightMm, 0, includeDate);
  } else {
    // Default to 48x25mm
    widthMm = 48;
    heightMm = 25;
    doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [48, 25]
    });
    drawSingleLabel(doc, productName, widthMm, heightMm, 0, includeDate);
  }
  
  return doc;
};

/**
 * Create a pair label PDF (96x25mm) with two product names side-by-side
 * Each product gets 48mm width (half of 96mm)
 * All dimensions are in millimeters
 */
export const createPairLabelPdf = (
  product1: string | null,
  product2: string | null,
  includeDate: boolean = false
): jsPDF | null => {
  if (!product1 && !product2) {
    return null;
  }

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [COMBINED_WIDTH, COMBINED_HEIGHT] // 96mm × 25mm
  });

  const marginMm = 2;
  const labelWidthMm = 48; // Each label is 48mm wide
  const heightMm = COMBINED_HEIGHT; // 25mm

  // Left label (Product 1)
  if (product1) {
    drawSingleLabel(doc, product1, labelWidthMm, heightMm, marginMm, includeDate);
  }

  // Right label (Product 2)
  if (product2) {
    const rightLabelXMm = labelWidthMm + marginMm;
    drawSingleLabel(doc, product2, labelWidthMm, heightMm, rightLabelXMm, includeDate);
  }

  // Draw separator line between the two labels
  // Note: jsPDF uses top-left origin, so Y coordinates need to be inverted
  // In ReportLab: line goes from margin (bottom) to COMBINED_HEIGHT - margin (bottom)
  // In jsPDF: line goes from COMBINED_HEIGHT - margin (top) to margin (top)
  // All coordinates are in mm
  doc.setLineWidth(0.1);
  doc.setDrawColor(200, 200, 200);
  const lineYTopMm = heightMm - marginMm; // margin from bottom in ReportLab = height - margin from top in jsPDF
  const lineYBottomMm = marginMm; // COMBINED_HEIGHT - margin from bottom in ReportLab = margin from top in jsPDF
  doc.line(labelWidthMm, lineYTopMm, labelWidthMm, lineYBottomMm);

  return doc;
};

/**
 * Generate product labels for a list of products
 * Processes products in pairs (2 labels per page) and combines into single PDF
 */
export const generateProductLabelsPdf = async (
  productNames: string[],
  includeDate: boolean = false
): Promise<Uint8Array | null> => {
  if (productNames.length === 0) {
    return null;
  }

  const combinedPdf = await PDFDocument.create();
  const labelPages: jsPDF[] = [];

  // Generate individual pair label pages
  for (let i = 0; i < productNames.length; i += 2) {
    const product1 = productNames[i] || null;
    const product2 = i + 1 < productNames.length ? productNames[i + 1] : null;
    
    const pairLabel = createPairLabelPdf(product1, product2, includeDate);
    if (pairLabel) {
      labelPages.push(pairLabel);
    }
  }

  // Combine all pages into single PDF using pdf-lib
  for (const labelPage of labelPages) {
    const labelBytes = labelPage.output('arraybuffer');
    const labelDoc = await PDFDocument.load(labelBytes);
    const [copiedPage] = await combinedPdf.copyPages(labelDoc, [0]);
    combinedPdf.addPage(copiedPage);
  }

  return await combinedPdf.save();
};

