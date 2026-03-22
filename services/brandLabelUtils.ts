import { PhysicalItem, MasterProduct } from '../types';

export function getBrandName(item: PhysicalItem, masterData: MasterProduct[]): string {
  const master = masterData.find(
    (p) => (p.ASIN && p.ASIN === item.ASIN) || (p.FNSKU && p.FNSKU === item.FNSKU)
  );
  const brand = (master as any)?.['Brand Name'] as string | undefined;
  return brand?.trim() || 'Unknown Brand';
}

/**
 * Groups physical items by brand, sorted alphabetically.
 * Brand name is read from "Brand Name" column (column Q) in master sheet.
 */
export function groupPhysicalItemsByBrand(
  physicalItems: PhysicalItem[],
  masterData: MasterProduct[]
): Map<string, PhysicalItem[]> {
  const map = new Map<string, PhysicalItem[]>();
  for (const item of physicalItems) {
    const brand = getBrandName(item, masterData);
    if (!map.has(brand)) map.set(brand, []);
    map.get(brand)!.push(item);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
