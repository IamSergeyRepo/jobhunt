import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as n8n from './n8n-client.mjs';

const server = new McpServer({
  name: 'n8n-mcp',
  version: '1.0.0',
});

// --- List workflows ---
server.registerTool(
  'n8n_list_workflows',
  {
    description: 'List all n8n workflows with ID, name, and active status',
    inputSchema: {},
  },
  async () => {
    const data = await n8n.listWorkflows();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Get workflow ---
server.registerTool(
  'n8n_get_workflow',
  {
    description: 'Get full details of an n8n workflow by ID',
    inputSchema: {
      id: z.string().describe('Workflow ID'),
    },
  },
  async ({ id }) => {
    const data = await n8n.getWorkflow(id);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Create workflow ---
server.registerTool(
  'n8n_create_workflow',
  {
    description: 'Create a new n8n workflow from JSON',
    inputSchema: {
      workflow: z.string().describe('Workflow JSON as a string'),
    },
  },
  async ({ workflow }) => {
    const workflowData = JSON.parse(workflow);
    const data = await n8n.createWorkflow(workflowData);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Update workflow ---
server.registerTool(
  'n8n_update_workflow',
  {
    description: 'Update an existing n8n workflow by ID',
    inputSchema: {
      id: z.string().describe('Workflow ID'),
      workflow: z.string().describe('Workflow JSON as a string (partial update)'),
    },
  },
  async ({ id, workflow }) => {
    const workflowData = JSON.parse(workflow);
    const data = await n8n.updateWorkflow(id, workflowData);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Activate workflow ---
server.registerTool(
  'n8n_activate_workflow',
  {
    description: 'Activate an n8n workflow (turn on auto-polling/triggers)',
    inputSchema: {
      id: z.string().describe('Workflow ID'),
    },
  },
  async ({ id }) => {
    const data = await n8n.activateWorkflow(id);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Deactivate workflow ---
server.registerTool(
  'n8n_deactivate_workflow',
  {
    description: 'Deactivate an n8n workflow (turn off auto-polling/triggers)',
    inputSchema: {
      id: z.string().describe('Workflow ID'),
    },
  },
  async ({ id }) => {
    const data = await n8n.deactivateWorkflow(id);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Get executions ---
server.registerTool(
  'n8n_get_executions',
  {
    description: 'List recent n8n executions, optionally filtered by workflow ID',
    inputSchema: {
      workflowId: z.string().optional().describe('Optional workflow ID to filter by'),
    },
  },
  async ({ workflowId }) => {
    const data = await n8n.getExecutions(workflowId);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Get execution ---
server.registerTool(
  'n8n_get_execution',
  {
    description: 'Get details of a specific n8n execution by ID',
    inputSchema: {
      id: z.string().describe('Execution ID'),
    },
  },
  async ({ id }) => {
    const data = await n8n.getExecution(id);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Trigger webhook ---
server.registerTool(
  'n8n_trigger_webhook',
  {
    description: 'Trigger an n8n webhook workflow by path. Path must match [a-zA-Z0-9/_-]+',
    inputSchema: {
      path: z.string().describe('Webhook path (e.g. "my-webhook")'),
      payload: z.string().optional().describe('JSON payload as a string'),
    },
  },
  async ({ path, payload }) => {
    const payloadData = payload ? JSON.parse(payload) : undefined;
    const data = await n8n.triggerWebhook(path, payloadData);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('n8n MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
