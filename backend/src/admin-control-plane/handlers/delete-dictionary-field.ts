/**
 * M8 Data Dictionary — Delete a dictionary field
 *
 * Implements the Dependency Lock industrial safeguard:
 * protected fields that are in active use cannot be deleted.
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

// ---------------------------------------------------------------------------
// DynamoDB client (instantiated once per cold start)
// ---------------------------------------------------------------------------

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.DICTIONARY_TABLE_NAME ?? "vpp-data-dictionary";

// ---------------------------------------------------------------------------
// Dependency Lock — Protected Fields
// ---------------------------------------------------------------------------

const PROTECTED_FIELDS = new Set([
  "metering.grid_power_kw",
  "metering.grid_import_kwh",
  "metering.grid_export_kwh",
  "status.battery_soc",
  "status.battery_voltage",
  "status.is_online",
]);

function checkFieldDependencies(fieldId: string): void {
  if (PROTECTED_FIELDS.has(fieldId)) {
    const error: { statusCode: number; message: string } = {
      statusCode: 409,
      message: `Field "${fieldId}" is currently in use and cannot be deleted`,
    };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const fieldId = event.pathParameters?.fieldId;

  if (!fieldId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "fieldId path parameter is required" }),
    };
  }

  // ── Dependency Lock safeguard ──────────────────────────────────────
  try {
    checkFieldDependencies(fieldId);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return {
      statusCode: e.statusCode ?? 409,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: e.message }),
    };
  }

  try {
    // Verify field exists before deleting
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { fieldId },
      }),
    );

    if (!existing.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Field "${fieldId}" not found` }),
      };
    }

    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { fieldId },
      }),
    );

    return {
      statusCode: 204,
      headers: { "Content-Type": "application/json" },
      body: "",
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "ERROR",
        module: "M8",
        action: "delete_dictionary_field",
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
