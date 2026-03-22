import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface DialogContextType {
  confirm: (options: ConfirmOptions) => void;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export const useConfirm = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useConfirm must be used within DialogProvider');
  }
  return context.confirm;
};

interface DialogProviderProps {
  children: ReactNode;
}

export const DialogProvider: React.FC<DialogProviderProps> = ({ children }) => {
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const confirm = useCallback((options: ConfirmOptions) => {
    setDialog(options);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!dialog) return;
    
    setIsLoading(true);
    try {
      await dialog.onConfirm();
      setDialog(null);
    } catch (error) {
      console.error('Error in confirmation action:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dialog]);

  const handleCancel = useCallback(() => {
    if (dialog?.onCancel) {
      dialog.onCancel();
    }
    setDialog(null);
  }, [dialog]);

  return (
    <DialogContext.Provider value={{ confirm }}>
      {children}
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel || 'Confirm'}
          cancelLabel={dialog.cancelLabel || 'Cancel'}
          variant={dialog.variant || 'default'}
          isLoading={isLoading}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </DialogContext.Provider>
  );
};

