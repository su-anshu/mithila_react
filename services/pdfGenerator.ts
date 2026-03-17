import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';
import { addMonths, addDays, format, isValid, parseISO } from 'date-fns';
import { MasterProduct, NutritionData } from '../types';
import {
  LABEL_WIDTH, LABEL_HEIGHT,
  COMBINED_WIDTH, COMBINED_HEIGHT,
  TRIPLE_WIDTH, TRIPLE_HEIGHT
} from '../constants';
import { isEmptyValue } from './utils';

// Font data cache to avoid reloading fonts (cache the base64 data)
const fontCache: Record<string, string> = {};
let fontCacheLoading: Record<string, Promise<string>> = {};

// --- Font Loading Utilities ---

/**
 * Convert font file to base64 string
 * Tries multiple paths to find the font file
 * Caches the result to avoid re-fetching
 */
const fontToBase64 = async (fontName: string): Promise<string> => {
  // Return cached font if available
  if (fontCache[fontName]) {
    return fontCache[fontName];
  }

  // If already loading, wait for that promise
  if (fontCacheLoading[fontName]) {
    return fontCacheLoading[fontName];
  }

  // Start loading the font
  const loadPromise = (async () => {
    // Try multiple possible paths
    const possiblePaths = [
      `/fonts/${fontName}`,
      `/public/fonts/${fontName}`,
      `./fonts/${fontName}`,
      `fonts/${fontName}`
    ];

    for (const fontPath of possiblePaths) {
      try {
        const response = await fetch(fontPath);
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              // Remove data URL prefix if present
              const base64Data = result.includes(',') ? result.split(',')[1] : result;
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          // Cache the result
          fontCache[fontName] = base64;
          return base64;
        }
      } catch (error) {
        // Try next path
        continue;
      }
    }

    throw new Error(`Could not load font ${fontName} from any path`);
  })();

  fontCacheLoading[fontName] = loadPromise;

  try {
    const result = await loadPromise;
    delete fontCacheLoading[fontName];
    return result;
  } catch (error) {
    delete fontCacheLoading[fontName];
    throw error;
  }
};

/**
 * Register custom fonts with jsPDF
 * IMPORTANT: jsPDF requires fonts to be registered on EACH document instance
 * This function registers fonts on the provided document and caches font data
 */
export const registerCustomFonts = async (doc: jsPDF): Promise<boolean> => {
  let helveticaBlackRegistered = false;

  try {
    // Load and register Helvetica-Black (most important for nutrition title)
    try {
      const helveticaBlackBase64 = await fontToBase64('Helvetica-Black.ttf');
      doc.addFileToVFS('Helvetica-Black.ttf', helveticaBlackBase64);
      doc.addFont('Helvetica-Black.ttf', 'Helvetica-Black', 'normal');
      helveticaBlackRegistered = true;
      console.log('Helvetica-Black font registered successfully on document');
    } catch (e) {
      console.warn('Could not load Helvetica-Black, will use Helvetica-Bold as fallback:', e);
    }

    // Load and register Helvetica-Bold (optional - can use built-in)
    try {
      const helveticaBoldBase64 = await fontToBase64('Helvetica-Bold.ttf');
      doc.addFileToVFS('Helvetica-Bold.ttf', helveticaBoldBase64);
      doc.addFont('Helvetica-Bold.ttf', 'Helvetica-Bold', 'normal');
    } catch (e) {
      // Built-in Helvetica-Bold will be used - this is fine
    }

    // Load and register Helvetica Regular (optional - can use built-in)
    try {
      const helveticaBase64 = await fontToBase64('Helvetica.ttf');
      doc.addFileToVFS('Helvetica.ttf', helveticaBase64);
      doc.addFont('Helvetica.ttf', 'Helvetica', 'normal');
    } catch (e) {
      // Built-in Helvetica will be used - this is fine
    }

    return helveticaBlackRegistered;
  } catch (error) {
    console.error('Error registering custom fonts:', error);
    return false;
  }
};

// --- Helper Functions ---

const sanitizeValue = (val: any, fallback = "N/A"): string => {
  if (isEmptyValue(val)) return fallback;
  return String(val).trim();
};

export const formatValue = (val: any): string => {
  if (val === undefined || val === null || val === '') return "0";
  const num = parseFloat(String(val));
  if (isNaN(num)) return "0";
  // If integer, return as string (e.g. 5)
  if (Number.isInteger(num)) return num.toString();
  // If float, keep 1 decimal place but remove trailing .0 (e.g. 5.1, 5.0 -> 5)
  return num.toFixed(1).replace(/\.0$/, '');
};

export const formatNutrient = (val: string | number | undefined, unit: string): string => {
  const formattedVal = formatValue(val);
  // Check if unit already exists in the raw value
  if (String(val).toLowerCase().endsWith(unit.toLowerCase())) return String(val);
  return `${formattedVal}${unit}`;
};

export const parseExpiry = (expiryValue: string | undefined): Date => {
  const today = new Date();
  const defaultDate = addMonths(today, 6); // Default 6 months

  if (!expiryValue) return defaultDate;

  try {
    // Handle numeric values (integers or floats) - treat as months
    if (typeof expiryValue === 'number' || (typeof expiryValue === 'string' && /^\d+\.?\d*$/.test(expiryValue.trim()))) {
      const months = Math.floor(parseFloat(String(expiryValue)));
      if (!isNaN(months) && months > 0) {
        return addMonths(today, months);
      }
    }

    const s = String(expiryValue).trim();
    if (s === '') return defaultDate;

    // Pure number in string -> months
    if (/^\d+$/.test(s)) {
      return addMonths(today, parseInt(s, 10));
    }

    const sLower = s.toLowerCase();

    // Patterns like '2 months', '3 mo', '90 days'
    const monthMatch = sLower.match(/(\d+)\s*(months?|mos?|mo|m)\b/);
    if (monthMatch) {
      return addMonths(today, parseInt(monthMatch[1], 10));
    }

    const dayMatch = sLower.match(/(\d+)\s*(days?|d)\b/);
    if (dayMatch) {
      return addDays(today, parseInt(dayMatch[1], 10));
    }

    // Try ISO date parsing first
    try {
      const isoParsed = parseISO(s);
      if (isValid(isoParsed)) {
        // If parsed date is before today and same year, assume year-less string -> pick next occurrence
        if (isoParsed.getFullYear() === today.getFullYear() && isoParsed < today) {
          return new Date(isoParsed.getFullYear() + 1, isoParsed.getMonth(), isoParsed.getDate());
        }
        return isoParsed;
      }
    } catch (e) {
      // Continue to other parsing methods
    }

    // Try JS Date parse for other formats (DD/MM/YYYY, MM/DD/YYYY, etc.)
    const jsDate = new Date(s);
    if (isValid(jsDate) && !isNaN(jsDate.getTime())) {
      // If parsed date is before today and same year, assume year-less string -> pick next occurrence
      if (jsDate.getFullYear() === today.getFullYear() && jsDate < today) {
        return new Date(jsDate.getFullYear() + 1, jsDate.getMonth(), jsDate.getDate());
      }
      return jsDate;
    }

    // Try parsing common date formats manually (e.g., "21 Aug", "Aug 21")
    const dateFormats = [
      /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})?/i,
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})?/i
    ];

    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    for (const format of dateFormats) {
      const match = s.match(format);
      if (match) {
        let day: number, month: number, year: number;

        if (format === dateFormats[0]) {
          // "21 Aug" or "21 Aug 2024"
          day = parseInt(match[1], 10);
          const monthName = match[2].toLowerCase().substring(0, 3);
          month = monthNames.indexOf(monthName);
          year = match[3] ? parseInt(match[3], 10) : today.getFullYear();
        } else {
          // "Aug 21" or "Aug 21, 2024"
          const monthName = match[1].toLowerCase().substring(0, 3);
          month = monthNames.indexOf(monthName);
          day = parseInt(match[2], 10);
          year = match[3] ? parseInt(match[3], 10) : today.getFullYear();
        }

        if (month >= 0 && day > 0 && day <= 31) {
          const parsedDate = new Date(year, month, day);
          if (isValid(parsedDate)) {
            // If year-less date and before today, pick next occurrence
            if (!match[3] && parsedDate < today) {
              return new Date(year + 1, month, day);
            }
            return parsedDate;
          }
        }
      }
    }

    return defaultDate;
  } catch (e) {
    console.warn(`Error parsing expiry value "${expiryValue}": ${String(e)}`);
    return defaultDate;
  }
};

export const generateBatchCode = (name: string, dateCode: string): string => {
  const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const prefix = cleanName.substring(0, 2) || "XX";
  const random = Math.floor(Math.random() * 999) + 1;
  return `${prefix}${dateCode}${String(random).padStart(3, '0')}`;
};

const createBarcodeDataUrl = (text: string, showText: boolean = true): string => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, text, {
    format: "CODE128",
    width: 2,
    height: 50, // Reduced height for better fit
    displayValue: showText, // Allow control over text display
    fontSize: 10, // Smaller font for barcode text
    margin: 0,
    background: "#ffffff"
  });
  return canvas.toDataURL("image/png");
};

// Helper for allergen - Enhanced with position-based fallback
export function extractAllergenFromRow(row: NutritionData): string {
  // Method 1: Exact match "Allergen Info"
  if (row["Allergen Info"]) {
    const value = String(row["Allergen Info"]).trim();
    if (value && value.toLowerCase() !== 'nan' && value.toLowerCase() !== 'n/a') {
      console.log("Found allergen info using exact match 'Allergen Info'");
      return value;
    }
  }

  // Method 2: Case-insensitive partial match (contains "allergen")
  const keys = Object.keys(row);
  for (const col of keys) {
    if (col.toLowerCase().includes("allergen")) {
      const value = String(row[col] || "").trim();
      if (value && value.toLowerCase() !== 'nan' && value.toLowerCase() !== 'n/a') {
        console.log(`Found allergen info using column: ${col}`);
        return value;
      }
    }
  }

  // Method 3: Position-based fallback - access column at index 3 (column D)
  try {
    if (keys.length > 3) {
      const columnName = keys[3];
      const value = String(row[columnName] || "").trim();
      if (value && value.toLowerCase() !== 'nan' && value.toLowerCase() !== 'n/a') {
        console.log(`Found allergen info using column D (index 3): ${columnName}`);
        return value;
      }
    }
  } catch (e) {
    console.debug(`Could not access column D by position: ${String(e)}`);
  }

  // Log available columns for debugging
  console.warn(`Allergen column not found. Available columns: ${keys.join(', ')}`);
  return "";
}

// --- Generators ---

export const generateMRPLabel = (product: MasterProduct): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [LABEL_WIDTH, LABEL_HEIGHT]
  });

  const name = product['item_name_for_labels'] || product.Name || 'Unknown';
  const weight = product['Net Weight'] || 'N/A';
  const mrpRaw = product['M.R.P'] || product.MRP;
  const mrp = mrpRaw ? `INR ${Math.round(parseFloat(mrpRaw))}` : 'INR N/A';
  const fssaiRaw = product['M.F.G. FSSAI'] || product.FSSAI;
  const fssai = fssaiRaw ? String(Math.round(parseFloat(fssaiRaw))) : 'N/A';

  const today = new Date();
  const mfgDate = format(today, 'dd MMM yyyy').toUpperCase();
  const dateCode = format(today, 'ddMMyy');

  const expiryVal = product['Expiry '] || product.Expiry || product.EXPIRY || product['Shelf Life'] || product.Shelf_Life || product.ShelfLife || product['Expiry Months'];
  const useByDate = parseExpiry(expiryVal);
  const useByStr = format(useByDate, 'dd MMM yyyy').toUpperCase();

  const batchCode = generateBatchCode(name, dateCode);

  // Equal margins: 2mm on all sides
  const margin = 2;
  const lineSpacing = 3.2; // Spacing between lines
  const numLines = 6;
  const approximateLineHeight = 2.5; // Approximate text height for font size 6

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);

  // Calculate total content block height and center it vertically for equal top/bottom spacing
  // Total height = (numLines - 1) * lineSpacing + approximateLineHeight
  const totalContentHeight = (numLines - 1) * lineSpacing + approximateLineHeight;
  const availableHeight = LABEL_HEIGHT - (margin * 2); // 25 - 4 = 21mm
  const topSpace = (availableHeight - totalContentHeight) / 2;
  const firstLineY = margin + topSpace + (approximateLineHeight / 2); // Center text vertically

  doc.text(`Name: ${name.substring(0, 35)}`, margin, firstLineY);
  doc.text(`Net Weight: ${weight} Kg`, margin, firstLineY + lineSpacing);
  doc.text(`M.R.P: ${mrp}`, margin, firstLineY + (lineSpacing * 2));
  doc.text(`M.F.G: ${mfgDate} | USE BY: ${useByStr}`, margin, firstLineY + (lineSpacing * 3));
  doc.text(`Batch Code: ${batchCode}`, margin, firstLineY + (lineSpacing * 4));
  doc.text(`M.F.G FSSAI: ${fssai}`, margin, firstLineY + (lineSpacing * 5));

  return doc;
};

export const generateBarcodeLabel = (fnsku: string): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [LABEL_WIDTH, LABEL_HEIGHT]
  });

  if (!fnsku) {
    doc.setFontSize(8);
    doc.text("No FNSKU", 2, 12);
    return doc;
  }

  // Use same barcode size and style as combined label
  const barcodeW = 35; // Matching combined label width
  const barcodeH = 10; // Matching combined label height

  // Create barcode WITHOUT text (we'll add it manually for better control, matching combined label style)
  const imgData = createBarcodeDataUrl(fnsku, false);

  // Center the barcode horizontally in the 48mm wide label
  // Center position: 48 / 2 = 24mm
  // Barcode start: 24 - (35/2) = 24 - 17.5 = 6.5mm
  const barcodeX = (LABEL_WIDTH / 2) - (barcodeW / 2); // Horizontally centered
  const barcodeY = 5; // Matching combined label vertical position

  doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeW, barcodeH);

  // Add FNSKU text below barcode manually with same font size and spacing as combined label
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7); // Matching combined label font size
  // Center text below barcode at the center of the barcode
  doc.text(fnsku, barcodeX + (barcodeW / 2), barcodeY + barcodeH + 3.5, { align: 'center' }); // 2.5mm spacing matching combined label

  return doc;
};

export const generateCombinedLabelHorizontal = (product: MasterProduct): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [COMBINED_WIDTH, COMBINED_HEIGHT]
  });

  const name = product['item_name_for_labels'] || product.Name || 'Unknown';
  const weight = product['Net Weight'] || 'N/A';
  const mrpRaw = product['M.R.P'] || product.MRP;
  const mrp = mrpRaw ? `INR ${Math.round(parseFloat(mrpRaw))}` : 'INR N/A';
  const fssaiRaw = product['M.F.G. FSSAI'] || product.FSSAI;
  const fssai = fssaiRaw ? String(Math.round(parseFloat(fssaiRaw))) : 'N/A';
  const today = new Date();
  const mfgDate = format(today, 'dd MMM yyyy').toUpperCase();
  const dateCode = format(today, 'ddMMyy');
  const expiryVal = product['Expiry '] || product.Expiry || product.EXPIRY || product['Shelf Life'] || product.Shelf_Life || product.ShelfLife || product['Expiry Months'];
  const useByDate = parseExpiry(expiryVal);
  const useByStr = format(useByDate, 'dd MMM yyyy').toUpperCase();
  const batchCode = generateBatchCode(name, dateCode);

  // Equal margins: 2mm on all sides
  const margin = 2;
  const lineSpacing = 3.2; // Spacing between lines
  const numLines = 6;
  const approximateLineHeight = 2.5; // Approximate text height for font size 6

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);

  // Left: MRP content
  // Calculate total content block height and center it vertically for equal top/bottom spacing
  // Total height = (numLines - 1) * lineSpacing + approximateLineHeight
  const totalContentHeight = (numLines - 1) * lineSpacing + approximateLineHeight;
  const availableHeight = COMBINED_HEIGHT - (margin * 2); // 25 - 4 = 21mm
  const topSpace = (availableHeight - totalContentHeight) / 2;
  const firstLineY = margin + topSpace + (approximateLineHeight / 2); // Center text vertically

  doc.text(`Name: ${name.substring(0, 35)}`, margin, firstLineY);
  doc.text(`Net Weight: ${weight} Kg`, margin, firstLineY + lineSpacing);
  doc.text(`M.R.P: ${mrp}`, margin, firstLineY + (lineSpacing * 2));
  doc.text(`M.F.G: ${mfgDate} | USE BY: ${useByStr}`, margin, firstLineY + (lineSpacing * 3));
  doc.text(`Batch Code: ${batchCode}`, margin, firstLineY + (lineSpacing * 4));
  doc.text(`M.F.G FSSAI: ${fssai}`, margin, firstLineY + (lineSpacing * 5));

  // Right: Barcode content
  const fnsku = product.FNSKU;
  if (fnsku) {
    // Create barcode WITHOUT text (we'll add it manually for better control, matching triple label style)
    const barcodeW = 35; // Barcode width
    const barcodeH = 10; // Barcode height
    const imgData = createBarcodeDataUrl(fnsku, false);

    // Center the barcode horizontally in the right half (48mm wide section, starting at 48mm)
    // Right section center: 48 + (48/2) = 72mm
    // Barcode start position: 72 - (barcodeW/2) = 72 - 17.5 = 54.5mm
    const barcodeX = 48 + (48 / 2) - (barcodeW / 2); // Horizontally centered in right section

    // Vertically center barcode+text block with equal margins (2mm top, 2mm bottom)
    // Label height: 25mm, margin: 2mm each side = 21mm content area
    // Block height: barcodeH (10mm) + spacing (2.5mm) + text height (~2mm) = ~14.5mm
    const textSpacing = 2.5;
    const textHeight = 2; // Approximate text height for font size 7
    const blockHeight = barcodeH + textSpacing + textHeight;
    // Center the entire block vertically
    const barcodeY = margin + ((COMBINED_HEIGHT - (margin * 2) - blockHeight) / 2);

    doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeW, barcodeH);

    // Add FNSKU text below barcode manually with larger font size and proper spacing (matching triple label)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7); // Matching triple label font size
    // Center text below barcode at the center of the barcode
    doc.text(fnsku, barcodeX + (barcodeW / 2), barcodeY + barcodeH + textSpacing, { align: 'center' }); // 2.5mm spacing matching triple label
  } else {
    doc.text("No FNSKU", 52, 12);
  }

  return doc;
};

export const generateTripleLabel = async (product: MasterProduct, nutrition: NutritionData): Promise<jsPDF> => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [TRIPLE_WIDTH, TRIPLE_HEIGHT]
  });

  // Register custom fonts on this document instance (required for each new jsPDF instance)
  const helveticaBlackAvailable = await registerCustomFonts(doc);

  const startX = 2;
  const endX = TRIPLE_WIDTH - 2;
  const contentWidth = TRIPLE_WIDTH - 4; // 46mm
  let cursorY = 4;

  const productName = product['item_name_for_labels'] || product.Name || 'Unknown';

  // --- 1. Top Section: Title & Ingredients ---

  // Title (Bold, Larger)
  doc.setFont("Helvetica-Black", "normal");
  doc.setFontSize(7);
  const titleLines = doc.splitTextToSize(productName, contentWidth);
  doc.text(titleLines, TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += (titleLines.length * 1.5) + 2;

  // Function to draw labeled paragraph: "Label: Text..." with mixed styles
  const drawLabeledParagraph = (label: string, text: string, y: number): number => {
    // We will treat the whole block as standard text to simplify and ensure wrapping works perfectly
    // JSPDF mixed style wrapping is tricky. 
    // Strategy: Print label bold, then print text normal starting after label width

    doc.setFont("helvetica", "bold");
    doc.setFontSize(5); // Reduced from 6 to match Python 5pt
    doc.text(label, startX, y);

    const labelWidth = doc.getTextWidth(label);

    doc.setFont("helvetica", "normal");

    const words = text.split(' ');
    let line = "";
    let currentY = y;
    let currentX = startX + labelWidth;

    // Safety check for space
    const spaceWidth = doc.getTextWidth(" ");

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordWidth = doc.getTextWidth(word);

      // Check if word fits on current line
      if (currentX + wordWidth <= endX) {
        doc.text(word, currentX, currentY);
        currentX += wordWidth + spaceWidth;
      } else {
        // New line
        currentY += 2.2; // Line height for 5pt font
        currentX = startX;
        doc.text(word, currentX, currentY);
        currentX += wordWidth + spaceWidth;
      }
    }
    return currentY + 2.5; // Bottom margin
  };

  const ingredientsText = nutrition.Ingredients || "N/A";
  cursorY = drawLabeledParagraph("Ingredients: ", ingredientsText, cursorY);

  const allergen = nutrition["Allergen Info"] || extractAllergenFromRow(nutrition);
  if (allergen) {
    cursorY = drawLabeledParagraph("Allergen Info: ", allergen, cursorY);
  } else {
    cursorY += 1;
  }

  // Separator
  doc.setLineWidth(0.2);
  doc.line(2, cursorY, 48, cursorY);
  cursorY += 3; // Add more space after separator line

  // --- 2. Nutrition Section ---

  // Title - Use Helvetica-Black at 5pt (matching Python)
  // Use Helvetica-Black if successfully registered, otherwise fallback to bold
  if (helveticaBlackAvailable) {
    try {
      doc.setFont("Helvetica-Black", "normal");
    } catch (e) {
      // If setFont fails even though registration succeeded, fallback
      console.warn('Helvetica-Black registration succeeded but setFont failed, using bold fallback');
      doc.setFont("helvetica", "bold");
    }
  } else {
    // Font not available, use bold fallback
    doc.setFont("helvetica", "bold");
  }
  doc.setFontSize(5.5);
  doc.text("Nutritional Facts Per 100g (Approx Values)", TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 3.5; // Increased spacing between title and serving size for better readability

  // Serving Size
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  const servingSize = nutrition["Serving Size"] || "30g";
  doc.text(`Serving size ${servingSize}`, TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 2.5;

  // Serving Info (Small)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(3.5);
  doc.text("Number of servings may vary based on pack size and intended use", TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 3; // Reduced from 3mm to 2.5mm

  // Energy
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(`Energy Value - ${formatValue(nutrition.Energy || 345)} Kcal`, TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 2.5; // Reduced from 3mm to 2.5mm

  // Nutrient Grid (4 columns)
  // Python used: Total Fat, Sat Fat, Trans Fat, Cholesterol in Row 1
  const colW = contentWidth / 4; // 11.5mm
  const rowSpacing = 6;

  // Calculate column centers: col1_x = 2 + (46/4) * 0.5, col2_x = 2 + (46/4) * 1.5, etc.
  const col1X = startX + colW * 0.5;
  const col2X = startX + colW * 1.5;
  const col3X = startX + colW * 2.5;
  const col4X = startX + colW * 3.5;

  const drawNutrient = (label: string, val: string | number | undefined, unit: string, colX: number, rowY: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.5); // Header size
    doc.text(label, colX, rowY, { align: 'center' });

    doc.setFontSize(6); // Value size
    const valueStr = formatNutrient(val, unit);
    doc.text(valueStr, colX, rowY + 2.5, { align: 'center' });
  };

  // Row 1
  const row1Y = cursorY;
  drawNutrient("Total Fat", nutrition["Total Fat"], "g", col1X, row1Y);
  drawNutrient("Saturated Fat", nutrition["Saturated Fat"], "g", col2X, row1Y);
  drawNutrient("Trans Fat", nutrition["Trans Fat"], "g", col3X, row1Y);
  drawNutrient("Cholesterol", nutrition.Cholesterol, "mg", col4X, row1Y);

  // Row 2
  const row2Y = row1Y + rowSpacing;
  drawNutrient("Total Carbs", nutrition["Total Carbohydrate"], "g", col1X, row2Y);
  drawNutrient("Dietary Fibers", nutrition["Dietary Fiber"], "g", col2X, row2Y);
  drawNutrient("Total Sugars", nutrition["Total Sugars"], "g", col3X, row2Y);
  drawNutrient("Added Sugars", nutrition["Added Sugars"], "g", col4X, row2Y);

  // Row 3 (Sodium, Protein) - only in columns 1 and 2
  const row3Y = row2Y + rowSpacing;
  drawNutrient("Sodium", nutrition["Sodium(mg)"], "mg", col1X, row3Y);
  drawNutrient("Protein", nutrition.Protein, "g", col2X, row3Y);

  cursorY = row3Y + rowSpacing + 1; // Extra space before disclaimer

  // Disclaimer - left-aligned from startX, matching Python positioning
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4);
  const disclaimer = "* The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet.";
  const splitDisc = doc.splitTextToSize(disclaimer, contentWidth);
  // Left-align from startX instead of centering
  for (let i = 0; i < splitDisc.length; i++) {
    doc.text(splitDisc[i], TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
    cursorY += 1.5; // Line spacing
  }
  cursorY += 0.5;

  // Separator
  doc.setLineWidth(0.2);
  doc.line(2, cursorY, 48, cursorY);
  cursorY += 4; // Add more space after separator line before MRP section

  // --- 3. Bottom Section (MRP etc) ---

  // All fields bold, left aligned
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  const lineHeight = 2.7;

  const mrpRaw = product['M.R.P'] || product.MRP;
  const mrp = mrpRaw ? `INR ${Math.round(parseFloat(mrpRaw))}` : 'INR N/A';

  const expiryVal = product['Expiry '] || product.Expiry || product.EXPIRY || product['Shelf Life'];
  const useByDate = parseExpiry(expiryVal);
  const useByStr = format(useByDate, 'dd MMM yyyy').toUpperCase();
  const mfgDate = format(new Date(), 'dd MMM yyyy').toUpperCase();

  const batchCode = generateBatchCode(productName, format(new Date(), 'ddMMyy'));
  const fssaiRaw = product['M.F.G. FSSAI'] || product.FSSAI;

  const nameLines = doc.splitTextToSize(`Name: ${productName}`, contentWidth);
  doc.text(nameLines, startX, cursorY);
  cursorY += (nameLines.length * lineHeight);

  doc.text(`Net Weight: ${product['Net Weight'] || 'N/A'} Kg`, startX, cursorY);
  cursorY += lineHeight;

  doc.text(`M.R.P: ${mrp}`, startX, cursorY);
  cursorY += lineHeight;

  // Combine M.F.G and USE BY on same line with vertical separator
  doc.text(`M.F.G: ${mfgDate} | USE BY: ${useByStr}`, startX, cursorY);
  cursorY += lineHeight;

  doc.text(`Batch Code: ${batchCode}`, startX, cursorY);
  cursorY += lineHeight;

  if (fssaiRaw) {
    doc.text(`M.F.G FSSAI: ${fssaiRaw}`, startX, cursorY);
    cursorY += lineHeight;
  }

  // Barcode
  // Position barcode closer to MRP section with minimal gap
  const fnsku = product.FNSKU;
  if (fnsku) {
    // Calculate space needed for barcode
    const barcodeH = 10;
    const barcodeTextH = 2.5; // Space for FNSKU text below barcode (slightly more for larger font)
    const barcodeTotalH = barcodeH + barcodeTextH;

    // Position barcode with minimal gap after MRP section (1mm gap for proper spacing)
    const barcodeY = cursorY + 1;

    // Only add barcode if it fits within label height
    if (barcodeY + barcodeTotalH <= TRIPLE_HEIGHT - 1) {
      // Create barcode WITHOUT text (we'll add it manually for better control)
      const imgData = createBarcodeDataUrl(fnsku, false);
      doc.addImage(imgData, 'PNG', 4, barcodeY, 42, barcodeH);

      // Add FNSKU text below barcode manually with larger font size and proper spacing
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7); // Increased from 5 to 6
      doc.text(fnsku, TRIPLE_WIDTH / 2, barcodeY + barcodeH + 2.5, { align: 'center' }); // Increased spacing from 1.5 to 2.5mm
    } else {
      // If not enough space, position at bottom as fallback
      const fallbackY = TRIPLE_HEIGHT - barcodeTotalH - 1;
      const imgData = createBarcodeDataUrl(fnsku, false);
      doc.addImage(imgData, 'PNG', 4, fallbackY, 42, barcodeH);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6); // Increased from 5 to 6
      doc.text(fnsku, TRIPLE_WIDTH / 2, fallbackY + barcodeH + 2.5, { align: 'center' }); // Increased spacing from 1.5 to 2.5mm
    }
  }

  return doc;
};
