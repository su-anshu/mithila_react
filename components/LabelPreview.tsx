import React from 'react';
import { Calendar, Package } from 'lucide-react';
import { LabelSize } from '../services/productLabelGenerator';
import { format } from 'date-fns';

interface LabelPreviewProps {
  productName: string;
  labelSize: LabelSize;
  includeDate: boolean;
  showBoth?: boolean;
}

const LabelPreview: React.FC<LabelPreviewProps> = ({
  productName,
  labelSize,
  includeDate,
  showBoth = false
}) => {
  const currentDate = format(new Date(), 'dd/MM/yyyy');
  
  // Calculate aspect ratio and dimensions for preview
  const getLabelDimensions = (size: LabelSize) => {
    switch (size) {
      case '48x25mm':
        return { width: 192, height: 100, isVertical: false }; // 4:1 ratio scaled
      case '96x25mm':
        return { width: 384, height: 100, isVertical: false }; // 4:1 ratio scaled
      case '50x100mm':
        return { width: 100, height: 200, isVertical: true }; // 1:2 ratio scaled
      case '100x50mm':
        return { width: 200, height: 100, isVertical: false }; // 2:1 ratio scaled
      default:
        return { width: 192, height: 100, isVertical: false };
    }
  };

  const dimensions = getLabelDimensions(labelSize);
  const displayText = productName || 'Product Name';
  const hasValidText = productName && productName !== 'Select a product' && productName !== 'Enter text above';

  const renderLabel = (withDate: boolean) => (
    <div
      className={`bg-white border-2 border-gray-300 rounded-md shadow-sm flex flex-col items-center justify-center relative overflow-hidden ${
        dimensions.isVertical ? 'p-4' : 'p-3'
      }`}
      style={{
        width: `${Math.min(dimensions.width, 300)}px`,
        height: `${Math.min(dimensions.height, 200)}px`,
        maxWidth: '100%',
        aspectRatio: `${dimensions.width} / ${dimensions.height}`
      }}
    >
      {/* Label content */}
      <div className={`flex flex-col items-center justify-center text-center ${dimensions.isVertical ? 'space-y-2' : 'space-y-1'}`}>
        <div className="flex items-center justify-center mb-1">
          <Package className={`${dimensions.isVertical ? 'h-4 w-4' : 'h-3 w-3'} text-gray-400 mr-1`} />
          <span className={`font-bold text-gray-900 break-words ${dimensions.isVertical ? 'text-sm' : 'text-xs'}`}>
            {displayText}
          </span>
        </div>
        {withDate && (
          <div className="flex items-center justify-center">
            <Calendar className={`${dimensions.isVertical ? 'h-3 w-3' : 'h-2 w-2'} text-gray-400 mr-1`} />
            <span className={`font-semibold text-gray-700 ${dimensions.isVertical ? 'text-xs' : 'text-[10px]'}`}>
              {currentDate}
            </span>
          </div>
        )}
      </div>
      
      {/* Dimension badge */}
      <div className="absolute top-1 right-1 bg-gray-100 text-gray-600 text-[8px] px-1 py-0.5 rounded">
        {labelSize}
      </div>
    </div>
  );

  if (showBoth && includeDate) {
    return (
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-gray-600">With Date</span>
          </div>
          {renderLabel(true)}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-gray-600">Without Date</span>
          </div>
          {renderLabel(false)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {hasValidText ? (
        renderLabel(includeDate)
      ) : (
        <div
          className={`bg-gray-50 border-2 border-dashed border-gray-300 rounded-md flex flex-col items-center justify-center ${
            dimensions.isVertical ? 'p-4' : 'p-3'
          }`}
          style={{
            width: `${Math.min(dimensions.width, 300)}px`,
            height: `${Math.min(dimensions.height, 200)}px`,
            maxWidth: '100%',
            aspectRatio: `${dimensions.width} / ${dimensions.height}`
          }}
        >
          <Package className="h-6 w-6 text-gray-400 mb-2" />
          <p className="text-xs text-gray-500 text-center">Preview will appear here</p>
        </div>
      )}
    </div>
  );
};

export default LabelPreview;

