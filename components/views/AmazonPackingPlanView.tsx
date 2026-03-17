import React, { useState, useCallback, useMemo } from 'react';
import { Upload, FileText, Download, Tag, AlertCircle, Package, Loader2, X, ShoppingCart, Box, CheckCircle, FileSpreadsheet, Sparkles, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { MasterProduct, NutritionData, OrderItem, PhysicalItem, MissingProduct, ProcessingStats, PDFDiagnostics } from '../../types';
import { processPdfInvoices, validatePdfFile } from '../../services/pdfProcessor';
import { expandToPhysical, createASINLookupDict } from '../../services/packingPlanProcessor';
import { generateSummaryPdf } from '../../services/packingPlanPdfGenerator';
import { generateLabelsByPacketUsed, generateMRPOnlyLabels } from '../../services/packingPlanLabelGenerator';
import { generateProductLabelsPdf } from '../../services/productLabelGenerator';
import { shouldIncludeProductLabel } from '../../services/utils';
import { reformatLabelsTo4x6Vertical } from '../../services/labelFormatter';
import { PDFDocument } from 'pdf-lib';
import { downloadExcel } from '../../services/excelExporter';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/DialogContext';
import ProgressBar from '../../components/ProgressBar';
import ProgressSteps from '../../components/ProgressSteps';
import EmptyState from '../../components/EmptyState';
import SkeletonTable from '../../components/SkeletonTable';
import FileUploadZone from '../../components/FileUploadZone';
import SearchableTable from '../../components/SearchableTable';
import StatCard from '../../components/StatCard';
import ExtractionDiagnostics from '../../components/ExtractionDiagnostics';

/**
 * Generate hash from physical items data for caching
 */
const generateDataHash = (physicalItems: PhysicalItem[]): string => {
  if (physicalItems.length === 0) return '';
  
  // Create hash from relevant columns (matching Python implementation)
  const hashData = physicalItems.map(item => ({
    ASIN: item.ASIN,
    Qty: item.Qty,
    FNSKU: item.FNSKU,
    'Packet used': item['Packet used']
  }));
  
  const hashString = JSON.stringify(hashData);
  // Simple hash function (similar to MD5 but simpler for browser)
  let hash = 0;
  for (let i = 0; i < hashString.length; i++) {
    const char = hashString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
};

interface AmazonPackingPlanViewProps {
  masterData: MasterProduct[];
  nutritionData: NutritionData[];
}

// File upload limits (matching Python implementation)
const MAX_FILES = 50;
const MAX_TOTAL_SIZE_MB = 200;

const AmazonPackingPlanView: React.FC<AmazonPackingPlanViewProps> = ({ masterData, nutritionData }) => {
  const [isLoadingData] = useState(false);
  const { showSuccess, showError, showInfo } = useToast();
  const confirm = useConfirm();
  
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingComplete, setProcessingComplete] = useState(false);
  
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [physicalItems, setPhysicalItems] = useState<PhysicalItem[]>([]);
  const [missingProducts, setMissingProducts] = useState<MissingProduct[]>([]);
  const [stats, setStats] = useState<ProcessingStats>({
    total_invoices: 0,
    multi_qty_invoices: 0,
    single_item_invoices: 0,
    total_qty_ordered: 0,
    total_qty_physical: 0
  });
      const [highlightedPdfBytes, setHighlightedPdfBytes] = useState<Uint8Array | null>(null);
      const [highlightingFailed, setHighlightingFailed] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'upload' | 'results' | 'downloads' | 'labels'>('upload');
  
  // Debug information state
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [processingDebugInfo, setProcessingDebugInfo] = useState<{
    uniqueASINsExtracted: number;
    totalASINsInMaster: number;
    matchedASINs: number;
    unmatchedASINs: number;
    filesProcessed: number;
    totalPages: number;
  } | null>(null);
  
  // Extraction diagnostics state
  const [diagnostics, setDiagnostics] = useState<PDFDiagnostics | null>(null);
  
      // Label generation state
      const [stickerPdfBytes, setStickerPdfBytes] = useState<Uint8Array | null>(null);
      const [housePdfBytes, setHousePdfBytes] = useState<Uint8Array | null>(null);
      const [house4x6VerticalPdfBytes, setHouse4x6VerticalPdfBytes] = useState<Uint8Array | null>(null);
      const [stickerCount, setStickerCount] = useState(0);
      const [houseCount, setHouseCount] = useState(0);
      const [house4x6VerticalCount, setHouse4x6VerticalCount] = useState(0);
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
      
      // Label caching state
      const [labelCacheHash, setLabelCacheHash] = useState<string | null>(null);
      const [cachedStickerPdfBytes, setCachedStickerPdfBytes] = useState<Uint8Array | null>(null);
      const [cachedHousePdfBytes, setCachedHousePdfBytes] = useState<Uint8Array | null>(null);
      const [cachedHouse4x6VerticalPdfBytes, setCachedHouse4x6VerticalPdfBytes] = useState<Uint8Array | null>(null);
      const [cachedStickerCount, setCachedStickerCount] = useState(0);
      const [cachedHouseCount, setCachedHouseCount] = useState(0);
      const [cachedHouse4x6VerticalCount, setCachedHouse4x6VerticalCount] = useState(0);
      const [cachedSkippedProducts, setCachedSkippedProducts] = useState<Array<{ Product: string; ASIN: string; 'Packet used': string; Reason: string }>>([]);
      const [cachedProductLabelPdfBytes, setCachedProductLabelPdfBytes] = useState<Uint8Array | null>(null);
      const [cachedProductLabelPdfBytesWithDate, setCachedProductLabelPdfBytesWithDate] = useState<Uint8Array | null>(null);
      const [cachedProductLabelCount, setCachedProductLabelCount] = useState(0);
      const [cachedMrpPdfBytes, setCachedMrpPdfBytes] = useState<Uint8Array | null>(null);
      const [cachedMrpCount, setCachedMrpCount] = useState(0);
      
      // Calculate current data hash
      const currentDataHash = useMemo(() => generateDataHash(physicalItems), [physicalItems]);

  // Data is now passed as props, no need to load separately

  // Handle file selection
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    
    // Reset processing complete when new files are uploaded
    setProcessingComplete(false);
    
    // Check file count limit
    if (files.length > MAX_FILES) {
      showError('Too many files', `Maximum ${MAX_FILES} files allowed. You uploaded ${files.length} files. Please split your files into batches of ${MAX_FILES} or fewer.`);
      event.target.value = ''; // Clear the input
      return;
    }
    
    // Check total size limit
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalSizeMB = totalSize / (1024 * 1024);
    
    if (totalSizeMB > MAX_TOTAL_SIZE_MB) {
      showError('Files too large', `Maximum total size is ${MAX_TOTAL_SIZE_MB} MB. Your files total ${totalSizeMB.toFixed(2)} MB. Please reduce the number of files or their sizes.`);
      event.target.value = ''; // Clear the input
      return;
    }
    
    // Validate individual files
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

  // Handle file removal
  const handleRemoveFile = (indexToRemove: number) => {
    setPdfFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
    setProcessingComplete(false); // Reset when files are removed
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
      setProcessingDebugInfo(null); // Reset debug info
      setShowDebugInfo(false); // Hide debug panel
      setProcessingComplete(false); // Reset processing complete flag
      setHighlightingFailed(false); // Reset highlighting failed flag

    try {
      // Process PDFs with detailed progress tracking
      const result = await processPdfInvoices(pdfFiles, (progress, status) => {
        setProcessingProgress(progress);
        setProcessingStatus(status);
      });
      
      // Log after PDF processing
      console.log(`[AmazonPackingPlanView] Extracted ${result.asinQtyData.size} unique ASIN(s)`);
      console.log(`[AmazonPackingPlanView] Total Qty from PDFs:`, 
        Array.from(result.asinQtyData.values()).reduce((a, b) => a + b, 0));
      
      // Update progress for data processing stages (80-100%)
      setProcessingProgress(0.85);
      setProcessingStatus('📋 Creating orders dataframe... (85%)');

      // Validation: Check if any ASINs were extracted
      if (result.asinQtyData.size === 0) {
        const errorMessage = `No ASINs were extracted from the PDF files.\n\n` +
          `Possible reasons:\n` +
          `• The PDFs don't contain valid ASINs (format: B followed by 9 alphanumeric characters)\n` +
          `• ASINs are in address sections (which are filtered out)\n` +
          `• The PDF text extraction failed\n` +
          `• The invoice format doesn't match expected patterns\n\n` +
          `Processed ${pdfFiles.length} file(s), found ${result.totalInvoices} invoice page(s).\n\n` +
          `Please check the console for detailed extraction logs.`;
        
        showError('Processing failed', errorMessage);
        setProcessingStatus('Processing failed - no ASINs found');
        setIsProcessing(false);
        setProcessingProgress(0);
        // Don't switch to results tab - stay on upload tab
        return;
      }

      // Create orders from ASIN data
      const orderItems: OrderItem[] = Array.from(result.asinQtyData.entries()).map(([asin, qty]) => ({
        ASIN: asin,
        Qty: qty
      }));

      console.log(`[AmazonPackingPlanView] Extracted ${orderItems.length} unique ASIN(s) from PDFs`);

      // Diagnostic: Log master data columns for first product (to help identify split column)
      if (masterData.length > 0) {
        const firstProduct = masterData[0];
        console.log(`[AmazonPackingPlanView] 🔍 Master Data Column Names (first product):`, {
          allColumns: Object.keys(firstProduct),
          columnCount: Object.keys(firstProduct).length,
          columnsWithValues: Object.keys(firstProduct)
            .filter(key => firstProduct[key] && String(firstProduct[key]).trim() !== '')
            .map(key => ({
              column: key,
              value: String(firstProduct[key]).substring(0, 100),
              hasComma: String(firstProduct[key]).includes(',')
            }))
            .filter(col => col.hasComma || col.column.toLowerCase().includes('split') || col.column === 'K')
        });
      }

      // Merge with master data
      const ordersWithMaster: OrderItem[] = orderItems.map(order => {
        const masterProduct = masterData.find(p => p.ASIN === order.ASIN);
        return {
          ...order,
          ...masterProduct
        } as OrderItem;
      });

      // Log after creating orders
      console.log(`[AmazonPackingPlanView] Orders created: ${ordersWithMaster.length}`);
      const totalQtyOrdered = ordersWithMaster.reduce((sum, o) => sum + (o.Qty || 0), 0);
      console.log(`[AmazonPackingPlanView] Total Qty Ordered:`, totalQtyOrdered);
      
      // Comparison logging (matches Python format)
      console.log(`[Order Filtering] Total orders before filter: ${orderItems.length}, after: ${ordersWithMaster.length}`);
      const totalQtyBeforeFilter = orderItems.reduce((sum, o) => sum + (o.Qty || 0), 0);
      console.log(`[Order Filtering] Qty before: ${totalQtyBeforeFilter}, after: ${totalQtyOrdered}`);

      // Check if extracted ASINs match master data
      const unmatchedAsins = orderItems.filter(order => {
        const masterProduct = masterData.find(p => p.ASIN === order.ASIN);
        return !masterProduct;
      });

      if (unmatchedAsins.length > 0) {
        const unmatchedList = unmatchedAsins.map(o => `${o.ASIN} (Qty: ${o.Qty})`).join(', ');
        console.warn(`[AmazonPackingPlanView] ${unmatchedAsins.length} ASIN(s) not found in master data:`, unmatchedList);
        // Show warning but continue processing
      }

      setOrders(ordersWithMaster);
      setHighlightedPdfBytes(result.highlightedPdfBytes);
      // Mark as failed if no highlighted PDF and we processed files, or if some PDFs failed
      const hasFailed = (!result.highlightedPdfBytes && pdfFiles.length > 0) || (result.failedPdfCount && result.failedPdfCount > 0);
      setHighlightingFailed(hasFailed);
      
      // Log detailed error information if available
      if (hasFailed && result.highlightingError) {
        console.error('[AmazonPackingPlanView] PDF highlighting failed:', result.highlightingError);
      }
      if (result.failedPdfNames && result.failedPdfNames.length > 0) {
        console.warn('[AmazonPackingPlanView] Failed PDF files:', result.failedPdfNames);
      }

      // Expand to physical plan (85-90%)
      setProcessingProgress(0.90);
      setProcessingStatus('🔧 Expanding to physical plan... (90%)');
      const asinLookupDict = createASINLookupDict(masterData);
      const { physicalItems: physical, missingProducts: missing } = expandToPhysical(
        ordersWithMaster,
        masterData,
        asinLookupDict
      );
      
      // Log after expanding to physical
      console.log(`[AmazonPackingPlanView] Physical items created: ${physical.length}`);
      const totalQtyPhysical = physical.reduce((sum, p) => sum + (p.Qty || 0), 0);
      console.log(`[AmazonPackingPlanView] Total Qty Physical:`, totalQtyPhysical);
      
      // Final summary logging (matches Python format)
      console.log(`[Final Summary]`);
      console.log(`  - Unique ASINs extracted: ${result.asinQtyData.size}`);
      const totalFromExtraction = Array.from(result.asinQtyData.values()).reduce((a, b) => a + b, 0);
      console.log(`  - Total Qty from extraction: ${totalFromExtraction}`);
      console.log(`  - Orders after master merge: ${ordersWithMaster.length}`);
      console.log(`  - Total Qty Ordered: ${totalQtyOrdered}`);
      console.log(`  - Physical items: ${physical.length}`);
      console.log(`  - Total Qty Physical: ${totalQtyPhysical}`);
      
      // Calculate statistics (90-95%)
      setProcessingProgress(0.95);
      setProcessingStatus('📊 Calculating statistics... (95%)');

      // Debug: Log split items count
      const splitItemsCount = physical.filter(item => item.is_split).length;
      console.log(`[AmazonPackingPlanView] Physical items created:`, {
        total: physical.length,
        splitItems: splitItemsCount,
        regularItems: physical.length - splitItemsCount,
        splitItemsList: physical.filter(item => item.is_split).map(item => ({
          item: item.item,
          weight: item.weight,
          qty: item.Qty,
          asin: item.ASIN
        }))
      });

      setPhysicalItems(physical);
      setMissingProducts(missing);
      
      // Reset label cache when new data is processed
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

      // Calculate statistics
      // Note: totalQtyOrdered and totalQtyPhysical are already calculated above
      const multiQtyInvoices = result.invoiceHasMultiQty.filter(has => has).length;
      const singleItemInvoices = result.invoiceHasMultiQty.filter(has => !has).length;

      setStats({
        total_invoices: result.totalInvoices,
        multi_qty_invoices: multiQtyInvoices,
        single_item_invoices: singleItemInvoices,
        total_qty_ordered: totalQtyOrdered,
        total_qty_physical: totalQtyPhysical
      });

      // Log processing summary
      const matchedASINs = ordersWithMaster.filter(o => masterData.some(m => m.ASIN === o.ASIN)).length;
      const unmatchedASINs = orderItems.length - matchedASINs;
      
      const debugInfo = {
        uniqueASINsExtracted: orderItems.length,
        totalASINsInMaster: masterData.filter(m => m.ASIN).length,
        matchedASINs,
        unmatchedASINs,
        filesProcessed: pdfFiles.length,
        totalPages: result.invoicePageCount ?? result.totalInvoices
      };
      
      setProcessingDebugInfo(debugInfo);
      
      console.log(`[AmazonPackingPlanView] Processing complete:`, {
        uniqueASINs: orderItems.length,
        totalQtyOrdered,
        totalQtyPhysical,
        physicalItems: physical.length,
        missingProducts: missing.length,
        totalInvoices: result.totalInvoices,
        debugInfo
      });

      // Store diagnostics and check for discrepancies
      if (result.diagnostics) {
        // Update discrepancy in diagnostics (compare extracted vs expected if known)
        const updatedDiagnostics = {
          ...result.diagnostics,
          summary: {
            ...result.diagnostics.summary,
            expectedQty: totalQtyOrdered, // Use totalQtyOrdered as reference
            discrepancy: 0 // No discrepancy at this level (extraction matches what we got)
          }
        };
        setDiagnostics(updatedDiagnostics);
        
        // Show warning if there are issues
        const hasRejections = result.diagnostics.rejectedAsins.length > 0;
        const hasQtyDefaults = result.diagnostics.quantityDefaults.length > 0;
        
        if (hasRejections || hasQtyDefaults) {
          const issueCount = result.diagnostics.rejectedAsins.length + result.diagnostics.quantityDefaults.length;
          showInfo(
            'Extraction Issues Detected',
            `Found ${issueCount} potential issue(s) during PDF extraction. ` +
            `${hasRejections ? `${result.diagnostics.rejectedAsins.length} ASIN(s) rejected. ` : ''}` +
            `${hasQtyDefaults ? `${result.diagnostics.quantityDefaults.length} quantity default(s) to 1. ` : ''}` +
            `Check the Extraction Diagnostics panel in Results tab for details.`
          );
        }
      }

      setProcessingStatus('Processing complete!');
      setProcessingComplete(true);
      
      // Only switch to results tab if we have data
      if (physical.length > 0 || ordersWithMaster.length > 0) {
        setActiveTab('results');
        showSuccess('Processing complete', `Processed ${physical.length} physical items`);
      } else {
        showError('Processing failed', 'Processing completed but no valid data was generated. Please check the console for details.');
      }
    } catch (error) {
      console.error('[AmazonPackingPlanView] Error processing PDFs:', error);
      
      // Detect specific error types
      let errorType = 'Unknown';
      let errorMessage = 'Unknown error occurred while processing PDFs';
      
      if (error instanceof Error) {
        errorType = error.constructor.name;
        errorMessage = error.message;
        console.error('[AmazonPackingPlanView] Error details:', {
          name: error.name,
          type: errorType,
          message: error.message,
          stack: error.stack
        });
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // Provide specific error messages based on error type
      if (errorType === 'MemoryError' || errorMessage.toLowerCase().includes('memory') || errorMessage.toLowerCase().includes('too large')) {
        const totalSizeMB = pdfFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
        showError('Memory error', `PDFs are too large to process together (${totalSizeMB.toFixed(2)} MB). Try processing fewer files at once.`);
      } else if (errorType === 'IOError' || errorType === 'OSError' || errorMessage.includes('read') || errorMessage.includes('file')) {
        showError('File processing error', `Could not read one or more PDF files (${errorType}). Check that the PDF files are not corrupted and try again.`);
      } else if (errorMessage.includes('corrupted') || errorMessage.includes('Invalid PDF')) {
        showError('PDF processing error', `The PDF file appears to be corrupted or invalid.\n\n${errorMessage}\n\nPlease try with a different PDF file.`);
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        showError('Network error', `Network error occurred.\n\n${errorMessage}\n\nPlease check your internet connection and try again.`);
      } else {
        showError('Unexpected error', `Error (${errorType}): ${errorMessage}\n\nThe highlighted PDF will not be available, but other features will still work.\n\nPlease check the console for more details.`);
      }
      
      setProcessingStatus('Processing failed');
    } finally {
      setIsProcessing(false);
      setProcessingProgress(0);
    }
  }, [pdfFiles, masterData, showSuccess, showError]);

  // Generate labels with caching
  const handleGenerateLabels = useCallback(async () => {
    if (physicalItems.length === 0) {
      showError('No data', 'No physical items to generate labels for');
      return;
    }

    // Check if labels are already cached for this data
    if (labelCacheHash === currentDataHash && cachedStickerPdfBytes && cachedHousePdfBytes) {
      console.log('[Label Caching] Using cached labels. Hash:', currentDataHash.substring(0, 8));
      setStickerPdfBytes(cachedStickerPdfBytes);
      setHousePdfBytes(cachedHousePdfBytes);
      setHouse4x6VerticalPdfBytes(cachedHouse4x6VerticalPdfBytes);
      setStickerCount(cachedStickerCount);
      setHouseCount(cachedHouseCount);
      setHouse4x6VerticalCount(cachedHouse4x6VerticalCount);
      setSkippedProducts(cachedSkippedProducts);
      setActiveTab('labels');
      return;
    }

    setIsGeneratingLabels(true);

    try {
      const result = await generateLabelsByPacketUsed(physicalItems, masterData, nutritionData);
      
      // Generate 4x6 vertical format if house labels exist (50×100mm → 3 per page, rotated)
      let house4x6VerticalBytes: Uint8Array | null = null;
      let house4x6VerticalCount = 0;
      if (result.housePdfBytes && result.houseCount > 0) {
        try {
          house4x6VerticalBytes = await reformatLabelsTo4x6Vertical(result.housePdfBytes);
          // Calculate page count: 3 labels per page
          const sourcePdf = await PDFDocument.load(result.housePdfBytes);
          const sourcePageCount = sourcePdf.getPageCount();
          house4x6VerticalCount = Math.ceil(sourcePageCount / 3);
          console.log(`[4x6 Vertical] Generated ${house4x6VerticalCount} pages from ${sourcePageCount} house labels`);
        } catch (error) {
          console.error('Error generating 4x6 vertical format:', error);
          // Don't fail the whole operation if 4x6 formatting fails
        }
      }
      
      // Cache the results
      setLabelCacheHash(currentDataHash);
      setCachedStickerPdfBytes(result.stickerPdfBytes);
      setCachedHousePdfBytes(result.housePdfBytes);
      setCachedHouse4x6VerticalPdfBytes(house4x6VerticalBytes);
      setCachedStickerCount(result.stickerCount);
      setCachedHouseCount(result.houseCount);
      setCachedHouse4x6VerticalCount(house4x6VerticalCount);
      setCachedSkippedProducts(result.skippedProducts);
      
      // Set current values
      setStickerPdfBytes(result.stickerPdfBytes);
      setHousePdfBytes(result.housePdfBytes);
      setHouse4x6VerticalPdfBytes(house4x6VerticalBytes);
      setStickerCount(result.stickerCount);
      setHouseCount(result.houseCount);
      setHouse4x6VerticalCount(house4x6VerticalCount);
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
  }, [physicalItems, masterData, nutritionData, labelCacheHash, currentDataHash, cachedStickerPdfBytes, cachedHousePdfBytes, cachedHouse4x6VerticalPdfBytes, cachedStickerCount, cachedHouseCount, cachedHouse4x6VerticalCount, cachedSkippedProducts, showSuccess, showError]);

  const handleGenerateProductLabels = useCallback(async () => {
    if (physicalItems.length === 0) {
      showError('No data', 'No physical items to generate product labels for. Please process PDFs first.');
      return;
    }
    
    // Check if product labels are already cached for this data
    const productLabelCacheKey = `product_label_${currentDataHash}`;
    if (labelCacheHash === currentDataHash && cachedProductLabelPdfBytes) {
      console.log('[Label Caching] Using cached product labels. Hash:', currentDataHash.substring(0, 8));
      setProductLabelPdfBytes(cachedProductLabelPdfBytes);
      setProductLabelPdfBytesWithDate(cachedProductLabelPdfBytesWithDate);
      setProductLabelCount(cachedProductLabelCount);
      return;
    }
    
    setIsGeneratingProductLabels(true);
    try {
      // Extract unique product names from sticker and house items
      const stickerHouseProducts = physicalItems.filter(
        item => ['sticker', 'house'].includes(String(item['Packet used'] || '').trim().toLowerCase())
      );
      
      // Create flat list of product names (repeated by quantity), filtered by Product Label column
      const productList: string[] = [];
      for (const row of stickerHouseProducts) {
        const productName = row.item_name_for_labels || row.item || '';
        if (!productName || productName.toLowerCase() === 'nan') continue;
        
        // Check if product should be included
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
      
      // Generate product labels (both with and without date)
      const productPdfWithoutDate = await generateProductLabelsPdf(productList, false);
      const productPdfWithDate = await generateProductLabelsPdf(productList, true);
      
      // Cache the results
      setCachedProductLabelPdfBytes(productPdfWithoutDate);
      setCachedProductLabelPdfBytesWithDate(productPdfWithDate);
      setCachedProductLabelCount(productList.length);
      
      // Set current values (only without_date is displayed, matching Python)
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
    
    // Check if MRP labels are already cached for this data
    if (labelCacheHash === currentDataHash && cachedMrpPdfBytes) {
      console.log('[Label Caching] Using cached MRP labels. Hash:', currentDataHash.substring(0, 8));
      setMrpPdfBytes(cachedMrpPdfBytes);
      setMrpCount(cachedMrpCount);
      return;
    }
    
    setIsGeneratingMrpLabels(true);
    try {
      const { mrpPdfBytes, mrpCount } = await generateMRPOnlyLabels(physicalItems, masterData);
      
      // Cache the results
      setCachedMrpPdfBytes(mrpPdfBytes);
      setCachedMrpCount(mrpCount);
      
      // Set current values
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

  // Download PDF
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

  // Download summary PDF
  const handleDownloadSummaryPdf = () => {
    if (physicalItems.length === 0) return;
    
    const pdf = generateSummaryPdf(orders, physicalItems, stats, missingProducts);
    const pdfBytes = pdf.output('arraybuffer');
    downloadPdf(new Uint8Array(pdfBytes), `Packing_Plan_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // Download Excel
  const handleDownloadExcel = () => {
    downloadExcel(physicalItems, orders, missingProducts, `Packing_Plan_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (masterData.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Loading master data...</span>
      </div>
    );
  }

  // Get status for header
  const getStatus = () => {
    if (isProcessing) return { text: 'Processing...', color: 'text-blue-600' };
    if (processingComplete && physicalItems.length > 0) return { text: 'Complete', color: 'text-green-600' };
    if (pdfFiles.length > 0) return { text: 'Ready to process', color: 'text-yellow-600' };
    return { text: 'Ready to upload', color: 'text-gray-600' };
  };

  const status = getStatus();

  return (
    <div className="w-full space-y-6">
      {/* Header Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <ShoppingCart className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Amazon Packing Plan</h2>
              <p className="text-gray-600 mt-1">Process invoice PDFs and generate packing plans</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-gray-500">Status</p>
              <p className={`text-sm font-semibold ${status.color}`}>{status.text}</p>
            </div>
            {processingComplete && physicalItems.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-md border border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">{physicalItems.length} items</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Enhanced Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px px-6">
            {([
              { key: 'upload', label: 'Upload', icon: Upload, badge: pdfFiles.length },
              { key: 'results', label: 'Results', icon: FileText, badge: orders.length },
              { key: 'downloads', label: 'Downloads', icon: Download, badge: processingComplete ? 3 : 0 },
              { key: 'labels', label: 'Labels', icon: Tag, badge: stickerCount + houseCount + productLabelCount + mrpCount }
            ] as const).map(({ key, label, icon: Icon, badge }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`
                  relative px-6 py-4 text-sm font-medium border-b-2 transition-all flex items-center gap-2
                  ${activeTab === key
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                {badge > 0 && (
                  <span className={`ml-1 px-2 py-0.5 text-xs font-semibold rounded-full ${
                    activeTab === key ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Upload Tab */}
          {activeTab === 'upload' && (
            <div className="p-6 animate-fadeIn">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Invoice PDFs</h3>
                <p className="text-sm text-gray-600">Upload Amazon invoice PDF files to extract order information and generate packing plans</p>
              </div>
              
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
                  <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {pdfFiles.length} file(s) selected
                        </p>
                        <p className="text-xs text-gray-600">
                          {(pdfFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(2)} MB total
                        </p>
                      </div>
                    </div>
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
                      className="text-sm text-red-600 hover:text-red-700 font-medium px-3 py-1.5 hover:bg-red-50 rounded transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                    {pdfFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                            <p className="text-xs text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setPdfFiles(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                          title="Remove file"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {(() => {
                    const totalSizeMB = pdfFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
                    return (
                      <>
                        {totalSizeMB > 100 && (
                          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <p className="text-sm text-yellow-800 flex items-center gap-2">
                              <AlertCircle className="h-4 w-4" />
                              Large batch - processing may take longer
                            </p>
                          </div>
                        )}
                        {totalSizeMB > 50 && totalSizeMB <= 100 && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-sm text-blue-800 flex items-center gap-2">
                              <Info className="h-4 w-4" />
                              Processing {pdfFiles.length} files ({totalSizeMB.toFixed(2)} MB total). This may take a moment.
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <button
                    onClick={handleProcessPdfs}
                    disabled={isProcessing}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Processing {pdfFiles.length} file(s)...</span>
                      </>
                    ) : (
                      <>
                        <FileText className="w-5 h-5" />
                        <span>Process {pdfFiles.length} PDF{pdfFiles.length !== 1 ? 's' : ''}</span>
                      </>
                    )}
                  </button>
                  
                  {isProcessing && (
                    <div className="mt-4 p-6 bg-blue-50 border border-blue-200 rounded-lg animate-slideIn">
                      <div className="mb-4">
                        <ProgressBar
                          progress={processingProgress * 100}
                          label={processingStatus}
                          showPercentage={true}
                          size="md"
                          color="blue"
                          animated={true}
                        />
                      </div>
                      <ProgressSteps
                        steps={[
                          { label: 'Upload', status: 'completed' },
                          { label: 'Extract', status: processingProgress > 0.3 ? 'completed' : processingProgress > 0 ? 'active' : 'pending' },
                          { label: 'Process', status: processingProgress > 0.7 ? 'completed' : processingProgress > 0.3 ? 'active' : 'pending' },
                          { label: 'Complete', status: processingProgress >= 1 ? 'completed' : processingProgress > 0.7 ? 'active' : 'pending' }
                        ]}
                        currentStep={Math.floor(processingProgress * 3)}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Master Data Preview */}
              <details className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                <summary className="cursor-pointer text-sm font-semibold text-gray-700 flex items-center gap-2 hover:text-gray-900">
                  <Package className="h-4 w-4" />
                  Master Data Preview
                </summary>
                <div className="mt-4 overflow-x-auto">
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ASIN</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FNSKU</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {masterData.slice(0, 10).map((item, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{item.Name}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-mono">{item.ASIN}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-mono">{item.FNSKU || 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-gray-500 text-center">Showing first 10 of {masterData.length} products</p>
                </div>
              </details>
            </div>
          )}

          {/* Results Tab */}
          {activeTab === 'results' && (
            <div className="p-6">
              {orders.length > 0 ? (
                <>
                  {/* Debug Information Toggle */}
                  <div className="mb-6 flex items-center justify-between">
                    <button
                      onClick={() => setShowDebugInfo(!showDebugInfo)}
                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 font-medium px-3 py-1.5 hover:bg-gray-100 rounded transition-colors"
                    >
                      {showDebugInfo ? (
                        <>
                          <ChevronUp className="h-4 w-4" />
                          <span>Hide Debug Information</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          <span>Show Debug Information</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Debug Information Panel */}
                  {showDebugInfo && processingDebugInfo && (
                    <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-5">
                      <h4 className="text-sm font-semibold text-blue-900 mb-4 flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        Processing Debug Information
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <StatCard
                          title="Unique ASINs Extracted"
                          value={processingDebugInfo.uniqueASINsExtracted}
                          color="blue"
                        />
                        <StatCard
                          title="ASINs in Master Data"
                          value={processingDebugInfo.totalASINsInMaster}
                          color="blue"
                        />
                        <StatCard
                          title="Matched ASINs"
                          value={processingDebugInfo.matchedASINs}
                          color="green"
                        />
                        <StatCard
                          title="Unmatched ASINs"
                          value={processingDebugInfo.unmatchedASINs}
                          color="yellow"
                        />
                        <StatCard
                          title="Files Processed"
                          value={processingDebugInfo.filesProcessed}
                          color="blue"
                        />
                        <StatCard
                          title="Invoice Pages"
                          value={processingDebugInfo.totalPages}
                          color="purple"
                        />
                      </div>
                      <p className="mt-4 text-xs text-blue-600 flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Check the browser console (F12) for detailed extraction logs
                      </p>
                    </div>
                  )}

                  {/* Statistics Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <StatCard
                      title="Orders"
                      value={orders.length}
                      icon={ShoppingCart}
                      color="blue"
                      subtitle={`${stats.total_invoices} invoices`}
                    />
                    <StatCard
                      title="Physical Items"
                      value={physicalItems.length}
                      icon={Box}
                      color="green"
                      subtitle={`${stats.total_qty_physical} total qty`}
                    />
                    <StatCard
                      title="Qty Ordered"
                      value={stats.total_qty_ordered}
                      icon={Package}
                      color="purple"
                    />
                    <StatCard
                      title="Qty Physical"
                      value={stats.total_qty_physical}
                      icon={CheckCircle}
                      color="green"
                    />
                  </div>

                  {/* Missing Products Warning */}
                  {missingProducts.length > 0 && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6 rounded-r-lg">
                      <div className="flex">
                        <AlertCircle className="h-5 w-5 text-yellow-600 mr-3 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-yellow-800 mb-2">
                            {missingProducts.length} product(s) have issues
                          </p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm text-yellow-700 hover:text-yellow-800 font-medium">
                              View details
                            </summary>
                            <div className="mt-3">
                              <SearchableTable
                                data={missingProducts}
                                columns={[
                                  { key: 'ASIN', label: 'ASIN', sortable: true },
                                  { key: 'Issue', label: 'Issue', sortable: true },
                                  { key: 'Product', label: 'Product', sortable: true }
                                ]}
                                searchPlaceholder="Search missing products..."
                                exportFilename="missing_products"
                                emptyMessage="No missing products"
                              />
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Ordered Items Table */}
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Ordered Items</h4>
                    <SearchableTable
                      data={orders}
                      columns={[
                        { key: 'ASIN', label: 'ASIN', sortable: true },
                        { key: 'Qty', label: 'Qty', sortable: true },
                        { key: 'Name', label: 'Name', sortable: true },
                        { key: 'Net Weight', label: 'Net Weight', sortable: true, render: (val, row) => row['Net Weight'] || row['NetWeight'] || 'N/A' },
                        { key: 'M.R.P', label: 'M.R.P', sortable: true, render: (val, row) => row['M.R.P'] || row.MRP || 'N/A' },
                        { key: 'Packet Size', label: 'Packet Size', sortable: true },
                        { key: 'Packet used', label: 'Packet used', sortable: true },
                        { key: 'FNSKU', label: 'FNSKU', sortable: true },
                        { key: 'FSSAI', label: 'FSSAI', sortable: true, render: (val, row) => row.FSSAI || row['M.F.G. FSSAI'] || 'N/A' }
                      ]}
                      searchPlaceholder="Search orders..."
                      searchKeys={['ASIN', 'Name', 'FNSKU']}
                      exportFilename="ordered_items"
                      emptyMessage="No orders found"
                    />
                  </div>

                  <div className="mb-6 border-t border-gray-200 pt-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Physical Packing Plan</h4>
                    <SearchableTable
                      data={physicalItems}
                      columns={[
                        { 
                          key: 'item', 
                          label: 'Item', 
                          sortable: true,
                          render: (val, row) => (
                            <span className={row.is_split ? 'font-bold text-blue-700' : ''}>
                              {row.item}
                              {row.is_split && <span className="ml-1">⭐</span>}
                            </span>
                          )
                        },
                        { key: 'weight', label: 'Weight', sortable: true },
                        { key: 'Qty', label: 'Qty', sortable: true },
                        { key: 'Packet Size', label: 'Packet Size', sortable: true },
                        { key: 'FNSKU', label: 'FNSKU', sortable: true },
                        { 
                          key: 'Status', 
                          label: 'Status', 
                          sortable: true,
                          render: (val, row) => (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              row.Status.includes('MISSING') 
                                ? 'bg-red-100 text-red-700' 
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {row.Status}
                            </span>
                          )
                        }
                      ]}
                      searchPlaceholder="Search physical items..."
                      searchKeys={['item', 'FNSKU', 'Status']}
                      exportFilename="physical_packing_plan"
                      emptyMessage="No physical items found"
                      highlightRow={(row) => row.Status.includes('MISSING')}
                    />
                  </div>

                  {/* Extraction Diagnostics */}
                  <ExtractionDiagnostics diagnostics={diagnostics} />
                </>
              ) : (
                <EmptyState
                  variant="no-data"
                  title="No data available"
                  description="Upload and process PDF files to see results here"
                  action={{
                    label: 'Upload PDFs',
                    onClick: () => setActiveTab('upload')
                  }}
                />
              )}
            </div>
          )}

          {/* Downloads Tab */}
          {activeTab === 'downloads' && (
            <div className="p-6">
              {!processingComplete && pdfFiles.length > 0 ? (
                <div className="text-center py-12">
                  <Loader2 className="mx-auto h-12 w-12 text-gray-400 animate-spin" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Processing files...</h3>
                  <p className="mt-1 text-sm text-gray-500">Please wait for processing to complete.</p>
                </div>
              ) : physicalItems.length > 0 && processingComplete ? (
                <div className="space-y-4">
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Available Downloads</h3>
                    <p className="text-sm text-gray-600">Download packing plans, Excel workbooks, and highlighted invoices</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Packing Plan PDF */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <FileText className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-900">Packing Plan PDF</h4>
                            <p className="text-xs text-gray-600 mt-0.5">Complete packing plan summary</p>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={handleDownloadSummaryPdf}
                        className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                      >
                        <Download className="w-4 h-4" />
                        Download PDF
                      </button>
                    </div>

                    {/* Excel Workbook */}
                    <div className="bg-green-50 border border-green-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-100 rounded-lg">
                            <FileSpreadsheet className="h-5 w-5 text-green-600" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-900">Excel Workbook</h4>
                            <p className="text-xs text-gray-600 mt-0.5">Spreadsheet with all data</p>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={handleDownloadExcel}
                        className="w-full px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                      >
                        <Download className="w-4 h-4" />
                        Download Excel
                      </button>
                    </div>
                  </div>

                  {/* Highlighted Invoices */}
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <FileText className="h-5 w-5 text-purple-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900">Highlighted Invoices PDF</h4>
                          <p className="text-xs text-gray-600 mt-0.5">Original invoices with extracted ASINs highlighted</p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (highlightedPdfBytes) {
                          downloadPdf(highlightedPdfBytes, `Highlighted_Invoices_${new Date().toISOString().split('T')[0]}.pdf`);
                        } else {
                          showError('PDF not available', 'Highlighted PDF is not available. This may occur if PDF highlighting failed during processing. The packing plan PDF and Excel workbook are still available.');
                        }
                      }}
                      disabled={!highlightedPdfBytes}
                      className={`w-full px-4 py-2.5 flex items-center justify-center gap-2 font-medium rounded-lg shadow-sm hover:shadow-md transition-all ${
                        highlightedPdfBytes
                          ? 'bg-purple-600 text-white hover:bg-purple-700'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <Download className="w-4 h-4" />
                      {highlightedPdfBytes ? 'Download Highlighted PDF' : 'Not Available'}
                    </button>
                    {highlightingFailed && (
                      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-yellow-600" />
                          <div className="flex-1">
                            <p className="text-xs font-medium text-yellow-800 mb-1">PDF highlighting failed during processing</p>
                            <p className="text-xs text-yellow-700">
                              The highlighted PDF is not available, but other downloads work normally. This may occur if one or more PDF files are corrupted, password-protected, or in an unsupported format.
                            </p>
                            <p className="text-xs text-yellow-600 mt-2">
                              <strong>Tip:</strong> Try processing files one at a time if you encounter memory errors, or ensure PDFs are not password-protected. Check browser console for detailed error information.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState
                  variant="no-data"
                  title="No downloads available"
                  description="Process PDF files first to generate downloads"
                  icon={<FileText className="h-12 w-12 text-gray-400" />}
                  action={{
                    label: 'Upload PDFs',
                    onClick: () => setActiveTab('upload')
                  }}
                />
              )}
            </div>
          )}

          {/* Labels Tab */}
          {activeTab === 'labels' && (
            <div className="p-6">
              {!processingComplete && pdfFiles.length > 0 ? (
                <div className="text-center py-12">
                  <Loader2 className="mx-auto h-12 w-12 text-gray-400 animate-spin" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Processing files...</h3>
                  <p className="mt-1 text-sm text-gray-500">Please wait for processing to complete.</p>
                </div>
              ) : physicalItems.length > 0 && processingComplete ? (
                <>
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Label Generation</h3>
                    <p className="text-sm text-gray-600">Generate sticker labels, house labels, product labels, and MRP-only labels</p>
                  </div>

                  {/* Sticker and House Labels Section */}
                  <div className="mb-8">
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Sticker & House Labels</h4>
                    {stickerCount === 0 && houseCount === 0 && !isGeneratingLabels && (
                      <div className="mb-4">
                        <button
                          onClick={handleGenerateLabels}
                          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                        >
                          <Tag className="w-5 h-5" />
                          Generate Sticker & House Labels
                        </button>
                      </div>
                    )}

                    {isGeneratingLabels && (
                      <div className="text-center py-8 bg-blue-50 rounded-lg border border-blue-200">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
                        <p className="mt-2 text-sm text-gray-600">Generating labels...</p>
                      </div>
                    )}

                    {(stickerCount > 0 || houseCount > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {stickerCount > 0 && stickerPdfBytes && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                  <Tag className="h-5 w-5 text-blue-600" />
                                </div>
                                <div>
                                  <h5 className="font-semibold text-gray-900">Sticker Labels</h5>
                                  <p className="text-xs text-gray-600">48x25mm combined labels</p>
                                </div>
                              </div>
                            </div>
                            <div className="mb-4">
                              <p className="text-3xl font-bold text-blue-900">{stickerCount}</p>
                              <p className="text-xs text-gray-600 mt-1">labels generated</p>
                            </div>
                            <button
                              onClick={() => downloadPdf(stickerPdfBytes, `Sticker_Labels_${new Date().toISOString().split('T')[0]}.pdf`)}
                              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                            >
                              <Download className="w-4 h-4" />
                              Download ({stickerCount})
                            </button>
                          </div>
                        )}

                        {houseCount > 0 && housePdfBytes && (
                          <div className="bg-green-50 border border-green-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-green-100 rounded-lg">
                                  <Tag className="h-5 w-5 text-green-600" />
                                </div>
                                <div>
                                  <h5 className="font-semibold text-gray-900">House Labels</h5>
                                  <p className="text-xs text-gray-600">50x100mm triple labels</p>
                                </div>
                              </div>
                            </div>
                            <div className="mb-4">
                              <p className="text-3xl font-bold text-green-900">{houseCount}</p>
                              <p className="text-xs text-gray-600 mt-1">labels generated</p>
                            </div>
                            <button
                              onClick={() => downloadPdf(housePdfBytes, `House_Labels_${new Date().toISOString().split('T')[0]}.pdf`)}
                              className="w-full px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all mb-2"
                            >
                              <Download className="w-4 h-4" />
                              Download ({houseCount})
                            </button>
                            {house4x6VerticalPdfBytes && house4x6VerticalCount > 0 && (
                              <button
                                onClick={() => downloadPdf(house4x6VerticalPdfBytes, `House_4x6inch_Vertical_${new Date().toISOString().split('T')[0]}.pdf`)}
                                className="w-full px-4 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                                title="4×6 inch format with 3 labels stacked vertically, rotated 90° (50×100mm labels)"
                              >
                                <Download className="w-4 h-4" />
                                House in 4x6inch (Vertical) ({house4x6VerticalCount} pages)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {skippedProducts.length > 0 && (
                      <div className="mt-6">
                        <details className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                          <summary className="cursor-pointer text-sm font-semibold text-yellow-800 flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            Products Skipped from Label Generation ({skippedProducts.length})
                          </summary>
                          <div className="mt-4">
                            <SearchableTable
                              data={skippedProducts}
                              columns={[
                                { key: 'Product', label: 'Product', sortable: true },
                                { key: 'ASIN', label: 'ASIN', sortable: true },
                                { key: 'Packet used', label: 'Packet used', sortable: true },
                                { key: 'Reason', label: 'Reason', sortable: true }
                              ]}
                              searchPlaceholder="Search skipped products..."
                              exportFilename="skipped_products"
                              emptyMessage="No skipped products"
                            />
                          </div>
                        </details>
                      </div>
                    )}
                  </div>

                  {/* Product Labels Section */}
                  <div className="mb-8 border-t border-gray-200 pt-6">
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Product Labels (96x25mm)</h4>
                    {!productLabelPdfBytes && !isGeneratingProductLabels && (
                      <button
                        onClick={handleGenerateProductLabels}
                        className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                      >
                        <Tag className="w-5 h-5" />
                        Generate Product Labels
                      </button>
                    )}
                    {isGeneratingProductLabels && (
                      <div className="text-center py-8 bg-indigo-50 rounded-lg border border-indigo-200">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-600" />
                        <p className="mt-2 text-sm text-gray-600">Generating product labels...</p>
                      </div>
                    )}
                    {productLabelPdfBytes && productLabelCount > 0 && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-100 rounded-lg">
                              <Tag className="h-5 w-5 text-indigo-600" />
                            </div>
                            <div>
                              <h5 className="font-semibold text-gray-900">Product Labels</h5>
                              <p className="text-xs text-gray-600">96x25mm product name labels</p>
                            </div>
                          </div>
                        </div>
                        <div className="mb-4">
                          <p className="text-3xl font-bold text-indigo-900">{productLabelCount}</p>
                          <p className="text-xs text-gray-600 mt-1">labels generated</p>
                        </div>
                        <button
                          onClick={() => downloadPdf(productLabelPdfBytes, `Product_Labels_No_Date_${new Date().toISOString().split('T')[0]}.pdf`)}
                          className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                        >
                          <Download className="w-4 h-4" />
                          Download without Date ({productLabelCount})
                        </button>
                      </div>
                    )}
                  </div>

                  {/* MRP-Only Labels Section */}
                  <div className="mb-8 border-t border-gray-200 pt-6">
                    <h4 className="text-md font-semibold text-gray-800 mb-4">MRP-Only Labels</h4>
                    {!mrpPdfBytes && !isGeneratingMrpLabels && (
                      <button
                        onClick={handleGenerateMrpLabels}
                        className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                      >
                      <Tag className="w-5 h-5" />
                      Generate MRP-Only Labels
                    </button>
                    )}
                    {isGeneratingMrpLabels && (
                      <div className="text-center py-8 bg-purple-50 rounded-lg border border-purple-200">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-purple-600" />
                        <p className="mt-2 text-sm text-gray-600">Generating MRP labels...</p>
                      </div>
                    )}
                    {mrpPdfBytes && mrpCount > 0 && (
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-100 rounded-lg">
                              <Tag className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                              <h5 className="font-semibold text-gray-900">MRP-Only Labels</h5>
                              <p className="text-xs text-gray-600">48x25mm MRP labels</p>
                            </div>
                          </div>
                        </div>
                        <div className="mb-4">
                          <p className="text-3xl font-bold text-purple-900">{mrpCount}</p>
                          <p className="text-xs text-gray-600 mt-1">labels generated</p>
                        </div>
                        <button
                          onClick={() => downloadPdf(mrpPdfBytes, `MRP_Only_Labels_${new Date().toISOString().split('T')[0]}.pdf`)}
                          className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md transition-all"
                        >
                          <Download className="w-4 h-4" />
                          Download ({mrpCount})
                        </button>
                      </div>
                    )}
                    {mrpPdfBytes && mrpCount === 0 && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <p className="text-sm text-gray-600">No products found without FNSKU.</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <EmptyState
                  variant="no-data"
                  title={pdfFiles.length > 0 ? "No physical packing plan available" : "No labels available"}
                  description={pdfFiles.length > 0 ? "No physical packing plan available for label generation." : "Please upload invoice PDFs to generate labels."}
                  icon={pdfFiles.length > 0 ? <Package className="h-12 w-12 text-gray-400" /> : <Tag className="h-12 w-12 text-gray-400" />}
                  action={pdfFiles.length === 0 ? {
                    label: 'Upload PDFs',
                    onClick: () => setActiveTab('upload')
                  } : undefined}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AmazonPackingPlanView;
