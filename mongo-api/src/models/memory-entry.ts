import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const memoryEntrySchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		memory: { type: String, required: true },
		spaceId: { type: String, required: true, index: true },
		orgId: { type: String, required: true, index: true },
		userId: { type: String, default: null },
		version: { type: Number, default: 1 },
		isLatest: { type: Boolean, default: true },
		parentMemoryId: { type: String, default: null },
		rootMemoryId: { type: String, default: null },
		memoryRelations: { type: Schema.Types.Mixed, default: {} },
		sourceCount: { type: Number, default: 1 },
		isInference: { type: Boolean, default: false },
		isForgotten: { type: Boolean, default: false },
		isStatic: { type: Boolean, default: false },
		forgetAfter: { type: Date, default: null },
		forgetReason: { type: String, default: null },
		memoryEmbedding: { type: [Number], default: undefined },
		memoryEmbeddingModel: { type: String, default: null },
		metadata: { type: Schema.Types.Mixed, default: null },
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

export const MemoryEntryModel = mongoose.model(
	"MemoryEntry",
	memoryEntrySchema,
)
