import z from "zod";
import { loadConfig } from "./safety.ts";
import { executeAnalysisQuery, validatedSQL } from "./middleware.ts";

const config = await loadConfig();

// 1. ZOD SCHEMAS FOR TOOL INPUTS
const analyzeArtifactInput = z.object({
  file_id: z.string().min(1, "file_id is required"),
  sql_query: z.string().min(1, "sql_query is required"),
  justification: z.string().min(
    20,
    "justification must explain the user's intent",
  ),
});

// 2. TOOL DEFINITIONS (MCP)
export const tools = {
  analyze_artifact: {
    description:
      "Run a safe, AST-validated SQL query on a server-side artifact.",
    inputSchema: analyzeArtifactInput,
  },
};

// 3. MAIN HANDLER FOR TOOL CALLS
export async function handleToolCall(toolName: string, args: unknown) {
  switch (toolName) {
    case "analyze_artifact": {
      const parsed = analyzeArtifactInput.parse(args);

      const { file_id, sql_query, justification } = parsed;

      // Step A: Validate SQL through AST Middleware
      const validation = await validatedSQL(sql_query);

      if (!validation.ok) {
        return {
          error: validation.error,
          hint: validation.hint,
          category: "SQL_VALIDATION_ERROR",
        };
      }

      const result = await executeAnalysisQuery({
        file_id,
        sql_query,
      });

      return {
        ok: true,
        analyzed: result,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
