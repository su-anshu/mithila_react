import { MasterProduct, OrderItem, PhysicalItem, MissingProduct } from '../types';
import { isEmptyValue } from './utils';
import { getProductFromFkSku, getProductFromNameWeight } from './flipkartProductMatcher';
import { normalizeWeight, weightsMatch, findColumnFlexible, parseSkuId } from './flipkartUtils';

/**
 * Create SKU lookup dictionary for O(1) lookups
 * Maps SKU IDs to master products using FK SKU and M columns
 */
export const createSkuLookupDict = (masterData: MasterProduct[]): Map<string, MasterProduct[]> => {
  const lookup = new Map<string, MasterProduct[]>();

  if (!masterData || masterData.length === 0) {
    return lookup;
  }

  // Find FK SKU and M columns
  let fkSkuColumn: string | null = null;
  let mColumn: string | null = null;

  const firstRow = masterData[0];
  for (const col of Object.keys(firstRow)) {
    const colLower = col.toLowerCase().trim();
    if (colLower.includes('fk') && colLower.includes('sku')) {
      fkSkuColumn = col;
    } else if (colLower === 'm' || colLower.startsWith('m ')) {
      mColumn = col;
    }
  }

  // Build lookup from FK SKU column
  if (fkSkuColumn) {
    for (const row of masterData) {
      const fkSku = String(row[fkSkuColumn!] || '').trim();
      if (fkSku && !isEmptyValue(fkSku)) {
        if (!lookup.has(fkSku)) {
          lookup.set(fkSku, []);
        }
        lookup.get(fkSku)!.push(row);
      }
    }
  }

  // Also add M column entries if available
  if (mColumn) {
    for (const row of masterData) {
      const mValue = String(row[mColumn!] || '').trim();
      if (mValue && !isEmptyValue(mValue)) {
        if (!lookup.has(mValue)) {
          lookup.set(mValue, []);
        }
        // Only add if not already in lookup
        const existing = lookup.get(mValue)!;
        if (!existing.some(r => r === row)) {
          existing.push(row);
        }
      }
    }
  }

  return lookup;
};

/**
 * Expand Flipkart orders to physical packing plan with split logic support.
 * 
 * Similar to expandToPhysical but uses SKU-based matching instead of ASIN.
 * 
 * @param orders Array of order items with SKU and Qty (SKU is the full SKU ID from invoice)
 * @param masterData Array of master product data
 * @returns Object containing physicalItems array and missingProducts array
 */
export const expandToPhysicalFlipkart = (
  orders: Array<OrderItem & { SKU?: string; sku?: string }>,
  masterData: MasterProduct[]
): { physicalItems: PhysicalItem[]; missingProducts: MissingProduct[] } => {
  const physicalRows: PhysicalItem[] = [];
  const missingProducts: MissingProduct[] = [];

  // Create SKU lookup dictionary
  const skuLookupDict = createSkuLookupDict(masterData);

  // Find column names
  const nameCol = findColumnFlexible(masterData, ['Name']);
  const netWeightCol = findColumnFlexible(masterData, ['Net Weight', 'NetWeight']);

  for (const orderRow of orders) {
    try {
      // Get SKU from order (try both 'SKU' and 'sku' keys)
      const skuId = (orderRow.SKU || orderRow.sku || 'UNKNOWN').trim();
      const qty = parseInt(String(orderRow.Qty || 1), 10);

      if (!skuId || isEmptyValue(skuId)) {
        console.warn('[Flipkart Packing] Empty SKU ID in order');
        continue;
      }

      // Get product name and weight from order (support both old and new column names)
      // If not provided, parse from SKU ID
      let productName = String(orderRow.Item || orderRow.Product_Name || '').trim();
      let weight = String(orderRow.Weight || '').trim();
      
      // If missing, try to parse from SKU ID
      if (!productName || !weight) {
        const parsed = parseSkuId(skuId);
        if (!productName && parsed.productName) {
          productName = String(parsed.productName).trim();
        }
        if (!weight && parsed.weight) {
          weight = String(parsed.weight).trim();
        }
      }
      
      // Ensure strings (handle null/undefined)
      productName = productName || '';
      weight = weight || '';

      // Try to match product using multiple strategies
      let matchRow: MasterProduct | undefined;

      // Strategy 1: Match by FK SKU (direct SKU matching)
      const fkSkuMatches = getProductFromFkSku(skuId, masterData);
      if (fkSkuMatches.length > 0) {
        matchRow = fkSkuMatches[0]; // Use first match
      }

      // Strategy 2: Fallback to name + weight matching if FK SKU fails
      if (!matchRow && productName && weight) {
        const nameWeightMatches = getProductFromNameWeight(productName, weight, masterData);
        if (nameWeightMatches.length > 0) {
          matchRow = nameWeightMatches[0]; // Use first match
        }
      }

      // Strategy 3: Try name-only matching if weight is missing
      if (!matchRow && productName && !weight) {
        const nameOnlyMatches = getProductFromNameWeight(productName, '', masterData);
        if (nameOnlyMatches.length > 0) {
          matchRow = nameOnlyMatches[0]; // Use first match
        }
      }
      
      if (!matchRow) {
        console.warn(`[Flipkart Packing] Product not found in master file: ${productName || skuId} ${weight}`);
        missingProducts.push({
          ASIN: skuId, // Use SKU as identifier
          SKU_ID: skuId,
          Product: productName || skuId,
          Weight: weight || '',
          Issue: 'Not found in master file',
          Qty: qty
        });

        physicalRows.push({
          item: `UNKNOWN PRODUCT (${productName || skuId} ${weight || ''})`.trim(),
          item_name_for_labels: `UNKNOWN PRODUCT (${productName || skuId} ${weight || ''})`.trim(),
          weight: weight || 'N/A',
          Qty: qty,
          'Packet Size': 'N/A',
          'Packet used': 'N/A',
          ASIN: skuId, // Store SKU in ASIN field for compatibility
          MRP: 'N/A',
          FNSKU: 'MISSING',
          FSSAI: 'N/A',
          'Packed Today': '',
          Available: '',
          Status: '⚠️ MISSING FROM MASTER',
          is_split: false
        });
        continue;
      }

      // Extract base product information
      const base = matchRow;
      const name = base.Name || 'Unknown Product';

      // Check for split information (same logic as Amazon)
      let split = '';
      const splitColumnNames = ['Split Into', 'SplitInto', 'Split', 'K'];
      for (const colName of splitColumnNames) {
        const splitValue = base[colName];
        if (splitValue && !isEmptyValue(splitValue)) {
          split = String(splitValue).trim();
          break;
        }
      }

      // Also check for column "K" directly
      if (!split && base['K']) {
        split = String(base['K']).trim();
      }

      // Get weight from master data
      const baseWeightRaw = base['Net Weight'] || base['NetWeight'] || '';
      let baseWeight = '';
      if (baseWeightRaw !== null && baseWeightRaw !== undefined) {
        if (typeof baseWeightRaw === 'number' && !isNaN(baseWeightRaw)) {
          baseWeight = String(baseWeightRaw).trim();
        } else {
          const strWeight = String(baseWeightRaw).trim();
          if (!isEmptyValue(strWeight)) {
            baseWeight = strWeight.replace(/kg/gi, '').trim();
          }
        }
      }

      // Process split logic (matching Streamlit implementation)
      if (split && !isEmptyValue(split)) {
        // Normalize split sizes: remove "kg" suffix (like Streamlit version)
        const sizes = split.split(',').map(s => s.trim().replace(/kg/gi, '').trim()).filter(s => s);
        
        // Calculate split quantity multiplier: number of pieces the product splits into
        const splitQtyMultiplier = sizes.length;
        // Multiply original quantity by number of split pieces
        const finalQty = qty * splitQtyMultiplier;
        
        // Construct original product name with weight for split products (for PDF display)
        // Example: "Coconut Thekua" + "0.7kg" = "Coconut Thekua 0.7"
        let originalNameWithWeight = name;
        if (baseWeight && !isEmptyValue(baseWeight)) {
          // Normalize weight: remove "kg" suffix if present for cleaner display
          const weightDisplay = baseWeight.toLowerCase().endsWith('kg') 
            ? baseWeight.replace(/kg/gi, '').trim() 
            : baseWeight;
          originalNameWithWeight = `${name} ${weightDisplay}`;
        }
        
        let splitFound = false;
        
        if (sizes.length > 0) {
          for (const size of sizes) {
            try {
              // Find variant in master data matching name and weight
              let variant: MasterProduct | undefined;
              
              if (nameCol && netWeightCol) {
                variant = masterData.find((row) => {
                  const productName = String(row[nameCol] || '').trim();
                  const productWeightRaw = row[netWeightCol] || '';
                  
                  let productWeight = '';
                  if (productWeightRaw !== null && productWeightRaw !== undefined) {
                    if (typeof productWeightRaw === 'number' && !isNaN(productWeightRaw)) {
                      productWeight = String(productWeightRaw).trim();
                    } else {
                      const strWeight = String(productWeightRaw).trim();
                      if (!isEmptyValue(strWeight)) {
                        // Normalize: remove "kg" suffix for matching
                        productWeight = strWeight.replace(/kg/gi, '').trim();
                      }
                    }
                  }
                  
                  const normalizedProductName = productName.toLowerCase().trim();
                  const normalizedBaseName = name.toLowerCase().trim();
                  
                  // Match by exact name and normalized weight
                  const nameMatches = normalizedProductName === normalizedBaseName;
                  const weightMatches = productWeight === size;
                  
                  return nameMatches && weightMatches;
                });
              }

              if (variant) {
                const variantName = String(variant[nameCol || 'Name'] || name).trim();
                const variantWeightRaw = variant[netWeightCol || 'Net Weight'] || '';
                let variantWeight = '';
                if (variantWeightRaw !== null && variantWeightRaw !== undefined) {
                  if (typeof variantWeightRaw === 'number' && !isNaN(variantWeightRaw)) {
                    variantWeight = String(variantWeightRaw).trim();
                  } else {
                    variantWeight = String(variantWeightRaw).trim();
                  }
                }

                const splitWeight = variantWeight || size;
                const fnsku = variant.FNSKU || 'MISSING';
                const status = (!isEmptyValue(fnsku) && fnsku !== 'MISSING') ? '✅ READY' : '⚠️ MISSING FNSKU';
                const mrp = variant.MRP || variant['M.R.P'] || 'N/A';
                const fssai = variant.FSSAI || variant['M.F.G. FSSAI'] || 'N/A';
                const packetSize = variant['Packet Size'] || 'N/A';
                const packetUsed = variant['Packet used'] || 'N/A';
                const asin = variant.ASIN || skuId;

                physicalRows.push({
                  item: originalNameWithWeight, // Original name with weight (e.g., "Coconut Thekua 0.7") - for PDF display
                  item_name_for_labels: name, // Original name without weight (e.g., "Coconut Thekua") - for labels
                  weight: splitWeight,
                  Qty: finalQty, // Use multiplied quantity
                  'Packet Size': packetSize,
                  'Packet used': packetUsed,
                  ASIN: asin,
                  MRP: mrp,
                  FNSKU: (!isEmptyValue(fnsku) && fnsku !== 'MISSING') ? fnsku : 'MISSING',
                  FSSAI: fssai,
                  'Packed Today': '',
                  Available: '',
                  Status: status,
                  is_split: true // Mark as split product
                });
                splitFound = true;
                break; // Found the split variant, no need to continue
              }
            } catch (error) {
              console.error(`[Flipkart Packing] Error processing split variant ${size} for ${name}:`, error);
            }
          }
          
          if (!splitFound) {
            missingProducts.push({
              ASIN: skuId,
              Issue: 'Split sizes not found in master file',
              Product: name,
              Weight: baseWeight || '',
              'Split Info': split,
              Qty: qty
            });
          }
        }
      } else {
        // No split information - use base product
        const finalWeight = baseWeight || (weight || 'N/A');
        const itemName = name;
        const fnsku = base.FNSKU || '';
        const status = (!isEmptyValue(fnsku) && fnsku !== 'MISSING') ? '✅ READY' : '⚠️ MISSING FNSKU';
        const mrp = base.MRP || base['M.R.P'] || 'N/A';
        const fssai = base.FSSAI || base['M.F.G. FSSAI'] || 'N/A';
        const packetSize = base['Packet Size'] || 'N/A';
        const packetUsed = base['Packet used'] || 'N/A';
        const asin = base.ASIN || skuId;

        // Check if FNSKU is missing
        if (isEmptyValue(fnsku) || fnsku === 'MISSING') {
          missingProducts.push({
            ASIN: skuId,
            SKU_ID: skuId,
            Product: productName || name,
            Weight: weight || finalWeight,
            Issue: 'Missing FNSKU',
            Qty: qty
          });
        }

        physicalRows.push({
          item: itemName,
          item_name_for_labels: itemName, // Same as item for non-split products
          weight: finalWeight,
          Qty: qty,
          'Packet Size': packetSize,
          'Packet used': packetUsed,
          ASIN: asin,
          MRP: mrp,
          FNSKU: (!isEmptyValue(fnsku) && fnsku !== 'MISSING') ? fnsku : 'MISSING',
          FSSAI: fssai,
          'Packed Today': '',
          Available: '',
          Status: status,
          is_split: false // Not a split product
        });
      }
    } catch (error) {
      console.error(`[Flipkart Packing] Error processing order:`, error);
      const skuId = (orderRow.SKU || orderRow.sku || 'UNKNOWN').trim();
      missingProducts.push({
        ASIN: skuId,
        Issue: `Error processing: ${error instanceof Error ? error.message : 'Unknown error'}`,
        Qty: parseInt(String(orderRow.Qty || 1), 10)
      });
    }
  }

  // Group by all columns except Qty to sum quantities for identical items
  // Include is_split and item_name_for_labels in groupby to preserve split marking and label names
  const grouped = new Map<string, PhysicalItem>();
  
  for (const row of physicalRows) {
    // Create a key from all columns except Qty (matching Streamlit groupby)
    const key = [
      row.item,
      row.item_name_for_labels,
      row.weight,
      row['Packet Size'],
      row['Packet used'],
      row.ASIN,
      row.MRP,
      row.FNSKU,
      row.FSSAI,
      row['Packed Today'],
      row.Available,
      row.Status,
      String(row.is_split)
    ].join('|');
    
    if (grouped.has(key)) {
      const existing = grouped.get(key)!;
      existing.Qty += row.Qty;
    } else {
      grouped.set(key, { ...row });
    }
  }

  return {
    physicalItems: Array.from(grouped.values()),
    missingProducts
  };
};

