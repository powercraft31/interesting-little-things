/**
 * M8 Data Dictionary — List all dictionary fields
 *
 * Scans the DynamoDB data-dictionary table and returns all entries.
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DataDictionaryEntry } from "../models/DataDictionaryEntry";

// ---------------------------------------------------------------------------
// DynamoDB client (instantiated once per cold start)
// ---------------------------------------------------------------------------

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.DICTIONARY_TABLE_NAME ?? "vpp-data-dictionary";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));

    const fields: DataDictionaryEntry[] = (result.Items ?? []).map((item) => ({
      fieldId: item.fieldId as string,
      domain: item.domain as DataDictionaryEntry["domain"],
      valueType: item.valueType as DataDictionaryEntry["valueType"],
      displayName: item.displayName as string,
      ...(item.description ? { description: item.description as string } : {}),
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "ERROR",
        module: "M8",
        action: "get_data_dictionary",
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
