// Runs inside mongosh during Atlas Local container init.
// Creates collections and Atlas Vector Search indexes so $vectorSearch works locally.
// Collections must exist before createSearchIndex can be called.

db = db.getSiblingDB("supermemory");

db.createCollection("chunks");
db.createCollection("documents");
db.createCollection("memoryentries");

// Primary search path: chunk-level embeddings (1536-dim, text-embedding-3-small)
db.chunks.createSearchIndex({
	name: "chunk_embedding_index",
	type: "vectorSearch",
	definition: {
		fields: [
			{
				type: "vector",
				path: "embedding",
				numDimensions: 1536,
				similarity: "cosine",
			},
			{
				type: "filter",
				path: "documentId",
			},
			{
				type: "filter",
				path: "orgId",
			},
		],
	},
});

// Document-level summary embeddings
db.documents.createSearchIndex({
	name: "doc_embedding_index",
	type: "vectorSearch",
	definition: {
		fields: [
			{
				type: "vector",
				path: "summaryEmbedding",
				numDimensions: 1536,
				similarity: "cosine",
			},
			{
				type: "filter",
				path: "orgId",
			},
		],
	},
});

// Memory entry embeddings
db.memoryentries.createSearchIndex({
	name: "memory_embedding_index",
	type: "vectorSearch",
	definition: {
		fields: [
			{
				type: "vector",
				path: "memoryEmbedding",
				numDimensions: 1536,
				similarity: "cosine",
			},
			{
				type: "filter",
				path: "orgId",
			},
		],
	},
});

print("Atlas Vector Search indexes created.");
