import React from 'react';
import { Database, Edit3 } from 'lucide-react';

interface ModeToggleProps {
  mode: 'sheet' | 'custom';
  onModeChange: (mode: 'sheet' | 'custom') => void;
}

const ModeToggle: React.FC<ModeToggleProps> = ({ mode, onModeChange }) => {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={() => onModeChange('sheet')}
        className={`p-4 border-2 rounded-lg transition-all text-left ${
          mode === 'sheet'
            ? 'border-blue-500 bg-blue-50 shadow-md'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-md ${mode === 'sheet' ? 'bg-blue-100' : 'bg-gray-100'}`}>
            <Database className={`h-5 w-5 ${mode === 'sheet' ? 'text-blue-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className={`font-semibold ${mode === 'sheet' ? 'text-blue-900' : 'text-gray-700'}`}>
              Product from Sheet
            </p>
            <p className={`text-xs ${mode === 'sheet' ? 'text-blue-600' : 'text-gray-500'}`}>
              Select from master data
            </p>
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => onModeChange('custom')}
        className={`p-4 border-2 rounded-lg transition-all text-left ${
          mode === 'custom'
            ? 'border-blue-500 bg-blue-50 shadow-md'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-md ${mode === 'custom' ? 'bg-blue-100' : 'bg-gray-100'}`}>
            <Edit3 className={`h-5 w-5 ${mode === 'custom' ? 'text-blue-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className={`font-semibold ${mode === 'custom' ? 'text-blue-900' : 'text-gray-700'}`}>
              Custom Text
            </p>
            <p className={`text-xs ${mode === 'custom' ? 'text-blue-600' : 'text-gray-500'}`}>
              Enter any text
            </p>
          </div>
        </div>
      </button>
    </div>
  );
};

export default ModeToggle;

