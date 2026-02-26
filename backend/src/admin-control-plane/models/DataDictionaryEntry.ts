/**
 * M8 Data Dictionary — Core Business Model
 *
 * Defines the schema for a single field in the Global Data Dictionary.
 * Architectural law: NO sourcePath, NO transform fields.
 */
export interface DataDictionaryEntry {
  fieldId: string;
  domain: 'metering' | 'status' | 'config';
  valueType: 'number' | 'string' | 'boolean';
  displayName: string;
  description?: string;
}
