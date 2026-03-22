import React from 'react';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Cloud, Database, WifiOff } from 'lucide-react';

interface ConnectionStatus {
  connected: boolean;
  productCount: number;
  lastSync: Date | null;
  dataSource: 'google-sheets' | 'cache' | 'local' | 'unknown';
  error?: string | null;
}

interface DashboardHeaderProps {
  connectionStatus: ConnectionStatus;
  onRefresh?: () => void;
  isLoading?: boolean;
  pageTitle?: string;
  pageSubtitle?: string;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  connectionStatus,
  onRefresh,
  isLoading = false,
  pageTitle = 'Dashboard',
  pageSubtitle,
}) => {
  const formatLastSync = (date: Date | null): string => {
    if (!date) return 'Never synced';
    const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const statusConfig = connectionStatus.error
    ? { icon: XCircle,      color: 'text-red-500',    bg: 'bg-red-50',    border: 'border-red-200',    label: 'Error' }
    : connectionStatus.dataSource === 'cache'
    ? { icon: WifiOff,      color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200',  label: 'Cached' }
    : connectionStatus.connected
    ? { icon: CheckCircle,  color: 'text-green-500',  bg: 'bg-green-50',  border: 'border-green-200',  label: 'Connected' }
    : { icon: AlertCircle,  color: 'text-yellow-500', bg: 'bg-yellow-50', border: 'border-yellow-200', label: 'Offline' };

  const StatusIcon = statusConfig.icon;

  return (
    <header className="bg-white border-b border-gray-200 shrink-0">
      <div className="px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        {/* Page title */}
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-semibold text-gray-900 truncate">{pageTitle}</h1>
            {pageSubtitle && (
              <span className="text-xs text-gray-400 hidden sm:block truncate">{pageSubtitle}</span>
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Status chip */}
          <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${statusConfig.bg} ${statusConfig.border} ${statusConfig.color}`}>
            <StatusIcon className="h-3.5 w-3.5" />
            <span>{statusConfig.label}</span>
          </div>

          {/* Product count */}
          {connectionStatus.connected && (
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-600">
              {connectionStatus.dataSource === 'google-sheets'
                ? <Cloud className="h-3 w-3 text-blue-400" />
                : connectionStatus.dataSource === 'cache'
                ? <WifiOff className="h-3 w-3 text-amber-400" />
                : <Database className="h-3 w-3 text-gray-400" />
              }
              <span className="font-medium text-gray-800">{connectionStatus.productCount}</span>
              <span>{connectionStatus.dataSource === 'cache' ? 'cached' : 'products'}</span>
            </div>
          )}

          {/* Last sync */}
          {connectionStatus.lastSync && (
            <span className="hidden lg:block text-xs text-gray-400">
              {formatLastSync(connectionStatus.lastSync)}
            </span>
          )}

          {/* Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh data"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {connectionStatus.error && (
        <div className="px-4 sm:px-6 lg:px-8 py-2 bg-red-50 border-t border-red-200">
          <div className="flex items-center gap-2">
            <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
            <span className="text-xs text-red-700">{connectionStatus.error}</span>
          </div>
        </div>
      )}
    </header>
  );
};

export default DashboardHeader;
export type { ConnectionStatus };
