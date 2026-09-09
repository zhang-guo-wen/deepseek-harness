/**
 * MCP row authoring on a user preset: add, update, or disable one `mcp-client`
 * row in its composition file, via {@link writeComposition} and the Loader
 * patch dialect. Shipped presets are refused by the underlying writer.
 * @module @deepseek-ai/dsh-agent-presets/mcp-rows
 */

import { writeComposition } from './authoring.ts'
import type { AgentPreset } from './preset.ts'

/** Module specifier of the MCP client bridge these helpers author. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** The mcp-client config written into a row (`transport`, `serverName`, ..., `description`). */
export interface McpRowConfig {
  serverName: string
  description?: string
  [key: string]: unknown
}

/**
 * Append one `mcp-client` row to a user preset's composition file.
 * @param preset - the resolved user preset.
 * @param config - the mcp-client entry config (its `serverName` becomes the row id).
 * @param warn - skipped-patch diagnostic sink.
 */
export async function addPresetMcp(
  preset: AgentPreset,
  config: McpRowConfig,
  warn: (message: string, ...args: unknown[]) => void,
): Promise<void> {
  await writeComposition(preset, {
    insert: [{ id: config.serverName, name: MCP_CLIENT_MODULE, config }],
  }, warn)
}

/**
 * Replace an existing `mcp-client` row's config in a user preset's composition
 * file.
 * @param preset - the resolved user preset.
 * @param serverName - the row id (`serverName`).
 * @param config - the next mcp-client entry config.
 * @param warn - skipped-patch diagnostic sink.
 */
export async function updatePresetMcp(
  preset: AgentPreset,
  serverName: string,
  config: McpRowConfig,
  warn: (message: string, ...args: unknown[]) => void,
): Promise<void> {
  await writeComposition(preset, { id: serverName, config }, warn)
}

/**
 * Disable or re-enable one `mcp-client` row in a user preset's composition file.
 * @param preset - the resolved user preset.
 * @param serverName - the row id (`serverName`).
 * @param disabled - whether to disable the row.
 * @param warn - skipped-patch diagnostic sink.
 */
export async function setPresetMcpDisabled(
  preset: AgentPreset,
  serverName: string,
  disabled: boolean,
  warn: (message: string, ...args: unknown[]) => void,
): Promise<void> {
  await writeComposition(preset, { id: serverName, disabled }, warn)
}
