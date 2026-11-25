import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import type { ProviderEditor } from "@opencode/plugin/promise/provider";
import plugin from "../src/index";

test("OpenCode publishes one refresh for a changed catalog and replaces removed models", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cpa-opencode-test-"));
  const standard = { slug: "a/model", display_name: "First" };
  const reasoning = {
    slug: "b/model",
    supported_reasoning_levels: [{ effort: "none" }, { effort: "high" }],
    default_reasoning_level: "high",
  };
  let rows: unknown[] = [standard, reasoning];
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    requests++;
    return Response.json({ models: rows });
  } });

  let tick: (() => Promise<void>) | undefined;
  const interval = setInterval;
  const timer = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay?: number) => {
    if (delay === 60_000) tick = callback as () => Promise<void>;
    return interval(callback, delay);
  }) as typeof setInterval);

  let transform: ((editor: ProviderEditor) => void) | undefined;
  let models: Parameters<ProviderEditor["models"]["set"]>[1] = [];
  let reloads = 0;
  const editor = {
    update(_id, callback) {
      const info = {} as Parameters<typeof callback>[0];
      callback(info);
      expect(info.settings).not.toHaveProperty("apiKey");
    },
    models: {
      set(_id, values) { models = values; },
    },
  } as ProviderEditor;
  const context = {
    options: {
      baseUrl: server.url.href, apiKey: "fixture-bearer", cacheDir: directory, refreshIntervalSeconds: 1,
    },
    aisdk: { hook: async () => ({ dispose: async () => {} }) },
    provider: {
      transform: async (callback: (editor: ProviderEditor) => void) => {
        transform = callback;
        callback(editor);
        return { dispose: async () => {} };
      },
      reload: async () => {
        reloads++;
        transform?.(editor);
      },
    },
  } as unknown as Plugin.Context;

  let cleanup: void | Plugin.Cleanup = undefined;
  try {
    cleanup = await plugin.setup(context);
    expect(tick).toBeDefined();
    expect(models.map(({ id }) => String(id))).toEqual(["a/model", "b/model"]);
    expect(models[1].body).toEqual({ reasoning_effort: "high" });
    expect(models[1].variants.map(({ id, body }) => ({ id: String(id), body }))).toEqual([
      { id: "none", body: { reasoning_effort: "none" } },
      { id: "high", body: { reasoning_effort: "high" } },
    ]);
    expect(models[0].variants).toEqual([]);

    rows = [reasoning, standard];
    await tick!();
    expect(reloads).toBe(0);

    rows = [reasoning];
    const pending = tick!();
    expect(tick!()).toBe(pending);
    await pending;
    expect(requests).toBe(3);
    expect(reloads).toBe(1);
    expect(models.map(({ id }) => String(id))).toEqual(["b/model"]);

    rows = [];
    await tick!();
    expect(reloads).toBe(2);
    expect(models).toEqual([]);
  } finally {
    await cleanup?.();
    timer.mockRestore();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
