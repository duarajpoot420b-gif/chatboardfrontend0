// server.js - COMPLETE VERSION WITH CALLS & VOICE MESSAGES
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// In-memory storage
const users = new Map();
const messages = new Map();
const onlineUsers = new Map();
const userContacts = new Map();
const pendingMessages = new Map();
const deletedMessages = new Map();
const calls = new Map(); // Store active calls
const voiceMessages = new Map(); // Store voice messages

// Generate conversation ID
const getConversationId = (user1, user2) => {
  return [user1, user2].sort().join('_');
};

// Get current user from socket
const getCurrentUser = (socketId) => {
  return onlineUsers.get(socketId);
};

// Clean up old messages (24 hours)
const cleanupOldMessages = () => {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  for (const [conversationId, convMessages] of messages) {
    const filteredMessages = convMessages.filter(msg => 
      new Date(msg.timestamp) > twentyFourHoursAgo
    );
    messages.set(conversationId, filteredMessages);
  }
  
  console.log('🧹 Cleaned up old messages (24+ hours)');
};

// Run cleanup every hour
setInterval(cleanupOldMessages, 60 * 60 * 1000);

// Deliver pending messages when user comes online
const deliverPendingMessages = (user) => {
  const pending = pendingMessages.get(user.phone) || [];
  if (pending.length > 0) {
    console.log(`📨 Delivering ${pending.length} pending messages to ${user.name}`);
    
    pending.forEach(message => {
      message.status = 'delivered';
      
      if (user.socketId && onlineUsers.has(user.socketId)) {
        io.to(user.socketId).emit('newMessage', message);
      }
      
      const sender = users.get(message.senderPhone);
      if (sender && sender.socketId) {
        io.to(sender.socketId).emit('messageStatus', {
          messageId: message._id,
          status: 'delivered'
        });
      }
    });
    
    pendingMessages.set(user.phone, []);
  }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User registration
  socket.on('register', (userData) => {
    const user = {
      _id: userData._id,
      name: userData.name,
      phone: userData.phone,
      isOnline: true,
      socketId: socket.id,
      lastSeen: new Date()
    };
    
    const existingUser = users.get(userData.phone);
    if (existingUser) {
      existingUser.socketId = socket.id;
      existingUser.isOnline = true;
      existingUser.lastSeen = new Date();
      onlineUsers.set(socket.id, existingUser);
      
      const contacts = userContacts.get(userData.phone) || [];
      const contactUsers = contacts.map(phone => users.get(phone)).filter(Boolean);
      
      socket.emit('registrationSuccess', {
        ...existingUser,
        contacts: contactUsers
      });

      deliverPendingMessages(existingUser);
    } else {
      users.set(userData.phone, user);
      onlineUsers.set(socket.id, user);
      userContacts.set(userData.phone, []);
      socket.emit('registrationSuccess', {
        ...user,
        contacts: []
      });
    }
    
    socket.broadcast.emit('userOnline', user);
    console.log('User registered:', user.name, user.phone);
  });

  // Find user by phone
  socket.on('findUserByPhone', (phone, callback) => {
    const currentUser = getCurrentUser(socket.id);
    const user = users.get(phone);
    
    if (user && currentUser && user.phone !== currentUser.phone) {
      callback({
        _id: user._id,
        name: user.name,
        phone: user.phone,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen
      });
    } else {
      callback(null);
    }
  });

  // Add contact
  socket.on('addContact', (contactPhone, callback) => {
    const currentUser = getCurrentUser(socket.id);
    if (!currentUser) {
      callback({ success: false, message: 'User not found' });
      return;
    }

    const contact = users.get(contactPhone);
    if (!contact) {
      callback({ success: false, message: 'Contact not found' });
      return;
    }

    // Get user's personal contacts
    const contacts = userContacts.get(currentUser.phone) || [];
    
    // Check if contact already exists
    if (contacts.includes(contactPhone)) {
      callback({ success: false, message: 'Contact already exists' });
      return;
    }

    // Add to personal contacts
    contacts.push(contactPhone);
    userContacts.set(currentUser.phone, contacts);
    
    callback({ 
      success: true, 
      message: 'Contact added successfully',
      contact: {
        _id: contact._id,
        name: contact.name,
        phone: contact.phone,
        isOnline: contact.isOnline,
        lastSeen: contact.lastSeen
      }
    });

    console.log('Contact added:', currentUser.name, '->', contact.name);
  });

  // Get user's personal contacts
  socket.on('getUserContacts', (callback) => {
    const currentUser = getCurrentUser(socket.id);
    if (!currentUser) {
      callback([]);
      return;
    }

    const contactPhones = userContacts.get(currentUser.phone) || [];
    const contacts = contactPhones.map(phone => users.get(phone)).filter(Boolean);
    
    callback(contacts);
  });

  // Send message
  socket.on('sendMessage', (messageData) => {
    const sender = getCurrentUser(socket.id);
    if (!sender) {
      console.log('❌ Sender not found');
      socket.emit('messageError', { message: 'Sender not found' });
      return;
    }

    const receiver = users.get(messageData.receiverPhone);
    if (!receiver) {
      console.log('❌ Receiver not found:', messageData.receiverPhone);
      socket.emit('messageError', { message: 'Receiver not found' });
      return;
    }

    const conversationId = getConversationId(sender.phone, receiver.phone);
    
    const message = {
      _id: messageData.tempId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: messageData.text,
      senderId: sender._id,
      receiverId: receiver._id,
      senderPhone: sender.phone,
      receiverPhone: receiver.phone,
      timestamp: new Date(),
      status: 'sent',
      tempId: messageData.tempId,
      conversationId: conversationId,
      senderInfo: {
        _id: sender._id,
        name: sender.name,
        phone: sender.phone
      },
      replyTo: messageData.replyTo || undefined,
      isDeleted: false,
      deletedForEveryone: false
    };

    // Save message
    if (!messages.has(conversationId)) {
      messages.set(conversationId, []);
    }
    messages.get(conversationId).push(message);

    console.log('💾 Message saved:', sender.name, '->', receiver.name);

    // Auto-add contacts
    const senderContacts = userContacts.get(sender.phone) || [];
    if (!senderContacts.includes(receiver.phone)) {
      senderContacts.push(receiver.phone);
      userContacts.set(sender.phone, senderContacts);
      console.log('👥 Auto-added to contacts:', receiver.name, '->', sender.name);
      
      socket.emit('contactAdded', {
        _id: receiver._id,
        name: receiver.name,
        phone: receiver.phone,
        isOnline: receiver.isOnline
      });
    }

    const receiverContacts = userContacts.get(receiver.phone) || [];
    if (!receiverContacts.includes(sender.phone)) {
      receiverContacts.push(sender.phone);
      userContacts.set(receiver.phone, receiverContacts);
      console.log('👥 Auto-added to contacts:', sender.name, '->', receiver.name);
      
      if (receiver.socketId && onlineUsers.has(receiver.socketId)) {
        io.to(receiver.socketId).emit('contactAdded', {
          _id: sender._id,
          name: sender.name,
          phone: sender.phone,
          isOnline: sender.isOnline
        });
      }
    }

    // Send to sender initially
    socket.emit('newMessage', message);
    socket.emit('messageStatus', {
      messageId: message._id,
      status: 'sent'
    });

    // Send to receiver if online
    if (receiver.socketId && onlineUsers.has(receiver.socketId)) {
      console.log('✅ Receiver online, delivering message...');
      
      message.status = 'delivered';
      io.to(receiver.socketId).emit('newMessage', message);
      
      socket.emit('messageStatus', {
        messageId: message._id,
        status: 'delivered'
      });
      
      console.log('✅ Message delivered to', receiver.name);
    } else {
      console.log('ℹ️ Receiver offline, message saved for later delivery');
      
      if (!pendingMessages.has(receiver.phone)) {
        pendingMessages.set(receiver.phone, []);
      }
      pendingMessages.get(receiver.phone).push(message);
    }

    console.log('✅ Message sent successfully from', sender.name, 'to', receiver.name);
  });

  // Send voice message
  socket.on('sendVoiceMessage', (voiceData) => {
    const sender = getCurrentUser(socket.id);
    if (!sender) {
      console.log('❌ Sender not found for voice message');
      socket.emit('messageError', { message: 'Sender not found' });
      return;
    }

    const receiver = users.get(voiceData.receiverPhone);
    if (!receiver) {
      console.log('❌ Receiver not found for voice message:', voiceData.receiverPhone);
      socket.emit('messageError', { message: 'Receiver not found' });
      return;
    }

    const conversationId = getConversationId(sender.phone, receiver.phone);
    
    const message = {
      _id: voiceData.tempId || `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: 'Voice message',
      senderId: sender._id,
      receiverId: receiver._id,
      senderPhone: sender.phone,
      receiverPhone: receiver.phone,
      timestamp: new Date(),
      status: 'sent',
      tempId: voiceData.tempId,
      conversationId: conversationId,
      senderInfo: {
        _id: sender._id,
        name: sender.name,
        phone: sender.phone
      },
      isDeleted: false,
      deletedForEveryone: false,
      isVoiceMessage: true,
      voiceUrl: voiceData.audioData,
      voiceDuration: voiceData.duration
    };

    // Save voice message
    if (!messages.has(conversationId)) {
      messages.set(conversationId, []);
    }
    messages.get(conversationId).push(message);

    // Save to voice messages storage
    voiceMessages.set(message._id, {
      audioData: voiceData.audioData,
      duration: voiceData.duration
    });

    console.log('🎤 Voice message saved:', sender.name, '->', receiver.name, `(${voiceData.duration}s)`);

    // Auto-add contacts (same as text messages)
    const senderContacts = userContacts.get(sender.phone) || [];
    if (!senderContacts.includes(receiver.phone)) {
      senderContacts.push(receiver.phone);
      userContacts.set(sender.phone, senderContacts);
      
      socket.emit('contactAdded', {
        _id: receiver._id,
        name: receiver.name,
        phone: receiver.phone,
        isOnline: receiver.isOnline
      });
    }

    const receiverContacts = userContacts.get(receiver.phone) || [];
    if (!receiverContacts.includes(sender.phone)) {
      receiverContacts.push(sender.phone);
      userContacts.set(receiver.phone, receiverContacts);
      
      if (receiver.socketId && onlineUsers.has(receiver.socketId)) {
        io.to(receiver.socketId).emit('contactAdded', {
          _id: sender._id,
          name: sender.name,
          phone: sender.phone,
          isOnline: sender.isOnline
        });
      }
    }

    // Send to sender
    socket.emit('newMessage', message);
    socket.emit('messageStatus', {
      messageId: message._id,
      status: 'sent'
    });

    // Send to receiver if online
    if (receiver.socketId && onlineUsers.has(receiver.socketId)) {
      message.status = 'delivered';
      io.to(receiver.socketId).emit('newMessage', message);
      
      socket.emit('messageStatus', {
        messageId: message._id,
        status: 'delivered'
      });
      
      console.log('✅ Voice message delivered to', receiver.name);
    } else {
      console.log('ℹ️ Receiver offline, voice message saved for later delivery');
      
      if (!pendingMessages.has(receiver.phone)) {
        pendingMessages.set(receiver.phone, []);
      }
      pendingMessages.get(receiver.phone).push(message);
    }
  });

  // CALL SYSTEM - Start call
  socket.on('startCall', (callData) => {
    const caller = getCurrentUser(socket.id);
    if (!caller) {
      console.log('❌ Caller not found');
      return;
    }

    const receiver = users.get(callData.receiverPhone);
    if (!receiver) {
      console.log('❌ Receiver not found for call:', callData.receiverPhone);
      socket.emit('callError', { message: 'Receiver not found' });
      return;
    }

    const call = {
      _id: `call_${Date.now()}`,
      callerId: caller._id,
      receiverId: receiver._id,
      callerPhone: caller.phone,
      receiverPhone: receiver.phone,
      callerName: caller.name,
      receiverName: receiver.name,
      type: callData.type, // 'audio' or 'video'
      status: 'calling',
      startTime: new Date(),
      endTime: null,
      duration: 0
    };

    // Store call
    calls.set(call._id, call);

    console.log(`📞 ${call.type.toUpperCase()} call started:`, caller.name, '->', receiver.name);

    // Notify caller
    socket.emit('callStarted', call);

    // Notify receiver if online
    if (receiver.socketId && onlineUsers.has(receiver.socketId)) {
      io.to(receiver.socketId).emit('incomingCall', call);
      console.log('✅ Call notification sent to receiver');
    } else {
      // Receiver offline - call missed
      call.status = 'missed';
      call.endTime = new Date();
      socket.emit('callEnded', call);
      console.log('❌ Receiver offline, call missed');
    }
  });

  // Accept call
  socket.on('acceptCall', (callId) => {
    const receiver = getCurrentUser(socket.id);
    if (!receiver) {
      console.log('❌ Receiver not found for call acceptance');
      return;
    }

    const call = calls.get(callId);
    if (!call) {
      console.log('❌ Call not found:', callId);
      return;
    }

    // Update call status
    call.status = 'ongoing';
    call.startTime = new Date();

    const caller = users.get(call.callerPhone);
    
    // Notify caller
    if (caller && caller.socketId) {
      io.to(caller.socketId).emit('callAccepted', call);
    }

    // Notify receiver
    socket.emit('callAccepted', call);

    console.log(`✅ Call accepted:`, call.callerName, '->', call.receiverName);
  });

  // Reject call
  socket.on('rejectCall', (callId) => {
    const receiver = getCurrentUser(socket.id);
    if (!receiver) {
      console.log('❌ Receiver not found for call rejection');
      return;
    }

    const call = calls.get(callId);
    if (!call) {
      console.log('❌ Call not found:', callId);
      return;
    }

    // Update call status
    call.status = 'rejected';
    call.endTime = new Date();

    const caller = users.get(call.callerPhone);
    
    // Notify caller
    if (caller && caller.socketId) {
      io.to(caller.socketId).emit('callRejected', call);
    }

    // Remove call from active calls
    calls.delete(callId);

    console.log(`❌ Call rejected:`, call.callerName, '->', call.receiverName);
  });

  // End call
  socket.on('endCall', (callId) => {
    const user = getCurrentUser(socket.id);
    if (!user) {
      console.log('❌ User not found for call end');
      return;
    }

    const call = calls.get(callId);
    if (!call) {
      console.log('❌ Call not found for ending:', callId);
      return;
    }

    // Calculate call duration
    call.status = 'ended';
    call.endTime = new Date();
    call.duration = Math.floor((call.endTime - call.startTime) / 1000);

    // Notify both parties
    const caller = users.get(call.callerPhone);
    const receiver = users.get(call.receiverPhone);

    if (caller && caller.socketId) {
      io.to(caller.socketId).emit('callEnded', call);
    }
    if (receiver && receiver.socketId) {
      io.to(receiver.socketId).emit('callEnded', call);
    }

    // Remove call from active calls
    calls.delete(callId);

    console.log(`📞 Call ended:`, call.callerName, '->', call.receiverName, `(${call.duration}s)`);
  });

  // WebRTC Signaling - Handle offer
  socket.on('webrtcOffer', (data) => {
    const receiver = users.get(data.receiverPhone);
    if (receiver && receiver.socketId) {
      io.to(receiver.socketId).emit('webrtcOffer', {
        offer: data.offer,
        callerPhone: data.callerPhone,
        type: data.type
      });
    }
  });

  // WebRTC Signaling - Handle answer
  socket.on('webrtcAnswer', (data) => {
    const caller = users.get(data.callerPhone);
    if (caller && caller.socketId) {
      io.to(caller.socketId).emit('webrtcAnswer', {
        answer: data.answer
      });
    }
  });

  // WebRTC Signaling - Handle ICE candidates
  socket.on('webrtcIceCandidate', (data) => {
    const targetUser = users.get(data.targetPhone);
    if (targetUser && targetUser.socketId) {
      io.to(targetUser.socketId).emit('webrtcIceCandidate', {
        candidate: data.candidate
      });
    }
  });

  // Delete message
  socket.on('deleteMessage', (data) => {
    const user = getCurrentUser(socket.id);
    if (!user) {
      console.log('❌ User not found for delete operation');
      return;
    }

    const { messageId, deleteForEveryone } = data;
    console.log(`🗑️ Delete request: ${messageId}, forEveryone: ${deleteForEveryone} by ${user.name}`);
    
    if (deleteForEveryone) {
      // Delete for everyone - only if user owns the message
      let messageFound = false;
      for (const [conversationId, convMessages] of messages) {
        const message = convMessages.find(m => m._id === messageId);
        if (message) {
          // Check if user owns the message
          if (message.senderPhone !== user.phone) {
            console.log('❌ User cannot delete others messages for everyone');
            socket.emit('messageError', { message: 'You can only delete your own messages for everyone' });
            return;
          }
          
          message.isDeleted = true;
          message.deletedForEveryone = true;
          message.text = "This message was deleted";
          
          // Notify both users
          const sender = users.get(message.senderPhone);
          const receiver = users.get(message.receiverPhone);
          
          const deleteData = { 
            messageId, 
            deleteForEveryone: true,
            deletedText: "This message was deleted"
          };
          
          if (sender && sender.socketId) {
            io.to(sender.socketId).emit('messageDeleted', deleteData);
          }
          if (receiver && receiver.socketId) {
            io.to(receiver.socketId).emit('messageDeleted', deleteData);
          }
          
          console.log(`✅ Message deleted for everyone: ${messageId}`);
          messageFound = true;
          break;
        }
      }
      
      if (!messageFound) {
        console.log('❌ Message not found for deletion:', messageId);
      }
    } else {
      // Delete for me only
      if (!deletedMessages.has(user.phone)) {
        deletedMessages.set(user.phone, new Set());
      }
      deletedMessages.get(user.phone).add(messageId);
      
      socket.emit('messageDeleted', { 
        messageId, 
        deleteForEveryone: false,
        deletedText: "You deleted this message"
      });
      console.log(`✅ Message deleted for me only: ${messageId} by ${user.name}`);
    }
  });

  // Mark as read (blue ticks)
  socket.on('markAsRead', (messageId) => {
    const user = getCurrentUser(socket.id);
    if (!user) return;

    for (const [conversationId, convMessages] of messages) {
      const message = convMessages.find(m => m._id === messageId);
      if (message && message.receiverPhone === user.phone) {
        message.status = 'read';
        
        // Notify sender
        const sender = users.get(message.senderPhone);
        if (sender && sender.socketId) {
          io.to(sender.socketId).emit('messageStatus', {
            messageId: messageId,
            status: 'read'
          });
        }
        break;
      }
    }
  });

  // Load messages for conversation (filter deleted messages)
  socket.on('loadMessages', (data, callback) => {
    const currentUser = getCurrentUser(socket.id);
    if (!currentUser) {
      callback([]);
      return;
    }

    const conversationId = getConversationId(data.currentUserPhone, data.contactPhone);
    const conversationMessages = messages.get(conversationId) || [];
    
    // Filter out messages deleted by current user
    const userDeletedMessages = deletedMessages.get(currentUser.phone) || new Set();
    const filteredMessages = conversationMessages.filter(msg => 
      !userDeletedMessages.has(msg._id)
    );
    
    const sortedMessages = filteredMessages
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-100);
    
    console.log(`📨 Loading ${sortedMessages.length} messages for ${currentUser.name}`);
    callback(sortedMessages);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = getCurrentUser(socket.id);
    if (user) {
      user.isOnline = false;
      user.lastSeen = new Date();
      socket.broadcast.emit('userOffline', user._id);
      onlineUsers.delete(socket.id);
      
      // End any active calls user is involved in
      for (const [callId, call] of calls) {
        if (call.callerPhone === user.phone || call.receiverPhone === user.phone) {
          if (call.status === 'ongoing' || call.status === 'calling') {
            call.status = 'ended';
            call.endTime = new Date();
            call.duration = Math.floor((call.endTime - call.startTime) / 1000);
            
            const otherUserPhone = call.callerPhone === user.phone ? call.receiverPhone : call.callerPhone;
            const otherUser = users.get(otherUserPhone);
            
            if (otherUser && otherUser.socketId) {
              io.to(otherUser.socketId).emit('callEnded', call);
            }
            
            calls.delete(callId);
            console.log(`📞 Call ended due to disconnect: ${user.name}`);
          }
        }
      }
      
      console.log('User disconnected:', user.name);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💬 Socket.IO server ready for connections`);
  console.log(`📞 Call system: ENABLED`);
  console.log(`🎤 Voice messages: ENABLED`);
  console.log(`🗑️ Delete system: ENABLED`);
});