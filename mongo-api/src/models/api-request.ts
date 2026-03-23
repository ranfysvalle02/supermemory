import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const apiRequestSchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		type: { type: String, required: true },
		orgId: { type: String, required: true, index: true },
		userId: { type: String, required: true },
		keyId: { type: String, default: null },
		statusCode: { type: Number, required: true },
		duration: { type: Number, default: null },
		input: { type: Schema.Types.Mixed, default: null },
		output: { type: Schema.Types.Mixed, default: null },
		originalTokens: { type: Number, default: null },
		finalTokens: { type: Number, default: null },
		tokensSaved: { type: Number, default: null },
		costSavedUSD: { type: Number, default: null },
		model: { type: String, default: null },
		provider: { type: String, default: null },
		conversationId: { type: String, default: null },
		contextModified: { type: Boolean, default: false },
		metadata: { type: Schema.Types.Mixed, default: null },
		origin: { type: String, default: "api" },
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

apiRequestSchema.index({ orgId: 1, createdAt: -1 })
apiRequestSchema.index({ orgId: 1, type: 1 })

export const ApiRequestModel = mongoose.model("ApiRequest", apiRequestSchema)
