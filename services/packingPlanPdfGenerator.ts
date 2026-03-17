import jsPDF from 'jspdf';
import { PhysicalItem, OrderItem, MissingProduct, ProcessingStats } from '../types';

/**
 * Clean text for PDF generation (remove emojis and non-ASCII)
 */
const cleanText = (text: any): string => {
  if (text === null || text === undefined) return '';
  let cleaned = String(text);
  
  const replacements: Record<string, string> = {
    '✅': 'OK',
    '⚠️': 'WARNING',
    '📦': '',
    '🚨': 'ALERT',
    '•': '-'
  };

  for (const [unicode, replacement] of Object.entries(replacements)) {
    cleaned = cleaned.replace(unicode, replacement);
  }

  // Remove any remaining non-ASCII characters
  cleaned = cleaned.replace(/[^\x00-\x7F]/g, '');
  
  return cleaned;
};

/**
 * Generate summary PDF with packing plan - Enhanced Visual Design
 */
export const generateSummaryPdf = (
  orders: OrderItem[],
  physicalItems: PhysicalItem[],
  stats: ProcessingStats,
  missingProducts?: MissingProduct[],
  heading?: string
): jsPDF => {
  const pdf = new jsPDF();
  const timestamp = new Date().toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  // Sort items alphabetically by Item name (A to Z)
  const sortedItems = [...physicalItems].sort((a, b) => {
    const nameA = cleanText(a.item || '').toLowerCase().trim();
    const nameB = cleanText(b.item || '').toLowerCase().trim();
    return nameA.localeCompare(nameB);
  });

  // ========== ENHANCED HEADER SECTION ==========
  // Header background with color
  pdf.setFillColor(37, 99, 235); // Blue-600
  pdf.rect(0, 0, 210, 35, 'F');
  
  // Header border (line only, no rectangle)
  pdf.setDrawColor(29, 78, 216); // Blue-700
  pdf.setLineWidth(0.5);
  pdf.line(0, 35, 210, 35);

  // Main heading - white text on blue background
  pdf.setTextColor(255, 255, 255); // White
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(heading || 'Amazon Actual Packing Plan', 105, 18, { align: 'center' });
  
  // Subtitle - lighter white
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`Generated on: ${timestamp}`, 105, 28, { align: 'center' });

  // ========== ENHANCED STATISTICS SECTION ==========
  const statY = 42;
  const statBoxHeight = 16;
  const statBoxWidth = 60;
  const statGap = 5;
  const totalStatWidth = (statBoxWidth * 3) + (statGap * 2);
  const statStartX = (210 - totalStatWidth) / 2;

  // Stat boxes with colors
  const statConfigs = [
    { label: 'Invoices', value: stats.total_invoices, color: [59, 130, 246], bgColor: [239, 246, 255] }, // Blue
    { label: 'Qty Ordered', value: stats.total_qty_ordered, color: [16, 185, 129], bgColor: [236, 253, 245] }, // Green
    { label: 'Qty Physical', value: stats.total_qty_physical, color: [139, 92, 246], bgColor: [245, 243, 255] } // Purple
  ];

  statConfigs.forEach((stat, index) => {
    const boxX = statStartX + (index * (statBoxWidth + statGap));
    
    // Box background
    pdf.setFillColor(stat.bgColor[0], stat.bgColor[1], stat.bgColor[2]);
    pdf.rect(boxX, statY, statBoxWidth, statBoxHeight, 'F');
    
    // Box border (stroke only, no fill)
    pdf.setDrawColor(stat.color[0], stat.color[1], stat.color[2]);
    pdf.setLineWidth(0.5);
    pdf.setFillColor(255, 255, 255); // Reset fill to prevent unwanted fill
    pdf.rect(boxX, statY, statBoxWidth, statBoxHeight, 'S'); // 'S' = stroke only
    
    // Label
    pdf.setTextColor(75, 85, 99); // Gray-600
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(stat.label, boxX + statBoxWidth / 2, statY + 5, { align: 'center' });
    
    // Value
    pdf.setTextColor(stat.color[0], stat.color[1], stat.color[2]);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(String(stat.value), boxX + statBoxWidth / 2, statY + 13, { align: 'center' });
  });

  // Reset text color to black
  pdf.setTextColor(0, 0, 0);

  // ========== ENHANCED TABLE SECTION ==========
  // Position table below stat boxes with proper spacing
  // Stat boxes end at: statY + statBoxHeight = 42 + 16 = 58
  // Table header starts at: tableY - headerHeight + 2 = tableY - 12 + 2 = tableY - 10
  // To avoid overlap: tableY - 10 > 58, so tableY > 68
  // Set to 70 to give 2mm gap
  const tableY = 70;
  const colWidths = [12, 60, 22, 14, 30, 26, 26];
  const headers = ['S.N.', 'Item', 'Weight', 'Qty', 'Packet Size', 'Packed Today', 'Available'];
  const totalTableWidth = colWidths.reduce((a, b) => a + b, 0);
  const marginX = (210 - totalTableWidth) / 2;
  const rowHeight = 8;
  const headerHeight = 12;

  // Table header with enhanced styling
  pdf.setFillColor(37, 99, 235); // Blue-600
  pdf.rect(marginX, tableY - headerHeight + 2, totalTableWidth, headerHeight, 'F');
  
  // Header border (stroke only)
  pdf.setDrawColor(29, 78, 216); // Blue-700
  pdf.setLineWidth(0.5);
  pdf.setFillColor(255, 255, 255); // Reset fill to white/transparent
  pdf.rect(marginX, tableY - headerHeight + 2, totalTableWidth, headerHeight, 'S'); // 'S' = stroke only

  // Header text - white on blue background
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  let xPos = marginX;
  
  for (let i = 0; i < headers.length; i++) {
    const colCenterX = xPos + colWidths[i] / 2;
    pdf.text(cleanText(headers[i]), colCenterX, tableY - 3, { align: 'center' });
    xPos += colWidths[i];
  }

  // Draw horizontal line below header
  pdf.setDrawColor(29, 78, 216);
  pdf.setLineWidth(0.5);
  pdf.line(marginX, tableY + 2, marginX + totalTableWidth, tableY + 2);

  // Draw vertical lines between columns in header
  xPos = marginX;
  pdf.setDrawColor(59, 130, 246); // Lighter blue
  pdf.setLineWidth(0.3);
  for (let i = 0; i < headers.length; i++) {
    xPos += colWidths[i];
    if (i < headers.length - 1) {
      pdf.line(xPos, tableY - headerHeight + 2, xPos, tableY + 2);
    }
  }

  // Reset text color for table rows
  pdf.setTextColor(0, 0, 0);

  // Table rows with alternating colors
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  let currentY = tableY + rowHeight;
  let rowNum = 1;

  for (let idx = 0; idx < sortedItems.length; idx++) {
    const row = sortedItems[idx];
    
    // Check if we need a new page
    if (currentY > 280) {
      pdf.addPage();
      currentY = 20;
      
      // Redraw header on new page
      pdf.setFillColor(37, 99, 235);
      pdf.rect(marginX, currentY - headerHeight + 2, totalTableWidth, headerHeight, 'F');
      pdf.setDrawColor(29, 78, 216);
      pdf.setLineWidth(0.5);
      pdf.setFillColor(255, 255, 255); // Reset fill to white/transparent
      pdf.rect(marginX, currentY - headerHeight + 2, totalTableWidth, headerHeight, 'S'); // 'S' = stroke only
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      xPos = marginX;
      for (let i = 0; i < headers.length; i++) {
        const colCenterX = xPos + colWidths[i] / 2;
        pdf.text(cleanText(headers[i]), colCenterX, currentY - 3, { align: 'center' });
        xPos += colWidths[i];
      }
      
      pdf.setDrawColor(29, 78, 216);
      pdf.setLineWidth(0.5);
      pdf.line(marginX, currentY + 2, marginX + totalTableWidth, currentY + 2);
      xPos = marginX;
      pdf.setDrawColor(59, 130, 246);
      pdf.setLineWidth(0.3);
      for (let i = 0; i < headers.length; i++) {
        xPos += colWidths[i];
        if (i < headers.length - 1) {
          pdf.line(xPos, currentY - headerHeight + 2, xPos, currentY + 2);
        }
      }
      
      currentY = currentY + rowHeight;
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
    }

    // Alternating row background colors
    const isEvenRow = idx % 2 === 0;
    if (isEvenRow) {
      pdf.setFillColor(249, 250, 251); // Gray-50
      pdf.rect(marginX, currentY - 6, totalTableWidth, rowHeight, 'F');
      // Reset fill color to transparent after drawing
      pdf.setFillColor(255, 255, 255); // White (transparent effect)
    }

    // Draw vertical borders between columns
    xPos = marginX;
    pdf.setDrawColor(229, 231, 235); // Gray-200
    pdf.setLineWidth(0.2);
    for (let i = 0; i < headers.length; i++) {
      xPos += colWidths[i];
      if (i < headers.length - 1) {
        pdf.line(xPos, currentY - 6, xPos, currentY + 2);
      }
    }

    xPos = marginX;
    const itemName = cleanText(row.item);
    const isSplit = row.is_split || false;
    const isMissing = row.Status ? row.Status.includes('MISSING') : false;

    // Serial number (center aligned)
    pdf.setTextColor(107, 114, 128); // Gray-500
    pdf.setFont('helvetica', 'normal');
    pdf.text(String(rowNum), xPos + colWidths[0] / 2, currentY, { align: 'center' });
    xPos += colWidths[0];

    // Item name (left aligned, bold if split, red if missing)
    if (isMissing) {
      pdf.setTextColor(220, 38, 38); // Red-600
    } else if (isSplit) {
      pdf.setTextColor(37, 99, 235); // Blue-600
    } else {
      pdf.setTextColor(17, 24, 39); // Gray-900
    }
    
    if (isSplit || isMissing) {
      pdf.setFont('helvetica', 'bold');
    } else {
      pdf.setFont('helvetica', 'normal');
    }
    
    // Truncate item name if too long
    const maxItemLength = 30;
    const displayItemName = itemName.length > maxItemLength 
      ? itemName.substring(0, maxItemLength - 3) + '...' 
      : itemName;
    pdf.text(displayItemName, xPos + 1, currentY, { align: 'left' });
    pdf.setFont('helvetica', 'normal');
    xPos += colWidths[1];

    // Weight (center aligned)
    pdf.setTextColor(75, 85, 99); // Gray-600
    const weightText = cleanText(row.weight);
    pdf.text(weightText.substring(0, 8), xPos + colWidths[2] / 2, currentY, { align: 'center' });
    xPos += colWidths[2];

    // Quantity (center aligned, bold)
    pdf.setTextColor(17, 24, 39); // Gray-900
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(row.Qty), xPos + colWidths[3] / 2, currentY, { align: 'center' });
    pdf.setFont('helvetica', 'normal');
    xPos += colWidths[3];

    // Packet Size (center aligned)
    pdf.setTextColor(75, 85, 99); // Gray-600
    const packetSize = cleanText(row['Packet Size']);
    pdf.text(packetSize.substring(0, 15), xPos + colWidths[4] / 2, currentY, { align: 'center' });
    xPos += colWidths[4];

    // Packed Today (center aligned, empty by default)
    pdf.setTextColor(156, 163, 175); // Gray-400
    pdf.text('', xPos + colWidths[5] / 2, currentY, { align: 'center' });
    xPos += colWidths[5];

    // Available (center aligned, empty by default)
    pdf.text('', xPos + colWidths[6] / 2, currentY, { align: 'center' });

    // Draw horizontal line below row
    pdf.setDrawColor(229, 231, 235); // Gray-200
    pdf.setLineWidth(0.2);
    pdf.line(marginX, currentY + 2, marginX + totalTableWidth, currentY + 2);

    currentY += rowHeight;
    rowNum++;
  }

  // Draw final border around entire table (stroke only, no fill)
  pdf.setDrawColor(29, 78, 216); // Blue-700
  pdf.setLineWidth(0.5);
  pdf.setFillColor(255, 255, 255); // Ensure no fill
  const tableHeight = currentY - (tableY - headerHeight + 2);
  pdf.rect(marginX, tableY - headerHeight + 2, totalTableWidth, tableHeight, 'S'); // 'S' = stroke only

  // ========== FOOTER SECTION ==========
  // Add footer with page numbers and summary
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    
    // Footer line
    pdf.setDrawColor(229, 231, 235); // Gray-200
    pdf.setLineWidth(0.5);
    pdf.line(10, 287, 200, 287);
    
    // Footer text
    pdf.setTextColor(107, 114, 128); // Gray-500
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(`Page ${i} of ${pageCount}`, 105, 292, { align: 'center' });
    
    // Total items count on first page
    if (i === 1) {
      pdf.text(`Total Items: ${sortedItems.length}`, 200, 292, { align: 'right' });
    }
  }

  return pdf;
};
