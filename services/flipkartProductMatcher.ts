import { MasterProduct } from '../types';
import { normalizeWeight, weightsMatch, findColumnFlexible } from './flipkartUtils';
import { isEmptyValue } from './utils';

/**
 * Match products in master data by FK SKU column (direct SKU matching)
 * 
 * Also checks "M" column if FK SKU match fails
 * 
 * @param skuId Full SKU ID from Flipkart invoice (e.g., "1 Sattu 1kg")
 * @param masterData Master data array with FK SKU and M columns
 * @returns Array of matching master products, or empty array if no match
 */
export const getProductFromFkSku = (
  skuId: string | null | undefined,
  masterData: MasterProduct[]
): MasterProduct[] => {
  if (!masterData || masterData.length === 0) {
    return [];
  }

  if (!skuId || isEmptyValue(skuId)) {
    return [];
  }

  // Check for FK SKU column (case-insensitive)
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

  if (!fkSkuColumn) {
    console.warn('[Flipkart Matcher] Master data missing "FK SKU" column');
    return [];
  }

  // Clean SKU ID - remove leading number and normalize
  let skuClean = String(skuId).trim();
  // Remove leading number if present
  skuClean = skuClean.replace(/^\d+\s+/, '').trim();

  // Try exact match first on FK SKU
  const exactMatch = masterData.filter(row => {
    const fkSkuValue = String(row[fkSkuColumn!] || '').trim().toLowerCase();
    return fkSkuValue === skuClean.toLowerCase();
  });

  if (exactMatch.length > 0) {
    console.log(`[Flipkart Matcher] Found FK SKU exact match for '${skuId}'`);
    return exactMatch;
  }

  // Try partial match (contains) on FK SKU
  const partialMatch = masterData.filter(row => {
    const fkSkuValue = String(row[fkSkuColumn!] || '').trim().toLowerCase();
    return fkSkuValue.includes(skuClean.toLowerCase()) || skuClean.toLowerCase().includes(fkSkuValue);
  });

  if (partialMatch.length > 0) {
    console.log(`[Flipkart Matcher] Found FK SKU partial match for '${skuId}'`);
    return partialMatch;
  }

  // Try reverse - check if master FK SKU is contained in invoice SKU
  const reverseMatch = masterData.filter(row => {
    const fkSkuValue = String(row[fkSkuColumn!] || '').trim().toLowerCase();
    return skuClean.toLowerCase().includes(fkSkuValue);
  });

  if (reverseMatch.length > 0) {
    console.log(`[Flipkart Matcher] Found FK SKU reverse match for '${skuId}'`);
    return reverseMatch;
  }

  // If M column exists, try matching with it
  if (mColumn) {
    const mExactMatch = masterData.filter(row => {
      const mValue = String(row[mColumn!] || '').trim().toLowerCase();
      return mValue === skuClean.toLowerCase();
    });

    if (mExactMatch.length > 0) {
      console.log(`[Flipkart Matcher] Found M column exact match for '${skuId}'`);
      return mExactMatch;
    }

    const mPartialMatch = masterData.filter(row => {
      const mValue = String(row[mColumn!] || '').trim().toLowerCase();
      return mValue.includes(skuClean.toLowerCase()) || skuClean.toLowerCase().includes(mValue);
    });

    if (mPartialMatch.length > 0) {
      console.log(`[Flipkart Matcher] Found M column partial match for '${skuId}'`);
      return mPartialMatch;
    }
  }

  console.warn(`[Flipkart Matcher] No FK SKU match found for '${skuId}'`);
  return [];
};

/**
 * Match products in master data by product name and weight
 * 
 * Uses fuzzy matching to handle variations in product names.
 * Matches by:
 * 1. Exact name + weight match
 * 2. Normalized weight match + name contains
 * 3. Normalized weight match + partial name match
 * 4. Name match only (if weight not provided)
 * 5. Key word matching (remove common descriptors)
 * 
 * @param productName Product name from SKU ID (e.g., "Sattu", "Bihari Coconut Thekua")
 * @param weight Weight from SKU ID (e.g., "1kg", "350g")
 * @param masterData Master data array with Name and Net Weight columns
 * @returns Array of matching master products, or empty array if no match
 */
export const getProductFromNameWeight = (
  productName: string | null | undefined,
  weight: string | null | undefined,
  masterData: MasterProduct[]
): MasterProduct[] => {
  if (!masterData || masterData.length === 0) {
    return [];
  }

  if (!productName || isEmptyValue(productName)) {
    return [];
  }

  // Use flexible column matching for Name and Net Weight
  const nameCol = findColumnFlexible(masterData, ['Name']);
  const netWeightCol = findColumnFlexible(masterData, ['Net Weight', 'NetWeight']);

  if (!nameCol || !netWeightCol) {
    console.warn(`[Flipkart Matcher] Master data missing 'Name' or 'Net Weight' columns. Found: ${Object.keys(masterData[0] || {}).join(', ')}`);
    return [];
  }

  // Normalize weight for comparison
  const weightNormalized = weight ? normalizeWeight(weight) : null;

  // Normalize master data weights (pre-compute for efficiency)
  const masterDataWithNormalized = masterData.map(row => ({
    ...row,
    _normalizedWeight: normalizeWeight(String(row[netWeightCol] || ''))
  }));

  // Strategy 1: Exact name match + weight match
  if (weightNormalized) {
    const exactNameMatch = masterDataWithNormalized.filter(row => {
      const rowName = String(row[nameCol] || '').trim().toLowerCase();
      const rowWeight = row._normalizedWeight;
      return rowName === productName.trim().toLowerCase() && rowWeight === weightNormalized;
    });

    if (exactNameMatch.length > 0) {
      console.log(`[Flipkart Matcher] Found exact match for '${productName}' ${weight}`);
      return exactNameMatch.map(({ _normalizedWeight, ...rest }) => rest);
    }
  }

  // Strategy 2: Name contains + weight match
  if (weightNormalized) {
    const nameContainsMatch = masterDataWithNormalized.filter(row => {
      const rowName = String(row[nameCol] || '').trim().toLowerCase();
      const rowWeight = row._normalizedWeight;
      return rowName.includes(productName.trim().toLowerCase()) && rowWeight === weightNormalized;
    });

    if (nameContainsMatch.length > 0) {
      console.log(`[Flipkart Matcher] Found name contains match for '${productName}' ${weight}`);
      return nameContainsMatch.map(({ _normalizedWeight, ...rest }) => rest);
    }
  }

  // Strategy 3: Partial name match (split product name into words)
  if (weightNormalized) {
    const productWords = productName
      .split(' ')
      .map(w => w.trim())
      .filter(w => w.length > 2);

    for (const word of productWords) {
      const partialMatch = masterDataWithNormalized.filter(row => {
        const rowName = String(row[nameCol] || '').trim().toLowerCase();
        const rowWeight = row._normalizedWeight;
        return rowName.includes(word.toLowerCase()) && rowWeight === weightNormalized;
      });

      if (partialMatch.length > 0) {
        console.log(`[Flipkart Matcher] Found partial match for '${productName}' ${weight} using word '${word}'`);
        return partialMatch.map(({ _normalizedWeight, ...rest }) => rest);
      }
    }
  }

  // Strategy 4: Name match only (if weight not provided)
  if (!weightNormalized) {
    const nameOnlyMatch = masterData.filter(row => {
      const rowName = String(row[nameCol] || '').trim().toLowerCase();
      return rowName.includes(productName.trim().toLowerCase());
    });

    if (nameOnlyMatch.length > 0) {
      console.log(`[Flipkart Matcher] Found name-only match for '${productName}' (no weight)`);
      return nameOnlyMatch;
    }
  }

  // Strategy 5: Try matching common product name variations
  // Handle cases like "Sattu" vs "Bihari Chana Sattu"
  if (weightNormalized) {
    // Extract key product words (remove common descriptors)
    const commonDescriptors = ['bihari', 'mithila', 'foods', 'desi', 'plain', 'high', 'protein'];
    const keyWords = productName
      .split(' ')
      .map(w => w.trim())
      .filter(w => {
        const wordLower = w.toLowerCase();
        return w.length > 2 && !commonDescriptors.includes(wordLower);
      });

    if (keyWords.length > 0) {
      // Try matching with key words
      for (const keyWord of keyWords) {
        const keyMatch = masterDataWithNormalized.filter(row => {
          const rowName = String(row[nameCol] || '').trim().toLowerCase();
          const rowWeight = row._normalizedWeight;
          return rowName.includes(keyWord.toLowerCase()) && rowWeight === weightNormalized;
        });

        if (keyMatch.length > 0) {
          console.log(`[Flipkart Matcher] Found key word match for '${productName}' ${weight} using '${keyWord}'`);
          return keyMatch.map(({ _normalizedWeight, ...rest }) => rest);
        }
      }
    }
  }

  console.warn(`[Flipkart Matcher] No match found for product '${productName}' with weight '${weight}'`);
  return [];
};

