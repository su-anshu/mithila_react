import React from 'react';
import { FileDown, Loader2 } from 'lucide-react';

interface LabelCardProps {
  title: string;
  description: string;
  onDownload: () => void;
  isLoading?: boolean;
  isDisabled?: boolean;
}

const LabelCard: React.FC<LabelCardProps> = ({
  title,
  description,
  onDownload,
  isLoading = false,
  isDisabled = false
}) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{description}</p>
      </div>
      <button
        onClick={onDownload}
        disabled={isDisabled || isLoading}
        className={`flex items-center justify-center w-full px-4 py-2 rounded-md font-medium text-white transition-colors
          ${isDisabled 
            ? 'bg-gray-300 cursor-not-allowed' 
            : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          }`}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <FileDown className="w-4 h-4 mr-2" />
            Download PDF
          </>
        )}
      </button>
    </div>
  );
};

export default LabelCard;