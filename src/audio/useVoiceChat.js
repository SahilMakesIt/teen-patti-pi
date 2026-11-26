// 1. Use STUN + TURN servers so audio passes through strict mobile NAT/firewalls
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Free OpenRelay / Metered TURN servers for mobile-to-mobile WebRTC audio:
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

// 2. Capture mic stream BEFORE creating offer/answer, and attach remote audio to DOM
export async function startVoiceConnection({ onStatus }) {
  // Request microphone with echo cancellation & noise suppression for mobile speakers
  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  const pc = new RTCPeerConnection(ICE_SERVERS);

  // Add local audio tracks BEFORE creating offer or answer
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Play incoming remote audio reliably inside Pi Browser WebView
  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (!remoteStream) return;

    let audioEl = document.getElementById("remote-voice-audio");
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.id = "remote-voice-audio";
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = remoteStream;
    audioEl.muted = false;
    audioEl.volume = 1.0;

    // Force play() to bypass WebView autoplay block
    audioEl.play().catch((err) => {
      console.warn("Audio autoplay blocked until user tap:", err);
    });
  };

  pc.oniceconnectionstatechange = () => {
    // Only show "Connected" when iceConnectionState is "connected" or "completed"
    onStatus?.(pc.iceConnectionState);
  };

  return { pc, localStream };
}
