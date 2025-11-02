import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    // ✅ Field 1: Name ko required kiya
    name: { 
        type: String, 
        required: true 
    },
    
    // ✅ Field 2: Phone number ko required aur unique rakha
    phone: { 
        type: String, 
        unique: true,
        required: true,
    },
    
    // ✅ NEW: isOnline status tracking add ki
    isOnline: { 
        type: Boolean, 
        default: false 
    },

}, { 
    // 📝 OPTIONAL: Yeh Mongoose ko automatic 'createdAt' aur 'updatedAt' fields add karne ko kehta hai.
    timestamps: true 
});

export default mongoose.models.User || mongoose.model("User", userSchema);