import React, { useEffect, useState } from 'react';
import { fetchMasterData, fetchNutritionData } from './services/dataService';
import { MasterProduct, NutritionData } from './types';
import Sidebar, { ViewType } from './components/Sidebar';
import DashboardHeader, { ConnectionStatus } from './components/DashboardHeader';
import { ToastProvider } from './contexts/ToastContext';
import { DialogProvider } from './contexts/DialogContext';
import LabelGeneratorView from './components/views/LabelGeneratorView';
import USLabelGeneratorView from './components/views/USLabelGeneratorView';
import ProductLabelGeneratorView from './components/views/ProductLabelGeneratorView';
import AmazonPackingPlanView from './components/views/AmazonPackingPlanView';
import AmazonEasyShipView from './components/views/AmazonEasyShipView';
import FlipkartPackingPlanView from './components/views/FlipkartPackingPlanView';
import FlipkartEasyShipView from './components/views/FlipkartEasyShipView';
import ManualPackingPlanView from './components/views/ManualPackingPlanView';
import PackedUnitStockView from './components/views/PackedUnitStockView';
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
  const [dataSource, setDataSource] = useState<'google-sheets' | 'local' | 'unknown'>('google-sheets');

  // Loading state for individual buttons
  const [generatingLabel, setGeneratingLabel] = useState<string | null>(null);

  // Active view state
  const [activeView, setActiveView] = useState<ViewType>('label-generator');
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Keyboard shortcuts
  useKeyboardShortcut({
    key: '?',
    ctrl: true,
    callback: () => setShowShortcuts(true)
  });

  const loadData = async () => {
    setIsLoadingData(true);
    setError(null);
    try {
      const [master, nutrition] = await Promise.all([
        fetchMasterData(),
        fetchNutritionData()
      ]);
      setMasterData(master);
      setNutritionData(nutrition);
      setLastSync(new Date());
      setDataSource('google-sheets');
      setIsLoadingData(false);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Failed to load data from Google Sheets. Please check your internet connection.";
      setError(errorMessage);
      setDataSource('unknown');
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const connectionStatus: ConnectionStatus = {
    connected: masterData.length > 0 && !error,
    productCount: masterData.length,
    lastSync,
    dataSource,
    error
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
        return (
          <AmazonPackingPlanView
            masterData={masterData}
            nutritionData={nutritionData}
          />
        );
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
    <ToastProvider>
      <DialogProvider>
        <div className="min-h-screen bg-gray-50 flex font-sans">
          {/* Sidebar */}
          <Sidebar activeView={activeView} onViewChange={setActiveView} />

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col lg:ml-0">
            {/* Dashboard Header */}
            <DashboardHeader
              connectionStatus={connectionStatus}
              onRefresh={loadData}
              isLoading={isLoadingData}
            />

            {/* Main Content */}
            <main className="flex-grow px-4 sm:px-6 lg:px-8 py-8 animate-fadeIn">
              {renderView()}
            </main>

            {/* Footer */}
            <footer className="bg-white border-t border-gray-200 mt-auto">
              <div className="px-4 py-6 sm:px-6 lg:px-8">
                <p className="text-center text-sm text-gray-500">
                  &copy; {new Date().getFullYear()} Mithila Tools. All rights reserved.
                </p>
              </div>
            </footer>
          </div>

          {/* Keyboard Shortcuts Modal */}
          <KeyboardShortcutsModal
            isOpen={showShortcuts}
            onClose={() => setShowShortcuts(false)}
          />
        </div>
      </DialogProvider>
    </ToastProvider>
  );
};

export default App;