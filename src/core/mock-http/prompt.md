# Agent Prompt: Generate Mock HTTP Behaviors from Codebase

Copy the prompt below and give it to an AI agent or GitHub Copilot to automatically generate mock HTTP behaviors from your codebase.

---

## The Prompt

```
You are an expert software engineer tasked with generating mock HTTP behavior files for a test mocking system.

## Your Goal

Scan this entire codebase and find every place the HTTP client is used to make external API calls. For each unique endpoint discovered, generate a behavior file that simulates that API's response in a realistic and useful way for testing.

---

## Step 1: Discover All HTTP Calls

Search the codebase for all usages of the HTTP client library. Look for patterns like:

- HttpRequest.get(...)
- HttpRequest.post(...)
- HttpRequest.put(...)
- HttpRequest.patch(...)
- HttpRequest.delete(...)
- HttpRequest.initialize({ baseUrl: '...' })
- client.get(...) / client.post(...) (initialized instances)
- Any other HTTP library this codebase uses (axios, fetch, got, node-fetch, superagent, etc.)

For each call, extract:
1. The HTTP method
2. The URL or URL template (with any path parameters)
3. The request payload structure (body / query params)
4. Any expected response structure from surrounding code (check what properties are accessed on the response: response.data.id, response.data.status, etc.)
5. The service or feature context (what is this call trying to do?)

---

## Step 2: Group Into Unique Endpoints

Group the discovered calls by endpoint pattern. Multiple calls to the same URL shape count as one behavior:

- POST /accounts → one behavior
- GET /accounts/:id → one behavior
- GET /accounts/:id/status → separate behavior

---

## Step 3: Generate Behavior Files

For each unique endpoint, create a behavior file in the output directory using this exact structure:

```javascript
module.exports = {
  name: 'descriptive-behavior-name',   // kebab-case, describes the operation
  method: 'POST',                       // uppercase HTTP method
  urlPattern: '.*/path/pattern$',       // regex matching the URL path

  handler(request, context) {
    // request.method  - HTTP method
    // request.url     - full URL
    // request.data    - request body
    // request.headers - request headers
    // request.urlParams - captured regex groups (e.g. the :id in /users/:id)

    // Your handler logic here...

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ... }
    };
  }
};
```

### Context API Available in Handlers

Use these methods inside the handler to generate dynamic, realistic data:

```javascript
// IDs
context.generateULID()              // 26-char ULID: "01ARZ3NDEKTSV4RRFFQ69G5FAV"
context.generateUUID()              // UUID: "550e8400-e29b-41d4-a716-446655440000"

// Timestamps
context.timestamp()                 // Unix ms: 1709366400000
context.isoTimestamp()              // ISO 8601: "2024-03-02T12:00:00.000Z"

// Random values
context.randomNumber(min, max)
context.generateAccountNumber()
context.generateIBAN()
context.generateBIC()

// Cross-request persistence (so created resources can be retrieved later)
context.storeResource('type', id, data)   // Save a resource
context.getResource('type', id)           // Retrieve it
context.resourceExists('type', id)        // Check existence
context.listResources('type')             // List all of a type
context.findResources('type', fn)         // Filter resources

// State progression (for simulating async status changes)
context.setState(key, { status: 'pending', ... })
context.getState(key)
context.updateState(key, { status: 'completed' })
context.getNextStatus(key, ['pending', 'processing', 'completed'])
```

---

## Step 4: Behavior Generation Rules

Apply these rules when writing each behavior handler:

### Validation
- If the real API validates required fields, replicate that. Check what fields are sent in calls and make them required.
- Return 400 with a descriptive error body if validation fails.

### Resource Creation (POST)
- Generate a unique ID using `context.generateULID()` or `context.generateUUID()` (match the ID format used in the codebase).
- Construct a realistic response object mirroring the shape accessed in calling code.
- **Always** call `context.storeResource(type, id, data)` so the created resource can be fetched later.
- Return 201 with the created resource.

### Resource Retrieval (GET with ID)
- Extract the ID from `request.urlParams[0]` (first regex capture group).
- Call `context.getResource(type, id)` to look it up.
- Return 404 with a clear error if not found.
- Return 200 with the resource if found.

### Resource Lists (GET collection)
- Call `context.listResources(type)` to get all stored resources.
- Return 200 with an array, supporting basic query param filtering if the codebase uses it.

### Resource Updates (PUT / PATCH)
- Extract the ID from urlParams.
- Check the resource exists; return 404 if not.
- Merge `request.data` into the stored resource.
- Update via `context.storeResource(type, id, updatedResource)`.
- Return 200 with the updated resource.

### Resource Deletion (DELETE)
- Extract the ID from urlParams.
- Check the resource exists; return 404 if not.
- Return 200 or 204 confirming deletion.

### Async Status Progression
- If the codebase polls an endpoint waiting for a status change (e.g. payment pending → completed), use `context.getNextStatus(id, [...sequence])` to advance the status on each call.
- Store the resource with updated status after each progression.

### Error Simulation
- Identify any "magic value" patterns used in tests (e.g. specific amounts, special reference strings, test account numbers).
- Replicate those as conditional branches in the handler.

---

## Step 5: URL Pattern Construction

Build `urlPattern` as a regex string that:
- Starts with `'.*'` to match any base URL or host
- Captures variable segments with groups: `([a-zA-Z0-9]+)`, `([0-9]+)`, `([a-zA-Z0-9_-]+)`
- Ends with `$` to avoid partial matches

Examples:
```
GET  /users/:id         → '.*/users/([a-zA-Z0-9]+)$'
GET  /orders/:id/items  → '.*/orders/([a-zA-Z0-9]+)/items$'
POST /accounts          → '.*/accounts$'
GET  /payments?ref=...  → '.*/payments$'   (query params handled via request.data)
```

---

## Step 6: File Naming and Organization

Organize output behavior files by service or domain group:

```
behaviors/
  users/
    create-user.js          (POST /users)
    get-user.js             (GET /users/:id)
    update-user.js          (PUT /users/:id)
    list-users.js           (GET /users)
  orders/
    create-order.js
    get-order.js
    list-orders.js
  payments/
    create-payment.js
    get-payment.js
```

File names should be `verb-resource.js` in kebab-case.

---

## Step 7: Produce a Summary

After generating all files, output a summary table:

| Behavior File | Method | URL Pattern | Notes |
|---|---|---|---|
| users/create-user.js | POST | `.*/users$` | Validates name, email |
| users/get-user.js | GET | `.*/users/([a-zA-Z0-9]+)$` | 404 if not found |
| payments/create-payment.js | POST | `.*/payments$` | Stores for later retrieval |
| payments/get-payment.js | GET | `.*/payments/([a-zA-Z0-9_-]+)$` | Status progression |

Also list any HTTP calls you found that you could NOT generate a behavior for, and explain why.

---

## Output Format

- One file per behavior
- Place all files in a `behaviors/` directory (or a path I specify)
- Each file must be a valid Node.js CommonJS module (`module.exports = { ... }`)
- No dependencies allowed inside behavior files — use only the `context` API
- Handler function must always return a response object with `status` and `body`

---

## Important Notes

- Do NOT generate behaviors for internal service-to-service calls within this same codebase — only for calls going to external APIs or third-party services.
- Do NOT fabricate endpoint URLs. Only generate behaviors for HTTP calls you actually find in the codebase.
- If you are uncertain about a response shape, use a minimal but valid structure and leave a `// TODO:` comment indicating what you could not infer.
- If the same endpoint is called in multiple places with different payloads, generate one behavior that handles all cases using conditional logic.
- Prioritize realistic data over placeholder values (e.g. use `context.generateIBAN()` for IBAN fields, not `"GB00000000000000000000"`).
```

---

## Usage Tips

- **Scope the scan**: Tell the agent which directory to scan if you want to limit to a specific service or module.
- **Provide response examples**: If you have API documentation or existing response fixtures, paste them into the conversation so the agent can match the exact response shape.
- **Iterate by domain**: For large codebases, run the prompt once per service group (e.g. "only scan the payments module") to keep each run focused.
- **Review generated behaviors**: After generation, manually check the `urlPattern` regex for each behavior to ensure it won't accidentally match unintended URLs.
- **Add to version control**: Commit the generated behaviors alongside your tests so the whole team benefits.
