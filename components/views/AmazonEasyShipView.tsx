import React, { useState, useCallback } from 'react';
import { Upload, FileText, Download, AlertCircle, Package, Loader2, BarChart3, TrendingUp } from 'lucide-react';
import DownloadButton from '../../components/DownloadButton';
import { processAmazonEasyShipExcel, ProcessedOrder, detectMultiItemOrders, applyProductNameMapping, createProductNameMapping } from '../../services/excelProcessor';
import { generateReportPDF, generateReportExcel, GroupingStyle, Orientation } from '../../services/reportGenerator';
import SearchableTable from '../../components/SearchableTable';
import { MasterProduct } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import FileUploadZone from '../../components/FileUploadZone';
import EmptyState from '../../components/EmptyState';
import SkeletonTable from '../../components/SkeletonTable';
import ProgressBar from '../../components/ProgressBar';

interface AmazonEasyShipViewProps {
  masterData?: MasterProduct[];
}

const AmazonEasyShipView: React.FC<AmazonEasyShipViewProps> = ({ masterData = [] }) => {
  const { showSuccess, showError } = useToast();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processedOrders, setProcessedOrders] = useState<ProcessedOrder[]>([]);
  const [multiItemStats, setMultiItemStats] = useState<ReturnType<typeof detectMultiItemOrders> | null>(null);
  const [groupingStyle] = useState<GroupingStyle>('Multi-Item First, Then By Product (Recommended)');
  const [orientation, setOrientation] = useState<Orientation>('Portrait');
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [excelBlob, setExcelBlob] = useState<Blob | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [masterDataWarning, setMasterDataWarning] = useState<string>('');

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      setUploadedFile(null);
      setProcessedOrders([]);
      setMultiItemStats(null);
      setPdfBytes(null);
      setExcelBlob(null);
      setMasterDataWarning('');
      setError(null);
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
    setMasterDataWarning('');

    try {
      // Process Excel file
      const orders = await processAmazonEasyShipExcel(file);

      // Apply product name mapping if master data is available
      let finalOrders = orders;
      let warningMsg = '';
      if (masterData.length > 0) {
        try {
          const nameMapping = createProductNameMapping(masterData, 'ASIN');
          if (nameMapping.size === 0) {
            warningMsg = 'Master data missing required columns (Name, ASIN)';
          } else {
            finalOrders = applyProductNameMapping(orders, nameMapping, 'asin');
            
            // Debug: Log first 5 mapped orders
            const mappedOrders = finalOrders.filter(order => {
              const originalOrder = orders.find(o => o['tracking-id'] === order['tracking-id'] && o.asin === order.asin);
              return originalOrder && originalOrder['product-name'] !== order['product-name'];
            });
            
            if (mappedOrders.length > 0) {
              console.log('[AmazonEasyShipView] First 5 mapped orders:');
              mappedOrders.slice(0, 5).forEach((order, idx) => {
                console.log(`  ${idx + 1}. ASIN: ${order.asin}, Clean Product Name: ${order['product-name']}`);
              });
            }
          }
        } catch (e) {
          warningMsg = `Could not process master data: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      // Detect multi-item orders
      const stats = detectMultiItemOrders(finalOrders, 'asin');

      setProcessingProgress(1);
      setProcessedOrders(finalOrders);
      setMultiItemStats(stats);
      setMasterDataWarning(warningMsg);
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
        title: `Easy Ship Report - ${multiItemStats.totalOrders} Orders - ${new Date().toISOString().split('T')[0]}`
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
    
    const styleSuffix = groupingStyle.includes('Multi-Item First') ? 'MultiItem'
      : groupingStyle.includes('Warnings') ? 'WithWarnings'
      : 'Standard';
    link.download = `EasyShip_${styleSuffix}_${processedOrders.length}_Orders_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.pdf`;
    
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
    link.download = `Easy_Ship_Data_${processedOrders.length}_Orders_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [excelBlob, processedOrders.length]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4">

      {/* Master Data Warning — compact banner */}
      {(masterData.length === 0 || masterDataWarning) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
          <span>
            <strong>{masterData.length === 0 ? 'Master data not available' : 'Master data issue'}:</strong>{' '}
            {masterDataWarning || 'Product names may not be cleaned.'}
          </span>
        </div>
      )}

      {/* Upload + Stats row */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-start gap-4">
          {/* Upload zone */}
          <div className="flex-1 min-w-0">
            <FileUploadZone
              onFilesSelected={handleFilesSelected}
              accept=".xlsx,.xls"
              multiple={false}
              maxSizeMB={50}
              disabled={isProcessing}
              label="Upload Excel File"
              description="Excel files (.xlsx, .xls) up to 50MB"
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

      {/* Report Generation — compact single row */}
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
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 flex items-center gap-1.5 w-fit">
                <AlertCircle className="h-3.5 w-3.5" />
                <strong>{multiItemStats.multiItemCount}</strong> multi-item orders — click to view
              </summary>
              <div className="mt-2 space-y-1.5 pl-1">
                {multiItemStats.multiItemOrders.slice(0, 5).map((trackingId) => {
                  const items = processedOrders.filter(o => o['tracking-id'] === trackingId).map(o => o['product-name']);
                  return (
                    <div key={trackingId} className="bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs text-gray-700">
                      <strong>{trackingId}:</strong> {items.join(', ')}
                    </div>
                  );
                })}
                {multiItemStats.multiItemOrders.length > 5 && (
                  <p className="text-xs text-gray-500 italic pl-1">...and {multiItemStats.multiItemOrders.length - 5} more</p>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Preview Data */}
      {processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">Orders Preview</h3>
          </div>
          <SearchableTable
            data={processedOrders}
            columns={[
              {
                key: 'tracking-id',
                label: 'Tracking ID',
                sortable: true,
                render: (value) => (
                  <span className="whitespace-nowrap">
                    {String(value).substring(String(value).length - 12)}
                  </span>
                )
              },
              { key: 'asin', label: 'ASIN', sortable: true, className: 'whitespace-nowrap' },
              { key: 'product-name', label: 'Product Name', sortable: true },
              {
                key: 'qty',
                label: 'Qty',
                sortable: true,
                render: (value) => <span className="font-semibold whitespace-nowrap">{value}</span>
              },
              { key: 'pickup-slot', label: 'Pickup Date', sortable: true, className: 'whitespace-nowrap' }
            ]}
            searchPlaceholder="Search by tracking ID, ASIN, product name..."
            searchKeys={['tracking-id', 'asin', 'product-name', 'qty', 'pickup-slot']}
            itemsPerPage={20}
            exportFilename={`EasyShip_Orders_${new Date().toISOString().split('T')[0].replace(/-/g, '')}`}
            highlightRow={(row) => row.highlight || false}
            emptyMessage="No orders processed yet"
          />
        </div>
      )}
    </div>
  );
};

export default AmazonEasyShipView;
