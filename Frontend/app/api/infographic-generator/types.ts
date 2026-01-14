
export interface InfographicData {
  title: string;
  sections: Section[];
  criticalFlags: CriticalFlags;
}

export interface Section {
  title: string;
  icon: string;
  points: Point[];
  subSections: SubSection[];
}

export interface Point {
  title: string;
  text: string;
}

export interface SubSection {
  title: string;
  icon: string;
  color: 'blue' | 'green' | 'yellow';
  points: Point[];
}

export interface CriticalFlags {
  title: string;
  flags: Flag[];
}

export interface Flag {
  title: string;
  icon: string;
  text: string;
  value: string | null;
}
