import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, Film, Link, Lock, Globe, Tv } from 'lucide-react';

const SAMPLE_VIDEOS = [
  { name: 'Sintel (Sci-Fi Animation)', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4' },
  { name: 'Big Buck Bunny (Comedy)', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
  { name: 'Tears of Steel (VFX Demo)', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4' },
];

export default function VideoPlayer({
  socket,
  roomId,
  videoState,
  isHost,
  screenShareStream,
  showSidebar = true,
  isFullscreenRoom = false,
}) {
  const videoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [syncStatus, setSyncStatus] = useState('In Sync');
  
  // Guard flag to prevent infinite loops of sync events
  const isIncomingUpdate = useRef(false);

  // Sync screen share stream to screen-share video tag
  useEffect(() => {
    if (screenVideoRef.current && screenShareStream) {
      screenVideoRef.current.srcObject = screenShareStream;
    }
  }, [screenShareStream, videoState.isScreenShare]);

  // Synchronize player with videoState from room state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || videoState.isScreenShare) return;

    // Check if source changed
    if (videoState.url && video.src !== videoState.url) {
      isIncomingUpdate.current = true;
      video.src = videoState.url;
      video.load();
    }

    // Sync playing status
    if (videoState.playing && video.paused) {
      isIncomingUpdate.current = true;
      video.play().catch(e => console.log('Autoplay blocked or playback error:', e));
    } else if (!videoState.playing && !video.paused) {
      isIncomingUpdate.current = true;
      video.pause();
    }

    // Sync current time if significantly out of bounds (1.5 seconds difference threshold)
    const timeDifference = Math.abs(video.currentTime - videoState.currentTime);
    if (timeDifference > 1.5) {
      isIncomingUpdate.current = true;
      video.currentTime = videoState.currentTime;
    }

    // Reset lock
    const timer = setTimeout(() => {
      isIncomingUpdate.current = false;
    }, 200);

    return () => clearTimeout(timer);
  }, [videoState]);

  // Sync local changes to socket (Host only)
  const handlePlay = () => {
    if (!isHost || isIncomingUpdate.current) return;
    socket.emit('video-state-change', {
      playing: true,
      currentTime: videoRef.current.currentTime,
    });
  };

  const handlePause = () => {
    if (!isHost || isIncomingUpdate.current) return;
    socket.emit('video-state-change', {
      playing: false,
      currentTime: videoRef.current.currentTime,
    });
  };

  const handleSeek = () => {
    if (!isHost || isIncomingUpdate.current) return;
    socket.emit('video-state-change', {
      currentTime: videoRef.current.currentTime,
      playing: !videoRef.current.paused,
    });
  };

  const handleLoadUrl = (e) => {
    e.preventDefault();
    if (!isHost || !videoUrlInput.trim()) return;
    
    socket.emit('video-state-change', {
      url: videoUrlInput.trim(),
      currentTime: 0,
      playing: false,
      isScreenShare: false,
    });
  };

  const loadSampleVideo = (url) => {
    if (!isHost) return;
    setVideoUrlInput(url);
    socket.emit('video-state-change', {
      url,
      currentTime: 0,
      playing: true,
      isScreenShare: false,
    });
  };

  return (
    <div style={styles.playerContainer}>
      
      {/* 1. SCREEN SHARE DISPLAY */}
      {videoState.isScreenShare ? (
        <div style={styles.screenShareWrapper}>
          {screenShareStream ? (
            <video
              ref={screenVideoRef}
              autoPlay
              playsInline
              muted={isHost}
              style={{ 
                ...styles.mainVideo, 
                maxHeight: isFullscreenRoom 
                  ? '100%' 
                  : showSidebar 
                    ? 'calc(100vh - 280px)' 
                    : 'calc(100vh - 200px)' 
              }}
            />
          ) : (
            <div style={styles.idleStage}>
              <div className="pulse-indicator" style={{ width: '16px', height: '16px' }} />
              <h3>Waiting for Host's Screen Stream...</h3>
              <p>The host has initiated screen share. Fetching WebRTC feeds.</p>
            </div>
          )}
          <div style={styles.videoOverlayTag}>
            <span className="badge badge-secondary">Screen Share Live</span>
          </div>
        </div>
      ) 
      
      // 2. SYNCHRONIZED PLAYER DISPLAY
      : videoState.url ? (
        <div style={styles.videoWrapper}>
          <video
            ref={videoRef}
            controls={isHost} // Viewers shouldn't interact directly to prevent async
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeek}
            style={{ 
              ...styles.mainVideo, 
              maxHeight: isFullscreenRoom 
                ? '100%' 
                : showSidebar 
                  ? 'calc(100vh - 280px)' 
                  : 'calc(100vh - 200px)' 
            }}
          />
          {!isHost && (
            <div style={styles.nonHostBlocker} title="Controls are managed by the Host">
              <div style={styles.viewerStatus}>
                <Lock size={12} /> Sync Active (Host Controlled)
              </div>
            </div>
          )}
        </div>
      ) 
      
      // 3. IDLE STAGE / SOURCE LOADING
      : (
        <div className="glass-panel" style={styles.idleStage}>
          <Tv size={48} style={styles.idleIcon} />
          <h3>No Media Loaded</h3>
          {isHost ? (
            <p>Paste a video link or choose one of our sample videos to get started.</p>
          ) : (
            <p>Waiting for the host to select a movie or share screen.</p>
          )}

          {isHost && (
            <div style={styles.samplesGrid}>
              {SAMPLE_VIDEOS.map((sample) => (
                <button
                  key={sample.url}
                  onClick={() => loadSampleVideo(sample.url)}
                  className="btn btn-secondary"
                  style={styles.sampleBtn}
                >
                  <Play size={12} /> {sample.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input bar to load new source URL (Host only) */}
      {isHost && !videoState.isScreenShare && (
        <form onSubmit={handleLoadUrl} style={styles.loadUrlForm}>
          <div style={styles.inputWrapper}>
            <Link size={16} style={styles.inputIcon} />
            <input
              type="text"
              className="input-field"
              placeholder="Paste direct MP4 video link..."
              value={videoUrlInput}
              onChange={(e) => setVideoUrlInput(e.target.value)}
              style={styles.urlInput}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={styles.loadBtn}>
            Load Video
          </button>
        </form>
      )}
    </div>
  );
}

const styles = {
  playerContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    height: '100%',
  },
  videoWrapper: {
    position: 'relative',
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: '16/9',
  },
  screenShareWrapper: {
    position: 'relative',
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: '16/9',
  },
  mainVideo: {
    width: '100%',
    height: '100%',
    maxHeight: 'calc(100vh - 280px)',
    backgroundColor: '#000',
  },
  nonHostBlocker: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: 'transparent',
    cursor: 'not-allowed',
  },
  viewerStatus: {
    position: 'absolute',
    top: '12px',
    left: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.75rem',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    padding: '4px 10px',
    borderRadius: '20px',
    border: '1px solid var(--border-glass)',
    color: 'var(--text-secondary)',
  },
  videoOverlayTag: {
    position: 'absolute',
    top: '12px',
    left: '12px',
    zIndex: 10,
  },
  idleStage: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    textAlign: 'center',
    gap: '12px',
    aspectRatio: '16/9',
  },
  idleIcon: {
    color: 'var(--primary)',
    opacity: 0.8,
  },
  samplesGrid: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: '15px',
  },
  sampleBtn: {
    padding: '8px 16px',
    fontSize: '0.8rem',
  },
  loadUrlForm: {
    display: 'flex',
    gap: '12px',
  },
  inputWrapper: {
    position: 'relative',
    flex: 1,
  },
  inputIcon: {
    position: 'absolute',
    left: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-muted)',
  },
  urlInput: {
    paddingLeft: '42px',
  },
  loadBtn: {
    flexShrink: 0,
  },
};
