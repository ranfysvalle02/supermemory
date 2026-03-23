import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const spaceSchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		name: { type: String, default: null },
		description: { type: String, default: null },
		orgId: { type: String, required: true, index: true },
		ownerId: { type: String, required: true },
		containerTag: { type: String, default: null, index: true },
		visibility: { type: String, default: "private" },
		isExperimental: { type: Boolean, default: false },
		contentTextIndex: { type: Schema.Types.Mixed, default: {} },
		indexSize: { type: Number, default: null },
		metadata: { type: Schema.Types.Mixed, default: null },
		emoji: { type: String, default: null },
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

spaceSchema.index({ orgId: 1, containerTag: 1 }, { unique: true })

export const SpaceModel = mongoose.model("Space", spaceSchema)
