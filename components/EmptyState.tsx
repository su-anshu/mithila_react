import React, { ReactNode } from 'react';
import { Package, FileText, Search, AlertCircle, Inbox } from 'lucide-react';

export type EmptyStateVariant = 'no-data' | 'no-results' | 'error' | 'empty';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  variant = 'no-data',
  icon,
  title,
  description,
  action,
  className = ''
}) => {
  const getDefaultIcon = () => {
    if (icon) return icon;
    
    switch (variant) {
      case 'no-data':
        return <Inbox className="h-12 w-12 text-gray-400" />;
      case 'no-results':
        return <Search className="h-12 w-12 text-gray-400" />;
      case 'error':
        return <AlertCircle className="h-12 w-12 text-red-400" />;
      case 'empty':
        return <Package className="h-12 w-12 text-gray-400" />;
    }
  };

  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 ${className}`}>
      <div className="mb-4">
        {getDefaultIcon()}
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 text-center max-w-sm mb-6">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;

