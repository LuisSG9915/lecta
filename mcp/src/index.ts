#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LectaApi } from "./api.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";

async function main() {
  const config = loadConfig();
  const api = new LectaApi(config);
  const server = new McpServer(
    { name: "lecta", version: "0.2.0" },
    {
      instructions:
        "Servidor MCP de Lecta: consulta el catálogo léxico, el catálogo de libros y, si hay sesión, el cuaderno de vocabulario, las anotaciones y las estadísticas de lectura de la cuenta. Todas las herramientas son de solo lectura.",
    },
  );

  registerTools(server, api, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout pertenece al protocolo JSON-RPC: los avisos van a stderr.
  console.error(
    `[lecta-mcp] conectado · ${config.baseUrl} · credenciales: ${
      api.hasCredentials ? "sí" : "no (solo herramientas públicas)"
    }`,
  );
}

main().catch((error) => {
  console.error("[lecta-mcp] error fatal:", error);
  process.exit(1);
});
