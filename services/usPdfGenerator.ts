import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';
import { subDays, format } from 'date-fns';
import { USProduct, NutritionData } from '../types';
import {
  LABEL_WIDTH, LABEL_HEIGHT,
  COMBINED_WIDTH, COMBINED_HEIGHT,
  TRIPLE_WIDTH, TRIPLE_HEIGHT,
  TRIPLE_LARGE_WIDTH, TRIPLE_LARGE_HEIGHT
} from '../constants';
import { formatWeightWithOz, formatUSDate } from './usLabelUtils';
import { registerCustomFonts, formatValue, formatNutrient, extractAllergenFromRow, parseExpiry, generateBatchCode } from './pdfGenerator';

// Helper function to create barcode data URL (reused from pdfGenerator)
const createBarcodeDataUrl = (text: string, showText: boolean = true): string => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, text, {
    format: "CODE128",
    width: 2,
    height: 50,
    displayValue: showText,
    fontSize: 10,
    margin: 0,
    background: "#ffffff"
  });
  return canvas.toDataURL("image/png");
};

/**
 * Get FDA Reg. No. from column F (6th column, index 5)
 */
const getFDARegNo = (product: USProduct): string => {
  if (product['FSSAI'] || product['M.F.G. FSSAI']) {
    const value = String(product['FSSAI'] || product['M.F.G. FSSAI'] || '').trim();
    if (value && value.toLowerCase() !== 'nan' && value.toLowerCase() !== 'n/a' && value !== '') {
      return value;
    }
  }

  const fdaVariations = [
    'FDA Reg. No.',
    'FDA Reg No',
    'FDA Reg No.',
    'FDA',
    'FDA Reg. No',
    'FDA Registration No',
    'FDA Registration Number'
  ];

  for (const key of fdaVariations) {
    const value = product[key];
    if (value && String(value).trim() !== '' && String(value).trim().toLowerCase() !== 'nan' && String(value).trim().toLowerCase() !== 'n/a') {
      return String(value).trim();
    }
  }

  const keys = Object.keys(product);
  if (keys.length > 5) {
    const columnFValue = product[keys[5]];
    if (columnFValue && String(columnFValue).trim() !== '' && String(columnFValue).trim().toLowerCase() !== 'nan' && String(columnFValue).trim().toLowerCase() !== 'n/a') {
      return String(columnFValue).trim();
    }
  }

  for (const key of keys) {
    if ((key.toLowerCase().includes('fda') || key.toLowerCase().includes('fssai')) && key.toLowerCase() !== 'name') {
      const value = product[key];
      if (value && String(value).trim() !== '' && String(value).trim().toLowerCase() !== 'nan' && String(value).trim().toLowerCase() !== 'n/a') {
        return String(value).trim();
      }
    }
  }

  return 'N/A';
};

/**
 * Generate US Label 1 (48mm x 25mm)
 */
export const generateUSLabel1 = (product: USProduct): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [LABEL_WIDTH, LABEL_HEIGHT]
  });

  const today = new Date();
  const name = product['item_name_for_labels'] || product.Name || 'Unknown';

  const mfgDateObj = today;
  const mfgDate = formatUSDate(mfgDateObj);

  const expiryVal = product['Expiry '] || product.Expiry || product.EXPIRY || product['Shelf Life'] || product.Shelf_Life || product.ShelfLife || product['Expiry Months'];
  const useByDateObj = parseExpiry(expiryVal);
  const useByDate = formatUSDate(useByDateObj);

  const dateCode = format(today, 'ddMMyy');
  const batchCode = generateBatchCode(name, dateCode);

  const weight = formatWeightWithOz(product['Net Weight'] || 'N/A');
  const fdaRegNo = getFDARegNo(product);

  const margin = 2;
  const lineSpacing = 3.2;
  const numLines = 5;
  const approximateLineHeight = 2.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);

  const totalContentHeight = (numLines - 1) * lineSpacing + approximateLineHeight;
  const availableHeight = LABEL_HEIGHT - (margin * 2);
  const topSpace = (availableHeight - totalContentHeight) / 2;
  const firstLineY = margin + topSpace + (approximateLineHeight / 2);

  doc.text(`Net Wt: ${weight}`, margin, firstLineY);
  doc.text(`M.F.G on: ${mfgDate}`, margin, firstLineY + lineSpacing);
  doc.text(`U.S.E By: ${useByDate}`, margin, firstLineY + (lineSpacing * 2));
  doc.text(`Batch Code: ${batchCode}`, margin, firstLineY + (lineSpacing * 3));
  doc.text(`FDA Reg. No.: ${fdaRegNo}`, margin, firstLineY + (lineSpacing * 4));

  return doc;
};

/**
 * Generate US Combined Label (96mm x 25mm)
 */
export const generateUSCombinedLabel = (product: USProduct): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [COMBINED_WIDTH, COMBINED_HEIGHT]
  });

  const today = new Date();
  const name = product['item_name_for_labels'] || product.Name || 'Unknown';

  const mfgDateObj = today;
  const mfgDate = formatUSDate(mfgDateObj);

  const expiryVal = product['Expiry '] || product.Expiry || product.EXPIRY || product['Shelf Life'] || product.Shelf_Life || product.ShelfLife || product['Expiry Months'];
  const useByDateObj = parseExpiry(expiryVal);
  const useByDate = formatUSDate(useByDateObj);

  const dateCode = format(today, 'ddMMyy');
  const batchCode = generateBatchCode(name, dateCode);

  const weight = formatWeightWithOz(product['Net Weight'] || 'N/A');
  const fdaRegNo = getFDARegNo(product);

  const margin = 2;
  const lineSpacing = 3.2;
  const numLines = 5;
  const approximateLineHeight = 2.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);

  const totalContentHeight = (numLines - 1) * lineSpacing + approximateLineHeight;
  const availableHeight = COMBINED_HEIGHT - (margin * 2);
  const topSpace = (availableHeight - totalContentHeight) / 2;
  const firstLineY = margin + topSpace + (approximateLineHeight / 2);

  doc.text(`Net Wt: ${weight}`, margin, firstLineY);
  doc.text(`M.F.G on: ${mfgDate}`, margin, firstLineY + lineSpacing);
  doc.text(`U.S.E By: ${useByDate}`, margin, firstLineY + (lineSpacing * 2));
  doc.text(`Batch Code: ${batchCode}`, margin, firstLineY + (lineSpacing * 3));
  doc.text(`FDA Reg. No.: ${fdaRegNo}`, margin, firstLineY + (lineSpacing * 4));

  const fnsku = product.FNSKU;
  if (fnsku) {
    const barcodeW = 35;
    const barcodeH = 10;
    const imgData = createBarcodeDataUrl(fnsku, false);

    const barcodeX = 48 + (48 / 2) - (barcodeW / 2);

    const textSpacing = 2.5;
    const textHeight = 2;
    const blockHeight = barcodeH + textSpacing + textHeight;
    const barcodeY = margin + ((COMBINED_HEIGHT - (margin * 2) - blockHeight) / 2);

    doc.addImage(imgData, 'PNG', barcodeX, barcodeY, barcodeW, barcodeH);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(fnsku, barcodeX + (barcodeW / 2), barcodeY + barcodeH + textSpacing, { align: 'center' });
  } else {
    doc.text("No FNSKU", 52, 12);
  }

  return doc;
};

/**
 * Generate US Triple Label (50mm x 100mm)
 */
export const generateUSTripleLabel = async (product: USProduct, nutrition: NutritionData): Promise<jsPDF> => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [TRIPLE_WIDTH, TRIPLE_HEIGHT]
  });

  const helveticaBlackAvailable = await registerCustomFonts(doc);

  const startX = 2;
  const endX = TRIPLE_WIDTH - 2;
  const contentWidth = TRIPLE_WIDTH - 4;
  let cursorY = 8;

  const productName = product['item_name_for_labels'] || product.Name || 'Unknown';

  // Title
  if (helveticaBlackAvailable) {
    try { doc.setFont("Helvetica-Black", "normal"); } catch (e) { doc.setFont("helvetica", "bold"); }
  } else {
    doc.setFont("helvetica", "bold");
  }
  doc.setFontSize(7);
  const titleLines = doc.splitTextToSize(productName, contentWidth);
  doc.text(titleLines, TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += (titleLines.length * 1.5) + 2;

  const drawLabeledParagraph = (label: string, text: string, y: number): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5);
    doc.text(label, startX, y);

    const labelWidth = doc.getTextWidth(label);
    doc.setFont("helvetica", "normal");

    const words = text.split(' ');
    let currentY = y;
    let currentX = startX + labelWidth;
    const spaceWidth = doc.getTextWidth(" ");

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordWidth = doc.getTextWidth(word);

      if (currentX + wordWidth <= endX) {
        doc.text(word, currentX, currentY);
        currentX += wordWidth + spaceWidth;
      } else {
        currentY += 2.2;
        currentX = startX;
        doc.text(word, currentX, currentY);
        currentX += wordWidth + spaceWidth;
      }
    }
    return currentY + 2.5;
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
  cursorY += 3;

  // Nutrition Section
  if (helveticaBlackAvailable) {
    try { doc.setFont("Helvetica-Black", "normal"); } catch (e) { doc.setFont("helvetica", "bold"); }
  } else {
    doc.setFont("helvetica", "bold");
  }
  doc.setFontSize(5.5);
  doc.text("Nutritional Facts Per 100g (Approx Values)", TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 3.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  const servingSize = nutrition["Serving Size"] || "30g";
  doc.text(`Serving size ${servingSize}`, TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 2.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(3.5);
  doc.text("Number of servings may vary based on pack size and intended use", TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(`Energy Value - ${formatValue(nutrition.Energy || 345)} Kcal`, TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
  cursorY += 2.5;

  const colW = contentWidth / 4;
  const rowSpacing = 6;

  const col1X = startX + colW * 0.5;
  const col2X = startX + colW * 1.5;
  const col3X = startX + colW * 2.5;
  const col4X = startX + colW * 3.5;

  const drawNutrient = (label: string, val: string | number | undefined, unit: string, colX: number, rowY: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.5);
    doc.text(label, colX, rowY, { align: 'center' });

    doc.setFontSize(6);
    const valueStr = formatNutrient(val, unit);
    doc.text(valueStr, colX, rowY + 2.5, { align: 'center' });
  };

  const row1Y = cursorY;
  drawNutrient("Total Fat", nutrition["Total Fat"], "g", col1X, row1Y);
  drawNutrient("Saturated Fat", nutrition["Saturated Fat"], "g", col2X, row1Y);
  drawNutrient("Trans Fat", nutrition["Trans Fat"], "g", col3X, row1Y);
  drawNutrient("Cholesterol", nutrition.Cholesterol, "mg", col4X, row1Y);

  const row2Y = row1Y + rowSpacing;
  drawNutrient("Total Carbs", nutrition["Total Carbohydrate"], "g", col1X, row2Y);
  drawNutrient("Dietary Fibers", nutrition["Dietary Fiber"], "g", col2X, row2Y);
  drawNutrient("Total Sugars", nutrition["Total Sugars"], "g", col3X, row2Y);
  drawNutrient("Added Sugars", nutrition["Added Sugars"], "g", col4X, row2Y);

  const row3Y = row2Y + rowSpacing;
  drawNutrient("Sodium", nutrition["Sodium(mg)"], "mg", col1X, row3Y);
  drawNutrient("Protein", nutrition.Protein, "g", col2X, row3Y);

  cursorY = row3Y + rowSpacing + 1;

  // Disclaimer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4);
  const disclaimer = "* The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet.";
  const splitDisc = doc.splitTextToSize(disclaimer, contentWidth);
  for (let i = 0; i < splitDisc.length; i++) {
    doc.text(splitDisc[i], TRIPLE_WIDTH / 2, cursorY, { align: 'center' });
    cursorY += 1.5;
  }
  cursorY += 0.5;

  // Separator
  doc.setLineWidth(0.2);
  doc.line(2, cursorY, 48, cursorY);
  cursorY += 4;

  // Label 1 Content
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  const lineHeight = 2.7;

  const today = new Date();
  const name = product['item_name_for_labels'] || product.Name || 'Unknown';

  const mfgDate = formatUSDate(today);

  const expiryVal = product['Expiry '] || product.Expiry || product.EXPIRY || product['Shelf Life'] || product.Shelf_Life || product.ShelfLife || product['Expiry Months'];
  const useByDateObj = parseExpiry(expiryVal);
  const useByDate = formatUSDate(useByDateObj);

  const dateCode = format(today, 'ddMMyy');
  const batchCode = generateBatchCode(name, dateCode);

  const weight = formatWeightWithOz(product['Net Weight'] || 'N/A');
  const fdaRegNo = getFDARegNo(product);

  doc.text(`Net Wt: ${weight}`, startX, cursorY);
  cursorY += lineHeight;

  doc.text(`M.F.G on: ${mfgDate}`, startX, cursorY);
  cursorY += lineHeight;

  doc.text(`U.S.E By: ${useByDate}`, startX, cursorY);
  cursorY += lineHeight;

  doc.text(`Batch Code: ${batchCode}`, startX, cursorY);
  cursorY += lineHeight;

  doc.text(`FDA Reg. No.: ${fdaRegNo}`, startX, cursorY);
  cursorY += lineHeight;

  // FNSKU Barcode
  const fnsku = product.FNSKU;
  if (fnsku) {
    const barcodeH = 10;
    const barcodeTextH = 2.5;
    const barcodeTotalH = barcodeH + barcodeTextH;

    const barcodeY = cursorY + 1;

    if (barcodeY + barcodeTotalH <= TRIPLE_HEIGHT - 1) {
      const imgData = createBarcodeDataUrl(fnsku, false);
      doc.addImage(imgData, 'PNG', 4, barcodeY, 42, barcodeH);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(fnsku, TRIPLE_WIDTH / 2, barcodeY + barcodeH + 2.5, { align: 'center' });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.5);
      doc.text("Country of Origin: India", TRIPLE_WIDTH / 2, barcodeY + barcodeH + 5.5, { align: 'center' });
    } else {
      const fallbackY = TRIPLE_HEIGHT - barcodeTotalH - 1;
      const imgData = createBarcodeDataUrl(fnsku, false);
      doc.addImage(imgData, 'PNG', 4, fallbackY, 42, barcodeH);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(fnsku, TRIPLE_WIDTH / 2, fallbackY + barcodeH + 2.5, { align: 'center' });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.5);
      doc.text("Country of Origin: India", TRIPLE_WIDTH / 2, fallbackY + barcodeH + 5.5, { align: 'center' });
    }
  }

  return doc;
};

/**
 * Generate US Triple Label - Large (100mm x 150mm)
 * Same content as Triple Label, all spacing budgeted to fit within 150mm.
 */
export const generateUSTripleLargeLabel = async (product: USProduct, nutrition: NutritionData): Promise<jsPDF> => {
  const W = TRIPLE_LARGE_WIDTH;  // 100mm

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, TRIPLE_LARGE_HEIGHT] });
  const helveticaBlackAvailable = await registerCustomFonts(doc);

  const margin = 5;
  const startX = margin;
  const endX = W - margin;
  const contentWidth = W - margin * 2;
  let cursorY = 7;

  const productName = product['item_name_for_labels'] || product.Name || 'Unknown';

  // --- 1. Title ---
  const setBlackFont = () => {
    if (helveticaBlackAvailable) {
      try { doc.setFont('Helvetica-Black', 'normal'); } catch { doc.setFont('helvetica', 'bold'); }
    } else {
      doc.setFont('helvetica', 'bold');
    }
  };
  setBlackFont();
  doc.setFontSize(13);
  const titleLines = doc.splitTextToSize(productName, contentWidth);
  doc.text(titleLines, W / 2, cursorY, { align: 'center' });
  cursorY += titleLines.length * 5 + 2;

  // --- Word-wrap paragraph helper ---
  const drawPara = (boldLabel: string, body: string, y: number, fontSize: number): number => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.text(boldLabel, startX, y);
    const lw = doc.getTextWidth(boldLabel);
    doc.setFont('helvetica', 'normal');
    const spW = doc.getTextWidth(' ');
    let cx = startX + lw;
    let cy = y;
    for (const word of body.split(' ')) {
      const ww = doc.getTextWidth(word);
      if (cx + ww > endX) { cy += 3.8; cx = startX; }
      doc.text(word, cx, cy);
      cx += ww + spW;
    }
    return cy + 4;
  };

  cursorY = drawPara('Ingredients: ', nutrition.Ingredients || 'N/A', cursorY, 9);
  const allergen = nutrition['Allergen Info'] || extractAllergenFromRow(nutrition);
  if (allergen) {
    cursorY = drawPara('Allergen Info: ', allergen, cursorY, 9);
  } else {
    cursorY += 1;
  }

  // Separator
  doc.setLineWidth(0.4);
  doc.line(margin, cursorY, W - margin, cursorY);
  cursorY += 4;

  // --- 2. Nutrition ---
  setBlackFont();
  doc.setFontSize(10);
  doc.text('Nutritional Facts Per 100g (Approx Values)', W / 2, cursorY, { align: 'center' });
  cursorY += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const servingSize = nutrition['Serving Size'] || '30g';
  doc.text(`Serving size ${servingSize}`, W / 2, cursorY, { align: 'center' });
  cursorY += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Number of servings may vary based on pack size and intended use', W / 2, cursorY, { align: 'center' });
  cursorY += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Energy Value - ${formatValue(nutrition.Energy || 345)} Kcal`, W / 2, cursorY, { align: 'center' });
  cursorY += 4;

  // Nutrient grid (4 columns)
  const colW = contentWidth / 4;
  const rSp = 9;
  const xc = [startX + colW * 0.5, startX + colW * 1.5, startX + colW * 2.5, startX + colW * 3.5];

  const dn = (lbl: string, val: string | number | undefined, unit: string, cx: number, ry: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(lbl, cx, ry, { align: 'center' });
    doc.setFontSize(11);
    doc.text(formatNutrient(val, unit), cx, ry + 4, { align: 'center' });
  };

  const r1 = cursorY;
  dn('Total Fat', nutrition['Total Fat'], 'g', xc[0], r1);
  dn('Saturated Fat', nutrition['Saturated Fat'], 'g', xc[1], r1);
  dn('Trans Fat', nutrition['Trans Fat'], 'g', xc[2], r1);
  dn('Cholesterol', nutrition.Cholesterol, 'mg', xc[3], r1);

  const r2 = r1 + rSp;
  dn('Total Carbs', nutrition['Total Carbohydrate'], 'g', xc[0], r2);
  dn('Dietary Fibers', nutrition['Dietary Fiber'], 'g', xc[1], r2);
  dn('Total Sugars', nutrition['Total Sugars'], 'g', xc[2], r2);
  dn('Added Sugars', nutrition['Added Sugars'], 'g', xc[3], r2);

  const r3 = r2 + rSp;
  dn('Sodium', nutrition['Sodium(mg)'], 'mg', xc[0], r3);
  dn('Protein', nutrition.Protein, 'g', xc[1], r3);

  cursorY = r3 + rSp;

  // Disclaimer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const disc = '* The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet.';
  const discLines = doc.splitTextToSize(disc, contentWidth);
  for (const line of discLines) {
    doc.text(line, W / 2, cursorY, { align: 'center' });
    cursorY += 3;
  }
  cursorY += 1;

  // Separator
  doc.setLineWidth(0.4);
  doc.line(margin, cursorY, W - margin, cursorY);
  cursorY += 4;

  // --- 3. Label 1 info ---
  const today = new Date();
  const name = product['item_name_for_labels'] || product.Name || 'Unknown';
  const mfgDate = formatUSDate(today);
  const expiryVal = product['Expiry '] || product.Expiry || product.EXPIRY || product['Shelf Life'] || product.Shelf_Life || product.ShelfLife || product['Expiry Months'];
  const useByDate = formatUSDate(parseExpiry(expiryVal));
  const batchCode = generateBatchCode(name, format(today, 'ddMMyy'));
  const weight = formatWeightWithOz(product['Net Weight'] || 'N/A');
  const fdaRegNo = getFDARegNo(product);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  const lh = 4.8;
  doc.text(`Net Wt: ${weight}`, startX, cursorY); cursorY += lh;
  doc.text(`M.F.G on: ${mfgDate}`, startX, cursorY); cursorY += lh;
  doc.text(`U.S.E By: ${useByDate}`, startX, cursorY); cursorY += lh;
  doc.text(`Batch Code: ${batchCode}`, startX, cursorY); cursorY += lh;
  doc.text(`FDA Reg. No.: ${fdaRegNo}`, startX, cursorY); cursorY += lh;

  // --- 4. FNSKU Barcode ---
  const fnsku = product.FNSKU;
  if (fnsku) {
    const barcodeH = 16;
    const barcodeY = cursorY + 2;
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, fnsku, { format: 'CODE128', width: 2, height: 70, displayValue: false, margin: 0, background: '#ffffff' });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', margin + 2, barcodeY, W - (margin * 2) - 4, barcodeH);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
    doc.text(fnsku, W / 2, barcodeY + barcodeH + 4, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Country of Origin: India', W / 2, barcodeY + barcodeH + 9, { align: 'center' });
  }

  return doc;
};
