import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { ProcessedOrder, MultiItemOrderStats } from './excelProcessor';

export type GroupingStyle = 'Multi-Item First, Then By Product (Recommended)';

export type Orientation = 'Portrait' | 'Landscape';

export interface ReportGenerationOptions {
  groupingStyle: GroupingStyle;
  orientation: Orientation;
  multiItemOrders: string[];
  stats: MultiItemOrderStats;
  title: string;
}

/**
 * Generate PDF report from processed orders
 */
export const generateReportPDF = (
  orders: ProcessedOrder[],
  options: ReportGenerationOptions
): Uint8Array => {
  const { groupingStyle, orientation, multiItemOrders, stats, title } = options;
  
  // Create PDF document
  const doc = new jsPDF({
    orientation: orientation === 'Landscape' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  // Get actual page size from jsPDF
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  // Add page numbers on every page
  const totalPagesExp = (doc as any).internal.getNumberOfPages;
  doc.setFont('helvetica');

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  const titleWidth = doc.getTextWidth(title);
  doc.text(title, (pageWidth - titleWidth) / 2, 14);

  // Stats bar with light blue background
  const statsText = `Total Orders: ${stats.totalOrders}   |   Multi-Item Orders: ${stats.multiItemCount}   |   Single-Item Orders: ${stats.singleItemCount}`;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const statsTextWidth = doc.getTextWidth(statsText);
  const statsBoxX = (pageWidth - statsTextWidth - 10) / 2;
  const statsBoxY = 17;
  const statsBoxH = 7;
  doc.setFillColor(219, 234, 254); // Light blue
  doc.setDrawColor(147, 197, 253);
  doc.setLineWidth(0.3);
  doc.roundedRect(statsBoxX, statsBoxY, statsTextWidth + 10, statsBoxH, 1.5, 1.5, 'FD');
  doc.setTextColor(30, 64, 175); // Blue text
  doc.text(statsText, statsBoxX + 5, statsBoxY + 4.8);

  let yPos = 30;
  const lineHeight = 6;
  const margin = 10;
  const maxWidth = pageWidth - 2 * margin;
  
  // Precompute Maps/Sets for O(1) lookups (performance optimization)
  const ordersByTrackingId = new Map<string, ProcessedOrder[]>();
  const ordersByProductName = new Map<string, ProcessedOrder[]>();
  const multiItemSet = new Set<string>(multiItemOrders);
  
  for (const order of orders) {
    // Group by tracking-id
    const trackingId = order['tracking-id'];
    if (!ordersByTrackingId.has(trackingId)) {
      ordersByTrackingId.set(trackingId, []);
    }
    ordersByTrackingId.get(trackingId)!.push(order);
    
    // Group by product name
    const productName = order['product-name'];
    if (!ordersByProductName.has(productName)) {
      ordersByProductName.set(productName, []);
    }
    ordersByProductName.get(productName)!.push(order);
  }
  
  // Section 1: Multi-item orders (2-column layout)
  if (multiItemOrders.length > 0) {
    yPos = addSectionHeader(doc, '*** SECTION 1: MULTI-ITEM ORDERS (Pack Complete Orders)', yPos, margin, maxWidth);
    yPos += 2;

    doc.setFontSize(10);
    doc.setTextColor(255, 0, 0);
    doc.setFont('helvetica', 'bold');
    const warningText = '[CRITICAL] Each order below contains multiple items - PACK ALL ITEMS TOGETHER';
    const warningLines = doc.splitTextToSize(warningText, maxWidth);
    doc.text(warningLines, margin, yPos);
    yPos += warningLines.length * lineHeight + 3;

    const multiItemBlocks = multiItemOrders.map(trackingId => {
      const orderItems = ordersByTrackingId.get(trackingId) || [];
      return {
        render: (x: number, y: number, width: number) =>
          renderMultiItemOrderBlock(doc, x, y, width, trackingId, orderItems, pageHeight),
        estimateHeight: () => 6 + 7 + (orderItems.length + 1) * 6 + 4
      };
    });

    yPos = renderTwoColumnBlocks(doc, multiItemBlocks, {
      startY: yPos, pageHeight, leftMargin: margin, rightMargin: margin, gutter: 7, blockGap: 5
    });
    yPos += 6;
    // Divider line between sections
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 6;
  } else {
    yPos += 3;
  }

  // Section 2: Single-item orders grouped by product (2-column layout)
  if (yPos + 30 > pageHeight - 20) {
    doc.addPage();
    yPos = 15;
  }

  yPos = addSectionHeader(doc, 'SECTION 2: SINGLE-ITEM ORDERS (Group by Product)', yPos, margin, maxWidth);
  yPos += 2;

  const singleItemOrders = orders.filter(o => !multiItemSet.has(o['tracking-id']));
  if (singleItemOrders.length > 0) {
    const grouped = groupByProduct(singleItemOrders);
    const productBlocks = Array.from(grouped.entries()).map(([productName, groupOrders]) => ({
      render: (x: number, y: number, width: number) =>
        renderProductGroupBlock(doc, x, y, width, groupOrders[0]['product-name'] || productName, groupOrders, pageHeight),
      estimateHeight: () => 6 + 7 + groupOrders.length * 6 + 2 + 2
    }));
    renderTwoColumnBlocksMasonry(doc, productBlocks, {
      startY: yPos, pageHeight, leftMargin: margin, rightMargin: margin, gutter: 7, blockGap: 2
    });
  } else {
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('No single-item orders found.', margin, yPos);
    yPos += lineHeight;
  }
  
  // Add page numbers to all pages
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    const pageText = `Page ${i} of ${totalPages}`;
    doc.text(pageText, pageWidth - margin - doc.getTextWidth(pageText), pageHeight - 5);
  }

  // Convert to Uint8Array
  const pdfBlob = doc.output('arraybuffer');
  return new Uint8Array(pdfBlob);
};


/**
 * Group orders by product name and return sorted by product name (ascending)
 */
const groupByProduct = (orders: ProcessedOrder[]): Map<string, ProcessedOrder[]> => {
  const grouped = new Map<string, ProcessedOrder[]>();
  
  for (const order of orders) {
    const productName = order['product-name'];
    if (!grouped.has(productName)) {
      grouped.set(productName, []);
    }
    grouped.get(productName)!.push(order);
  }
  
  // Sort by product name (ascending) and return as sorted Map
  const sortedEntries = Array.from(grouped.entries()).sort((a, b) => 
    a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
  );
  
  const sortedMap = new Map<string, ProcessedOrder[]>();
  for (const [productName, groupOrders] of sortedEntries) {
    sortedMap.set(productName, groupOrders);
  }
  
  return sortedMap;
};

/**
 * Add section header
 */
const addSectionHeader = (
  doc: jsPDF,
  text: string,
  yPos: number,
  margin: number,
  maxWidth: number
): number => {
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 139); // Dark blue
  doc.setFont('helvetica', 'bold');
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, margin, yPos);
  return yPos + lines.length * 5 + 2;
};

/**
 * Estimate table height for page break calculations
 */
const estimateTableHeight = (
  rowCount: number,
  options: {
    headerHeight?: number;
    rowHeight?: number;
    cellPadding?: number;
    headerRowCount?: number;
  } = {}
): number => {
  const headerHeight = options.headerHeight || 7;
  const rowHeight = options.rowHeight || 6;
  const headerRowCount = options.headerRowCount || 1;
  const padding = 4;
  
  return headerHeight + (headerRowCount + rowCount) * rowHeight + padding;
};

/**
 * Render a multi-item order block (header + table + warning row)
 */
const renderMultiItemOrderBlock = (
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  trackingId: string,
  orderItems: ProcessedOrder[],
  pageHeight: number
): number => {
  const lineHeight = 6;
  const headerHeight = 7;
  const rowHeight = 6;
  const cellPadding = 1.5;
  let currentY = y;
  
  // Order header
  doc.setFontSize(10);
  doc.setTextColor(0, 100, 0); // Dark green
  doc.setFont('helvetica', 'bold');
  doc.text(`Order #${trackingId} - COMPLETE ORDER`, x, currentY);
  currentY += lineHeight;
  
  // Items table
  const tableData: string[][] = [['Product', 'Qty', 'Pickup Date']];
  for (const item of orderItems) {
    tableData.push([
      item['product-name'].substring(0, 40), // Truncate for narrow column
      String(item.qty),
      item['pickup-slot'].substring(0, 12)
    ]);
  }
  tableData.push(['[PACK ALL ITEMS TOGETHER - DO NOT SPLIT!]', '', '']);
  
  // Render table with compact spacing, pass startY as topMarginY for column mode
  currentY = addTable(doc, tableData, x, currentY, width, lineHeight, pageHeight, x, true, y);
  
  return currentY + 4; // Add block spacing
};

/**
 * Render a single-item product group block (header + table)
 */
const renderProductGroupBlock = (
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  productName: string,
  groupOrders: ProcessedOrder[],
  pageHeight: number
): number => {
  const lineHeight = 6;
  let currentY = y;
  
  // Product header
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 139); // Dark blue
  doc.setFont('helvetica', 'bold');
  doc.text(productName.toUpperCase(), x, currentY);
  currentY += lineHeight + 1; // Reduced from lineHeight + 1
  
  // Orders table
  const tableData: string[][] = [['Tracking ID', 'Qty', 'Pickup Date']];
  for (const order of groupOrders) {
    const trackingId = order['tracking-id'];
    const shortId = trackingId.length > 12 ? trackingId.substring(trackingId.length - 12) : trackingId;
    tableData.push([shortId, String(order.qty), order['pickup-slot'].substring(0, 12)]);
  }
  
  // Render table with compact spacing, pass startY as topMarginY for column mode
  currentY = addTable(doc, tableData, x, currentY, width, lineHeight, pageHeight, x, true, y);

  return currentY + 2; // Reduced block spacing for Section 2
};

/**
 * Render a product group block with multi-item warnings column
 */
const renderProductGroupBlockWithWarnings = (
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  productName: string,
  groupOrders: ProcessedOrder[],
  multiItemSet: Set<string>,
  ordersByTrackingId: Map<string, ProcessedOrder[]>,
  pageHeight: number
): number => {
  const lineHeight = 6;
  let currentY = y;

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 139);
  doc.setFont('helvetica', 'bold');
  doc.text(productName.toUpperCase(), x, currentY);
  currentY += lineHeight;

  const tableData: string[][] = [['Tracking ID', 'Qty', 'Pickup', 'Order Type']];
  const rowHighlights: boolean[] = [];

  for (const order of groupOrders) {
    const trackingId = order['tracking-id'];
    const shortId = trackingId.length > 12 ? trackingId.substring(trackingId.length - 12) : trackingId;
    const isMulti = multiItemSet.has(trackingId);
    let orderType = isMulti ? 'MULTI-ITEM' : 'Single Item';

    if (isMulti) {
      const otherItems = (ordersByTrackingId.get(trackingId) || [])
        .filter(o => o['product-name'] !== productName)
        .map(o => o['product-name'].substring(0, 15));
      if (otherItems.length > 0) {
        orderType += ` +${otherItems[0]}${otherItems.length > 1 ? '...' : ''}`;
      }
    }

    tableData.push([shortId, String(order.qty), order['pickup-slot'].substring(0, 10), orderType.substring(0, 30)]);
    rowHighlights.push(isMulti);
  }

  currentY = addTableWithRowHighlights(doc, tableData, rowHighlights, x, currentY, width, lineHeight, pageHeight, x, true, y);
  return currentY + 2;
};

/**
 * Render blocks in 2-column masonry layout (for Section 2: product groups)
 * Places each block in the column with smaller Y (more free space)
 * Uses pre-check fit: estimates height before rendering to avoid drawing then undoing
 */
const renderTwoColumnBlocksMasonry = (
  doc: jsPDF,
  blocks: Array<{ render: (x: number, y: number, width: number) => number; estimateHeight?: () => number }>,
  options: {
    startY: number;
    pageHeight: number;
    leftMargin: number;
    rightMargin: number;
    gutter: number;
    blockGap: number;
  }
): void => {
  const { startY, pageHeight, leftMargin, rightMargin, gutter, blockGap } = options;
  const pageWidth = doc.internal.pageSize.getWidth();
  const columnWidth = (pageWidth - leftMargin - rightMargin - gutter) / 2;
  const xLeft = leftMargin;
  const xRight = leftMargin + columnWidth + gutter;
  const bottomMargin = 20;
  
  let yLeft = startY;
  let yRight = startY;
  
  for (const block of blocks) {
    // Choose column with smaller Y (more free space)
    const useLeft = yLeft <= yRight;
    const x = useLeft ? xLeft : xRight;
    let y = useLeft ? yLeft : yRight;
    
    // Pre-check: estimate height before rendering
    const estimatedHeight = block.estimateHeight ? block.estimateHeight() : 50;
    const availableHeight = pageHeight - bottomMargin - y;
    
    // If block doesn't fit, add new page and reset both columns to top margin
    if (estimatedHeight > availableHeight) {
      doc.addPage();
      yLeft = 15;
      yRight = 15;
      y = 15;
    }
    
    // Render block (now we know it will fit)
    const finalY = block.render(x, y, columnWidth);
    
    // Update the chosen column's Y
    if (useLeft) {
      yLeft = finalY + blockGap;
    } else {
      yRight = finalY + blockGap;
    }
  }
};

/**
 * Render blocks in 2-column layout with proper page breaking
 * Uses strict pair rendering: left+right blocks start at same Y, then advance to max Y
 */
const renderTwoColumnBlocks = (
  doc: jsPDF,
  blocks: Array<{ render: (x: number, y: number, width: number) => number; estimateHeight?: () => number }>,
  options: {
    startY: number;
    pageHeight: number;
    leftMargin: number;
    rightMargin: number;
    gutter: number;
    blockGap: number;
  }
): number => {
  const { startY, pageHeight, leftMargin, rightMargin, gutter, blockGap } = options;
  const pageWidth = doc.internal.pageSize.getWidth();
  const columnWidth = (pageWidth - leftMargin - rightMargin - gutter) / 2;
  const xLeft = leftMargin;
  const xRight = leftMargin + columnWidth + gutter;
  const bottomMargin = 20;
  
  let yCurrent = startY;
  
  // Process blocks in pairs (left, right)
  for (let i = 0; i < blocks.length; i += 2) {
    const leftBlock = blocks[i];
    const rightBlock = blocks[i + 1]; // May be undefined if odd number
    
    // Estimate heights for both blocks
    const leftHeight = leftBlock.estimateHeight ? leftBlock.estimateHeight() : 50;
    const rightHeight = rightBlock?.estimateHeight ? rightBlock.estimateHeight() : 50;
    const maxBlockHeight = Math.max(leftHeight, rightHeight);
    const availableHeight = pageHeight - bottomMargin - yCurrent;
    
    // Check if a single block is too tall for a column (fallback: render full-width)
    if (leftHeight > availableHeight || (rightBlock && rightHeight > availableHeight)) {
      // Render too-tall blocks full-width on fresh page
      if (leftHeight > availableHeight) {
        doc.addPage();
        const fullWidth = pageWidth - leftMargin - rightMargin;
        const leftFinalY = leftBlock.render(leftMargin, startY, fullWidth);
        yCurrent = leftFinalY + blockGap;
        
        // If there's a right block, render it on next page
        if (rightBlock) {
          if (rightHeight > availableHeight) {
            doc.addPage();
            const rightFinalY = rightBlock.render(leftMargin, startY, fullWidth);
            yCurrent = rightFinalY + blockGap;
          } else {
            // Right block fits, render it in 2-column layout
            doc.addPage();
            yCurrent = startY;
            const rightFinalY = rightBlock.render(xRight, yCurrent, columnWidth);
            yCurrent = Math.max(yCurrent, rightFinalY) + blockGap;
          }
        }
        continue;
      }
    }
    
    // Check if we need a new page for normal rendering
    if (yCurrent + maxBlockHeight > pageHeight - bottomMargin) {
      doc.addPage();
      yCurrent = startY;
    }
    
    // Render left block
    const leftFinalY = leftBlock.render(xLeft, yCurrent, columnWidth);
    
    // Render right block (if exists) at same Y position
    let rightFinalY = yCurrent;
    if (rightBlock) {
      rightFinalY = rightBlock.render(xRight, yCurrent, columnWidth);
    }
    
    // Advance to max Y of both blocks for next pair
    yCurrent = Math.max(leftFinalY, rightFinalY) + blockGap;
  }
  return yCurrent;
};

/**
 * Add table to PDF with proper formatting
 * Uses calculateColumnWidths to dynamically size columns to fit within maxWidth
 * @param xPosition Optional X position. If provided, table starts at this position instead of centering.
 */
const addTable = (
  doc: jsPDF,
  tableData: string[][],
  margin: number,
  yPos: number,
  maxWidth: number,
  lineHeight: number,
  pageHeight: number = 297,
  xPosition?: number,
  compactSpacing: boolean = false,
  topMarginY: number = 20
): number => {
  if (tableData.length === 0) return yPos;
  
  const colCount = tableData[0].length;
  
  // Use full width in column mode (xPosition provided), otherwise 90% for centering
  const compactMaxWidth = xPosition !== undefined ? maxWidth : maxWidth * 0.9;
  const colWidths = calculateColumnWidths(tableData, compactMaxWidth, doc);
  const totalTableWidth = colWidths.reduce((sum, w) => sum + w, 0);
  // Use provided xPosition or left-align the table
  const tableStartX = xPosition !== undefined ? xPosition : margin;
  const rowHeight = 6;
  const headerHeight = 7;
  const cellPadding = compactSpacing ? 1.5 : 2;
  
  // Calculate starting Y position for header
  const headerStartY = yPos;
  let currentY = headerStartY;
  
  // Draw header row
  doc.setFillColor(240, 240, 240); // Light gray background
  doc.rect(tableStartX, headerStartY, totalTableWidth, headerHeight, 'F');
  
  // Header border - outer border 0.5mm
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.rect(tableStartX, headerStartY, totalTableWidth, headerHeight, 'S');
  
  // Header text
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  
  let xPos = tableStartX;
  for (let j = 0; j < colCount; j++) {
    const headerText = tableData[0][j] || '';
    const colCenterX = xPos + colWidths[j] / 2;
    doc.text(headerText, colCenterX, headerStartY + headerHeight - 2, { align: 'center' });
    
    // Draw vertical line between columns - inner grid 0.25mm
    if (j < colCount - 1) {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.25);
      doc.line(xPos + colWidths[j], headerStartY, xPos + colWidths[j], headerStartY + headerHeight);
    }
    xPos += colWidths[j];
  }
  
  // Draw horizontal line below header
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(tableStartX, headerStartY + headerHeight, tableStartX + totalTableWidth, headerStartY + headerHeight);
  
  currentY = headerStartY + headerHeight;
  
  // Draw data rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  for (let i = 1; i < tableData.length; i++) {
    const row = tableData[i];
    const isWarningRow = i === tableData.length - 1 && row[0].includes('PACK ALL ITEMS');
    
    // Check if we need a new page
    if (currentY + rowHeight > pageHeight - 20) {
      doc.addPage();
      currentY = topMarginY; // Use provided topMarginY, not hardcoded 20
      
      // Redraw header on new page at same X position (preserves column layout)
      doc.setFillColor(240, 240, 240);
      doc.rect(tableStartX, currentY, totalTableWidth, headerHeight, 'F');
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.rect(tableStartX, currentY, totalTableWidth, headerHeight, 'S');
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      
      xPos = tableStartX;
      for (let j = 0; j < colCount; j++) {
        const headerText = tableData[0][j] || '';
        const colCenterX = xPos + colWidths[j] / 2;
        doc.text(headerText, colCenterX, currentY + headerHeight - 2, { align: 'center' });
        
        if (j < colCount - 1) {
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.25);
          doc.line(xPos + colWidths[j], currentY, xPos + colWidths[j], currentY + headerHeight);
        }
        xPos += colWidths[j];
      }
      
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(tableStartX, currentY + headerHeight, tableStartX + totalTableWidth, currentY + headerHeight);
      
      currentY = currentY + headerHeight;
      doc.setFont('helvetica', 'normal');
    }
    
    // Draw row background for warning rows
    if (isWarningRow) {
      // Light coral background (RGB: 240, 128, 128) matching Streamlit's colors.lightcoral
      doc.setFillColor(240, 128, 128);
      doc.rect(tableStartX, currentY, totalTableWidth, rowHeight, 'F');
    } else {
      // Highlight high quantity orders (qty > 1) - light grey background and bold font for qty
      const qty = parseInt(row[1] || '0', 10);
      const isHighQty = qty > 1;
      
      if (isHighQty) {
        // Amber background for high-qty rows — easy to spot at a glance
        doc.setFillColor(254, 243, 199);
        doc.rect(tableStartX, currentY, totalTableWidth, rowHeight, 'F');
      } else if (i % 2 === 0) {
        // Alternating row colors (even rows)
        doc.setFillColor(249, 250, 251); // Very light gray
        doc.rect(tableStartX, currentY, totalTableWidth, rowHeight, 'F');
      }
    }
    
    // Draw cell content
    xPos = tableStartX;
    for (let j = 0; j < colCount; j++) {
      const cellText = row[j] || '';
      
      // Special handling for warning row - spans all columns, centered
      if (isWarningRow && j === 0) {
        doc.setTextColor(220, 38, 38); // Red
        doc.setFont('helvetica', 'bold');
        const textY = currentY + rowHeight / 2 + 1.5;
        const textX = tableStartX + totalTableWidth / 2;
        doc.text(cellText, textX, textY, { align: 'center' });
        break; // Don't draw other columns for warning row
      }
      
      // Determine alignment: center for numbers/short text, left for long text
      const isNumeric = /^\d+$/.test(cellText.trim());
      const align = isNumeric || cellText.length < 15 ? 'center' : 'left';
      
      // Set text color and font
      doc.setTextColor(0, 0, 0); // Black
      const qty = parseInt(row[1] || '0', 10);
      const isHighQty = qty > 1;
      if (isHighQty && j === 1) {
        // Bold font for qty column when qty > 1
        doc.setFont('helvetica', 'bold');
      } else {
        doc.setFont('helvetica', 'normal');
      }
      
      // Draw text
      const textX = align === 'center' 
        ? xPos + colWidths[j] / 2 
        : xPos + cellPadding;
      
      const textY = currentY + rowHeight / 2 + 1.5;
      doc.text(cellText, textX, textY, { align });
      
      // Draw vertical line between columns - inner grid 0.25mm
      if (j < colCount - 1) {
        doc.setDrawColor(229, 231, 235); // Light gray
        doc.setLineWidth(0.25);
        doc.line(xPos + colWidths[j], currentY, xPos + colWidths[j], currentY + rowHeight);
      }
      
      xPos += colWidths[j];
    }
    
    // Draw horizontal line below row - inner grid 0.25mm
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.25);
    doc.line(tableStartX, currentY + rowHeight, tableStartX + totalTableWidth, currentY + rowHeight);
    
    currentY += rowHeight;
  }
  
  // Draw outer border around entire table - outer border 0.5mm
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.rect(tableStartX, headerStartY, totalTableWidth, currentY - headerStartY, 'S');
  
  return currentY + 2; // Add minimal spacing after table
};

/**
 * Like addTable but highlights specific data rows (e.g. multi-item rows in yellow)
 * rowHighlights[i] corresponds to tableData[i+1] (skipping header row)
 */
const addTableWithRowHighlights = (
  doc: jsPDF,
  tableData: string[][],
  rowHighlights: boolean[],
  margin: number,
  yPos: number,
  maxWidth: number,
  lineHeight: number,
  pageHeight: number = 297,
  xPosition?: number,
  compactSpacing: boolean = false,
  topMarginY: number = 20
): number => {
  if (tableData.length === 0) return yPos;

  const colCount = tableData[0].length;
  const compactMaxWidth = xPosition !== undefined ? maxWidth : maxWidth * 0.9;
  const colWidths = calculateColumnWidths(tableData, compactMaxWidth, doc);
  const totalTableWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const tableStartX = xPosition !== undefined ? xPosition : margin;
  const rowHeight = 6;
  const headerHeight = 7;
  const cellPadding = compactSpacing ? 1.5 : 2;

  const headerStartY = yPos;
  let currentY = headerStartY;

  // Draw header
  doc.setFillColor(240, 240, 240);
  doc.rect(tableStartX, headerStartY, totalTableWidth, headerHeight, 'F');
  doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5);
  doc.rect(tableStartX, headerStartY, totalTableWidth, headerHeight, 'S');
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
  let xPos = tableStartX;
  for (let j = 0; j < colCount; j++) {
    doc.text(tableData[0][j] || '', xPos + colWidths[j] / 2, headerStartY + headerHeight - 2, { align: 'center' });
    if (j < colCount - 1) { doc.setLineWidth(0.25); doc.line(xPos + colWidths[j], headerStartY, xPos + colWidths[j], headerStartY + headerHeight); }
    xPos += colWidths[j];
  }
  doc.setLineWidth(0.5);
  doc.line(tableStartX, headerStartY + headerHeight, tableStartX + totalTableWidth, headerStartY + headerHeight);
  currentY = headerStartY + headerHeight;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);

  for (let i = 1; i < tableData.length; i++) {
    const row = tableData[i];
    const isHighlighted = rowHighlights[i - 1];

    if (currentY + rowHeight > pageHeight - 20) {
      doc.addPage();
      currentY = topMarginY;
      doc.setFillColor(240, 240, 240);
      doc.rect(tableStartX, currentY, totalTableWidth, headerHeight, 'F');
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5);
      doc.rect(tableStartX, currentY, totalTableWidth, headerHeight, 'S');
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      xPos = tableStartX;
      for (let j = 0; j < colCount; j++) {
        doc.text(tableData[0][j] || '', xPos + colWidths[j] / 2, currentY + headerHeight - 2, { align: 'center' });
        if (j < colCount - 1) { doc.setLineWidth(0.25); doc.line(xPos + colWidths[j], currentY, xPos + colWidths[j], currentY + headerHeight); }
        xPos += colWidths[j];
      }
      doc.setLineWidth(0.5);
      doc.line(tableStartX, currentY + headerHeight, tableStartX + totalTableWidth, currentY + headerHeight);
      currentY = currentY + headerHeight;
      doc.setFont('helvetica', 'normal');
    }

    if (isHighlighted) {
      doc.setFillColor(255, 255, 180); // Light yellow for multi-item rows
      doc.rect(tableStartX, currentY, totalTableWidth, rowHeight, 'F');
    } else if (i % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(tableStartX, currentY, totalTableWidth, rowHeight, 'F');
    }

    xPos = tableStartX;
    for (let j = 0; j < colCount; j++) {
      const cellText = row[j] || '';
      const isLastCol = j === colCount - 1;
      const align = (!isLastCol && ((/^\d+$/.test(cellText.trim())) || cellText.length < 15)) ? 'center' : 'left';

      if (isHighlighted && j === colCount - 1) {
        doc.setTextColor(200, 0, 0); doc.setFont('helvetica', 'bold');
      } else {
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');
      }

      const textX = align === 'center' ? xPos + colWidths[j] / 2 : xPos + cellPadding;
      doc.text(cellText, textX, currentY + rowHeight / 2 + 1.5, { align });

      if (j < colCount - 1) {
        doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.25);
        doc.line(xPos + colWidths[j], currentY, xPos + colWidths[j], currentY + rowHeight);
      }
      xPos += colWidths[j];
    }

    doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.25);
    doc.line(tableStartX, currentY + rowHeight, tableStartX + totalTableWidth, currentY + rowHeight);
    currentY += rowHeight;
  }

  doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5);
  doc.rect(tableStartX, headerStartY, totalTableWidth, currentY - headerStartY, 'S');
  return currentY + 2;
};

/**
 * Calculate optimal column widths based on actual content
 * Ensures all content (tracking ID, qty, dates) is fully visible
 */
const calculateColumnWidths = (
  tableData: string[][],
  maxWidth: number,
  doc: jsPDF
): number[] => {
  if (tableData.length === 0) return [];
  
  const colCount = tableData[0].length;
  const colWidths: number[] = new Array(colCount).fill(0);
  const cellPadding = 2;
  
  // Set font size for measurement (same as what we'll use in table)
  doc.setFontSize(9);
  
  // Calculate minimum width needed for each column based on actual content
  for (let i = 0; i < tableData.length; i++) {
    for (let j = 0; j < colCount; j++) {
      const cellText = tableData[i][j] || '';
      const textWidth = doc.getTextWidth(cellText);
      // Add padding on both sides
      const minWidth = textWidth + (cellPadding * 2) + 2; // +2 for safety margin
      colWidths[j] = Math.max(colWidths[j], minWidth);
    }
  }
  
  // Ensure minimum widths for readability
  const firstHeader = tableData[0][0] || '';
  if (firstHeader === 'Tracking ID') {
    // For tracking ID tables, ensure reasonable minimums
    colWidths[0] = Math.max(colWidths[0], maxWidth * 0.2); // Tracking ID: at least 20%
    colWidths[1] = Math.max(colWidths[1], maxWidth * 0.12); // Qty: at least 12%
    colWidths[2] = Math.max(colWidths[2], maxWidth * 0.2);  // Date: at least 20%
  } else if (firstHeader === 'Product') {
    // For product tables
    colWidths[1] = Math.max(colWidths[1], maxWidth * 0.12); // Qty: at least 12%
    colWidths[2] = Math.max(colWidths[2], maxWidth * 0.2);   // Date: at least 20%
  }
  
  // Normalize to fit within maxWidth
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  if (totalWidth > maxWidth) {
    const scale = maxWidth / totalWidth;
    return colWidths.map(w => w * scale);
  }
  
  // If total is less than maxWidth, distribute remaining space proportionally
  if (totalWidth < maxWidth) {
    const remaining = maxWidth - totalWidth;
    const scale = 1 + (remaining / totalWidth);
    return colWidths.map(w => w * scale);
  }
  
  return colWidths;
};


/**
 * Generate Excel export with multiple sheets
 */
export const generateReportExcel = (
  orders: ProcessedOrder[],
  multiItemOrders: string[],
  stats: MultiItemOrderStats
): Blob => {
  const workbook = XLSX.utils.book_new();
  
  // Sheet 1: Main orders data
  const exportData = orders.map(order => ({
    'tracking-id': order['tracking-id'],
    'asin': order.asin || '',
    'sku': order.sku || '',
    'product-name': order['product-name'],
    'qty': order.qty,
    'pickup-slot': order['pickup-slot'],
    'date-ordered': order['date-ordered'] || ''
  }));
  
  const mainSheet = XLSX.utils.json_to_sheet(exportData);
  XLSX.utils.book_append_sheet(workbook, mainSheet, 'Easy Ship Orders');
  
  // Sheet 2: Multi-item orders summary
  if (multiItemOrders.length > 0) {
    // Precompute ordersByTrackingId for Excel export
    const ordersByTrackingId = new Map<string, ProcessedOrder[]>();
    for (const order of orders) {
      const trackingId = order['tracking-id'];
      if (!ordersByTrackingId.has(trackingId)) {
        ordersByTrackingId.set(trackingId, []);
      }
      ordersByTrackingId.get(trackingId)!.push(order);
    }
    
    const multiItemSummary = multiItemOrders.map(trackingId => {
      const orderItems = ordersByTrackingId.get(trackingId) || [];
      return {
        'tracking-id': trackingId,
        'item_count': orderItems.length,
        'products': orderItems.map(o => o['product-name']).join(', '),
        'total_qty': orderItems.reduce((sum, o) => sum + o.qty, 0),
        'pickup_date': orderItems[0]?.['pickup-slot'] || ''
      };
    });
    
    const multiItemSheet = XLSX.utils.json_to_sheet(multiItemSummary);
    XLSX.utils.book_append_sheet(workbook, multiItemSheet, 'Multi-Item Orders');
  }
  
  // Sheet 3: Summary by product
  const productSummary = new Map<string, { qty: number; orderCount: number }>();
  for (const order of orders) {
    const productName = order['product-name'];
    if (!productSummary.has(productName)) {
      productSummary.set(productName, { qty: 0, orderCount: 0 });
    }
    const summary = productSummary.get(productName)!;
    summary.qty += order.qty;
    summary.orderCount += 1;
  }
  
  const summaryData = Array.from(productSummary.entries()).map(([product, data]) => ({
    'product-name': product,
    'total_qty': data.qty,
    'order_count': data.orderCount
  }));
  
  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary by Product');
  
  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { 
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
};

