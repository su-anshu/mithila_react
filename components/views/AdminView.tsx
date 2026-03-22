import React, { useState } from 'react';
import { ShieldCheck, Lock, LogOut, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAdmin, FeatureFlags } from '../../contexts/AdminContext';

const FEATURE_CONFIG: { key: keyof FeatureFlags; label: string; description: string }[] = [
  {
    key: 'show4x6Vertical',
    label: '4×6 Vertical Label',
    description: 'Show "House in 4×6 inch Vertical" download button in Label Generator, US Label Generator, and Amazon & Flipkart packing plans',
  },
  {
    key: 'showMrpOnlyLabels',
    label: 'MRP-Only Labels',
    description: 'Show MRP-Only Labels section in Amazon & Flipkart packing plans',
  },
  {
    key: 'showManualPackingPlan',
    label: 'Manual Packing Plan',
    description: 'Show Manual Packing Plan in the sidebar navigation',
  },
  {
    key: 'showPackedUnitStock',
    label: 'Packed Unit Stock',
    description: 'Show Packed Unit Stock in the sidebar navigation',
  },
  {
    key: 'showBrandWiseLabels',
    label: 'Brand-wise Labels',
    description: 'Show brand-separated label sections in Amazon & Flipkart packing plans (groups labels by Brand Name from master sheet)',
  },
];

const AdminView: React.FC = () => {
  const { isAdminLoggedIn, login, logout, flags, setFlag } = useAdmin();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = login(password);
    if (!ok) {
      setError('Incorrect password');
      setPassword('');
    } else {
      setError('');
      setPassword('');
    }
  };

  if (!isAdminLoggedIn) {
    return (
      <div className="w-full max-w-sm mx-auto mt-16">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center mb-3">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">Admin Login</h2>
            <p className="text-sm text-gray-500 mt-1">Enter password to access admin settings</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="Enter admin password"
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  autoFocus
                />
              </div>
              {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-900 rounded-lg flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Admin Settings</h2>
            <p className="text-xs text-gray-500">Toggle optional features on or off</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <LogOut className="h-4 w-4" /> Logout
        </button>
      </div>

      {/* Feature toggles */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {FEATURE_CONFIG.map((feature, idx) => (
          <div
            key={feature.key}
            className={`flex items-center justify-between px-5 py-4 ${idx < FEATURE_CONFIG.length - 1 ? 'border-b border-gray-100' : ''}`}
          >
            <div>
              <p className="text-sm font-semibold text-gray-800">{feature.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{feature.description}</p>
            </div>
            <button
              onClick={() => setFlag(feature.key, !flags[feature.key])}
              className="flex items-center gap-2 ml-6 shrink-0"
              title={flags[feature.key] ? 'Click to disable' : 'Click to enable'}
            >
              {flags[feature.key] ? (
                <>
                  <ToggleRight className="h-8 w-8 text-green-500" />
                  <span className="text-xs font-medium text-green-600 w-7">ON</span>
                </>
              ) : (
                <>
                  <ToggleLeft className="h-8 w-8 text-gray-300" />
                  <span className="text-xs font-medium text-gray-400 w-7">OFF</span>
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 text-center">Settings are saved automatically and persist across sessions.</p>
    </div>
  );
};

export default AdminView;
