'use client';
import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";

type SocketType = ReturnType<typeof io>;

interface User {
  _id: string;
  name: string;
  phone: string;
  isOnline?: boolean;
  lastSeen?: Date;
}

interface Message {
  _id: string;
  text: string;
  senderId: string;
  receiverId: string;
  senderPhone: string;
  receiverPhone: string;
  timestamp: Date;
  status: 'sent' | 'delivered' | 'read';
  tempId?: string;
  conversationId: string;
  senderInfo?: User;
  replyTo?: string;
  isDeleted?: boolean;
  deletedForEveryone?: boolean;
  isVoiceMessage?: boolean;
  voiceUrl?: string;
  voiceDuration?: number;
}

interface Call {
  _id: string;
  callerId: string;
  receiverId: string;
  callerPhone: string;
  receiverPhone: string;
  callerName: string;
  receiverName: string;
  type: 'audio' | 'video';
  status: 'calling' | 'ongoing' | 'ended' | 'missed' | 'rejected';
  startTime: Date;
  endTime?: Date;
  duration?: number;
}

export default function Chatboard() {
  const [socket, setSocket] = useState<SocketType | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [contacts, setContacts] = useState<User[]>([]);
  const [selectedContact, setSelectedContact] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [showLogin, setShowLogin] = useState(true);
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [notification, setNotification] = useState<{message: string, type: string} | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [showShareModal, setShowShareModal] = useState(false);
  const [messageToShare, setMessageToShare] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  
  // Mobile states
  const [showMobileOptions, setShowMobileOptions] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Voice message states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isPlayingVoice, setIsPlayingVoice] = useState<string | null>(null);
  const [currentPlayingAudio, setCurrentPlayingAudio] = useState<HTMLAudioElement | null>(null);

  // Call states
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [ongoingCall, setOngoingCall] = useState<Call | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentUserRef = useRef<User | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // WebRTC configuration
  const rtcConfiguration: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update ref when currentUser changes
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Initialize socket with enhanced event handlers
  const initializeSocket = (user: User) => {
    const newSocket = io('http://localhost:5000', { 
      autoConnect: true,
      transports: ['websocket', 'polling']
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('register', user);
    });

    newSocket.on('registrationSuccess', (userData: User & { contacts?: User[] }) => {
      setCurrentUser(userData);
      currentUserRef.current = userData;
      
      if (userData.contacts) {
        setContacts(userData.contacts);
      } else {
        loadUserContacts();
      }
    });

    // Existing event handlers...
    newSocket.on('userOnline', (user: User) => {
      setContacts(prev => prev.map(contact => 
        contact.phone === user.phone ? { ...contact, isOnline: true } : contact
      ));
    });

    newSocket.on('userOffline', (userId: string) => {
      setContacts(prev => prev.map(contact => 
        contact._id === userId ? { ...contact, isOnline: false, lastSeen: new Date() } : contact
      ));
    });

    newSocket.on('contactAdded', (newContact: User) => {
      setContacts(prev => {
        const exists = prev.find(c => c.phone === newContact.phone);
        if (!exists) {
          showNotification(`New contact ${newContact.name} added automatically`, 'info');
          return [...prev, newContact];
        }
        return prev;
      });
    });

    // Message handler
    newSocket.on('newMessage', (message: Message) => {
      const currentUserPhone = currentUserRef.current?.phone;
      if (!currentUserPhone) return;

      const isRelevant = message.receiverPhone === currentUserPhone || 
                        message.senderPhone === currentUserPhone;
      
      if (isRelevant) {
        setMessages(prev => {
          const isDuplicate = prev.find(m => 
            m._id === message._id || 
            (m.tempId && m.tempId === message.tempId)
          );
          
          if (!isDuplicate) {
            if (message.senderPhone !== currentUserPhone) {
              const senderName = message.senderInfo?.name || 'Unknown User';
              if (message.isVoiceMessage) {
                showNotification(`Voice message from ${senderName}`, 'message');
              } else {
                showNotification(`New message from ${senderName}`, 'message');
              }
            }
            return [...prev, message];
          } else {
            return prev.map(m => 
              (m._id === message._id || (m.tempId && m.tempId === message.tempId)) 
                ? { ...m, status: message.status }
                : m
            );
          }
        });

        // Auto-mark as read if it's my message and I'm viewing the chat
        if (message.senderPhone !== currentUserPhone && selectedContact?.phone === message.senderPhone) {
          newSocket.emit('markAsRead', message._id);
        }

        // Auto-add contact
        if (message.senderPhone !== currentUserPhone && message.senderInfo) {
          setContacts(prev => {
            const exists = prev.find(c => c.phone === message.senderPhone);
            if (!exists && message.senderInfo) {
              const newContact: User = {
                _id: message.senderInfo._id,
                name: message.senderInfo.name,
                phone: message.senderInfo.phone,
                isOnline: true
              };
              return [...prev, newContact];
            }
            return prev;
          });
        }
      }
    });

    // Message status handler
    newSocket.on('messageStatus', (data: { messageId: string, status: string }) => {
      setMessages(prev => prev.map(m => 
        m._id === data.messageId ? { ...m, status: data.status as 'sent' | 'delivered' | 'read' } : m
      ));
    });

    // Handle message deletion
    newSocket.on('messageDeleted', (data: { messageId: string, deleteForEveryone: boolean, deletedText: string }) => {
      setMessages(prev => prev.map(m => 
        m._id === data.messageId 
          ? { 
              ...m, 
              text: data.deletedText, 
              isDeleted: true,
              deletedForEveryone: data.deleteForEveryone 
            }
          : m
      ));
    });

    // CALL SYSTEM EVENTS
    newSocket.on('incomingCall', (call: Call) => {
      setIncomingCall(call);
      // Play ringtone
      playRingtone();
      showNotification(`Incoming ${call.type} call from ${call.callerName}`, 'call');
    });

    newSocket.on('callStarted', (call: Call) => {
      setIsCalling(true);
      setCallType(call.type);
    });

    newSocket.on('callAccepted', (call: Call) => {
      setIncomingCall(null);
      setOngoingCall(call);
      setIsCalling(false);
      stopRingtone();
      startCallTimer();
    });

    newSocket.on('callRejected', (call: Call) => {
      setIncomingCall(null);
      setIsCalling(false);
      stopLocalStream();
      stopRingtone();
      showNotification(`${call.receiverName} rejected your call`, 'error');
    });

    newSocket.on('callEnded', (call: Call) => {
      handleCallEnd(call);
      stopRingtone();
      showNotification(`Call ended ${call.duration ? `(${formatCallDuration(call.duration)})` : ''}`, 'info');
    });

    // WebRTC Signaling
    newSocket.on('webrtcOffer', async (data: { offer: RTCSessionDescriptionInit, callerPhone: string, type: 'audio' | 'video' }) => {
      if (!peerConnection) await initializePeerConnection();
      
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        newSocket.emit('webrtcAnswer', {
          answer: answer,
          callerPhone: data.callerPhone
        });
      }
    });

    newSocket.on('webrtcAnswer', async (data: { answer: RTCSessionDescriptionInit }) => {
      if (!peerConnection) return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    });

    newSocket.on('webrtcIceCandidate', async (data: { candidate: RTCIceCandidateInit }) => {
      if (!peerConnection) return;
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    });

    newSocket.on('messageError', (data: { message: string }) => {
      showNotification(data.message, 'error');
    });

    newSocket.on('connect_error', (error: Error) => {
      showNotification('Connection failed', 'error');
    });

    return newSocket;
  };

  // VOICE MESSAGE FUNCTIONS
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      const recorder = new MediaRecorder(stream, { 
        mimeType: 'audio/webm;codecs=opus' 
      });
      
      const chunks: Blob[] = [];
      setAudioChunks(chunks);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        
        // Convert to base64 for sending via socket
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          sendVoiceMessage(base64Audio, recordingTime);
        };

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start(100); // Collect data every 100ms
      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 120) { // Max 2 minutes
            stopRecording();
            return 120;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (error) {
      console.error('Error starting recording:', error);
      showNotification('Microphone access denied or unavailable', 'error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      
      // Don't send if recording is too short
      if (recordingTime < 1) {
        showNotification('Recording too short', 'error');
        return;
      }
    }
  };

  const sendVoiceMessage = (audioData: string, duration: number) => {
    if (!selectedContact || !socket || !currentUser) return;

    const tempId = `voice_${Date.now()}`;
    const tempMsg: Message = {
      _id: tempId,
      text: 'Voice message',
      senderId: currentUser._id,
      receiverId: selectedContact._id,
      senderPhone: currentUser.phone,
      receiverPhone: selectedContact.phone,
      timestamp: new Date(),
      status: 'sent',
      tempId,
      conversationId: [currentUser.phone, selectedContact.phone].sort().join('_'),
      isVoiceMessage: true,
      voiceUrl: audioData,
      voiceDuration: duration
    };

    setMessages(prev => [...prev, tempMsg]);

    socket.emit('sendVoiceMessage', {
      receiverPhone: selectedContact.phone,
      audioData,
      duration,
      tempId
    });

    showNotification('Voice message sent', 'success');
  };

  const playVoiceMessage = async (message: Message) => {
    if (!message.voiceUrl) return;

    // Stop currently playing audio
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      setIsPlayingVoice(null);
    }

    const audio = new Audio(message.voiceUrl);
    setCurrentPlayingAudio(audio);
    setIsPlayingVoice(message._id);

    audio.onended = () => {
      setIsPlayingVoice(null);
      setCurrentPlayingAudio(null);
    };

    audio.onerror = () => {
      setIsPlayingVoice(null);
      setCurrentPlayingAudio(null);
      showNotification('Error playing voice message', 'error');
    };

    try {
      await audio.play();
    } catch (error) {
      console.error('Error playing audio:', error);
      showNotification('Error playing voice message', 'error');
    }
  };

  const stopVoiceMessage = () => {
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      setCurrentPlayingAudio(null);
    }
    setIsPlayingVoice(null);
  };

  // CALL SYSTEM FUNCTIONS
  const initializePeerConnection = async () => {
    const pc = new RTCPeerConnection(rtcConfiguration);
    
    pc.onicecandidate = (event) => {
      if (event.candidate && socket && selectedContact) {
        socket.emit('webrtcIceCandidate', {
          candidate: event.candidate,
          targetPhone: selectedContact.phone
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    // Add local stream if available
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    setPeerConnection(pc);
    return pc;
  };

  const startCall = async (type: 'audio' | 'video') => {
    if (!selectedContact || !socket || !currentUser) {
      showNotification('Please select a contact first', 'error');
      return;
    }

    if (!selectedContact.isOnline) {
      showNotification('Contact is offline', 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video' ? {
          width: 1280,
          height: 720,
          frameRate: 30
        } : false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setLocalStream(stream);
      setCallType(type);
      setIsCalling(true);

      const pc = await initializePeerConnection();
      
      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send call request
      socket.emit('startCall', {
        receiverPhone: selectedContact.phone,
        type: type
      });

      // Send WebRTC offer
      socket.emit('webrtcOffer', {
        receiverPhone: selectedContact.phone,
        offer: offer,
        type: type
      });

    } catch (error) {
      console.error('Error starting call:', error);
      showNotification('Failed to access camera/microphone', 'error');
      stopLocalStream();
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || !socket) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: incomingCall.type === 'video' ? {
          width: 1280,
          height: 720,
          frameRate: 30
        } : false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setLocalStream(stream);
      setOngoingCall(incomingCall);
      setIncomingCall(null);
      stopRingtone();

      await initializePeerConnection();
      socket.emit('acceptCall', incomingCall._id);
      startCallTimer();

    } catch (error) {
      console.error('Error accepting call:', error);
      showNotification('Failed to access camera/microphone', 'error');
      rejectCall();
    }
  };

  const rejectCall = () => {
    if (!incomingCall || !socket) return;
    
    socket.emit('rejectCall', incomingCall._id);
    setIncomingCall(null);
    stopRingtone();
  };

  // FIXED: endCall function with proper null handling
  const endCall = () => {
    if ((!ongoingCall && !isCalling) || !socket) return;
    
    const callToEnd = ongoingCall || incomingCall;
    
    if (!callToEnd && isCalling) {
      // Create a temporary call object for calls that haven't been fully established
      const tempCall: Call = {
        _id: `temp_${Date.now()}`,
        callerId: currentUser?._id || '',
        receiverId: selectedContact?._id || '',
        callerPhone: currentUser?.phone || '',
        receiverPhone: selectedContact?.phone || '',
        callerName: currentUser?.name || '',
        receiverName: selectedContact?.name || '',
        type: callType,
        status: 'ended',
        startTime: new Date(),
        endTime: new Date(),
        duration: 0
      };
      
      socket.emit('endCall', tempCall._id);
      handleCallEnd(tempCall);
      return;
    }
    
    if (callToEnd) {
      socket.emit('endCall', callToEnd._id);
      handleCallEnd(callToEnd);
    }
  };

  const handleCallEnd = (call: Call) => {
    setOngoingCall(null);
    setIsCalling(false);
    setIncomingCall(null);
    stopLocalStream();
    setRemoteStream(null);
    setIsMuted(false);
    setIsVideoOff(false);
    
    if (peerConnection) {
      peerConnection.close();
      setPeerConnection(null);
    }

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      setCallDuration(0);
    }

    console.log(`📞 Call ended: ${call.duration || 0}s`);
  };

  const stopLocalStream = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
      });
      setLocalStream(null);
    }
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = isVideoOff;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const startCallTimer = () => {
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const playRingtone = () => {
    // Create a simple ringtone using Web Audio API
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.value = 800;
      gainNode.gain.value = 0.1;
      
      oscillator.start();
      
      // Stop after 2 seconds and repeat
      setTimeout(() => {
        oscillator.stop();
      }, 2000);
      
      // Store for stopping
      (window as any).currentRingtone = oscillator;
    } catch (error) {
      console.error('Error playing ringtone:', error);
    }
  };

  const stopRingtone = () => {
    if ((window as any).currentRingtone) {
      (window as any).currentRingtone.stop();
    }
  };

  // Update video elements when streams change
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
    
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [localStream, remoteStream]);

  // Format call duration
  const formatCallDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Format recording time
  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Show notification
  const showNotification = (message: string, type: string = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Load user contacts from server
  const loadUserContacts = () => {
    if (!socket) return;
    
    socket.emit('getUserContacts', (serverContacts: User[]) => {
      setContacts(serverContacts);
    });
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark messages as read when chat is opened
  useEffect(() => {
    if (selectedContact && socket && currentUser) {
      messages.forEach(message => {
        if (message.senderPhone === selectedContact.phone && message.status === 'delivered') {
          socket.emit('markAsRead', message._id);
        }
      });
    }
  }, [selectedContact, messages, socket, currentUser]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socket) socket.disconnect();
      stopLocalStream();
      if (peerConnection) peerConnection.close();
      stopRingtone();
    };
  }, [socket, peerConnection]);

  // Load messages when contact selected
  useEffect(() => {
    if (selectedContact && socket && currentUser) {
      loadMessagesForContact(selectedContact);
    }
  }, [selectedContact, currentUser, socket]);

  const loadMessagesForContact = (contact: User) => {
    if (!socket || !currentUser) return;
    
    socket.emit('loadMessages', { 
      currentUserPhone: currentUser.phone, 
      contactPhone: contact.phone 
    }, (loaded: Message[]) => {
      const formatted = loaded.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp)
      }));
      setMessages(formatted);
    });
  };

  // Desktop: Handle message hover for options
  const handleMessageMouseEnter = (message: Message, e: React.MouseEvent) => {
    if (!isMobile) {
      setSelectedMessage(message);
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPosition({ x: rect.left, y: rect.top });
    }
  };

  const handleMessageMouseLeave = () => {
    if (!isMobile) {
      setSelectedMessage(null);
    }
  };

  // Mobile: Handle long press for options
  const handleMessageTouchStart = (message: Message) => {
    if (isMobile) {
      const timer = setTimeout(() => {
        setSelectedMessage(message);
        setShowMobileOptions(true);
      }, 500);
      setLongPressTimer(timer);
    }
  };

  const handleMessageTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const handleMessageTouchMove = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  // Desktop: Handle message click for menu
  const handleMessageClick = (e: React.MouseEvent, message: Message) => {
    if (!isMobile) {
      e.preventDefault();
      setSelectedMessage(message);
      setMenuPosition({ x: e.clientX, y: e.clientY });
      setShowMessageMenu(true);
    }
  };

  // Copy message text
  const copyMessage = () => {
    if (!selectedMessage) return;
    navigator.clipboard.writeText(selectedMessage.text);
    showNotification('Message copied to clipboard', 'success');
    setShowMessageMenu(false);
    setShowMobileOptions(false);
    setSelectedMessage(null);
  };

  // Share message
  const shareMessage = () => {
    if (!selectedMessage) return;
    setMessageToShare(selectedMessage);
    setShowShareModal(true);
    setShowMessageMenu(false);
    setShowMobileOptions(false);
    setSelectedMessage(null);
  };

  // Reply to message
  const replyToMessage = () => {
    if (!selectedMessage) return;
    setReplyTo(selectedMessage);
    setShowMessageMenu(false);
    setShowMobileOptions(false);
    setSelectedMessage(null);
    textAreaRef.current?.focus();
  };

  // Delete message
  const deleteMessage = (deleteForEveryone: boolean) => {
    if (!selectedMessage || !socket) return;
    
    socket.emit('deleteMessage', {
      messageId: selectedMessage._id,
      deleteForEveryone
    });
    
    setShowMessageMenu(false);
    setShowMobileOptions(false);
    setSelectedMessage(null);
    showNotification(deleteForEveryone ? 'Message deleted for everyone' : 'Message deleted for you', 'success');
  };

  // Share message with contact
  const shareWithContact = (contact: User) => {
    if (!messageToShare || !socket || !currentUser) return;
    
    const tempId = `temp_${Date.now()}`;
    
    const payload = {
      text: `Shared: ${messageToShare.text}`,
      receiverPhone: contact.phone,
      tempId,
      replyTo: undefined
    };

    socket.emit('sendMessage', payload);
    showNotification(`Message shared with ${contact.name}`, 'success');
    setShowShareModal(false);
    setMessageToShare(null);
  };

  // Close all menus when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowMessageMenu(false);
      setShowMobileOptions(false);
      setSelectedMessage(null);
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const registerUser = () => {
    if (!userName.trim() || !userPhone.trim()) {
      showNotification('Please enter name and phone', 'error');
      return;
    }
    
    const phoneRegex = /^\+92[0-9]{10}$/;
    if (!phoneRegex.test(userPhone)) {
      showNotification('Please enter valid phone: +923001234567', 'error');
      return;
    }

    const userId = `user_${userPhone.replace('+', '')}`;
    const user: User = { 
      _id: userId, 
      name: userName.trim(), 
      phone: userPhone.trim(), 
      isOnline: true 
    };
    
    setShowLogin(false);
    initializeSocket(user);
    showNotification('Registration successful!', 'success');
  };

  const addContact = () => {
    if (!newContactPhone.trim() || !socket) { 
      showNotification('Please enter phone number', 'error');
      return; 
    }
    
    const phoneRegex = /^\+92[0-9]{10}$/;
    if (!phoneRegex.test(newContactPhone)) { 
      showNotification('Please enter valid phone: +923001234567', 'error');
      return; 
    }

    if (newContactPhone === currentUser?.phone) {
      showNotification('Cannot add your own number', 'error');
      return;
    }

    socket.emit('addContact', newContactPhone, (response: { 
      success: boolean; 
      message: string; 
      contact?: User 
    }) => {
      if (response.success && response.contact) {
        setContacts(prev => [...prev, response.contact as User]);
        showNotification(`Contact ${response.contact.name} added successfully`, 'success');
        setNewContactPhone('');
        setIsAddingContact(false);
      } else {
        showNotification(response.message, 'error');
      }
    });
  };

  const removeContact = (contact: User) => {
    setContacts(prev => prev.filter(c => c.phone !== contact.phone));
    if (selectedContact?.phone === contact.phone) {
      setSelectedContact(null);
      setMessages([]);
    }
    showNotification('Contact removed', 'info');
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedContact || !socket || !currentUser) return;
    
    const tempId = `temp_${Date.now()}`;
    const tempMsg: Message = {
      _id: tempId,
      text: newMessage,
      senderId: currentUser._id,
      receiverId: selectedContact._id,
      senderPhone: currentUser.phone,
      receiverPhone: selectedContact.phone,
      timestamp: new Date(),
      status: 'sent',
      tempId,
      conversationId: [currentUser.phone, selectedContact.phone].sort().join('_'),
      replyTo: replyTo?._id
    };

    setMessages(prev => [...prev, tempMsg]);
    
    const payload = {
      text: newMessage,
      receiverPhone: selectedContact.phone,
      tempId,
      replyTo: replyTo?._id
    };

    setNewMessage('');
    setReplyTo(null);
    socket.emit('sendMessage', payload);
    
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleLogout = () => {
    if (socket) socket.disconnect();
    stopLocalStream();
    if (peerConnection) peerConnection.close();
    setCurrentUser(null);
    currentUserRef.current = null;
    setSelectedContact(null);
    setMessages([]);
    setShowLogin(true);
    showNotification('Logged out successfully', 'info');
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  // Get status icon based on message status
  const getStatusIcon = (status: 'sent' | 'delivered' | 'read') => {
    switch (status) {
      case 'sent':
        return <span className="text-gray-400">✓</span>;
      case 'delivered':
        return <span className="text-gray-400">✓✓</span>;
      case 'read':
        return <span className="text-blue-400">✓✓</span>;
      default:
        return <span className="text-gray-400">✓</span>;
    }
  };

  // Get replied message
  const getRepliedMessage = (replyToId: string) => {
    return messages.find(m => m._id === replyToId);
  };

  // Login UI
  if (showLogin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-green-600 to-blue-500 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-r from-green-600 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl mx-auto mb-4">💬</div>
            <h1 className="text-3xl font-bold text-gray-800">WhatsApp Clone</h1>
            <p className="text-gray-600 mt-2">Enter your details to start chatting</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Name *</label>
              <input 
                type="text" 
                value={userName} 
                onChange={(e) => setUserName(e.target.value)} 
                placeholder="Enter your full name" 
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number *</label>
              <input 
                type="text" 
                value={userPhone} 
                onChange={(e) => setUserPhone(e.target.value)} 
                placeholder="+923001234567" 
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200" 
              />
              <p className="text-xs text-gray-500 mt-1">Format: +923001234567</p>
            </div>
            <button 
              onClick={registerUser} 
              className="w-full bg-gradient-to-r from-green-600 to-blue-500 text-white py-3 rounded-lg hover:from-green-700 hover:to-blue-600 transition-all font-semibold"
            >
              Start Chatting
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
          notification.type === 'error' ? 'bg-red-500' : 
          notification.type === 'success' ? 'bg-green-500' : 
          notification.type === 'call' ? 'bg-orange-500' : 'bg-blue-500'
        } text-white`}>
          {notification.message}
        </div>
      )}

      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md text-center">
            <div className="w-20 h-20 bg-gradient-to-r from-green-600 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl mx-auto mb-4">
              {incomingCall.type === 'video' ? '📹' : '📞'}
            </div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">Incoming {incomingCall.type} Call</h3>
            <p className="text-gray-600 mb-1">{incomingCall.callerName}</p>
            <p className="text-gray-500 text-sm mb-6">{incomingCall.callerPhone}</p>
            <div className="flex space-x-4 justify-center">
              <button
                onClick={rejectCall}
                className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-lg"
              >
                <span className="text-2xl">✕</span>
              </button>
              <button
                onClick={acceptCall}
                className="w-16 h-16 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 transition-all shadow-lg"
              >
                <span className="text-2xl">✓</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ongoing Call Interface */}
      {ongoingCall && (
        <div className="fixed inset-0 bg-black z-50">
          {/* Remote Video */}
          {remoteStream && ongoingCall.type === 'video' && (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          )}
          
          {/* Local Video (Picture-in-Picture) */}
          {localStream && ongoingCall.type === 'video' && (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-24 right-4 w-32 h-48 object-cover rounded-lg border-2 border-white shadow-lg"
            />
          )}

          {/* Call Info */}
          <div className="absolute top-8 left-1/2 transform -translate-x-1/2 text-white text-center">
            <h3 className="text-2xl font-bold">{selectedContact?.name}</h3>
            <p className="text-lg">{formatCallDuration(callDuration)}</p>
            <p className="text-sm text-gray-300">{ongoingCall.type === 'video' ? 'Video Call' : 'Audio Call'}</p>
          </div>

          {/* Call Controls */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex space-x-6">
            {/* Mute Toggle */}
            <button 
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                isMuted ? 'bg-red-500' : 'bg-gray-600'
              } text-white hover:opacity-80`}
            >
              <span className="text-xl">{isMuted ? '🎤' : '🎤'}</span>
            </button>

            {/* End Call */}
            <button
              onClick={endCall}
              className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-lg"
            >
              <span className="text-2xl">✕</span>
            </button>

            {/* Video Toggle */}
            {ongoingCall.type === 'video' && (
              <button 
                onClick={toggleVideo}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                  isVideoOff ? 'bg-red-500' : 'bg-gray-600'
                } text-white hover:opacity-80`}
              >
                <span className="text-xl">{isVideoOff ? '📹' : '📹'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Outgoing Call Interface */}
      {isCalling && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md text-center">
            <div className="w-20 h-20 bg-gradient-to-r from-green-600 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl mx-auto mb-4">
              {callType === 'video' ? '📹' : '📞'}
            </div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">Calling...</h3>
            <p className="text-gray-600 mb-1">{selectedContact?.name}</p>
            <p className="text-gray-500 text-sm mb-6">{selectedContact?.phone}</p>
            <button
              onClick={endCall}
              className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-all mx-auto shadow-lg"
            >
              <span className="text-2xl">✕</span>
            </button>
          </div>
        </div>
      )}

      {/* Sidebar - Hidden on mobile when chat is open */}
      <div className={`${isMobile && selectedContact ? 'hidden' : 'flex'} w-full md:w-1/3 bg-white border-r border-gray-200 flex-col`}>
        {/* User Profile */}
        <div className="p-4 bg-gradient-to-r from-green-600 to-blue-500 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <span className="text-lg">👤</span>
              </div>
              <div>
                <h2 className="font-semibold">{currentUser?.name}</h2>
                <p className="text-sm opacity-90">{currentUser?.phone}</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="text-white/80 hover:text-white text-sm"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Add Contact */}
        <div className="p-4 border-b border-gray-200">
          <button 
            onClick={() => setIsAddingContact(true)}
            className="w-full bg-gradient-to-r from-green-600 to-blue-500 text-white py-2 rounded-lg font-semibold hover:from-green-700 hover:to-blue-600 transition-all"
          >
            + Add Contact
          </button>
        </div>

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <div className="text-center text-gray-500 p-8">
              <p>No contacts yet. Add someone to start chatting!</p>
            </div>
          ) : (
            contacts.map(contact => (
              <div 
                key={contact._id}
                onClick={() => {
                  setSelectedContact(contact);
                  if (isMobile) {
                    // On mobile, hide sidebar when contact is selected
                  }
                }}
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                  selectedContact?._id === contact._id ? 'bg-blue-50 border-blue-200' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <div className="w-12 h-12 bg-gradient-to-r from-green-600 to-blue-500 rounded-full flex items-center justify-center text-white">
                        <span className="text-sm">👤</span>
                      </div>
                      <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${
                        contact.isOnline ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800">{contact.name}</h3>
                      <p className="text-sm text-gray-600">{contact.phone}</p>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      removeContact(contact);
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`${isMobile && !selectedContact ? 'hidden' : 'flex'} flex-1 flex-col`}>
        {selectedContact ? (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {isMobile && (
                    <button 
                      onClick={() => setSelectedContact(null)}
                      className="text-gray-600 hover:text-gray-800"
                    >
                      ←
                    </button>
                  )}
                  <div className="relative">
                    <div className="w-10 h-10 bg-gradient-to-r from-green-600 to-blue-500 rounded-full flex items-center justify-center text-white">
                      <span className="text-sm">👤</span>
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${
                      selectedContact.isOnline ? 'bg-green-500' : 'bg-gray-400'
                    }`} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-800">{selectedContact.name}</h2>
                    <p className="text-sm text-gray-600">
                      {selectedContact.isOnline ? 'Online' : 'Offline'}
                    </p>
                  </div>
                </div>
                
                {/* Call Buttons */}
                <div className="flex space-x-2">
                  <button
                    onClick={() => startCall('audio')}
                    disabled={!selectedContact.isOnline}
                    className="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Audio Call"
                  >
                    <span className="text-lg">📞</span>
                  </button>
                  <button
                    onClick={() => startCall('video')}
                    disabled={!selectedContact.isOnline}
                    className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Video Call"
                  >
                    <span className="text-lg">📹</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              {messages.length === 0 ? (
                <div className="text-center text-gray-500 p-8">
                  <p>No messages yet. Start a conversation!</p>
                </div>
              ) : (
                messages.map(message => (
                  <div
                    key={message._id}
                    className={`flex mb-4 ${
                      message.senderPhone === currentUser?.phone ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl cursor-pointer relative group ${
                        message.senderPhone === currentUser?.phone
                          ? 'bg-gradient-to-r from-green-600 to-blue-500 text-white rounded-br-none hover:from-green-700 hover:to-blue-600'
                          : 'bg-white text-gray-800 rounded-bl-none border border-gray-200 hover:bg-gray-50'
                      } ${message.isDeleted ? 'italic text-gray-500' : ''}`}
                      onClick={(e) => handleMessageClick(e, message)}
                      onMouseEnter={(e) => handleMessageMouseEnter(message, e)}
                      onMouseLeave={handleMessageMouseLeave}
                      onTouchStart={() => handleMessageTouchStart(message)}
                      onTouchEnd={handleMessageTouchEnd}
                      onTouchMove={handleMessageTouchMove}
                    >
                      {message.isVoiceMessage ? (
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={() => isPlayingVoice === message._id ? stopVoiceMessage() : playVoiceMessage(message)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                              isPlayingVoice === message._id 
                                ? 'bg-red-500 text-white' 
                                : 'bg-white/20 text-white'
                            }`}
                          >
                            <span className="text-sm">
                              {isPlayingVoice === message._id ? '⏹️' : '▶️'}
                            </span>
                          </button>
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <div className="w-24 h-2 bg-white/30 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-white transition-all duration-100"
                                  style={{ 
                                    width: isPlayingVoice === message._id ? '50%' : '0%' 
                                  }}
                                />
                              </div>
                              <span className="text-xs opacity-80">
                                {message.voiceDuration}s
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Reply Preview */}
                          {message.replyTo && (
                            <div className={`text-xs p-2 rounded mb-2 border-l-4 ${
                              message.senderPhone === currentUser?.phone 
                                ? 'bg-white/20 border-white/50' 
                                : 'bg-gray-100 border-gray-300'
                            }`}>
                              Replying to: {getRepliedMessage(message.replyTo)?.text || 'Message not found'}
                            </div>
                          )}

                          <p className="text-sm">{message.text}</p>
                          
                          <div className={`text-xs mt-1 flex items-center ${
                            message.senderPhone === currentUser?.phone ? 'text-white/80' : 'text-gray-500'
                          }`}>
                            <span>{formatTime(message.timestamp)}</span>
                            {message.senderPhone === currentUser?.phone && (
                              <span className="ml-2">
                                {getStatusIcon(message.status)}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Enhanced Message Input with Voice Recording */}
            <div className="bg-white border-t border-gray-200 p-4">
              {/* Reply Preview */}
              {replyTo && (
                <div className="bg-gray-100 rounded-lg p-2 mb-2 flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-xs text-gray-600">Replying to:</p>
                    <p className="text-sm truncate">{replyTo.text}</p>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="flex space-x-2 items-end">
                {/* Voice Recording Button */}
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isRecording 
                      ? 'bg-red-500 text-white animate-pulse' 
                      : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                  title="Hold to record voice message"
                >
                  <span className="text-lg">
                    {isRecording ? '⏹️' : '🎤'}
                  </span>
                </button>

                {/* Recording Timer */}
                {isRecording && (
                  <div className="flex items-center space-x-2 text-red-500 animate-pulse">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <span className="text-sm font-medium">
                      {formatRecordingTime(recordingTime)}
                    </span>
                    <span className="text-xs text-gray-500">(Hold to record)</span>
                  </div>
                )}

                {/* Text Input */}
                <textarea
                  ref={textAreaRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Type a message or hold mic to record..."
                  rows={1}
                  className="flex-1 border border-gray-300 rounded-full px-4 py-2 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 resize-none"
                  style={{ minHeight: '40px', maxHeight: '120px' }}
                />

                {/* Send Button */}
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="bg-gradient-to-r from-green-600 to-blue-500 text-white px-6 py-2 rounded-full hover:from-green-700 hover:to-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">💬</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">No Chat Selected</h3>
              <p>Select a contact to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      {isAddingContact && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-4">Add New Contact</h3>
            <input
              type="text"
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
              placeholder="Enter phone number: +923001234567"
              className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 mb-4"
            />
            <div className="flex space-x-2">
              <button
                onClick={() => setIsAddingContact(false)}
                className="flex-1 bg-gray-500 text-white py-3 rounded-lg hover:bg-gray-600 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={addContact}
                className="flex-1 bg-gradient-to-r from-green-600 to-blue-500 text-white py-3 rounded-lg hover:from-green-700 hover:to-blue-600 transition-all"
              >
                Add Contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}