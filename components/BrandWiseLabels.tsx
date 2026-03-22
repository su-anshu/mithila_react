import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Download, Loader2, Tag } from 'lucide-react';
import DownloadButton from './DownloadButton';
import { PDFDocument } from 'pdf-lib';
import { PhysicalItem, MasterProduct, NutritionData } from '../types';
import {
  generateLabelsByPacketUsed,
  generateMRPOnlyLabels,
  generateCombinedVerticalLabels,
} from '../services/packingPlanLabelGenerator';
import { generateProductLabelsPdf } from '../services/productLabelGenerator';
import { shouldIncludeProductLabel } from '../services/utils';
import { reformatLabelsTo4x6Vertical } from '../services/labelFormatter';
import { groupPhysicalItemsByBrand } from '../services/brandLabelUtils';
import { useToast } from '../contexts/ToastContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandLabelResult {
  stickerPdfBytes: Uint8Array | null;
  stickerCount: number;
  housePdfBytes: Uint8Array | null;
  houseCount: number;
  house4x6PdfBytes: Uint8Array | null;
  house4x6Count: number;
  combinedVerticalPdfBytes: Uint8Array | null;
  combinedVerticalCount: number;
  productLabel96PdfBytes: Uint8Array | null;
  productLabel50PdfBytes: Uint8Array | null;
  productLabelCount: number;
  mrpPdfBytes: Uint8Array | null;
  mrpCount: number;
  skippedProducts: Array<{ Product: string; ASIN: string; 'Packet used': string; Reason: string }>;
}

interface BrandState {
  isGenerating: boolean;
  result: BrandLabelResult | null;
}

export interface BrandWiseLabelsProps {
  physicalItems: PhysicalItem[];
  masterData: MasterProduct[];
  nutritionData: NutritionData[];
  show4x6Vertical: boolean;
  showMrpOnlyLabels: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downloadPdf(pdfBytes: Uint8Array, filename: string) {
  const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function safeName(brand: string) {
  return brand.replace(/[^a-z0-9]/gi, '_');
}

const today = new Date().toISOString().split('T')[0];

// ─── Component ────────────────────────────────────────────────────────────────

const BrandWiseLabels: React.FC<BrandWiseLabelsProps> = ({
  physicalItems,
  masterData,
  nutritionData,
  show4x6Vertical,
  showMrpOnlyLabels,
}) => {
  const { showSuccess, showError } = useToast();

  const [brandStates, setBrandStates] = useState<Map<string, BrandState>>(new Map());
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);

  // Recompute brand groups when data changes; also reset states
  const brandGroups = useMemo(
    () => groupPhysicalItemsByBrand(physicalItems, masterData),
    [physicalItems, masterData]
  );

  // Reset all brand states when physical items change (new processing run)
  useEffect(() => {
    setBrandStates(new Map());
    setExpandedBrands(new Set());
  }, [physicalItems]);

  // ─── Generate labels for a single brand ───────────────────────────────────
  const generateBrand = useCallback(
    async (brand: string): Promise<void> => {
      const brandItems = brandGroups.get(brand);
      if (!brandItems || brandItems.length === 0) return;

      setBrandStates((prev) => {
        const next = new Map(prev);
        next.set(brand, { isGenerating: true, result: null });
        return next;
      });

      try {
        // 1. Sticker + House
        const labelResult = await generateLabelsByPacketUsed(brandItems, masterData, nutritionData);

        // 2. House → 4×6 vertical
        let house4x6Bytes: Uint8Array | null = null;
        let house4x6Count = 0;
        if (labelResult.housePdfBytes && labelResult.houseCount > 0) {
          try {
            house4x6Bytes = await reformatLabelsTo4x6Vertical(labelResult.housePdfBytes);
            const srcPdf = await PDFDocument.load(labelResult.housePdfBytes);
            house4x6Count = Math.ceil(srcPdf.getPageCount() / 3);
          } catch { /* non-critical */ }
        }

        // 3. Combined vertical sticker
        const { combinedVerticalPdfBytes, combinedVerticalCount } =
          await generateCombinedVerticalLabels(brandItems, masterData);

        // 4. Product labels
        const stickerHouseItems = brandItems.filter((item) =>
          ['sticker', 'house'].includes(String(item['Packet used'] || '').trim().toLowerCase())
        );
        const productList: string[] = [];
        for (const row of stickerHouseItems) {
          const name = row.item_name_for_labels || row.item || '';
          if (!name || name.toLowerCase() === 'nan') continue;
          if (shouldIncludeProductLabel(name, masterData, row)) {
            productList.push(...Array(row.Qty || 1).fill(name));
          }
        }
        let productLabel96: Uint8Array | null = null;
        let productLabel50: Uint8Array | null = null;
        if (productList.length > 0) {
          [productLabel96, productLabel50] = await Promise.all([
            generateProductLabelsPdf(productList, false, '96x25mm'),
            generateProductLabelsPdf(productList, false, '50x25mm'),
          ]);
        }

        // 5. MRP-only
        const { mrpPdfBytes, mrpCount } = await generateMRPOnlyLabels(brandItems, masterData);

        const result: BrandLabelResult = {
          stickerPdfBytes: labelResult.stickerPdfBytes,
          stickerCount: labelResult.stickerCount,
          housePdfBytes: labelResult.housePdfBytes,
          houseCount: labelResult.houseCount,
          house4x6PdfBytes: house4x6Bytes,
          house4x6Count,
          combinedVerticalPdfBytes,
          combinedVerticalCount,
          productLabel96PdfBytes: productLabel96,
          productLabel50PdfBytes: productLabel50,
          productLabelCount: productList.length,
          mrpPdfBytes,
          mrpCount,
          skippedProducts: labelResult.skippedProducts,
        };

        setBrandStates((prev) => {
          const next = new Map(prev);
          next.set(brand, { isGenerating: false, result });
          return next;
        });
        setExpandedBrands((prev) => new Set([...prev, brand]));
        showSuccess('Labels generated', `${brand}: labels ready`);
      } catch (error: any) {
        setBrandStates((prev) => {
          const next = new Map(prev);
          next.set(brand, { isGenerating: false, result: null });
          return next;
        });
        showError('Generation failed', `${brand}: ${error.message || error}`);
      }
    },
    [brandGroups, masterData, nutritionData, showSuccess, showError]
  );

  // ─── Generate all brands sequentially ────────────────────────────────────
  const handleGenerateAll = useCallback(async () => {
    setIsGeneratingAll(true);
    for (const brand of brandGroups.keys()) {
      await generateBrand(brand);
    }
    setIsGeneratingAll(false);
  }, [brandGroups, generateBrand]);

  const toggleExpand = (brand: string) => {
    setExpandedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  if (brandGroups.size === 0) return null;

  const anyGenerating = isGeneratingAll || [...brandStates.values()].some((s) => s.isGenerating);

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-bold text-gray-800 uppercase tracking-wide">
            Brand-wise Labels
          </p>
          <p className="text-xs font-medium text-gray-500 mt-0.5">
            {brandGroups.size} brand{brandGroups.size !== 1 ? 's' : ''} detected from master sheet
          </p>
        </div>
        {!anyGenerating && (
          <button
            onClick={handleGenerateAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-md hover:bg-gray-700 transition-colors"
          >
            <Tag className="h-3.5 w-3.5" /> Generate All Brands
          </button>
        )}
        {anyGenerating && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating brands…
          </div>
        )}
      </div>

      {/* Brand cards */}
      <div className="space-y-2">
        {Array.from(brandGroups.entries()).map(([brand, items]) => {
          const state = brandStates.get(brand);
          const isGenerating = state?.isGenerating ?? false;
          const result = state?.result ?? null;
          const isExpanded = expandedBrands.has(brand);
          const sn = safeName(brand);

          return (
            <div key={brand} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {/* Brand header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-100">
                <button
                  onClick={() => toggleExpand(brand)}
                  className="flex items-center gap-2 text-sm font-bold text-gray-900 hover:text-gray-700 transition-colors"
                >
                  {isExpanded
                    ? <ChevronUp className="h-4 w-4 text-gray-600" />
                    : <ChevronDown className="h-4 w-4 text-gray-600" />
                  }
                  {brand}
                  <span className="text-xs font-semibold text-gray-500">
                    {items.length} item{items.length !== 1 ? 's' : ''}
                  </span>
                  {result && (
                    <span className="text-xs font-semibold text-green-700">✓ Done</span>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  {isGenerating && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…
                    </div>
                  )}
                  {!isGenerating && !result && (
                    <button
                      onClick={() => generateBrand(brand)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 transition-colors"
                    >
                      <Tag className="h-3.5 w-3.5" /> Generate
                    </button>
                  )}
                  {!isGenerating && result && (
                    <button
                      onClick={() => generateBrand(brand)}
                      title="Re-generate"
                      className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                    >
                      ↻ Regenerate
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded label rows */}
              {isExpanded && result && (
                <div>
                  {/* Sticker */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Sticker Labels</p>
                      <p className="text-xs font-medium text-gray-500">48×25mm combined</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.stickerCount > 0 && (
                        <span className="text-sm font-bold text-blue-600 w-6 text-right">{result.stickerCount}</span>
                      )}
                      {result.stickerPdfBytes && result.stickerCount > 0 ? (
                        <DownloadButton
                          onDownload={() => downloadPdf(result.stickerPdfBytes!, `${sn}_Sticker_Labels_${today}.pdf`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </DownloadButton>
                      ) : (
                        <span className="text-xs font-medium text-gray-500">None</span>
                      )}
                    </div>
                  </div>

                  {/* House */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">House Labels</p>
                      <p className="text-xs font-medium text-gray-500">50×100mm triple</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.houseCount > 0 && (
                        <span className="text-sm font-bold text-green-600 w-6 text-right">{result.houseCount}</span>
                      )}
                      {result.housePdfBytes && result.houseCount > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <DownloadButton
                            onDownload={() => downloadPdf(result.housePdfBytes!, `${sn}_House_Labels_${today}.pdf`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </DownloadButton>
                          {show4x6Vertical && result.house4x6PdfBytes && result.house4x6Count > 0 && (
                            <DownloadButton
                              onDownload={() => downloadPdf(result.house4x6PdfBytes!, `${sn}_House_4x6_Vertical_${today}.pdf`)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700 transition-colors"
                              title="4×6 inch format, 3 labels per page"
                            >
                              <Download className="h-3.5 w-3.5" /> 4×6 Vertical
                            </DownloadButton>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-gray-500">None</span>
                      )}
                    </div>
                  </div>

                  {/* Combined Vertical */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Combined Vertical Sticker</p>
                      <p className="text-xs font-medium text-gray-500">MRP (50×25mm) + Barcode (50×25mm)</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.combinedVerticalCount > 0 && (
                        <span className="text-sm font-bold text-orange-600 w-6 text-right">{result.combinedVerticalCount}</span>
                      )}
                      {result.combinedVerticalPdfBytes && result.combinedVerticalCount > 0 ? (
                        <DownloadButton
                          onDownload={() => downloadPdf(result.combinedVerticalPdfBytes!, `${sn}_Combined_Vertical_${today}.pdf`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-md hover:bg-orange-700 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </DownloadButton>
                      ) : (
                        <span className="text-xs font-medium text-gray-500">None</span>
                      )}
                    </div>
                  </div>

                  {/* Product Labels */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Product Labels</p>
                      <p className="text-xs font-medium text-gray-500">96×25mm · 50×25mm</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.productLabelCount > 0 && (
                        <span className="text-sm font-bold text-indigo-600 w-6 text-right">{result.productLabelCount}</span>
                      )}
                      {result.productLabel96PdfBytes && result.productLabelCount > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <DownloadButton
                            onDownload={() => downloadPdf(result.productLabel96PdfBytes!, `${sn}_Product_Labels_96x25_${today}.pdf`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" /> 96×25mm
                          </DownloadButton>
                          {result.productLabel50PdfBytes && (
                            <DownloadButton
                              onDownload={() => downloadPdf(result.productLabel50PdfBytes!, `${sn}_Product_Labels_50x25_${today}.pdf`)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 text-white text-xs font-medium rounded-md hover:bg-indigo-600 transition-colors"
                            >
                              <Download className="h-3.5 w-3.5" /> 50×25mm
                            </DownloadButton>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-gray-500">None</span>
                      )}
                    </div>
                  </div>

                  {/* MRP-Only */}
                  {showMrpOnlyLabels && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">MRP-Only Labels</p>
                        <p className="text-xs font-medium text-gray-500">48×25mm · products without FNSKU</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {result.mrpCount > 0 && (
                          <span className="text-sm font-bold text-purple-600 w-6 text-right">{result.mrpCount}</span>
                        )}
                        {result.mrpPdfBytes && result.mrpCount > 0 ? (
                          <DownloadButton
                            onDownload={() => downloadPdf(result.mrpPdfBytes!, `${sn}_MRP_Only_Labels_${today}.pdf`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-md hover:bg-purple-700 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </DownloadButton>
                        ) : result.mrpPdfBytes && result.mrpCount === 0 ? (
                          <span className="text-xs text-gray-400">No items without FNSKU</span>
                        ) : (
                          <span className="text-xs font-medium text-gray-500">None</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Skipped products */}
                  {result.skippedProducts.length > 0 && (
                    <details className="border-t border-gray-100">
                      <summary className="cursor-pointer flex items-center gap-1.5 px-4 py-2 bg-amber-50 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {result.skippedProducts.length} product{result.skippedProducts.length !== 1 ? 's' : ''} skipped
                      </summary>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-xs divide-y divide-gray-100">
                          <thead className="bg-gray-50">
                            <tr>
                              {['Product', 'ASIN', 'Packet used', 'Reason'].map((h) => (
                                <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {result.skippedProducts.map((item, idx) => (
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
                </div>
              )}

              {/* Expanded but not yet generated */}
              {isExpanded && !result && !isGenerating && (
                <div className="px-4 py-4 border-t border-gray-100 text-xs font-medium text-gray-500 text-center">
                  Click Generate to create labels for <strong className="text-gray-700">{brand}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BrandWiseLabels;
