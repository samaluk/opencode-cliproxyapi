import { randomUUID } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Model, Plugin, Provider } from "@opencode/plugin";
import {
  createDiscovery, defaultCacheDir, gatewayFetch, providerID, resolveConnection, stringOption,
  warnOnDiscoveryStatus, type Catalog, type CatalogModel, type Fetch,
} from "./catalog";

const packageName = "opencode-cliproxyapi";
const sdkPackage = `aisdk:${packageName}`;
const zero = 0 as Model.Cost["input"];

function toModel(providerId: string, row: CatalogModel, mode: Catalog["mode"]): Model.Info {
  const id = row.id as Model.ID;
  return {
    id,
    modelID: id,
    providerID: providerId as Provider.ID,
    name: row.name,
    capabilities: { tools: row.tools ?? (mode === "rich"), input: row.input, output: row.output },
    limit: { context: row.contextWindow, output: row.maxTokens },
    cost: [{ input: zero, output: zero, cache: { read: zero, write: zero } }],
    time: { released: 0 },
    status: "active",
    enabled: true,
    body: row.defaultEffort === undefined ? undefined : { reasoning_effort: row.defaultEffort },
    variants: row.efforts.map((effort) => ({
      id: effort as Model.VariantID,
      body: { reasoning_effort: effort },
    })),
  };
}

function intervalMs(option: unknown): number {
  if (option === undefined) return 300_000;
  if (typeof option !== "number" || !Number.isFinite(option) || option <= 0 || option > 2_147_483) {
    throw new Error("Invalid refreshIntervalSeconds option");
  }
  return Math.max(60_000, Math.round(option * 1_000));
}

// This is the V2 Promise plugin shape. Plugin.define itself only returns the object.
const plugin: Plugin.Plugin = {
  id: packageName,
  async setup(ctx) {
    const options = ctx.options;
    const connection = resolveConnection(options);
    const id = providerID(options.providerId);
    const name = stringOption(options.name, "name") ?? "CLIProxyAPI";
    const interval = intervalMs(options.refreshIntervalSeconds);
    const cacheDir = stringOption(options.cacheDir, "cacheDir") ?? defaultCacheDir(packageName);
    const discover = createDiscovery(connection, cacheDir);
    const report = warnOnDiscoveryStatus(packageName);
    const lifetime = new AbortController();

    // The SDK cache can outlive a replaced plugin setup. A new instance gets a new SDK.
    const instance = randomUUID();
    await ctx.aisdk.hook("sdk", (event) => {
      if (event.package !== packageName) return;
      const sdk = createOpenAICompatible({
        name: id,
        baseURL: connection.baseUrl,
        fetch: gatewayFetch(connection, event.options.fetch as Fetch) as typeof fetch,
      });
      event.sdk = { languageModel: sdk.chatModel };
    }, { providerID: id });

    let catalog: Catalog | undefined;
    try {
      const initial = await discover(lifetime.signal);
      report(initial);
      catalog = initial.catalog;
    } catch {
      report();
    }
    await ctx.provider.transform((editor) => {
      const snapshot = catalog;
      if (!snapshot) return;
      editor.update(id, (provider) => {
        provider.name = name;
        provider.activation = "enabled";
        provider.package = sdkPackage;
        provider.canonical = undefined;
        provider.integrationID = undefined;
        provider.headers = undefined;
        provider.body = undefined;
        provider.settings = { baseURL: connection.baseUrl, cpaDiscoveryInstance: instance };
      });
      editor.models.set(id, snapshot.models.map((model) => toModel(id, model, snapshot.mode)));
    });

    let published = JSON.stringify(catalog);
    let pending: Promise<void> | undefined;
    const refresh = () => {
      pending ??= (async () => {
        try {
          const result = await discover(lifetime.signal);
          if (lifetime.signal.aborted) return;
          report(result);
          const signature = JSON.stringify(result.catalog);
          if (signature === published) return;
          catalog = result.catalog;
          try {
            await ctx.provider.reload();
            published = signature;
          } catch {
            console.warn(`[${packageName}] could not reload the model registry. Retrying on the next refresh.`);
          }
        } catch {
          if (!lifetime.signal.aborted) report();
        }
      })().finally(() => { pending = undefined; });
      return pending;
    };

    const timer = setInterval(refresh, interval);
    timer.unref();
    return async () => {
      clearInterval(timer);
      lifetime.abort();
      await pending;
    };
  },
};

export default plugin;
