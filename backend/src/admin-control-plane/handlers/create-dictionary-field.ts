/**
 * M8 Data Dictionary — Create a new dictionary field
 *
 * Validates input and stores a new DataDictionaryEntry in DynamoDB.
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DataDictionaryEntry } from "../models/DataDictionaryEntry";

// ---------------------------------------------------------------------------
// DynamoDB client (instantiated once per cold start)
// ---------------------------------------------------------------------------

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.DICTIONARY_TABLE_NAME ?? "vpp-data-dictionary";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const FIELD_ID_PATTERN = /^(metering|status|config)\.[a-z_]+$/;

const VALID_DOMAINS = new Set<DataDictionaryEntry["domain"]>([
  "metering",
  "status",
  "config",
]);

const VALID_VALUE_TYPES = new Set<DataDictionaryEntry["valueType"]>([
  "number",
  "string",
  "boolean",
]);

function validate(body: Record<string, unknown>): string | null {
  if (!body.fieldId || typeof body.fieldId !== "string") {
    return "fieldId is required and must be a string";
  }
  if (!FIELD_ID_PATTERN.test(body.fieldId)) {
    return "fieldId must match pattern: ^(metering|status|config)\\.[a-z_]+$";
  }
  if (!body.domain || !VALID_DOMAINS.has(body.domain as DataDictionaryEntry["domain"])) {
    return "domain is required and must be one of: metering, status, config";
  }
  if (!body.valueType || !VALID_VALUE_TYPES.has(body.valueType as DataDictionaryEntry["valueType"])) {
    return "valueType is required and must be one of: number, string, boolean";
  }
  if (!body.displayName || typeof body.displayName !== "string") {
    return "displayName is required and must be a string";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const validationError = validate(body);
  if (validationError) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: validationError }),
    };
  }

  const entry: DataDictionaryEntry = {
    fieldId: body.fieldId as string,
    domain: body.domain as DataDictionaryEntry["domain"],
    valueType: body.valueType as DataDictionaryEntry["valueType"],
    displayName: body.displayName as string,
    ...(body.description && typeof body.description === "string"
      ? { description: body.description }
      : {}),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: entry,
      }),
    );

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "ERROR",
        module: "M8",
        action: "create_dictionary_field",
        error: String(err),
      }),
    );
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}
