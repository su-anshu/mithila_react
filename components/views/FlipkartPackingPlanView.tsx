import React, { useState, useCallback, useMemo } from 'react';
import { Upload, FileText, Download, Tag, AlertCircle, Package, Loader2, X } from 'lucide-react';
import { MasterProduct, NutritionData, PhysicalItem, MissingProduct, ProcessingStats } from '../../types';
import { processFlipkartPdfInvoices } from '../../services/flipkartPdfProcessor';
import { expandToPhysicalFlipkart } from '../../services/flipkartPackingPlanProcessor';
import { generateSummaryPdf } from '../../services/packingPlanPdfGenerator';
import { sortPdfBySkuFlipkart } from '../../services/flipkartSortedPdfGenerator';
import { generateLabelsByPacketUsed, generateMRPOnlyLabels } from '../../services/packingPlanLabelGenerator';
import { generateProductLabelsPdf } from '../../services/productLabelGenerator';
import { shouldIncludeProductLabel } from '../../services/utils';
import { downloadExcel } from '../../services/excelExporter';
import { validatePdfFile } from '../../services/pdfProcessor';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/DialogContext';
import ProgressBar from '../../components/ProgressBar';
import ProgressSteps from '../../components/ProgressSteps';
import EmptyState from '../../components/EmptyState';
import SkeletonTable from '../../components/SkeletonTable';
import FileUploadZone from '../../components/FileUploadZone';

/**
 * Generate hash from physical items data for caching
 */
const generateDataHash = (physicalItems: PhysicalItem[]): string => {
  if (physicalItems.length === 0) return '';
  
  const hashData = physicalItems.map(item => ({
    ASIN: item.ASIN, // SKU stored in ASIN field for compatibility
    Qty: item.Qty,
    FNSKU: item.FNSKU,
    'Packet used': item['Packet used']
  }));
  
  const hashString = JSON.stringify(hashData);
  let hash = 0;
  for (let i = 0; i < hashString.length; i++) {
    const char = hashString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
};

interface FlipkartPackingPlanViewProps {
  masterData: MasterProduct[];
  nutritionData: NutritionData[];
}

// File upload limits
const MAX_FILES = 50;
const MAX_TOTAL_SIZE_MB = 200;

interface FlipkartOrderItem {
  SKU: string;
  Qty: number;
  [key: string]: any;
}

const FlipkartPackingPlanView: React.FC<FlipkartPackingPlanViewProps> = ({ masterData, nutritionData }) => {
  const { showSuccess, showError, showInfo } = useToast();
  const confirm = useConfirm();
  
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingComplete, setProcessingComplete] = useState(false);
  
  const [orders, setOrders] = useState<FlipkartOrderItem[]>([]);
  const [physicalItems, setPhysicalItems] = useState<PhysicalItem[]>([]);
  const [missingProducts, setMissingProducts] = useState<MissingProduct[]>([]);
  const [stats, setStats] = useState<ProcessingStats>({
    total_invoices: 0,
    multi_qty_invoices: 0,
    single_item_invoices: 0,
    total_qty_ordered: 0,
    total_qty_physical: 0
  });

  const [activeTab, setActiveTab] = useState<'upload' | 'results' | 'downloads' | 'labels'>('upload');
  
  // Debug information state
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [processingDebugInfo, setProcessingDebugInfo] = useState<{
    uniqueSKUsExtracted: number;
    totalSKUsInMaster: number;
    matchedSKUs: number;
    unmatchedSKUs: number;
    filesProcessed: number;
    totalPages: number;
  } | null>(null);
  
  // Label generation state
  const [stickerPdfBytes, setStickerPdfBytes] = useState<Uint8Array | null>(null);
  const [housePdfBytes, setHousePdfBytes] = useState<Uint8Array | null>(null);
  const [stickerCount, setStickerCount] = useState(0);
  const [houseCount, setHouseCount] = useState(0);
  const [skippedProducts, setSkippedProducts] = useState<Array<{ Product: string; ASIN: string; 'Packet used': string; Reason: string }>>([]);
  const [isGeneratingLabels, setIsGeneratingLabels] = useState(false);
  
  // Product labels state
  const [productLabelPdfBytes, setProductLabelPdfBytes] = useState<Uint8Array | null>(null);
  const [productLabelPdfBytesWithDate, setProductLabelPdfBytesWithDate] = useState<Uint8Array | null>(null);
  const [productLabelCount, setProductLabelCount] = useState(0);
  const [isGeneratingProductLabels, setIsGeneratingProductLabels] = useState(false);
  
  // MRP-only labels state
  const [mrpPdfBytes, setMrpPdfBytes] = useState<Uint8Array | null>(null);
  const [mrpCount, setMrpCount] = useState(0);
  const [isGeneratingMrpLabels, setIsGeneratingMrpLabels] = useState(false);
  
  // Sorted PDF state
  const [sortedPdfBytes, setSortedPdfBytes] = useState<Uint8Array | null>(null);
  const [isGeneratingSortedPdf, setIsGeneratingSortedPdf] = useState(false);
  
  // Label caching state
  const [labelCacheHash, setLabelCacheHash] = useState<string | null>(null);
  const [cachedStickerPdfBytes, setCachedStickerPdfBytes] = useState<Uint8Array | null>(null);
  const [cachedHousePdfBytes, setCachedHousePdfBytes] = useState<Uint8Array | null>(null);
  const [cachedStickerCount, setCachedStickerCount] = useState(0);
  const [cachedHouseCount, setCachedHouseCount] = useState(0);
  const [cachedSkippedProducts, setCachedSkippedProducts] = useState<Array<{ Product: string; ASIN: string; 'Packet used': string; Reason: string }>>([]);
  const [cachedProductLabelPdfBytes, setCachedProductLabelPdfBytes] = useState<Uint8Array | null>(null);
  const [cachedProductLabelPdfBytesWithDate, setCachedProductLabelPdfBytesWithDate] = useState<Uint8Array | null>(null);
  const [cachedProductLabelCount, setCachedProductLabelCount] = useState(0);
  const [cachedMrpPdfBytes, setCachedMrpPdfBytes] = useState<Uint8Array | null>(null);
  const [cachedMrpCount, setCachedMrpCount] = useState(0);
  
  const currentDataHash = useMemo(() => generateDataHash(physicalItems), [physicalItems]);

  // Handle file selection
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    
    setProcessingComplete(false);
    
    if (files.length > MAX_FILES) {
      showError('Too many files', `Maximum ${MAX_FILES} files allowed. You uploaded ${files.length} files. Please split your files into batches of ${MAX_FILES} or fewer.`);
      event.target.value = '';
      return;
    }
    
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalSizeMB = totalSize / (1024 * 1024);
    
    if (totalSizeMB > MAX_TOTAL_SIZE_MB) {
      showError('Files too large', `Maximum total size is ${MAX_TOTAL_SIZE_MB} MB. Your files total ${totalSizeMB.toFixed(2)} MB. Please reduce the number of files or their sizes.`);
      event.target.value = '';
      return;
    }
    
    const validFiles: File[] = [];
    const invalidFiles: Array<{ name: string; reason: string }> = [];
    
    for (const file of files) {
      const validation = validatePdfFile(file, 50);
      if (validation.valid) {
        validFiles.push(file);
      } else {
        invalidFiles.push({ name: file.name, reason: validation.message });
      }
    }
    
    if (invalidFiles.length > 0) {
      const errorMsg = `Invalid Files Detected: ${invalidFiles.length} file(s) have issues:\n${invalidFiles.map(f => `• ${f.name}: ${f.reason}`).join('\n')}\n\nPlease upload only valid PDF files and try again.`;
      showError('Invalid files', errorMsg);
    }
    
    if (validFiles.length > 0) {
      setPdfFiles(validFiles);
      showSuccess('Files selected', `${validFiles.length} PDF file(s) ready to process`);
    }
  };

  const handleRemoveFile = (indexToRemove: number) => {
    setPdfFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
    setProcessingComplete(false);
    setSortedPdfBytes(null); // Reset sorted PDF when files change
  };

  // Process PDFs
  const handleProcessPdfs = useCallback(async () => {
    if (pdfFiles.length === 0) {
      showError('No files', 'Please upload at least one PDF file');
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessingStatus('Starting processing...');
    setProcessingDebugInfo(null);
    setShowDebugInfo(false);
    setProcessingComplete(false);

    try {
      const result = await processFlipkartPdfInvoices(pdfFiles, (progress, status) => {
        setProcessingProgress(progress);
        setProcessingStatus(status);
      });
      
      setProcessingProgress(0.85);
      setProcessingStatus('📋 Creating orders dataframe... (85%)');

      if (result.skuQtyData.size === 0) {
        const errorMessage = `No SKUs were extracted from the PDF files.\n\n` +
          `Possible reasons:\n` +
          `• The PDFs don't contain valid SKU IDs (format: "1 Product Name Weight")\n` +
          `• SKUs are not in the expected table format\n` +
          `• The PDF text extraction failed\n` +
          `• The invoice format doesn't match expected patterns\n\n` +
          `Processed ${pdfFiles.length} file(s), found ${result.totalInvoices} invoice page(s).\n\n` +
          `Please check the console for detailed extraction logs.`;
        
        showError('Processing failed', errorMessage);
        setProcessingStatus('Processing failed - no SKUs found');
        setIsProcessing(false);
        setProcessingProgress(0);
        return;
      }

      // Create orders from SKU data
      const orderItems: FlipkartOrderItem[] = Array.from(result.skuQtyData.entries()).map(([sku, qty]) => ({
        SKU: sku,
        Qty: qty
      }));

      console.log(`[FlipkartPackingPlanView] Extracted ${orderItems.length} unique SKU(s) from PDFs`);

      // Merge with master data (try to find matching products)
      const ordersWithMaster: FlipkartOrderItem[] = orderItems.map(order => {
        // Try to find matching product in master data
        // This is a simplified version - actual matching happens in expandToPhysicalFlipkart
        return {
          ...order
        };
      });

      setOrders(ordersWithMaster);

      // Expand to physical plan
      setProcessingProgress(0.90);
      setProcessingStatus('🔧 Expanding to physical plan... (90%)');
      
      const { physicalItems: physical, missingProducts: missing } = expandToPhysicalFlipkart(
        ordersWithMaster,
        masterData
      );
      
      setProcessingProgress(0.95);
      setProcessingStatus('📊 Calculating statistics... (95%)');

      setPhysicalItems(physical);
      setMissingProducts(missing);
      
      // Reset label cache
      setLabelCacheHash(null);
      setCachedStickerPdfBytes(null);
      setCachedHousePdfBytes(null);
      setCachedStickerCount(0);
      setCachedHouseCount(0);
      setCachedSkippedProducts([]);
      setCachedProductLabelPdfBytes(null);
      setCachedProductLabelPdfBytesWithDate(null);
      setCachedProductLabelCount(0);
      setCachedMrpPdfBytes(null);
      setCachedMrpCount(0);
      
      // Reset sorted PDF
      setSortedPdfBytes(null);

      // Calculate statistics
      const totalQtyOrdered = ordersWithMaster.reduce((sum, o) => sum + (o.Qty || 0), 0);
      const totalQtyPhysical = physical.reduce((sum, p) => sum + (p.Qty || 0), 0);

      setStats({
        total_invoices: result.totalInvoices,
        multi_qty_invoices: 0, // Flipkart doesn't track this the same way
        single_item_invoices: result.totalInvoices,
        total_qty_ordered: totalQtyOrdered,
        total_qty_physical: totalQtyPhysical
      });

      const matchedSKUs = ordersWithMaster.filter(o => {
        // Check if SKU was matched (not in missing products)
        return !missing.some(m => m.ASIN === o.SKU);
      }).length;
      const unmatchedSKUs = orderItems.length - matchedSKUs;
      
      const debugInfo = {
        uniqueSKUsExtracted: orderItems.length,
        totalSKUsInMaster: masterData.length, // Approximate
        matchedSKUs,
        unmatchedSKUs,
        filesProcessed: pdfFiles.length,
        totalPages: result.totalInvoices
      };
      
      setProcessingDebugInfo(debugInfo);
      
      console.log(`[FlipkartPackingPlanView] Processing complete:`, {
        uniqueSKUs: orderItems.length,
        totalQtyOrdered,
        totalQtyPhysical,
        physicalItems: physical.length,
        missingProducts: missing.length,
        totalInvoices: result.totalInvoices,
        debugInfo
      });

      setProcessingStatus('Processing complete!');
      setProcessingComplete(true);
      
      // Generate sorted PDF if we have PDF bytes (after processing completes)
      console.log('[FlipkartPackingPlanView] Checking for PDF bytes:', {
        hasAllPdfBytes: !!result.allPdfBytes,
        length: result.allPdfBytes?.length || 0,
        allPdfBytes: result.allPdfBytes
      });
      
      if (result.allPdfBytes && result.allPdfBytes.length > 0) {
        console.log(`[FlipkartPackingPlanView] PDF bytes available: ${result.allPdfBytes.length} files, sizes: ${result.allPdfBytes.map(b => b.length).join(', ')} bytes`);
        
        // Generate sorted PDF asynchronously (don't block UI)
        (async () => {
          try {
            setIsGeneratingSortedPdf(true);
            console.log(`[FlipkartPackingPlanView] Starting sorted PDF generation for ${result.allPdfBytes!.length} PDF files`);
            
            const sortedPdf = await sortPdfBySkuFlipkart(result.allPdfBytes!);
            
            if (sortedPdf && sortedPdf.length > 0) {
              setSortedPdfBytes(sortedPdf);
              console.log(`[FlipkartPackingPlanView] ✅ Successfully generated sorted PDF: ${sortedPdf.length} bytes`);
              showInfo('Sorted PDF ready', 'Sorted shipping labels PDF has been generated and is ready to download.');
            } else {
              console.error('[FlipkartPackingPlanView] ❌ Failed to generate sorted PDF - sortPdfBySkuFlipkart returned null or empty');
              setSortedPdfBytes(null);
              showError('Sorted PDF generation failed', 'Could not generate sorted PDF. Please check the console for details.');
            }
          } catch (error) {
            console.error('[FlipkartPackingPlanView] ❌ Error generating sorted PDF:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[FlipkartPackingPlanView] Error details:', {
              errorType: error instanceof Error ? error.constructor.name : typeof error,
              errorMessage,
              stack: error instanceof Error ? error.stack : undefined
            });
            setSortedPdfBytes(null);
            showError('Sorted PDF generation error', `Error generating sorted PDF: ${errorMessage}. Please check the console for details.`);
          } finally {
            setIsGeneratingSortedPdf(false);
          }
        })();
      } else {
        console.warn('[FlipkartPackingPlanView] No PDF bytes available for sorting', {
          hasAllPdfBytes: !!result.allPdfBytes,
          length: result.allPdfBytes?.length || 0,
          resultKeys: Object.keys(result)
        });
        setSortedPdfBytes(null);
      }
      
      if (physical.length > 0 || ordersWithMaster.length > 0) {
        setActiveTab('results');
        showSuccess('Processing complete', `Processed ${physical.length} physical items`);
      } else {
        showError('Processing failed', 'Processing completed but no valid data was generated. Please check the console for details.');
      }
    } catch (error) {
      console.error('[FlipkartPackingPlanView] Error processing PDFs:', error);
      
      let errorType = 'Unknown';
      let errorMessage = 'Unknown error occurred while processing PDFs';
      
      if (error instanceof Error) {
        errorType = error.constructor.name;
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      showError('Processing error', `Error (${errorType}): ${errorMessage}\n\nPlease check the console for more details.`);
      
      setProcessingStatus('Processing failed');
    } finally {
      setIsProcessing(false);
      setProcessingProgress(0);
    }
  }, [pdfFiles, masterData]);

  // Generate labels with caching
  const handleGenerateLabels = useCallback(async () => {
    if (physicalItems.length === 0) {
      showError('No data', 'No physical items to generate labels for');
      return;
    }

    if (labelCacheHash === currentDataHash && cachedStickerPdfBytes && cachedHousePdfBytes) {
      console.log('[Label Caching] Using cached labels. Hash:', currentDataHash.substring(0, 8));
      setStickerPdfBytes(cachedStickerPdfBytes);
      setHousePdfBytes(cachedHousePdfBytes);
      setStickerCount(cachedStickerCount);
      setHouseCount(cachedHouseCount);
      setSkippedProducts(cachedSkippedProducts);
      setActiveTab('labels');
      return;
    }

    setIsGeneratingLabels(true);

    try {
      const result = await generateLabelsByPacketUsed(physicalItems, masterData, nutritionData);
      
      setLabelCacheHash(currentDataHash);
      setCachedStickerPdfBytes(result.stickerPdfBytes);
      setCachedHousePdfBytes(result.housePdfBytes);
      setCachedStickerCount(result.stickerCount);
      setCachedHouseCount(result.houseCount);
      setCachedSkippedProducts(result.skippedProducts);
      
      setStickerPdfBytes(result.stickerPdfBytes);
      setHousePdfBytes(result.housePdfBytes);
      setStickerCount(result.stickerCount);
      setHouseCount(result.houseCount);
      setSkippedProducts(result.skippedProducts);
      
      console.log('[Label Caching] Labels generated and cached. Hash:', currentDataHash.substring(0, 8));
      setActiveTab('labels');
      showSuccess('Labels generated', `Generated ${result.stickerCount} sticker and ${result.houseCount} house labels`);
    } catch (error) {
      console.error('Error generating labels:', error);
      showError('Generation failed', `Error generating labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsGeneratingLabels(false);
    }
  }, [physicalItems, masterData, nutritionData, labelCacheHash, currentDataHash, cachedStickerPdfBytes, cachedHousePdfBytes, cachedStickerCount, cachedHouseCount, cachedSkippedProducts, showSuccess, showError]);

  const handleGenerateProductLabels = useCallback(async () => {
    if (physicalItems.length === 0) {
      showError('No data', 'No physical items to generate product labels for. Please process PDFs first.');
      return;
    }
    
    if (labelCacheHash === currentDataHash && cachedProductLabelPdfBytes) {
      console.log('[Label Caching] Using cached product labels. Hash:', currentDataHash.substring(0, 8));
      setProductLabelPdfBytes(cachedProductLabelPdfBytes);
      setProductLabelPdfBytesWithDate(cachedProductLabelPdfBytesWithDate);
      setProductLabelCount(cachedProductLabelCount);
      return;
    }
    
    setIsGeneratingProductLabels(true);
    try {
      const stickerHouseProducts = physicalItems.filter(
        item => ['sticker', 'house'].includes(String(item['Packet used'] || '').trim().toLowerCase())
      );
      
      const productList: string[] = [];
      for (const row of stickerHouseProducts) {
        const productName = row.item_name_for_labels || row.item || '';
        if (!productName || productName.toLowerCase() === 'nan') continue;
        
        if (shouldIncludeProductLabel(productName, masterData, row)) {
          const qty = row.Qty || 1;
          productList.push(...Array(qty).fill(productName));
        }
      }
      
      if (productList.length === 0) {
        showError('No products', 'No products found that match the Product Label criteria.');
        setIsGeneratingProductLabels(false);
        return;
      }
      
      const productPdfWithoutDate = await generateProductLabelsPdf(productList, false);
      const productPdfWithDate = await generateProductLabelsPdf(productList, true);
      
      setCachedProductLabelPdfBytes(productPdfWithoutDate);
      setCachedProductLabelPdfBytesWithDate(productPdfWithDate);
      setCachedProductLabelCount(productList.length);
      
      setProductLabelPdfBytes(productPdfWithoutDate);
      setProductLabelPdfBytesWithDate(productPdfWithDate);
      setProductLabelCount(productList.length);
      
      console.log('[Label Caching] Product labels generated and cached. Hash:', currentDataHash.substring(0, 8));
      showSuccess('Product labels generated', `Generated ${productList.length} product labels`);
    } catch (error: any) {
      console.error('Error generating product labels:', error);
      showError('Generation failed', `Error generating product labels: ${error.message || error}`);
    } finally {
      setIsGeneratingProductLabels(false);
    }
  }, [physicalItems, masterData, labelCacheHash, currentDataHash, cachedProductLabelPdfBytes, cachedProductLabelPdfBytesWithDate, cachedProductLabelCount, showSuccess, showError]);

  const handleGenerateMrpLabels = useCallback(async () => {
    if (physicalItems.length === 0) {
      showError('No data', 'No physical items to generate MRP labels for. Please process PDFs first.');
      return;
    }
    
    if (labelCacheHash === currentDataHash && cachedMrpPdfBytes) {
      console.log('[Label Caching] Using cached MRP labels. Hash:', currentDataHash.substring(0, 8));
      setMrpPdfBytes(cachedMrpPdfBytes);
      setMrpCount(cachedMrpCount);
      return;
    }
    
    setIsGeneratingMrpLabels(true);
    try {
      const { mrpPdfBytes, mrpCount } = await generateMRPOnlyLabels(physicalItems, masterData);
      
      setCachedMrpPdfBytes(mrpPdfBytes);
      setCachedMrpCount(mrpCount);
      
      setMrpPdfBytes(mrpPdfBytes);
      setMrpCount(mrpCount);
      
      console.log('[Label Caching] MRP labels generated and cached. Hash:', currentDataHash.substring(0, 8));
      showSuccess('MRP labels generated', `Generated ${mrpCount} MRP labels`);
    } catch (error: any) {
      console.error('Error generating MRP labels:', error);
      showError('Generation failed', `Error generating MRP labels: ${error.message || error}`);
    } finally {
      setIsGeneratingMrpLabels(false);
    }
  }, [physicalItems, masterData, labelCacheHash, currentDataHash, cachedMrpPdfBytes, cachedMrpCount, showSuccess, showError]);

  const downloadPdf = (pdfBytes: Uint8Array, filename: string) => {
    const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSummaryPdf = () => {
    if (physicalItems.length === 0) return;
    
    // Convert Flipkart orders to format expected by generateSummaryPdf
    const ordersForPdf = orders.map(o => ({ ASIN: o.SKU, Qty: o.Qty }));
    const pdf = generateSummaryPdf(ordersForPdf, physicalItems, stats, missingProducts, 'Flipkart Packing Plan');
    const pdfBytes = pdf.output('arraybuffer');
    downloadPdf(new Uint8Array(pdfBytes), `Flipkart_Packing_Plan_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleDownloadExcel = () => {
    // Convert Flipkart orders to format expected by downloadExcel
    const ordersForExcel = orders.map(o => ({ ASIN: o.SKU, Qty: o.Qty }));
    downloadExcel(physicalItems, ordersForExcel, missingProducts, `Flipkart_Packing_Plan_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (masterData.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-gray-600">Loading master data...</p>
          <SkeletonTable rows={3} columns={4} className="mt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {(['upload', 'results', 'downloads', 'labels'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  px-6 py-3 text-sm font-medium border-b-2 transition-colors
                  ${activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab === 'upload' && '📤 Upload'}
                {tab === 'results' && '📊 Results'}
                {tab === 'downloads' && '💾 Downloads'}
                {tab === 'labels' && '🏷️ Labels'}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Upload Tab */}
          {activeTab === 'upload' && (
            <div className="animate-fadeIn">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Flipkart Invoice PDFs</h3>
              
              {pdfFiles.length === 0 ? (
                <FileUploadZone
                  onFilesSelected={(files) => {
                    if (files.length > MAX_FILES) {
                      showError('Too many files', `Maximum ${MAX_FILES} files allowed`);
                      return;
                    }
                    const totalSizeMB = files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
                    if (totalSizeMB > MAX_TOTAL_SIZE_MB) {
                      showError('Files too large', `Maximum total size is ${MAX_TOTAL_SIZE_MB} MB`);
                      return;
                    }
                    const validFiles: File[] = [];
                    for (const file of files) {
                      const validation = validatePdfFile(file, 50);
                      if (validation.valid) {
                        validFiles.push(file);
                      } else {
                        showError('Invalid file', `${file.name}: ${validation.message}`);
                      }
                    }
                    if (validFiles.length > 0) {
                      setPdfFiles(validFiles);
                      showSuccess('Files selected', `${validFiles.length} PDF file(s) ready to process`);
                    }
                  }}
                  accept=".pdf"
                  multiple={true}
                  maxFiles={MAX_FILES}
                  maxSizeMB={50}
                  disabled={isProcessing}
                  label="Upload PDF Files"
                  description={`Up to ${MAX_FILES} PDF files, ${MAX_TOTAL_SIZE_MB}MB total`}
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {pdfFiles.length} file(s) selected • {(pdfFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(2)} MB total
                    </p>
                    <button
                      onClick={() => {
                        confirm({
                          title: 'Clear Files',
                          message: 'Are you sure you want to remove all selected files?',
                          variant: 'default',
                          onConfirm: () => {
                            setPdfFiles([]);
                            setProcessingComplete(false);
                          }
                        });
                      }}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="space-y-2">
                    {pdfFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{file.name}</p>
                            <p className="text-xs text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setPdfFiles(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pdfFiles.length > 0 && (
                <div className="mt-4">
                  {(() => {
                    const totalSizeMB = pdfFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
                    return (
                      <>
                        <p className="text-sm text-gray-600 mb-2">
                          {pdfFiles.length} file(s) selected • {totalSizeMB.toFixed(2)} MB total
                        </p>
                        {totalSizeMB > 100 && (
                          <p className="text-sm text-yellow-600 mb-2">
                            ⚠️ Large batch - processing may take longer
                          </p>
                        )}
                      </>
                    );
                  })()}
                  <div className="space-y-2 mb-4">
                    {pdfFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-gray-50 p-2 rounded-md border border-gray-200">
                        <span className="text-sm text-gray-700 flex items-center">
                          <FileText className="w-4 h-4 mr-2 text-gray-500" />
                          {file.name}
                        </span>
                        <button
                          onClick={() => handleRemoveFile(idx)}
                          className="ml-2 p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Remove file"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleProcessPdfs}
                    disabled={isProcessing}
                    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4 mr-2" />
                        Process PDFs
                      </>
                    )}
                  </button>
                  
                  {isProcessing && (
                    <div className="mt-4">
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div
                          className="bg-blue-600 h-2.5 rounded-full transition-all"
                          style={{ width: `${processingProgress * 100}%` }}
                        />
                      </div>
                      <p className="mt-2 text-sm text-gray-600">{processingStatus}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Results Tab */}
          {activeTab === 'results' && (
            <div>
              {orders.length > 0 ? (
                <>
                  {showDebugInfo && processingDebugInfo && (
                    <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-blue-900 mb-3">Processing Debug Information</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-blue-700 font-medium">Unique SKUs Extracted</p>
                          <p className="text-blue-900 text-lg font-bold">{processingDebugInfo.uniqueSKUsExtracted}</p>
                        </div>
                        <div>
                          <p className="text-blue-700 font-medium">SKUs in Master Data</p>
                          <p className="text-blue-900 text-lg font-bold">{processingDebugInfo.totalSKUsInMaster}</p>
                        </div>
                        <div>
                          <p className="text-blue-700 font-medium">Matched SKUs</p>
                          <p className="text-green-600 text-lg font-bold">{processingDebugInfo.matchedSKUs}</p>
                        </div>
                        <div>
                          <p className="text-blue-700 font-medium">Unmatched SKUs</p>
                          <p className="text-red-600 text-lg font-bold">{processingDebugInfo.unmatchedSKUs}</p>
                        </div>
                        <div>
                          <p className="text-blue-700 font-medium">Files Processed</p>
                          <p className="text-blue-900 text-lg font-bold">{processingDebugInfo.filesProcessed}</p>
                        </div>
                        <div>
                          <p className="text-blue-700 font-medium">Invoice Pages Found</p>
                          <p className="text-blue-900 text-lg font-bold">{processingDebugInfo.totalPages}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mb-4 flex items-center justify-between">
                    <button
                      onClick={() => setShowDebugInfo(!showDebugInfo)}
                      className="text-sm text-gray-600 hover:text-gray-800 underline"
                    >
                      {showDebugInfo ? '▼ Hide' : '▶ Show'} Debug Information
                    </button>
                  </div>

                  {/* Statistics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600">Orders</p>
                      <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600">Items</p>
                      <p className="text-2xl font-bold text-gray-900">{physicalItems.length}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600">Qty Ordered</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.total_qty_ordered}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600">Qty Physical</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.total_qty_physical}</p>
                    </div>
                  </div>

                  {missingProducts.length > 0 && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                      <div className="flex">
                        <AlertCircle className="h-5 w-5 text-yellow-400 mr-3" />
                        <div>
                          <p className="text-sm font-medium text-yellow-800">
                            {missingProducts.length} product(s) have issues
                          </p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm text-yellow-700">View details</summary>
                            <div className="mt-2 overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-yellow-100">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium">SKU</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium">Issue</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium">Product</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {missingProducts.map((item, idx) => (
                                    <tr key={idx}>
                                      <td className="px-3 py-2">{item.ASIN}</td>
                                      <td className="px-3 py-2">{item.Issue}</td>
                                      <td className="px-3 py-2">{item.Product || 'N/A'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Ordered Items Table */}
                  <div className="mb-6">
                    <h4 className="text-md font-semibold text-gray-900 mb-3">Ordered Items</h4>
                    <div className="overflow-x-auto" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">SKU</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Qty</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {orders.map((order, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-2 whitespace-nowrap">{order.SKU}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{order.Qty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mb-6 border-t border-gray-200 pt-6">
                    <h4 className="text-md font-semibold text-gray-900 mb-3">Physical Packing Plan</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Item</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Weight</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Qty</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Packet Size</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">FNSKU</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {physicalItems.map((item, idx) => (
                            <tr key={idx} className={item.Status.includes('MISSING') ? 'bg-red-50' : 'bg-green-50'}>
                              <td className="px-3 py-2 whitespace-nowrap font-medium">
                                {item.is_split ? (
                                  <span className="font-bold text-blue-700">{item.item} ⭐</span>
                                ) : (
                                  item.item
                                )}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">{item.weight}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{item.Qty}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{item['Packet Size']}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{item.FNSKU}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{item.Status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <Package className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No data available</h3>
                  <p className="mt-1 text-sm text-gray-500">Upload and process PDF files to see results.</p>
                </div>
              )}
            </div>
          )}

          {/* Downloads Tab */}
          {activeTab === 'downloads' && (
            <div>
              {!processingComplete && pdfFiles.length > 0 ? (
                <div className="text-center py-12">
                  <Loader2 className="mx-auto h-12 w-12 text-gray-400 animate-spin" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Processing files...</h3>
                  <p className="mt-1 text-sm text-gray-500">Please wait for processing to complete.</p>
                </div>
              ) : physicalItems.length > 0 && processingComplete ? (
                <div className="space-y-4">
                  <button
                    onClick={handleDownloadSummaryPdf}
                    className="w-full px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download Packing Plan PDF
                  </button>

                  <button
                    onClick={handleDownloadExcel}
                    className="w-full px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center justify-center"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download Excel Workbook
                  </button>

                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Sorted Shipping Labels</h3>
                    {isGeneratingSortedPdf ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-600 mr-2" />
                        <span className="text-sm text-gray-600">Generating sorted PDF...</span>
                      </div>
                    ) : sortedPdfBytes ? (
                      <button
                        onClick={() => downloadPdf(sortedPdfBytes, `Flipkart_Sorted_Shipping_Labels_${new Date().toISOString().split('T')[0]}.pdf`)}
                        className="w-full px-4 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 flex items-center justify-center"
                      >
                        <Download className="w-5 h-5 mr-2" />
                        Download Sorted Shipping Labels PDF
                      </button>
                    ) : (
                      <div className="text-sm text-gray-500 text-center py-2">
                        Sorted PDF not available. Please process PDFs again.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <FileText className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No downloads available</h3>
                  <p className="mt-1 text-sm text-gray-500">Process PDF files first to generate downloads.</p>
                </div>
              )}
            </div>
          )}

          {/* Labels Tab */}
          {activeTab === 'labels' && (
            <div>
              {!processingComplete && pdfFiles.length > 0 ? (
                <div className="text-center py-12">
                  <Loader2 className="mx-auto h-12 w-12 text-gray-400 animate-spin" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Processing files...</h3>
                  <p className="mt-1 text-sm text-gray-500">Please wait for processing to complete.</p>
                </div>
              ) : physicalItems.length > 0 && processingComplete ? (
                <>
                  {stickerCount === 0 && houseCount === 0 && !isGeneratingLabels && (
                    <div className="mb-6">
                      <button
                        onClick={handleGenerateLabels}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center"
                      >
                        <Tag className="w-4 h-4 mr-2" />
                        Generate Labels
                      </button>
                    </div>
                  )}

                  {isGeneratingLabels && (
                    <div className="text-center py-8">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
                      <p className="mt-2 text-sm text-gray-600">Generating labels...</p>
                    </div>
                  )}

                  {(stickerCount > 0 || houseCount > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {stickerCount > 0 && stickerPdfBytes && (
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-700 mb-2">Sticker Labels</p>
                          <p className="text-2xl font-bold text-gray-900 mb-4">{stickerCount}</p>
                          <button
                            onClick={() => downloadPdf(stickerPdfBytes, `Sticker_Labels_${new Date().toISOString().split('T')[0]}.pdf`)}
                            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download ({stickerCount})
                          </button>
                        </div>
                      )}

                      {houseCount > 0 && housePdfBytes && (
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-700 mb-2">House Labels</p>
                          <p className="text-2xl font-bold text-gray-900 mb-4">{houseCount}</p>
                          <button
                            onClick={() => downloadPdf(housePdfBytes, `House_Labels_${new Date().toISOString().split('T')[0]}.pdf`)}
                            className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center justify-center"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download ({houseCount})
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {skippedProducts.length > 0 && (
                    <div className="mt-6">
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-yellow-800">
                          ⚠️ Products Skipped from Label Generation ({skippedProducts.length})
                        </summary>
                        <div className="mt-2 overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-yellow-100">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium">Product</th>
                                <th className="px-3 py-2 text-left text-xs font-medium">SKU</th>
                                <th className="px-3 py-2 text-left text-xs font-medium">Packet used</th>
                                <th className="px-3 py-2 text-left text-xs font-medium">Reason</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {skippedProducts.map((item, idx) => (
                                <tr key={idx}>
                                  <td className="px-3 py-2">{item.Product}</td>
                                  <td className="px-3 py-2">{item.ASIN}</td>
                                  <td className="px-3 py-2">{item['Packet used']}</td>
                                  <td className="px-3 py-2">{item.Reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </div>
                  )}

                  {/* Product Labels Section */}
                  <div className="mt-8 border-t border-gray-200 pt-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Product Labels (96x25mm)</h3>
                    {!productLabelPdfBytes && !isGeneratingProductLabels && (
                      <button
                        onClick={handleGenerateProductLabels}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center"
                      >
                        <Tag className="w-4 h-4 mr-2" />
                        Generate Product Labels
                      </button>
                    )}
                    {isGeneratingProductLabels && (
                      <div className="text-center py-4">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-600" />
                        <p className="mt-2 text-sm text-gray-600">Generating product labels...</p>
                      </div>
                    )}
                    {productLabelPdfBytes && productLabelCount > 0 && (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm font-medium text-gray-700 mb-2">Product Labels</p>
                        <p className="text-2xl font-bold text-gray-900 mb-4">{productLabelCount}</p>
                        <button
                          onClick={() => downloadPdf(productLabelPdfBytes, `Product_Labels_No_Date_${new Date().toISOString().split('T')[0]}.pdf`)}
                          className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center justify-center"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download without Date ({productLabelCount})
                        </button>
                      </div>
                    )}
                  </div>

                  {/* MRP-Only Labels Section */}
                  <div className="mt-8 border-t border-gray-200 pt-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">MRP-Only Labels</h3>
                    {!mrpPdfBytes && !isGeneratingMrpLabels && (
                      <button
                        onClick={handleGenerateMrpLabels}
                        className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 flex items-center"
                      >
                        <Tag className="w-4 h-4 mr-2" />
                        Generate MRP-Only Labels
                      </button>
                    )}
                    {isGeneratingMrpLabels && (
                      <div className="text-center py-4">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-purple-600" />
                        <p className="mt-2 text-sm text-gray-600">Generating MRP labels...</p>
                      </div>
                    )}
                    {mrpPdfBytes && mrpCount > 0 && (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm font-medium text-gray-700 mb-2">MRP-Only Labels</p>
                        <p className="text-2xl font-bold text-gray-900 mb-4">{mrpCount}</p>
                        <button
                          onClick={() => downloadPdf(mrpPdfBytes, `MRP_Only_Labels_${new Date().toISOString().split('T')[0]}.pdf`)}
                          className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 flex items-center justify-center"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download ({mrpCount})
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <Tag className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No labels available</h3>
                  <p className="mt-1 text-sm text-gray-500">Please upload invoice PDFs to generate labels.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FlipkartPackingPlanView;
