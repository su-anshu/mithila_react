import React, { useState, useCallback } from 'react';
import { Upload, FileText, Download, AlertCircle, Package, Loader2, BarChart3, TrendingUp } from 'lucide-react';
import { processFlipkartFile, ProcessedOrder, detectMultiItemOrders, applyProductNameMapping, createProductNameMapping } from '../../services/excelProcessor';
import { generateReportPDF, generateReportExcel, GroupingStyle, Orientation } from '../../services/reportGenerator';
import { MasterProduct } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import FileUploadZone from '../../components/FileUploadZone';
import EmptyState from '../../components/EmptyState';
import SkeletonTable from '../../components/SkeletonTable';
import ProgressBar from '../../components/ProgressBar';

interface FlipkartEasyShipViewProps {
  masterData?: MasterProduct[];
}

const FlipkartEasyShipView: React.FC<FlipkartEasyShipViewProps> = ({ masterData = [] }) => {
  const { showSuccess, showError } = useToast();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processedOrders, setProcessedOrders] = useState<ProcessedOrder[]>([]);
  const [multiItemStats, setMultiItemStats] = useState<ReturnType<typeof detectMultiItemOrders> | null>(null);
  const [groupingStyle, setGroupingStyle] = useState<GroupingStyle>('Multi-Item First, Then By Product (Recommended)');
  const [orientation, setOrientation] = useState<Orientation>('Portrait');
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [excelBlob, setExcelBlob] = useState<Blob | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      setUploadedFile(null);
      setProcessedOrders([]);
      setMultiItemStats(null);
      setPdfBytes(null);
      setExcelBlob(null);
      return;
    }

    const file = files[0];
    setUploadedFile(file);
    setError(null);
    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessedOrders([]);
    setMultiItemStats(null);
    setPdfBytes(null);
    setExcelBlob(null);

    try {
      // Process file (handles both Excel and CSV)
      const orders = await processFlipkartFile(file);

      // Apply product name mapping if master data is available
      let finalOrders = orders;
      if (masterData.length > 0) {
        const nameMapping = createProductNameMapping(masterData, 'SKU', 'ASIN');
        finalOrders = applyProductNameMapping(orders, nameMapping, 'sku');
      }

      // Detect multi-item orders
      const stats = detectMultiItemOrders(finalOrders, 'sku');

      setProcessingProgress(1);
      setProcessedOrders(finalOrders);
      setMultiItemStats(stats);
      showSuccess('File processed successfully', `Found ${finalOrders.length} orders`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process file';
      setError(errorMessage);
      showError('Processing failed', errorMessage);
      console.error('Error processing file:', err);
    } finally {
      setIsProcessing(false);
      setProcessingProgress(0);
    }
  }, [masterData, showSuccess, showError]);

  const handleGeneratePDF = useCallback(async () => {
    if (processedOrders.length === 0 || !multiItemStats) return;

    setIsProcessing(true);
    try {
      const pdf = generateReportPDF(processedOrders, {
        groupingStyle,
        orientation,
        multiItemOrders: multiItemStats.multiItemOrders,
        stats: multiItemStats,
        title: `Flipkart Report - ${multiItemStats.totalOrders} Orders - ${new Date().toISOString().split('T')[0]}`
      });
      setPdfBytes(pdf);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF');
      console.error('Error generating PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [processedOrders, multiItemStats, groupingStyle, orientation]);

  const handleGenerateExcel = useCallback(() => {
    if (processedOrders.length === 0 || !multiItemStats) return;

    try {
      const blob = generateReportExcel(processedOrders, multiItemStats.multiItemOrders, multiItemStats);
      setExcelBlob(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate Excel');
      console.error('Error generating Excel:', err);
    }
  }, [processedOrders, multiItemStats]);

  const handleDownloadPDF = useCallback(() => {
    if (!pdfBytes) return;

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const styleSuffix = groupingStyle.includes('Multi-Item') ? 'MultiItem' 
      : groupingStyle.includes('Warnings') ? 'WithWarnings' 
      : 'Standard';
    link.download = `Flipkart_${styleSuffix}_${processedOrders.length}_Orders_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.pdf`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [pdfBytes, groupingStyle, processedOrders.length]);

  const handleDownloadExcel = useCallback(() => {
    if (!excelBlob) return;

    const url = URL.createObjectURL(excelBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Flipkart_Report_Data_${processedOrders.length}_Orders_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [excelBlob, processedOrders.length]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Flipkart Order Report Generator</h2>
        <p className="text-gray-600">Upload your Flipkart Excel or CSV file to generate packing reports</p>
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
        
        {isProcessing && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <ProgressBar
              progress={processingProgress * 100}
              label="Processing file..."
              showPercentage={true}
              size="md"
              color="blue"
              animated={true}
            />
          </div>
        )}

        {uploadedFile && !isProcessing && (
          <p className="text-sm text-gray-700 mt-2">
            <FileText className="inline h-4 w-4 mr-1" />
            {uploadedFile.name}
          </p>
        )}
      </div>

      {/* Order Analysis */}
      {multiItemStats && processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Order Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center">
                <Package className="h-5 w-5 text-gray-400 mr-2" />
                <div>
                  <p className="text-sm text-gray-600">Total Orders</p>
                  <p className="text-2xl font-bold text-gray-900">{multiItemStats.totalOrders}</p>
                </div>
              </div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4">
              <div className="flex items-center">
                <BarChart3 className="h-5 w-5 text-yellow-400 mr-2" />
                <div>
                  <p className="text-sm text-gray-600">Multi-Item Orders</p>
                  <p className="text-2xl font-bold text-yellow-700">{multiItemStats.multiItemCount}</p>
                </div>
              </div>
            </div>
            <div className={`rounded-lg p-4 ${
              multiItemStats.riskLevel === 'High' ? 'bg-red-50' :
              multiItemStats.riskLevel === 'Medium' ? 'bg-orange-50' :
              'bg-green-50'
            }`}>
              <div className="flex items-center">
                <TrendingUp className={`h-5 w-5 mr-2 ${
                  multiItemStats.riskLevel === 'High' ? 'text-red-400' :
                  multiItemStats.riskLevel === 'Medium' ? 'text-orange-400' :
                  'text-green-400'
                }`} />
                <div>
                  <p className="text-sm text-gray-600">Risk Level</p>
                  <p className={`text-2xl font-bold ${
                    multiItemStats.riskLevel === 'High' ? 'text-red-700' :
                    multiItemStats.riskLevel === 'Medium' ? 'text-orange-700' :
                    'text-green-700'
                  }`}>
                    {multiItemStats.riskLevel}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {multiItemStats.multiItemCount > 0 && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-sm text-yellow-800">
                <strong>{multiItemStats.multiItemCount}</strong> orders contain multiple items - require complete packing
              </p>
            </div>
          )}
        </div>
      )}

      {/* Report Generation Options */}
      {processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
          <h3 className="text-lg font-semibold text-gray-900">Report Generation</h3>

          {/* Grouping Style */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Report Grouping Style
            </label>
            <div className="space-y-2">
              {([
                'By Product Only (Current Method)',
                'Multi-Item First, Then By Product (Recommended)',
                'By Product with Multi-Item Warnings'
              ] as GroupingStyle[]).map((style) => (
                <label key={style} className="flex items-center">
                  <input
                    type="radio"
                    name="grouping-style"
                    value={style}
                    checked={groupingStyle === style}
                    onChange={(e) => setGroupingStyle(e.target.value as GroupingStyle)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-700">{style}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Page Orientation
            </label>
            <div className="flex space-x-4">
              {(['Portrait', 'Landscape'] as Orientation[]).map((orient) => (
                <label key={orient} className="flex items-center">
                  <input
                    type="radio"
                    name="orientation"
                    value={orient}
                    checked={orientation === orient}
                    onChange={(e) => setOrientation(e.target.value as Orientation)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-700">{orient}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Generate Buttons */}
          <div className="flex space-x-4">
            <button
              onClick={handleGeneratePDF}
              disabled={isProcessing}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin h-5 w-5 mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="h-5 w-5 mr-2" />
                  Generate PDF Report
                </>
              )}
            </button>
            <button
              onClick={handleGenerateExcel}
              disabled={isProcessing}
              className="flex-1 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <Download className="h-5 w-5 mr-2" />
              Generate Excel Export
            </button>
          </div>

          {/* Download Buttons */}
          {pdfBytes && (
            <button
              onClick={handleDownloadPDF}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center"
            >
              <Download className="h-5 w-5 mr-2" />
              Download PDF Report
            </button>
          )}

          {excelBlob && (
            <button
              onClick={handleDownloadExcel}
              className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center justify-center"
            >
              <Download className="h-5 w-5 mr-2" />
              Download Excel File
            </button>
          )}
        </div>
      )}

      {/* Preview Data */}
      {processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Preview Processed Data</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tracking ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Qty
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Dispatch Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {processedOrders.slice(0, 20).map((order, idx) => (
                  <tr key={idx} className={order.highlight ? 'bg-yellow-50' : ''}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {order['tracking-id']}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {order.sku}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {order['product-name']}
                    </td>
                    <td className={`px-4 py-3 whitespace-nowrap text-sm font-semibold ${
                      order.highlight ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {order.qty}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {order['pickup-slot']}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {processedOrders.length > 20 && (
              <p className="mt-2 text-sm text-gray-500 text-center">
                Showing first 20 of {processedOrders.length} orders
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FlipkartEasyShipView;
