
import React from 'react';

const LegalIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.52.832 1.285 1.55 2.274 2.059a2.25 2.25 0 011.64 2.256V21M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5.25c1.33 0 2.59.293 3.712.825M6.59 6.59A9.953 9.953 0 005.25 12c0 1.33.293 2.59.825 3.712m11.373-3.712c.532 1.122.825 2.382.825 3.712a9.953 9.953 0 01-2.28 6.083M3 21l3.59-3.59" />
  </svg>
);

export default LegalIcon;
