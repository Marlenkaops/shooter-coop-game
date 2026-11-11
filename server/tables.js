import { SCOPE } from "./persistence.js";

export function tableEntity(document) {
  const payload = JSON.stringify(document);
  if (Buffer.byteLength(payload, "utf16le") > 60 * 1024) throw new Error("Table payload exceeds its safe property limit.");
  return { partitionKey: SCOPE, rowKey: document.id, dataset: document.dataset, payload };
}

export async function createTableAdapter(environment = process.env, { tooling = false, client: injected } = {}) {
  const endpoint = environment.TABLES_ENDPOINT;
  if (!/^https:\/\/[a-z0-9]{3,24}\.table\.core\.windows\.net\/?$/.test(endpoint || "")) {
    throw new Error("TABLES_ENDPOINT must be a primary Azure Table HTTPS endpoint.");
  }
  const mode = environment.TABLES_AUTH_MODE || "managed-identity";
  if (!["managed-identity", "azure-cli"].includes(mode) || !tooling && mode !== "managed-identity" ||
    mode === "managed-identity" && !environment.TABLES_CLIENT_ID) {
    throw new Error("Runtime requires TABLES_CLIENT_ID managed identity. Azure CLI authentication is private-tooling only.");
  }
  let client = injected;
  if (!client) {
    const [{ TableClient }, { ManagedIdentityCredential, AzureCliCredential }] = await Promise.all([
      import("@azure/data-tables"), import("@azure/identity")
    ]);
    const credential = mode === "azure-cli" ? new AzureCliCredential() :
      new ManagedIdentityCredential({ clientId: environment.TABLES_CLIENT_ID });
    client = new TableClient(endpoint, environment.TABLES_TABLE || "state", credential, { retryOptions: { maxRetries: 0 } });
  }
  return {
    async readRoot() {
      try {
        const entity = await client.getEntity(SCOPE, "active", { abortSignal: AbortSignal.timeout(15_000) });
        return { ...JSON.parse(entity.payload), _etag: entity.etag };
      } catch (error) { if (error.statusCode === 404) return null; throw error; }
    },
    async readDocuments(dataset) {
      if (!/^[0-9a-f-]{36}$/i.test(dataset)) throw new Error("Invalid dataset identifier.");
      const documents = new Map();
      for await (const entity of client.listEntities({ abortSignal: AbortSignal.timeout(60_000), queryOptions: {
        filter: `PartitionKey eq '${SCOPE}' and dataset eq '${dataset}' and RowKey ne 'active'`
      } })) {
        const document = JSON.parse(entity.payload);
        if (document.scope !== SCOPE || document.dataset !== dataset || document.id !== entity.rowKey ||
          documents.has(document.id)) throw new Error("Invalid durable entity.");
        documents.set(document.id, document);
      }
      return documents;
    },
    async batch(operations) {
      const actions = operations.map((operation) => {
        if (operation.operationType === "Create") return ["create", tableEntity(operation.resourceBody)];
        if (operation.operationType === "Replace") {
          if (operation.id === "active" && (!operation.ifMatch || operation.ifMatch === "*")) throw new Error("Active dataset replacement requires its exact ETag.");
          return ["update", tableEntity(operation.resourceBody), "Replace", { etag: operation.ifMatch || "*" }];
        }
        if (operation.operationType === "Delete") return ["delete", { partitionKey: SCOPE, rowKey: operation.id, etag: "*" }];
        throw new Error("Unsupported durable operation.");
      });
      const response = await client.submitTransaction(actions, { abortSignal: AbortSignal.timeout(15_000) });
      if (response.subResponses.some((result) => result.status < 200 || result.status >= 300)) {
        throw new Error("Table transaction failed.");
      }
    }
  };
}
