import jsPDF from 'jspdf';
import { ManualPlanItemBlock } from './manualPackingPlanProcessor';
import { format } from 'date-fns';

/**
 * Generate PDF for manual packing plan
 * 
 * @param packingSummary Array of item blocks with packing data
 * @param combinedTotal Total packed weight across all items
 * @param combinedLoose Total loose weight across all items
 * @returns PDF document
 */
export const generateManualPlanPdf = (
  packingSummary: ManualPlanItemBlock[],
  combinedTotal: number,
  combinedLoose: number
): jsPDF => {
  const pdf = new jsPDF();
  
  // Header
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('Mithila Foods Packing Plan', 105, 15, { align: 'center' });
  
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  const dateStr = format(new Date(), 'dd-MM-yyyy');
  pdf.text(`Date: ${dateStr}`, 105, 22, { align: 'center' });
  
  pdf.setFontSize(10);
  let yPos = 30;

  // Process each item block
  for (const itemBlock of packingSummary) {
    try {
      // Check if we need a new page
      if (yPos > 250) {
        pdf.addPage();
        yPos = 20;
      }

      // Item name
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      const itemName = String(itemBlock.item || 'Unknown').substring(0, 50);
      pdf.text(`Item: ${itemName}`, 10, yPos);
      yPos += 8;

      // Target, Packed, Loose weights
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      const targetWeight = itemBlock.target_weight || 0;
      const packedWeight = itemBlock.packed_weight || 0;
      const looseWeight = itemBlock.loose_weight || 0;
      pdf.text(
        `Target: ${targetWeight} kg | Packed: ${packedWeight.toFixed(2)} kg | Loose: ${looseWeight.toFixed(2)} kg`,
        10,
        yPos
      );
      yPos += 8;

      // Table headers
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      
      // Draw table border
      const tableStartY = yPos - 2;
      const tableWidth = 190;
      const colWidths = [30, 35, 45, 30, 40];
      const headers = ['Variation', 'Pouch Size', 'ASIN', 'Packets', 'Packed (kg)'];
      
      // Header row background
      pdf.setFillColor(240, 240, 240);
      pdf.rect(10, tableStartY, tableWidth, 8, 'F');
      
      // Header borders
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.5);
      pdf.rect(10, tableStartY, tableWidth, 8);
      
      // Header text
      pdf.setFont('helvetica', 'bold');
      let xPos = 10;
      for (let i = 0; i < headers.length; i++) {
        pdf.text(headers[i], xPos + colWidths[i] / 2, tableStartY + 6, { align: 'center' });
        if (i < headers.length - 1) {
          pdf.line(xPos + colWidths[i], tableStartY, xPos + colWidths[i], tableStartY + 8);
        }
        xPos += colWidths[i];
      }
      
      yPos = tableStartY + 8;

      // Table data
      pdf.setFont('helvetica', 'normal');
      const data = itemBlock.data || [];
      
      for (const row of data) {
        // Check if we need a new page
        if (yPos > 270) {
          pdf.addPage();
          yPos = 20;
          // Redraw headers on new page
          pdf.setFillColor(240, 240, 240);
          pdf.rect(10, yPos - 2, tableWidth, 8, 'F');
          pdf.setDrawColor(0, 0, 0);
          pdf.rect(10, yPos - 2, tableWidth, 8);
          pdf.setFont('helvetica', 'bold');
          xPos = 10;
          for (let i = 0; i < headers.length; i++) {
            pdf.text(headers[i], xPos + colWidths[i] / 2, yPos + 4, { align: 'center' });
            if (i < headers.length - 1) {
              pdf.line(xPos + colWidths[i], yPos - 2, xPos + colWidths[i], yPos + 6);
            }
            xPos += colWidths[i];
          }
          pdf.setFont('helvetica', 'normal');
          yPos += 8;
        }

        try {
          const variation = String(row['Variation (kg)'] || 'N/A').substring(0, 8);
          const pouchSize = String(row['Pouch Size'] || 'N/A').substring(0, 12);
          const asin = String(row['ASIN'] || 'N/A').substring(0, 15);
          const packets = String(Math.floor(row['Packets to Pack'] || 0));
          const packed = (row['Weight Packed (kg)'] || 0).toFixed(2);

          // Draw row border
          pdf.setDrawColor(0, 0, 0);
          pdf.rect(10, yPos - 2, tableWidth, 8);

          // Draw cell borders and text
          xPos = 10;
          const values = [variation, pouchSize, asin, packets, packed];
          for (let i = 0; i < values.length; i++) {
            pdf.text(values[i], xPos + colWidths[i] / 2, yPos + 4, { align: 'center' });
            if (i < values.length - 1) {
              pdf.line(xPos + colWidths[i], yPos - 2, xPos + colWidths[i], yPos + 6);
            }
            xPos += colWidths[i];
          }

          yPos += 8;
        } catch (error) {
          console.error('Error adding row to PDF:', error);
          continue;
        }
      }

      yPos += 5; // Space between item blocks
    } catch (error) {
      console.error('Error processing item block:', error);
      continue;
    }
  }

  // Summary
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(
    `TOTAL PACKED: ${combinedTotal.toFixed(2)} kg | TOTAL LOOSE: ${combinedLoose.toFixed(2)} kg`,
    105,
    yPos + 5,
    { align: 'center' }
  );

  return pdf;
};

