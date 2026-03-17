import React, { useCallback } from 'react';
import { MasterProduct, NutritionData } from '../../types';
import ProductSelector from '../ProductSelector';
import LabelCard from '../LabelCard';
import { AlertCircle, Package } from 'lucide-react';
import {
  generateMRPLabel,
  generateBarcodeLabel,
  generateCombinedLabelHorizontal,
  generateTripleLabel
} from '../../services/pdfGenerator';
import { create4x6VerticalFromSingleLabel } from '../../services/labelFormatter';
import { useToast } from '../../contexts/ToastContext';
import EmptyState from '../EmptyState';
import SkeletonCard from '../SkeletonCard';

interface LabelGeneratorViewProps {
  masterData: MasterProduct[];
  nutritionData: NutritionData[];
  selectedProductName: string;
  selectedWeight: string;
  onProductChange: (product: string) => void;
  onWeightChange: (weight: string) => void;
  isLoadingData: boolean;
  error: string | null;
  generatingLabel: string | null;
  setGeneratingLabel: (label: string | null) => void;
}

const LabelGeneratorView: React.FC<LabelGeneratorViewProps> = ({
  masterData,
  nutritionData,
  selectedProductName,
  selectedWeight,
  onProductChange,
  onWeightChange,
  isLoadingData,
  error,
  generatingLabel,
  setGeneratingLabel,
}) => {
  const { showSuccess, showError } = useToast();

  const getSelectedProductData = useCallback(() => {
    return masterData.find(
      p => p.Name === selectedProductName && p["Net Weight"] === selectedWeight
    );
  }, [masterData, selectedProductName, selectedWeight]);

  const handleDownload = async (type: string, generatorFn: () => any | Promise<any>) => {
    setGeneratingLabel(type);
    try {
      // Small delay to allow UI to update to loading state
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await Promise.resolve(generatorFn());
      const product = getSelectedProductData();
      const filename = `${product?.Name?.replace(/[^a-z0-9]/gi, '_')}_${type}.pdf`;
      
      // Handle both jsPDF and Uint8Array results
      if (result instanceof Uint8Array) {
        // For Uint8Array (from formatter), create blob and download
        const blob = new Blob([result], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        // For jsPDF, use save method
        result.save(filename);
      }
      
      showSuccess('Label generated', `${type} label downloaded successfully`);
    } catch (e) {
      console.error(e);
      showError('Generation failed', `Error generating ${type} label`);
    } finally {
      setGeneratingLabel(null);
    }
  };

  const selectedProduct = getSelectedProductData();
  const hasFnsku = !!selectedProduct?.FNSKU;
  const nutritionRow = nutritionData.find(n => n.Product === selectedProductName);
  const canGenerateTriple = !!(selectedProduct && nutritionRow && hasFnsku);

  return (
    <div className="w-full">
      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-md shadow-sm">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-500 mr-3" />
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Product Selector */}
      <ProductSelector
        products={masterData}
        selectedProduct={selectedProductName}
        selectedWeight={selectedWeight}
        onProductChange={onProductChange}
        onWeightChange={onWeightChange}
        isLoading={isLoadingData}
      />

      {/* Action Area */}
      {isLoadingData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : selectedProduct ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fadeIn">
          <LabelCard
            title="MRP Label"
            description="Standard 48x25mm label with MRP, Dates, and Batch Code."
            isLoading={generatingLabel === 'mrp'}
            onDownload={() => handleDownload('mrp', () => generateMRPLabel(selectedProduct))}
          />

          <LabelCard
            title="Barcode Label"
            description="Standard 48x25mm FNSKU barcode label."
            isDisabled={!hasFnsku}
            isLoading={generatingLabel === 'barcode'}
            onDownload={() => handleDownload('barcode', () => generateBarcodeLabel(selectedProduct.FNSKU!))}
          />

          <LabelCard
            title="Combined Sticker"
            description="Horizontal 96x25mm label combining MRP details and Barcode side-by-side."
            isDisabled={!hasFnsku}
            isLoading={generatingLabel === 'combined'}
            onDownload={() => handleDownload('combined', () => generateCombinedLabelHorizontal(selectedProduct))}
          />

          <LabelCard
            title="Triple Label"
            description="Vertical 50x100mm House label with Ingredients, Nutrition, and MRP/Barcode."
            isDisabled={!canGenerateTriple}
            isLoading={generatingLabel === 'triple'}
            onDownload={async () => {
              if(nutritionRow) {
                await handleDownload('triple', async () => await generateTripleLabel(selectedProduct, nutritionRow));
              }
            }}
          />
        </div>
      ) : (
        !isLoadingData && (
          <EmptyState
            variant="no-data"
            title="No product selected"
            description="Select a product and weight from the dropdown above to generate labels"
          />
        )
      )}
      
      {/* 4x6 Format Option - Only show when triple label can be generated */}
      {!isLoadingData && selectedProduct && canGenerateTriple && (
        <div className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fadeIn">
            <LabelCard
              title="House in 4x6 inch (Vertical)"
              description="4×6 inch format with 3 copies of House label, rotated 90° and stacked vertically."
              isDisabled={!canGenerateTriple}
              isLoading={generatingLabel === 'house_4x6'}
              onDownload={async () => {
                if(nutritionRow) {
                  await handleDownload('house_4x6', async () => {
                    // Generate triple label first
                    const triplePdf = await generateTripleLabel(selectedProduct, nutritionRow);
                    // Convert to Uint8Array
                    const tripleBytes = triplePdf.output('arraybuffer');
                    // Convert to 4x6 format
                    return create4x6VerticalFromSingleLabel(new Uint8Array(tripleBytes));
                  });
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default LabelGeneratorView;

