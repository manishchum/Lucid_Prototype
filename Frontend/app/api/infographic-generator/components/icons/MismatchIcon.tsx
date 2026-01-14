
import React from 'react';

const MismatchIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-9l-3 3m0 0l3 3m-3-3h12M6 12l3 3m0 0l3-3m-3 3v6m3-9l3-3m0 0l-3-3m3 3H6" />
  </svg>
);

export default MismatchIcon;
