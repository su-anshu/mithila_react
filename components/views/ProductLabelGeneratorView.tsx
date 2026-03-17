import React, { useState, useMemo } from 'react';
import { Download, FileText, Calendar, Package, Loader2, Sparkles, Info } from 'lucide-react';
import { createLabelPdf, LabelSize } from '../../services/productLabelGenerator';
import { MasterProduct } from '../../types';
import { format } from 'date-fns';
import { useToast } from '../../contexts/ToastContext';
import EmptyState from '../EmptyState';
import SkeletonCard from '../SkeletonCard';
import LabelPreview from '../LabelPreview';
import SizeSelector from '../SizeSelector';
import ModeToggle from '../ModeToggle';
import ProductSearchSelect from '../ProductSearchSelect';
import FormField from '../FormField';
import HelpIcon from '../HelpIcon';

interface ProductLabelGeneratorViewProps {
  masterData: MasterProduct[];
}

const ProductLabelGeneratorView: React.FC<ProductLabelGeneratorViewProps> = ({ masterData }) => {
  const { showSuccess, showError } = useToast();
  const [mode, setMode] = useState<'sheet' | 'custom'>('sheet');
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [customText, setCustomText] = useState<string>('');
  const [labelSize, setLabelSize] = useState<LabelSize>('48x25mm');
  const [includeDate, setIncludeDate] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // Extract product names from master data
  const productNames = useMemo(() => {
    if (!masterData || masterData.length === 0) return [];
    
    const names = new Set<string>();
    for (const product of masterData) {
      const name = product.Name;
      if (name && name.trim() && name.trim().toLowerCase() !== 'nan') {
        names.add(name.trim());
      }
    }
    
    return Array.from(names).sort();
  }, [masterData]);

  const displayText = mode === 'sheet' 
    ? (selectedProduct || '')
    : (customText || '');

  const isValidText = displayText && displayText.trim() !== '' && 
    displayText !== 'Select a product' && 
    displayText !== 'Enter text above';

  const handleGenerate = async (withDate: boolean) => {
    const text = mode === 'sheet' ? selectedProduct : customText;
    if (!isValidText) return;

    setIsGenerating(true);
    try {
      const pdf = createLabelPdf(text, labelSize, withDate);
      const pdfBytes = pdf.output('arraybuffer');
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      const safeText = text.replace(/[^\w\-_\.]/g, '_');
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
      const dateSuffix = withDate ? 'with_date' : 'no_date';
      const filename = `${safeText}_${labelSize}_${dateSuffix}_${timestamp}.pdf`;
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showSuccess('Label generated', `PDF downloaded successfully`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      showError('Generation failed', 'Failed to generate PDF. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const currentDate = format(new Date(), 'dd/MM/yyyy');
  const maxCustomTextLength = 100;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Sparkles className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Product Label Generator</h2>
            <p className="text-gray-600 mt-1">Generate product name labels with optional date</p>
          </div>
        </div>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Form Controls */}
        <div className="lg:col-span-2 space-y-6">
          {/* Mode Selection */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <label className="text-sm font-semibold text-gray-700">Input Mode</label>
              <HelpIcon content="Choose to select a product from your master data or enter custom text" />
            </div>
            <ModeToggle mode={mode} onModeChange={setMode} />
          </div>

          {/* Product Selection or Custom Text */}
          {mode === 'sheet' ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <FormField
                label="Select Product"
                helpText={`${productNames.length} products available`}
                required
              >
                {productNames.length > 0 ? (
                  <ProductSearchSelect
                    products={productNames}
                    selectedProduct={selectedProduct}
                    onSelect={setSelectedProduct}
                    placeholder="-- Select a product --"
                  />
                ) : (
                  <EmptyState
                    variant="no-data"
                    title="No products found"
                    description="No products available in master data. Please ensure master data is loaded."
                    icon={<Package className="h-12 w-12 text-gray-400" />}
                  />
                )}
              </FormField>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <FormField
                label="Enter Custom Text"
                helpText={`Enter any text for the label (max ${maxCustomTextLength} characters)`}
                required
              >
                <div className="relative">
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => {
                      const value = e.target.value.slice(0, maxCustomTextLength);
                      setCustomText(value);
                    }}
                    placeholder="e.g., Product Name, Custom Label..."
                    className="w-full border border-gray-300 rounded-md shadow-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    maxLength={maxCustomTextLength}
                  />
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                    <span className="text-xs text-gray-400">
                      {customText.length}/{maxCustomTextLength}
                    </span>
                  </div>
                </div>
              </FormField>
            </div>
          )}

          {/* Label Size Selection */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <label className="text-sm font-semibold text-gray-700">Label Size</label>
              <HelpIcon content="Select the dimensions for your label. The preview will update automatically." />
            </div>
            <SizeSelector selectedSize={labelSize} onSelect={setLabelSize} />
          </div>

          {/* Date Toggle */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-600" />
                <div>
                  <label className="text-sm font-semibold text-gray-700 block">Include Date</label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {includeDate ? `Current date: ${currentDate}` : 'No date will be included'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIncludeDate(!includeDate)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  includeDate ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    includeDate ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Generate Buttons */}
          {isValidText && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Generate Labels</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => handleGenerate(true)}
                  disabled={isGenerating}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium transition-colors shadow-sm hover:shadow-md"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="animate-spin h-5 w-5" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-5 w-5" />
                      <span>Download with Date</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleGenerate(false)}
                  disabled={isGenerating}
                  className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium transition-colors shadow-sm hover:shadow-md"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="animate-spin h-5 w-5" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <FileText className="h-5 w-5" />
                      <span>Download without Date</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Labels will be generated as PDF files and downloaded automatically
              </p>
            </div>
          )}
        </div>

        {/* Right Column - Preview */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-6">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Preview</h3>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                Live
              </span>
            </div>
            
            {isValidText ? (
              <div className="space-y-4">
                <LabelPreview
                  productName={displayText}
                  labelSize={labelSize}
                  includeDate={includeDate}
                  showBoth={false}
                />
                <div className="pt-4 border-t border-gray-200">
                  <div className="text-xs text-gray-500 space-y-1">
                    <p className="font-medium text-gray-700">Label Details:</p>
                    <p>• Size: {labelSize}</p>
                    <p>• Date: {includeDate ? currentDate : 'Not included'}</p>
                    <p>• Text: {displayText.length > 30 ? `${displayText.slice(0, 30)}...` : displayText}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-gray-300 mb-3" />
                <p className="text-sm text-gray-500 text-center">
                  {mode === 'sheet' 
                    ? 'Select a product to see preview'
                    : 'Enter text above to see preview'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Empty State when no valid input */}
      {!isValidText && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <EmptyState
            variant="no-data"
            title="No product or text selected"
            description={
              mode === 'sheet'
                ? "Please select a product from the dropdown above to generate a label"
                : "Please enter custom text above to generate a label"
            }
            icon={<Package className="h-12 w-12 text-gray-400" />}
          />
        </div>
      )}
    </div>
  );
};

export default ProductLabelGeneratorView;
