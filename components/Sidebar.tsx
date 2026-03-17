import React, { useState, useEffect } from 'react';
import {
  TagIcon,
  ShoppingBagIcon,
  Bars3Icon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { Package, BarChart3 } from 'lucide-react';

export type ViewType = 
  | 'label-generator'
  | 'us-label-generator'
  | 'product-label-generator'
  | 'amazon-packing-plan'
  | 'amazon-easy-ship'
  | 'flipkart-packing-plan'
  | 'flipkart-easy-ship'
  | 'manual-packing-plan'
  | 'packed-unit-stock';

interface SidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Persist accordion state in localStorage
  const getInitialAccordionState = (): number | null => {
    const saved = localStorage.getItem('sidebar-accordion-state');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Auto-open if a submenu item is active
      if (activeView === 'amazon-packing-plan' || activeView === 'amazon-easy-ship') {
        return 1;
      }
      if (activeView === 'flipkart-packing-plan' || activeView === 'flipkart-easy-ship') {
        return 2;
      }
      return parsed;
    }
    // Default: open Amazon and Flipkart accordions
    if (activeView === 'amazon-packing-plan' || activeView === 'amazon-easy-ship') {
      return 1;
    }
    if (activeView === 'flipkart-packing-plan' || activeView === 'flipkart-easy-ship') {
      return 2;
    }
    return null;
  };

  const [openAccordion, setOpenAccordion] = useState<number | null>(getInitialAccordionState);

  // Auto-open accordion when a submenu item is active
  useEffect(() => {
    if (activeView === 'amazon-packing-plan' || activeView === 'amazon-easy-ship') {
      setOpenAccordion(1);
    } else if (activeView === 'flipkart-packing-plan' || activeView === 'flipkart-easy-ship') {
      setOpenAccordion(2);
    }
  }, [activeView]);

  // Persist accordion state
  useEffect(() => {
    localStorage.setItem('sidebar-accordion-state', JSON.stringify(openAccordion));
  }, [openAccordion]);

  const handleAccordionToggle = (index: number) => {
    setOpenAccordion(openAccordion === index ? null : index);
  };

  const handleViewChange = (view: ViewType) => {
    onViewChange(view);
    setIsOpen(false); // Close sidebar on mobile after selection
  };

  const menuItems = [
    {
      id: 'label-generator' as ViewType,
      label: 'Label Generator',
      icon: TagIcon,
      hasSubmenu: false,
    },
  ];

  const amazonItems = [
    { id: 'amazon-packing-plan' as ViewType, label: 'Amazon Packing Plan' },
    { id: 'amazon-easy-ship' as ViewType, label: 'Amazon Easyship Report' },
  ];

  const flipkartItems = [
    { id: 'flipkart-packing-plan' as ViewType, label: 'Flipkart Packing Plan' },
    { id: 'flipkart-easy-ship' as ViewType, label: 'Flipkart Easyship Report' },
  ];

  const isActive = (viewId: ViewType) => activeView === viewId;

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-white shadow-md border border-gray-200 hover:bg-gray-50"
        aria-label="Toggle menu"
      >
        {isOpen ? (
          <XMarkIcon className="h-6 w-6 text-gray-700" />
        ) : (
          <Bars3Icon className="h-6 w-6 text-gray-700" />
        )}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-64 bg-white shadow-xl lg:shadow-none
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          flex flex-col
        `}
      >
        {/* Logo/Brand */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-200">
          <Package className="w-6 h-6 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-900">Mithila Tools</h2>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-2">
            {/* Label Generator */}
            <li>
              <button
                onClick={() => handleViewChange('label-generator')}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-md text-left
                  transition-colors
                  ${
                    isActive('label-generator')
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <TagIcon className="h-5 w-5" />
                <span>Label Generator</span>
              </button>
            </li>

            {/* US Label Generator */}
            <li>
              <button
                onClick={() => handleViewChange('us-label-generator')}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-md text-left
                  transition-colors
                  ${
                    isActive('us-label-generator')
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <TagIcon className="h-5 w-5" />
                <span>US Label Generator</span>
              </button>
            </li>

            {/* Product Label Generator */}
            <li>
              <button
                onClick={() => handleViewChange('product-label-generator')}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-md text-left
                  transition-colors
                  ${
                    isActive('product-label-generator')
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <TagIcon className="h-5 w-5" />
                <span>Product Label Generator</span>
              </button>
            </li>

            {/* Separator */}
            <li className="my-2">
              <hr className="border-gray-200" />
            </li>

            {/* Amazon Accordion */}
            <li>
              <button
                onClick={() => handleAccordionToggle(1)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors ${
                  activeView === 'amazon-packing-plan' || activeView === 'amazon-easy-ship'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <ShoppingBagIcon className="h-5 w-5" />
                  <span className="font-medium">Amazon Easy Ship</span>
                </div>
                {openAccordion === 1 ? (
                  <ChevronDownIcon className="h-4 w-4" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4" />
                )}
              </button>
              {openAccordion === 1 && (
                <ul className="ml-8 mt-1 space-y-1">
                  {amazonItems.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => handleViewChange(item.id)}
                        className={`
                          w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm
                          transition-colors
                          ${
                            isActive(item.id)
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-600 hover:bg-gray-50'
                          }
                        `}
                      >
                        <ChevronRightIcon className="h-3 w-3" />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Separator */}
            <li className="my-2">
              <hr className="border-gray-200" />
            </li>

            {/* Manual Packing Plan */}
            <li>
              <button
                onClick={() => handleViewChange('manual-packing-plan')}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-md text-left
                  transition-colors
                  ${
                    isActive('manual-packing-plan')
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <Package className="h-5 w-5" />
                <span>Manual Packing Plan</span>
              </button>
            </li>

            {/* Packed Unit Stock */}
            <li>
              <button
                onClick={() => handleViewChange('packed-unit-stock')}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-md text-left
                  transition-colors
                  ${
                    isActive('packed-unit-stock')
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <BarChart3 className="h-5 w-5" />
                <span>Packed Unit Stock</span>
              </button>
            </li>

            {/* Separator */}
            <li className="my-2">
              <hr className="border-gray-200" />
            </li>

            {/* Flipkart Accordion */}
            <li>
              <button
                onClick={() => handleAccordionToggle(2)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors ${
                  activeView === 'flipkart-packing-plan' || activeView === 'flipkart-easy-ship'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <ShoppingBagIcon className="h-5 w-5" />
                  <span className="font-medium">Flipkart</span>
                </div>
                {openAccordion === 2 ? (
                  <ChevronDownIcon className="h-4 w-4" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4" />
                )}
              </button>
              {openAccordion === 2 && (
                <ul className="ml-8 mt-1 space-y-1">
                  {flipkartItems.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => handleViewChange(item.id)}
                        className={`
                          w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm
                          transition-colors
                          ${
                            isActive(item.id)
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-600 hover:bg-gray-50'
                          }
                        `}
                      >
                        <ChevronRightIcon className="h-3 w-3" />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          </ul>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;

