import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X, Package } from 'lucide-react';

interface ProductSearchSelectProps {
  products: string[];
  selectedProduct: string;
  onSelect: (product: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const ProductSearchSelect: React.FC<ProductSearchSelectProps> = ({
  products,
  selectedProduct,
  onSelect,
  placeholder = 'Select a product',
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const query = searchQuery.toLowerCase();
    return products.filter(name => name.toLowerCase().includes(query));
  }, [products, searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (product: string) => {
    onSelect(product);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect('');
    setSearchQuery('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full border border-gray-300 rounded-md shadow-sm py-2.5 px-3 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-between transition-colors hover:border-gray-400"
      >
        <span className={selectedProduct ? 'text-gray-900' : 'text-gray-500'}>
          {selectedProduct || placeholder}
        </span>
        <div className="flex items-center gap-1">
          {selectedProduct && (
            <X
              className="w-4 h-4 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                handleClear(e);
              }}
            />
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'transform rotate-180' : ''}`}
          />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-80 overflow-hidden flex flex-col">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
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
                {filteredProducts.map((name) => (
                  <li
                    key={name}
                    className={`px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors ${
                      selectedProduct === name ? 'bg-blue-100 font-medium' : ''
                    }`}
                    onClick={() => handleSelect(name)}
                  >
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-400" />
                      <span>{name}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                No products found
              </div>
            )}
          </div>

          {/* Footer with count */}
          {products.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">
                {filteredProducts.length} of {products.length} products
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductSearchSelect;

