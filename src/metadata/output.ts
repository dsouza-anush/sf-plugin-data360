import type { EntityMetadata } from './types.js';

export const metadataListRows = (entities: EntityMetadata[]): Array<Record<string, unknown>> =>
  entities.map((entity) => ({
    name: entity.name,
    displayName: entity.displayName,
    entityCategory: entity.category,
    entityType: entity.type,
    'fields#': entity.fields?.length,
  }));

export const metadataFieldRows = (entity: EntityMetadata): Array<Record<string, unknown>> => {
  const primaryKeys = new Set((entity.primaryKeys ?? []).map(({ name }) => name));
  return (entity.fields ?? []).map((field) => ({
    name: field.name,
    type: field.type,
    businessType: field.businessType,
    'primaryKey?': primaryKeys.has(field.name),
  }));
};

export const metadataRelationshipRows = (entity: EntityMetadata): Array<Record<string, unknown>> =>
  (entity.relationships ?? []).map((relationship) => ({
    name: relationship.name,
    relatedEntity: relationship.relatedEntity,
    cardinality: relationship.cardinality,
  }));
