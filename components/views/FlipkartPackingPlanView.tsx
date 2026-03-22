import React, { useState, useCallback, useMemo } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { Upload, FileText, Download, Tag, AlertCircle, Package, Loader2, X } from 'lucide-react';
import { MasterProduct, NutritionData, PhysicalItem, MissingProduct, ProcessingStats } from '../../types';
import { processFlipkartPdfInvoices } from '../../services/flipkartPdfProcessor';
import { expandToPhysicalFlipkart } from '../../services/flipkartPackingPlanProcessor';
import { getProductFromFkSku } from '../../services/flipkartProductMatcher';
import { parseSkuId } from '../../services/flipkartUtils';
import { reformatLabelsTo4x6Vertical } from '../../services/labelFormatter';
import { generateSummaryPdf } from '../../services/packingPlanPdfGenerator';
import { sortPdfBySkuFlipkart } from '../../services/flipkartSortedPdfGenerator';
import { generateLabelsByPacketUsed, generateMRPOnlyLabels, generateCombinedVerticalLabels } from '../../services/packingPlanLabelGenerator';
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
import BrandWiseLabels from '../../components/BrandWiseLabels';
import DownloadButton from '../../components/DownloadButton';

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

interface EnrichedFlipkartOrder {
  Item: string;
  Weight: string;
  Qty: number;
  'Packet Size': string;
  'SKU ID': string;
}

const enrichFlipkartOrders = (
  orders: FlipkartOrderItem[],
  masterData: MasterProduct[]
): EnrichedFlipkartOrder[] => {
  return orders.map(order => {
    const sku = order.SKU;
    const qty = order.Qty;
    const matches = getProductFromFkSku(sku, masterData);
    if (matches.length > 0) {
      const match = matches[0];
      const packetSize = match['Packet Size'] || match['PacketSize'] || 'N/A';
      return {
        Item: String(match.Name || ''),
        Weight: String(match['Net Weight'] || ''),
        Qty: qty,
        'Packet Size': String(packetSize),
        'SKU ID': sku
      };
    }
    const parsed = parseSkuId(sku);
    return {
      Item: parsed.productName || sku,
      Weight: parsed.weight || '',
      Qty: qty,
      'Packet Size': 'N/A',
      'SKU ID': sku
    };
  });
};

const FlipkartPackingPlanView: React.FC<FlipkartPackingPlanViewProps> = ({ masterData, nutritionData }) => {
  const { showSuccess, showError, showInfo } = useToast();
  const confirm = useConfirm();
  const { flags } = useAdmin();
  
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingComplete, setProcessingComplete] = useState(false);
  
  const [orders, setOrders] = useState<FlipkartOrderItem[]>([]);
  const [enrichedOrders, setEnrichedOrders] = useState<EnrichedFlipkartOrder[]>([]);
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
  const [productLabel50x25PdfBytes, setProductLabel50x25PdfBytes] = useState<Uint8Array | null>(null);
  const [productLabelCount, setProductLabelCount] = useState(0);
  const [isGeneratingProductLabels, setIsGeneratingProductLabels] = useState(false);
  
  // MRP-only labels state
  const [mrpPdfBytes, setMrpPdfBytes] = useState<Uint8Array | null>(null);
  const [mrpCount, setMrpCount] = useState(0);
  const [isGeneratingMrpLabels, setIsGeneratingMrpLabels] = useState(false);

  // Combined Vertical Sticker labels state
  const [combinedVerticalPdfBytes, setCombinedVerticalPdfBytes] = useState<Uint8Array | null>(null);
  const [combinedVerticalCount, setCombinedVerticalCount] = useState(0);
  const [isGeneratingCombinedVertical, setIsGeneratingCombinedVertical] = useState(false);
  const [cachedCombinedVerticalPdfBytes, setCachedCombinedVerticalPdfBytes] = useState<Uint8Array | null>(null);
  const [cachedCombinedVerticalCount, setCachedCombinedVerticalCount] = useState(0);
  
  // Sorted PDF state
  const [sortedPdfBytes, setSortedPdfBytes] = useState<Uint8Array | null>(null);
  const [isGeneratingSortedPdf, setIsGeneratingSortedPdf] = useState(false);
  
  // House 4x6 vertical labels state
  const [house4x6PdfBytes, setHouse4x6PdfBytes] = useState<Uint8Array | null>(null);
  const [isGenerating4x6, setIsGenerating4x6] = useState(false);

  // Label caching state
  const [labelCacheHash, setLabelCacheHash] = useState<string | null>(null);
  const [cachedStickerPdfBytes, setCachedStickerPdfBytes] = useState<Uint8Array | null>(null);
  const [cachedHousePdfBytes, setCachedHousePdfBytes] = useState<Uint8Array | null>(null);
  const [cachedHouse4x6PdfBytes, setCachedHouse4x6PdfBytes] = useState<Uint8Array | null>(null);
  const [cachedStickerCount, setCachedStickerCount] = useState(0);
  const [cachedHouseCount, setCachedHouseCount] = useState(0);
  const [cachedSkippedProducts, setCachedSkippedProducts] = useState<Array<{ Product: string; ASIN: string; 'Packet used': string; Reason: string }>>([]);
  const [cachedProductLabelPdfBytes, setCachedProductLabelPdfBytes] = useState<Uint8Array | null>(null);
  const [cachedProductLabel50x25PdfBytes, setCachedProductLabel50x25PdfBytes] = useState<Uint8Array | null>(null);
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
      // Build enriched orders with Item, Weight, Packet Size from master data
      setEnrichedOrders(enrichFlipkartOrders(ordersWithMaster, masterData));

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
      setCachedHouse4x6PdfBytes(null);
      setCachedStickerCount(0);
      setCachedHouseCount(0);
      setCachedSkippedProducts([]);
      setCachedProductLabelPdfBytes(null);
      setCachedProductLabel50x25PdfBytes(null);
      setCachedProductLabelCount(0);
      setCachedMrpPdfBytes(null);
      setCachedMrpCount(0);
      setCachedCombinedVerticalPdfBytes(null);
      setCachedCombinedVerticalCount(0);

      // Reset sorted PDF and 4x6 labels
      setSortedPdfBytes(null);
      setHouse4x6PdfBytes(null);
      setCombinedVerticalPdfBytes(null);
      setCombinedVerticalCount(0);

      // Calculate statistics
      const totalQtyOrdered = ordersWithMaster.reduce((sum, o) => sum + (o.Qty || 0), 0);
      const totalQtyPhysical = physical.reduce((sum, p) => sum + (p.Qty || 0), 0);

      setStats({
        total_invoices: result.totalInvoices,
        multi_qty_invoices: result.multiQtyInvoices,
        single_item_invoices: result.totalInvoices - result.multiQtyInvoices,
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
              showInfo('PDF ready', 'Highlighted shipping labels PDF has been generated and is ready to download.');
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
      setHouse4x6PdfBytes(cachedHouse4x6PdfBytes);
      setStickerCount(cachedStickerCount);
      setHouseCount(cachedHouseCount);
      setSkippedProducts(cachedSkippedProducts);
      setActiveTab('labels');
      return;
    }

    setIsGeneratingLabels(true);

    try {
      const result = await generateLabelsByPacketUsed(physicalItems, masterData, nutritionData);

      // Generate 4x6 vertical format for house labels
      let house4x6Bytes: Uint8Array | null = null;
      if (result.housePdfBytes && result.houseCount > 0) {
        try {
          setIsGenerating4x6(true);
          house4x6Bytes = await reformatLabelsTo4x6Vertical(result.housePdfBytes);
          console.log('[Label Caching] 4x6 vertical labels generated');
        } catch (err) {
          console.error('[Label Caching] Error generating 4x6 vertical labels:', err);
        } finally {
          setIsGenerating4x6(false);
        }
      }

      setLabelCacheHash(currentDataHash);
      setCachedStickerPdfBytes(result.stickerPdfBytes);
      setCachedHousePdfBytes(result.housePdfBytes);
      setCachedHouse4x6PdfBytes(house4x6Bytes);
      setCachedStickerCount(result.stickerCount);
      setCachedHouseCount(result.houseCount);
      setCachedSkippedProducts(result.skippedProducts);

      setStickerPdfBytes(result.stickerPdfBytes);
      setHousePdfBytes(result.housePdfBytes);
      setHouse4x6PdfBytes(house4x6Bytes);
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
  }, [physicalItems, masterData, nutritionData, labelCacheHash, currentDataHash, cachedStickerPdfBytes, cachedHousePdfBytes, cachedHouse4x6PdfBytes, cachedStickerCount, cachedHouseCount, cachedSkippedProducts, showSuccess, showError]);

  const handleGenerateProductLabels = useCallback(async () => {
    if (physicalItems.length === 0) {
      showError('No data', 'No physical items to generate product labels for. Please process PDFs first.');
      return;
    }
    
    if (labelCacheHash === currentDataHash && cachedProductLabelPdfBytes) {
      console.log('[Label Caching] Using cached product labels. Hash:', currentDataHash.substring(0, 8));
      setProductLabelPdfBytes(cachedProductLabelPdfBytes);
      setProductLabel50x25PdfBytes(cachedProductLabel50x25PdfBytes);
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
      
      const productPdf96x25 = await generateProductLabelsPdf(productList, false, '96x25mm');
      const productPdf50x25 = await generateProductLabelsPdf(productList, false, '50x25mm');

      setCachedProductLabelPdfBytes(productPdf96x25);
      setCachedProductLabel50x25PdfBytes(productPdf50x25);
      setCachedProductLabelCount(productList.length);

      setProductLabelPdfBytes(productPdf96x25);
      setProductLabel50x25PdfBytes(productPdf50x25);
      setProductLabelCount(productList.length);
      
      console.log('[Label Caching] Product labels generated and cached. Hash:', currentDataHash.substring(0, 8));
      showSuccess('Product labels generated', `Generated ${productList.length} product labels`);
    } catch (error: any) {
      console.error('Error generating product labels:', error);
      showError('Generation failed', `Error generating product labels: ${error.message || error}`);
    } finally {
      setIsGeneratingProductLabels(false);
    }
  }, [physicalItems, masterData, labelCacheHash, currentDataHash, cachedProductLabelPdfBytes, cachedProductLabel50x25PdfBytes, cachedProductLabelCount, showSuccess, showError]);

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

  const handleGenerateCombinedVerticalLabels = useCallback(async () => {
    if (physicalItems.length === 0) {
      showError('No data', 'No physical items to generate labels for. Please process PDFs first.');
      return;
    }
    if (labelCacheHash === currentDataHash && cachedCombinedVerticalPdfBytes) {
      setCombinedVerticalPdfBytes(cachedCombinedVerticalPdfBytes);
      setCombinedVerticalCount(cachedCombinedVerticalCount);
      return;
    }
    setIsGeneratingCombinedVertical(true);
    try {
      const { combinedVerticalPdfBytes: pdfBytes, combinedVerticalCount: count } =
        await generateCombinedVerticalLabels(physicalItems, masterData);
      setCachedCombinedVerticalPdfBytes(pdfBytes);
      setCachedCombinedVerticalCount(count);
      setCombinedVerticalPdfBytes(pdfBytes);
      setCombinedVerticalCount(count);
      showSuccess('Labels generated', `Generated ${count} combined vertical sticker labels`);
    } catch (error: any) {
      showError('Generation failed', `Error generating combined vertical labels: ${error.message || error}`);
    } finally {
      setIsGeneratingCombinedVertical(false);
    }
  }, [physicalItems, masterData, labelCacheHash, currentDataHash, cachedCombinedVerticalPdfBytes, cachedCombinedVerticalCount, showSuccess, showError]);

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

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="w-full">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-gray-200 bg-gray-50">
          <nav className="flex">
            {(['upload', 'results', 'downloads', 'labels'] as const).map((tab) => {
              const badges: Record<string, string | null> = {
                upload: pdfFiles.length > 0 ? String(pdfFiles.length) : null,
                results: physicalItems.length > 0 ? String(physicalItems.length) : null,
                downloads: null,
                labels: stickerCount + houseCount > 0 ? String(stickerCount + houseCount) : null,
              };
              const labels = { upload: 'Upload', results: 'Results', downloads: 'Downloads', labels: 'Labels' };
              const icons = { upload: '📤', results: '📊', downloads: '💾', labels: '🏷️' };
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                    ${activeTab === tab
                      ? 'border-blue-500 text-blue-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-white/60'
                    }`}
                >
                  <span>{icons[tab]}</span>
                  <span>{labels[tab]}</span>
                  {badges[tab] && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold
                      ${activeTab === tab ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>
                      {badges[tab]}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">

          {/* ── UPLOAD TAB ── */}
          {activeTab === 'upload' && (
            <div>
              <div className="mb-5">
                <h3 className="text-base font-semibold text-gray-900">Upload Flipkart Invoice PDFs</h3>
                <p className="text-sm text-gray-500 mt-0.5">Upload one or more invoice PDFs to generate the packing plan</p>
              </div>

              {pdfFiles.length === 0 ? (
                <FileUploadZone
                  onFilesSelected={(files) => {
                    if (files.length > MAX_FILES) { showError('Too many files', `Maximum ${MAX_FILES} files allowed`); return; }
                    const totalSizeMB = files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
                    if (totalSizeMB > MAX_TOTAL_SIZE_MB) { showError('Files too large', `Maximum total size is ${MAX_TOTAL_SIZE_MB} MB`); return; }
                    const validFiles: File[] = [];
                    for (const file of files) {
                      const validation = validatePdfFile(file, 50);
                      if (validation.valid) validFiles.push(file);
                      else showError('Invalid file', `${file.name}: ${validation.message}`);
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
                  label="Drop Flipkart invoice PDFs here"
                  description={`Up to ${MAX_FILES} files · max ${MAX_TOTAL_SIZE_MB} MB total`}
                />
              ) : (
                <>
                  {/* File list */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                      <span className="text-sm font-medium text-gray-700">
                        {pdfFiles.length} file{pdfFiles.length !== 1 ? 's' : ''} selected
                        <span className="text-gray-400 ml-2">
                          ({(pdfFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1)} MB)
                        </span>
                      </span>
                      <button
                        onClick={() => confirm({ title: 'Clear Files', message: 'Remove all selected files?', variant: 'default', onConfirm: () => { setPdfFiles([]); setProcessingComplete(false); } })}
                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-52 overflow-y-auto">
                      {pdfFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText className="h-4 w-4 text-red-400 flex-shrink-0" />
                            <span className="text-sm text-gray-800 truncate">{file.name}</span>
                          </div>
                          <div className="flex items-center gap-3 ml-3">
                            <span className="text-xs text-gray-400 whitespace-nowrap">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                            <button onClick={() => handleRemoveFile(idx)} className="p-1 text-gray-300 hover:text-red-500 transition-colors rounded">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Warning for large batches */}
                  {pdfFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024) > 100 && (
                    <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      Large batch — processing may take a few minutes
                    </div>
                  )}

                  {/* Process button + progress */}
                  {isProcessing ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                        <span className="text-sm font-medium text-blue-800">Processing PDFs…</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-1.5 mb-2">
                        <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${processingProgress * 100}%` }} />
                      </div>
                      <p className="text-xs text-blue-600">{processingStatus}</p>
                    </div>
                  ) : (
                    <button
                      onClick={handleProcessPdfs}
                      className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
                    >
                      <FileText className="w-4 h-4" />
                      Process {pdfFiles.length} PDF{pdfFiles.length !== 1 ? 's' : ''}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── RESULTS TAB ── */}
          {activeTab === 'results' && (
            <div>
              {orders.length > 0 ? (
                <>
                  {/* Stats row */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                    {[
                      { label: 'Invoices', value: stats.total_invoices, color: 'blue' },
                      { label: 'Multi-Qty', value: stats.multi_qty_invoices, color: 'amber' },
                      { label: 'SKUs', value: orders.length, color: 'violet' },
                      { label: 'Qty Ordered', value: stats.total_qty_ordered, color: 'green' },
                      { label: 'Qty Physical', value: stats.total_qty_physical, color: 'teal' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`rounded-lg p-3 border bg-${color}-50 border-${color}-100`}>
                        <p className={`text-xs font-medium text-${color}-600 mb-1`}>{label}</p>
                        <p className={`text-2xl font-bold text-${color}-800`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Missing products alert */}
                  {missingProducts.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-amber-800">{missingProducts.length} SKU{missingProducts.length !== 1 ? 's' : ''} with issues</p>
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-xs text-amber-600 hover:text-amber-800">View details</summary>
                            <div className="mt-2 overflow-x-auto rounded border border-amber-200">
                              <table className="min-w-full text-xs">
                                <thead className="bg-amber-100">
                                  <tr>
                                    {['SKU', 'Issue', 'Product'].map(h => (
                                      <th key={h} className="px-3 py-1.5 text-left font-semibold text-amber-800">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-amber-100">
                                  {missingProducts.map((item, idx) => (
                                    <tr key={idx}>
                                      <td className="px-3 py-1.5 font-mono">{item.ASIN}</td>
                                      <td className="px-3 py-1.5 text-red-600">{item.Issue}</td>
                                      <td className="px-3 py-1.5">{item.Product || '—'}</td>
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

                  {/* Ordered Items */}
                  <div className="mb-5">
                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Ordered Items</h4>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="overflow-auto max-h-56">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0 z-10">
                            <tr>
                              {['Item', 'Weight', 'Qty', 'Packet Size', 'SKU ID'].map(h => (
                                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {(enrichedOrders.length > 0 ? enrichedOrders : orders.map(o => ({ Item: o.SKU, Weight: '', Qty: o.Qty, 'Packet Size': '', 'SKU ID': o.SKU }))).map((order, idx) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium text-gray-900">{order.Item}</td>
                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{order.Weight}</td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold
                                    ${order.Qty > 1 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'}`}>
                                    {order.Qty}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{order['Packet Size']}</td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-400">{order['SKU ID']}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Physical Packing Plan */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Physical Packing Plan</h4>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="overflow-auto max-h-72">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0 z-10">
                            <tr>
                              {['Item', 'Weight', 'Qty', 'Packet Size', 'FNSKU', 'Status'].map(h => (
                                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {physicalItems.map((item, idx) => {
                              const isMissing = item.Status.includes('MISSING');
                              return (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 font-medium text-gray-900">
                                    {item.is_split
                                      ? <span className="text-violet-700">{item.item} <span className="text-xs bg-violet-100 text-violet-600 px-1 py-0.5 rounded ml-1">split</span></span>
                                      : item.item}
                                  </td>
                                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.weight}</td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold
                                      ${item.Qty > 1 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'}`}>
                                      {item.Qty}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item['Packet Size']}</td>
                                  <td className="px-3 py-2 font-mono text-xs text-gray-400">{item.FNSKU}</td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold
                                      ${isMissing ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                      {isMissing ? 'Missing' : 'OK'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Debug toggle */}
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <button onClick={() => setShowDebugInfo(!showDebugInfo)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                      <span>{showDebugInfo ? '▼' : '▶'}</span> Debug info
                    </button>
                    {showDebugInfo && processingDebugInfo && (
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs bg-gray-50 rounded-lg p-3">
                        {[
                          ['SKUs Extracted', processingDebugInfo.uniqueSKUsExtracted, 'gray'],
                          ['Matched', processingDebugInfo.matchedSKUs, 'green'],
                          ['Unmatched', processingDebugInfo.unmatchedSKUs, 'red'],
                          ['Files', processingDebugInfo.filesProcessed, 'gray'],
                          ['Invoice Pages', processingDebugInfo.totalPages, 'gray'],
                          ['Master SKUs', processingDebugInfo.totalSKUsInMaster, 'gray'],
                        ].map(([label, val, color]) => (
                          <div key={label as string}>
                            <p className="text-gray-500">{label}</p>
                            <p className={`font-bold text-${color}-600`}>{val}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<Package className="h-10 w-10 text-gray-300" />}
                  title="No results yet"
                  description="Upload and process invoice PDFs to see the packing plan"
                  action={{ label: 'Go to Upload', onClick: () => setActiveTab('upload') }}
                />
              )}
            </div>
          )}

          {/* ── DOWNLOADS TAB ── */}
          {activeTab === 'downloads' && (
            <div>
              {!processingComplete && pdfFiles.length > 0 ? (
                <div className="text-center py-12">
                  <Loader2 className="mx-auto h-10 w-10 text-gray-300 animate-spin" />
                  <p className="mt-3 text-sm text-gray-500">Processing files, please wait…</p>
                </div>
              ) : physicalItems.length > 0 && processingComplete ? (
                <div className="space-y-3">
                  {/* Reports */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Reports</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <DownloadButton
                        onDownload={handleDownloadSummaryPdf}
                        tickSize="h-4 w-4"
                        className="flex items-center gap-3 px-4 py-3.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm text-left"
                      >
                        <div className="p-1.5 bg-white/20 rounded-md"><Download className="w-4 h-4" /></div>
                        <div>
                          <p className="font-medium text-sm">Packing Plan</p>
                          <p className="text-xs text-blue-200">PDF summary</p>
                        </div>
                      </DownloadButton>
                      <DownloadButton
                        onDownload={handleDownloadExcel}
                        tickSize="h-4 w-4"
                        className="flex items-center gap-3 px-4 py-3.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm text-left"
                      >
                        <div className="p-1.5 bg-white/20 rounded-md"><Download className="w-4 h-4" /></div>
                        <div>
                          <p className="font-medium text-sm">Excel Workbook</p>
                          <p className="text-xs text-emerald-200">.xlsx with all data</p>
                        </div>
                      </DownloadButton>
                    </div>
                  </div>

                  {/* Shipping Labels PDF */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Shipping Labels</p>
                    {isGeneratingSortedPdf ? (
                      <div className="flex items-center gap-3 px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Generating PDF…</p>
                          <p className="text-xs text-gray-400">Cropping & highlighting multi-qty pages</p>
                        </div>
                      </div>
                    ) : sortedPdfBytes ? (
                      <DownloadButton
                        onDownload={() => downloadPdf(sortedPdfBytes, `Flipkart_Highlighted_Shipping_Labels_${today}.pdf`)}
                        tickSize="h-4 w-4"
                        className="w-full flex items-center gap-3 px-4 py-3.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors shadow-sm text-left"
                      >
                        <div className="p-1.5 bg-white/20 rounded-md"><Download className="w-4 h-4" /></div>
                        <div>
                          <p className="font-medium text-sm">Highlighted Shipping Labels</p>
                          <p className="text-xs text-violet-200">Cropped · multi-qty pages highlighted</p>
                        </div>
                      </DownloadButton>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        PDF not available — process PDFs again
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Download className="h-10 w-10 text-gray-300" />}
                  title="No downloads yet"
                  description="Process invoice PDFs first to generate downloads"
                  action={{ label: 'Go to Upload', onClick: () => setActiveTab('upload') }}
                />
              )}
            </div>
          )}

          {/* ── LABELS TAB ── */}
          {activeTab === 'labels' && (
            <div>
              {!processingComplete && pdfFiles.length > 0 ? (
                <div className="text-center py-12">
                  <Loader2 className="mx-auto h-10 w-10 text-gray-300 animate-spin" />
                  <p className="mt-3 text-sm text-gray-500">Processing files, please wait…</p>
                </div>
              ) : physicalItems.length > 0 && processingComplete ? (
                <div className="flex gap-5 items-start">
                  {/* Left column — normal labels */}
                  <div className="flex-1 min-w-0 space-y-6">

                  {/* Generate All button */}
                  {!isGeneratingLabels && !isGeneratingCombinedVertical && !isGeneratingProductLabels && !isGeneratingMrpLabels && (
                    <div className="flex justify-end mb-1">
                      <button
                        onClick={async () => {
                          await handleGenerateLabels();
                          await handleGenerateCombinedVerticalLabels();
                          await handleGenerateProductLabels();
                          await handleGenerateMrpLabels();
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        <Tag className="h-4 w-4" /> Generate All Labels
                      </button>
                    </div>
                  )}

                  {/* Sticker + House labels */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sticker &amp; House Labels</span>
                      {stickerCount === 0 && houseCount === 0 && !isGeneratingLabels && (
                        <button onClick={handleGenerateLabels} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors">
                          <Tag className="w-3.5 h-3.5" /> Generate
                        </button>
                      )}
                      {isGeneratingLabels && <div className="flex items-center gap-1.5 text-xs text-blue-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</div>}
                    </div>

                    {/* Sticker row */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-800">Sticker Labels</p>
                        <p className="text-xs text-gray-400">48×25mm combined</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {stickerCount > 0 && <span className="text-sm font-bold text-blue-600 w-6 text-right">{stickerCount}</span>}
                        {stickerPdfBytes && stickerCount > 0 ? (
                          <DownloadButton onDownload={() => downloadPdf(stickerPdfBytes, `Sticker_Labels_${today}.pdf`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors">
                            <Download className="h-3.5 w-3.5" /> Download
                          </DownloadButton>
                        ) : !isGeneratingLabels && <span className="text-xs text-gray-400">Not generated</span>}
                      </div>
                    </div>

                    {/* House row */}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">House Labels</p>
                        <p className="text-xs text-gray-400">50×100mm triple</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {houseCount > 0 && <span className="text-sm font-bold text-green-600 w-6 text-right">{houseCount}</span>}
                        {housePdfBytes && houseCount > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <DownloadButton onDownload={() => downloadPdf(housePdfBytes, `House_Labels_${today}.pdf`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 transition-colors">
                              <Download className="h-3.5 w-3.5" /> Download
                            </DownloadButton>
                            {isGenerating4x6 && <div className="flex items-center gap-1 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> 4×6…</div>}
                            {flags.show4x6Vertical && house4x6PdfBytes && !isGenerating4x6 && (
                              <DownloadButton onDownload={() => downloadPdf(house4x6PdfBytes, `House_Labels_4x6_Vertical_${today}.pdf`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700 transition-colors" title="4×6 inch format, 3 labels per page">
                                <Download className="h-3.5 w-3.5" /> 4×6 Vertical
                              </DownloadButton>
                            )}
                          </div>
                        ) : !isGeneratingLabels && <span className="text-xs text-gray-400">Not generated</span>}
                      </div>
                    </div>
                  </div>

                  {skippedProducts.length > 0 && (
                    <details className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                      <summary className="cursor-pointer flex items-center gap-2 px-4 py-2.5 bg-amber-50 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                        <AlertCircle className="w-3.5 h-3.5" /> {skippedProducts.length} product{skippedProducts.length !== 1 ? 's' : ''} skipped from label generation
                      </summary>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-xs divide-y divide-gray-100">
                          <thead className="bg-gray-50"><tr>{['Product', 'SKU', 'Packet used', 'Reason'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>)}</tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {skippedProducts.map((item, idx) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-3 py-2">{item.Product}</td>
                                <td className="px-3 py-2 font-mono">{item.ASIN}</td>
                                <td className="px-3 py-2">{item['Packet used']}</td>
                                <td className="px-3 py-2 text-red-600">{item.Reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  {/* Combined Vertical Sticker Labels */}
                  <div className="border-t border-gray-100 pt-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Combined Vertical Sticker</p>
                        <p className="text-xs text-gray-400 mt-0.5">2-page: MRP (50×25mm) + Barcode (50×25mm)</p>
                      </div>
                      {!combinedVerticalPdfBytes && !isGeneratingCombinedVertical && (
                        <button
                          onClick={handleGenerateCombinedVerticalLabels}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-md hover:bg-orange-700 transition-colors"
                        >
                          <Tag className="w-3.5 h-3.5" /> Generate
                        </button>
                      )}
                    </div>
                    {isGeneratingCombinedVertical ? (
                      <div className="flex items-center gap-3 px-4 py-4 bg-orange-50 border border-orange-200 rounded-lg text-orange-700">
                        <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                        <p className="text-sm font-medium">Generating combined vertical sticker labels…</p>
                      </div>
                    ) : combinedVerticalCount > 0 && combinedVerticalPdfBytes ? (
                      <div className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-semibold text-gray-700">Combined Vertical Sticker Labels</p>
                          <span className="text-2xl font-bold text-orange-600">{combinedVerticalCount}</span>
                        </div>
                        <DownloadButton
                          onDownload={() => downloadPdf(combinedVerticalPdfBytes, `Combined_Vertical_Labels_${today}.pdf`)}
                          tickSize="h-4 w-4"
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 text-white text-sm rounded-md hover:bg-orange-700 transition-colors"
                        >
                          <Download className="w-4 h-4" /> Download ({combinedVerticalCount} labels · {combinedVerticalCount * 2} pages)
                        </DownloadButton>
                      </div>
                    ) : (
                      <div className="px-4 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400 text-center">
                        Click Generate to create combined vertical sticker labels
                      </div>
                    )}
                  </div>

                  {/* Product Labels */}
                  <div className="border-t border-gray-100 pt-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Product Labels</p>
                        <p className="text-xs text-gray-400 mt-0.5">96×25mm · 50×25mm</p>
                      </div>
                      {!productLabelPdfBytes && !isGeneratingProductLabels && (
                        <button
                          onClick={handleGenerateProductLabels}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 transition-colors"
                        >
                          <Tag className="w-3.5 h-3.5" /> Generate
                        </button>
                      )}
                    </div>
                    {isGeneratingProductLabels ? (
                      <div className="flex items-center gap-3 px-4 py-4 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-700">
                        <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                        <p className="text-sm font-medium">Generating product labels…</p>
                      </div>
                    ) : productLabelPdfBytes && productLabelCount > 0 ? (
                      <div className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-gray-800">Product Labels</p>
                          <p className="text-xs text-gray-400">96×25mm · 50×25mm</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-indigo-600">{productLabelCount}</span>
                          <DownloadButton
                            onDownload={() => downloadPdf(productLabelPdfBytes, `Product_Labels_96x25_${today}.pdf`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" /> 96×25mm
                          </DownloadButton>
                          {productLabel50x25PdfBytes && (
                            <DownloadButton
                              onDownload={() => downloadPdf(productLabel50x25PdfBytes, `Product_Labels_50x25_${today}.pdf`)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 text-white text-xs font-medium rounded-md hover:bg-indigo-600 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" /> 50×25mm
                            </DownloadButton>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400 text-center">
                        Click Generate to create product labels
                      </div>
                    )}
                  </div>

                  {/* MRP Labels */}
                  {flags.showMrpOnlyLabels && (
                  <div className="border-t border-gray-100 pt-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">MRP-Only Labels</p>
                      </div>
                      {!mrpPdfBytes && !isGeneratingMrpLabels && (
                        <button
                          onClick={handleGenerateMrpLabels}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-md hover:bg-purple-700 transition-colors"
                        >
                          <Tag className="w-3.5 h-3.5" /> Generate
                        </button>
                      )}
                    </div>
                    {isGeneratingMrpLabels ? (
                      <div className="flex items-center gap-3 px-4 py-4 bg-purple-50 border border-purple-200 rounded-lg text-purple-700">
                        <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                        <p className="text-sm font-medium">Generating MRP labels…</p>
                      </div>
                    ) : mrpPdfBytes && mrpCount > 0 ? (
                      <div className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-semibold text-gray-700">MRP-Only Labels</p>
                          <span className="text-2xl font-bold text-purple-600">{mrpCount}</span>
                        </div>
                        <DownloadButton
                          onDownload={() => downloadPdf(mrpPdfBytes, `MRP_Only_Labels_${today}.pdf`)}
                          tickSize="h-4 w-4"
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 transition-colors"
                        >
                          <Download className="w-4 h-4" /> Download
                        </DownloadButton>
                      </div>
                    ) : (
                      <div className="px-4 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400 text-center">
                        Click Generate to create MRP-only labels
                      </div>
                    )}
                  </div>
                  )}

                  </div>
                  {/* Right column — brand-wise labels */}
                  {flags.showBrandWiseLabels && (
                    <div className="flex-1 min-w-0">
                      <BrandWiseLabels
                        physicalItems={physicalItems}
                        masterData={masterData}
                        nutritionData={nutritionData}
                        show4x6Vertical={flags.show4x6Vertical}
                        showMrpOnlyLabels={flags.showMrpOnlyLabels}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={<Tag className="h-10 w-10 text-gray-300" />}
                  title="No labels yet"
                  description="Process invoice PDFs to generate labels"
                  action={{ label: 'Go to Upload', onClick: () => setActiveTab('upload') }}
                />
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default FlipkartPackingPlanView;
