import React from 'react';
import { Ruler, Check } from 'lucide-react';
import { LabelSize } from '../services/productLabelGenerator';
import Tooltip from './Tooltip';

interface SizeSelectorProps {
  selectedSize: LabelSize;
  onSelect: (size: LabelSize) => void;
}

const sizeInfo: Record<LabelSize, { label: string; dimensions: string; description: string; isVertical: boolean }> = {
  '48x25mm': {
    label: '48×25mm',
    dimensions: '48×25mm',
    description: 'Standard horizontal label',
    isVertical: false
  },
  '96x25mm': {
    label: '96×25mm',
    dimensions: '96×25mm',
    description: 'Wide horizontal label (2 labels per page)',
    isVertical: false
  },
  '50x100mm': {
    label: '50×100mm',
    dimensions: '50×100mm',
    description: 'Vertical label',
    isVertical: true
  },
  '100x50mm': {
    label: '100×50mm',
    dimensions: '100×50mm',
    description: 'Large horizontal label',
    isVertical: false
  }
};

const SizeSelector: React.FC<SizeSelectorProps> = ({ selectedSize, onSelect }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {(Object.keys(sizeInfo) as LabelSize[]).map((size) => {
        const info = sizeInfo[size];
        const isSelected = selectedSize === size;
        
        return (
          <Tooltip key={size} content={info.description} position="top">
            <button
              type="button"
              onClick={() => onSelect(size)}
              className={`relative p-4 border-2 rounded-lg transition-all cursor-pointer ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              {/* Visual representation */}
              <div className="flex flex-col items-center space-y-2">
                <Ruler className={`h-5 w-5 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                <div
                  className={`border-2 ${
                    isSelected ? 'border-blue-500 bg-blue-100' : 'border-gray-300 bg-gray-50'
                  } rounded`}
                  style={{
                    width: info.isVertical ? '30px' : '50px',
                    height: info.isVertical ? '50px' : '30px'
                  }}
                />
                <div className="text-center">
                  <p className={`text-sm font-semibold ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
                    {info.label}
                  </p>
                  <p className={`text-xs ${isSelected ? 'text-blue-600' : 'text-gray-500'}`}>
                    {info.isVertical ? 'Portrait' : 'Landscape'}
                  </p>
                </div>
              </div>
              
              {/* Checkmark for selected */}
              {isSelected && (
                <div className="absolute top-2 right-2 bg-blue-500 rounded-full p-1">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};

export default SizeSelector;

