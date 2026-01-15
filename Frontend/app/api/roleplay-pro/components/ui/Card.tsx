
import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> { // Extend with HTMLDivElement attributes
  children: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => { // Destructure props
  return (
    <div className={`bg-white rounded-xl shadow-lg p-6 ${className}`} {...props}> {/* Pass all props to the div */}
      {children}
    </div>
  );
};

export default Card;
