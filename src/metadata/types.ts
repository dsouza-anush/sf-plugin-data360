export type MetadataField = {
  name: string;
  displayName?: string;
  type?: string;
  businessType?: string;
  keyQualifier?: string;
};

export type MetadataRelationship = {
  name?: string;
  displayName?: string;
  relatedEntity?: string;
  cardinality?: string;
  [key: string]: unknown;
};

export type EntityMetadata = {
  name: string;
  displayName?: string;
  category?: string;
  type?: string;
  fields?: MetadataField[];
  relationships?: MetadataRelationship[];
  primaryKeys?: Array<{ name: string; displayName?: string; indexOrder?: number }>;
  indexes?: unknown[];
  referenceModelEntityDeveloperName?: string;
};

export type MetadataListResult = { entities: EntityMetadata[] };
