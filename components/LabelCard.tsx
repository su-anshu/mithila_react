import React, { useState } from 'react';
import { FileDown, Loader2, CheckCircle, Printer } from 'lucide-react';

interface LabelCardProps {
  title: string;
  description: string;
  onDownload: () => void;
  onPrint?: () => void;
  isLoading?: boolean;
  isPrinting?: boolean;
  isDisabled?: boolean;
}

const LabelCard: React.FC<LabelCardProps> = ({
  title,
  description,
  onDownload,
  onPrint,
  isLoading = false,
  isPrinting = false,
  isDisabled = false
}) => {
  const [downloaded, setDownloaded] = useState(false);

  const handleClick = () => {
    onDownload();
    if (!isLoading) setDownloaded(true);
  };

  const busy = isLoading || isPrinting;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col justify-between hover:shadow-md transition-shadow">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-1.5">{title}</h3>
        <p className="text-xs text-gray-500 mb-4">{description}</p>
      </div>
      <div className="space-y-1.5">
        {/* Download button */}
        <button
          onClick={handleClick}
          disabled={isDisabled || busy}
          className={`flex items-center justify-center w-full px-4 py-2 rounded-md font-medium text-white text-sm transition-colors
            ${isDisabled || busy
              ? 'bg-gray-300 cursor-not-allowed'
              : downloaded
              ? 'bg-green-600 hover:bg-green-700 active:bg-green-800'
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
            }`}
        >
          {isLoading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
          ) : downloaded ? (
            <><CheckCircle className="w-4 h-4 mr-2" />Downloaded</>
          ) : (
            <><FileDown className="w-4 h-4 mr-2" />Download PDF</>
          )}
        </button>

        {/* Print button */}
        {onPrint && (
          <button
            onClick={onPrint}
            disabled={isDisabled || busy}
            className="flex items-center justify-center w-full px-4 py-2 rounded-md font-medium text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed gap-2"
          >
            {isPrinting ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Preparing...</>
            ) : (
              <><Printer className="w-4 h-4" />Print</>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default LabelCard;