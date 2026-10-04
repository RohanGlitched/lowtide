"use client";
import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import { AppBridge, PostMessageTransport, RESOURCE_MIME_TYPE, getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";

const HOST = { name: "Lowtide Echo simulator", version: "1.0.0" };

export interface Connection {
  client: Client;
  tools: Tool[];
  html: Map<string, Promise<string>>;
}

/** Connects to a Lowtide MCP endpoint over Streamable HTTP, like an Alexa+ integration would. */
export async function connect(url: string): Promise<Connection> {
  const client = new Client(HOST);
  // Lowtide serves stateless Streamable HTTP: there is no server-initiated stream to open, so answer the
  // client's optional GET locally instead of letting the browser log a 405.
  const quietFetch: typeof fetch = (input, init) =>
    (init?.method ?? "GET").toUpperCase() === "GET"
      ? Promise.resolve(new Response(null, { status: 405 }))
      : fetch(input, init);
  await client.connect(new StreamableHTTPClientTransport(new URL(url, location.href), { fetch: quietFetch }));
  const { tools } = await client.listTools();
  return { client, tools, html: new Map() };
}

export async function callTool(conn: Connection, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    return (await conn.client.callTool({ name, arguments: args })) as CallToolResult;
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
  }
}

function viewHtml(conn: Connection, uri: string): Promise<string> {
  let p = conn.html.get(uri);
  if (!p) {
    p = conn.client.readResource({ uri }).then((r) => {
      const c = r.contents[0];
      if (!c || c.mimeType !== RESOURCE_MIME_TYPE) throw new Error("Not an MCP App view");
      return "text" in c ? c.text : atob(c.blob);
    });
    conn.html.set(uri, p);
    p.catch(() => conn.html.delete(uri));
  }
  return p;
}

export interface MountedView {
  iframe: HTMLIFrameElement;
  bridge: AppBridge;
  dispose: () => void;
}

/**
 * Renders a tool's MCP App view in a sandboxed iframe (opaque origin, scripts only) and feeds it the tool
 * input and result through an AppBridge, the same protocol Claude and ChatGPT use.
 */
export async function mountView(
  host: HTMLElement,
  conn: Connection,
  toolName: string,
  args: Record<string, unknown>,
  result: CallToolResult,
  theme: "light" | "dark",
): Promise<MountedView | null> {
  const tool = conn.tools.find((t) => t.name === toolName);
  const uri = tool ? getToolUiResourceUri(tool) : undefined;
  if (!uri) return null;
  const html = await viewHtml(conn, uri);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("title", "Lowtide");
  iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:transparent";
  host.replaceChildren(iframe);

  const bridge = new AppBridge(
    conn.client,
    HOST,
    { openLinks: {}, serverTools: {}, serverResources: {} },
    {
      hostContext: {
        theme,
        platform: "web",
        displayMode: "fullscreen",
        availableDisplayModes: ["fullscreen"],
        containerDimensions: { width: host.clientWidth, height: host.clientHeight },
      },
    },
  );
  const ready = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });
  bridge.onopenlink = async ({ url }) => {
    window.open(url, "_blank", "noopener,noreferrer");
    return {};
  };
  bridge.onsizechange = () => {};
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  iframe.srcdoc = html;
  await Promise.race([ready, new Promise((r) => setTimeout(r, 4000))]);
  bridge.sendToolInput({ arguments: args });
  bridge.sendToolResult(result);

  const ro = new ResizeObserver(() =>
    bridge.sendHostContextChange({ containerDimensions: { width: host.clientWidth, height: host.clientHeight } }),
  );
  ro.observe(host);
  return {
    iframe,
    bridge,
    dispose: () => {
      ro.disconnect();
      bridge.close().catch(() => {});
    },
  };
}
