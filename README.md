# HONC Remote Weather MCP with Auth

This is an example of an authenticated MCP server.

Under the hood, it uses the better-auth ([docs](https://better-auth.com/docs/introduction) | [repo](https://github.com/better-auth/better-auth)) library to handle the auth for the MCP server.

<img src="assets/logo-2.png" alt="Logo" width="200" height="200">

## Auth Preamble

MCP Remote Auth requires an OAuth 2.1 flow to be implemented.

In this case, the Worker in this repo is both the Resource Server and the Authorization Server, but for the purposes of this app, actual user authorization is handled by the GitHub social provider (also with Better Auth).

If you need a refresher on OAuth concepts (like Resource Servers, Authorization Servers, PKCE, etc.), do some googlin'.

## Setting up the app

Copy the sample `.dev.vars-sample` file to `.dev.vars` and fill in the values.

```sh
cp .dev.vars-sample .dev.vars
```

A few notes on the configuration values:

- `BETTER_AUTH_URL` is the URL of the Better Auth server. Locally, this is `http://localhost:5342`.
- `BETTER_AUTH_SECRET` is the secret key for the Better Auth server. You can generate a random one with `openssl rand -base64 32`.
- `GITHUB_CLIENT_ID` is the client ID of the GitHub OAuth app (see below).
- `GITHUB_CLIENT_SECRET` is the client secret of the GitHub OAuth app (see below).

**To create a GitHub OAuth app:**

- Visit the GitHub docs on [creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) and follow the instructions to create an OAuth app.

- Set the `Authorization callback URL` to `http://localhost:5342/api/auth/callback/github`.
- Set the `Homepage URL` to `http://localhost:5342`
- Click continue
- Copy the Client ID to the `.dev.vars` file.
- Create a Client Secret and copy it to the `.dev.vars` file.

## Testing the OAuth Flow

Boot up the model context protocol inspector:

```sh
npx @modelcontextprotocol/inspector
# or
pnpm run mcp:inspect
```

Open the inspector, and look for the button labeled "Open Auth Settings". Should be next to some copy that says "Need to configure authentication?".

Choose the "Guided Oauth Flow" and go through each step.

> **NOTE** You will need to run your app with the env var `CORS_ENVIRONMENT` set to `local` for the inspector to work with the api.


### Example Redirect URL for an MCP Client

The expected flow is that our Worker will return a URL to an MCP client where it can then login and authenticate itself.

```
http://localhost:5342/api/auth/mcp/authorize?response_type=code&client_id=GvZfQIQgTMViansKDtxuWkEnmFVVfqxO&code_challenge=44wL43aOBlIthKdeqi1sMpdMpLpp1_yNQG96o3JuA6E&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A6274%2Foauth%2Fcallback%2Fdebug&scope=openid+profile+email&resource=http%3A%2F%2Flocalhost%3A5342%2F
```

## Developing

After configuring `.dev.vars` (see above), install dependencies and run the migrations:

```sh
pnpm i
pnpm db:setup
pnpm run dev
```

If you change any env vars, you should re-run typegen:

```sh
pnpm cf-typegen
```

If you change the better-auth config, you might need to regenerate the auth tables in Drizzle (and rerun migrations):

```sh
pnpm run auth:generate
pnpm db:migrate
```


## Deploying

Create a production GitHub OAuth app, and set the following secrets:

```sh
pnpm wrangler secret put OPENWEATHERMAP_API_KEY
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
```

Then run the migrations:

```sh
pnpm db:migrate:prod
```

## Quirks

### `/login` route

We need to have some client-side javascript to handle parts of the login flow (this is particular to using Better Auth's routes).

That's what you see in the html rendered by the `/login` route.

**_Why?_**

First, if we handle `login` through a `c.redirect` call, then we end up having to duplicate Better Auth's logic for talking to GitHub on a separate route.

Second, because we will end up redirecting at some point to the GitHub OAuth app's redirect URI, `/api/auth/callback/github`, which returns a JSON object with the redirect url.

Since GitHub is a general OAuth provider (the way that Better Auth implements it), this means that route won't redirect to the URL we want it to, instead it just returns JSON with the redirect URL like so (since it assumes the client is some javascript in a browser)

For instance, connecting to this MCP server from Cursor would result in a redirect that lands on a page that just renders JSON like this:

```json
{
"redirect": true,
"url": "cursor://anysphere.cursor-retrieval/oauth/user-Weather/callback?code=mycode&state=undefined"
}
```

In effect, this means that the user would have to copy-paste the link, which is a nooooo goooooood. 

### Why so much CORS?

The MCP inspector makes requests directly from the browser, so we need to set up CORS to allow the inspector to make requests to our app.

In production, we would expect an MCP Client to make these requests from a server, so CORS can be handled differently.

### Incorrect scope: `offline_access` (_only happened with the mcp inspector_)

The `offline_access` scope is not supported _unless_ you also send `prompt=consent` in the request, and provide a UI for the user to consent to offline storage of their information.

I saw this error when I used the step-by-step OAuth debugging flow when using `pnpx @modelcontextprotocol/inspector`.

I didn't see it when connecting to the MCP server from Cursor or Claude Code.

### Duplicate better-auth configs

There is the app config in `src/lib/auth.ts`, and the auth config in `better-auth.config.ts`.

These technically serve different purposes but they are basically the same thing.

I haven't yet thought about how to make them share logic in a cleaner way.

## TODOs

- [ ] Clean up CORS code, only add CORS when the env var `CORS_ENVIRONMENT` is set to `local`

- [ ] Evaluate
