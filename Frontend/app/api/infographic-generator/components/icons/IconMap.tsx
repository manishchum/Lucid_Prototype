
import React from 'react';
import UmbrellaIcon from './UmbrellaIcon';
import ClipboardIcon from './ClipboardIcon';
import PersonIcon from './PersonIcon';
import PropertyIcon from './PropertyIcon';
import TermIcon from './TermIcon';
import MismatchIcon from './MismatchIcon';
import LegalIcon from './LegalIcon';
import DefaultIcon from './DefaultIcon';
import GaugeIcon from './GaugeIcon';

export const IconMap: { [key: string]: React.FC<React.SVGProps<SVGSVGElement>> } = {
  umbrella: UmbrellaIcon,
  clipboard: ClipboardIcon,
  person: PersonIcon,
  property: PropertyIcon,
  term: TermIcon,
  mismatch: MismatchIcon,
  gauge: GaugeIcon, // Used as a placeholder in case gauge component fails
  legal: LegalIcon,
  default: DefaultIcon,
};
