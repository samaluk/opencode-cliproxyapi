# CLIProxyAPI model discovery for OpenCode

Discover the CLIProxyAPI models available to your API key in OpenCode 2.3.2 or later in the 2.x series. The plugin keeps OpenCode's model registry in sync and sends generation requests through OpenCode's AI SDK integration using Chat Completions.

## Requirements

Use a CLIProxyAPI gateway that supports Chat Completions. For full model metadata, stock CLIProxyAPI serves `GET /v1/models?client_version=cpa` with a `models` array. The gateway API key must have access to the models you want to use.

## Install

Add the pinned npm package to the `plugins` array in your `opencode.json`.

```json
{
  "plugins": [
    {
      "package": "@samaluk/opencode-cliproxyapi@0.1.0",
      "options": {
        "providerId": "cliproxyapi",
        "refreshIntervalSeconds": 300
      }
    }
  ]
}
```

Set `CLIPROXYAPI_BASE_URL` to your gateway URL, for example `https://gateway.example`, and supply its bearer token through `CLIPROXYAPI_API_KEY`. Set both in the environment of the OpenCode process that loads the plugin. For a background OpenCode server, set them in the server's environment.

Run `opencode models` to see the discovered models, then select one as `cliproxyapi/<gateway-model-id>`.

## Options

Explicit plugin options take precedence over environment defaults.

| Option | Default and behavior |
| --- | --- |
| `baseUrl` | `CLIPROXYAPI_BASE_URL`. Accepts an HTTP(S) origin or gateway path prefix, with or without a trailing `/v1`. |
| `apiKey` | `CLIPROXYAPI_API_KEY`. Use the environment to keep the key out of `opencode.json`. |
| `providerId` | `cliproxyapi`. Give each gateway configuration a dedicated provider ID. |
| `name` | `CLIProxyAPI`. Display name for the provider. |
| `refreshIntervalSeconds` | 300 seconds. Positive values below 60 are raised to 60. |
| `cacheDir` | `$XDG_CACHE_HOME/opencode-cliproxyapi` or `~/.cache/opencode-cliproxyapi`. |

## Refresh and cache

Discovery runs at startup and on the configured interval. A changed catalog replaces the provider's models, including removing routes that disappeared, and triggers a registry reload. On authentication failure, invalid responses, or outages, the plugin uses the last valid catalog in memory or on disk. Cached catalogs have no expiration, so model availability can be stale until the gateway returns.

The cache contains selected model metadata. It uses atomic writes and owner-only file permissions (`0600` on POSIX systems), with separate files per normalized gateway URL and key. The bearer stays out of the cache, provider registry, and plugin diagnostics. Requests attach the bearer only at the configured origin and reject redirects. Use HTTPS for remote gateways.

## Catalog support

Full discovery hides routes marked `visibility: hide`, preserves reported limits and recognized modalities, and maps advertised reasoning efforts to OpenCode variants. The advertised default applies when you select no variant. Pricing is reported as zero because the catalog supplies no pricing. Missing limits default to 8,192 context tokens and up to 4,096 output tokens.

If the rich endpoint is unsupported or returns a plain model list, the plugin requests `/v1/models` and appends `(ID only)` to the display names. This fallback has no visibility, reasoning, or capability metadata, so it can include routes that rich discovery would hide.

## Releasing

The first npm publish must be manual because trusted publishing can only be configured once the package exists. From the repository root, use Bun 1.4.5 and current npm.

```sh
npm login --registry https://registry.npmjs.org
bun install --frozen-lockfile
bun run check
bun test
bun run build
npm pack --dry-run
npm publish --registry https://registry.npmjs.org --access public --no-provenance
```

When you're ready for the next release, open the package's settings on npmjs.com and add a GitHub Actions trusted publisher for `samaluk/opencode-cliproxyapi` with workflow filename `release.yml`. Leave the environment field blank and enable direct `npm publish` under Allowed actions. Bump `package.json`, push the commit, and push a matching `v<version>` tag (for example, `v0.1.1`). Complete the first trusted publish within two days of adding the publisher. The release workflow uses OIDC and publishes with provenance.
