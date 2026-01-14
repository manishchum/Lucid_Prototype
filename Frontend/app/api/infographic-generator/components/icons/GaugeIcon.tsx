
import React from 'react';

const GaugeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3.75H19.5M8.25 3.75S7.5 4.5 7.5 5.25v13.5S8.25 20.25 9 20.25h10.5c.75 0 1.5-.75 1.5-1.5V5.25c0-.75-.75-1.5-1.5-1.5H8.25z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9v11.25A2.25 2.25 0 006 22.5h12a2.25 2.25 0 002.25-2.25V9M3.75 9H20.25M3.75 9l1.5-4.5h13.5l1.5 4.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.008v.008H12v-.008z" />
  </svg>
);

export default GaugeIcon;
