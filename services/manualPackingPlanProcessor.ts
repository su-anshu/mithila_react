import * as XLSX from 'xlsx';
import { MasterProduct } from '../types';
import { isEmptyValue } from './utils';

export interface ProcessedManualPlanRow {
  'Row Labels': string;
  'Sum of Units Ordered'?: number;
  'Total Weight Sold (kg)'?: number;
  'Contribution %'?: number;
  'Pouch Size'?: string;
  'ASIN'?: string;
  [key: string]: any;
}

export interface ProcessedManualPlan {
  rows: ProcessedManualPlanRow[];
  parentItems: string[];
}

export interface ManualPlanItemBlock {
  item: string;
  target_weight: number;
  packed_weight: number;
  loose_weight: number;
  data: ManualPlanVariation[];
}

export interface ManualPlanVariation {
  'Variation (kg)': number;
  'Pouch Size': string;
  'ASIN': string;
  'Packets to Pack': number;
  'Weight Packed (kg)': number;
}

/**
 * Round to nearest 2 with validation
 */
export const roundToNearest2 = (x: number | null | undefined): number => {
  try {
    if (x === null || x === undefined || isNaN(Number(x))) {
      return 0;
    }
    return Math.floor(2 * Math.round(Number(x) / 2));
  } catch {
    return 0;
  }
};

/**
 * Process uploaded Excel file for manual packing plan
 * 
 * @param file Excel file
 * @returns Processed data with parent items and calculated weights
 */
export const processManualPlanFile = async (file: File): Promise<ProcessedManualPlan> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        // Clean column names
        const processedRows: ProcessedManualPlanRow[] = jsonData.map((row: any) => {
          const cleanedRow: any = {};
          for (const key of Object.keys(row)) {
            cleanedRow[key.trim()] = row[key];
          }
          return cleanedRow;
        });

        // Ensure required columns exist
        if (!processedRows[0] || !('Row Labels' in processedRows[0])) {
          reject(new Error('File must contain a "Row Labels" column'));
          return;
        }

        // Add missing columns with defaults
        for (const row of processedRows) {
          if (!('Pouch Size' in row)) {
            row['Pouch Size'] = 'N/A';
          }
          if (!('ASIN' in row)) {
            row['ASIN'] = 'N/A';
          }
          row['Total Weight Sold (kg)'] = null;
        }

        // Identify parent items (non-numeric row labels)
        const parentIndices: number[] = [];
        for (let idx = 0; idx < processedRows.length; idx++) {
          const row = processedRows[idx];
          const item = String(row['Row Labels'] || '').trim();
          // Check if it's not a number (parent item)
          if (item && !item.replace('.', '').match(/^\d+$/)) {
            parentIndices.push(idx);
          }
        }

        // Calculate weights for numeric rows (child items)
        for (let idx = 0; idx < processedRows.length; idx++) {
          const row = processedRows[idx];
          const item = String(row['Row Labels'] || '').trim();
          
          // If it's a number (weight), calculate total weight
          if (item.replace('.', '').match(/^\d+$/)) {
            try {
              const weight = parseFloat(item);
              const units = parseFloat(String(row['Sum of Units Ordered'] || 0));
              if (!isNaN(units)) {
                processedRows[idx]['Total Weight Sold (kg)'] = weight * units;
              }
            } catch (error) {
              console.warn(`Could not process weight for row ${idx}: ${item}`);
            }
          }
        }

        // Calculate parent totals
        for (const parentIdx of parentIndices) {
          try {
            let total = 0;
            // Sum all child rows until next parent
            for (let nextIdx = parentIdx + 1; nextIdx < processedRows.length; nextIdx++) {
              const nextItem = String(processedRows[nextIdx]['Row Labels'] || '').trim();
              // Stop if we hit another parent item
              if (nextItem && !nextItem.replace('.', '').match(/^\d+$/)) {
                break;
              }
              const weight = processedRows[nextIdx]['Total Weight Sold (kg)'];
              if (weight !== null && weight !== undefined && !isNaN(weight)) {
                total += weight;
              }
            }
            processedRows[parentIdx]['Total Weight Sold (kg)'] = total;
          } catch (error) {
            console.error(`Error calculating parent total for index ${parentIdx}:`, error);
          }
        }

        // Calculate contribution percentages
        let currentParentTotal: number | null = null;
        for (let idx = 0; idx < processedRows.length; idx++) {
          const row = processedRows[idx];
          const item = String(row['Row Labels'] || '').trim();
          
          // If it's a parent item, update current parent total
          if (item && !item.replace('.', '').match(/^\d+$/)) {
            currentParentTotal = row['Total Weight Sold (kg)'] as number | null;
            row['Contribution %'] = null;
          } else {
            // Calculate contribution for child items
            try {
              const weight = row['Total Weight Sold (kg)'] as number | null;
              if (
                weight !== null &&
                weight !== undefined &&
                !isNaN(weight) &&
                currentParentTotal !== null &&
                currentParentTotal !== undefined &&
                !isNaN(currentParentTotal) &&
                currentParentTotal !== 0 &&
                weight !== 0
              ) {
                const contribution = (weight / currentParentTotal) * 100;
                processedRows[idx]['Contribution %'] = Math.round(contribution * 100) / 100;
              } else {
                processedRows[idx]['Contribution %'] = null;
              }
            } catch (error) {
              console.warn(`Could not calculate contribution for row ${idx}`);
            }
          }
        }

        // Extract parent items list
        const parentItems: string[] = [];
        for (const idx of parentIndices) {
          const item = String(processedRows[idx]['Row Labels'] || '').trim();
          if (item) {
            parentItems.push(item);
          }
        }

        resolve({
          rows: processedRows,
          parentItems
        });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Adjust packet counts to meet target weight
 * 
 * Iterative algorithm that adjusts packets until within 5% tolerance of target weight
 * 
 * @param resultDf Array of variation data
 * @param targetWeight Target weight in kg
 * @returns Adjusted data with updated packet counts
 */
export const adjustPackets = (
  resultDf: ManualPlanVariation[],
  targetWeight: number
): ManualPlanVariation[] => {
  if (!resultDf || resultDf.length === 0 || targetWeight <= 0) {
    return resultDf;
  }

  const maxIterations = 100;
  let iteration = 0;
  let adjusted = [...resultDf];

  while (iteration < maxIterations) {
    // Calculate current packed weight
    const packedWeight = adjusted.reduce((sum, row) => {
      return sum + (row['Weight Packed (kg)'] || 0);
    }, 0);

    const deviation = targetWeight > 0 ? (targetWeight - packedWeight) / targetWeight : 0;

    // If within 5% tolerance, stop
    if (Math.abs(deviation) <= 0.05) {
      break;
    }

    try {
      if (packedWeight > targetWeight) {
        // Reduce packets from highest variation
        const highestVariationIdx = adjusted.reduce((maxIdx, row, idx) => {
          const currentMax = adjusted[maxIdx]['Variation (kg)'] || 0;
          const current = row['Variation (kg)'] || 0;
          return current > currentMax ? idx : maxIdx;
        }, 0);

        if (adjusted[highestVariationIdx]['Packets to Pack'] >= 2) {
          adjusted[highestVariationIdx]['Packets to Pack'] -= 2;
          // Recalculate weight
          adjusted[highestVariationIdx]['Weight Packed (kg)'] =
            (adjusted[highestVariationIdx]['Variation (kg)'] || 0) *
            adjusted[highestVariationIdx]['Packets to Pack'];
        } else {
          break; // Can't reduce further
        }
      } else if (deviation > 0) {
        // Add packets to lowest variation
        const lowestVariationIdx = adjusted.reduce((minIdx, row, idx) => {
          const currentMin = adjusted[minIdx]['Variation (kg)'] || Infinity;
          const current = row['Variation (kg)'] || Infinity;
          return current < currentMin ? idx : minIdx;
        }, 0);

        adjusted[lowestVariationIdx]['Packets to Pack'] += 2;
        // Recalculate weight
        adjusted[lowestVariationIdx]['Weight Packed (kg)'] =
          (adjusted[lowestVariationIdx]['Variation (kg)'] || 0) *
          adjusted[lowestVariationIdx]['Packets to Pack'];
      } else {
        break;
      }

      iteration++;
    } catch (error) {
      console.error(`Error in adjustment iteration ${iteration}:`, error);
      break;
    }
  }

  return adjusted;
};

/**
 * Process a single item for manual packing plan
 * 
 * @param selectedItem Item name
 * @param targetWeight Target weight in kg
 * @param processedData Full processed data
 * @param masterData Master product data for matching
 * @returns Item block with packing plan data
 */
export const processManualPlanItem = (
  selectedItem: string,
  targetWeight: number,
  processedData: ProcessedManualPlan,
  masterData: MasterProduct[]
): ManualPlanItemBlock | null => {
  try {
    // Find parent item index
    const parentIdx = processedData.rows.findIndex(
      row => String(row['Row Labels'] || '').trim() === selectedItem
    );

    if (parentIdx === -1) {
      console.warn(`Could not find data for ${selectedItem}`);
      return null;
    }

    // Get all child rows for this parent
    const childRows: ProcessedManualPlanRow[] = [];
    for (let i = parentIdx + 1; i < processedData.rows.length; i++) {
      const row = processedData.rows[i];
      const item = String(row['Row Labels'] || '').trim();
      // Stop if we hit another parent item
      if (item && !item.replace('.', '').match(/^\d+$/)) {
        break;
      }
      childRows.push(row);
    }

    if (childRows.length === 0) {
      console.warn(`No child rows found for ${selectedItem}`);
      return null;
    }

    // Create variation data
    const variations: ManualPlanVariation[] = [];
    for (const childRow of childRows) {
      const variationWeight = parseFloat(String(childRow['Row Labels'] || '0'));
      const contribution = (childRow['Contribution %'] as number) || 0;
      
      // Calculate initial packets based on contribution
      const targetForVariation = (targetWeight * contribution) / 100;
      const initialPackets = Math.max(0, roundToNearest2(targetForVariation / variationWeight));

      variations.push({
        'Variation (kg)': variationWeight,
        'Pouch Size': String(childRow['Pouch Size'] || 'N/A'),
        'ASIN': String(childRow['ASIN'] || 'N/A'),
        'Packets to Pack': initialPackets,
        'Weight Packed (kg)': variationWeight * initialPackets
      });
    }

    // Adjust packets to meet target weight
    const adjustedVariations = adjustPackets(variations, targetWeight);

    // Calculate final weights
    const packedWeight = adjustedVariations.reduce((sum, v) => sum + (v['Weight Packed (kg)'] || 0), 0);
    const looseWeight = targetWeight - packedWeight;

    return {
      item: selectedItem,
      target_weight: targetWeight,
      packed_weight: packedWeight,
      loose_weight: looseWeight,
      data: adjustedVariations
    };
  } catch (error) {
    console.error(`Error processing item ${selectedItem}:`, error);
    return null;
  }
};

