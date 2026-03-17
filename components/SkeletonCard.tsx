import React from 'react';
import Skeleton from './Skeleton';

interface SkeletonCardProps {
  showButton?: boolean;
}

const SkeletonCard: React.FC<SkeletonCardProps> = ({ showButton = true }) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <Skeleton width="60%" height={24} className="mb-2" />
      <Skeleton width="100%" height={16} className="mb-1" />
      <Skeleton width="80%" height={16} className="mb-6" />
      {showButton && (
        <Skeleton width="100%" height={40} rounded />
      )}
    </div>
  );
};

export default SkeletonCard;

