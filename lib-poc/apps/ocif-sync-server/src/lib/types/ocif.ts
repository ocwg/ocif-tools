export type OCIFNode = {
  id: string;
  position?: [number, number];
  size?: [number, number];
  resource?: string;
  text?: string;
  data?: Array<{
    type: '@ocif/node/oval' | '@ocif/node/rect' | '@ocif/node/arrow';
    strokeWidth?: number;
    strokeColor?: string;
    fillColor?: string;
    start?: number[];
    end?: number[];
    relation?: string;
  }>;
};

export type OCIFRelation = {
  id: string;
  data: Array<{
    type: string;
    start: string;
    end: string;
    rel: string;
    node: string;
    members?: string[];
  }>;
};

export type OCIFResource = {
  id: string;
  representations?: Array<{
    'mime-type': string;
    content?: string;
    location?: string;
  }>;
};

export type OCIFJson = {
  ocif: string;
  nodes?: Array<OCIFNode>;
  relations?: Array<OCIFRelation>;
  resources?: Array<OCIFResource>;
};

export interface Node {
  id: string;
  type: 'rectangle' | 'oval';
  width: number;
  height: number;
  x: number;
  y: number;
  text?: string;
  style: {
    type: 'rectangle' | 'oval';
    strokeWidth: number;
    strokeColor: string;
    fillColor: string;
  };
}

export interface Relation {
  from: string;
  to: string;
  path: string;
  type: string;
  rel: string;
}

export interface Group {
  id: string;
  type: string;
  members: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}
