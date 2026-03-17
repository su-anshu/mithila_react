import React from 'react';
import { HelpCircle } from 'lucide-react';
import Tooltip from './Tooltip';

interface HelpIconProps {
  content: string | React.ReactNode;
  className?: string;
}

const HelpIcon: React.FC<HelpIconProps> = ({ content, className = '' }) => {
  return (
    <Tooltip content={content} position="top">
      <HelpCircle className={`h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help ${className}`} />
    </Tooltip>
  );
};

export default HelpIcon;

