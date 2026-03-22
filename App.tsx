import React, { useEffect, useState } from 'react';
import { fetchMasterData, fetchNutritionData } from './services/dataService';
import { MasterProduct, NutritionData } from './types';
import Sidebar, { ViewType } from './components/Sidebar';
import DashboardHeader, { ConnectionStatus } from './components/DashboardHeader';
import { ToastProvider } from './contexts/ToastContext';
import { DialogProvider } from './contexts/DialogContext';
import { AdminProvider } from './contexts/AdminContext';
import LabelGeneratorView from './components/views/LabelGeneratorView';
import USLabelGeneratorView from './components/views/USLabelGeneratorView';
import ProductLabelGeneratorView from './components/views/ProductLabelGeneratorView';
import AmazonPackingPlanView from './components/views/AmazonPackingPlanView';
import AmazonEasyShipView from './components/views/AmazonEasyShipView';
import FlipkartPackingPlanView from './components/views/FlipkartPackingPlanView';
import FlipkartEasyShipView from './components/views/FlipkartEasyShipView';
import ManualPackingPlanView from './components/views/ManualPackingPlanView';
import PackedUnitStockView from './components/views/PackedUnitStockView';
import AdminView from './components/views/AdminView';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import useKeyboardShortcut from './hooks/useKeyboardShortcut';

const App: React.FC = () => {
  const [masterData, setMasterData] = useState<MasterProduct[]>([]);
  const [nutritionData, setNutritionData] = useState<NutritionData[]>([]);

  const [selectedProductName, setSelectedProductName] = useState<string>("");
  const [selectedWeight, setSelectedWeight] = useState<string>("");

  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [dataSource, setDataSource] = useState<'google-sheets' | 'cache' | 'local' | 'unknown'>('google-sheets');

  const [generatingLabel, setGeneratingLabel] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewType>('label-generator');
  const [showShortcuts, setShowShortcuts] = useState(false);

  useKeyboardShortcut({
    key: '?',
    ctrl: true,
    callback: () => setShowShortcuts(true)
  });

  const loadData = async () => {
    setIsLoadingData(true);
    setError(null);
    try {
      const [masterResult, nutritionResult] = await Promise.all([
        fetchMasterData(),
        fetchNutritionData()
      ]);
      setMasterData(masterResult.data);
      setNutritionData(nutritionResult.data);
      const fromCache = masterResult.fromCache || nutritionResult.fromCache;
      setLastSync(fromCache ? (masterResult.cachedAt ?? new Date()) : new Date());
      setDataSource(fromCache ? 'cache' : 'google-sheets');
      setError(null);
      setIsLoadingData(false);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Failed to load data. No cached data available.";
      setError(errorMessage);
      setDataSource('unknown');
      setIsLoadingData(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadData();
  }, []);

  // Auto-refresh: poll every 5 minutes when online; re-fetch immediately on reconnect
  useEffect(() => {
    const INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(() => {
      if (navigator.onLine) loadData();
    }, INTERVAL_MS);

    const handleOnline = () => loadData();
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const connectionStatus: ConnectionStatus = {
    connected: masterData.length > 0 && !error,
    productCount: masterData.length,
    lastSync,
    dataSource,
    error
  };

  const pageMeta: Record<ViewType, { title: string; subtitle: string }> = {
    'label-generator':        { title: 'Label Generator',        subtitle: 'MRP · Barcode · Combined · House labels' },
    'us-label-generator':     { title: 'US Label Generator',     subtitle: 'FDA-compliant labels for US market' },
    'product-label-generator':{ title: 'Product Label Generator',subtitle: '96×25 mm product name labels' },
    'amazon-packing-plan':    { title: 'Amazon Packing Plan',    subtitle: 'Process invoices and generate packing lists' },
    'amazon-easy-ship':       { title: 'Amazon Easy Ship Report',subtitle: 'Process Easy Ship Excel exports' },
    'flipkart-packing-plan':  { title: 'Flipkart Packing Plan',  subtitle: 'Process Flipkart invoices and labels' },
    'flipkart-easy-ship':     { title: 'Flipkart Easy Ship Report', subtitle: 'Process Flipkart Easy Ship exports' },
    'manual-packing-plan':    { title: 'Manual Packing Plan',    subtitle: 'Create packing plans from file upload' },
    'packed-unit-stock':      { title: 'Packed Unit Stock',      subtitle: 'View and export packed unit inventory' },
    'admin':                  { title: 'Admin Settings',         subtitle: 'Manage optional features' },
  };

  const renderView = () => {
    switch (activeView) {
      case 'label-generator':
        return (
          <LabelGeneratorView
            masterData={masterData}
            nutritionData={nutritionData}
            selectedProductName={selectedProductName}
            selectedWeight={selectedWeight}
            onProductChange={setSelectedProductName}
            onWeightChange={setSelectedWeight}
            isLoadingData={isLoadingData}
            error={error}
            generatingLabel={generatingLabel}
            setGeneratingLabel={setGeneratingLabel}
          />
        );
      case 'us-label-generator':
        return <USLabelGeneratorView />;
      case 'amazon-packing-plan':
        return <AmazonPackingPlanView masterData={masterData} nutritionData={nutritionData} />;
      case 'amazon-easy-ship':
        return <AmazonEasyShipView masterData={masterData} />;
      case 'flipkart-packing-plan':
        return <FlipkartPackingPlanView masterData={masterData} nutritionData={nutritionData} />;
      case 'flipkart-easy-ship':
        return <FlipkartEasyShipView masterData={masterData} />;
      case 'product-label-generator':
        return <ProductLabelGeneratorView masterData={masterData} />;
      case 'manual-packing-plan':
        return <ManualPackingPlanView masterData={masterData} />;
      case 'packed-unit-stock':
        return <PackedUnitStockView masterData={masterData} />;
      case 'admin':
        return <AdminView />;
      default:
        return (
          <LabelGeneratorView
            masterData={masterData}
            nutritionData={nutritionData}
            selectedProductName={selectedProductName}
            selectedWeight={selectedWeight}
            onProductChange={setSelectedProductName}
            onWeightChange={setSelectedWeight}
            isLoadingData={isLoadingData}
            error={error}
            generatingLabel={generatingLabel}
            setGeneratingLabel={setGeneratingLabel}
          />
        );
    }
  };

  return (
    <AdminProvider>
      <ToastProvider>
        <DialogProvider>
          <div className="min-h-screen bg-gray-50 flex font-sans overflow-hidden h-screen">
            <Sidebar activeView={activeView} onViewChange={setActiveView} />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <DashboardHeader
                connectionStatus={connectionStatus}
                onRefresh={loadData}
                isLoading={isLoadingData}
                pageTitle={pageMeta[activeView].title}
                pageSubtitle={pageMeta[activeView].subtitle}
              />
              <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 animate-fadeIn">
                {renderView()}
              </main>
            </div>
            <KeyboardShortcutsModal
              isOpen={showShortcuts}
              onClose={() => setShowShortcuts(false)}
            />
          </div>
        </DialogProvider>
      </ToastProvider>
    </AdminProvider>
  );
};

export default App;
