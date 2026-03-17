import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
  rounded?: boolean | 'full';
  variant?: 'text' | 'circular' | 'rectangular';
}

const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  className = '',
  rounded = false,
  variant = 'rectangular'
}) => {
  const getRoundedClass = () => {
    if (rounded === 'full') return 'rounded-full';
    if (rounded === true) return 'rounded';
    return '';
  };

  const getVariantClass = () => {
    switch (variant) {
      case 'text':
        return 'h-4';
      case 'circular':
        return 'rounded-full';
      case 'rectangular':
        return '';
    }
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`
        bg-gray-200 animate-pulse
        ${getRoundedClass()}
        ${getVariantClass()}
        ${className}
      `}
      style={style}
      aria-label="Loading..."
    />
  );
};

export default Skeleton;

