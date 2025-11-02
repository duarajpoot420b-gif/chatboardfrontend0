import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  text: String,
  senderId: String,  // ✅ String rahega, ObjectId nahi
  receiverId: String, // ✅ String rahega, ObjectId nahi  
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'sent' } // sent, delivered, read
});

export default mongoose.model("Message", messageSchema);