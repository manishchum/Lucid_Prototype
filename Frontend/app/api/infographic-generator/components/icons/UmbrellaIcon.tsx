
import React from 'react';

const UmbrellaIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12c0-5.021 4.09-9.11 9.166-9.11C16.92 2.89 21 7.02 21 12.016a9.164 9.164 0 01-18.328 0zm1.5 0c0 .92.203 1.802.585 2.613m14.575-2.613c.382-.811.585-1.693.585-2.613m-15.16 0h15.16" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12v9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 21a2.25 2.25 0 01-2.25-2.25V18a2.25 2.25 0 012.25-2.25h4.5A2.25 2.25 0 0116.5 18v.75a2.25 2.25 0 01-2.25 2.25h-4.5z" />
  </svg>
);

export default UmbrellaIcon;
