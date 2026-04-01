import { PDFDocument } from 'pdf-lib';
import { PhysicalItem, MasterProduct, NutritionData } from '../types';
import {
  generateCombinedLabelHorizontal,
  generateCombinedVerticalSticker,
  generateTripleLabel,
  generateMRPLabel
} from './pdfGenerator';
import { isEmptyValue } from './utils';

/**
 * Generate labels by packet type (sticker or house)
 */
export const generateLabelsByPacketUsed = async (
  physicalItems: PhysicalItem[],
  masterData: MasterProduct[],
  nutritionData: NutritionData[]
): Promise<{
  stickerPdfBytes: Uint8Array | null;
  housePdfBytes: Uint8Array | null;
  stickerCount: number;
  houseCount: number;
  skippedProducts: Array<{ Product: string; ASIN: string; 'Packet used': string; Reason: string }>;
}> => {
  const stickerPdf = await PDFDocument.create();
  const housePdf = await PDFDocument.create();
  let stickerCount = 0;
  let houseCount = 0;
  const skippedProducts: Array<{ Product: string; ASIN: string; 'Packet used': string; Reason: string }> = [];

  if (physicalItems.length === 0) {
    return {
      stickerPdfBytes: null,
      housePdfBytes: null,
      stickerCount: 0,
      houseCount: 0,
      skippedProducts: []
    };
  }

  // Separate products by packet type
  const stickerProducts = physicalItems.filter(
    (item) => String(item['Packet used'] || '').trim().toLowerCase() === 'sticker'
  );
  const houseProducts = physicalItems.filter(
    (item) => String(item['Packet used'] || '').trim().toLowerCase() === 'house'
  );

  // Track products with invalid packet used values
  const otherProducts = physicalItems.filter(
    (item) =>
      !['sticker', 'house'].includes(String(item['Packet used'] || '').trim().toLowerCase()) &&
      String(item['Packet used'] || '').trim() !== 'N/A' &&
      String(item['Packet used'] || '').trim() !== 'nan'
  );

  for (const item of otherProducts) {
    skippedProducts.push({
      Product: item.item || 'Unknown',
      ASIN: item.ASIN || 'Unknown',
      'Packet used': item['Packet used'] || 'N/A',
      Reason: "Invalid or empty 'Packet used' value"
    });
  }

  // Generate Sticker labels (96mm × 25mm)
  for (const row of stickerProducts) {
    const qty = row.Qty || 0;
    const productName = row.item_name_for_labels || row.item || '';

    // Find master product by ASIN — ASIN uniquely identifies the product variant.
    // FNSKU is an attribute of the master product, not the lookup key.
    const masterProduct = masterData.find((p) => p.ASIN === row.ASIN);
    const fnsku = String(masterProduct?.FNSKU || '').trim();

    if (masterProduct && fnsku && fnsku !== 'MISSING' && !isEmptyValue(fnsku)) {
      {
        const productForLabel: MasterProduct = {
          ...masterProduct,
          'item_name_for_labels': productName || masterProduct.Name || '',
          FNSKU: fnsku
        };

        for (let i = 0; i < qty; i++) {
          try {
            // Generate combined label (sticker format) - matches Streamlit generate_combined_label_pdf_direct
            const labelPdf = generateCombinedLabelHorizontal(productForLabel);
            const labelBytes = labelPdf.output('arraybuffer');
            const labelDoc = await PDFDocument.load(labelBytes);
            const [copiedPage] = await stickerPdf.copyPages(labelDoc, [0]);
            stickerPdf.addPage(copiedPage);
            stickerCount++;
            console.log(`[Sticker Labels] Generated label ${i + 1}/${qty} for ${productName}`);
          } catch (error) {
            console.warn(`Could not generate Sticker label for FNSKU ${fnsku} (${productName}):`, error);
          }
        }
      }
    } else {
      skippedProducts.push({
        Product: productName,
        ASIN: row.ASIN || 'Unknown',
        'Packet used': 'Sticker',
        Reason: !masterProduct ? 'Product not found in master data' : 'Missing FNSKU'
      });
    }
  }

  // Generate House labels (50mm × 100mm triple labels)
  for (const row of houseProducts) {
    const qty = row.Qty || 0;
    const productName = row.item_name_for_labels || row.item || '';

    // Find master product by ASIN — ASIN uniquely identifies the product variant.
    // FNSKU is an attribute of the master product used only for the barcode.
    const masterProduct = masterData.find((p) => p.ASIN === row.ASIN);
    const fnsku = String(masterProduct?.FNSKU || '').trim();

    if (masterProduct && fnsku && fnsku !== 'MISSING' && !isEmptyValue(fnsku)) {
      console.log(`[House Labels] Found master product by ASIN: ${row.ASIN} -> ${masterProduct.Name || 'Unknown'}, FNSKU: ${fnsku}`);

      // Find nutrition data - match Streamlit approach: simple case-insensitive contains match
      let nutritionRow: NutritionData | undefined;
      if (!nutritionData || nutritionData.length === 0) {
        console.warn('[House Labels] No nutrition data available. Cannot generate house labels.');
      } else {
        // Helper to normalize product names for matching (remove weights, common descriptors)
        const normalizeForMatching = (name: string): string => {
          if (!name) return '';
          let normalized = name.trim().toLowerCase();
          // Remove weight patterns (e.g., "1kg", "500g", "1 kg", "700 g")
          normalized = normalized.replace(/\d+(?:\.\d+)?\s*(?:kg|g|gm|gram|grams)/g, '').trim();
          // Remove common descriptors
          const commonDescriptors = ['bihari', 'mithila', 'foods', 'desi', 'plain', 'high', 'protein'];
          normalized = normalized.split(' ').filter(word => !commonDescriptors.includes(word)).join(' ').trim();
          return normalized;
        };
        
        // Try multiple search names: item_name_for_labels, master product name, and original item name
        const searchNames = [
          productName?.trim(),
          masterProduct?.Name?.trim(),
          row.item?.trim()
        ].filter(name => name && name.length > 0);
        
        // Try each search name with contains match (matches Streamlit: nutrition_df["Product"].str.contains(product_name, case=False, na=False))
        for (const searchName of searchNames) {
          if (!searchName) continue;
          
          const normalizedSearchName = normalizeForMatching(searchName);
          
          // Strategy 1: Nutrition Product contains search name (primary - matches Streamlit)
          nutritionRow = nutritionData.find(
            (n) => {
              if (!n.Product) return false;
              const normalizedNutrition = normalizeForMatching(n.Product);
              return normalizedNutrition.includes(normalizedSearchName) || 
                     n.Product.toLowerCase().includes(searchName.toLowerCase());
            }
          );
          if (nutritionRow) {
            console.log(`[House Labels] Found nutrition data (Strategy 1 - Contains) for "${searchName}": "${nutritionRow.Product}"`);
            break;
          }
          
          // Strategy 2: Search name contains Nutrition Product (reverse match)
          nutritionRow = nutritionData.find(
            (n) => {
              if (!n.Product) return false;
              const normalizedNutrition = normalizeForMatching(n.Product);
              return normalizedSearchName.includes(normalizedNutrition) ||
                     searchName.toLowerCase().includes(n.Product.toLowerCase());
            }
          );
          if (nutritionRow) {
            console.log(`[House Labels] Found nutrition data (Strategy 2 - Reverse Contains) for "${searchName}": "${nutritionRow.Product}"`);
            break;
          }
          
          // Strategy 3: Extract key words and match (for cases like "Ragi Atta" vs "Ragi Atta 1kg")
          const keyWords = normalizedSearchName
            .split(' ')
            .filter(w => w.length > 2 && !['the', 'and', 'for', 'with'].includes(w));
          
          for (const word of keyWords) {
            nutritionRow = nutritionData.find(
              (n) => {
                if (!n.Product) return false;
                const normalizedNutrition = normalizeForMatching(n.Product);
                return normalizedNutrition.includes(word) || n.Product.toLowerCase().includes(word);
              }
            );
            if (nutritionRow) {
              console.log(`[House Labels] Found nutrition data (Strategy 3 - Keyword "${word}") for "${searchName}": "${nutritionRow.Product}"`);
              break;
            }
          }
          if (nutritionRow) break;
        }
        
        // Debug logging if not found
        if (!nutritionRow && searchNames.length > 0) {
          const availableProducts = nutritionData
            .map(n => n.Product)
            .filter(p => p)
            .slice(0, 20); // Log first 20 for debugging
          console.warn(`[House Labels] Nutrition data not found for search names: ${searchNames.join(', ')}. Available products: ${availableProducts.join(', ')}`);
        }
      }

      if (nutritionRow) {
        const productForLabel: MasterProduct = {
          ...masterProduct,
          'item_name_for_labels': productName || masterProduct.Name || '',
          FNSKU: fnsku
        };

        for (let copyNum = 0; copyNum < qty; copyNum++) {
          try {
            const tripleLabelPdf = await generateTripleLabel(productForLabel, nutritionRow);
            const tripleBytes = tripleLabelPdf.output('arraybuffer');
            const tripleDoc = await PDFDocument.load(tripleBytes);
            const [copiedPage] = await housePdf.copyPages(tripleDoc, [0]);
            housePdf.addPage(copiedPage);
            houseCount++;
            console.log(`[House Labels] Generated label ${copyNum + 1}/${qty} for ${productName}`);
          } catch (error) {
            console.warn(`Could not generate House label for ${productName} (copy ${copyNum + 1}):`, error);
          }
        }
      } else {
        console.warn(`[House Labels] Skipped ${productName}: Missing nutrition data`);
        skippedProducts.push({
          Product: productName,
          ASIN: row.ASIN || 'Unknown',
          'Packet used': 'House',
          Reason: 'Missing nutrition data'
        });
      }
    } else {
      skippedProducts.push({
        Product: productName,
        ASIN: row.ASIN || 'Unknown',
        'Packet used': 'House',
        Reason: !masterProduct ? 'Product not found in master data' : 'Missing FNSKU'
      });
    }
  }

  // Convert to bytes
  const stickerBytes = stickerCount > 0 ? await stickerPdf.save() : null;
  const houseBytes = houseCount > 0 ? await housePdf.save() : null;

  return {
    stickerPdfBytes: stickerBytes,
    housePdfBytes: houseBytes,
    stickerCount,
    houseCount,
    skippedProducts
  };
};

/**
 * Generate Combined Vertical Sticker labels (2 pages per label: MRP + Barcode, each 50x25mm)
 * Generated only for sticker items (same set as the Combined Sticker label)
 */
export const generateCombinedVerticalLabels = async (
  physicalItems: PhysicalItem[],
  masterData: MasterProduct[]
): Promise<{
  combinedVerticalPdfBytes: Uint8Array | null;
  combinedVerticalCount: number;
}> => {
  const eligibleItems = physicalItems.filter(item => {
    const fnsku = String(item.FNSKU || '').trim();
    const packetUsed = String(item['Packet used'] || '').trim().toLowerCase();
    return packetUsed === 'sticker' &&
      fnsku && fnsku !== 'MISSING' && !isEmptyValue(fnsku);
  });

  if (eligibleItems.length === 0) {
    return { combinedVerticalPdfBytes: null, combinedVerticalCount: 0 };
  }

  const outputPdf = await PDFDocument.create();
  let combinedVerticalCount = 0;

  for (const row of eligibleItems) {
    const qty = row.Qty || 0;
    const productName = row.item_name_for_labels || row.item || '';

    const masterProduct = masterData.find(p => p.ASIN === row.ASIN);
    if (!masterProduct) continue;
    const resolvedFnsku = String(masterProduct.FNSKU || '').trim();
    if (!resolvedFnsku || resolvedFnsku === 'MISSING' || isEmptyValue(resolvedFnsku)) continue;

    const productForLabel: MasterProduct = {
      ...masterProduct,
      'item_name_for_labels': productName || masterProduct.Name || '',
      FNSKU: resolvedFnsku
    };

    for (let i = 0; i < qty; i++) {
      try {
        const labelPdf = generateCombinedVerticalSticker(productForLabel);
        const labelBytes = labelPdf.output('arraybuffer');
        const labelDoc = await PDFDocument.load(labelBytes);
        // Copy both pages (page 0 = MRP, page 1 = Barcode)
        const pageCount = labelDoc.getPageCount();
        for (let p = 0; p < pageCount; p++) {
          const [copiedPage] = await outputPdf.copyPages(labelDoc, [p]);
          outputPdf.addPage(copiedPage);
        }
        combinedVerticalCount++;
      } catch (error) {
        console.warn(`Could not generate Combined Vertical label for ${productName}:`, error);
      }
    }
  }

  const pdfBytes = combinedVerticalCount > 0 ? await outputPdf.save() : null;
  return { combinedVerticalPdfBytes: pdfBytes, combinedVerticalCount };
};

/**
 * Generate MRP-only labels for products without FNSKU
 */
export const generateMRPOnlyLabels = async (
  physicalItems: PhysicalItem[],
  masterData: MasterProduct[]
): Promise<{
  mrpPdfBytes: Uint8Array | null;
  mrpCount: number;
}> => {
  // Filter products without FNSKU
  const mrpOnlyItems = physicalItems.filter(item => {
    const fnsku = String(item.FNSKU || '').trim();
    return isEmptyValue(fnsku) || 
           fnsku === 'MISSING' || 
           fnsku.toLowerCase() === 'nan' || 
           fnsku.toLowerCase() === 'none';
  });

  if (mrpOnlyItems.length === 0) {
    return {
      mrpPdfBytes: null,
      mrpCount: 0
    };
  }

  const mrpPdf = await PDFDocument.create();
  let mrpCount = 0;

  for (const row of mrpOnlyItems) {
    const qty = row.Qty || 0;
    
    // Find matching master product
    const masterProduct = masterData.find(
      p => p.ASIN === row.ASIN || p.Name === row.item || p.Name === row.item_name_for_labels
    );

    if (masterProduct) {
      for (let i = 0; i < qty; i++) {
        try {
          // Generate MRP label
          const mrpLabelPdf = generateMRPLabel(masterProduct);
          const mrpBytes = mrpLabelPdf.output('arraybuffer');
          const mrpDoc = await PDFDocument.load(mrpBytes);
          const [copiedPage] = await mrpPdf.copyPages(mrpDoc, [0]);
          mrpPdf.addPage(copiedPage);
          mrpCount++;
        } catch (error) {
          console.warn(`Failed to generate MRP label for ${row.item}:`, error);
        }
      }
    }
  }

  const mrpBytes = mrpCount > 0 ? await mrpPdf.save() : null;

  return {
    mrpPdfBytes: mrpBytes,
    mrpCount
  };
};

