import React, { useState, useMemo } from 'react';
import { Download, FileText, Calendar, Package, Loader2, CheckCircle } from 'lucide-react';
import { createLabelPdf, LabelSize } from '../../services/productLabelGenerator';
import { MasterProduct } from '../../types';
import { format } from 'date-fns';
import { useToast } from '../../contexts/ToastContext';
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
  const [downloadedWithDate, setDownloadedWithDate] = useState(false);
  const [downloadedWithoutDate, setDownloadedWithoutDate] = useState(false);
  const [fontSizeMultiplier, setFontSizeMultiplier] = useState(1);

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
      const pdf = createLabelPdf(text, labelSize, withDate, fontSizeMultiplier);
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
      if (withDate) setDownloadedWithDate(true);
      else setDownloadedWithoutDate(true);
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
    <div className="w-full max-w-5xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex flex-col lg:flex-row">

          {/* Left — Controls */}
          <div className="flex-1 min-w-0 divide-y divide-gray-100">

            {/* Mode + Input */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Input</span>
                <ModeToggle mode={mode} onModeChange={setMode} />
              </div>
              {mode === 'sheet' ? (
                productNames.length > 0 ? (
                  <ProductSearchSelect
                    products={productNames}
                    selectedProduct={selectedProduct}
                    onSelect={setSelectedProduct}
                    placeholder="-- Select a product --"
                  />
                ) : (
                  <p className="text-sm text-gray-400">No products in master data</p>
                )
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value.slice(0, maxCustomTextLength))}
                    placeholder="e.g., Product Name, Custom Label..."
                    className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors pr-14"
                    maxLength={maxCustomTextLength}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    {customText.length}/{maxCustomTextLength}
                  </span>
                </div>
              )}
            </div>

            {/* Label Size */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Label Size</span>
                <HelpIcon content="Select the dimensions for your label. The preview will update automatically." />
              </div>
              <SizeSelector selectedSize={labelSize} onSelect={setLabelSize} />
            </div>

            {/* Font Size Toggle */}
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Font Size</span>
              <div className="flex gap-1">
                {([{ label: 'S', val: 0.75 }, { label: 'M', val: 1 }, { label: 'L', val: 1.35 }, { label: 'XL', val: 1.7 }] as const).map(({ label, val }) => (
                  <button
                    key={label}
                    onClick={() => setFontSizeMultiplier(val)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      fontSizeMultiplier === val
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Toggle */}
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Include Date</span>
                <span className="text-xs text-gray-400">
                  {includeDate ? currentDate : 'No date'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIncludeDate(!includeDate)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  includeDate ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  includeDate ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {/* Download Buttons */}
            <div className="p-4">
              {isValidText ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handleGenerate(true)}
                    disabled={isGenerating}
                    className={`text-white px-4 py-2.5 rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium transition-colors ${downloadedWithDate ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {isGenerating ? <Loader2 className="animate-spin h-4 w-4" /> :
                     downloadedWithDate ? <CheckCircle className="h-4 w-4" /> :
                     <Download className="h-4 w-4" />}
                    {isGenerating ? 'Generating…' : downloadedWithDate ? 'Downloaded with Date' : 'With Date'}
                  </button>
                  <button
                    onClick={() => handleGenerate(false)}
                    disabled={isGenerating}
                    className={`text-white px-4 py-2.5 rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium transition-colors ${downloadedWithoutDate ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-800'}`}
                  >
                    {isGenerating ? <Loader2 className="animate-spin h-4 w-4" /> :
                     downloadedWithoutDate ? <CheckCircle className="h-4 w-4" /> :
                     <FileText className="h-4 w-4" />}
                    {isGenerating ? 'Generating…' : downloadedWithoutDate ? 'Downloaded without Date' : 'Without Date'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-1">
                  {mode === 'sheet' ? 'Select a product above to download' : 'Enter text above to download'}
                </p>
              )}
            </div>
          </div>

          {/* Right — Live Preview */}
          <div className="lg:w-72 flex-shrink-0 bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-200 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Preview</h3>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Live</span>
            </div>
            {isValidText ? (
              <div className="space-y-3 flex-1">
                <LabelPreview
                  productName={displayText}
                  labelSize={labelSize}
                  includeDate={includeDate}
                  showBoth={false}
                  fontSizeMultiplier={fontSizeMultiplier}
                />
                <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-gray-200">
                  <div className="flex justify-between"><span className="text-gray-400">Size</span><span className="font-medium text-gray-700">{labelSize}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Date</span><span className="font-medium text-gray-700">{includeDate ? currentDate : '—'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-400 shrink-0">Text</span><span className="font-medium text-gray-700 truncate text-right">{displayText.length > 22 ? `${displayText.slice(0, 22)}…` : displayText}</span></div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
                <Package className="h-10 w-10 text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">
                  {mode === 'sheet' ? 'Select a product to preview' : 'Enter text to preview'}
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default ProductLabelGeneratorView;
