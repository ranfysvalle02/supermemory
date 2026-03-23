import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const chunkSchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		documentId: { type: String, required: true, index: true },
		orgId: { type: String, required: true, index: true },
		containerTags: { type: [String], default: [] },
		content: { type: String, required: true },
		embeddedContent: { type: String, default: null },
		type: { type: String, default: "text" },
		position: { type: Number, required: true },
		metadata: { type: Schema.Types.Mixed, default: null },
		embedding: { type: [Number], default: undefined },
		embeddingModel: { type: String, default: null },
	},
	{
		timestamps: { createdAt: true, updatedAt: false },
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

chunkSchema.index({ documentId: 1, position: 1 })

export const ChunkModel = mongoose.model("Chunk", chunkSchema)
