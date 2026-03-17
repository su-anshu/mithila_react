import * as XLSX from 'xlsx';
import { PhysicalItem, OrderItem, MissingProduct } from '../types';

/**
 * Export data to Excel workbook with multiple sheets
 */
export const exportToExcel = (
  physicalItems: PhysicalItem[],
  orders: OrderItem[],
  missingProducts?: MissingProduct[]
): Blob => {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Physical Packing Plan
  if (physicalItems.length > 0) {
    const physicalWS = XLSX.utils.json_to_sheet(physicalItems);
    XLSX.utils.book_append_sheet(workbook, physicalWS, 'Physical Packing Plan');
  }

  // Sheet 2: Original Orders
  if (orders.length > 0) {
    const ordersWS = XLSX.utils.json_to_sheet(orders);
    XLSX.utils.book_append_sheet(workbook, ordersWS, 'Original Orders');
  }

  // Sheet 3: Missing Products (if any)
  if (missingProducts && missingProducts.length > 0) {
    const missingWS = XLSX.utils.json_to_sheet(missingProducts);
    XLSX.utils.book_append_sheet(workbook, missingWS, 'Missing Products');
  }

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

/**
 * Download Excel file
 */
export const downloadExcel = (
  physicalItems: PhysicalItem[],
  orders: OrderItem[],
  missingProducts: MissingProduct[] | undefined,
  filename: string = 'Packing_Plan.xlsx'
): void => {
  const blob = exportToExcel(physicalItems, orders, missingProducts);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

