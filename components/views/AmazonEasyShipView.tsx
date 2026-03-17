import React, { useState, useCallback } from 'react';
import { Upload, FileText, Download, AlertCircle, Package, Loader2, BarChart3, TrendingUp } from 'lucide-react';
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
    
    const styleSuffix = 'MultiItem';
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
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Amazon Easy Ship Report Generator</h2>
        <p className="text-gray-600">Upload your Amazon Easy Ship Excel file to generate packing reports</p>
      </div>

      {/* Master Data Warning */}
      {(masterData.length === 0 || masterDataWarning) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-yellow-800 font-medium">
                {masterData.length === 0 
                  ? 'Master data not available' 
                  : 'Master data issue'}
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                {masterDataWarning || 'Product names may not be cleaned. Master data helps improve product name formatting.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* File Upload Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-slideIn">
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

      {/* Empty State */}
      {!isProcessing && processedOrders.length === 0 && uploadedFile === null && (
        <EmptyState
          variant="no-data"
          title="No file uploaded"
          description="Upload your Amazon Easy Ship Excel file to generate order reports"
        />
      )}

      {/* Order Analysis */}
      {multiItemStats && processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Order Analysis</h3>
          
          {/* Order count caption */}
          <p className="text-sm text-gray-600 mb-4">
            {processedOrders.length} orders processed successfully
          </p>

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

          {multiItemStats.multiItemCount > 0 ? (
            <>
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800">
                  <strong>{multiItemStats.multiItemCount}</strong> orders contain multiple items - require complete packing
                </p>
              </div>

              {/* Multi-Item Order Details Expander */}
              <details className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
                <summary className="cursor-pointer text-sm font-semibold text-gray-700 flex items-center gap-2 hover:text-gray-900">
                  <AlertCircle className="h-4 w-4" />
                  View Multi-Item Order Details
                </summary>
                <div className="mt-4 space-y-3">
                  {multiItemStats.multiItemOrders.slice(0, 5).map((trackingId) => {
                    const orderItems = processedOrders.filter(o => o['tracking-id'] === trackingId);
                    const itemsList = orderItems.map(o => o['product-name']);
                    return (
                      <div key={trackingId} className="bg-white p-3 rounded border border-gray-200">
                        <p className="text-sm font-medium text-gray-900">
                          <strong>{trackingId}:</strong> {itemsList.join(', ')}
                        </p>
                      </div>
                    );
                  })}
                  {multiItemStats.multiItemOrders.length > 5 && (
                    <p className="text-sm text-gray-600 italic">
                      ... and {multiItemStats.multiItemOrders.length - 5} more multi-item orders
                    </p>
                  )}
                </div>
              </details>
            </>
          ) : (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">
                All orders are single-item orders - no risk of incomplete packing
              </p>
            </div>
          )}
        </div>
      )}

      {/* Report Generation Options */}
      {processedOrders.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
          <h3 className="text-lg font-semibold text-gray-900">Report Generation</h3>

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
              {
                key: 'asin',
                label: 'ASIN',
                sortable: true,
                className: 'whitespace-nowrap'
              },
              {
                key: 'product-name',
                label: 'Product Name',
                sortable: true
              },
              {
                key: 'qty',
                label: 'Qty',
                sortable: true,
                render: (value) => (
                  <span className="font-semibold whitespace-nowrap">{value}</span>
                )
              },
              {
                key: 'pickup-slot',
                label: 'Pickup Date',
                sortable: true,
                className: 'whitespace-nowrap'
              }
            ]}
            searchPlaceholder="Search by tracking ID, ASIN, product name, or quantity..."
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
