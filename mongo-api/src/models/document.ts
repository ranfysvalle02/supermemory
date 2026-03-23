import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const documentSchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		customId: { type: String, default: null },
		contentHash: { type: String, default: null },
		orgId: { type: String, required: true, index: true },
		userId: { type: String, required: true },
		connectionId: { type: String, default: null },
		title: { type: String, default: null },
		content: { type: String, default: null },
		summary: { type: String, default: null },
		url: { type: String, default: null },
		source: { type: String, default: null },
		type: { type: String, default: "text" },
		status: { type: String, default: "unknown" },
		metadata: { type: Schema.Types.Mixed, default: null },
		processingMetadata: { type: Schema.Types.Mixed, default: null },
		raw: { type: Schema.Types.Mixed, default: null },
		ogImage: { type: String, default: null },
		tokenCount: { type: Number, default: null },
		wordCount: { type: Number, default: null },
		chunkCount: { type: Number, default: 0 },
		averageChunkSize: { type: Number, default: null },
		summaryEmbedding: { type: [Number], default: undefined },
		summaryEmbeddingModel: { type: String, default: null },
		containerTags: { type: [String], default: [], index: true },
	},
	{
		timestamps: true,
		toJSON: {
			transform(_doc, ret: Record<string, unknown>) {
				ret.id = ret._id
				delete ret._id
				delete ret.__v
				return ret
			},
		},
	},
)

documentSchema.index({ orgId: 1, containerTags: 1 })
documentSchema.index({ orgId: 1, status: 1 })
documentSchema.index({ customId: 1, orgId: 1 })

export const DocumentModel = mongoose.model("Document", documentSchema)
