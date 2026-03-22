import React, { useState, useCallback } from 'react';
import { Upload, FileText, Download, AlertCircle, Package, Loader2, BarChart3, TrendingUp } from 'lucide-react';
import DownloadButton from '../../components/DownloadButton';
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
    <div className="w-full max-w-7xl mx-auto space-y-4">

      {/* Upload + Stats row */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-start gap-4">
          {/* Upload zone - compact */}
          <div className="flex-1 min-w-0">
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
              <div className="mt-3">
                <ProgressBar
                  progress={processingProgress * 100}
                  label="Processing file..."
                  showPercentage={true}
                  size="sm"
                  color="blue"
                  animated={true}
                />
              </div>
            )}
            {uploadedFile && !isProcessing && (
              <p className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                {uploadedFile.name}
              </p>
            )}
          </div>

          {/* Stats — shown inline once processed */}
          {multiItemStats && processedOrders.length > 0 && (
            <div className="flex flex-col gap-2 shrink-0 w-52">
              <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-gray-400" />
                  <span className="text-xs text-gray-500">Total Orders</span>
                </div>
                <span className="text-sm font-bold text-gray-900">{multiItemStats.totalOrders}</span>
              </div>
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-amber-400" />
                  <span className="text-xs text-gray-500">Multi-Item</span>
                </div>
                <span className="text-sm font-bold text-amber-700">{multiItemStats.multiItemCount}</span>
              </div>
              <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                multiItemStats.riskLevel === 'High' ? 'bg-red-50 border-red-200' :
                multiItemStats.riskLevel === 'Medium' ? 'bg-orange-50 border-orange-200' :
                'bg-green-50 border-green-200'
              }`}>
                <div className="flex items-center gap-2">
                  <TrendingUp className={`h-4 w-4 ${
                    multiItemStats.riskLevel === 'High' ? 'text-red-400' :
                    multiItemStats.riskLevel === 'Medium' ? 'text-orange-400' :
                    'text-green-400'
                  }`} />
                  <span className="text-xs text-gray-500">Risk</span>
                </div>
                <span className={`text-sm font-bold ${
                  multiItemStats.riskLevel === 'High' ? 'text-red-700' :
                  multiItemStats.riskLevel === 'Medium' ? 'text-orange-700' :
                  'text-green-700'
                }`}>{multiItemStats.riskLevel}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report Generation — compact single card */}
      {processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Orientation toggle */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Orientation:</span>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                {(['Portrait', 'Landscape'] as Orientation[]).map((orient) => (
                  <button
                    key={orient}
                    onClick={() => setOrientation(orient)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      orientation === orient
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {orient}
                  </button>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleGeneratePDF}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Generate PDF
              </button>
              <button
                onClick={handleGenerateExcel}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download className="h-4 w-4" />
                Generate Excel
              </button>
              {pdfBytes && (
                <DownloadButton
                  onDownload={handleDownloadPDF}
                  tickSize="h-4 w-4"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </DownloadButton>
              )}
              {excelBlob && (
                <DownloadButton
                  onDownload={handleDownloadExcel}
                  tickSize="h-4 w-4"
                  className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 border border-green-200 text-sm font-medium rounded-lg hover:bg-green-100 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Download Excel
                </DownloadButton>
              )}
            </div>
          </div>
          {multiItemStats && multiItemStats.multiItemCount > 0 && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
              <strong>{multiItemStats.multiItemCount}</strong> orders contain multiple items — require complete packing
            </p>
          )}
        </div>
      )}

      {/* Preview Data */}
      {processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Orders Preview</h3>
            {processedOrders.length > 20 && (
              <span className="text-xs text-gray-400">Showing 20 of {processedOrders.length}</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Tracking ID', 'SKU', 'Product Name', 'Qty', 'Dispatch Date'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedOrders.slice(0, 20).map((order, idx) => (
                  <tr key={idx} className={order.highlight ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-700">{order['tracking-id']}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-700">{order.sku}</td>
                    <td className="px-4 py-2 text-xs text-gray-700">{order['product-name']}</td>
                    <td className={`px-4 py-2 whitespace-nowrap text-xs font-semibold ${order.highlight ? 'text-red-600' : 'text-gray-900'}`}>{order.qty}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-700">{order['pickup-slot']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default FlipkartEasyShipView;
