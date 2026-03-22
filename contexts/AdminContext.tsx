import React, { createContext, useContext, useState, useEffect } from 'react';

export interface FeatureFlags {
  show4x6Vertical: boolean;
  showMrpOnlyLabels: boolean;
  showManualPackingPlan: boolean;
  showPackedUnitStock: boolean;
  showBrandWiseLabels: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  show4x6Vertical: true,
  showMrpOnlyLabels: true,
  showManualPackingPlan: true,
  showPackedUnitStock: true,
  showBrandWiseLabels: true,
};

interface AdminContextValue {
  isAdminLoggedIn: boolean;
  login: (password: string) => boolean;
  logout: () => void;
  flags: FeatureFlags;
  setFlag: (key: keyof FeatureFlags, value: boolean) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

const STORAGE_KEY = 'mithila_feature_flags';
const ADMIN_PASSWORD = 'admin';

export const AdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [flags, setFlags] = useState<FeatureFlags>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...DEFAULT_FLAGS, ...JSON.parse(stored) } : DEFAULT_FLAGS;
    } catch {
      return DEFAULT_FLAGS;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  }, [flags]);

  const login = (password: string): boolean => {
    if (password === ADMIN_PASSWORD) {
      setIsAdminLoggedIn(true);
      return true;
    }
    return false;
  };

  const logout = () => setIsAdminLoggedIn(false);

  const setFlag = (key: keyof FeatureFlags, value: boolean) => {
    setFlags(prev => ({ ...prev, [key]: value }));
  };

  return (
    <AdminContext.Provider value={{ isAdminLoggedIn, login, logout, flags, setFlag }}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = (): AdminContextValue => {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside AdminProvider');
  return ctx;
};
