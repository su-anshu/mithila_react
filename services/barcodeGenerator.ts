import JsBarcode from 'jsbarcode';
import { PDFDocument, rgb } from 'pdf-lib';
import { MM_TO_PT } from '../constants';

/**
 * Generate Code 128A barcode image (Amazon standard) with high-DPI quality
 * 
 * Uses high-resolution canvas (400 DPI equivalent) for crisp barcode output
 */
export const generateBarcodeImage = (fnskuCode: string, highDpi: boolean = true): HTMLCanvasElement => {
  // For high-DPI, create a larger canvas and scale down
  // 400 DPI = ~5.56x scale factor (400/72)
  const dpiScale = highDpi ? 400 / 72 : 1;
  
  // Create high-resolution canvas
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) {
    throw new Error('Could not get canvas context');
  }
  
  // Generate barcode at high resolution
  // Module width: 0.12mm equivalent -> adjust jsbarcode width for high DPI
  // Height: 5.5mm equivalent -> adjust jsbarcode height for high DPI
  // Font size: 4.5pt equivalent -> adjust for high DPI
  JsBarcode(tempCanvas, fnskuCode, {
    format: 'CODE128',
    width: highDpi ? 0.12 * dpiScale : 1, // Thinner bars for high-DPI clarity
    height: highDpi ? 5.5 * dpiScale : 50, // Taller for better definition at high DPI
    displayValue: true,
    fontSize: highDpi ? 4.5 * dpiScale : 12, // Larger font for clarity at high DPI
    margin: highDpi ? 0.3 * dpiScale : 5, // Tighter margins for high resolution
    textDistance: highDpi ? 3 * dpiScale : 4, // Better spacing for high DPI
    background: '#ffffff',
    lineColor: '#000000'
  });
  
  // If high-DPI, scale down to target size with better quality
  if (highDpi) {
    // Calculate target size (maintain aspect ratio)
    const targetWidth = tempCanvas.width / dpiScale;
    const targetHeight = tempCanvas.height / dpiScale;
    
    // Create final canvas at target size
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetWidth;
    finalCanvas.height = targetHeight;
    
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) {
      throw new Error('Could not get canvas context');
    }
    
    // Use high-quality image scaling (bicubic interpolation)
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    finalCtx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
    
    return finalCanvas;
  }
  
  return tempCanvas;
};

/**
 * Generate barcode PDF (48mm x 25mm) with high-DPI quality
 * 
 * Uses 400 DPI equivalent for ultra-crisp barcode output matching Streamlit implementation
 */
export const generateBarcodePDF = async (
  fnskuCode: string,
  widthMm: number = 48,
  heightMm: number = 25
): Promise<Uint8Array> => {
  console.log(`Generating Code 128A barcode for FNSKU: ${fnskuCode}`);
  
  // Generate high-DPI barcode image
  const canvas = generateBarcodeImage(fnskuCode, true);
  
  // Convert canvas to high-quality PNG data
  const imageData = canvas.toDataURL('image/png');
  
  // Create PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthMm * MM_TO_PT, heightMm * MM_TO_PT]);
  
  // Load image
  const image = await pdfDoc.embedPng(imageData);
  
  // Calculate dimensions to fit in label while maintaining aspect ratio
  // Use optimized sizing: 85% canvas, 80% width, 70% height for barcode (matching Streamlit)
  const imageAspect = image.width / image.height;
  const labelAspect = (widthMm * MM_TO_PT) / (heightMm * MM_TO_PT);
  
  let drawWidth: number;
  let drawHeight: number;
  let x: number;
  let y: number;
  
  if (imageAspect > labelAspect) {
    // Image is wider - fit to width with 80% sizing
    drawWidth = widthMm * MM_TO_PT * 0.80; // 80% width - smaller size
    drawHeight = drawWidth / imageAspect;
    x = (widthMm * MM_TO_PT - drawWidth) / 2;
    y = (heightMm * MM_TO_PT - drawHeight) / 2;
  } else {
    // Image is taller - fit to height with 70% sizing
    drawHeight = heightMm * MM_TO_PT * 0.70; // 70% height - smaller size
    drawWidth = drawHeight * imageAspect;
    x = (widthMm * MM_TO_PT - drawWidth) / 2;
    y = (heightMm * MM_TO_PT - drawHeight) / 2;
  }
  
  // Draw barcode centered on canvas
  page.drawImage(image, {
    x,
    y,
    width: drawWidth,
    height: drawHeight
  });
  
  // Generate PDF bytes
  const pdfBytes = await pdfDoc.save();
  console.log(`Successfully generated Code 128A barcode for ${fnskuCode}`);
  return new Uint8Array(pdfBytes);
};

/**
 * Generate barcode PDF for vertical layout (50mm x 25mm)
 */
export const generateBarcodePDFVertical = async (
  fnskuCode: string
): Promise<Uint8Array> => {
  return generateBarcodePDF(fnskuCode, 50, 25);
};

