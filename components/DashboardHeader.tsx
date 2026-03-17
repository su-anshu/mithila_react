import React from 'react';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Database, Cloud } from 'lucide-react';

interface ConnectionStatus {
  connected: boolean;
  productCount: number;
  lastSync: Date | null;
  dataSource: 'google-sheets' | 'local' | 'unknown';
  error?: string | null;
}

interface DashboardHeaderProps {
  connectionStatus: ConnectionStatus;
  onRefresh?: () => void;
  isLoading?: boolean;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  connectionStatus,
  onRefresh,
  isLoading = false
}) => {
  const formatLastSync = (date: Date | null): string => {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = () => {
    if (connectionStatus.error) {
      return <XCircle className="h-5 w-5 text-red-500" />;
    }
    if (connectionStatus.connected) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    return <AlertCircle className="h-5 w-5 text-yellow-500" />;
  };

  const getStatusText = () => {
    if (connectionStatus.error) {
      return 'Connection Error';
    }
    if (connectionStatus.connected) {
      return 'Connected';
    }
    return 'Disconnected';
  };

  const getStatusColor = () => {
    if (connectionStatus.error) {
      return 'text-red-600';
    }
    if (connectionStatus.connected) {
      return 'text-green-600';
    }
    return 'text-yellow-600';
  };

  const getDataSourceIcon = () => {
    if (connectionStatus.dataSource === 'google-sheets') {
      return <Cloud className="h-4 w-4 text-blue-500" />;
    }
    return <Database className="h-4 w-4 text-gray-500" />;
  };

  const getDataSourceText = () => {
    if (connectionStatus.dataSource === 'google-sheets') {
      return 'Google Sheets';
    }
    if (connectionStatus.dataSource === 'local') {
      return 'Local File';
    }
    return 'Unknown';
  };

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          {/* Left side - Title and Status */}
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Mithila Tools Dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5">Warehouse Management & Label Generation</p>
            </div>
          </div>

          {/* Right side - Status Indicators */}
          <div className="flex items-center gap-6">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <div className="flex flex-col">
                <span className={`text-sm font-medium ${getStatusColor()}`}>
                  {getStatusText()}
                </span>
                {connectionStatus.lastSync && (
                  <span className="text-xs text-gray-500">
                    {formatLastSync(connectionStatus.lastSync)}
                  </span>
                )}
              </div>
            </div>

            {/* Product Count */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-md">
              <span className="text-sm text-gray-600">Products:</span>
              <span className="text-sm font-semibold text-gray-900">
                {connectionStatus.productCount.toLocaleString()}
              </span>
            </div>

            {/* Data Source */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-md">
              {getDataSourceIcon()}
              <span className="text-sm text-gray-600">{getDataSourceText()}</span>
            </div>

            {/* Refresh Button */}
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh data"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="text-sm font-medium">Refresh</span>
              </button>
            )}
          </div>
        </div>

        {/* Error Message */}
        {connectionStatus.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-red-700">{connectionStatus.error}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardHeader;
export type { ConnectionStatus };

