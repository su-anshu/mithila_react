import React, { useState } from 'react';
import { CheckCircle } from 'lucide-react';

interface DownloadButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onDownload: () => void;
  tickSize?: string; // tailwind class e.g. 'h-3.5 w-3.5' (default) or 'h-4 w-4'
}

/**
 * Drop-in replacement for <button> on download actions.
 * Appends a green ✓ checkmark inside the button after the first click.
 * State resets when the component unmounts (e.g. on new label generation).
 */
const DownloadButton: React.FC<DownloadButtonProps> = ({
  onDownload,
  tickSize = 'h-3.5 w-3.5',
  children,
  className = '',
  disabled,
  onClick,
  ...rest
}) => {
  const [downloaded, setDownloaded] = useState(false);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) {
      onDownload();
      setDownloaded(true);
    }
    onClick?.(e);
  };

  return (
    <button
      {...rest}
      onClick={handleClick}
      disabled={disabled}
      className={className}
    >
      {children}
      {downloaded && (
        <CheckCircle className={`${tickSize} text-green-300 flex-shrink-0 ml-1`} />
      )}
    </button>
  );
};

export default DownloadButton;
