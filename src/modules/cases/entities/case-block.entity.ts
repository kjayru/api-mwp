// Shape of CaseTranslation.blocks (Json column): an ordered array rendered top to
// bottom by the case page and edited block by block in admin-mwp.

export interface TextBlock {
  type: 'text';
  /** e.g. "El reto", "La solución". */
  title: string;
  /** Plain text; paragraphs separated by blank lines. */
  body: string;
}

export interface GalleryBlock {
  type: 'gallery';
  /** Ids of CaseImage rows of the same case, in display order. May be empty while drafting. */
  imageIds: string[];
  caption?: string;
}

export interface MetricItem {
  /** Display value, e.g. "35%" or "12 min". */
  value: string;
  label: string;
}

export interface MetricsBlock {
  type: 'metrics';
  title?: string;
  items: MetricItem[];
}

export type CaseBlock = TextBlock | GalleryBlock | MetricsBlock;
