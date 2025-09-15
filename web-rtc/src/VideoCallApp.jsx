import React, { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, MessageCircle, Users, Copy, Check } from 'lucide-react';
import io from 'socket.io-client';
import CameraComponent from './startCamera';

// Real Socket.IO client connection
const useSocket = () => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    console.log('Attempting to connect to server...');
    
    // Connect to backend server
    const newSocket = io('https://api.stechooze.com', {
      cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling'],
      timeout: 5000,
      forceNew: true
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to server:', newSocket.id);
      setConnected(true);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from server:', reason);
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('🔥 Connection error:', error.message);
      console.error('Error details:', error);
      setConnected(false);
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Reconnected after', attemptNumber, 'attempts');
      setConnected(true);
    });

    newSocket.on('reconnect_error', (error) => {
      console.error('🔄 Reconnection failed:', error);
    });

    setSocket(newSocket);
    
    return () => {
      console.log('Cleaning up socket connection...');
      newSocket.close();
    };
  }, []);

  return { socket, connected };
};

const VideoCallApp = () => {
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [joined, setJoined] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [copied, setCopied] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const remoteVideoRefs = useRef({});

  const { socket, connected } = useSocket();

  // Ensure video element gets the stream when it becomes available
  useEffect(() => {
    if (localStreamRef.current && localVideoRef.current && !localVideoRef.current.srcObject) {
      console.log('Setting delayed video srcObject...');
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [joined, localStreamRef.current]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    // Listen for user joining
    socket.on('user-joined', (data) => {
      console.log('User joined:', data);
      setParticipants(prev => [...prev, { id: data.userId, name: data.userName }]);
      setMessages(prev => [...prev, {
        id: Date.now(),
        message: `${data.userName} joined the call`,
        userName: 'System',
        timestamp: new Date().toISOString()
      }]);
      handleUserJoined(data);
    });

    // Listen for user leaving
    socket.on('user-left', (data) => {
      console.log('User left:', data);
      setParticipants(prev => prev.filter(p => p.id !== data.userId));
      setMessages(prev => [...prev, {
        id: Date.now(),
        message: `${data.userName} left the call`,
        userName: 'System',
        timestamp: new Date().toISOString()
      }]);
      
      // Clean up peer connection
      if (peersRef.current[data.userId]) {
        peersRef.current[data.userId].close();
        delete peersRef.current[data.userId];
      }
      
      // Remove remote stream
      setRemoteStreams(prev => {
        const newStreams = { ...prev };
        delete newStreams[data.userId];
        return newStreams;
      });
    });

    // Listen for existing users
    socket.on('existing-users', (users) => {
      console.log('Existing users:', users);
      setParticipants(users.map(user => ({ id: user.id, name: user.name })));
      initializePeerConnections(users);
    });

    // Listen for WebRTC signaling
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);

    // Listen for chat messages
    socket.on('receive-message', (data) => {
      console.log('Message received:', data);
      setMessages(prev => [...prev, {
        id: Date.now(),
        message: data.message,
        userName: data.userName,
        timestamp: data.timestamp
      }]);
    });

    return () => {
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('existing-users');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('receive-message');
    };
  }, [socket]);

  // Generate random room ID
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 15);
  };

  // Create peer connection
  const createPeerConnection = (userId) => {
    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    // Add local stream to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      console.log('Remote stream received from:', userId);
      const remoteStream = event.streams[0];
      setRemoteStreams(prev => ({
        ...prev,
        [userId]: remoteStream
      }));
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          targetUserId: userId
        });
      }
    };

    return peerConnection;
  };

  // Initialize peer connection for existing users
  const initializePeerConnections = (existingUsers) => {
    existingUsers.forEach(user => {
      if (user.id !== socket.id) {
        const peerConnection = createPeerConnection(user.id);
        peersRef.current[user.id] = peerConnection;
      }
    });
  };

  // Handle new user joining
  const handleUserJoined = async (data) => {
    console.log('New user joined:', data);
    const { userId, userName } = data;
    
    // Create peer connection for new user
    const peerConnection = createPeerConnection(userId);
    peersRef.current[userId] = peerConnection;

    // Create offer
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      socket.emit('offer', {
        offer: offer,
        targetUserId: userId
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  // Handle incoming offer
  const handleOffer = async (data) => {
    const { offer, fromUserId, fromUserName } = data;
    console.log('Received offer from:', fromUserName);
    
    const peerConnection = createPeerConnection(fromUserId);
    peersRef.current[fromUserId] = peerConnection;

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socket.emit('answer', {
        answer: answer,
        targetUserId: fromUserId
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  // Handle incoming answer
  const handleAnswer = async (data) => {
    const { answer, fromUserId } = data;
    console.log('Received answer from:', fromUserId);
    
    const peerConnection = peersRef.current[fromUserId];
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  };

  // Handle ICE candidate
  const handleIceCandidate = async (data) => {
    const { candidate, fromUserId } = data;
    console.log('Received ICE candidate from:', fromUserId);
    
    const peerConnection = peersRef.current[fromUserId];
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  };

  // Copy room ID to clipboard
  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Get user media
  const getUserMedia = async () => {
    try {
      console.log('Requesting camera and microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: true
      });
      
      console.log('Media stream obtained:', stream);
      console.log('Video tracks:', stream.getVideoTracks());
      console.log('Audio tracks:', stream.getAudioTracks());
      
      localStreamRef.current = stream;
      
      // Wait for video element to be ready
      if (localVideoRef.current) {
        console.log('Setting video srcObject...');
        localVideoRef.current.srcObject = stream;
        
        // Add event listeners for debugging
        localVideoRef.current.onloadedmetadata = () => {
          console.log('Video metadata loaded');
        };
        
        localVideoRef.current.oncanplay = () => {
          console.log('Video can play');
        };
        
        localVideoRef.current.onplay = () => {
          console.log('Video started playing');
        };
        
        localVideoRef.current.onerror = (error) => {
          console.error('Video error:', error);
        };
      } else {
        console.error('localVideoRef.current is null');
      }
      
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      console.error('Error details:', error);
      
      let errorMessage = 'Could not access camera/microphone. ';
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera and microphone permissions.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No camera or microphone found.';
      } else if (error.name === 'NotReadableError') {
        errorMessage += 'Camera or microphone is being used by another application.';
      } else {
        errorMessage += 'Please check your device settings.';
      }
      
      alert(errorMessage);
      throw error;
    }
  };

  // Join room
  const joinRoom = async () => {
    console.log('Join room clicked');
    console.log('Room ID:', roomId);
    console.log('User Name:', userName);
    console.log('Socket:', socket);
    console.log('Connected:', connected);

    if (!roomId.trim() || !userName.trim()) {
      alert('Please enter both room ID and your name');
      return;
    }

    if (!socket || !connected) {
      alert('Not connected to server. Please wait and try again.');
      console.error('Cannot join room - not connected to server');
      return;
    }

    try {
      console.log('Getting user media...');
      await getUserMedia();
      console.log('User media obtained successfully');
      
      console.log('Emitting join-room event...');
      // Join room on server
      socket.emit('join-room', { roomId, userName });
      console.log('Join-room event emitted');
      
      setJoined(true);
      console.log('Set joined to true');
      
      // Add welcome message
      setMessages([{
        id: Date.now(),
        message: `Welcome to room ${roomId}!`,
        userName: 'System',
        timestamp: new Date().toISOString()
      }]);
      
      // Add self as participant
      setParticipants([{ id: socket.id, name: userName }]);
      console.log('Room joined successfully');
      
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Could not access camera/microphone. Please check permissions.');
    }
  };

  // Leave call
  const leaveCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (socket) {
      socket.disconnect();
    }
    
    setJoined(false);
    setRoomId('');
    setUserName('');
    setMessages([]);
    setParticipants([]);
    peersRef.current = {};
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
      }
    }
  };

  // Send message
  const sendMessage = () => {
    if (message.trim() && socket) {
      socket.emit('send-message', { message, roomId });
      setMessage('');
    }
  };

  // Join room screen
  if (!joined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background Animation */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 via-purple-600/20 to-pink-600/20 animate-pulse"></div>
        <div className="absolute top-0 left-0 w-full h-full opacity-30" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }}></div>
        
        <div className="relative z-10 bg-white/10 backdrop-blur-xl rounded-2xl p-8 w-full max-w-md border border-white/20 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
              <Video className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-3 bg-gradient-to-r from-white to-blue-200 bg-clip-text text-transparent">
              VideoCall Pro
            </h1>
            <p className="text-white/80 text-lg">Connect with anyone, anywhere, anytime</p>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="block text-white/90 text-sm font-semibold">
                Your Name
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-4 bg-white/15 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all duration-300 backdrop-blur-sm"
                placeholder="Enter your display name"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-white/90 text-sm font-semibold">
                Room ID
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="flex-1 px-4 py-4 bg-white/15 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all duration-300 backdrop-blur-sm"
                  placeholder="Enter or generate room ID"
                />
                <button
                  onClick={() => setRoomId(generateRoomId())}
                  className="px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  Generate
                </button>
              </div>
            </div>

            <button
              onClick={joinRoom}
              disabled={!connected}
              className="w-full bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white py-4 rounded-xl font-bold text-lg transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none disabled:shadow-none"
            >
              {connected ? '🚀 Join Room' : '⏳ Connecting to Server...'}
            </button>
            
            {!connected && (
              <div className="text-center mt-4">
                <p className="text-red-400 text-sm">Server connection failed</p>
                <p className="text-white/60 text-xs">Make sure backend server is running on port 5000</p>
              </div>
            )}
          </div>

          <div className="mt-8 text-center">
            <p className="text-white/60 text-sm mb-4">Powered by WebRTC Technology</p>
            <div className="flex justify-center space-x-4 text-white/40">
              <span className="text-xs">🔒 Secure</span>
              <span className="text-xs">⚡ Fast</span>
              <span className="text-xs">🌐 Cross-Platform</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main call interface
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex flex-col relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Cpath d='M20 20c0 11.046-8.954 20-20 20v20h40V20c-11.046 0-20-8.954-20-20z'/%3E%3C/g%3E%3C/svg%3E")`
      }}></div>
      
      {/* Header */}
      <div className="relative z-10 bg-black/20 backdrop-blur-xl border-b border-white/10 p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Video className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-white font-bold text-lg">Room: {roomId}</span>
                <p className="text-white/60 text-sm">Active Call</p>
              </div>
            </div>
            <button
              onClick={copyRoomId}
              className="flex items-center space-x-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-all duration-300 backdrop-blur-sm border border-white/20"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied!' : 'Copy Room ID'}</span>
            </button>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-3 py-2 bg-white/10 rounded-lg backdrop-blur-sm border border-white/20">
              <Users className="w-4 h-4 text-green-400" />
              <span className="text-white font-medium">{participants.length}</span>
              <span className="text-white/60 text-sm">Participants</span>
            </div>
            <button
              onClick={() => setShowChat(!showChat)}
              className={`p-3 rounded-xl transition-all duration-300 shadow-lg transform hover:scale-105 ${
                showChat 
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-blue-500/25' 
                  : 'bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/20'
              }`}
            >
              <MessageCircle className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex relative z-10">
        {/* Video Area */}
        <div className="flex-1 p-6">
          <div className="h-full max-w-6xl mx-auto">
            {/* Video Grid */}
            <div className="grid gap-4 h-full" style={{
              gridTemplateColumns: participants.length === 1 ? '1fr' : 
                                  participants.length === 2 ? '1fr 1fr' : 
                                  participants.length <= 4 ? '1fr 1fr' : 
                                  '1fr 1fr 1fr',
              gridTemplateRows: participants.length <= 2 ? '1fr' : 
                               participants.length <= 4 ? '1fr 1fr' : 
                               '1fr 1fr'
            }}>
              
              {/* Local Video */}
              <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10 backdrop-blur-sm min-h-[300px]">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  style={{ backgroundColor: '#1f2937' }}
                />

                {/* Debug info - remove this in production */}
                <div className="absolute top-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                  Stream: {localStreamRef.current ? '✅' : '❌'} | 
                  Video: {localVideoRef.current?.srcObject ? '✅' : '❌'}
                </div>

                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white px-3 py-2 rounded-lg text-sm font-medium border border-white/20">
                  <span className="text-green-400">●</span> {userName} (You)
                </div>
                
                {/* Show when video is off */}
                {!isVideoOn && (
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3 border border-red-500/30">
                        <VideoOff className="w-8 h-8 text-red-400" />
                      </div>
                      <p className="text-gray-300 font-medium text-sm">Video Off</p>
                    </div>
                  </div>
                )}
                
                {/* Show when no stream is available */}
                {isVideoOn && !localStreamRef.current && (
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-3 border border-yellow-500/30">
                        <Video className="w-8 h-8 text-yellow-400" />
                      </div>
                      <p className="text-gray-300 font-medium text-sm">Loading Camera...</p>
                      <p className="text-gray-400 text-xs mt-1">Please allow camera permissions</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Remote Videos */}
              {participants.filter(p => p.id !== socket.id).map((participant) => (
                <div key={participant.id} className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10 backdrop-blur-sm min-h-[300px]">
                  <video
                    ref={(el) => {
                      if (el && remoteStreams[participant.id]) {
                        el.srcObject = remoteStreams[participant.id];
                      }
                      remoteVideoRefs.current[participant.id] = el;
                    }}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white px-3 py-2 rounded-lg text-sm font-medium border border-white/20">
                    <span className="text-blue-400">●</span> {participant.name}
                  </div>
                  {!remoteStreams[participant.id] && (
                    <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-gray-500/20 rounded-full flex items-center justify-center mx-auto mb-3 border border-gray-500/30">
                          <Video className="w-8 h-8 text-gray-400" />
                        </div>
                        <p className="text-gray-300 font-medium text-sm">Connecting...</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex justify-center mt-8 space-x-6">
            <button
              onClick={toggleVideo}
              className={`p-5 rounded-2xl transition-all duration-300 shadow-lg transform hover:scale-110 ${
                isVideoOn 
                  ? 'bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/20' 
                  : 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/25'
              }`}
            >
              {isVideoOn ? <Video className="w-7 h-7" /> : <VideoOff className="w-7 h-7" />}
            </button>

            <button
              onClick={toggleAudio}
              className={`p-5 rounded-2xl transition-all duration-300 shadow-lg transform hover:scale-110 ${
                isAudioOn 
                  ? 'bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/20' 
                  : 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/25'
              }`}
            >
              {isAudioOn ? <Mic className="w-7 h-7" /> : <MicOff className="w-7 h-7" />}
            </button>

            <button
              onClick={leaveCall}
              className="p-5 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-2xl transition-all duration-300 shadow-lg shadow-red-500/25 transform hover:scale-110"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </div>
        </div>

        {/* Chat Panel */}
        {showChat && (
          <div className="w-96 bg-black/20 backdrop-blur-xl border-l border-white/10 flex flex-col shadow-2xl">
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">Chat</h3>
                  <p className="text-white/60 text-sm">{messages.length} messages</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="text-blue-400 text-sm font-semibold">
                      {msg.userName}
                    </span>
                    <span className="text-white/50 text-xs">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-white text-sm leading-relaxed">{msg.message}</p>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <MessageCircle className="w-12 h-12 text-white/30 mx-auto mb-3" />
                  <p className="text-white/50">No messages yet</p>
                  <p className="text-white/30 text-sm">Start the conversation!</p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/10">
              <div className="flex space-x-3">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  className="flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all duration-300 backdrop-blur-sm"
                  placeholder="Type a message..."
                />
                <button
                  onClick={sendMessage}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCallApp;