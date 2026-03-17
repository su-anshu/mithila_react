import React, { useMemo, useState, useRef, useEffect } from 'react';
import { MasterProduct } from '../types';
import { Search, ChevronDown, X } from 'lucide-react';

interface ProductSelectorProps {
  products: MasterProduct[];
  selectedProduct: string;
  selectedWeight: string;
  onProductChange: (product: string) => void;
  onWeightChange: (weight: string) => void;
  isLoading: boolean;
}

const ProductSelector: React.FC<ProductSelectorProps> = ({
  products,
  selectedProduct,
  selectedWeight,
  onProductChange,
  onWeightChange,
  isLoading
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const uniqueProducts = useMemo(() => {
    return Array.from(new Set(products.map(p => p.Name))).sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return uniqueProducts;
    const query = searchQuery.toLowerCase();
    return uniqueProducts.filter(name => 
      name.toLowerCase().includes(query)
    );
  }, [uniqueProducts, searchQuery]);

  const availableWeights = useMemo(() => {
    if (!selectedProduct) return [];
    return products
      .filter(p => p.Name === selectedProduct)
      .map(p => p["Net Weight"])
      .filter(Boolean)
      .sort();
  }, [products, selectedProduct]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isDropdownOpen]);

  const handleProductSelect = (product: string) => {
    onProductChange(product);
    onWeightChange(""); // Reset weight on product change
    setIsDropdownOpen(false);
    setSearchQuery('');
  };

  const handleClearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onProductChange("");
    onWeightChange("");
    setSearchQuery('');
  };

  const selectedProductDisplay = selectedProduct || "-- Choose a product --";

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Product Selection</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="relative" ref={dropdownRef}>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Product
          </label>
          <div className="relative">
            <button
              type="button"
              className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 pr-10 text-left focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500 flex items-center justify-between"
              onClick={() => !isLoading && setIsDropdownOpen(!isDropdownOpen)}
              disabled={isLoading}
            >
              <span className={selectedProduct ? "text-gray-900" : "text-gray-500"}>
                {selectedProductDisplay}
              </span>
              <div className="flex items-center gap-1">
                {selectedProduct && (
                  <X
                    className="w-4 h-4 text-gray-400 hover:text-gray-600"
                    onClick={handleClearSelection}
                  />
                )}
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isDropdownOpen ? 'transform rotate-180' : ''}`} />
              </div>
            </button>

            {isDropdownOpen && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-80 overflow-hidden flex flex-col">
                {/* Search Input */}
                <div className="p-2 border-b border-gray-200">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                      placeholder="Search products..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>

                {/* Product List */}
                <div className="overflow-y-auto max-h-64">
                  {filteredProducts.length > 0 ? (
                    <ul className="py-1">
                      {filteredProducts.map(name => (
                        <li
                          key={name}
                          className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${
                            selectedProduct === name ? 'bg-blue-100 font-medium' : ''
                          }`}
                          onClick={() => handleProductSelect(name)}
                        >
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-3 py-4 text-center text-sm text-gray-500">
                      No products found
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Weight
          </label>
          <select
            className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            value={selectedWeight}
            onChange={(e) => onWeightChange(e.target.value)}
            disabled={!selectedProduct || isLoading}
          >
            <option value="">-- Choose weight --</option>
            {availableWeights.map(weight => (
              <option key={weight} value={weight}>{weight}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default ProductSelector;