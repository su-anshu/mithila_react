import React, { useState, useCallback } from 'react';
import { Upload, FileText, Download, AlertCircle, Package, Loader2, BarChart3 } from 'lucide-react';
import jsPDF from 'jspdf';
import { processStockData, StockItem } from '../../services/stockDataProcessor';
import SearchableTable from '../../components/SearchableTable';
import FileUploadZone from '../../components/FileUploadZone';
import EmptyState from '../../components/EmptyState';
import SkeletonTable from '../../components/SkeletonTable';
import { useToast } from '../../contexts/ToastContext';

interface PackedUnitStockViewProps {
  masterData?: any[];
}

const PackedUnitStockView: React.FC<PackedUnitStockViewProps> = ({ masterData = [] }) => {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockData, setStockData] = useState<StockItem[]>([]);
  const { showSuccess, showError } = useToast();


  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      setUploadedFile(null);
      setStockData([]);
      return;
    }

    const file = files[0];
    setUploadedFile(file);
    setError(null);
    setIsProcessing(true);
    setStockData([]);

    try {
      const data = await processStockData(file);
      setStockData(data);
      showSuccess('File processed successfully', `Found ${data.length} stock items`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process file';
      setError(errorMessage);
      showError('Processing failed', errorMessage);
      console.error('Error processing file:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [showSuccess, showError]);

  const handleExportCSV = useCallback(() => {
    if (stockData.length === 0) return;

    const headers = ['Product Name', 'SKU/Unit', 'Count(Qty)'];
    const csvContent = [
      headers.join(','),
      ...stockData.map(row => [
        `"${row['Product Name']}"`,
        `"${row['SKU/Unit']}"`,
        row['Count(Qty)']
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stock_count_filtered_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [stockData]);

  const handleExportPDF = useCallback(() => {
    if (stockData.length === 0) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const maxTableWidth = pageWidth - 2 * margin;
    
    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    const titleWidth = doc.getTextWidth('Packed Unit Stocks');
    doc.text('Packed Unit Stocks', (pageWidth - titleWidth) / 2, 15);
    
    // Table configuration
    const rowHeight = 8;
    const headerHeight = 12;
    const cellPadding = 3;
    const lineH = 4.2; // Consistent line height for multi-line text
    const topMargin = 20;
    const bottomMargin = 15;
    let yPos = 25;
    
    // Calculate column widths (Product Name: 50%, SKU/Unit: 30%, Count: 20%)
    const colWidths = [
      maxTableWidth * 0.50,  // Product Name
      maxTableWidth * 0.30,  // SKU/Unit
      maxTableWidth * 0.20   // Count(Qty)
    ];
    const tableStartX = margin;
    
    // Prepare table data
    const headers = ['Product Name', 'SKU/Unit', 'Count(Qty)'];
    const tableData = stockData.map(row => [
      row['Product Name'],
      row['SKU/Unit'],
      String(row['Count(Qty)'])
    ]);
    
    // Draw header row
    const drawHeader = (y: number) => {
      // Header background
      doc.setFillColor(37, 99, 235); // Blue-600
      doc.rect(tableStartX, y, maxTableWidth, headerHeight, 'F');
      
      // Header border
      doc.setDrawColor(29, 78, 216); // Blue-700
      doc.setLineWidth(0.5);
      doc.rect(tableStartX, y, maxTableWidth, headerHeight, 'S');
      
      // Header text - white on blue background
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      
      let xPos = tableStartX;
      for (let i = 0; i < headers.length; i++) {
        const colCenterX = xPos + colWidths[i] / 2;
        doc.text(headers[i], colCenterX, y + headerHeight - 3.5, { align: 'center' });
        
        // Draw vertical line between columns
        if (i < headers.length - 1) {
          doc.setDrawColor(59, 130, 246); // Lighter blue
          doc.setLineWidth(0.3);
          doc.line(xPos + colWidths[i], y, xPos + colWidths[i], y + headerHeight);
        }
        xPos += colWidths[i];
      }
      
      // Draw horizontal line below header
      doc.setDrawColor(29, 78, 216);
      doc.setLineWidth(0.5);
      doc.line(tableStartX, y + headerHeight, tableStartX + maxTableWidth, y + headerHeight);
    };
    
    // Draw header on first page
    drawHeader(yPos);
    yPos += headerHeight;
    
    // Reset text color for data rows
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    
    // Draw data rows
    for (let i = 0; i < tableData.length; i++) {
      const row = tableData[i];
      
      // A) Calculate actual row height needed (account for multi-line product names)
      // Compute lines for Product Name
      const lines = doc.splitTextToSize(row[0], colWidths[0] - cellPadding * 2);
      // Compute row height including padding
      const actualRowHeight = Math.max(rowHeight, lines.length * lineH + cellPadding * 2);
      
      // C) Fix page breaks correctly - check before drawing
      if (yPos + actualRowHeight > pageHeight - bottomMargin) {
        doc.addPage();
        yPos = topMargin;
        // Redraw header on new page
        drawHeader(yPos);
        yPos += headerHeight;
        // Reset text color, font, and size for data rows after header
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
      }
      
      // Alternating row colors
      if (i % 2 === 0) {
        doc.setFillColor(249, 250, 251); // Very light gray
        doc.rect(tableStartX, yPos, maxTableWidth, actualRowHeight, 'F');
      }
      
      // Draw cell content
      let xPos = tableStartX;
      for (let j = 0; j < row.length; j++) {
        const cellText = row[j] || '';
        
        // Determine alignment: left for Product Name, center for others
        const align = j === 0 ? 'left' : 'center';
        
        // Set font weight and ensure text color is black for Count column
        doc.setTextColor(0, 0, 0); // Ensure text is black
        if (j === 2) {
          doc.setFont('helvetica', 'bold');
        } else {
          doc.setFont('helvetica', 'normal');
        }
        
        // A) Handle text wrapping for Product Name - top-aligned multiline
        if (j === 0) {
          // Draw lines starting near top of the cell (not centered)
          const textStartY = yPos + cellPadding + lineH;
          doc.text(lines, xPos + cellPadding, textStartY);
        } else {
          // B) Keep other columns centered vertically
          const textX = align === 'center' 
            ? xPos + colWidths[j] / 2 
            : xPos + cellPadding;
          doc.text(cellText, textX, yPos + actualRowHeight / 2 + 2.5, { align });
        }
        
        // Draw vertical line between columns
        if (j < row.length - 1) {
          doc.setDrawColor(229, 231, 235); // Light gray
          doc.setLineWidth(0.25);
          doc.line(xPos + colWidths[j], yPos, xPos + colWidths[j], yPos + actualRowHeight);
        }
        
        xPos += colWidths[j];
      }
      
      // Draw horizontal line below row
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.25);
      doc.line(tableStartX, yPos + actualRowHeight, tableStartX + maxTableWidth, yPos + actualRowHeight);
      
      yPos += actualRowHeight;
    }
    
    // D) Remove the single outer border - rely on row/column lines only
    // (Outer border cannot work correctly across multiple pages)

    doc.save(`stock_count_filtered_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.pdf`);
  }, [stockData]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Packed Unit Stock Processor</h2>
        <p className="text-gray-600">Upload your Stock Count Excel or CSV file to extract product names and SKUs with positive counts</p>
      </div>

      {/* File Upload Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-slideIn">
        <FileUploadZone
          onFilesSelected={handleFilesSelected}
          accept=".xlsx,.xls,.csv"
          multiple={false}
          maxSizeMB={50}
          disabled={isProcessing}
          label="Upload Excel or CSV File"
          description="Excel or CSV files up to 50MB"
        />
      </div>

      {/* Processing Indicator */}
      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center animate-slideIn">
          <Loader2 className="animate-spin h-5 w-5 text-blue-600 mr-3" />
          <span className="text-blue-800">Processing file...</span>
        </div>
      )}

      {/* Results */}
      {stockData.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-slideIn">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Filtered Stock Data
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {stockData.length} items with positive counts (excluding "In Lot" items)
              </p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleExportCSV}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center transition-colors"
              >
                <Download className="h-5 w-5 mr-2" />
                Export CSV
              </button>
              <button
                onClick={handleExportPDF}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center transition-colors"
              >
                <FileText className="h-5 w-5 mr-2" />
                Export PDF
              </button>
            </div>
          </div>
          <SearchableTable
            data={stockData}
            columns={[
              {
                key: 'Product Name',
                label: 'Product Name',
                sortable: true
              },
              {
                key: 'SKU/Unit',
                label: 'SKU/Unit',
                sortable: true
              },
              {
                key: 'Count(Qty)',
                label: 'Count(Qty)',
                sortable: true,
                render: (value) => (
                  <span className="font-semibold">{value}</span>
                )
              }
            ]}
            searchPlaceholder="Search by product name, SKU, or quantity..."
            searchKeys={['Product Name', 'SKU/Unit', 'Count(Qty)']}
            itemsPerPage={20}
            exportFilename={`stock_count_filtered_${new Date().toISOString().split('T')[0].replace(/-/g, '')}`}
            onExport={(filteredData) => {
              const headers = ['Product Name', 'SKU/Unit', 'Count(Qty)'];
              const csvContent = [
                headers.join(','),
                ...filteredData.map(row => [
                  `"${row['Product Name']}"`,
                  `"${row['SKU/Unit']}"`,
                  row['Count(Qty)']
                ].join(','))
              ].join('\n');

              const blob = new Blob([csvContent], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `stock_count_filtered_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
            emptyMessage="No stock data available"
          />
        </div>
      )}

      {/* Empty State */}
      {!isProcessing && stockData.length === 0 && uploadedFile === null && (
        <EmptyState
          variant="no-data"
          title="No file uploaded"
          description="Upload your Stock Count Excel or CSV file to extract product names and SKUs with positive counts"
          action={{
            label: 'Upload File',
            onClick: () => {
              document.getElementById('file-upload-input')?.click();
            }
          }}
        />
      )}
    </div>
  );
};

export default PackedUnitStockView;

