import React, { useState, useCallback } from 'react';
import { Upload, FileText, Download, AlertCircle, Package, Loader2, X } from 'lucide-react';
import DownloadButton from '../../components/DownloadButton';
import { MasterProduct, PhysicalItem, OrderItem } from '../../types';
import { processManualPlanFile, processManualPlanItem, ProcessedManualPlan, ManualPlanItemBlock } from '../../services/manualPackingPlanProcessor';
import { generateManualPlanPdf } from '../../services/manualPlanPdfGenerator';
import { downloadExcel } from '../../services/excelExporter';
import { useToast } from '../../contexts/ToastContext';
import FileUploadZone from '../../components/FileUploadZone';
import EmptyState from '../../components/EmptyState';
import SkeletonTable from '../../components/SkeletonTable';
import ProgressBar from '../../components/ProgressBar';

interface ManualPackingPlanViewProps {
  masterData?: MasterProduct[];
}

interface SelectedItemConfig {
  item: string;
  targetWeight: number;
  block: ManualPlanItemBlock | null;
}

const ManualPackingPlanView: React.FC<ManualPackingPlanViewProps> = ({ masterData = [] }) => {
  const { showSuccess, showError } = useToast();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processedData, setProcessedData] = useState<ProcessedManualPlan | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [itemConfigs, setItemConfigs] = useState<Map<string, SelectedItemConfig>>(new Map());
  const [packingSummary, setPackingSummary] = useState<ManualPlanItemBlock[]>([]);
  const [processingProgress, setProcessingProgress] = useState(0);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      setUploadedFile(null);
      setProcessedData(null);
      setSelectedItems([]);
      setItemConfigs(new Map());
      setPackingSummary([]);
      return;
    }

    const file = files[0];
    setUploadedFile(file);
    setError(null);
    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessedData(null);
    setSelectedItems([]);
    setItemConfigs(new Map());
    setPackingSummary([]);

    try {
      setProcessingProgress(0.3);
      const result = await processManualPlanFile(file);
      setProcessingProgress(0.7);
      setProcessedData(result);
      
      if (result.parentItems.length === 0) {
        const errorMsg = 'No parent items found in the data. Please check the file format.';
        setError(errorMsg);
        showError('Processing failed', errorMsg);
      } else {
        setProcessingProgress(1);
        showSuccess('File processed successfully', `Found ${result.items.length} items`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process file';
      setError(errorMessage);
      showError('Processing failed', errorMessage);
      console.error('Error processing file:', err);
    } finally {
      setIsProcessing(false);
      setProcessingProgress(0);
    }
  }, [showSuccess, showError]);

  // Keep old handler for backward compatibility if needed
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    handleFilesSelected([file]);
  }, [handleFilesSelected]);

  const handleItemSelection = useCallback((item: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedItems(prev => [...prev, item]);
      setItemConfigs(prev => {
        const newMap = new Map(prev);
        if (!newMap.has(item)) {
          newMap.set(item, { item, targetWeight: 100, block: null });
        }
        return newMap;
      });
    } else {
      setSelectedItems(prev => prev.filter(i => i !== item));
      setItemConfigs(prev => {
        const newMap = new Map(prev);
        newMap.delete(item);
        return newMap;
      });
    }
  }, []);

  const handleTargetWeightChange = useCallback((item: string, weight: number) => {
    setItemConfigs(prev => {
      const newMap = new Map(prev);
      const config = newMap.get(item);
      if (config) {
        newMap.set(item, { ...config, targetWeight: weight, block: null });
      }
      return newMap;
    });
  }, []);

  const handleProcessItem = useCallback((item: string) => {
    if (!processedData) return;

    const config = itemConfigs.get(item);
    if (!config) return;

    const block = processManualPlanItem(
      item,
      config.targetWeight,
      processedData,
      masterData
    );

    if (block) {
      setItemConfigs(prev => {
        const newMap = new Map(prev);
        newMap.set(item, { ...config, block });
        return newMap;
      });

      // Update packing summary
      setPackingSummary(prev => {
        const filtered = prev.filter(b => b.item !== item);
        return [...filtered, block];
      });
    }
  }, [processedData, itemConfigs, masterData]);

  const handleDownloadPdf = useCallback(() => {
    if (packingSummary.length === 0) {
      showError('No data', 'No packing plan data to generate PDF');
      return;
    }

    const combinedTotal = packingSummary.reduce((sum, block) => sum + (block.packed_weight || 0), 0);
    const combinedLoose = packingSummary.reduce((sum, block) => sum + (block.loose_weight || 0), 0);

    const pdf = generateManualPlanPdf(packingSummary, combinedTotal, combinedLoose);
    const pdfBytes = pdf.output('arraybuffer');
    
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `MithilaFoods_PackingPlan_${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [packingSummary]);

  const handleDownloadExcel = useCallback(() => {
    if (packingSummary.length === 0) {
      showError('No data', 'No packing plan data to generate Excel');
      return;
    }

    // Convert packing summary to physical items and orders
    const physicalItems: PhysicalItem[] = [];
    const orders: OrderItem[] = [];

    for (const block of packingSummary) {
      for (const variation of block.data) {
        physicalItems.push({
          item: block.item,
          item_name_for_labels: block.item,
          weight: String(variation['Variation (kg)']),
          Qty: variation['Packets to Pack'],
          'Packet Size': variation['Pouch Size'],
          'Packet used': variation['Pouch Size'],
          ASIN: variation['ASIN'],
          MRP: 'N/A',
          FNSKU: 'N/A',
          FSSAI: 'N/A',
          'Packed Today': '',
          Available: '',
          Status: '✅ READY',
          is_split: false
        });

        orders.push({
          ASIN: variation['ASIN'],
          Qty: variation['Packets to Pack']
        });
      }
    }

    downloadExcel(physicalItems, orders, undefined, `Manual_Packing_Plan_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.xlsx`);
    showSuccess('Excel exported', 'Packing plan Excel file downloaded successfully');
  }, [packingSummary, showSuccess]);

  const combinedTotal = packingSummary.reduce((sum, block) => sum + (block.packed_weight || 0), 0);
  const combinedLoose = packingSummary.reduce((sum, block) => sum + (block.loose_weight || 0), 0);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Manual Packing Plan Generator</h2>
        <p className="text-gray-600">Upload an Excel file with Row Labels to generate a manual packing plan</p>
      </div>

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
      {!isProcessing && !processedData && uploadedFile === null && (
        <EmptyState
          variant="no-data"
          title="No file uploaded"
          description="Upload your Excel file with Row Labels to generate a manual packing plan"
        />
      )}

      {/* Item Selection */}
      {processedData && processedData.parentItems.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Items to Pack</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-md p-4">
            {processedData.parentItems.map((item) => (
              <label key={item} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                <input
                  type="checkbox"
                  checked={selectedItems.includes(item)}
                  onChange={(e) => handleItemSelection(item, e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{item}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Item Configuration and Processing */}
      {selectedItems.length > 0 && processedData && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
          <h3 className="text-lg font-semibold text-gray-900">Configure Items</h3>
          {selectedItems.map((item) => {
            const config = itemConfigs.get(item);
            if (!config) return null;

            return (
              <div key={item} className="border border-gray-200 rounded-lg p-4 space-y-4">
                <h4 className="font-semibold text-gray-900">{item}</h4>
                
                <div className="flex items-center space-x-4">
                  <label className="text-sm text-gray-700">
                    Target Weight (kg):
                    <input
                      type="number"
                      min="1"
                      step="10"
                      value={config.targetWeight}
                      onChange={(e) => handleTargetWeightChange(item, parseFloat(e.target.value) || 100)}
                      className="ml-2 px-3 py-1 border border-gray-300 rounded-md w-32"
                    />
                  </label>
                  <button
                    onClick={() => handleProcessItem(item)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center"
                  >
                    <Package className="w-4 h-4 mr-2" />
                    Process Item
                  </button>
                </div>

                {config.block && (
                  <div className="mt-4">
                    <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                      <div className="bg-gray-50 p-3 rounded">
                        <p className="text-gray-600">Target</p>
                        <p className="text-lg font-bold">{config.block.target_weight} kg</p>
                      </div>
                      <div className="bg-green-50 p-3 rounded">
                        <p className="text-gray-600">Packed</p>
                        <p className="text-lg font-bold text-green-700">{config.block.packed_weight.toFixed(2)} kg</p>
                      </div>
                      <div className="bg-yellow-50 p-3 rounded">
                        <p className="text-gray-600">Loose</p>
                        <p className="text-lg font-bold text-yellow-700">{config.block.loose_weight.toFixed(2)} kg</p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Variation (kg)</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Pouch Size</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">ASIN</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Packets to Pack</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Weight Packed (kg)</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {config.block.data.map((row, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-2">{row['Variation (kg)']}</td>
                              <td className="px-3 py-2">{row['Pouch Size']}</td>
                              <td className="px-3 py-2">{row['ASIN']}</td>
                              <td className="px-3 py-2">{row['Packets to Pack']}</td>
                              <td className="px-3 py-2">{row['Weight Packed (kg)'].toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary and Downloads */}
      {packingSummary.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-green-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Total Packed</p>
              <p className="text-2xl font-bold text-green-700">{combinedTotal.toFixed(2)} kg</p>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Total Loose</p>
              <p className="text-2xl font-bold text-yellow-700">{combinedLoose.toFixed(2)} kg</p>
            </div>
          </div>

          <div className="flex space-x-4">
            <DownloadButton
              onDownload={handleDownloadPdf}
              tickSize="h-5 w-5"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center"
            >
              <Download className="w-5 h-5 mr-2" />
              Download PDF
            </DownloadButton>
            <DownloadButton
              onDownload={handleDownloadExcel}
              tickSize="h-5 w-5"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
            >
              <Download className="w-5 h-5 mr-2" />
              Download Excel
            </DownloadButton>
          </div>
        </div>
      )}

    </div>
  );
};

export default ManualPackingPlanView;
