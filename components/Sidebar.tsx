import React, { useState } from 'react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  Tag,
  Truck,
  BarChart3,
  ClipboardList,
  ShoppingCart,
  Store,
  Globe,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { useAdmin } from '../contexts/AdminContext';

export type ViewType =
  | 'label-generator'
  | 'us-label-generator'
  | 'product-label-generator'
  | 'amazon-packing-plan'
  | 'amazon-easy-ship'
  | 'flipkart-packing-plan'
  | 'flipkart-easy-ship'
  | 'manual-packing-plan'
  | 'packed-unit-stock'
  | 'admin';

interface SidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ElementType;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { flags } = useAdmin();

  const handleViewChange = (view: ViewType) => {
    onViewChange(view);
    setIsOpen(false);
  };

  const sections: NavSection[] = [
    {
      label: 'Labels',
      items: [
        { id: 'label-generator', label: 'Label Generator', icon: Tag },
        { id: 'us-label-generator', label: 'US Label Generator', icon: Globe },
        { id: 'product-label-generator', label: 'Product Labels', icon: Layers },
      ],
    },
    {
      label: 'Amazon',
      items: [
        { id: 'amazon-packing-plan', label: 'Packing Plan', icon: ShoppingCart },
        { id: 'amazon-easy-ship', label: 'Easy Ship Report', icon: Truck },
      ],
    },
    {
      label: 'Flipkart',
      items: [
        { id: 'flipkart-packing-plan', label: 'Packing Plan', icon: Store },
        { id: 'flipkart-easy-ship', label: 'Easy Ship Report', icon: Truck },
      ],
    },
    {
      label: 'Tools',
      items: [
        ...(flags.showManualPackingPlan ? [{ id: 'manual-packing-plan' as ViewType, label: 'Manual Packing Plan', icon: ClipboardList }] : []),
        ...(flags.showPackedUnitStock ? [{ id: 'packed-unit-stock' as ViewType, label: 'Packed Unit Stock', icon: BarChart3 }] : []),
      ],
    },
  ];

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white shadow-md border border-gray-200 hover:bg-gray-50 transition-colors"
        aria-label="Toggle menu"
      >
        {isOpen ? <XMarkIcon className="h-5 w-5 text-gray-700" /> : <Bars3Icon className="h-5 w-5 text-gray-700" />}
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-56 bg-white border-r border-gray-200
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          flex flex-col shrink-0
        `}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
          <img src="/leaf.png" alt="Mithila Tools" className="w-7 h-7 object-contain" />
          <span className="text-base font-bold text-gray-900 tracking-tight">Mithila Tools</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {sections.map((section, sIdx) => (
            section.items.length > 0 && (
              <div key={section.label} className={sIdx > 0 ? 'mt-4' : ''}>
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {section.label}
                </p>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleViewChange(item.id)}
                      className={`
                        w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm mb-0.5
                        transition-colors
                        ${active
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }
                      `}
                    >
                      <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
                      <span className="truncate">{item.label}</span>
                      {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />}
                    </button>
                  );
                })}
              </div>
            )
          ))}
        </nav>

        {/* Admin — pinned at bottom */}
        <div className="px-2 py-3 border-t border-gray-100">
          <button
            onClick={() => handleViewChange('admin')}
            className={`
              w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm
              transition-colors
              ${activeView === 'admin'
                ? 'bg-gray-900 text-white font-medium'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
              }
            `}
          >
            <ShieldCheck className={`h-4 w-4 flex-shrink-0 ${activeView === 'admin' ? 'text-white' : 'text-gray-400'}`} />
            <span className="truncate">Admin</span>
            {activeView === 'admin' && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />}
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
