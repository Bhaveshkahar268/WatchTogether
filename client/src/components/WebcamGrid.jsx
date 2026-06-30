import React, { useEffect, useRef, useState } from 'react';
import { Video, VideoOff, Mic, MicOff, Monitor, MonitorOff, User, Crown } from 'lucide-react';

// Helper to modify WebRTC Session Description Protocol (SDP) to boost stream bitrate (eliminates lag/choppiness)
const setSDPBitrate = (sdp, bitrateKbps = 6000) => {
  const lines = sdp.split('\r\n');
  let lineIndex = -1;
  
  // Find the video media description section (m=video)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('m=video') === 0) {
      lineIndex = i;
      break;
    }
  }
  
  if (lineIndex === -1) {
    return sdp;
  }
  
  // Check if bandwidth limit line (b=AS) already exists in this section and update it, or insert a new one
  let hasAS = false;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    if (lines[i].indexOf('m=') === 0) break; // Reached next media section, stop
    if (lines[i].indexOf('b=AS:') === 0) {
      lines[i] = `b=AS:${bitrateKbps}`;
      hasAS = true;
      break;
    }
  }
  
  if (!hasAS) {
    lines.splice(lineIndex + 1, 0, `b=AS:${bitrateKbps}`);
  }
  
  // Inject Chrome/Safari specific max-bitrate parameters in format parameters (a=fmtp)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('a=fmtp:') === 0) {
      if (lines[i].indexOf('x-google-max-bitrate') === -1) {
        lines[i] = lines[i] + `;x-google-max-bitrate=${bitrateKbps};x-google-min-bitrate=1500;x-google-start-bitrate=3000`;
      }
    }
  }
  
  return lines.join('\r\n');
};

export default function WebcamGrid({
  socket,
  roomId,
  user,
  roomUsers,
  hostSocketId,
  isScreenShareActive,
  onScreenShareStream,
  onScreenShareToggle,
  localScreenStream,
  setLocalScreenStream,
  isFullscreenRoom,
  showControls
}) {
  const [localStream, setLocalStream] = useState(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [remoteStreams, setRemoteStreams] = useState({}); // { [socketId]: MediaStream }
  
  const localVideoRef = useRef(null);
  const peerConnections = useRef({}); // { [socketId]: RTCPeerConnection }
  const screenConnections = useRef({}); // { [socketId]: RTCPeerConnection } - separate mesh for screen share to keep it clean and robust
  const localStreamRef = useRef(null);
  const localScreenStreamRef = useRef(null); // Ref to hold the latest screen share stream and avoid stale closures
  const stopScreenShareRef = useRef(null); // Ref to call the latest stopScreenShare function from native events
  
  // Keep track of active WebRTC track senders to replace them reliably on toggles (avoids lookup collisions)
  const peerSenders = useRef({}); // { [peerId]: { videoSender, audioSender } }

  // Buffers for WebRTC ICE candidates arriving before Remote Description is set (eliminates signaling race conditions)
  const webcamCandidatesBuffer = useRef({}); // { [senderSocketId]: [] }
  const screenCandidatesBuffer = useRef({}); // { [senderSocketId]: [] }

  const isHost = socket && socket.id === hostSocketId;

  // Keep stopScreenShareRef updated with latest function to prevent native onended event closure stale issues
  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  });

  // Draggable window coordinates for each card in fullscreen room mode
  const [cardPositions, setCardPositions] = useState({}); // { [id]: { left, top, width, height } }
  const activeDragCard = useRef(null);

  const handleCardMouseDown = (id, e) => {
    // Only drag if click is not on control buttons
    if (e.target.closest('button')) return;
    
    const cardElement = e.currentTarget;
    const rect = cardElement.getBoundingClientRect();
    
    // If click is in the bottom-right resize handler zone, do not drag!
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    if (rect.width - mouseX < 20 && rect.height - mouseY < 20) {
      // Resize is occurring, register a listener on mouseup to store the final width/height in state!
      const handleResizeMouseUp = () => {
        const finalRect = cardElement.getBoundingClientRect();
        setCardPositions(prev => ({
          ...prev,
          [id]: {
            ...prev[id],
            width: `${finalRect.width}px`,
            height: `${finalRect.height}px`,
          }
        }));
        document.removeEventListener('mouseup', handleResizeMouseUp);
      };
      document.addEventListener('mouseup', handleResizeMouseUp);
      return;
    }
    
    // Parent coordinates relative to absolute layout container
    const parentRect = cardElement.offsetParent ? cardElement.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    
    activeDragCard.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: cardPositions[id]?.left !== undefined ? cardPositions[id].left : (rect.left - parentRect.left),
      startTop: cardPositions[id]?.top !== undefined ? cardPositions[id].top : (rect.top - parentRect.top),
    };

    // Define local handlers for mousemove and mouseup. Since they are declared locally inside mousedown,
    // they close over the exact variables, and removeEventListener will successfully find the exact same function reference.
    const onMouseMove = (moveEvent) => {
      if (!activeDragCard.current) return;
      const { id: dragId, startX, startY, startLeft, startTop } = activeDragCard.current;
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      setCardPositions(prev => ({
        ...prev,
        [dragId]: {
          ...prev[dragId],
          left: startLeft + deltaX,
          top: startTop + deltaY,
        }
      }));
    };

    const onMouseUp = () => {
      activeDragCard.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const getCardStyle = (id, index) => {
    if (!isFullscreenRoom) {
      return styles.webcamCard;
    }
    
    const pos = cardPositions[id] || {};
    return {
      ...styles.webcamCard,
      aspectRatio: 'auto', // disable aspect ratio in fullscreen to allow resizing
      position: 'absolute',
      left: pos.left !== undefined ? `${pos.left}px` : `${index * 220 + 24}px`,
      top: pos.top !== undefined ? `${pos.top}px` : 'auto',
      bottom: pos.top !== undefined ? 'auto' : '24px',
      zIndex: activeDragCard.current?.id === id ? 10001 : 10000,
      cursor: 'move',
      resize: 'both',
      width: pos.width || '200px',
      height: pos.height || '140px',
    };
  };

  const getControlsBarStyle = () => {
    if (!isFullscreenRoom) {
      return styles.controlsBar;
    }
    return {
      ...styles.controlsBar,
      position: 'absolute',
      bottom: '24px',
      left: '50%',
      transform: showControls ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(20px)',
      opacity: showControls ? 1 : 0,
      pointerEvents: showControls ? 'auto' : 'none',
      transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      zIndex: 10002,
      backgroundColor: 'rgba(15, 18, 37, 0.85)',
      backdropFilter: 'blur(16px)',
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
      border: '1px solid var(--border-glass-light)',
      padding: '10px 24px',
      borderRadius: '30px',
      width: 'auto',
      display: 'flex',
    };
  };

  // WebRTC ICE configuration
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ]
  };

  // 1. Initialize local camera/mic stream (Strict-Mode safe with cleanup checks)
  useEffect(() => {
    let isMounted = true;

    const acquireMedia = async () => {
      try {
        // Try HD first
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          }, 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        handleStreamSuccess(stream);
      } catch (err) {
        console.warn('Failed to get HD video, trying standard video:', err);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
          });
          handleStreamSuccess(stream);
        } catch (err2) {
          if (!isMounted) return;
          console.warn('Failed to get standard video, trying audio only:', err2);
          setCameraEnabled(false);
          socket.emit('update-media-status', { cameraOn: false });
          
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
              video: false, 
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            });
            handleStreamSuccess(stream);
          } catch (err3) {
            if (!isMounted) return;
            console.error('All media acquisition failed:', err3);
            setMicEnabled(false);
            socket.emit('update-media-status', { micOn: false });
            socket.emit('request-peers');
          }
        }
      }
    };

    const handleStreamSuccess = (stream) => {
      if (!isMounted) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      setLocalStream(stream);
      localStreamRef.current = stream;

      // If any peer connections were created early, push local tracks to them now!
      Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
        const senders = pc.getSenders();
        stream.getTracks().forEach(track => {
          const alreadyAdded = senders.some(s => s.track && s.track.kind === track.kind);
          if (!alreadyAdded) {
            const sender = pc.addTrack(track, stream);
            if (!peerSenders.current[peerId]) {
              peerSenders.current[peerId] = { videoSender: null, audioSender: null };
            }
            if (track.kind === 'video') {
              peerSenders.current[peerId].videoSender = sender;
            } else if (track.kind === 'audio') {
              peerSenders.current[peerId].audioSender = sender;
            }
          }
        });
      });
      
      socket.emit('request-peers');
    };

    acquireMedia();

    return () => {
      isMounted = false;
      // Stop whatever stream/tracks are active upon component unmount!
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [roomId]);

  // Bind local video source when ref and stream are ready
  useEffect(() => {
    if (localVideoRef.current && localStream && cameraEnabled) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, cameraEnabled]);

  // Handle toggling camera
  const toggleCamera = async () => {
    if (cameraEnabled) {
      // Turn camera OFF
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(track => {
          track.enabled = false;
          track.stop(); // Stops camera hardware and turns off light
          localStreamRef.current.removeTrack(track); // Remove the dead track
        });
      }
      // Replace track with null in active WebRTC connections using cached sender refs
      Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
        const senderObj = peerSenders.current[peerId];
        if (senderObj && senderObj.videoSender) {
          senderObj.videoSender.replaceTrack(null);
        }
      });

      setCameraEnabled(false);
      socket.emit('update-media-status', { cameraOn: false });
    } else {
      // Turn camera ON (Request crystal-clear HD resolution with standard fallback)
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          } 
        });
      } catch (err) {
        console.warn('Failed to enable HD camera, trying standard constraints:', err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (err2) {
          console.error('All camera access failed:', err2);
          alert('Camera permission denied or camera is unavailable. Please check your browser site settings.');
          return;
        }
      }

      try {
        const newVideoTrack = stream.getVideoTracks()[0];

        if (localStreamRef.current) {
          // Remove old video track if any
          const oldTrack = localStreamRef.current.getVideoTracks()[0];
          if (oldTrack) {
            localStreamRef.current.removeTrack(oldTrack);
          }
          // Add new video track
          localStreamRef.current.addTrack(newVideoTrack);

          // Update local video element srcObject
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }

          // Replace track in existing RTCPeerConnections using cached sender refs
          Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
            const senderObj = peerSenders.current[peerId];
            if (senderObj && senderObj.videoSender) {
              senderObj.videoSender.replaceTrack(newVideoTrack);
            } else {
              const sender = pc.addTrack(newVideoTrack, localStreamRef.current);
              if (!peerSenders.current[peerId]) {
                peerSenders.current[peerId] = { videoSender: null, audioSender: null };
              }
              peerSenders.current[peerId].videoSender = sender;
            }
          });
        } else {
          // If local stream was null
          setLocalStream(stream);
          localStreamRef.current = stream;
        }

        setCameraEnabled(true);
        socket.emit('update-media-status', { cameraOn: true });
      } catch (err) {
        console.error('Failed to configure camera tracks:', err);
      }
    }
  };

  // Handle toggling microphone
  const toggleMic = async () => {
    if (micEnabled) {
      // Mute microphone: stop all audio tracks
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = false;
          track.stop(); // Stops microphone hardware completely, turning off menu bar indicator
          localStreamRef.current.removeTrack(track); // Remove the dead track
        });
      }
      // Replace track with null in active WebRTC connections using cached sender refs
      Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
        const senderObj = peerSenders.current[peerId];
        if (senderObj && senderObj.audioSender) {
          senderObj.audioSender.replaceTrack(null);
        }
      });

      setMicEnabled(false);
      socket.emit('update-media-status', { micOn: false });
    } else {
      // Unmute microphone: request a new audio track
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        const newAudioTrack = stream.getAudioTracks()[0];

        if (localStreamRef.current) {
          // Remove old audio track if any
          const oldTrack = localStreamRef.current.getAudioTracks()[0];
          if (oldTrack) {
            localStreamRef.current.removeTrack(oldTrack);
          }
          // Add new audio track
          localStreamRef.current.addTrack(newAudioTrack);

          // Replace track in existing RTCPeerConnections using cached sender refs
          Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
            const senderObj = peerSenders.current[peerId];
            if (senderObj && senderObj.audioSender) {
              senderObj.audioSender.replaceTrack(newAudioTrack);
            } else {
              const sender = pc.addTrack(newAudioTrack, localStreamRef.current);
              if (!peerSenders.current[peerId]) {
                peerSenders.current[peerId] = { videoSender: null, audioSender: null };
              }
              peerSenders.current[peerId].audioSender = sender;
            }
          });
        }
        
        setMicEnabled(true);
        socket.emit('update-media-status', { micOn: true });
      } catch (err) {
        console.error('Failed to enable microphone hardware:', err);
        alert('Microphone permission denied or microphone is unavailable. Please check your browser site settings.');
      }
    }
  };

  // WebRTC Signalling Logic
  useEffect(() => {
    if (!socket) return;

    // Handle peer list request response (we initiate connections to all existing peers)
    socket.on('peers-list', (peers) => {
      peers.forEach(peerId => {
        initiateCall(peerId);
      });
    });

    // Handle incoming offer
    socket.on('webrtc-offer', async ({ senderSocketId, offer }) => {
      const pc = createPeerConnection(senderSocketId);
      webcamCandidatesBuffer.current[senderSocketId] = [];
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        // Add any buffered candidates now that remote description is set
        const buffered = webcamCandidatesBuffer.current[senderSocketId] || [];
        for (const candidate of buffered) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
        }
        webcamCandidatesBuffer.current[senderSocketId] = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('webrtc-answer', {
          targetSocketId: senderSocketId,
          answer,
        });
      } catch (err) {
        console.error('Error handling webcam offer:', err);
      }
    });

    // Handle incoming answer
    socket.on('webrtc-answer', async ({ senderSocketId, answer }) => {
      const pc = peerConnections.current[senderSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          
          // Add any buffered candidates now that remote description is set
          const buffered = webcamCandidatesBuffer.current[senderSocketId] || [];
          for (const candidate of buffered) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
          }
          webcamCandidatesBuffer.current[senderSocketId] = [];
        } catch (err) {
          console.error('Error handling answer description:', err);
        }
      }
    });

    // Handle incoming ICE candidates
    socket.on('webrtc-ice-candidate', async ({ senderSocketId, candidate }) => {
      const pc = peerConnections.current[senderSocketId];
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding ICE candidate:', e);
        }
      } else {
        // Buffer candidate
        if (!webcamCandidatesBuffer.current[senderSocketId]) {
          webcamCandidatesBuffer.current[senderSocketId] = [];
        }
        webcamCandidatesBuffer.current[senderSocketId].push(candidate);
      }
    });

    return () => {
      socket.off('peers-list');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('webrtc-ice-candidate');
    };
  }, [socket, localStream]);

  // Clean up peers that left
  useEffect(() => {
    const activeSocketIds = roomUsers.map(u => u.socketId);
    
    // Close connections for any peer who left
    Object.keys(peerConnections.current).forEach(peerId => {
      if (!activeSocketIds.includes(peerId)) {
        closeConnection(peerId);
      }
    });
  }, [roomUsers]);

  // Helper to create a Peer Connection for webcam sharing
  const createPeerConnection = (peerId) => {
    if (peerConnections.current[peerId]) {
      return peerConnections.current[peerId];
    }

    const pc = new RTCPeerConnection(iceServers);
    peerConnections.current[peerId] = pc;
    peerSenders.current[peerId] = { videoSender: null, audioSender: null };

    // Send local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStreamRef.current);
        if (track.kind === 'video') {
          peerSenders.current[peerId].videoSender = sender;
        } else if (track.kind === 'audio') {
          peerSenders.current[peerId].audioSender = sender;
        }
      });
    }

    // ICE candidate gathering
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          targetSocketId: peerId,
          candidate: event.candidate,
        });
      }
    };

    // Remote stream received
    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({
        ...prev,
        [peerId]: event.streams[0]
      }));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closeConnection(peerId);
      }
    };

    return pc;
  };

  const initiateCall = async (peerId) => {
    const pc = createPeerConnection(peerId);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', {
        targetSocketId: peerId,
        offer,
      });
    } catch (err) {
      console.error('Error initiating WebRTC call:', err);
    }
  };

  const closeConnection = (peerId) => {
    if (peerConnections.current[peerId]) {
      peerConnections.current[peerId].close();
      delete peerConnections.current[peerId];
    }
    if (peerSenders.current[peerId]) {
      delete peerSenders.current[peerId];
    }
    setRemoteStreams(prev => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
  };

  // ----------------------------------------------------
  // Screen Sharing WebRTC Logic
  // ----------------------------------------------------
  const toggleScreenShare = async () => {
    if (isScreenShareActive) {
      // Stop screen share
      stopScreenShare();
    } else {
      // Start screen share
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            cursor: 'always',
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 60, max: 60 } // Request buttery-smooth 60 FPS instead of choppy 15 FPS
          },
          audio: true,
        });

        // Instruct WebRTC encoder to prioritize fluid motion over static detail for video streaming
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && 'contentHint' in videoTrack) {
          videoTrack.contentHint = 'motion';
        }

        localScreenStreamRef.current = stream;
        setLocalScreenStream(stream);
        onScreenShareStream(stream);
        onScreenShareToggle(true);

        // Notify room through socket that host is sharing screen
        socket.emit('video-state-change', {
          url: socket.id, // we use host's socket ID as a marker of the streaming source
          currentTime: 0,
          playing: true,
          isScreenShare: true,
        });

        // Setup screen-sharing tracks to send to all peers
        roomUsers.forEach(u => {
          if (u.socketId !== socket.id) {
            initiateScreenStream(u.socketId, stream);
          }
        });

        // Handle stream stopping from browser UI directly (e.g. click "Stop sharing" ribbon) using the ref
        stream.getVideoTracks()[0].onended = () => {
          if (stopScreenShareRef.current) {
            stopScreenShareRef.current();
          }
        };

      } catch (err) {
        console.error('Error capturing screen share:', err);
      }
    }
  };

  const stopScreenShare = () => {
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(track => track.stop());
      localScreenStreamRef.current = null;
      setLocalScreenStream(null);
    }
    onScreenShareStream(null);
    onScreenShareToggle(false);

    // Notify server screen share is over
    socket.emit('video-state-change', {
      url: '',
      currentTime: 0,
      playing: false,
      isScreenShare: false,
    });

    // Close screen peer connections
    Object.keys(screenConnections.current).forEach(peerId => {
      if (screenConnections.current[peerId]) {
        screenConnections.current[peerId].close();
      }
    });
    screenConnections.current = {};
  };

  // We set up a separate peer connection set for the high-definition screen stream
  // This prevents interfering with webcam mesh bandwidth and settings.
  const createScreenConnection = (peerId, stream) => {
    if (screenConnections.current[peerId]) {
      return screenConnections.current[peerId];
    }

    const pc = new RTCPeerConnection(iceServers);
    screenConnections.current[peerId] = pc;

    // Add only screen tracks
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Send under a special channel name to separate screen ICE candidates
        socket.emit('webrtc-ice-candidate-screen', {
          targetSocketId: peerId,
          candidate: event.candidate,
        });
      }
    };

    return pc;
  };

  const initiateScreenStream = async (peerId, stream) => {
    const pc = createScreenConnection(peerId, stream);
    try {
      const offer = await pc.createOffer();
      // Apply bitrate patch to the local SDP offer
      const modifiedSdp = setSDPBitrate(offer.sdp, 6000);
      const modifiedOffer = new RTCSessionDescription({ type: 'offer', sdp: modifiedSdp });
      await pc.setLocalDescription(modifiedOffer);
      
      socket.emit('webrtc-offer-screen', {
        targetSocketId: peerId,
        offer: modifiedOffer,
      });
    } catch (err) {
      console.error('Error sending screen share offer:', err);
    }
  };

  // Receive screen share streams from host if we are not the host
  useEffect(() => {
    if (!socket) return;

    socket.on('webrtc-offer-screen', async ({ senderSocketId, offer }) => {
      const pc = new RTCPeerConnection(iceServers);
      screenConnections.current[senderSocketId] = pc;
      screenCandidatesBuffer.current[senderSocketId] = [];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-ice-candidate-screen', {
            targetSocketId: senderSocketId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        // Give the screen share stream back to parent so it displays in the center video player!
        onScreenShareStream(event.streams[0]);
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        // Add any buffered candidates now that remote description is set
        const buffered = screenCandidatesBuffer.current[senderSocketId] || [];
        for (const candidate of buffered) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
        }
        screenCandidatesBuffer.current[senderSocketId] = [];

        const answer = await pc.createAnswer();
        // Apply bitrate patch to local SDP answer
        const modifiedSdp = setSDPBitrate(answer.sdp, 6000);
        const modifiedAnswer = new RTCSessionDescription({ type: 'answer', sdp: modifiedSdp });
        await pc.setLocalDescription(modifiedAnswer);

        socket.emit('webrtc-answer-screen', {
          targetSocketId: senderSocketId,
          answer: modifiedAnswer,
        });
      } catch (err) {
        console.error('Error handling screen share offer:', err);
      }
    });

    socket.on('webrtc-answer-screen', async ({ senderSocketId, answer }) => {
      const pc = screenConnections.current[senderSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          
          // Add any buffered candidates now that remote description is set
          const buffered = screenCandidatesBuffer.current[senderSocketId] || [];
          for (const candidate of buffered) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
          }
          screenCandidatesBuffer.current[senderSocketId] = [];
        } catch (err) {
          console.error('Error handling screen share answer:', err);
        }
      }
    });

    socket.on('webrtc-ice-candidate-screen', async ({ senderSocketId, candidate }) => {
      const pc = screenConnections.current[senderSocketId];
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding screen share ICE candidate:', e);
        }
      } else {
        // Buffer candidate
        if (!screenCandidatesBuffer.current[senderSocketId]) {
          screenCandidatesBuffer.current[senderSocketId] = [];
        }
        screenCandidatesBuffer.current[senderSocketId].push(candidate);
      }
    });

    return () => {
      socket.off('webrtc-offer-screen');
      socket.off('webrtc-answer-screen');
      socket.off('webrtc-ice-candidate-screen');
    };
  }, [socket]);

  // Automatically send screen stream to any new peer that joins while sharing
  useEffect(() => {
    if (isHost && isScreenShareActive && localScreenStreamRef.current) {
      roomUsers.forEach(u => {
        if (u.socketId !== socket.id && !screenConnections.current[u.socketId]) {
          console.log('Sending screen share stream to new peer:', u.socketId);
          initiateScreenStream(u.socketId, localScreenStreamRef.current);
        }
      });
    }
  }, [roomUsers, isScreenShareActive, isHost]);

  // Clean up screen share when host leaves or room details update
  useEffect(() => {
    if (!isScreenShareActive) {
      onScreenShareStream(null);
      // Close incoming WebRTC screen channels to keep mesh fresh and ready for next sessions
      Object.keys(screenConnections.current).forEach(peerId => {
        if (screenConnections.current[peerId]) {
          screenConnections.current[peerId].close();
        }
      });
      screenConnections.current = {};
    }
  }, [isScreenShareActive]);



  return (
    <div 
      style={{
        ...styles.webcamGridContainer,
        position: isFullscreenRoom ? 'absolute' : 'relative',
        left: isFullscreenRoom ? 0 : 'auto',
        top: isFullscreenRoom ? 0 : 'auto',
        right: isFullscreenRoom ? 0 : 'auto',
        bottom: isFullscreenRoom ? 0 : 'auto',
        pointerEvents: isFullscreenRoom ? 'none' : 'auto',
        zIndex: isFullscreenRoom ? 10000 : 'auto',
        marginTop: isFullscreenRoom ? 0 : '15px',
      }} 
      className="webcam-grid-wrapper"
    >
      {/* Remote Audio Feeds (Always active in background, ensuring sound plays even if video is disabled) */}
      {roomUsers.map((u) => {
        if (u.socketId === socket.id) return null;
        const remoteStream = remoteStreams[u.socketId];
        return remoteStream ? <RemoteAudio key={`audio-${u.socketId}`} stream={remoteStream} /> : null;
      })}

      <div style={isFullscreenRoom ? { width: '100%', height: '100%', position: 'relative' } : styles.grid}>
        {/* Local Stream Card */}
        <div 
          className="glass-panel" 
          style={{ ...getCardStyle('local', 0), pointerEvents: 'auto' }}
          onMouseDown={isFullscreenRoom ? (e) => handleCardMouseDown('local', e) : undefined}
        >
          {cameraEnabled && localStream ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={styles.webcamVideo}
            />
          ) : (
            <div style={styles.avatarPlaceholder}>
              <img src={user?.avatar || AVATAR_PRESETS[0]} alt="avatar" style={styles.placeholderImg} />
            </div>
          )}
          <div style={styles.tag}>
            <span>You</span>
            {isHost && <Crown size={12} style={{ color: 'var(--warning)' }} />}
          </div>
        </div>

        {/* Remote Streams Cards */}
        {roomUsers.map((u, index) => {
          if (u.socketId === socket.id) return null;
          const remoteStream = remoteStreams[u.socketId];
          const hasVideo = remoteStream && u.cameraOn;

          return (
            <div 
              key={u.socketId} 
              className="glass-panel" 
              style={{ ...getCardStyle(u.socketId, index + 1), pointerEvents: 'auto' }}
              onMouseDown={isFullscreenRoom ? (e) => handleCardMouseDown(u.socketId, e) : undefined}
            >
              {hasVideo ? (
                <VideoElement stream={remoteStream} />
              ) : (
                <div style={styles.avatarPlaceholder}>
                  <img src={u.avatar} alt="avatar" style={styles.placeholderImg} />
                </div>
              )}
              <div style={styles.tag}>
                <span>{u.nickname}</span>
                {u.socketId === hostSocketId && <Crown size={12} style={{ color: 'var(--warning)' }} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Control Buttons Overlay/Bar */}
      <div style={{ ...getControlsBarStyle(), pointerEvents: 'auto' }}>
        <button
          onClick={toggleCamera}
          className={`btn ${cameraEnabled ? 'btn-secondary' : 'btn-danger'}`}
          style={styles.controlBtn}
          title={cameraEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
        >
          {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
        </button>

        <button
          onClick={toggleMic}
          className={`btn ${micEnabled ? 'btn-secondary' : 'btn-danger'}`}
          style={styles.controlBtn}
          title={micEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
        >
          {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </button>

        {isHost && (
          <button
            onClick={toggleScreenShare}
            className={`btn ${isScreenShareActive ? 'btn-accent' : 'btn-secondary'}`}
            style={styles.controlBtn}
            title={isScreenShareActive ? 'Stop Screen Share' : 'Share Screen'}
          >
            {isScreenShareActive ? <MonitorOff size={18} /> : <Monitor size={18} />}
            <span style={{ fontSize: '0.85rem' }}>{isScreenShareActive ? 'Stop Share' : 'Share Screen'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Helper Sub-component to attach remote stream to video element safely in React
function VideoElement({ stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted // Mute here to prevent duplicate audio play with RemoteAudio
      style={styles.webcamVideo}
    />
  );
}

// Helper Sub-component to play remote audio. We use an invisible <video> tag instead of <audio>
// because mobile Safari and Chrome route <video> tags to the loudspeaker by default, preventing sound from leaking out of the earpiece.
function RemoteAudio({ stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline style={{ display: 'none' }} />;
}

const styles = {
  webcamGridContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginTop: '15px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '12px',
  },
  webcamCard: {
    aspectRatio: '16/10',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.4)',
  },
  webcamVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scaleX(-1)', // mirror effect
  },
  avatarPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: 'var(--bg-tertiary)',
  },
  placeholderImg: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    boxShadow: 'var(--glass-shadow)',
  },
  tag: {
    position: 'absolute',
    bottom: '8px',
    left: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: '500',
    color: '#fff',
    border: '1px solid var(--border-glass)',
  },
  controlsBar: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: 'rgba(15, 18, 37, 0.4)',
    border: '1px solid var(--border-glass)',
    padding: '8px',
    borderRadius: 'var(--radius-sm)',
  },
  controlBtn: {
    padding: '10px',
    borderRadius: '50%',
    width: '42px',
    height: '42px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '24px',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderBottom: '1px solid var(--border-glass)',
    fontSize: '0.65rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    cursor: 'move',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 'var(--radius-sm)',
    borderTopRightRadius: 'var(--radius-sm)',
    userSelect: 'none',
  },
};
