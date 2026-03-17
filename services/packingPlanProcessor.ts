import { MasterProduct, OrderItem, PhysicalItem, MissingProduct } from '../types';
import { isEmptyValue } from './utils';

/**
 * Create ASIN lookup dictionary for O(1) lookups
 */
export const createASINLookupDict = (masterData: MasterProduct[]): Map<string, MasterProduct> => {
  const lookup = new Map<string, MasterProduct>();
  
  for (const row of masterData) {
    const asin = String(row.ASIN || '').trim();
    if (asin && !lookup.has(asin)) {
      lookup.set(asin, row);
    }
  }
  
  return lookup;
};

/**
 * Expand orders to physical packing plan with split logic support.
 * 
 * This function processes order items and expands them into physical packing plan items.
 * It handles split products (products that can be split into multiple weight variants)
 * and regular products.
 * 
 * ## Split Logic Overview
 * 
 * When a product has a "Split Into" field in the master data, it needs to be expanded
 * into multiple physical items based on weight variants.
 * 
 * Example: "Coconut Thekua" (0.7kg) with Split Into "0.35, 0.35" becomes:
 * - "Coconut Thekua 0.7" (item) -> "Coconut Thekua 0.35" (split variant 1)
 * - "Coconut Thekua 0.7" (item) -> "Coconut Thekua 0.35" (split variant 2)
 * 
 * ## Algorithm Steps
 * 
 * 1. Check for split information in master data
 * 2. Extract base product information (name, weight, ASIN, etc.)
 * 3. Construct original name with weight for split products
 * 4. Process split variants (if split exists) or use base product
 * 5. Group identical items and sum quantities
 * 
 * ## Edge Cases Handled
 * 
 * - Missing master data: Creates "UNKNOWN PRODUCT" entry
 * - Missing split variants: Adds to missingProducts list
 * - Empty split field: Treats as regular product
 * - Weight normalization: Handles weights with/without "kg" suffix, integers, floats, strings
 * - Missing FNSKU: Marks as "MISSING" but still creates physical row
 * - Quantity aggregation: Groups identical items and sums quantities
 * 
 * @param orders - Array of order items with ASIN and Qty
 * @param masterData - Array of master product data
 * @param asinLookupDict - Optional pre-built ASIN lookup dictionary for performance
 * @returns Object containing physicalItems array and missingProducts array
 */
export const expandToPhysical = (
  orders: OrderItem[],
  masterData: MasterProduct[],
  asinLookupDict?: Map<string, MasterProduct>
): { physicalItems: PhysicalItem[]; missingProducts: MissingProduct[] } => {
  const physicalRows: PhysicalItem[] = [];
  const missingProducts: MissingProduct[] = [];

  // Create lookup dictionary if not provided
  if (!asinLookupDict) {
    asinLookupDict = createASINLookupDict(masterData);
  }

  // Create ASIN to index mapping for faster lookups
  const asinToIndex = new Map<string, number>();
  masterData.forEach((row, idx) => {
    const asin = String(row.ASIN || '').trim();
    if (asin && !asinToIndex.has(asin)) {
      asinToIndex.set(asin, idx);
    }
  });

  for (const orderRow of orders) {
    try {
      const asin = orderRow.ASIN || 'UNKNOWN';
      const qty = parseInt(String(orderRow.Qty || 1), 10);

      // Find matching product in master data
      let matchRow: MasterProduct | undefined;
      
      if (asinToIndex.has(asin)) {
        const matchIdx = asinToIndex.get(asin)!;
        matchRow = masterData[matchIdx];
      } else if (asinLookupDict.has(asin)) {
        matchRow = asinLookupDict.get(asin);
      }

      if (!matchRow) {
        console.warn(`Product not found in master file: ${asin}`);
        missingProducts.push({
          ASIN: asin,
          Issue: 'Not found in master file',
          Qty: qty
        });

        physicalRows.push({
          item: `UNKNOWN PRODUCT (${asin})`,
          item_name_for_labels: `UNKNOWN PRODUCT (${asin})`,
          weight: 'N/A',
          Qty: qty,
          'Packet Size': 'N/A',
          'Packet used': 'N/A',
          ASIN: asin,
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

      // ============================================
      // STEP 1: Extract Base Product Information
      // ============================================
      const base = matchRow;
      const name = base.Name || 'Unknown Product';
      // Note: asin and qty are already declared above (lines 82-83)
      
      // Diagnostic: Log all available columns for first product to help identify split column
      if (orders.indexOf(orderRow) === 0) {
        console.log(`[Split Logic] 🔍 Diagnostic: All available columns for first product "${name}":`, {
          allColumns: Object.keys(base),
          columnCount: Object.keys(base).length,
          sampleValues: Object.keys(base).slice(0, 15).map(key => ({
            column: key,
            value: String(base[key] || '').substring(0, 50) // First 50 chars
          }))
        });
      }

      // ============================================
      // STEP 2: Check for Split Information
      // ============================================
      // Check if product has split information
      // Split Into field contains comma-separated list of split sizes (e.g., "0.35, 0.35" or "2.0,1.0")
      // Note: Column K in Google Sheets contains "Split Into"
      // Try multiple field name variations in case of CSV parsing issues
      // Also check for direct column references like "K" or "Column K"
      // Dynamically search all keys to find split column (handles CSV header variations)
      let split = '';
      let splitFieldName = '';
      
      // First, try known field name variations
      const knownVariations = [
        'Split Into', 'SplitInto', 'split into', 'splitinto',
        'Split', 'split', 'K', 'Column K', 'column k', 'column K'
      ];
      
      for (const fieldName of knownVariations) {
        const value = base[fieldName];
        if (value !== undefined && value !== null && !isEmptyValue(String(value))) {
          split = String(value).trim();
          splitFieldName = fieldName;
          break;
        }
      }
      
      // If not found in known variations, dynamically search all keys
      if (!split) {
        const allKeys = Object.keys(base);
        for (const key of allKeys) {
          const keyLower = key.toLowerCase().trim();
          // Check if key contains "split" or is exactly "k" (for Column K)
          // Also check if value contains comma (likely split values like "2.0,1.0")
          if (keyLower.includes('split') || keyLower === 'k' || keyLower === 'column k') {
            const value = base[key];
            if (value !== undefined && value !== null && !isEmptyValue(String(value))) {
              const valueStr = String(value).trim();
              // Check if value looks like split data (contains comma-separated numbers)
              if (valueStr.includes(',') || /^\d+\.?\d*/.test(valueStr)) {
                split = valueStr;
                splitFieldName = key;
                console.log(`[Split Logic] Found split field dynamically: "${key}" = "${split}" for product "${name}"`);
                break;
              }
            }
          }
        }
        
        // If still not found, try searching for any column with comma-separated numeric values
        if (!split) {
          for (const key of allKeys) {
            const value = base[key];
            if (value !== undefined && value !== null) {
              const valueStr = String(value).trim();
              // Check if value looks like split data (contains comma-separated numbers like "2.0,1.0")
              if (valueStr.includes(',') && /^[\d\.\s,]+$/.test(valueStr.replace(/\s/g, ''))) {
                split = valueStr;
                splitFieldName = key;
                console.log(`[Split Logic] Found split field by pattern matching: "${key}" = "${split}" for product "${name}"`);
                break;
              }
            }
          }
        }
      }
      
      const hasSplit = split && split !== '' && !isEmptyValue(split);
      
      // ============================================
      // STEP 3: Extract Base Weight with Robust Handling
      // ============================================
      // Match Streamlit: Handle weights that may be:
      // - Numbers (int or float): 0.7, 0.35
      // - Strings with "kg" suffix: "0.7kg", "0.35kg"
      // - Strings without suffix: "0.7", "0.35"
      // - null/undefined/NaN/empty: treated as missing
      let baseWeight = '';
      let baseWeightRaw: any = null;
      
      // Match Streamlit: Try multiple methods to access Net Weight column
      try {
        // Method 1: Try direct access (most reliable if column exists)
        if ('Net Weight' in base) {
          baseWeightRaw = base['Net Weight'];
        } else if ('NetWeight' in base) {
          baseWeightRaw = base['NetWeight'];
        } else {
          // Method 2: Try .get() with variations
          baseWeightRaw = base['Net Weight'];
          if (baseWeightRaw === undefined || baseWeightRaw === null) {
            baseWeightRaw = base['NetWeight'];
          }
        }
      } catch (error) {
        // Method 3: Fallback to .get() with default
        baseWeightRaw = base['Net Weight'];
        if (baseWeightRaw === undefined || baseWeightRaw === null) {
          baseWeightRaw = base['NetWeight'];
        }
      }
      
      // Match Streamlit: Convert to string, handling all numeric types (int, float) and strings
      if (baseWeightRaw !== null && baseWeightRaw !== undefined) {
        // Check for NaN (JavaScript doesn't have pd.isna, but we can check)
        const isNaNValue = typeof baseWeightRaw === 'number' && isNaN(baseWeightRaw);
        if (!isNaNValue && !isEmptyValue(baseWeightRaw)) {
          // Handle numeric types (int/float) - explicitly check for both
          if (typeof baseWeightRaw === 'number') {
            // Convert integer or float to string (e.g., 1 -> "1", 0.7 -> "0.7")
            baseWeight = String(baseWeightRaw).trim();
            console.log(`[Weight Extraction] ✓ Extracted ${typeof baseWeightRaw} weight for ${name}: ${baseWeightRaw} (type: ${typeof baseWeightRaw}) -> '${baseWeight}'`);
          } else {
            // Handle string types
            baseWeight = String(baseWeightRaw).trim();
            console.log(`[Weight Extraction] ✓ Extracted STRING weight for ${name}: '${baseWeightRaw}' (type: ${typeof baseWeightRaw}) -> '${baseWeight}'`);
          }
        } else {
          console.warn(`[Weight Extraction] ✗ No weight found for ${name}: raw=${baseWeightRaw}, is_none=${baseWeightRaw === null}, is_undefined=${baseWeightRaw === undefined}, is_NaN=${isNaNValue}`);
        }
      } else {
        console.warn(`[Weight Extraction] ✗ No weight to append for split product: '${name}' (base_weight: ${baseWeightRaw}, raw: ${baseWeightRaw}, type: ${typeof baseWeightRaw})`);
      }

      // Debug logging for split detection (after baseWeight is initialized)
      if (hasSplit) {
        console.log(`[Split Logic] ✅ Found split product: "${name}" (ASIN: ${asin})`, {
          splitInto: split,
          fieldFound: splitFieldName || 'unknown',
          baseWeight: baseWeight || 'N/A',
          baseProduct: {
            name: base.Name,
            weight: base['Net Weight'] || base['NetWeight'],
            asin: base.ASIN
          },
          allAvailableKeys: Object.keys(base).slice(0, 20) // Show first 20 keys for debugging
        });
      } else {
        // Log when split field is checked but not found (for debugging)
        // Only log for first few products to avoid console spam
        const allKeys = Object.keys(base);
        const hasSplitKey = allKeys.some(key => {
          const keyLower = key.toLowerCase().trim();
          return keyLower.includes('split') || keyLower === 'k' || keyLower === 'column k';
        });
        
        // Log detailed info for debugging (only for first product to avoid spam)
        if (orders.indexOf(orderRow) === 0 && hasSplitKey) {
          console.log(`[Split Logic] ⚠️ Product "${name}" (ASIN: ${asin}) has split-related keys but no valid split value:`, {
            availableKeys: allKeys.filter(key => {
              const keyLower = key.toLowerCase().trim();
              return keyLower.includes('split') || keyLower === 'k' || keyLower === 'column k';
            }),
            values: allKeys.filter(key => {
              const keyLower = key.toLowerCase().trim();
              return keyLower.includes('split') || keyLower === 'k' || keyLower === 'column k';
            }).map(key => ({ key, value: base[key], type: typeof base[key] })),
            allKeys: allKeys // Show all keys for first product to help identify the correct column name
          });
        }
      }

      // ============================================
      // STEP 4: Construct Original Name with Weight
      // ============================================
      // Match Streamlit: For split products, append weight to original name for display
      // Example: "Coconut Thekua" + "0.7" = "Coconut Thekua 0.7"
      // The weight display removes "kg" suffix if present for cleaner display
      let originalNameWithWeight = name;
      if (baseWeight && !isEmptyValue(baseWeight)) {
        // Match Streamlit: Check if it's a valid non-empty value
        const isWeightEmpty = isEmptyValue(baseWeight);
        if (!isWeightEmpty) {
          // Match Streamlit: Normalize weight - remove "kg" suffix if present for cleaner display
          // Handles: "0.7kg" -> "0.7", "1kg" -> "1", "0.7" -> "0.7", "1" -> "1"
          const weightDisplay = baseWeight.toLowerCase().endsWith('kg')
            ? baseWeight.replace(/kg/gi, '').trim()
            : baseWeight.trim();
          originalNameWithWeight = `${name} ${weightDisplay}`;
          console.log(`[Split Logic] ✓✓✓ SUCCESS: Added weight to split product name: '${name}' -> '${originalNameWithWeight}' (weight_display: '${weightDisplay}', base_weight: '${baseWeight}')`);
        } else {
          console.warn(`[Split Logic] ✗ Weight is empty for ${name}: base_weight='${baseWeight}', is_empty_value=${isWeightEmpty}`);
        }
      } else {
        console.warn(`[Split Logic] ✗ No weight to append for split product: '${name}' (base_weight: ${baseWeight}, raw: ${baseWeightRaw}, type: ${typeof baseWeightRaw})`);
      }

      // Extract FNSKU for validation
      const fnsku = String(base.FNSKU || '').trim();

      // ============================================
      // STEP 5: Check if FNSKU is Missing (for base product)
      // ============================================
      // Note: For split products, we check FNSKU per variant
      if (isEmptyValue(fnsku)) {
        missingProducts.push({
          ASIN: asin,
          Issue: 'Missing FNSKU',
          Product: name,
          Qty: qty
        });
      }

      // ============================================
      // STEP 6: Process Split Variants or Base Product
      // ============================================
      if (hasSplit) {
        // ============================================
        // STEP 6A: Handle Products with Split Information
        // ============================================
        // Parse split sizes from comma-separated string
        // Example: "0.35, 0.35" -> ["0.35", "0.35"]
        // Example: "2.0,1.0" -> ["2.0", "1.0"]
        // Normalize by removing "kg" suffix and trimming
        const sizes = split.split(',').map(s => s.trim().replace(/kg/gi, '').trim()).filter(s => s !== '');
        let splitFound = false;
        
        console.log(`[Split Logic] Parsed split sizes from "${split}":`, {
          raw: split,
          parsed: sizes,
          count: sizes.length
        });
        
        if (sizes.length === 0) {
          console.warn(`[Split Logic] ⚠️ No valid split sizes found after parsing "${split}"`);
        }

        // Helper function to normalize weight for comparison
        // Handles: "1" vs "1.0" vs "1kg" vs "1.0kg" - all should match
        const normalizeWeightForComparison = (w: string): number | null => {
          const trimmed = w.trim().replace(/kg/gi, '').trim();
          const num = parseFloat(trimmed);
          return !isNaN(num) ? num : null;
        };

        // Find all products with matching name (for debugging and fallback)
        const productsWithMatchingName = masterData.filter((row) => {
          const productName = String(row.Name || '').trim().toLowerCase();
          return productName === name.toLowerCase().trim();
        });

        console.log(`[Split Logic] Processing split for "${name}" (ASIN: ${asin}, Qty: ${qty})`, {
          splitInto: split,
          splitSizes: sizes,
          baseWeight: baseWeight || 'N/A',
          originalNameWithWeight: originalNameWithWeight,
          availableVariants: productsWithMatchingName.map(p => ({
            name: p.Name,
            weight: p['Net Weight'] || p['NetWeight'],
            asin: p.ASIN,
            fnsku: p.FNSKU
          })),
          totalVariantsToCreate: sizes.length
        });
        
        // Split expansion debug logging
        console.log(`[Split Expansion] Order: ASIN=${asin}, Qty=${qty}, SplitInto="${split}"`);
        console.log(`[Split Expansion] Created ${sizes.length} variants, each with Qty=${qty}`);

        // For each split size, find matching variant in master data
        // IMPORTANT: Each split size gets the FULL order quantity (not divided)
        // Example: Order Qty: 1, Split Into "1, 2" → creates 1kg (Qty: 1) + 2kg (Qty: 1)
        for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex++) {
          const size = sizes[sizeIndex];
          try {
            console.log(`[Split Logic] Processing split size ${sizeIndex + 1}/${sizes.length}: "${size}" for "${name}"`);
            const normalizedSizeNum = normalizeWeightForComparison(size);
            
            if (normalizedSizeNum === null) {
              console.warn(`[Split Logic] Invalid split size "${size}" for "${name}" - skipping. Raw value: "${size}"`);
              continue;
            }
            
            console.log(`[Split Logic] Normalized split size "${size}" to number: ${normalizedSizeNum}`);

            // Find variant in master data where:
            // - Name matches original product name (case-insensitive, trimmed)
            // - Net Weight (normalized) matches split size (with tolerance for floating point)
            console.log(`[Split Logic] Searching for variant matching name "${name}" and weight "${size}" (normalized: ${normalizedSizeNum})`);
            let variant = masterData.find((row) => {
              const productName = String(row.Name || '').trim();
              const productWeightRaw = row['Net Weight'] || row['NetWeight'] || '';
              
              // Normalize weight: handle number, string, with/without "kg" suffix
              let productWeight = '';
              if (productWeightRaw !== null && productWeightRaw !== undefined) {
                if (typeof productWeightRaw === 'number' && !isNaN(productWeightRaw)) {
                  productWeight = String(productWeightRaw).trim();
                } else {
                  const strWeight = String(productWeightRaw).trim();
                  if (!isEmptyValue(strWeight)) {
                    productWeight = strWeight.replace(/kg/gi, '').trim();
                  }
                }
              }
              
              // Normalize names for comparison (trim and case-insensitive)
              const normalizedProductName = productName.toLowerCase().trim();
              const normalizedBaseName = name.toLowerCase().trim();
              
              // Normalize product weight to number for comparison
              const normalizedProductWeightNum = normalizeWeightForComparison(productWeight);
              
              // Match: name must match (case-insensitive) and weight must match (with tolerance)
              const nameMatches = normalizedProductName === normalizedBaseName;
              
              // Use fuzzy matching for weights (tolerance of 0.01 for floating point precision)
              let weightMatches = false;
              if (normalizedProductWeightNum !== null && normalizedSizeNum !== null) {
                weightMatches = Math.abs(normalizedProductWeightNum - normalizedSizeNum) < 0.01;
              }
              
              return nameMatches && weightMatches;
            });
            
            if (variant) {
              console.log(`[Split Logic] Found exact variant match for "${name}" size "${size}":`, {
                name: variant.Name,
                weight: variant['Net Weight'] || variant['NetWeight'],
                asin: variant.ASIN,
                fnsku: variant.FNSKU
              });
            } else {
              console.log(`[Split Logic] No exact variant match found for "${name}" size "${size}" - trying closest match`);
            }
            
            // If exact match not found, try to find closest match
            if (!variant && productsWithMatchingName.length > 0) {
              let closestVariant: MasterProduct | null = null;
              let closestDiff = Infinity;
              
              for (const candidate of productsWithMatchingName) {
                const candidateWeightRaw = candidate['Net Weight'] || candidate['NetWeight'] || '';
                let candidateWeight = '';
                if (candidateWeightRaw !== null && candidateWeightRaw !== undefined) {
                  if (typeof candidateWeightRaw === 'number' && !isNaN(candidateWeightRaw)) {
                    candidateWeight = String(candidateWeightRaw).trim();
                  } else {
                    const strWeight = String(candidateWeightRaw).trim();
                    if (!isEmptyValue(strWeight)) {
                      candidateWeight = strWeight.replace(/kg/gi, '').trim();
                    }
                  }
                }
                
                const candidateWeightNum = normalizeWeightForComparison(candidateWeight);
                if (candidateWeightNum !== null) {
                  const diff = Math.abs(candidateWeightNum - normalizedSizeNum);
                  if (diff < closestDiff && diff < 0.1) { // Within 0.1 tolerance
                    closestDiff = diff;
                    closestVariant = candidate;
                  }
                }
              }
              
              if (closestVariant) {
                console.log(`[Split Logic] Using closest match for "${name}" size "${size}": found weight ${closestVariant['Net Weight'] || closestVariant['NetWeight']}`);
                variant = closestVariant;
              }
            }

            // Create physical row - use variant if found, otherwise use base product with split size
            let variantToUse: MasterProduct;
            let isExactMatch = false;
            let finalWeight = '';
            
            if (variant) {
              variantToUse = variant;
              isExactMatch = true;
              splitFound = true;
              // Use variant's actual weight from master data
              finalWeight = String(variant['Net Weight'] || variant['NetWeight'] || size);
            } else {
              // Variant not found - use base product but mark as missing variant
              variantToUse = base;
              // Use the split size as weight (normalize to match format in master data)
              // Try to match the format used in master data (e.g., "2.0" or "2" or "2kg")
              finalWeight = String(normalizedSizeNum);
              
              console.warn(`[Split Logic] Variant not found for "${name}" with split size "${size}" - using base product`, {
                productName: name,
                splitSize: size,
                normalizedSizeNum,
                usingWeight: finalWeight,
                availableProductsWithSameName: productsWithMatchingName.map(p => ({
                  name: p.Name,
                  weight: p['Net Weight'] || p['NetWeight'],
                  normalizedWeight: normalizeWeightForComparison(String(p['Net Weight'] || p['NetWeight'] || '')),
                  asin: p.ASIN
                }))
              });
            }

            // Create physical row for this split variant
            // IMPORTANT: Each split size gets the FULL order quantity (qty), not divided
            // Example: Order Qty: 1, Split Into "1, 2" → creates 1kg (Qty: 1) + 2kg (Qty: 1)
            // After grouping, identical weights sum up: 1kg items group together
            const variantFnsku = String(variantToUse.FNSKU || '').trim();
            
            const status = (variantFnsku && !isEmptyValue(variantFnsku))
              ? '✅ READY'
              : isExactMatch 
                ? '⚠️ MISSING FNSKU'
                : '⚠️ MISSING VARIANT';

            // Match Streamlit: Use ORIGINAL product name WITH BASE weight (e.g., "Coconut Thekua 0.7")
            // NOT the variant weight. The variant weight goes in the weight column.
            // Streamlit line 746: "item": original_name_with_weight  # Original name with weight (e.g., "Coconut Thekua 0.7")
            // Streamlit line 748: "weight": sub.get("Net Weight", "N/A")  # Split variant weight (e.g., "0.35")
            physicalRows.push({
              item: originalNameWithWeight,        // Original name with BASE weight (e.g., "Coconut Thekua 0.7") - for PDF display
              item_name_for_labels: name,          // Original name without weight (e.g., "Coconut Thekua") - for labels
              weight: finalWeight || 'N/A',        // Split variant weight (e.g., "0.35")
              Qty: qty,  // FULL order quantity for each split size
              'Packet Size': String(variantToUse['Packet Size'] || 'N/A'),
              'Packet used': String(variantToUse['Packet used'] || 'N/A'),
              ASIN: variantToUse.ASIN || asin,
              MRP: String(variantToUse['M.R.P'] || variantToUse.MRP || 'N/A'),
              FNSKU: !isEmptyValue(variantFnsku) ? variantFnsku : 'MISSING',
              FSSAI: String(variantToUse.FSSAI || variantToUse['M.F.G. FSSAI'] || 'N/A'),
              'Packed Today': '',
              Available: '',
              Status: status,
              is_split: true  // Flag indicating this is a split product
            });
            
            console.log(`[Split Logic] ✅ Created split item: "${originalNameWithWeight}" (Weight: ${finalWeight || 'N/A'}), Qty: ${qty}, Status: ${status}, Match: ${isExactMatch ? 'exact' : 'missing variant'}`);
            
            // Verify item was added
            const lastItem = physicalRows[physicalRows.length - 1];
            if (lastItem && lastItem.is_split && lastItem.item === originalNameWithWeight) {
              console.log(`[Split Logic] ✓ Verified: Split item added to physicalRows array`);
            } else {
              console.error(`[Split Logic] ✗ ERROR: Split item was NOT added correctly!`, {
                expected: originalNameWithWeight,
                lastItem: lastItem ? { item: lastItem.item, is_split: lastItem.is_split } : 'null'
              });
            }
          } catch (error) {
            console.error(`[Split Logic] ❌ Error processing split variant for ${name} (size: ${size}):`, error);
          }
        }

        // Log summary of created split items
        // Note: Check by item_name_for_labels and original ASIN, but also accept variant ASINs
        // since split variants might have different ASINs in master data
        const createdSplitItems = physicalRows.filter(row => 
          row.is_split && 
          row.item_name_for_labels === name &&
          (row.ASIN === asin || row.item === originalNameWithWeight)
        );
        
        if (createdSplitItems.length > 0) {
          console.log(`[Split Logic] ✅ Successfully created ${createdSplitItems.length} split item(s) for "${name}":`, 
            createdSplitItems.map(item => ({
              item: item.item,
              weight: item.weight,
              qty: item.Qty,
              asin: item.ASIN,
              status: item.Status
            }))
          );
        } else if (sizes.length > 0 && splitFound) {
          // Only warn if we expected to create items but didn't
          // splitFound=true means at least one variant was found and processed
          console.warn(`[Split Logic] ⚠️ Expected to create split items for "${name}" (ASIN: ${asin}) but verification found none.`, {
            splitInto: split,
            splitSizes: sizes,
            totalSizes: sizes.length,
            splitFound: splitFound,
            totalPhysicalRows: physicalRows.length,
            allSplitItems: physicalRows.filter(r => r.is_split).length
          });
        }
      } else {
        // ============================================
        // STEP 6B: Handle Non-Split Products
        // ============================================
        // No split information - use base product as-is
        const status = !isEmptyValue(fnsku) ? '✅ READY' : '⚠️ MISSING FNSKU';

        physicalRows.push({
          item: name,                                // Product name (no weight appended for non-split)
          item_name_for_labels: name,                // Same as item for non-split products
          weight: String(base['Net Weight'] || base['NetWeight'] || 'N/A'),
          Qty: qty,
          'Packet Size': String(base['Packet Size'] || 'N/A'),
          'Packet used': String(base['Packet used'] || 'N/A'),
          ASIN: asin,
          MRP: String(base['M.R.P'] || base.MRP || 'N/A'),
          FNSKU: !isEmptyValue(fnsku) ? fnsku : 'MISSING',
          FSSAI: String(base.FSSAI || base['M.F.G. FSSAI'] || 'N/A'),
          'Packed Today': '',
          Available: '',
          Status: status,
          is_split: false  // Not a split product
        });
      }
    } catch (error) {
      console.error(`Error processing row ${orderRow.ASIN}:`, error);
      continue;
    }
  }

  // ============================================
  // STEP 7: Group and Aggregate Identical Items
  // ============================================
  // Group by all columns except Qty to sum quantities for identical items
  // This handles cases where the same product appears in multiple orders
  // Example: If "Coconut Thekua 0.35" appears in 2 orders with qty 1 each,
  // they will be grouped into a single row with qty 2
  
  // Grouping debug logging - before grouping
  console.log(`[Grouping] Before grouping: ${physicalRows.length} rows`);
  console.log(`[Grouping] Total Qty before grouping:`, 
    physicalRows.reduce((sum, r) => sum + r.Qty, 0));
  
  const grouped = new Map<string, PhysicalItem>();
  
  for (const row of physicalRows) {
    // Create a unique key from all columns except Qty
    // This ensures identical items (same product, weight, packet, FNSKU, etc.) are grouped together
    const key = JSON.stringify({
      item: row.item,
      item_name_for_labels: row.item_name_for_labels,
      weight: row.weight,
      'Packet Size': row['Packet Size'],
      'Packet used': row['Packet used'],
      ASIN: row.ASIN,
      MRP: row.MRP,
      FNSKU: row.FNSKU,
      FSSAI: row.FSSAI,
      'Packed Today': row['Packed Today'],
      Available: row.Available,
      Status: row.Status,
      is_split: row.is_split
    });

    if (grouped.has(key)) {
      // Item already exists - sum the quantities
      grouped.get(key)!.Qty += row.Qty;
    } else {
      // New item - add to grouped map
      grouped.set(key, { ...row });
    }
  }

  // Convert grouped map to array of physical items
  const physicalItems = Array.from(grouped.values());
  
  // Grouping debug logging - after grouping
  console.log(`[Grouping] After grouping: ${physicalItems.length} items`);
  console.log(`[Grouping] Total Qty after grouping:`, 
    physicalItems.reduce((sum, r) => sum + r.Qty, 0));
  
  // Debug logging: Count split items
  const splitItemsCount = physicalItems.filter(item => item.is_split).length;
  const regularItemsCount = physicalItems.filter(item => !item.is_split).length;
  
  console.log(`[Split Logic] 📊 Final Summary:`, {
    totalPhysicalItems: physicalItems.length,
    splitItems: splitItemsCount,
    regularItems: regularItemsCount,
    splitItemsList: physicalItems
      .filter(item => item.is_split)
      .map(item => ({ item: item.item, weight: item.weight, qty: item.Qty }))
      .slice(0, 10) // Show first 10 split items
  });
  
  if (splitItemsCount > 0) {
    console.log(`[Split Logic] ✅ Successfully created ${splitItemsCount} split item(s) in physical plan`);
  } else {
    console.warn(`[Split Logic] ⚠️ No split items found in final physical plan. Check if split field is being read correctly from Google Sheets.`);
  }

  return { physicalItems, missingProducts };
};

